import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import type { GroundProvider } from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

const flat = (surface: SurfaceId): GroundProvider => ({
  sampleGround(_x, _z, out) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = SURFACES[surface];
    return out;
  },
});

/** Full brake + half steer from 80 km/h: stopping distance (m), heading turned (deg), any wheel locked above 15 km/h. */
function brakeAndSteer(car: string, surface: SurfaceId, abs: boolean) {
  const v = new Vehicle(
    ALL_CARS.find((c) => c.id === car)!.physics,
    flat(surface),
  );
  v.abs = abs;
  v.reset(new Vector3(), 0);
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(1 / PHYSICS_HZ);
  const V = 80 / 3.6;
  v.velocity.copy(v.forward).multiplyScalar(V);
  for (const w of v.wheels) w.omega = V / w.radius;
  v.holding = false;
  const start = v.position.clone();
  let locked = false;
  for (let i = 0; i < 10 * PHYSICS_HZ && v.speed > 0.5; i++) {
    v.controls.throttle = 0;
    v.controls.brake = 1;
    v.controls.steer = 0.5;
    v.step(1 / PHYSICS_HZ);
    if (
      v.speed > 15 / 3.6 &&
      v.wheels.some((w) => w.contact && w.slipRatio < -0.6)
    )
      locked = true;
  }
  const turned =
    Math.abs(Math.atan2(v.forward.x, v.forward.z)) / (Math.PI / 180);
  return { dist: v.position.distanceTo(start), turned, locked };
}

describe('ABS', () => {
  for (const surface of ['tarmac', 'gravel'] as const)
    test(`keeps the fronts steering under full brake (${surface})`, () => {
      const on = brakeAndSteer('skoda_rally', surface, true);
      const off = brakeAndSteer('skoda_rally', surface, false);
      expect(off.locked).toBe(true);
      expect(on.locked).toBe(false);
      expect(on.turned).toBeGreaterThan(off.turned * 2);
    });

  test('a car without ABS (Zastava) ignores the setting', () => {
    const on = brakeAndSteer('zastava_101', 'tarmac', true);
    const off = brakeAndSteer('zastava_101', 'tarmac', false);
    expect(on.locked).toBe(true);
    expect(on.dist).toBeCloseTo(off.dist, 3);
  });
});
