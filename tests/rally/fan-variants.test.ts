import { describe, expect, test } from '@rstest/core';
import { SPECTATOR_FLAG_FROM } from '../../src/games/rally/assets/catalog';
import { ALL_MAPS, ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { fanVariant } from '../../src/games/rally/world/fan-variants';
import { World } from '../../src/games/rally/world/world';

/** Index range of a country's hand-flag variants (6 outfits each: North Macedonia, then the USA). */
const flags = {
  mk: [SPECTATOR_FLAG_FROM, SPECTATOR_FLAG_FROM + 5],
  us: [SPECTATOR_FLAG_FROM + 6, SPECTATOR_FLAG_FROM + 11],
} as const;

describe('fan flags follow the map country', () => {
  test('every map has a country', () => {
    for (const m of ALL_MAPS) expect(['mk', 'us']).toContain(m.country);
  });

  test('fanVariant only picks its own country flag', () => {
    for (const c of ['mk', 'us'] as const) {
      const other = flags[c === 'mk' ? 'us' : 'mk'];
      let own = 0;
      for (let i = 0; i < 1000; i++) {
        const v = fanVariant(i / 1000, c);
        expect(v < other[0] || v > other[1]).toBe(true);
        if (v >= flags[c][0] && v <= flags[c][1]) own++;
      }
      expect(own).toBeGreaterThan(200);
    }
    // No country, no flags at all.
    for (let i = 0; i < 1000; i++)
      expect(fanVariant(i / 1000, undefined)).toBeLessThan(SPECTATOR_FLAG_FROM);
  });

  describe.each(ALL_STAGE_DEFS.map((d) => [d.stage.id, d] as const))(
    '%s',
    (_id, { map, stage }) => {
      test("no other country's flag on this map", () => {
        const world = new World(map, stage);
        const other = flags[map.country === 'mk' ? 'us' : 'mk'];
        const wrong: string[] = [];
        for (const i of world.scatter.fixedInstances())
          if (
            i.asset === 'spectator' &&
            i.variant >= other[0] &&
            i.variant <= other[1]
          )
            wrong.push(`${i.x.toFixed(0)},${i.z.toFixed(0)}`);
        expect(wrong).toEqual([]);
      });
    },
  );
});
