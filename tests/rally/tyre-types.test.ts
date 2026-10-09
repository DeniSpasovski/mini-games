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

/** Tyre types (physics/tyres.ts, src/games/rally/PHYSICS.md "Tyre types"): families, hard and soft, grade, traction control. */
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

  test('a hard compound runs warmer, heats slower and gives up some peak grip on its home ground', () => {
    for (const [soft, hard] of [
      ['tarmac', 'tarmac_hard'],
      ['gravel', 'gravel_hard'],
    ] as const) {
      const s = TYRES[soft];
      const h = TYRES[hard];
      expect(h.temp.lo).toBeGreaterThan(s.temp.lo);
      expect(h.temp.hi).toBeGreaterThan(s.temp.hi);
      expect(h.temp.hot).toBeGreaterThan(s.temp.hot); // overheating costs it less
      expect(h.heat).toBeLessThan(s.heat);
      expect(h.loadSens).toBeLessThanOrEqual(s.loadSens);
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

  test('the M3 and GT2 balance comes from weight, tyre stagger and set-up, not from an axle grip multiplier', () => {
    for (const id of ['bimmer_m3', 'bimmer_gt2']) {
      expect(car(id).front.grip, id).toBe(1);
      expect(car(id).rear.grip, id).toBe(1);
    }
  });
});

function flat(surface: SurfaceId): GroundProvider {
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

describe('traction control (traction term)', () => {
  test.each(['bimmer_m3', 'bimmer_gt2'])(
    '%s launches on loose ground with the driven wheels held under the surface peak slip',
    (id) => {
      const v = new Vehicle(applySetup(car(id), 'soft'), flat('gravel_loose'));
      v.setTyre('gravel');
      v.reset(new Vector3(), 0);
      for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
      v.controls.throttle = 1;
      let worst = 0;
      for (let i = 0; i < 4 * PHYSICS_HZ; i++) {
        v.step(DT);
        for (const w of v.wheels)
          if (w.driven && w.contact && v.speed > 3)
            worst = Math.max(worst, Math.abs(w.slipRatio) / w.surface.peakSlip);
      }
      expect(worst).toBeLessThan(0.9);
      expect(Math.abs(v.position.x)).toBeLessThan(1);
    },
  );

  test('with TC off the same launch spins the rear past the peak', () => {
    const v = new Vehicle(
      applySetup(car('bimmer_m3'), 'soft'),
      flat('gravel_loose'),
    );
    v.setTyre('gravel');
    v.tractionControl = false;
    v.reset(new Vector3(), 0);
    for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
    v.controls.throttle = 1;
    let worst = 0;
    for (let i = 0; i < 3 * PHYSICS_HZ; i++) {
      v.step(DT);
      for (const w of v.wheels)
        if (w.driven && w.contact)
          worst = Math.max(worst, Math.abs(w.slipRatio) / w.surface.peakSlip);
    }
    expect(worst).toBeGreaterThan(1);
  });

  test('engine braking on a driven wheel is not wheelspin: the trim recovers (it used to lock at its floor)', () => {
    // After the launch spike the trim sat at its floor, the closed-throttle engine braking read as slip (|slip ratio|) and
    // held it there, so the autopilot's M3 and GT2 crept to a halt on the test map's first slope.
    const v = new Vehicle(applySetup(car('bimmer_m3'), 'soft'), flat('gravel'));
    v.reset(new Vector3(), 0);
    for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
    const assist = (dt: number): number =>
      (v as unknown as { tractionAssist(dt: number): number }).tractionAssist(
        dt,
      );
    const hold = (slip: number) => {
      for (const w of v.wheels) w.slipRatio = w.driven ? slip : 0;
    };
    hold(-0.15);
    let f = 0.08;
    (v as unknown as { tcFactor: number }).tcFactor = f;
    for (let i = 0; i < 60; i++) f = assist(DT);
    expect(f).toBeGreaterThan(0.9);
    hold(0.5); // real wheelspin still cuts
    for (let i = 0; i < 60; i++) f = assist(DT);
    expect(f).toBeLessThan(0.3);
  });
});
