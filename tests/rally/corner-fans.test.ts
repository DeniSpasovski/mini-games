import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/** Fan groups in the corners (MapDef.cornerFans): placed, and never on the stage road or in a building. */
describe.each(
  ALL_MAPS.filter((m) => m.cornerFans).map((m) => [m.id, m] as const),
)('corner fans %s', (_id, map) => {
  const world = new World(map);
  const fans = world.cornerFans;

  test('groups of tape, spectators and flags', () => {
    const n = (asset: string) => fans.filter((i) => i.asset === asset).length;
    expect(n('tape_post')).toBeGreaterThan(10);
    expect(n('spectator')).toBeGreaterThan(10);
    expect(n('fan_flag')).toBeGreaterThan(0);
  });

  test('off the road and out of buildings', () => {
    const q = newRoadQuery();
    const bad = fans
      .filter((i) => {
        world.road.query(i.x, i.z, q);
        return (
          (q.found && q.distance < q.halfWidth + 3) ||
          world.buildings.contains(i.x, i.z, 0)
        );
      })
      .map((i) => `${i.asset} ${i.x.toFixed(0)},${i.z.toFixed(0)}`);
    expect(bad).toEqual([]);
  });
});
