import { expect, test } from '@rstest/core';
import { CONSTRUCTION_ITEMS } from '../../src/games/hole/items/catalog';
import { CONSTRUCTION_DEFS } from '../../src/games/hole/items/catalog-construction';
import {
  buildItemGeometry,
  hasBuilder,
  triCount,
} from '../../src/games/hole/items/builders';
import { ITEM_LEVELS, TIER_COUNT } from '../../src/games/hole/sim/progression';

test('construction catalog: every tier 1..25 and level 1..15 has at least 2 types', () => {
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      CONSTRUCTION_ITEMS.filter((i) => i.tier === t).length,
    ).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(
      CONSTRUCTION_ITEMS.filter((i) => i.level === l).length,
    ).toBeGreaterThanOrEqual(2);
  expect(new Set(CONSTRUCTION_ITEMS.map((i) => i.id)).size).toBe(
    CONSTRUCTION_ITEMS.length,
  );
  expect(CONSTRUCTION_ITEMS.length).toBe(CONSTRUCTION_DEFS.length);
});

const BUDGET: Record<string, number> = {
  material: 300,
  tools: 400,
  crew: 140,
  site: 600,
  heaps: 300,
  plant: 900,
  trucks: 1200,
  structures: 1600,
  cranes: 1200,
  mining: 1600,
};

test('construction items: builder, catalog size, ground contact, paint list, tri budget', () => {
  const problems: string[] = [];
  for (const it of CONSTRUCTION_ITEMS) {
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
      const tag = `${it.id}#${v} built ${w.toFixed(2)}x${d.toFixed(2)}x${h.toFixed(2)} vs ${it.w}x${it.d}x${it.h}`;
      if (bb.min.y < -0.05) problems.push(`${tag}: below ground`);
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
        problems.push(`${it.id}: paint parts but no paints`);
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
