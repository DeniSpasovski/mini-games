import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

describe.each(ALL_MAPS.map((m) => [m.id, m] as const))(
  'stage signs %s',
  (_id, map) => {
    const world = new World(map);
    const { gantries, boards, colliders } = world.signs;
    const q = newRoadQuery();

    test('a gantry at the start and the finish, a board pair per split', () => {
      expect(gantries.map((g) => g.kind)).toEqual(['start', 'finish']);
      expect(gantries[0].along).toBe(world.stage.start);
      expect(gantries[1].along).toBe(world.stage.finish);
      expect(boards).toHaveLength(2 * map.stage.splits);
      expect(map.year).toBeGreaterThan(1900);
    });

    test('everything stands clear of the road', () => {
      for (const g of gantries) expect(g.half).toBeGreaterThan(4.5);
      for (const b of boards) {
        const s = world.road.at(b.along);
        expect(b.lateral).toBeGreaterThanOrEqual(s.halfWidth + 3);
      }
      // 2 pillars per gantry, 1 footprint box per board: none may reach into the carriageway.
      expect(colliders).toHaveLength(4 + 2 * map.stage.splits);
      for (const c of colliders) {
        world.road.query(c.x, c.z, q);
        if (q.found) expect(q.distance - c.r).toBeGreaterThan(q.halfWidth);
      }
    });
  },
);
