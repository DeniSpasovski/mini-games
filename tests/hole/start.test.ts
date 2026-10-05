import { expect, test } from '@rstest/core';
import { Rng } from '../../src/shared/rng';
import { getItem } from '../../src/games/hole/items/catalog';
import { generateCity } from '../../src/games/hole/map/generate';
import { pickStart } from '../../src/games/hole/map/start';
import { CANAL_Y } from '../../src/games/hole/map/spawn';
import { generateToyStore } from '../../src/games/hole/map/toy/generate';
import { insideMap, type MapData } from '../../src/games/hole/map/types';

function check(map: MapData, label: string) {
  const rng = new Rng(7);
  const seen = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const s = pickStart(map, () => rng.next());
    seen.add(`${Math.round(s.x / 20)},${Math.round(s.z / 20)}`);
    expect(insideMap(map, s.x, s.z, 8), `${label}: inside the playfield`).toBe(
      true,
    );
    for (const w of map.rects.filter((r) => r.y === CANAL_Y))
      expect(
        s.x > w.x0 && s.x < w.x1 && s.z > w.z0 && s.z < w.z1,
        `${label}: not in the canal`,
      ).toBe(false);
    let small = 0;
    for (const p of map.placements) {
      const it = getItem(p.item);
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (it.size > 0.9)
        expect(
          d - it.size / 2,
          `${label}: ${it.id} under the start`,
        ).toBeGreaterThan(1.1);
      if (it.tier <= 3 && d <= 22) small++;
    }
    expect(small, `${label}: busy start`).toBeGreaterThanOrEqual(15);
  }
  // it really is random: many different places
  expect(seen.size, `${label}: variety`).toBeGreaterThan(12);
}

test('random start: City Island seeds', () => {
  for (const seed of [1, 2, 3]) check(generateCity({ seed }), `city ${seed}`);
});

test('random start: Toy Emporium layouts', () => {
  for (const layout of ['a', 'b', 'c'])
    check(generateToyStore({ seed: 1, layout }), `toy ${layout}`);
});
