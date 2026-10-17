import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { galichicaMap } from '../../src/games/rally/maps/galichica/map';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import {
  lotContains,
  lotWorld,
} from '../../src/games/rally/maps/shared/service-lot';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import type { GroundSample } from '../../src/games/rally/physics/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { SERVICE_PARK_ASSETS } from '../../src/games/rally/world/service-park';
import { World } from '../../src/games/rally/world/world';

/**
 * Parcs fermés: a small row of team cars on a lay-by beside the road behind a stage start (ServicePark.ferme): the Test
 * map (4 cars, left of the run-up), Galichica West (6, Ohrid side) and Galichica East / Prespa to Ohrid (5, Prespa side).
 * Each car has its team's tent behind it and its crew round it. The Jackie parks its cars along two stretches of the
 * street beside the start instead.
 */
const CASES: [string, () => World, number][] = [
  ['test', () => new World(testMap), 4],
  ['galichica_west', () => new World(galichicaMap, 'galichica_west'), 6],
  ['galichica_east', () => new World(galichicaMap, 'galichica_east'), 5],
  ['prespa_ohrid', () => new World(galichicaMap, 'prespa_ohrid'), 5],
];

describe.each(CASES)('parc fermé: %s', (_, make, cars) => {
  const world = make();
  const park = world.servicePark!;
  const def = world.stageDef.servicePark!;

  test(`${cars} team cars, one on each ground sheet`, () => {
    expect(park).toBeDefined();
    expect(park.bays).toBe(cars);
    const teamCars = park.instances.filter((i) => i.asset === 'team_car');
    expect(teamCars.length).toBe(cars);
    expect(
      park.instances.filter((i) => i.asset === 'ground_sheet').length,
    ).toBe(cars);
    // Parked in a row on the lot, no trucks, vans or pickups.
    for (const car of teamCars)
      expect(def.lots.some((l) => lotContains(l, car.x, car.z, 0.5))).toBe(
        true,
      );
    for (const asset of ['service_truck', 'service_van', 'pickup'])
      expect(park.instances.some((i) => i.asset === asset)).toBe(false);
  });

  test("a tent of the car's team behind each car, the crew round it", () => {
    const tents = park.instances.filter((i) => i.asset === 'gazebo');
    expect(tents.length).toBe(cars);
    for (const tent of tents)
      expect(def.lots.some((l) => lotContains(l, tent.x, tent.z, 0.5))).toBe(
        true,
      );
    const team = park.instances.filter((i) =>
      ['driver', 'crew', 'mechanic'].includes(i.asset),
    );
    expect(team.length).toBeGreaterThanOrEqual(cars * 3);
    for (const person of team)
      expect(
        def.lots.some((l) => lotContains(l, person.x, person.z, 0.5)),
      ).toBe(true);
  });

  test('only park assets; a crowd, a photographer and visitors on the public edge', () => {
    for (const i of park.instances)
      expect(SERVICE_PARK_ASSETS).toContain(i.asset);
    expect(park.instances.some((i) => i.asset === 'spectator')).toBe(true);
    expect(park.instances.some((i) => i.asset === 'photographer')).toBe(true);
  });

  test('the lot keeps off the stage road, nothing stands on it', () => {
    const q = newRoadQuery();
    for (const lot of def.lots)
      for (const [u, v] of [
        [0, 0],
        [lot.length, 0],
        [0, lot.width],
        [lot.length, lot.width],
      ]) {
        const c = Math.cos(lot.heading);
        const s = Math.sin(lot.heading);
        const x = lot.x + (u - lot.length / 2) * c - (v - lot.width / 2) * s;
        const z = lot.z + (u - lot.length / 2) * s + (v - lot.width / 2) * c;
        world.stageRoad.query(x, z, q);
        expect(q.distance - q.halfWidth).toBeGreaterThan(2.5);
      }
    for (const i of park.instances) {
      world.stageRoad.query(i.x, i.z, q);
      expect(q.distance).toBeGreaterThan(q.halfWidth + 1);
    }
  });

  test('gravel runs level from the tape to the road: no bump, no grass between them', () => {
    const q = newRoadQuery();
    const out: GroundSample = {
      height: 0,
      normal: new Vector3(),
      surface: SURFACES.tarmac,
    };
    for (const lot of def.lots)
      for (const f of [0.25, 0.5, 0.75]) {
        const u = lot.length * f;
        const [x0, z0] = lotWorld(lot, u, 0);
        const h0 = world.analytic.height(x0, z0);
        // From the public edge to 2.7 m short of the road's edge (its own shoulder dips closer in).
        for (let v = 0; v > -12; v -= 0.5) {
          const [x, z] = lotWorld(lot, u, v);
          world.stageRoad.query(x, z, q);
          if (q.distance - q.halfWidth < 2.7) break;
          expect(Math.abs(world.analytic.height(x, z) - h0)).toBeLessThan(0.15);
          world.sampleGround(x, z, out);
          expect(out.surface.id).toBe('gravel');
        }
      }
  });

  test('deterministic', () => {
    expect(make().servicePark!.instances).toEqual(park.instances);
  });

  test('the cars stand at the level of the road beside them', () => {
    const q = newRoadQuery();
    for (const car of park.instances.filter((i) => i.asset === 'team_car')) {
      world.stageRoad.query(car.x, car.z, q);
      expect(Math.abs(car.y - q.height)).toBeLessThan(1);
    }
  });
});

describe('parc fermé: jackie (parallel on the roads beside the start)', () => {
  const world = new World(jackieMap);
  const park = world.servicePark!;
  const def = world.stageDef.servicePark!;
  const cars = park.instances.filter((i) => i.asset === 'team_car');

  test('5 cars on each of the two lots, nose to tail, no sheets', () => {
    expect(def.lots.length).toBe(2);
    expect(cars.length).toBe(10);
    for (const lot of def.lots)
      expect(cars.filter((c) => lotContains(lot, c.x, c.z, 0.5)).length).toBe(
        5,
      );
    expect(park.instances.some((i) => i.asset === 'ground_sheet')).toBe(false);
    // All parked the same way round (nose along the street, none turned to the kerb).
    expect(
      new Set(cars.map((c) => c.rotY.toFixed(1))).size,
    ).toBeLessThanOrEqual(2);
  });

  test('every car stands on a road beside the start, off the stage road, a crowd on the verge', () => {
    const pq = newPathQuery();
    const rq = newRoadQuery();
    for (const car of cars) {
      const hit = world.gen.paths!.query(car.x, car.z, pq);
      expect(hit.found && pq.distance < pq.halfWidth).toBe(true);
      world.stageRoad.query(car.x, car.z, rq);
      expect(rq.distance).toBeGreaterThan(rq.halfWidth + 6);
      // Abeam the start line, so the grid sees them side-on.
      expect(Math.abs(rq.along - world.stageDef.timing.start)).toBeLessThan(25);
    }
    expect(park.instances.some((i) => i.asset === 'spectator')).toBe(true);
    expect(park.instances.some((i) => i.asset === 'photographer')).toBe(true);
  });

  test('a team tent behind the cars and the crew round them', () => {
    const tents = park.instances.filter((i) => i.asset === 'gazebo_long');
    expect(tents.length).toBe(10);
    for (const tent of tents)
      expect(def.lots.some((l) => lotContains(l, tent.x, tent.z, 0.5))).toBe(
        true,
      );
    const team = park.instances.filter((i) =>
      ['driver', 'crew', 'mechanic'].includes(i.asset),
    );
    expect(team.length).toBeGreaterThanOrEqual(25);
  });

  test('deterministic', () => {
    expect(new World(jackieMap).servicePark!.instances).toEqual(park.instances);
  });
});

describe('parc fermé: vodno (parallel on the side street behind the start)', () => {
  const world = new World(vodnoMap);
  const park = world.servicePark!;
  const def = world.stageDef.servicePark!;
  const cars = park.instances.filter((i) => i.asset === 'team_car');

  test('6 cars nose to tail on one lot, each with its tent, chest and crew', () => {
    expect(def.lots.length).toBe(1);
    expect(cars.length).toBe(6);
    expect(park.instances.filter((i) => i.asset === 'gazebo_long').length).toBe(
      6,
    );
    expect(park.instances.filter((i) => i.asset === 'tool_chest').length).toBe(
      6,
    );
    expect(
      park.instances.filter((i) => ['crew', 'mechanic'].includes(i.asset))
        .length,
    ).toBeGreaterThanOrEqual(12);
    expect(park.instances.some((i) => i.asset === 'ground_sheet')).toBe(false);
    for (const car of cars)
      expect(lotContains(def.lots[0], car.x, car.z, 0.5)).toBe(true);
  });

  test('every car stands on the side street, off the stage road and well before the start line', () => {
    const pq = newPathQuery();
    const rq = newRoadQuery();
    for (const car of cars) {
      const hit = world.gen.paths!.query(car.x, car.z, pq);
      expect(hit.found && pq.distance < pq.halfWidth).toBe(true);
      world.stageRoad.query(car.x, car.z, rq);
      expect(rq.distance).toBeGreaterThan(rq.halfWidth + 20);
      expect(rq.along).toBeLessThan(world.stageDef.timing.start - 100);
    }
    expect(park.instances.some((i) => i.asset === 'spectator')).toBe(true);
  });

  test('deterministic', () => {
    expect(new World(vodnoMap).servicePark!.instances).toEqual(park.instances);
  });
});

describe('stages without a park', () => {
  test('Petralica has none (yet)', () => {
    expect(petralicaMap.stages.every((s) => !s.servicePark)).toBe(true);
  });

  test('Galichica West and East only get their own side', () => {
    const west = new World(galichicaMap, 'galichica_west').stageDef
      .servicePark!;
    const east = new World(galichicaMap, 'galichica_east').stageDef
      .servicePark!;
    expect(west.lots[0].x).toBeLessThan(0);
    expect(east.lots[0].x).toBeGreaterThan(0);
  });
});
