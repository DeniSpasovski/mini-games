import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

describe.each(
  ALL_MAPS.filter((m) => m.paths?.length).map((m) => [m.id, m] as const),
)('junctions %s', (_id, map) => {
  const world = new World(map);
  const q = newRoadQuery();

  test('side roads reach the stage road', () => {
    const js = world.gen.junctions;
    console.info(
      `[${map.id}] ${js.length} junctions (${js.filter((j) => j.surface === 'tarmac').length} paved)`,
    );
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) {
      world.road.query(j.x, j.z, q);
      expect(q.found).toBe(true);
      // The junction point is on the stage road edge (ray steps are 1 m).
      expect(q.distance).toBeLessThanOrEqual(q.halfWidth);
      expect(q.distance).toBeGreaterThan(q.halfWidth - 1.5);
    }
  });

  test('extended side road ends are covered by the stage road', () => {
    // Path ends that touch the road now (none did before: the baker leaves a gap).
    let touching = 0;
    for (const p of world.gen.paths!.paths) {
      if (p.junction === false) continue;
      for (const k of [0, p.pts.length - 2]) {
        world.road.query(p.pts[k], p.pts[k + 1], q);
        if (q.found && q.distance <= q.halfWidth) touching++;
      }
    }
    expect(touching).toBeGreaterThanOrEqual(world.gen.junctions.length);
  });

  test('barriers close the mouths and stay off the road', () => {
    const bars = world.junctionInstances();
    if (!map.junctionBarriers) return;
    console.info(`[${map.id}] ${bars.length} junction barriers`);
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      world.road.query(b.x, b.z, q);
      if (q.found)
        expect(q.distance).toBeGreaterThan(
          q.halfWidth + map.road.shoulder + 1.5,
        );
    }
  });
});
