import { describe, expect, test } from '@rstest/core';
import fixture from './fixtures/stage-identity.json';
import { ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { World } from '../../src/games/rally/world/world';

/**
 * Same stage, same time: every stage that existed before the map / stage split drives exactly the same road, start,
 * splits and finish as before it (numbers captured from the code before the split, `fixtures/stage-identity.json`),
 * so its stored times stay comparable. A stage whose road really changes gets a times version bump and a new fixture
 * row (AGENTS.md "Rally times versions").
 */
type Row = (typeof fixture.stages)['test'];
const rows = fixture.stages as Record<string, Row>;

describe.each(
  ALL_STAGE_DEFS.filter((d) => rows[d.stage.id]).map(
    (d) => [d.stage.id, d] as const,
  ),
)('%s', (id, { map, stage }) => {
  const want = rows[id];
  const world = new World(map, stage);

  test('road, start, splits, finish and spawn are unchanged', () => {
    const s = world.stageRoad.samples;
    let h = 0;
    for (const p of s)
      h =
        (Math.imul(h ^ Math.round(p.x * 100), 16777619) ^
          Math.imul(Math.round(p.z * 100), 2654435761) ^
          Math.round(p.y * 100)) >>>
        0;
    expect(+world.stageRoad.length.toFixed(3)).toBe(want.length);
    expect(s.length).toBe(want.samples);
    expect(h).toBe(want.roadHash);
    expect(+world.stage.start.toFixed(3)).toBe(want.start);
    expect(+world.stage.finish.toFixed(3)).toBe(want.finish);
    expect(world.stage.splits.map((v) => +v.toFixed(3))).toEqual(want.splits);
    for (let i = 0; i < 50; i++)
      expect(
        +world.stageRoad.at((world.stageRoad.length * i) / 49).y.toFixed(3),
      ).toBe(want.heights[i]);
    const sp = world.roadSpawn();
    expect(+sp.position.x.toFixed(3)).toBe(want.spawn.position.x);
    expect(+sp.position.z.toFixed(3)).toBe(want.spawn.position.z);
    expect(+sp.heading.toFixed(3)).toBe(want.spawn.heading);
  });
});
