import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { applySetup } from '../../src/games/rally/physics/car-setup';
import {
  carSurfaces,
  sizeFactors,
  tyreSizeFor,
} from '../../src/games/rally/physics/car-tyres';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import {
  familyOf,
  TYRE_IDS,
  TYRES,
  type TyreId,
} from '../../src/games/rally/physics/tyres';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/** Tyre types (physics/tyres.ts, src/games/rally/PHYSICS.md "Tyre types"): families, hard and soft, grade. */
const DT = 1 / PHYSICS_HZ;
const car = (id: string) => ALL_CARS.find((c) => c.id === id)!.physics;

describe('families and compounds', () => {
  test('the ids keep their saved meaning: tarmac and gravel are the soft compounds', () => {
    expect(TYRES.tarmac.name).toBe('Tarmac Soft');
    expect(TYRES.gravel.name).toBe('Gravel Soft');
    expect(TYRE_IDS).toEqual([
      'tarmac',
      'tarmac_hard',
      'mixed',
      'gravel_hard',
      'gravel',
    ]);
  });

  test('each tyre has a family; sizes follow it, not the compound', () => {
    expect(TYRE_IDS.map(familyOf)).toEqual([
      'tarmac',
      'tarmac',
      'mixed',
      'gravel',
      'gravel',
    ]);
    for (const c of ALL_CARS) {
      expect(tyreSizeFor(c.physics, 'tarmac_hard')).toBe(
        tyreSizeFor(c.physics, 'tarmac'),
      );
      expect(tyreSizeFor(c.physics, 'gravel_hard')).toBe(
        tyreSizeFor(c.physics, 'gravel'),
      );
    }
  });

  test('a hard compound runs warmer and gives up some peak grip on its home ground', () => {
    for (const [soft, hard] of [
      ['tarmac', 'tarmac_hard'],
      ['gravel', 'gravel_hard'],
    ] as const) {
      const s = TYRES[soft];
      const h = TYRES[hard];
      expect(h.temp.lo).toBeGreaterThan(s.temp.lo);
      expect(h.temp.hi).toBeGreaterThan(s.temp.hi);
      expect(h.temp.hot).toBeGreaterThan(s.temp.hot); // overheating costs it less
    }
    expect(TYRES.tarmac_hard.grip.tarmac).toBeLessThan(
      TYRES.tarmac.grip.tarmac,
    );
  });
});

describe('tyre grade (road tyre, rally tyre, slick)', () => {
  test('grade scales hard-ground grip fully and loose-ground grip by 40 % of the difference', () => {
    const base = { width: 0.245, aspect: 40, rim: 18 };
    const rally = sizeFactors(base);
    const road = sizeFactors({ ...base, grade: 0.8 });
    expect(road.hard / rally.hard).toBeCloseTo(0.8, 5);
    expect(road.loose / rally.loose).toBeCloseTo(1 - 0.2 * 0.4, 5);
    expect(sizeFactors({ ...base, grade: 1 }).hard).toBe(rally.hard);
  });

  test('a rally car on rally tarmac tyres out-grips the road-tyre M3; the GT2 slicks out-grip both', () => {
    const mu = (id: string, tyre: TyreId, s: SurfaceId) =>
      carSurfaces(applySetup(car(id), 'stiff'), tyre, 'front')[s].mu;
    expect(mu('skoda_rally', 'tarmac', 'tarmac')).toBeGreaterThan(
      mu('bimmer_m3', 'tarmac', 'tarmac'),
    );
    expect(mu('bimmer_gt2', 'tarmac', 'tarmac')).toBeGreaterThan(
      mu('skoda_rally', 'tarmac', 'tarmac'),
    );
    // On loose ground the soil sets the grip: the road tyre loses far less there.
    const lossTarmac =
      mu('bimmer_m3', 'mixed', 'tarmac') / mu('skoda_rally', 'mixed', 'tarmac');
    const lossLoose =
      mu('bimmer_m3', 'gravel', 'gravel_loose') /
      mu('skoda_rally', 'gravel', 'gravel_loose');
    expect(lossLoose).toBeGreaterThan(lossTarmac);
  });

  test('both axles of a car share the grade (the balance does not come from it)', () => {
    for (const c of ALL_CARS) {
      const p = c.physics;
      const rear = p.tyres.rear ?? p.tyres;
      expect(rear.size.grade ?? 1).toBe(p.tyres.size.grade ?? 1);
    }
  });
});

describe('weight and axle grip', () => {
  test('the M3 weighs what the real car does, with its springs scaled to keep the ride', () => {
    expect(car('bimmer_m3').mass).toBeGreaterThan(1650);
    expect(car('bimmer_m3').mass).toBeLessThan(1710);
  });
});
