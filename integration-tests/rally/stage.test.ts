import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  Autopilot,
  finishStopControls,
} from '../../src/games/rally/game/autopilot';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * End-to-end drivability: the autopilot must finish every stage with every
 * car without rolling over or getting stuck. Catches broken maps (cliffs,
 * trees on the road, impossible jumps) and physics regressions together.
 */
const worlds = new Map(ALL_MAPS.map((m) => [m.id, new World(m)]));

describe.each(
  ALL_MAPS.flatMap((m) => ALL_CARS.map((c) => [m.id, c.id] as const)),
)('%s / %s', (mapId, carId) => {
  test('autopilot finishes the stage', () => {
    const world = worlds.get(mapId)!;
    const car = ALL_CARS.find((c) => c.id === carId)!;
    const v = new Vehicle(car.physics, world);
    const spawn = world.roadSpawn();
    v.reset(spawn.position, spawn.heading);
    const ap = new Autopilot(world.road);
    ap.reset(world.stage.start - 9);
    let t = 0;
    let minUp = 1;
    let maxAir = 0;
    let stuck = 0;
    // ~36 km/h minimum average, at least 4 min.
    const limit = Math.max(240, (world.stage.finish - world.stage.start) / 10);
    while (t < limit && ap.along < world.stage.finish) {
      ap.drive(v, v.controls);
      v.step(1 / PHYSICS_HZ);
      t += 1 / PHYSICS_HZ;
      minUp = Math.min(minUp, v.up.y);
      maxAir = Math.max(maxAir, v.airTime);
      stuck = Math.abs(v.speed) < 0.5 ? stuck + 1 / PHYSICS_HZ : 0;
      if (stuck > 5) break;
    }
    console.info(
      `[${mapId}/${carId}] stage ${t.toFixed(1)}s, reached ${ap.along.toFixed(0)}/${world.stage.finish.toFixed(0)} m, min up ${minUp.toFixed(2)}, max air ${maxAir.toFixed(2)}s`,
    );
    expect(ap.along).toBeGreaterThanOrEqual(world.stage.finish);
    expect(minUp).toBeGreaterThan(0.5);

    // After the finish line the car must stop by itself, upright, on the road.
    const crossSpeed = v.speed * 3.6;
    const stopPilot = new Autopilot(world.road);
    stopPilot.reset(ap.along);
    for (let i = 0; i < PHYSICS_HZ * 15; i++) {
      finishStopControls(stopPilot, v, v.controls);
      v.step(1 / PHYSICS_HZ);
    }
    const q = world.road.query(v.position.x, v.position.z, newRoadQuery());
    console.info(
      `[${mapId}/${carId}] finish stop from ${crossSpeed.toFixed(0)} km/h: ${(q.along - world.stage.finish).toFixed(0)} m after the line, lateral ${q.lateral.toFixed(1)} m`,
    );
    expect(Math.abs(v.speed)).toBeLessThan(0.5);
    expect(v.holding).toBe(true);
    expect(v.up.y).toBeGreaterThan(0.9);
    // On the road or its gravel verge.
    expect(q.found && q.distance < q.halfWidth + world.map.road.shoulder).toBe(
      true,
    );
  });
});
