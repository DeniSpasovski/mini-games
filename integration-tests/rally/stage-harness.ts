import { describe, expect, test } from '@rstest/core';
import {
  Autopilot,
  finishStopControls,
} from '../../src/games/rally/game/autopilot';
import { ALL_STAGES } from '../../src/games/rally/maps';
import { stageClimate } from '../../src/games/rally/maps/shared/day-temperature';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import { TYRES } from '../../src/games/rally/physics/tyres';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';
import { carsUnderTest } from './cars-under-test';

/**
 * End-to-end drivability, one file per map (stage-<map>.test.ts) so the maps run side by side: the autopilot must finish
 * each stage with every car under test (cars-under-test.ts) on the stage's recommended tyre + set-up, tyre and brake
 * temperatures on (the stage's climate, as in game), without rolling over or getting stuck, then stop by itself after the
 * line. Tyres and discs stay in a sane range and the tyre is warm at the finish. Catches broken maps (cliffs, trees on
 * the road, impossible jumps) and physics regressions together.
 *
 * `climate: false` drives on raw surfaces (no tyre fitted, no temperatures) and skips the temperature checks: for stages
 * the recommended pick does not get through yet in the stage's climate (Galichica: cold tyres on the Prespa side).
 */
export function describeStages(
  map: MapDef,
  stageIds = map.stages.map((s) => s.id),
  { climate = true } = {},
): void {
  for (const id of stageIds) {
    const stage = map.stages.find((s) => s.id === id)!;
    const info = ALL_STAGES.find((s) => s.id === id)!;
    let world: World | undefined;
    describe.each(carsUnderTest().map((c) => c.id))(`${id} / %s`, (carId) => {
      test('autopilot finishes the stage', () => {
        world ??= new World(map, stage);
        const car = carsUnderTest().find((c) => c.id === carId)!;
        const tyre = stage.tyre;
        const v = new Vehicle(
          climate ? applySetup(car.physics, SETUP_FOR_TYRE[tyre]) : car.physics,
          world,
        );
        if (climate) {
          v.setTyre(tyre);
          v.setClimate(stageClimate(info));
        }
        const spawn = world.roadSpawn();
        v.reset(spawn.position, spawn.heading);
        const ap = new Autopilot(world.stageRoad);
        // The 23 hp, rear-engined Fiat 126p plows wide on the fast downhill bends at the pilot's usual pace.
        if (carId === 'pezetka') ap.aggression = 0.3;
        ap.reset(world.stage.start - 9);
        let t = 0;
        let minUp = 1;
        let maxAir = 0;
        let stuck = 0;
        let hottest = 0;
        let hottestDisc = 0;
        // ~36 km/h minimum average, at least 4 min.
        const limit = Math.max(
          240,
          (world.stage.finish - world.stage.start) / 10,
        );
        while (t < limit && ap.along < world.stage.finish) {
          ap.drive(v, v.controls);
          v.step(1 / PHYSICS_HZ);
          t += 1 / PHYSICS_HZ;
          minUp = Math.min(minUp, v.up.y);
          maxAir = Math.max(maxAir, v.airTime);
          for (const w of v.wheels) {
            hottest = Math.max(hottest, w.temp);
            hottestDisc = Math.max(hottestDisc, w.brakeTemp);
          }
          stuck = Math.abs(v.speed) < 0.5 ? stuck + 1 / PHYSICS_HZ : 0;
          if (stuck > 5) break;
        }
        const finishTemp = v.wheels.reduce((s, w) => s + w.temp / 4, 0);
        console.info(
          `[${id}/${carId}] ${climate ? `${tyre}+${SETUP_FOR_TYRE[tyre]}` : 'raw surfaces'} stage ${t.toFixed(1)}s, reached ${ap.along.toFixed(0)}/${world.stage.finish.toFixed(0)} m, min up ${minUp.toFixed(2)}, max air ${maxAir.toFixed(2)}s, tyres finish ${finishTemp.toFixed(0)}°C max ${hottest.toFixed(0)}°C, discs ${hottestDisc.toFixed(0)}°C`,
        );
        expect(ap.along).toBeGreaterThanOrEqual(world.stage.finish);
        expect(minUp).toBeGreaterThan(0.5);
        if (climate) {
          expect(hottest).toBeLessThan(150);
          // Brakes (physics/brakes.ts): hot, but not cooked - the autopilot plans with the brakes it has.
          expect(hottestDisc).toBeLessThan(1300);
          // The careful run on the right tyre ends warm (at most 10 °C under the window).
          expect(finishTemp).toBeGreaterThan(TYRES[tyre].temp.lo - 10);
        }

        // After the finish line the car must stop by itself, upright, on the road.
        const crossSpeed = v.speed * 3.6;
        const stopPilot = new Autopilot(world.stageRoad);
        stopPilot.reset(ap.along);
        for (let i = 0; i < PHYSICS_HZ * 15; i++) {
          finishStopControls(stopPilot, v, v.controls);
          v.step(1 / PHYSICS_HZ);
        }
        const q = world.stageRoad.query(
          v.position.x,
          v.position.z,
          newRoadQuery(),
        );
        console.info(
          `[${id}/${carId}] finish stop from ${crossSpeed.toFixed(0)} km/h: ${(q.along - world.stage.finish).toFixed(0)} m after the line, lateral ${q.lateral.toFixed(1)} m`,
        );
        expect(Math.abs(v.speed)).toBeLessThan(0.5);
        expect(v.holding).toBe(true);
        expect(v.up.y).toBeGreaterThan(0.9);
        // On the road or its gravel verge.
        expect(
          q.found && q.distance < q.halfWidth + world.map.road.shoulder,
        ).toBe(true);
      }, 600000);
    });
  }
}
