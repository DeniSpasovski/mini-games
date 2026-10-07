import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { keyboardSteerLimit } from '../../src/games/rally/game/input';
import { applySetup } from '../../src/games/rally/physics/car-setup';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import { gripCurve, tireShape } from '../../src/games/rally/physics/tire';
import type { TyreId } from '../../src/games/rally/physics/tyres';
import type {
  CarPhysicsDef,
  GroundProvider,
  GroundSample,
  SetupId,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/**
 * Handling manoeuvres (headless, flat or rough synthetic ground) used by handling.test.ts - standard
 * vehicle-dynamics tests, each returning plain numbers. `Cfg.def` lets an experiment drive a modified car.
 * Sign convention: `betaOut` = sideslip towards oversteer (+ = the tail is out of the turn), degrees.
 */
export const DT = 1 / PHYSICS_HZ;
export const DEG = Math.PI / 180;
export const G = 9.81;
export const SURF: SurfaceId[] = [
  'tarmac',
  'tarmac_gravel',
  'gravel',
  'gravel_loose',
];
export const carDef = (id: string) =>
  ALL_CARS.find((c) => c.id === id)!.physics;

// --- grounds ------------------------------------------------------------------

export function flat(surface: SurfaceId): GroundProvider {
  return {
    sampleGround(_x: number, _z: number, out: GroundSample) {
      out.height = 0;
      out.normal.set(0, 1, 0);
      out.surface = SURFACES[surface];
      return out;
    },
    queryColliders: () => 0,
  };
}

/** Rutted road: ~3 cm undulations, wavelengths 2.6-5.3 m, left / right out of phase (heave + roll input). */
export function rough(surface: SurfaceId, amp = 0.03): GroundProvider {
  const h = (x: number, z: number) =>
    amp *
    (0.45 * Math.sin((2 * Math.PI * z) / 5.3 + 0.7 * Math.sin(x * 0.8)) +
      0.35 * Math.sin((2 * Math.PI * z) / 3.7 + x * 1.1) +
      0.2 * Math.sin((2 * Math.PI * z) / 2.6 - x * 0.6));
  const e = 0.05;
  return {
    sampleGround(x: number, z: number, out: GroundSample) {
      out.height = h(x, z);
      const dx = (h(x + e, z) - h(x - e, z)) / (2 * e);
      const dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
      out.normal.set(-dx, 1, -dz).normalize();
      out.surface = SURFACES[surface];
      return out;
    },
    queryColliders: () => 0,
  };
}

// --- vehicle helpers ------------------------------------------------------------

export interface Cfg {
  car: string;
  tyre: TyreId;
  setup: SetupId;
  /** Experiment: use this car def (before the set-up is applied) instead of the shipped one. */
  def?: CarPhysicsDef;
  /** Experiment: called on the Vehicle right after the tyre is fitted. */
  patch?: (v: Vehicle) => void;
}

export function build(cfg: Cfg, ground: GroundProvider): Vehicle {
  const v = new Vehicle(
    applySetup(cfg.def ?? carDef(cfg.car), cfg.setup),
    ground,
  );
  v.setTyre(cfg.tyre);
  cfg.patch?.(v);
  v.reset(new Vector3(), 0);
  run(v, 1.5);
  return v;
}

export function run(
  v: Vehicle,
  seconds: number,
  each?: (t: number) => boolean | void,
) {
  const n = Math.round(seconds * PHYSICS_HZ);
  for (let i = 0; i < n; i++) {
    v.step(DT);
    if (each?.(i * DT)) return i * DT;
  }
  return seconds;
}

/** Start rolling at `kmh` straight ahead (wheels spinning, sensible gear) - skips a long run-up. */
export function launch(v: Vehicle, kmh: number): void {
  const V = kmh / 3.6;
  v.velocity.copy(v.forward).multiplyScalar(V);
  for (const w of v.wheels) w.omega = V / w.radius;
  const dt = v.drivetrain;
  const gb = v.def.gearbox;
  const rpmIn = (g: number) =>
    ((V / v.def.wheelRadius) * dt.ratio(g) * 60) / (2 * Math.PI);
  let gear = 1;
  for (let g = 1; g <= gb.ratios.length; g++)
    if (rpmIn(g) < gb.upshiftRpm * 0.92) {
      gear = g;
      if (rpmIn(g) < (gb.downshiftRpm + gb.upshiftRpm) / 2) break;
    }
  dt.setGear(gear);
  dt.shiftTimer = 0;
  dt.rpm = rpmIn(gear);
  v.holding = false;
}

/** Hold a speed with throttle / brake (P controller). */
export function cruise(v: Vehicle, kmh: number): void {
  const e = kmh / 3.6 - v.speed;
  v.controls.throttle = Math.max(0, Math.min(1, 0.25 + e * 0.5));
  v.controls.brake = e < -1.5 ? Math.min(1, -e * 0.2) : 0;
}

/** Keep straight down +Z. */
export function holdLine(v: Vehicle): void {
  const heading = Math.atan2(v.forward.x, v.forward.z);
  v.controls.steer = Math.max(
    -0.3,
    Math.min(0.3, 1.5 * heading + 0.04 * v.position.x),
  );
}

export const beta = (v: Vehicle) =>
  Math.atan2(v.velocity.dot(v.right), Math.max(0.5, v.velocity.dot(v.forward)));
/** Sideslip towards oversteer (deg): + when the tail is out of the turn whose yaw rate is `r`. */
export const betaOut = (v: Vehicle, r: number) =>
  (-Math.sign(r || 1) * beta(v)) / DEG;
export const yawRate = (v: Vehicle) => v.angularVelocity.dot(v.up);
/**
 * True horizontal lateral acceleration (g) from the velocity change, smoothed over ~0.1 s (v x yaw rate overstates it
 * whenever the sideslip is changing). One tracker per vehicle.
 */
const accTrack = new WeakMap<Vehicle, { prev: Vector3; ay: number }>();
const _a = new Vector3();
const _h = new Vector3();
export function latG(v: Vehicle): number {
  let s = accTrack.get(v);
  if (!s) {
    s = { prev: v.velocity.clone(), ay: 0 };
    accTrack.set(v, s);
    return 0;
  }
  _a.subVectors(v.velocity, s.prev).divideScalar(DT);
  s.prev.copy(v.velocity);
  _a.y = 0;
  _h.set(v.velocity.x, 0, v.velocity.z);
  const sp = _h.length();
  if (sp < 1) return s.ay;
  _h.divideScalar(sp);
  const ay = Math.abs(_a.x * _h.z - _a.z * _h.x) / G;
  s.ay += (ay - s.ay) * Math.min(1, DT / 0.1);
  return s.ay;
}
export const rollDeg = (v: Vehicle) =>
  Math.asin(Math.max(-1, Math.min(1, v.right.y))) / DEG;
export const pitchDeg = (v: Vehicle) =>
  Math.asin(Math.max(-1, Math.min(1, v.forward.y))) / DEG;
export const heading = (v: Vehicle) => Math.atan2(v.forward.x, v.forward.z);
/** Mean |slip angle| / peak angle of an axle (> 1 = past the peak). */
export const axleSlip = (v: Vehicle, front: boolean) => {
  let s = 0;
  for (const w of v.wheels)
    if (w.isFront === front && w.contact)
      s += Math.abs(w.slipAngle) / (w.surface.peakAngle * DEG);
  return s / 2;
};

/**
 * How much of an axle's grip is in use: the tyre curve at the combined slip, capped at the peak (1 = at or past the
 * peak). The curve is steep - half the peak slip is already ~90 % of the force - so this, not the slip, is the balance.
 */
export const axleUtil = (v: Vehicle, front: boolean) => {
  let u = 0;
  for (const w of v.wheels)
    if (w.isFront === front && w.contact)
      u += gripCurve(Math.min(1, w.slip), tireShape(w.surface.slide));
  return u / 2;
};

// --- manoeuvres -----------------------------------------------------------------

/** Constant-speed ramp steer (right): max lateral g, understeer gradient (deg/g), balance at the limit. */
export function rampSteer(
  cfg: Cfg,
  surface: SurfaceId,
  kmh: number,
  ground = flat(surface),
) {
  const v = build(cfg, ground);
  launch(v, kmh);
  run(v, 1.5, () => cruise(v, kmh));
  const L = v.def.front.z - v.def.rear.z;
  const maxSteer = v.def.maxSteerDeg * DEG;
  const T = 8;
  const win: number[] = [];
  let best = {
    ay: 0,
    betaOut: 0,
    front: 0,
    rear: 0,
    uf: 0,
    ur: 0,
    steerDeg: 0,
  };
  let kSum = 0;
  let kN = 0;
  let maxBo = 0;
  let rollAt05 = NaN;
  run(v, T, (t) => {
    v.controls.steer = (0.8 * t) / T;
    cruise(v, kmh);
    const r = yawRate(v);
    const ay = latG(v);
    win.push(ay);
    if (win.length > 60) win.shift();
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    const bo = betaOut(v, r);
    if (avg > best.ay && Math.abs(bo) < 20)
      best = {
        ay: avg,
        betaOut: bo,
        front: axleSlip(v, true),
        rear: axleSlip(v, false),
        uf: axleUtil(v, true),
        ur: axleUtil(v, false),
        steerDeg: v.controls.steer * v.def.maxSteerDeg,
      };
    const spd = v.velocity.length();
    if (ay > 0.2 && ay < 0.35 && spd > 3) {
      const delta = v.controls.steer * maxSteer;
      kSum += (delta - (L * Math.abs(r)) / spd) / DEG / ay;
      kN++;
    }
    if (Number.isNaN(rollAt05) && avg > 0.5) rollAt05 = Math.abs(rollDeg(v));
    maxBo = Math.max(maxBo, bo);
  });
  return {
    maxG: best.ay,
    usGrad: kN ? kSum / kN : NaN,
    /** rear / front normalised slip at the limit: < 1 front-limited (push), > 1 rear-limited (loose). */
    balance: best.rear / Math.max(1e-6, best.front),
    betaAtLimit: best.betaOut,
    frontSlipAtLimit: best.front,
    /** Grip in use at the limit, front / rear (1 = at the peak): the axle at 1 is the one that limits the car. */
    utilFront: best.uf,
    utilRear: best.ur,
    steerAtLimit: best.steerDeg,
    spun: maxBo > 30,
    maxBetaOut: maxBo,
    rollAt05,
  };
}

/** Step steer at 80 km/h, 1.2 deg of wheel: yaw rate rise time (to 90 %) and overshoot. */
export function stepSteer(cfg: Cfg, surface: SurfaceId) {
  const v = build(cfg, flat(surface));
  launch(v, 80);
  run(v, 1.5, () => cruise(v, 80));
  const trace: number[] = [];
  run(v, 3, () => {
    v.controls.steer = 1.2 / v.def.maxSteerDeg;
    cruise(v, 80);
    trace.push(Math.abs(yawRate(v)));
  });
  const ss =
    trace.slice(-PHYSICS_HZ * 0.5).reduce((a, b) => a + b, 0) /
    (PHYSICS_HZ * 0.5);
  const i90 = trace.findIndex((r) => r >= 0.9 * ss);
  const peak = Math.max(...trace);
  return {
    t90: i90 * DT,
    overshoot: (peak / ss - 1) * 100,
    /** Steady yaw gain (yaw rate per wheel degree, 1/s). */
    yawGain: ss / 1.2,
  };
}

/** Settle in a right-hand corner at 60 km/h at `frac` of the limit, then apply an event; tail-out sideslip growth. */
export function cornerEvent(
  cfg: Cfg,
  surface: SurfaceId,
  limitG: number,
  event: 'lift' | 'power' | 'powerNoTc' | 'brake' | 'brakeHalf',
  frac = 0.6,
) {
  const v = build(cfg, flat(surface));
  if (event === 'powerNoTc') v.tractionControl = false;
  launch(v, 60);
  run(v, 1, () => cruise(v, 60));
  const target = limitG * frac;
  const V = 60 / 3.6;
  const L = v.def.front.z - v.def.rear.z;
  v.controls.steer = (L * target * G) / (V * V) / (v.def.maxSteerDeg * DEG);
  run(v, 4, () => {
    cruise(v, 60);
    v.controls.steer = Math.max(
      0,
      Math.min(1, v.controls.steer + (target - latG(v)) * 0.8 * DT),
    );
  });
  const r0 = yawRate(v);
  const bo0 = betaOut(v, r0);
  let maxBo = bo0;
  let minUp = 1;
  let maxR = Math.abs(r0);
  const braking = event === 'brake' || event === 'brakeHalf';
  const dur = braking ? 1.5 : 2;
  run(v, dur, () => {
    v.controls.throttle = event === 'power' || event === 'powerNoTc' ? 1 : 0;
    v.controls.brake = event === 'brake' ? 1 : event === 'brakeHalf' ? 0.5 : 0;
    maxBo = Math.max(maxBo, betaOut(v, r0));
    maxR = Math.max(maxR, Math.abs(yawRate(v)));
    minUp = Math.min(minUp, v.up.y);
    return braking && v.speed < 3;
  });
  return {
    dBeta: maxBo - bo0,
    yawRise: maxR / Math.max(1e-6, Math.abs(r0)),
    spun: maxBo > 30,
    minUp,
  };
}

/** Handbrake turn from 50 km/h: full lock + handbrake 0.8 s, then release; how far it rotates. */
export function handbrakeTurn(cfg: Cfg, surface: SurfaceId) {
  const v = build(cfg, flat(surface));
  launch(v, 50);
  run(v, 1, () => cruise(v, 50));
  const h0 = heading(v);
  run(v, 0.8, () => {
    v.controls.steer = 1;
    v.controls.throttle = 0;
    v.controls.handbrake = 1;
  });
  v.controls.handbrake = 0;
  run(v, 1.2, () => {
    v.controls.steer = 0;
    v.controls.throttle = 0.3;
  });
  let d = h0 - heading(v);
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return { rotateDeg: d / DEG, kmhAfter: v.speed * 3.6, minUp: v.up.y };
}

/** Slalom at 90 km/h: 2 sine cycles of 3 deg wheel at 0.5 Hz, then straight; peak sideslip, residual yaw. */
export function slalom(cfg: Cfg, surface: SurfaceId) {
  const v = build(cfg, flat(surface));
  launch(v, 90);
  run(v, 1.5, () => cruise(v, 90));
  let maxB = 0;
  let maxRoll = 0;
  let maxG = 0;
  run(v, 4, (t) => {
    v.controls.steer = (3 / v.def.maxSteerDeg) * Math.sin(Math.PI * t);
    cruise(v, 90);
    maxB = Math.max(maxB, Math.abs(beta(v)) / DEG);
    maxRoll = Math.max(maxRoll, Math.abs(rollDeg(v)));
    maxG = Math.max(maxG, latG(v));
  });
  run(v, 1.5, () => {
    v.controls.steer = 0;
    cruise(v, 90);
    maxB = Math.max(maxB, Math.abs(beta(v)) / DEG);
  });
  return {
    maxBeta: maxB,
    maxRoll,
    maxG,
    residualYaw: Math.abs(yawRate(v)) / DEG,
    spun: maxB > 30,
  };
}

/** What a keyboard player gets: steer ramps (3.2/s) to the in-game limit (`keyboardSteerLimit` at `Vehicle.peakSteer`), held 4 s. */
export function keyboardLock(
  cfg: Cfg,
  surface: SurfaceId,
  kmh: number,
  tc = true,
) {
  const v = build(cfg, flat(surface));
  v.tractionControl = tc;
  launch(v, kmh);
  run(v, 1.5, () => cruise(v, kmh));
  let maxBo = 0;
  let minUp = 1;
  const g: number[] = [];
  run(v, 4, (t) => {
    const limit = keyboardSteerLimit(
      v.speed,
      v.peakSteer(),
      v.def.maxSteerDeg * DEG,
    );
    v.controls.steer = Math.min(limit, 3.2 * t);
    cruise(v, kmh);
    const r = yawRate(v);
    maxBo = Math.max(maxBo, betaOut(v, r));
    minUp = Math.min(minUp, v.up.y);
    const ay = latG(v);
    if (t > 3) g.push(ay);
  });
  return {
    g: g.reduce((a, b) => a + b, 0) / Math.max(1, g.length),
    maxBetaOut: maxBo,
    balance: axleSlip(v, false) / Math.max(1e-6, axleSlip(v, true)),
    frontSlip: axleSlip(v, true),
    utilRear: axleUtil(v, false),
    kmhEnd: v.speed * 3.6,
    spun: maxBo > 30,
    minUp,
  };
}

/** 0-100 (TC on), 100-0 at full and 60 % brake: distance, which axle locks first, heading drift. */
export function straight(cfg: Cfg, surface: SurfaceId) {
  let v = build(cfg, flat(surface));
  v.controls.throttle = 1;
  const t100 = run(v, 15, () => {
    holdLine(v);
    return v.speed * 3.6 >= 100;
  });
  const brake = (pedal: number) => {
    v = build(cfg, flat(surface));
    launch(v, 100);
    run(v, 1, () => {
      cruise(v, 100);
      holdLine(v);
    });
    const z0 = v.position.z;
    const h0 = heading(v);
    let firstLock = '-';
    let maxB = 0;
    let maxPitch = 0;
    run(v, 10, () => {
      v.controls.throttle = 0;
      v.controls.brake = pedal;
      v.controls.steer = 0;
      for (const w of v.wheels)
        if (firstLock === '-' && w.contact && w.slipRatio < -0.5 && v.speed > 5)
          firstLock = w.isFront ? 'F' : 'R';
      maxB = Math.max(maxB, Math.abs(beta(v)) / DEG);
      maxPitch = Math.max(maxPitch, Math.abs(pitchDeg(v)));
      return v.speed < 0.3;
    });
    let dh = heading(v) - h0;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {
      dist: v.position.z - z0,
      firstLock,
      headingDrift: Math.abs(dh) / DEG,
      maxBeta: maxB,
      maxPitch,
    };
  };
  return { t100, full: brake(1), soft: brake(0.6) };
}

/** Drop from `h` m onto flat tarmac: bump-stop use, settle time, tilt. */
export function drop(cfg: Cfg, h: number) {
  const v = build(cfg, flat('tarmac'));
  const rest = v.position.y;
  v.position.y += h;
  let maxStop = 0;
  let settled = NaN;
  let minUp = 1;
  run(v, 4, (t) => {
    for (const w of v.wheels) maxStop = Math.max(maxStop, w.bumpStop);
    minUp = Math.min(minUp, v.up.y);
    const still =
      Math.abs(v.velocity.y) < 0.05 && Math.abs(v.position.y - rest) < 0.01;
    if (still && Number.isNaN(settled) && t > 0.3) settled = t;
    if (!still) settled = NaN;
  });
  return { bumpStopCm: maxStop * 100, settle: settled, minUp };
}

/**
 * Jump landing: rolling at `kmh` on flat `surface`, the car is dropped `h` m (like coming off a crest) and keeps
 * cruising. With the hull fitted to the body a low car bottoms out (`bodyHits` steps with a hull contact) - it must
 * scrape, not stop dead or tip over.
 */
export function jumpLanding(
  cfg: Cfg,
  surface: SurfaceId,
  kmh: number,
  h: number,
) {
  const v = build(cfg, flat(surface));
  launch(v, kmh);
  run(v, 1, () => {
    cruise(v, kmh);
    holdLine(v);
  });
  const v0 = v.speed;
  v.position.y += h;
  let maxImpact = 0;
  let bodyHits = 0;
  let minUp = 1;
  let maxStop = 0;
  run(v, 2, () => {
    cruise(v, kmh);
    holdLine(v);
    if (v.impact > 0) bodyHits++;
    maxImpact = Math.max(maxImpact, v.impact);
    minUp = Math.min(minUp, v.up.y);
    for (const w of v.wheels) maxStop = Math.max(maxStop, w.bumpStop);
  });
  return {
    speedKept: v.speed / v0,
    maxImpact,
    bodyHits,
    bumpStopCm: maxStop * 100,
    minUp,
  };
}

/** Straight at 80 km/h over the rutted road: wheel load variation, contact loss, bump-stop hits, body vertical accel. */
export function roughRide(cfg: Cfg, surface: SurfaceId) {
  const v = build(cfg, rough(surface));
  launch(v, 80);
  run(v, 1, () => {
    cruise(v, 80);
    holdLine(v);
  });
  let n = 0;
  let noContact = 0;
  let stop = 0;
  const loads: number[] = [];
  let vy0 = v.velocity.y;
  let az2 = 0;
  run(v, 5, () => {
    cruise(v, 80);
    holdLine(v);
    for (const w of v.wheels) {
      n++;
      if (!w.contact) noContact++;
      if (w.bumpStop > 0) stop++;
      loads.push(w.load / w.nominalLoad);
    }
    const az = (v.velocity.y - vy0) / DT;
    vy0 = v.velocity.y;
    az2 += az * az;
  });
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  const sd = Math.sqrt(
    loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length,
  );
  return {
    loadCv: sd / mean,
    airPct: (noContact / n) * 100,
    bumpStopPct: (stop / n) * 100,
    azRms: Math.sqrt(az2 / (5 * PHYSICS_HZ)) / G,
  };
}

/** Hold the flat-ground limit steer for 5 s at 60 km/h on `ground`: mean lateral g over the last 3 s. */
export function holdG(cfg: Cfg, ground: GroundProvider, steerDeg: number) {
  const v = build(cfg, ground);
  launch(v, 60);
  run(v, 1, () => {
    cruise(v, 60);
    holdLine(v);
  });
  let sum = 0;
  let n = 0;
  run(v, 5, (t) => {
    v.controls.steer = Math.min(steerDeg / v.def.maxSteerDeg, (t * 3.2) / 1);
    cruise(v, 60);
    const ay = latG(v);
    if (t > 2) {
      sum += ay;
      n++;
    }
  });
  return sum / n;
}
