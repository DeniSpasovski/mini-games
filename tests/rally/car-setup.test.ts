import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  applySetup,
  compliance,
  dampingRatio,
  SETUP_FOR_TYRE,
  SETUP_IDS,
} from '../../src/games/rally/physics/car-setup';
import {
  carGripRating,
  carSurfaces,
  tyreRadius,
  tyreSizeFor,
} from '../../src/games/rally/physics/car-tyres';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import { TYRE_IDS, type TyreId } from '../../src/games/rally/physics/tyres';
import type {
  CarPhysicsDef,
  GroundProvider,
  GroundSample,
  SetupId,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/** Tyre sizes + suspension set-ups per car (physics/car-tyres.ts, physics/car-setup.ts, src/games/rally/PHYSICS.md). */
const DT = 1 / PHYSICS_HZ;
const car = (id: string) => ALL_CARS.find((c) => c.id === id)!.physics;

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  const def = car(carId);

  test('every tyre size matches the physics wheel radius and width', () => {
    for (const t of TYRE_IDS) {
      const size = tyreSizeFor(def, t);
      expect(Math.abs(tyreRadius(size) / def.wheelRadius - 1)).toBeLessThan(
        0.04,
      );
      expect(Math.abs(size.width - def.wheelWidth)).toBeLessThan(0.05);
    }
  });

  test('every preset has sane damping and the active one equals the base axles', () => {
    for (const id of SETUP_IDS) {
      const d = applySetup(def, id);
      for (const front of [true, false]) {
        const z = dampingRatio(d, front);
        expect(z.bump).toBeGreaterThan(0.25);
        expect(z.bump).toBeLessThan(0.8);
        expect(z.rebound).toBeGreaterThan(0.25);
        expect(z.rebound).toBeLessThan(0.8);
        // Rebound stiffer than bump, like real dampers.
        expect(z.rebound).toBeGreaterThan(z.bump);
      }
    }
    const base = applySetup(def, def.setup);
    for (const k of ['front', 'rear'] as const) {
      expect(base[k].spring).toBe(def[k].spring);
      expect(base[k].travel).toBe(def[k].travel);
      expect(base[k].bump).toBeCloseTo(def[k].bump, -1);
      expect(base[k].antiRoll).toBeCloseTo(def[k].antiRoll, -2);
    }
  });

  test('each set-up sits at its own ride height (softer = higher), whatever its springs', () => {
    const rest = (d: CarPhysicsDef) => {
      const v = new Vehicle(d, flat('tarmac'));
      v.reset(new Vector3(), 0);
      for (let i = 0; i < 3 * PHYSICS_HZ; i++) v.step(DT);
      return v.position.y;
    };
    for (const id of SETUP_IDS) {
      const d = applySetup(def, id);
      expect(d.rideHeight).toBe(def.setups[id].ride);
      // What the car model draws: the body sits at the standard height (-comHeight under the COM), the wheels where
      // the physics puts them - so the wheel centres hang `ride` lower in model space (the body looks lifted).
      const v = new Vehicle(d, flat('tarmac'));
      v.reset(new Vector3(), 0);
      for (let i = 0; i < 3 * PHYSICS_HZ; i++) v.step(DT);
      const local = v.wheelLocalPosition(v.wheels[0], new Vector3());
      expect(local.y + def.comHeight).toBeCloseTo(
        def.wheelRadius - d.rideHeight!,
        1,
      );
      expect(Math.abs(rest(d) - (def.comHeight + d.rideHeight!))).toBeLessThan(
        0.02,
      );
    }
    // Soft rides highest, stiff lowest; at most a few cm either way (HANDLING-REVIEW.md task 6c).
    const ride = (id: SetupId) => def.setups[id].ride;
    expect(ride('soft')).toBeGreaterThanOrEqual(ride('medium'));
    expect(ride('medium')).toBeGreaterThanOrEqual(ride('stiff'));
    expect(ride('soft')).toBeGreaterThan(ride('stiff'));
    for (const id of SETUP_IDS) expect(Math.abs(ride(id))).toBeLessThan(0.05);
  });
});

test('compliance per car: rally car spans the range, road car soft, race car stiff', () => {
  const c = (id: string, s: SetupId) => compliance(applySetup(car(id), s));
  // Fabia: full range, gravel-soft to tarmac-stiff.
  expect(c('skoda_rally', 'soft')).toBeGreaterThan(0.9);
  expect(c('skoda_rally', 'stiff')).toBeLessThan(0.1);
  expect(
    c('skoda_rally', 'soft') - c('skoda_rally', 'stiff'),
  ).toBeGreaterThan(0.8);
  // Zastava: only the soft half. Bimmer: only the stiff half. Narrow bands.
  expect(c('zastava_101', 'soft') - c('zastava_101', 'stiff')).toBeLessThan(
    0.5,
  );
  expect(c('zastava_101', 'stiff')).toBeGreaterThan(0.4);
  expect(c('bimmer_m3', 'soft') - c('bimmer_m3', 'stiff')).toBeLessThan(0.5);
  expect(c('bimmer_m3', 'soft')).toBeLessThan(0.5);
  // Ordered soft > medium > stiff on every car.
  for (const id of ['skoda_rally', 'zastava_101', 'bimmer_m3']) {
    expect(c(id, 'soft')).toBeGreaterThan(c(id, 'medium'));
    expect(c(id, 'medium')).toBeGreaterThan(c(id, 'stiff'));
  }
});

test('tyre size: width is grip on tarmac, plough on gravel; thin tyres have less grip everywhere', () => {
  const fabia = car('skoda_rally');
  const wide = {
    ...fabia,
    tyres: { size: { width: 0.3, aspect: 38, rim: 18 } },
  };
  const thin = {
    ...fabia,
    tyres: { size: { width: 0.145, aspect: 80, rim: 13 } },
  };
  const mu = (d: CarPhysicsDef, s: SurfaceId) => carSurfaces(d, 'mixed')[s].mu;
  expect(mu(wide, 'tarmac')).toBeGreaterThan(mu(fabia, 'tarmac'));
  expect(mu(wide, 'gravel')).toBeLessThan(mu(fabia, 'gravel'));
  expect(mu(thin, 'tarmac')).toBeLessThan(mu(fabia, 'tarmac'));
  expect(mu(thin, 'gravel')).toBeLessThan(mu(fabia, 'gravel'));
  // ...and thin tyres lose least on loose ground.
  expect(mu(thin, 'gravel') / mu(fabia, 'gravel')).toBeGreaterThan(
    mu(thin, 'tarmac') / mu(fabia, 'tarmac'),
  );
  // The wide tyre ploughs: more rolling resistance on gravel, none on tarmac.
  expect(carSurfaces(wide, 'mixed').gravel.rolling).toBeGreaterThan(
    carSurfaces(fabia, 'mixed').gravel.rolling,
  );
});

test('a soft set-up gains on rough ground, a stiff one on tarmac', () => {
  const fabia = car('skoda_rally');
  const soft = applySetup(fabia, 'soft');
  const stiff = applySetup(fabia, 'stiff');
  const mu = (d: CarPhysicsDef, s: SurfaceId) => carSurfaces(d, 'mixed')[s].mu;
  expect(mu(soft, 'gravel')).toBeGreaterThan(mu(stiff, 'gravel'));
  expect(mu(soft, 'rock')).toBeGreaterThan(mu(stiff, 'rock'));
  expect(mu(stiff, 'tarmac')).toBeGreaterThan(mu(soft, 'tarmac'));
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

/** Steady cornering (same method as vehicle.test.ts): lateral g at 60 km/h, 0.7 steer. */
function lateralG(
  def: CarPhysicsDef,
  tyre: TyreId,
  setup: SetupId,
  surface: SurfaceId,
): number {
  const v = new Vehicle(applySetup(def, setup), flat(surface));
  v.setTyre(tyre);
  v.reset(new Vector3(), 0);
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
  v.controls.throttle = 1;
  for (let i = 0; i < 20 * PHYSICS_HZ && v.speed * 3.6 < 60; i++) v.step(DT);
  v.controls.throttle = 0.45;
  v.controls.steer = 0.7;
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
  let sum = 0;
  for (let i = 0; i < PHYSICS_HZ; i++) {
    v.step(DT);
    sum += Math.abs(v.velocity.length() * v.angularVelocity.y);
  }
  return sum / PHYSICS_HZ / 9.81;
}

test('cars on their own best tyres + set-up: Bimmer wins on tarmac, Fabia on gravel; Zastava has the least grip', () => {
  const g = (id: string, t: TyreId, s: SurfaceId) =>
    lateralG(car(id), t, SETUP_FOR_TYRE[t], s);
  const row = (id: string) => ({
    tarmac: g(id, 'tarmac', 'tarmac'),
    gravel: g(id, 'gravel', 'gravel'),
  });
  const fabia = row('skoda_rally');
  const bimmer = row('bimmer_m3');
  const zastava = row('zastava_101');
  console.info(
    `lateral g  tarmac tyres on tarmac / gravel tyres on gravel\n  fabia ${fabia.tarmac.toFixed(2)} / ${fabia.gravel.toFixed(2)}\n  bimmer ${bimmer.tarmac.toFixed(2)} / ${bimmer.gravel.toFixed(2)}\n  zastava ${zastava.tarmac.toFixed(2)} / ${zastava.gravel.toFixed(2)}`,
  );
  expect(bimmer.tarmac).toBeGreaterThan(fabia.tarmac);
  expect(fabia.gravel).toBeGreaterThan(bimmer.gravel);
  expect(zastava.tarmac).toBeLessThan(fabia.tarmac);
  expect(zastava.gravel).toBeLessThan(fabia.gravel);
});

test('straight-line launch on loose ground: every car gets to 100 km/h pointing straight (gravel tyres, soft set-up)', () => {
  // Full throttle, no steering, TC on (default). Catches a RWD car losing its rear bias: the Bimmer at rear.grip 1.15
  // spun up on gravel_loose / dirt and never reached 100 km/h (the autopilot tests can't see it - the autopilot lifts
  // off when the car slides). Above ~90 km/h on loose ground the Bimmer still starts a slow fishtail with no counter-
  // steer - RWD V8 character, the player catches it - so the heading is checked at the moment it reaches 100 km/h.
  for (const c of ALL_CARS) {
    for (const s of ['gravel', 'gravel_loose', 'dirt'] as SurfaceId[]) {
      const v = new Vehicle(applySetup(c.physics, 'soft'), flat(s));
      v.setTyre('gravel');
      v.reset(new Vector3(), 0);
      for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
      v.controls.throttle = 1;
      let t100 = Infinity;
      let heading = 0;
      for (let i = 0; i < 20 * PHYSICS_HZ && t100 === Infinity; i++) {
        v.step(DT);
        if (v.speed * 3.6 >= 100) {
          t100 = i * DT;
          heading = Math.atan2(v.forward.x, v.forward.z);
        }
      }
      console.info(
        `${c.id} on ${s}: 0-100 ${t100.toFixed(1)} s, heading at 100 km/h ${((heading * 180) / Math.PI).toFixed(0)} deg`,
      );
      // The ~85 hp Zastava is slow by design (0-100 ~12-14 s on loose gravel, band in vehicle.test.ts); this test is about
      // getting there pointing straight.
      expect(t100).toBeLessThan(c.id === 'zastava_101' ? 16 : 8);
      expect(Math.abs(heading)).toBeLessThan((30 * Math.PI) / 180);
    }
  }
});

test('grip chips are per car: the Bimmer on gravel tyres is honest about gravel', () => {
  const bimmer = applySetup(car('bimmer_m3'), 'soft');
  const fabia = applySetup(car('skoda_rally'), 'soft');
  // Gravel tyres are the best compound on gravel for both cars.
  expect(carGripRating(fabia, 'gravel', 'gravel')).toBe(3);
  expect(carGripRating(bimmer, 'gravel', 'gravel')).toBe(3);
  expect(carGripRating(fabia, 'tarmac', 'gravel')).toBeLessThanOrEqual(1);
});
