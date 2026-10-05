import { expect, test } from '@rstest/core';
import { ITEMS, getItem } from '../../src/games/hole/items/catalog';
import {
  buildItemGeometry,
  hasBuilder,
  triCount,
} from '../../src/games/hole/items/builders';
import { ITEM_LEVELS, TIER_COUNT } from '../../src/games/hole/sim/progression';

test('every size tier 1..25 and every hole level 1..15 has at least 2 item types', () => {
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(ITEMS.filter((i) => i.tier === t).length).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(ITEMS.filter((i) => i.level === l).length).toBeGreaterThanOrEqual(2);
});

test('catalog ids are unique, every item is edible by someone', () => {
  expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  for (const i of ITEMS) expect(Number.isFinite(i.level)).toBe(true);
});

test('points follow the tier table', () => {
  expect(getItem('soda_can').points).toBe(1);
  expect(getItem('bench').points).toBe(6);
  expect(getItem('car_sedan').points).toBe(12);
  expect(getItem('skyscraper_mega').points).toBe(50);
  expect(getItem('hotel').points).toBe(30);
});

const BUDGET: Record<string, number> = {
  litter: 60,
  street: 140,
  nature: 260,
  people: 80,
  park: 260,
  beach: 260,
  vehicle: 500,
  harbour: 300,
  residential: 450,
  commercial: 450,
  building: 900,
  skyscraper: 900,
};

test('every item has a builder, matches its catalog size, and stays in its tri budget', () => {
  const problems: string[] = [];
  for (const it of ITEMS) {
    if (!hasBuilder(it.id)) {
      problems.push(`${it.id}: no builder`);
      continue;
    }
    for (let v = 0; v < it.variants; v++) {
      const g = buildItemGeometry(it.id, v);
      const bb = g.boundingBox!;
      const w = bb.max.x - bb.min.x;
      const h = bb.max.y - bb.min.y;
      const d = bb.max.z - bb.min.z;
      const tag = `${it.id}#${v} built ${w.toFixed(2)}x${d.toFixed(2)}x${h.toFixed(2)} vs catalog ${it.w}x${it.d}x${it.h}`;
      if (bb.min.y < -0.05) problems.push(`${tag}: below ground`);
      // the largest horizontal extent decides the tier: keep it within 15% of the catalog
      const hs = Math.max(w, d);
      const cs = Math.max(it.w, it.d);
      if (hs / cs > 1.15 || hs / cs < 0.85) problems.push(`${tag}: footprint`);
      if (Math.abs(h - it.h) > Math.max(0.06, it.h * 0.1))
        problems.push(`${tag}: height`);
      const paintAttr = g.getAttribute('paint');
      let hasPaint = false;
      for (let k = 0; k < paintAttr.count; k++)
        if (paintAttr.getX(k) === 1) hasPaint = true; // 2 = glow, not paint
      if (hasPaint && !it.paints?.length)
        problems.push(`${it.id}: has paint parts but no paints`);
      if (!hasPaint && it.paints?.length)
        problems.push(`${it.id}: paints listed but no paint parts`);
      if (triCount(g) > BUDGET[it.group])
        problems.push(
          `${it.id}#${v}: ${triCount(g)} tris > ${BUDGET[it.group]}`,
        );
    }
  }
  expect(problems).toEqual([]);
});
