import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';

/**
 * Static front share of the weight = |rear.z| / wheelbase (the COM is the body origin, physics/vehicle.ts `buildWheels`).
 * Targets are the real cars' splits; a car whose estimate is inside its error band keeps the split its model came with.
 * Sources: README of each car (cars/<car>/README.md) and THIRD-PARTY.md.
 */
const WEIGHT_FRONT: Record<string, { front: number; tol: number }> = {
  skoda_rally: { front: 0.55, tol: 0.03 },
  zastava_101: { front: 0.62, tol: 0.03 },
  bimmer_m3: { front: 0.512, tol: 0.03 },
  // Published 45 / 55 (engine far back, gearbox at the rear): exact.
  bimmer_gt2: { front: 0.45, tol: 0.005 },
  fiesta: { front: 0.54, tol: 0.03 },
  citroen_c4: { front: 0.54, tol: 0.03 },
  subie_22b: { front: 0.58, tol: 0.03 },
  // WRC build moves weight back from the road car's 58 %: estimate, set exactly.
  lancer_evo_6: { front: 0.55, tol: 0.005 },
};

describe('static weight split', () => {
  test('every car has a target', () => {
    expect(Object.keys(WEIGHT_FRONT).sort()).toEqual(
      ALL_CARS.map((c) => c.id).sort(),
    );
  });

  describe.each(ALL_CARS.map((c) => c.id))('%s', (id) => {
    test('front share matches the real car', () => {
      const p = ALL_CARS.find((c) => c.id === id)!.physics;
      const share = -p.rear.z / (p.front.z - p.rear.z);
      const { front, tol } = WEIGHT_FRONT[id];
      expect(Math.abs(share - front)).toBeLessThanOrEqual(tol);
    });
  });
});
