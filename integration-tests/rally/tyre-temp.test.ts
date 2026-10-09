import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { stageClimate } from '../../src/games/rally/maps/shared/climate';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import { TYRES, type TyreId } from '../../src/games/rally/physics/tyres';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';

/**
 * Every car on every stage with tyre temperatures on (the stage's climate, as in game), on the recommended and the
 * worst pick: still finishes upright, tyres stay in a sane range, and the recommended tyre is warm by the finish.
 * Same autopilot as car-matrix.test.ts (which runs without temperatures = the reference numbers). A stuck car gets one
 * reset to the road, as a player would (the reset keeps the tyre temperatures). Also logs the hottest disc and the
 * seconds with a fading brake.
 */
const DT = 1 / PHYSICS_HZ;
const STAGES: MapDef[] = [testMap, petralicaMap, jackieMap, ajvatovciMap];
const worlds = new Map(STAGES.map((m) => [m.id, new World(m)]));

function drive(carId: string, map: MapDef, tyre: TyreId) {
  const world = worlds.get(map.id)!;
  const def = ALL_CARS.find((c) => c.id === carId)!.physics;
  const v = new Vehicle(applySetup(def, SETUP_FOR_TYRE[tyre]), world);
  v.setTyre(tyre);
  v.setClimate(stageClimate(map.environment));
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  const ap = new Autopilot(world.road);
  ap.reset(world.stage.start - 9);
  const limit = Math.max(240, (world.stage.finish - world.stage.start) / 4);
  let t = 0;
  let minUp = 1;
  let stuck = 0;
  let resets = 0;
  let hottest = 0;
  let hottestDisc = 0;
  let fade = 0;
  while (t < limit && ap.along < world.stage.finish) {
    ap.drive(v, v.controls);
    v.step(DT);
    t += DT;
    minUp = Math.min(minUp, v.up.y);
    for (const w of v.wheels) hottest = Math.max(hottest, w.temp);
    for (const w of v.wheels) hottestDisc = Math.max(hottestDisc, w.brakeTemp);
    if (v.wheels.some((w) => w.brakeFactor < 0.85)) fade += DT;
    stuck = Math.abs(v.speed) < 0.5 ? stuck + DT : 0;
    if (stuck > 5) {
      if (resets++ > 0) break;
      const s = world.roadSpawn(ap.along);
      v.reset(s.position, s.heading);
      stuck = 0;
    }
  }
  const finish = v.wheels.reduce((s, w) => s + w.temp / 4, 0);
  return {
    t,
    finished: ap.along >= world.stage.finish,
    minUp,
    resets,
    hottest,
    hottestDisc,
    fade,
    finish,
  };
}

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  test.each(STAGES.map((m) => m.id))(
    '%s: finishes upright with tyre temperatures on the recommended and the worst pick',
    (mapId) => {
      const map = STAGES.find((m) => m.id === mapId)!;
      const rec = map.tyre;
      const worst: TyreId = rec === 'gravel' ? 'tarmac' : 'gravel';
      const a = drive(carId, map, rec);
      const b = drive(carId, map, worst);
      const f = (r: typeof a) =>
        `${r.t.toFixed(1)}s (up ${r.minUp.toFixed(2)}, ${r.resets} resets, finish ${r.finish.toFixed(0)}°C, max ${r.hottest.toFixed(0)}°C, discs ${r.hottestDisc.toFixed(0)}°C, fade ${r.fade.toFixed(0)}s)`;
      console.info(`[${carId} / ${mapId}] ${rec} ${f(a)}  ${worst} ${f(b)}`);
      for (const r of [a, b]) {
        expect(r.finished).toBe(true);
        expect(r.minUp).toBeGreaterThan(0.5);
        expect(r.hottest).toBeLessThan(150);
        // Brakes (physics/brakes.ts): hot, but not cooked - the autopilot plans with the brakes it has.
        expect(r.hottestDisc).toBeLessThan(1300);
      }
      // A careful run on the right tyre ends warm (at most 10 °C under the window).
      expect(a.finish).toBeGreaterThan(TYRES[rec].temp.lo - 10);
    },
    600000,
  );
});
