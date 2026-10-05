import { Quaternion, Vector3 } from 'three';
import { Drivetrain } from './drivetrain';
import { SURFACES, type SurfaceDef, type SurfaceId } from './surfaces';
import { computeTire, type TireInput, type TireOutput } from './tire';
import { carSurfaces } from './car-tyres';
import { staticComHeight } from './car-setup';
import { autoHull } from './hull';
import type { TyreId } from './tyres';
import type {
  AxleDef,
  CarPhysicsDef,
  GroundProvider,
  GroundSample,
  StaticCollider,
  VehicleControls,
  WheelId,
} from './types';

/**
 * Raycast-suspension rigid-body car.
 *
 * Per fixed step (default 240 Hz, see PHYSICS_HZ):
 *   1. each wheel raycasts the ground along the body's down axis
 *   2. spring + damper + anti-roll bar -> suspension force (= tyre load)
 *   3. drivetrain -> drive torque, brakes, wheel spin integrated semi-implicitly
 *   4. combined-slip tyre model -> longitudinal + lateral force at contact
 *   5. gravity, aero, then rigid body integration
 *   6. hull spheres vs ground / static colliders (impulses + position fix)
 *
 * Tuning guide: PHYSICS.md in this game folder.
 */
export { autoHull };

export const PHYSICS_HZ = 240;
const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;
const WATER_DENSITY = 1000;
/** Drag coefficients wading through water: tyre (cylinder side-on) and body (bluff box). */
const WHEEL_WATER_CD = 1.0;
const BODY_WATER_CD = 1.05;
/** Traction control stability term: combined slip (1 = peak) above which a driven wheel trims throttle. */
const TC_REAR_SLIP = 1.15;
const TC_FRONT_SLIP = 2.0;

export interface WheelState {
  id: WheelId;
  axle: AxleDef;
  isFront: boolean;
  isLeft: boolean;
  driven: boolean;
  /** Suspension top mount in body frame (wheel centre at full bump). */
  mount: Vector3;
  radius: number;
  nominalLoad: number;
  // --- dynamic -------------------------------------------------------------
  steerAngle: number;
  /** Distance mount -> wheel centre along body down (0 = full bump, travel = full droop). */
  ext: number;
  compression: number;
  prevCompression: number;
  /** Penetration past full bump (m), pushed back by a stiff bump stop. */
  bumpStop: number;
  omega: number;
  /** Accumulated spin angle for rendering. */
  spin: number;
  contact: boolean;
  load: number;
  slipRatio: number;
  slipAngle: number;
  /** Normalised combined slip (>1 sliding). */
  slip: number;
  fx: number;
  fy: number;
  /** Contact patch speed (m/s), used for effects. */
  contactSpeed: number;
  /** Speed at which the tyre is sliding over the ground (m/s). */
  slideSpeed: number;
  surface: SurfaceDef;
  contactPoint: Vector3;
  contactNormal: Vector3;
  driveTorque: number;
}

export interface VehicleSnapshot {
  position: Vector3;
  quaternion: Quaternion;
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _q = new Quaternion();
// waterPass temporaries (applyForce uses _v4).
const _w1 = new Vector3();
const _w2 = new Vector3();
const _w3 = new Vector3();
const _w4 = new Vector3();

export class Vehicle {
  readonly def: CarPhysicsDef;
  readonly mass: number;
  /** Body-frame principal inertia. */
  readonly inertia = new Vector3();
  readonly invInertia = new Vector3();
  readonly wheels: WheelState[];
  readonly hull: [number, number, number, number][];
  readonly drivetrain: Drivetrain;

  // Rigid body state (world).
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  readonly angularVelocity = new Vector3();
  /** State before the last step, for render interpolation. */
  readonly prev: VehicleSnapshot = {
    position: new Vector3(),
    quaternion: new Quaternion(),
  };

  controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  /** Hold the car with full brakes on all wheels (start line), bypassing pedals. */
  parked = false;
  /**
   * Auto handbrake / hill hold: when (nearly) stopped with no pedal pressed the
   * car is held so it never rolls back; throttle (or brake = reverse) releases it.
   */
  autoHold = true;
  /** True while auto-hold is holding the car. */
  holding = true;
  /** Arcade helper: holding brake at standstill engages reverse. */
  autoReverse = true;
  /** Driver aid: trims throttle on wheelspin and when driven tyres exceed peak combined slip (T in game). */
  tractionControl = true;
  /** Current traction-control throttle multiplier (1 = not intervening). */
  tcFactor = 1;

  // Derived each step (world-space basis).
  readonly right = new Vector3();
  readonly up = new Vector3();
  readonly forward = new Vector3();
  /** Last body contact impulse magnitude (for crash sounds / camera shake). */
  impact = 0;
  /** Seconds since any wheel touched the ground. */
  airTime = 0;
  /** Deepest water around the car (m above the lowest wheel / underside), 0 when dry. */
  waterDepth = 0;
  /** Engine power left with water at the air intake (1 = dry intake). */
  engineWater = 1;

  /** Fitted tyre (see tyres.ts); null = raw ground surfaces (tests, viewers). Set via `setTyre`. */
  tyre: TyreId | null = null;
  private tyreSurfaces: Record<SurfaceId, SurfaceDef> | null = null;

  private ground: GroundProvider;
  private sample: GroundSample = {
    height: 0,
    normal: new Vector3(0, 1, 0),
    surface: SURFACES.gravel,
  };
  private tireIn: TireInput = {
    omega: 0,
    radius: 0,
    vx: 0,
    vy: 0,
    load: 0,
    nominalLoad: 1,
    grip: 1,
    surface: SURFACES.gravel,
  };
  private tireOut: TireOutput = {
    fx: 0,
    fy: 0,
    slipRatio: 0,
    slipAngle: 0,
    slip: 0,
  };
  private force = new Vector3();
  private torque = new Vector3();
  private colliders: StaticCollider[] = [];
  private reverseTimer = 0;

  constructor(def: CarPhysicsDef, ground: GroundProvider) {
    this.def = def;
    this.ground = ground;
    this.mass = def.mass;
    const { length: l, width: w, height: h, inertiaScale: s } = def;
    const m = def.mass / 12;
    this.inertia.set(
      m * (h * h + l * l) * s,
      m * (w * w + l * l) * s,
      m * (w * w + h * h) * s,
    );
    this.invInertia.set(
      1 / this.inertia.x,
      1 / this.inertia.y,
      1 / this.inertia.z,
    );
    this.drivetrain = new Drivetrain(def);
    this.wheels = this.buildWheels();
    this.hull = def.hull ?? autoHull(def);
  }

  /**
   * Fit a tyre compound: wheels then grip on this car's effective surfaces for it (compound x the car's tyre size x
   * its current set-up, `def.setup` - build the Vehicle from `applySetup(def, id)` to change the suspension).
   */
  setTyre(tyre: TyreId | null): void {
    this.tyre = tyre;
    this.tyreSurfaces = tyre ? carSurfaces(this.def, tyre) : null;
  }

  /** The surface as the wheels see it (fitted tyre + set-up applied; raw without a tyre). */
  surfaceFor(id: SurfaceId): SurfaceDef {
    return this.tyreSurfaces ? this.tyreSurfaces[id] : SURFACES[id];
  }

  private buildWheels(): WheelState[] {
    const d = this.def;
    const wheelbase = d.front.z - d.rear.z;
    // The set-up's ride height lifts the body (and its hull) over the wheels: the wheels hang that much lower.
    const restY = d.wheelRadius - staticComHeight(d);
    const mk = (
      id: WheelId,
      axle: AxleDef,
      isFront: boolean,
      isLeft: boolean,
    ): WheelState => {
      // Static corner load from the weight distribution.
      const otherZ = isFront ? d.rear.z : d.front.z;
      const nominalLoad = (d.mass * GRAVITY * Math.abs(otherZ)) / wheelbase / 2;
      const staticComp = Math.min(axle.travel * 0.9, nominalLoad / axle.spring);
      const mountY = restY + (axle.travel - staticComp);
      const split = d.drivetrain.frontSplit;
      return {
        id,
        axle,
        isFront,
        isLeft,
        driven: isFront ? split > 0 : split < 1,
        mount: new Vector3(
          ((isLeft ? 1 : -1) * axle.track) / 2,
          mountY,
          axle.z,
        ),
        radius: d.wheelRadius,
        nominalLoad,
        steerAngle: 0,
        ext: axle.travel - staticComp,
        compression: staticComp,
        prevCompression: staticComp,
        bumpStop: 0,
        omega: 0,
        spin: 0,
        contact: false,
        load: 0,
        slipRatio: 0,
        slipAngle: 0,
        slip: 0,
        fx: 0,
        fy: 0,
        contactSpeed: 0,
        slideSpeed: 0,
        surface: SURFACES.gravel,
        contactPoint: new Vector3(),
        contactNormal: new Vector3(0, 1, 0),
        driveTorque: 0,
      };
    };
    return [
      mk('FL', d.front, true, true),
      mk('FR', d.front, true, false),
      mk('RL', d.rear, false, true),
      mk('RR', d.rear, false, false),
    ];
  }

  /** Forward speed (m/s, negative when reversing). */
  get speed(): number {
    return this.velocity.dot(this.forward);
  }

  /** Place the car at rest at `position` (ground level under the car), facing `heading` (rad, 0 = +Z). */
  reset(groundPosition: Vector3, heading: number): void {
    this.position.copy(groundPosition);
    this.position.y += staticComHeight(this.def) + 0.05;
    this.quaternion.setFromAxisAngle(_v1.set(0, 1, 0), heading);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    for (const w of this.wheels) {
      w.omega = 0;
      w.ext = w.axle.travel - w.nominalLoad / w.axle.spring;
      w.compression = w.prevCompression = w.axle.travel - w.ext;
    }
    this.drivetrain.setGear(1);
    this.drivetrain.shiftTimer = 0;
    this.holding = this.autoHold;
    this.prev.position.copy(this.position);
    this.prev.quaternion.copy(this.quaternion);
    this.updateBasis();
  }

  private updateBasis(): void {
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion); // NOTE: +X is the car's LEFT
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
  }

  step(dt: number): void {
    this.prev.position.copy(this.position);
    this.prev.quaternion.copy(this.quaternion);
    this.updateBasis();
    this.force.set(0, -GRAVITY * this.mass, 0);
    this.torque.set(0, 0, 0);

    this.updateHold();
    const pedals =
      this.parked || this.holding
        ? { throttle: this.controls.throttle, brake: 2 }
        : this.resolvePedals(dt);
    const brake = pedals.brake;
    const throttle =
      pedals.throttle * this.tractionAssist(dt) * this.engineWater;
    const d = this.def;
    const steerAngle = -this.controls.steer * d.maxSteerDeg * (Math.PI / 180);

    this.suspensionPass(dt);

    // --- drivetrain ------------------------------------------------------------
    const handbrake = this.controls.handbrake;
    let drivenOmega = 0;
    let drivenWeight = 0;
    for (const w of this.wheels) {
      if (!w.driven) continue;
      const share = w.isFront
        ? d.drivetrain.frontSplit
        : 1 - d.drivetrain.frontSplit;
      drivenOmega += w.omega * share;
      drivenWeight += share;
    }
    drivenOmega /= drivenWeight || 1;
    // Pulling the handbrake declutches the rear axle (rally hydraulic handbrake).
    const handbrakeOn = handbrake > 0.1;
    const rwd = d.drivetrain.frontSplit === 0;
    this.drivetrain.update(
      dt,
      throttle,
      drivenOmega,
      this.speed / d.wheelRadius,
      handbrakeOn && rwd,
    );
    this.distributeTorque(handbrakeOn);
    const coupled = this.wheels.filter(
      (w) => w.driven && !(handbrakeOn && !w.isFront),
    );
    const reflected = coupled.length
      ? this.drivetrain.reflectedInertia() / coupled.length
      : 0;

    // --- wheels: tyre forces + spin ---------------------------------------------
    let anyContact = false;
    for (const w of this.wheels) {
      w.steerAngle = steerAngle * w.axle.steer;
      const inertia = d.wheelInertia + (coupled.includes(w) ? reflected : 0);
      const brakeT =
        brake * w.axle.brakeTorque + handbrake * w.axle.handbrakeTorque;
      if (w.contact) anyContact = true;
      this.wheelPass(w, dt, inertia, brakeT);
    }
    this.airTime = anyContact ? 0 : this.airTime + dt;

    this.waterPass();

    // --- aero ---------------------------------------------------------------------
    const v2 = this.velocity.lengthSq();
    if (v2 > 0.01) {
      const v = Math.sqrt(v2);
      this.force.addScaledVector(
        this.velocity,
        -0.5 * AIR_DENSITY * d.dragArea * v,
      );
      this.force.addScaledVector(
        this.up,
        -0.5 * AIR_DENSITY * d.downforceArea * v2,
      );
    }

    // --- integrate ----------------------------------------------------------------
    this.velocity.addScaledVector(this.force, dt / this.mass);
    // Angular: Euler's equations in body frame.
    const qInv = _q.copy(this.quaternion).invert();
    const wb = _v1.copy(this.angularVelocity).applyQuaternion(qInv);
    const tb = _v2.copy(this.torque).applyQuaternion(qInv);
    const I = this.inertia;
    const Iw = _v3.set(I.x * wb.x, I.y * wb.y, I.z * wb.z);
    const gyro = _v4.crossVectors(wb, Iw);
    tb.sub(gyro);
    wb.x += tb.x * this.invInertia.x * dt;
    wb.y += tb.y * this.invInertia.y * dt;
    wb.z += tb.z * this.invInertia.z * dt;
    this.angularVelocity.copy(wb.applyQuaternion(this.quaternion));

    // Static friction while held: the slip-based tyre model is viscous at
    // ~0 m/s and would let a braked car creep down hills.
    if (
      (this.parked || this.holding) &&
      anyContact &&
      this.velocity.lengthSq() < 0.25
    ) {
      const vn = this.velocity.dot(this.up);
      this.velocity.multiplyScalar(0.1).addScaledVector(this.up, vn * 0.9);
      this.angularVelocity.multiplyScalar(0.5);
    }

    this.resolveContacts();

    this.position.addScaledVector(this.velocity, dt);
    const w = this.angularVelocity;
    const q = this.quaternion;
    const hdt = 0.5 * dt;
    _q.set(w.x * hdt, w.y * hdt, w.z * hdt, 0).multiply(q);
    q.set(q.x + _q.x, q.y + _q.y, q.z + _q.z, q.w + _q.w).normalize();
  }

  private updateHold(): void {
    if (!this.autoHold) {
      this.holding = false;
      return;
    }
    const c = this.controls;
    if (c.throttle > 0.05 || c.brake > 0.05) this.holding = false;
    else if (this.velocity.lengthSq() < 0.25 && !this.parked)
      this.holding = true;
  }

  private tractionAssist(dt: number): number {
    if (!this.tractionControl) return (this.tcFactor = 1);
    let excess = 0;
    for (const w of this.wheels) {
      if (!w.driven || !w.contact) continue;
      excess = Math.max(
        excess,
        Math.abs(w.slipRatio) / (w.surface.peakSlip * 1.2) - 1,
      );
      // Stability: also back off when cornering + traction exceed peak combined grip
      // (stops power-oversteer spins when the throttle is held flat mid-corner). Driven FRONT tyres get a much
      // higher threshold: past their peak they are understeering (too much lock), and cutting power there only bogged
      // the AWD / FWD cars down mid-corner; it still catches them at high speed on loose ground.
      if (this.speed > 5)
        excess = Math.max(
          excess,
          (w.slip - (w.isFront ? TC_FRONT_SLIP : TC_REAR_SLIP)) * 0.9,
        );
    }
    const target = excess > 0 ? Math.max(0.25, 1 - excess * 1.2) : 1;
    this.tcFactor += (target - this.tcFactor) * Math.min(1, dt * 15);
    return this.tcFactor;
  }

  /** Map raw pedals to throttle/brake, handling automatic reverse. */
  private resolvePedals(dt: number): { throttle: number; brake: number } {
    const c = this.controls;
    const dtr = this.drivetrain;
    if (!this.autoReverse) return { throttle: c.throttle, brake: c.brake };
    const v = this.velocity.dot(this.forward);
    if (dtr.gear >= 1) {
      if (c.brake > 0.5 && c.throttle < 0.1 && Math.abs(v) < 0.6)
        this.reverseTimer += dt;
      else this.reverseTimer = 0;
      if (this.reverseTimer > 0.25) {
        dtr.setGear(-1);
        dtr.shiftTimer = 0;
        this.reverseTimer = 0;
      }
      return { throttle: c.throttle, brake: c.brake };
    }
    if (dtr.gear === -1) {
      if (c.throttle > 0.5 && v > -0.6) {
        dtr.setGear(1);
        dtr.shiftTimer = 0;
        return { throttle: c.throttle, brake: 0 };
      }
      // In reverse the pedals swap: "brake" drives backwards, "throttle" brakes.
      return { throttle: c.brake, brake: c.throttle };
    }
    return { throttle: c.throttle, brake: c.brake };
  }

  private distributeTorque(handbrakeOn: boolean): void {
    const d = this.def.drivetrain;
    const T = this.drivetrain.wheelTorque;
    const [fl, fr, rl, rr] = this.wheels;
    let tf = T * d.frontSplit;
    let tr = T * (1 - d.frontSplit);
    // Hydraulic handbrake disconnects the rear axle (like a real rally car).
    if (handbrakeOn) {
      tf = d.frontSplit > 0 ? T : 0;
      tr = 0;
    } else if (d.frontSplit > 0 && d.frontSplit < 1) {
      const tc =
        d.centerLock * ((fl.omega + fr.omega) / 2 - (rl.omega + rr.omega) / 2);
      tf -= tc;
      tr += tc;
    }
    const axle = (l: WheelState, r: WheelState, t: number, lock: number) => {
      const tl = lock * (l.omega - r.omega) * 0.5;
      l.driveTorque = l.driven ? t / 2 - tl : 0;
      r.driveTorque = r.driven ? t / 2 + tl : 0;
    };
    axle(fl, fr, tf, d.frontDiffLock);
    axle(rl, rr, tr, d.rearDiffLock);
  }

  /** Raycast every wheel and apply spring/damper/anti-roll forces. */
  private suspensionPass(dt: number): void {
    const s = this.sample;
    for (const w of this.wheels) {
      const mountW = _v1
        .copy(w.mount)
        .applyQuaternion(this.quaternion)
        .add(this.position);
      const dy = -this.up.y; // y component of the down axis
      w.prevCompression = w.compression;
      w.contact = false;
      w.bumpStop = 0;
      if (dy > -0.25) {
        // Upside down / on its side: no wheel contact.
        w.ext = w.axle.travel;
        w.compression = 0;
        continue;
      }
      // Ray along body down: P + t*D. Solve P.y + t*D.y = ground(P.xz + t*D.xz).
      const dx = -this.up.x;
      const dz = -this.up.z;
      let t = 0;
      for (let it = 0; it < 3; it++) {
        const x = mountW.x + t * dx;
        const z = mountW.z + t * dz;
        this.ground.sampleGround(x, z, s, mountW.y + t * dy);
        const gh = s.height + surfaceBump(x, z, s.surface.bump);
        t += (mountW.y + t * dy - gh) / -dy;
      }
      const reach = w.axle.travel + w.radius;
      if (t > reach) {
        w.ext = w.axle.travel;
        w.compression = 0;
        continue;
      }
      w.contact = true;
      w.ext = Math.max(0, t - w.radius);
      w.compression = w.axle.travel - w.ext;
      w.surface = this.tyreSurfaces
        ? this.tyreSurfaces[s.surface.id]
        : s.surface;
      w.contactNormal.copy(s.normal);
      w.contactPoint.set(
        mountW.x + t * dx,
        mountW.y + t * dy,
        mountW.z + t * dz,
      );
      // Bump stop when the wheel would have to go past full compression.
      w.bumpStop = Math.max(0, w.radius - t);
    }
    // Forces (second pass, so anti-roll bars can see both sides).
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) {
        w.load = 0;
        continue;
      }
      const other = this.wheels[i ^ 1];
      const a = w.axle;
      const compVel = (w.compression - w.prevCompression) / dt;
      let f =
        a.spring * w.compression + (compVel > 0 ? a.bump : a.rebound) * compVel;
      f += a.antiRoll * (w.compression - other.compression);
      f += a.spring * 12 * w.bumpStop;
      f = Math.max(0, f);
      w.load = f;
      const mountW = _v1
        .copy(w.mount)
        .applyQuaternion(this.quaternion)
        .add(this.position);
      this.applyForce(_v2.copy(this.up).multiplyScalar(f), mountW);
    }
  }

  private wheelPass(
    w: WheelState,
    dt: number,
    inertia: number,
    brakeT: number,
  ): void {
    if (!w.contact) {
      w.omega += (w.driveTorque / inertia) * dt;
      w.omega = applyBrake(w.omega, brakeT, inertia, dt);
      w.omega *= 1 - 0.5 * dt;
      w.spin += w.omega * dt;
      w.fx = w.fy = w.slip = w.slipAngle = 0;
      w.slipRatio = 0;
      w.contactSpeed = w.slideSpeed = 0;
      return;
    }
    const n = w.contactNormal;
    // Wheel heading, steered, projected on the ground plane.
    const fwd = _v1
      .set(Math.sin(w.steerAngle), 0, Math.cos(w.steerAngle))
      .applyQuaternion(this.quaternion);
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    const side = _v2.crossVectors(n, fwd).normalize(); // points to the wheel's left
    // Contact patch velocity.
    const r = _v3.subVectors(w.contactPoint, this.position);
    const vp = _v4.crossVectors(this.angularVelocity, r).add(this.velocity);
    const vx = vp.dot(fwd);
    const vy = vp.dot(side);

    const ti = this.tireIn;
    ti.radius = w.radius;
    ti.vx = vx;
    ti.vy = vy;
    ti.load = Math.min(w.load, w.nominalLoad * 3.5);
    ti.nominalLoad = w.nominalLoad;
    ti.grip = w.axle.grip;
    ti.surface = w.surface;

    // Semi-implicit wheel spin: linearise Fx around the current omega so stiff
    // tyres stay stable at the physics rate.
    const to = this.tireOut;
    ti.omega = w.omega;
    const f0 = computeTire(ti, to).fx;
    const dOmega = 0.05;
    ti.omega = w.omega + dOmega;
    const dFdw = Math.max(0, (computeTire(ti, to).fx - f0) / dOmega);
    const rolling =
      w.surface.rolling *
      ti.load *
      Math.tanh(w.omega * w.radius * 2) *
      w.radius;
    let omega =
      w.omega +
      (dt * (w.driveTorque - f0 * w.radius - rolling)) /
        (inertia + dt * w.radius * dFdw);
    omega = applyBrake(omega, brakeT, inertia, dt);
    w.omega = omega;
    w.spin += omega * dt;

    ti.omega = omega;
    computeTire(ti, to);
    w.fx = to.fx;
    w.fy = to.fy;
    w.slipRatio = to.slipRatio;
    w.slipAngle = to.slipAngle;
    w.slip = to.slip;
    w.contactSpeed = Math.hypot(vx, vy);
    w.slideSpeed = Math.hypot(omega * w.radius - vx, vy);

    // Apply at a point raised towards the COM (roll-centre style tuning knob).
    const app = _v3.copy(w.contactPoint);
    const h = _v4.subVectors(this.position, app).dot(this.up);
    app.addScaledVector(this.up, h * w.axle.forceHeight);
    const f = fwd.multiplyScalar(to.fx).addScaledVector(side, to.fy);
    this.applyForce(f, app);
  }

  /**
   * Wading: hydrodynamic drag 0.5 * rho * Cd * A * v^2 on each tyre (A = tyre width x
   * depth) and on the submerged body (frontal / side / plan area x depth by direction),
   * applied at the submerged centre so the nose dips when the car hits the water.
   * Water at the air intake chokes the engine. No buoyancy (cars are not watertight).
   */
  private waterPass(): void {
    this.waterDepth = 0;
    const ground = this.ground;
    if (!ground.waterLevel) {
      this.engineWater = 1;
      return;
    }
    const d = this.def;
    let deepest = 0;
    for (const w of this.wheels) {
      if (!w.contact) continue;
      const level = ground.waterLevel(w.contactPoint.x, w.contactPoint.z);
      const depth = Math.min(level - w.contactPoint.y, 2 * w.radius);
      if (!(depth > 0)) continue;
      deepest = Math.max(deepest, depth);
      const r = _w3.subVectors(w.contactPoint, this.position);
      const v = _w4.crossVectors(this.angularVelocity, r).add(this.velocity);
      v.y = 0;
      const k =
        -0.5 *
        WATER_DENSITY *
        WHEEL_WATER_CD *
        d.wheelWidth *
        depth *
        v.length();
      const app = _w2.copy(w.contactPoint);
      app.y += depth / 2;
      this.applyForce(v.multiplyScalar(k), app);
    }
    // Body: underside = lowest hull point (body frame), sampled under the centre.
    const level = ground.waterLevel(this.position.x, this.position.z);
    let bottom = Infinity;
    for (const [, hy, , hr] of this.hull) bottom = Math.min(bottom, hy - hr);
    const underside = this.position.y + this.up.y * bottom;
    const sub = Math.min(level - underside, d.height);
    if (sub > 0) {
      deepest = Math.max(deepest, sub);
      const k = -0.5 * WATER_DENSITY * BODY_WATER_CD * sub;
      const vf = this.velocity.dot(this.forward);
      const vs = this.velocity.dot(this.right);
      const vy = this.velocity.y;
      // Entering from above: the plan area slaps the surface, fading in over 10 cm.
      const plan = (d.width * d.length * Math.min(1, sub / 0.1)) / sub;
      const f = _w1
        .copy(this.forward)
        .multiplyScalar(k * d.width * Math.abs(vf) * vf)
        .addScaledVector(this.right, k * d.length * Math.abs(vs) * vs);
      f.y += k * plan * Math.abs(vy) * vy;
      const app = _w2
        .copy(this.position)
        .addScaledVector(this.up, bottom + sub / 2);
      this.applyForce(f, app);
    }
    this.waterDepth = deepest;
    // Air intake ~45% of the body height above the underside: power fades as it floods.
    const intake = d.height * 0.45;
    this.engineWater =
      sub > 0 ? 1 - 0.8 * smooth01((sub - intake + 0.15) / 0.25) : 1;
  }

  private applyForce(f: Vector3, point: Vector3): void {
    this.force.add(f);
    const r = _v4.subVectors(point, this.position);
    this.torque.x += r.y * f.z - r.z * f.y;
    this.torque.y += r.z * f.x - r.x * f.z;
    this.torque.z += r.x * f.y - r.y * f.x;
  }

  /** Apply world inverse inertia to a world vector, in place. */
  private applyInvInertia(v: Vector3): Vector3 {
    const qInv = _q.copy(this.quaternion).invert();
    v.applyQuaternion(qInv);
    v.x *= this.invInertia.x;
    v.y *= this.invInertia.y;
    v.z *= this.invInertia.z;
    return v.applyQuaternion(this.quaternion);
  }

  private resolveContacts(): void {
    this.impact = 0;
    const s = this.sample;
    const c = new Vector3();
    const n = new Vector3();
    const count =
      this.ground.queryColliders?.(
        this.position.x,
        this.position.z,
        4,
        this.colliders,
      ) ?? 0;
    for (const [hx, hy, hz, hr] of this.hull) {
      c.set(hx, hy, hz).applyQuaternion(this.quaternion).add(this.position);
      // Ground.
      this.ground.sampleGround(c.x, c.z, s, c.y);
      const depth = (s.height - (c.y - hr)) * s.normal.y;
      if (depth > 0) {
        n.copy(s.normal);
        this.contact(c.clone().addScaledVector(n, -hr), n, depth, 0.1, 0.45);
      }
      // Static obstacles.
      for (let i = 0; i < count; i++) {
        const o = this.colliders[i];
        if (o.kind === 'cylinder') {
          if (c.y < o.y - hr || c.y > o.y + o.h + hr) continue;
          const dx = c.x - o.x;
          const dz = c.z - o.z;
          const dist = Math.hypot(dx, dz);
          const pen = o.r + hr - dist;
          if (pen <= 0 || dist < 1e-6) continue;
          n.set(dx / dist, 0, dz / dist);
          this.contact(c.clone().addScaledVector(n, -hr), n, pen, 0.25, 0.3);
        } else if (o.kind === 'box') {
          if (c.y < o.y - hr || c.y > o.y + o.h + hr) continue;
          // Into the box frame (inverse of the yaw), closest point, push out.
          const cs = Math.cos(o.rot ?? 0);
          const sn = Math.sin(o.rot ?? 0);
          const dx = c.x - o.x;
          const dz = c.z - o.z;
          const lx = dx * cs - dz * sn;
          const lz = dx * sn + dz * cs;
          const bx = o.hx ?? 0;
          const bz = o.hz ?? 0;
          const ex = lx - Math.max(-bx, Math.min(bx, lx));
          const ez = lz - Math.max(-bz, Math.min(bz, lz));
          const dist = Math.hypot(ex, ez);
          let nx: number;
          let nz: number;
          let pen: number;
          if (dist > 1e-6) {
            pen = hr - dist;
            if (pen <= 0) continue;
            nx = ex / dist;
            nz = ez / dist;
          } else {
            // Centre inside: leave through the nearest face.
            const fx = bx - Math.abs(lx);
            const fz = bz - Math.abs(lz);
            if (fx < fz) [nx, nz, pen] = [Math.sign(lx) || 1, 0, fx + hr];
            else [nx, nz, pen] = [0, Math.sign(lz) || 1, fz + hr];
          }
          n.set(nx * cs + nz * sn, 0, -nx * sn + nz * cs);
          this.contact(c.clone().addScaledVector(n, -hr), n, pen, 0.2, 0.35);
        } else {
          const dx = c.x - o.x;
          const dy = c.y - o.y;
          const dz = c.z - o.z;
          const dist = Math.hypot(dx, dy, dz);
          const pen = o.r + hr - dist;
          if (pen <= 0 || dist < 1e-6) continue;
          n.set(dx / dist, dy / dist, dz / dist);
          this.contact(c.clone().addScaledVector(n, -hr), n, pen, 0.2, 0.4);
        }
      }
    }
  }

  /** Single impulse contact against a static body + positional correction. */
  private contact(
    point: Vector3,
    n: Vector3,
    depth: number,
    restitution: number,
    friction: number,
  ): void {
    const r = new Vector3().subVectors(point, this.position);
    const vRel = new Vector3()
      .crossVectors(this.angularVelocity, r)
      .add(this.velocity);
    const vn = vRel.dot(n);
    if (vn < 0) {
      const rxn = new Vector3().crossVectors(r, n);
      const k =
        1 / this.mass + this.applyInvInertia(rxn.clone()).cross(r).dot(n);
      const j = (-(1 + (vn < -2 ? restitution : 0)) * vn) / k;
      this.applyImpulse(n.clone().multiplyScalar(j), r);
      this.impact = Math.max(this.impact, j);
      // Coulomb friction.
      const vt = vRel.addScaledVector(n, -vn);
      const vtLen = vt.length();
      if (vtLen > 1e-4) {
        const t = vt.multiplyScalar(1 / vtLen);
        const rxt = new Vector3().crossVectors(r, t);
        const kt = 1 / this.mass + this.applyInvInertia(rxt).cross(r).dot(t);
        const jt = Math.min(vtLen / kt, friction * j);
        this.applyImpulse(t.multiplyScalar(-jt), r);
      }
    }
    // Push out of penetration (static world takes nothing).
    const slop = 0.01;
    if (depth > slop) this.position.addScaledVector(n, (depth - slop) * 0.5);
  }

  private applyImpulse(j: Vector3, r: Vector3): void {
    this.velocity.addScaledVector(j, 1 / this.mass);
    const dw = this.applyInvInertia(new Vector3().crossVectors(r, j));
    this.angularVelocity.add(dw);
  }

  /** Wheel centre in body frame (for rendering). */
  wheelLocalPosition(w: WheelState, out: Vector3): Vector3 {
    return out.set(w.mount.x, w.mount.y - w.ext, w.mount.z);
  }
}

function applyBrake(
  omega: number,
  torque: number,
  inertia: number,
  dt: number,
): number {
  if (torque <= 0) return omega;
  const dw = (torque / inertia) * dt;
  if (Math.abs(omega) <= dw) return 0;
  return omega - Math.sign(omega) * dw;
}

/**
 * Smooth pseudo-random undulation (~2-6 m wavelength) felt by the tyres.
 * Keep wavelengths long: the wheel is a single ray with no unsprung mass, so
 * short bumps at speed turn into huge damper spikes.
 */
function surfaceBump(x: number, z: number, amp: number): number {
  if (amp <= 0) return 0;
  const b =
    Math.sin(x * 1.3 + z * 0.6) * Math.sin(z * 1.1 - x * 0.4) * 0.6 +
    Math.sin(x * 2.3 - z * 1.7) * 0.4;
  return b * amp;
}

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
