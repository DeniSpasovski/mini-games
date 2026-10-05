import { expect, test } from '@rstest/core';
import { TOY_ITEMS } from '../../src/games/hole/items/catalog';
import {
  buildItemGeometry,
  hasBuilder,
  triCount,
} from '../../src/games/hole/items/builders';
import { ITEM_LEVELS, TIER_COUNT } from '../../src/games/hole/sim/progression';

test('toy catalog: every tier 1..25 and level 1..15 has at least 2 types', () => {
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(TOY_ITEMS.filter((i) => i.tier === t).length).toBeGreaterThanOrEqual(
      2,
    );
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(
      TOY_ITEMS.filter((i) => i.level === l).length,
    ).toBeGreaterThanOrEqual(2);
  expect(new Set(TOY_ITEMS.map((i) => i.id)).size).toBe(TOY_ITEMS.length);
});

test('required plush families exist at six sizes', () => {
  for (const fam of ['panda', 'brown_bear', 'gray_rabbit'])
    for (const s of ['xs', 's', 'm', 'l', 'xl', 'xxl'])
      expect(TOY_ITEMS.some((i) => i.id === `plush_${fam}_${s}`)).toBe(true);
});

const BUDGET: Record<string, number> = {
  bricks: 500,
  figures: 450,
  toys: 250,
  plush: 700,
  dolls: 450,
  toyveh: 900,
  robots: 900,
  games: 450,
  outdoor: 600,
  store: 1000,
  landmark: 1400,
};

test('toy items: builder, catalog size, ground contact, paint list, tri budget', () => {
  const problems: string[] = [];
  for (const it of TOY_ITEMS) {
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
