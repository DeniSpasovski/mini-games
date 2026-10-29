import { describe, expect, test } from '@rstest/core';
import { ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/** Fan groups in the corners (StageDef.cornerFans): placed, and never on the stage road or in a building. */
describe.each(
  ALL_STAGE_DEFS.filter((d) => d.stage.cornerFans).map(
    (d) => [d.stage.id, d] as const,
  ),
)('corner fans %s', (_id, { map, stage }) => {
  const world = new World(map, stage);
  const fans = world.cornerFans;

  test('groups of tape, spectators and flags', () => {
    const n = (asset: string) => fans.filter((i) => i.asset === asset).length;
    expect(n('tape_post')).toBeGreaterThan(10);
    expect(n('spectator')).toBeGreaterThan(10);
    expect(n('fan_flag')).toBeGreaterThan(0);
  });

  test('every tape span ties two posts, every post carries tape', () => {
    const posts = fans.filter((i) => i.asset === 'tape_post');
    const spans = fans.filter((i) => i.asset === 'tape_span');
    expect(spans.length).toBeGreaterThan(5);
    const at = (x: number, z: number) =>
      posts.filter((p) => Math.hypot(p.x - x, p.z - z) < 0.05).length;
    const used = new Set<number>();
    for (const s of spans) {
      // Ends of the span: its middle +- half its (flat) length along the heading.
      const half = ((s.sx ?? 1) * Math.cos(s.tiltZ)) / 2;
      const ends = [-1, 1].map((k) => [
        s.x + k * half * Math.cos(s.rotY),
        s.z - k * half * Math.sin(s.rotY),
      ]);
      for (const [x, z] of ends) {
        expect(at(x, z)).toBeGreaterThan(0);
        posts.forEach((p, i) => {
          if (Math.hypot(p.x - x, p.z - z) < 0.05) used.add(i);
        });
      }
    }
    expect(used.size).toBe(posts.length);
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
