import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Vehicle } from '../../src/games/rally/physics/vehicle';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';

const flat: GroundProvider = {
  sampleGround(_x: number, _z: number, out: GroundSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = SURFACES.tarmac;
    return out;
  },
  queryColliders: () => 0,
};

/**
 * Each car carries its own moments of inertia (`CarPhysicsDef.inertia`, PHYSICS.md "Inertia"). Radii of gyration of road and
 * race cars sit in these bands: mass low and in the middle, a bit more spread along the car than across it.
 */
describe.each(ALL_CARS.map((c) => c.id))('%s', (id) => {
  const p = ALL_CARS.find((c) => c.id === id)!.physics;
  const k = (i: number) => Math.sqrt(i / p.mass);

  test('radii of gyration are plausible', () => {
    expect(k(p.inertia.pitch)).toBeGreaterThan(1.1);
    expect(k(p.inertia.pitch)).toBeLessThan(1.4);
    expect(k(p.inertia.yaw)).toBeGreaterThan(1.15);
    expect(k(p.inertia.yaw)).toBeLessThan(1.45);
    expect(k(p.inertia.yaw)).toBeGreaterThanOrEqual(k(p.inertia.pitch));
    expect(k(p.inertia.roll)).toBeGreaterThan(0.5);
    expect(k(p.inertia.roll)).toBeLessThan(0.7);
  });

  test('the vehicle uses them', () => {
    const v = new Vehicle(p, flat);
    expect([v.inertia.x, v.inertia.y, v.inertia.z]).toEqual([
      p.inertia.pitch,
      p.inertia.yaw,
      p.inertia.roll,
    ]);
  });
});
