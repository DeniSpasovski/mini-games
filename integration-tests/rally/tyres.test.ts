import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { stageClimate } from '../../src/games/rally/maps/shared/climate';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import {
  TYRE_IDS,
  TYRE_SURFACES,
  TYRES,
  type TyreId,
} from '../../src/games/rally/physics/tyres';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';

/**
 * Tyre compounds (physics/tyres.ts, design in src/games/rally/PHYSICS.md): ranks, not exact numbers.
 */
const DT = 1 / PHYSICS_HZ;
const fabia = ALL_CARS.find((c) => c.id === 'skoda_rally')!;

function flatGround(surface: SurfaceId): GroundProvider {
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

/** Steady-state cornering (same method as vehicle.test.ts): lateral g at 60 km/h, 0.7 steer. */
function lateralG(tyre: TyreId, surface: SurfaceId): number {
  const v = new Vehicle(
    applySetup(fabia.physics, SETUP_FOR_TYRE[tyre]),
    flatGround(surface),
  );
  v.setTyre(tyre);
  v.reset(new Vector3(), 0);
  for (let i = 0; i < 2 * PHYSICS_HZ; i++) v.step(DT);
  v.controls.throttle = 1;
  for (let i = 0; i < 15 * PHYSICS_HZ && v.speed * 3.6 < 60; i++) v.step(DT);
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

describe('tyre data', () => {
  test('every tyre covers every surface with sane numbers', () => {
    for (const id of TYRE_IDS) {
      for (const s of Object.keys(SURFACES) as SurfaceId[]) {
        expect(TYRES[id].grip[s]).toBeGreaterThan(0);
        const e = TYRE_SURFACES[id][s];
        expect(e.id).toBe(s);
        expect(e.mu).toBeGreaterThan(0.2);
        expect(e.slide).toBeLessThanOrEqual(0.95);
        expect(e.loose).toBe(SURFACES[s].loose);
        expect(e.dust).toBe(SURFACES[s].dust);
      }
    }
  });

  test('every map recommends a known tyre', () => {
    for (const m of [testMap, petralicaMap, jackieMap])
      expect(TYRE_IDS).toContain(m.tyre);
  });
});

test('the right kind of tyre grips best on its home surface; mixed is never best nor worst there', () => {
  // Soft or hard of the home family: they sit within a few percent of each other (temperature tells them apart).
  const home: [SurfaceId, TyreId[]][] = [
    ['tarmac', ['tarmac', 'tarmac_hard']],
    ['tarmac_gravel', ['mixed']],
    ['gravel', ['gravel', 'gravel_hard']],
  ];
  const rows: string[] = [];
  for (const [surface, best] of home) {
    const g = Object.fromEntries(
      TYRE_IDS.map((t) => [t, lateralG(t, surface)]),
    ) as Record<TyreId, number>;
    rows.push(
      `${surface}: ${TYRE_IDS.map((t) => `${t} ${g[t].toFixed(2)}g`).join('  ')}`,
    );
    const bestG = Math.max(...best.map((t) => g[t]));
    for (const t of TYRE_IDS)
      if (!best.includes(t)) expect(bestG).toBeGreaterThan(g[t]);
  }
  // Mixed: never the best on clean tarmac / gravel, never the worst on any of them.
  for (const surface of ['tarmac', 'gravel', 'gravel_loose'] as SurfaceId[]) {
    const g = Object.fromEntries(
      TYRE_IDS.map((t) => [t, lateralG(t, surface)]),
    ) as Record<TyreId, number>;
    expect(g.mixed).toBeGreaterThan(Math.min(g.tarmac, g.gravel));
    if (surface !== 'gravel_loose')
      expect(g.mixed).toBeLessThan(Math.max(g.tarmac, g.gravel));
  }
  console.info(`lateral g by tyre\n  ${rows.join('\n  ')}`);
});

test('the wrong tyre is a clear penalty, the right one a modest bonus', () => {
  // vs mixed (the reference): right tyre +3..+25 %, wrong tyre at least -8 %.
  const tarmacOnTarmac =
    lateralG('tarmac', 'tarmac') / lateralG('mixed', 'tarmac');
  expect(tarmacOnTarmac).toBeGreaterThan(1.03);
  expect(tarmacOnTarmac).toBeLessThan(1.25);
  const tarmacOnGravel =
    lateralG('tarmac', 'gravel') / lateralG('mixed', 'gravel');
  expect(tarmacOnGravel).toBeLessThan(0.8);
  const gravelOnTarmac =
    lateralG('gravel', 'tarmac') / lateralG('mixed', 'tarmac');
  expect(gravelOnTarmac).toBeLessThan(0.92);
});

/**
 * Autopilot, Fabia on one tyre with its matching set-up (gravel soft ... tarmac stiff), one stage, tyre temperatures on
 * (the stage's climate, as in game): time, how far it got and the worst tilt.
 */
function driveStage(world: World, tyre: TyreId, extraGrip = false) {
  const v = new Vehicle(applySetup(fabia.physics, SETUP_FOR_TYRE[tyre]), world);
  v.setTyre(tyre);
  v.setClimate(stageClimate(world.map.environment));
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  const ap = new Autopilot(world.road);
  ap.useExtraGrip = extraGrip;
  ap.reset(world.stage.start - 9);
  const limit = Math.max(240, (world.stage.finish - world.stage.start) / 6);
  let t = 0;
  let minUp = 1;
  let stuck = 0;
  while (t < limit && ap.along < world.stage.finish) {
    ap.drive(v, v.controls);
    v.step(DT);
    t += DT;
    minUp = Math.min(minUp, v.up.y);
    stuck = Math.abs(v.speed) < 0.5 ? stuck + DT : 0;
    if (stuck > 5) break;
  }
  return { t, along: ap.along, minUp };
}

type StageRun = Record<TyreId, ReturnType<typeof driveStage>>;
const runAll = (world: World, extraGrip: boolean): StageRun =>
  Object.fromEntries(
    TYRE_IDS.map((t) => [t, driveStage(world, t, extraGrip)]),
  ) as StageRun;
const report = (mapId: string, label: string, r: StageRun) =>
  console.info(
    `[${mapId}] ${label}: ${TYRE_IDS.map((t) => `${t} ${r[t].t.toFixed(1)}s`).join('  ')}`,
  );

/**
 * Two drivers per stage:
 *  - careful (default autopilot): never corners above the gravel-grade baseline, so it only slows down
 *    for a wrong tyre. Proves every tyre can finish every stage upright - a wrong pick must stay fun.
 *  - limit (`useExtraGrip`): corner / braking speed follows the tyre's grip, so a grippier tyre is
 *    actually driven faster. Proves what a tyre is worth over a whole stage, which the careful driver
 *    cannot show (it ties on tarmac).
 */
const STAGES: MapDef[] = [testMap, petralicaMap, jackieMap, ajvatovciMap];
describe.each(STAGES.map((m) => m.id))(
  'stage %s',
  (mapId) => {
    const map = STAGES.find((m) => m.id === mapId)!;
    const world = new World(map);
    const careful = runAll(world, false);
    const limit = runAll(world, true);
    report(mapId, `recommended ${map.tyre}, careful`, careful);
    report(mapId, `recommended ${map.tyre}, limit`, limit);

    test('careful driver: every tyre finishes upright', () => {
      for (const t of TYRE_IDS) {
        expect(careful[t].along).toBeGreaterThanOrEqual(world.stage.finish);
        expect(careful[t].minUp).toBeGreaterThan(0.5);
      }
    });

    test('limit driver: every tyre finishes upright, the recommended tyre is the fastest', () => {
      for (const t of TYRE_IDS) {
        expect(limit[t].along).toBeGreaterThanOrEqual(world.stage.finish);
        expect(limit[t].minUp).toBeGreaterThan(0.5);
      }
      const fastest = Math.min(...TYRE_IDS.map((t) => limit[t].t));
      // Within 0.5 %: on a mixed-surface stage two tyres can be nearly level (Petralica).
      expect(limit[map.tyre].t).toBeLessThanOrEqual(fastest * 1.005);
    });
  },
  600000,
);

test('jackie: tarmac tyres are worth it - tarmac < mixed < gravel by a margin', () => {
  const r = runAll(new World(jackieMap), true);
  expect(r.tarmac.t).toBeLessThan(r.mixed.t);
  expect(r.mixed.t).toBeLessThan(r.gravel.t);
  // 5 % today; the margin guards "a human feels it", not an exact number.
  expect(r.gravel.t / r.tarmac.t).toBeGreaterThan(1.02);
}, 600000);

test('ajvatovci: mixed tyres win on the dusty village tarmac - ahead of tarmac and gravel tyres by a margin', () => {
  const r = runAll(new World(ajvatovciMap), true);
  // 2.8 % / 4.2 % today; the margin guards "the recommendation is right", not an exact number.
  expect(r.tarmac.t / r.mixed.t).toBeGreaterThan(1.015);
  expect(r.gravel.t / r.mixed.t).toBeGreaterThan(1.015);
}, 600000);

test('test map: tarmac tyres on the gravel hill cost a lot of time', () => {
  const r = runAll(new World(testMap), true);
  expect(r.tarmac.t / r.gravel.t).toBeGreaterThan(1.1);
}, 600000);
