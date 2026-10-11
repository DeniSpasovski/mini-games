import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import type { TyreId } from '../../src/games/rally/physics/tyres';
import type { SetupId } from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';

/**
 * Every car on every stage (autopilot, careful driver unless noted) with its recommended tyre + set-up AND with the
 * worst pick for the stage, plus what a set-up alone is worth (Fabia, same tyre). Tyres + set-ups:
 * physics/tyres.ts, physics/car-setup.ts, src/games/rally/PHYSICS.md.
 */
const DT = 1 / PHYSICS_HZ;
const STAGES: MapDef[] = [testMap, petralicaMap, jackieMap, ajvatovciMap];
const worlds = new Map(STAGES.map((m) => [m.id, new World(m)]));

function drive(
  carId: string,
  mapId: string,
  tyre: TyreId,
  setup: SetupId,
  extraGrip = false,
) {
  const world = worlds.get(mapId)!;
  const def = ALL_CARS.find((c) => c.id === carId)!.physics;
  const v = new Vehicle(applySetup(def, setup), world);
  v.setTyre(tyre);
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  const ap = new Autopilot(world.road);
  ap.useExtraGrip = extraGrip;
  ap.reset(world.stage.start - 9);
  const limit = Math.max(240, (world.stage.finish - world.stage.start) / 4);
  let t = 0;
  let minUp = 1;
  let stuck = 0;
  let resets = 0;
  while (t < limit && ap.along < world.stage.finish) {
    ap.drive(v, v.controls);
    v.step(DT);
    t += DT;
    minUp = Math.min(minUp, v.up.y);
    stuck = Math.abs(v.speed) < 0.5 ? stuck + DT : 0;
    if (stuck > 5) {
      // A player presses R (reset to the road) when stuck; the wrong tyre on a steep loose climb may need it once.
      if (resets++ > 0) break;
      const s = world.roadSpawn(ap.along);
      v.reset(s.position, s.heading);
      stuck = 0;
    }
  }
  return { t, finished: ap.along >= world.stage.finish, minUp, resets };
}

/** Recommended-pick stage time per `car/map`, filled by the matrix below (tests in a file run in order). */
const best = new Map<string, number>();

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  test.each(STAGES.map((m) => m.id))(
    '%s: finishes upright on the recommended and on the worst pick',
    (mapId) => {
      const map = STAGES.find((m) => m.id === mapId)!;
      const rec = map.tyre;
      // The worst pick, with its matching set-up: tarmac tyres on a gravel stage, gravel tyres on a tarmac or
      // dusty-tarmac (mixed) stage.
      const worst: TyreId = rec === 'gravel' ? 'tarmac' : 'gravel';
      const a = drive(carId, mapId, rec, SETUP_FOR_TYRE[rec]);
      best.set(`${carId}/${mapId}`, a.t);
      const b = drive(carId, mapId, worst, SETUP_FOR_TYRE[worst]);
      console.info(
        `[${carId} / ${mapId}] ${rec}+${SETUP_FOR_TYRE[rec]} ${a.t.toFixed(1)}s (up ${a.minUp.toFixed(2)})  ${worst}+${SETUP_FOR_TYRE[worst]} ${b.t.toFixed(1)}s (up ${b.minUp.toFixed(2)})`,
      );
      expect(a.resets).toBe(0);
      for (const r of [a, b]) {
        expect(r.finished).toBe(true);
        expect(r.minUp).toBeGreaterThan(0.5);
      }
    },
    600000,
  );
});

// No "Fabia wins the gravel test map" check: the AWD car should feel better on gravel, but a car with more power may be
// quicker over the stage (by design, src/games/rally/PHYSICS.md "Stage times").
test('cars rank by character: Bimmer wins on tarmac, Zastava is slowest', () => {
  const t = (car: string, map: string) => best.get(`${car}/${map}`)!;
  const [fabia, bimmer, zastava] = ['skoda_rally', 'bimmer_m3', 'zastava_101'];
  expect(t(bimmer, 'jackie')).toBeLessThan(t(fabia, 'jackie'));
  for (const map of ['test', 'petralica', 'jackie']) {
    expect(t(zastava, map)).toBeGreaterThan(t(fabia, map));
    expect(t(zastava, map)).toBeGreaterThan(t(bimmer, map));
  }
});

test('fabia, same tyre: the right set-up alone is faster (limit driver) - soft on gravel, stiff on tarmac', () => {
  const car = 'skoda_rally';
  const gravel = {
    soft: drive(car, 'test', 'mixed', 'soft', true).t,
    stiff: drive(car, 'test', 'mixed', 'stiff', true).t,
  };
  const tarmac = {
    soft: drive(car, 'jackie', 'mixed', 'soft', true).t,
    stiff: drive(car, 'jackie', 'mixed', 'stiff', true).t,
  };
  console.info(
    `fabia mixed tyres: test soft ${gravel.soft.toFixed(1)} / stiff ${gravel.stiff.toFixed(1)}   jackie soft ${tarmac.soft.toFixed(1)} / stiff ${tarmac.stiff.toFixed(1)}`,
  );
  expect(gravel.soft).toBeLessThan(gravel.stiff);
  expect(tarmac.stiff).toBeLessThan(tarmac.soft);
}, 600000);
