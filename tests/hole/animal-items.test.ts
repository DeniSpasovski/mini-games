import { writeFileSync } from 'node:fs';
import { expect, test } from '@rstest/core';
import { ANIMAL_ITEMS } from '../../src/games/hole/items/catalog';
import { ANIMAL_DEFS } from '../../src/games/hole/items/catalog-animal';
import {
  buildItemGeometry,
  hasBuilder,
  triCount,
} from '../../src/games/hole/items/builders';
import { Mesher } from '../../src/games/hole/items/kit';
import { findBuried, findZFights } from '../../src/games/hole/debug/clip-check';
import { ITEM_LEVELS, TIER_COUNT } from '../../src/games/hole/sim/progression';

test('animal catalog: every tier 1..25 and level 1..15 has at least 2 types, ids are unique', () => {
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      ANIMAL_ITEMS.filter((i) => i.tier === t).length,
      `tier ${t}`,
    ).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(
      ANIMAL_ITEMS.filter((i) => i.level === l).length,
      `level ${l}`,
    ).toBeGreaterThanOrEqual(2);
  expect(new Set(ANIMAL_ITEMS.map((i) => i.id)).size).toBe(ANIMAL_ITEMS.length);
  // P0 alone covers every tier and level twice (the first playable set)
  const p0 = new Set(
    ANIMAL_DEFS.filter((d) => d.priority === 'P0').map((d) => d.id),
  );
  const shared = ANIMAL_ITEMS.filter((i) => i.map === 'city');
  const base = [...ANIMAL_ITEMS.filter((i) => p0.has(i.id)), ...shared];
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      base.filter((i) => i.tier === t).length,
      `P0 tier ${t}`,
    ).toBeGreaterThanOrEqual(2);
});

test('the giants: 16 types in tiers 20-25', () => {
  const giants = ANIMAL_ITEMS.filter((i) => i.group === 'giants');
  expect(giants.length).toBe(16);
  for (const g of giants) expect(g.tier).toBeGreaterThanOrEqual(20);
});

const BUDGET: Record<string, number> = {
  bugs: 300,
  critters: 520,
  animals: 800,
  giants: 1600,
  flora: 400,
  rocks: 340,
  hills: 400,
  zoo: 600,
  farm: 700,
  lab: 1400,
  labveh: 700,
  staff: 200,
  nature: 400,
};

Mesher.trace = true;

test('animal items: builder, catalog size, ground contact, paint list, tri budget, no clipping', () => {
  const problems: string[] = [];
  for (const it of ANIMAL_ITEMS) {
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
        if (paintAttr.getX(k) === 1) hasPaint = true;
      if (hasPaint && !it.paints?.length)
        problems.push(`${it.id}: paint parts but no paints`);
      if (!hasPaint && it.paints?.length)
        problems.push(`${it.id}: paints listed but no paint parts`);
      if (triCount(g) > BUDGET[it.group])
        problems.push(
          `${it.id}#${v}: ${triCount(g)} tris > ${BUDGET[it.group]}`,
        );
      if (it.map === 'animal') {
        const sites = g.userData.sites as string[];
        const fights = findZFights(g);
        if (fights.length)
          problems.push(
            `${it.id}#${v}: z-fight ${sites[fights[0].a]} vs ${sites[fights[0].b]}`,
          );
        const buried = findBuried(g);
        if (buried.length)
          problems.push(`${it.id}#${v}: buried ${buried.join(' ')}`);
      }
    }
  }
  if (process.env.LIST_PROBLEMS)
    console.log(['PROBLEMS', ...problems].join('\n'));
  expect(problems).toEqual([]);
});
