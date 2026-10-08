import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
  StaticCollider,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/**
 * Handling regression tests. They drive the real Vehicle on a flat plane and
 * check that the numbers stay in a plausible band. When you retune a car and a
 * test fails, decide whether the new behaviour is intended and adjust the band.
 */

const DT = 1 / PHYSICS_HZ;

function flatGround(
  surface: SurfaceId = 'gravel',
  colliders: StaticCollider[] = [],
): GroundProvider {
  return {
    sampleGround(_x: number, _z: number, out: GroundSample) {
      out.height = 0;
      out.normal.set(0, 1, 0);
      out.surface = SURFACES[surface];
      return out;
    },
    queryColliders(_x, _z, _r, out) {
      colliders.forEach((c, i) => (out[i] = c));
      return colliders.length;
    },
  };
}

function makeCar(carId = 'skoda_rally', ground = flatGround()): Vehicle {
  const v = new Vehicle(ALL_CARS.find((c) => c.id === carId)!.physics, ground);
  v.reset(new Vector3(0, 0, 0), 0);
  run(v, 2); // settle
  return v;
}

function run(
  v: Vehicle,
  seconds: number,
  each?: (t: number) => boolean | void,
): number {
  const steps = Math.round(seconds * PHYSICS_HZ);
  for (let i = 0; i < steps; i++) {
    v.step(DT);
    if (each?.(i * DT)) return i * DT;
  }
  return seconds;
}

const kmh = (v: Vehicle) => v.speed * 3.6;

/** Plausible performance bands per car: [min, max]. Adjust deliberately when retuning. */
const BANDS: Record<
  string,
  {
    zeroTo100: [number, number];
    brake100: [number, number];
    top: [number, number];
  }
> = {
  skoda_rally: { zeroTo100: [3, 10], brake100: [25, 75], top: [130, 230] },
  zastava_101: { zeroTo100: [6, 16], brake100: [25, 80], top: [130, 200] },
  bimmer_m3: { zeroTo100: [3, 10], brake100: [25, 75], top: [150, 290] },
  bimmer_gt2: { zeroTo100: [3, 10], brake100: [25, 75], top: [150, 290] },
  fiesta: { zeroTo100: [3, 10], brake100: [25, 75], top: [130, 230] },
};

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  const band = BANDS[carId];
  test('settles at rest at ride height', () => {
    const v = makeCar(carId);
    run(v, 2);
    expect(v.velocity.length()).toBeLessThan(0.05);
    expect(v.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(v.position.y - v.def.comHeight)).toBeLessThan(0.04);
    expect(v.up.y).toBeGreaterThan(0.999);
  });

  test('accelerates 0-100 km/h in a plausible time on gravel', () => {
    const v = makeCar(carId);
    v.controls.throttle = 1;
    const t = run(v, 15, () => kmh(v) >= 100);
    console.info(
      `[${carId}] 0-100 gravel: ${t.toFixed(2)}s, gear ${v.drivetrain.gear}`,
    );
    expect(t).toBeGreaterThan(band.zeroTo100[0]);
    expect(t).toBeLessThan(band.zeroTo100[1]);
    expect(Math.abs(v.position.x)).toBeLessThan(1.5); // tracks straight
  });

  test('brakes from 100 km/h in a reasonable distance', () => {
    const v = makeCar(carId);
    v.controls.throttle = 1;
    run(v, 15, () => kmh(v) >= 100);
    v.controls.throttle = 0;
    v.controls.brake = 1;
    const z0 = v.position.z;
    run(v, 10, () => kmh(v) < 1);
    const dist = v.position.z - z0;
    console.info(`[${carId}] 100-0 gravel: ${dist.toFixed(1)}m`);
    expect(dist).toBeGreaterThan(band.brake100[0]);
    expect(dist).toBeLessThan(band.brake100[1]);
    expect(v.up.y).toBeGreaterThan(0.95);
  });

  test('turns right when steering right and stays upright', () => {
    const v = makeCar(carId);
    v.controls.throttle = 1;
    run(v, 15, () => kmh(v) >= 60);
    v.controls.throttle = 0.35;
    v.controls.steer = 0.5;
    let minUp = 1;
    run(v, 3, () => {
      minUp = Math.min(minUp, v.up.y);
    });
    // Heading 0 = +Z; turning right rotates forward towards -X.
    expect(v.forward.x).toBeLessThan(-0.3);
    expect(minUp).toBeGreaterThan(0.9);
  });

  test('handbrake locks the rear wheels only', () => {
    const v = makeCar(carId);
    v.controls.throttle = 1;
    run(v, 15, () => kmh(v) >= 50);
    v.controls.throttle = 0;
    v.controls.handbrake = 1;
    run(v, 0.4);
    const [fl, , rl, rr] = v.wheels;
    expect(Math.abs(rl.omega)).toBeLessThan(0.5);
    expect(Math.abs(rr.omega)).toBeLessThan(0.5);
    expect(fl.omega).toBeGreaterThan(10);
  });

  test('holding brake at standstill reverses', () => {
    const v = makeCar(carId);
    v.controls.brake = 1;
    run(v, 3);
    expect(v.drivetrain.gear).toBe(-1);
    expect(v.speed).toBeLessThan(-1);
  });

  test('has a sane top speed', () => {
    const v = makeCar(carId);
    v.controls.throttle = 1;
    run(v, 40);
    console.info(`[${carId}] top speed after 40s: ${kmh(v).toFixed(0)} km/h`);
    expect(kmh(v)).toBeGreaterThan(band.top[0]);
    expect(kmh(v)).toBeLessThan(band.top[1]);
  });
});

test('a tree is solid', () => {
  const tree: StaticCollider = {
    kind: 'cylinder',
    x: 0,
    y: -1,
    z: 30,
    r: 0.35,
    h: 8,
  };
  const v = makeCar('skoda_rally', flatGround('gravel', [tree]));
  v.controls.throttle = 1;
  let maxImpact = 0;
  let minDist = Infinity;
  run(v, 5, () => {
    maxImpact = Math.max(maxImpact, v.impact);
    minDist = Math.min(minDist, Math.hypot(v.position.x, v.position.z - 30));
  });
  expect(maxImpact).toBeGreaterThan(1000);
  // Body centre never gets closer than (roughly) the front overhang.
  expect(minDist).toBeGreaterThan(1.2);
});

test('grip ranks tarmac > gravel > grass (lateral g at the limit)', () => {
  // Steady-state cornering: average centripetal acceleration (v * yaw rate)
  // over the last second of a constant-input turn.
  const peakG = (surf: SurfaceId) => {
    const v = makeCar('skoda_rally', flatGround(surf));
    v.controls.throttle = 1;
    run(v, 15, () => kmh(v) >= 60);
    v.controls.throttle = 0.45;
    v.controls.steer = 0.7;
    run(v, 2);
    let sum = 0;
    let n = 0;
    run(v, 1, () => {
      sum += Math.abs(v.velocity.length() * v.angularVelocity.y);
      n++;
    });
    return sum / n / 9.81;
  };
  const tarmac = peakG('tarmac');
  const gravel = peakG('gravel');
  const grass = peakG('grass');
  console.info(
    `peak lateral g  tarmac ${tarmac.toFixed(2)}  gravel ${gravel.toFixed(2)}  grass ${grass.toFixed(2)}`,
  );
  expect(tarmac).toBeGreaterThan(gravel);
  expect(gravel).toBeGreaterThan(grass);
});

test('auto-hold: no roll-back on a slope, released by throttle', () => {
  const slope = 0.12; // uphill towards +Z
  const ground: GroundProvider = {
    sampleGround(_x, z, out) {
      out.height = z * slope;
      out.normal.set(0, 1, -slope).normalize();
      out.surface = SURFACES.gravel;
      return out;
    },
  };
  const v = new Vehicle(
    ALL_CARS.find((c) => c.id === 'skoda_rally')!.physics,
    ground,
  );
  v.reset(new Vector3(0, 0, 0), 0);
  run(v, 3);
  const z0 = v.position.z;
  run(v, 3);
  expect(v.holding).toBe(true);
  expect(Math.abs(v.position.z - z0)).toBeLessThan(0.05);
  v.controls.throttle = 0.6;
  run(v, 2);
  expect(v.holding).toBe(false);
  expect(v.position.z - z0).toBeGreaterThan(2);
});
