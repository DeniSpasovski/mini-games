import { expect, test } from '@rstest/core';
import {
  generateToyStore,
  toyTargetPoints,
} from '../../src/games/hole/map/toy/generate';
import { TOY_ITEMS, getItem } from '../../src/games/hole/items/catalog';
import { insideMap } from '../../src/games/hole/map/types';
import { Sim } from '../../src/games/hole/sim/sim';
import { difficultyById } from '../../src/games/hole/sim/progression';
import { BOT_SKILLS, runBot } from '../../src/games/hole/sim/bot';
import {
  holeDiameter,
  ITEM_LEVELS,
  TIER_COUNT,
  cumulativeXp,
} from '../../src/games/hole/sim/progression';

const map = generateToyStore({ seed: 1 });

function stats(m = map) {
  const types = new Array(TIER_COUNT + 1).fill(0).map(() => new Set<string>());
  const levelTypes = new Array(ITEM_LEVELS + 1)
    .fill(0)
    .map(() => new Set<string>());
  let points = 0;
  for (const p of m.placements) {
    const it = getItem(p.item);
    types[it.tier].add(it.id);
    levelTypes[it.level].add(it.id);
    points += it.points;
  }
  return { types, levelTypes, points };
}

test('toy store generation is deterministic per seed', () => {
  const a = generateToyStore({ seed: 3 });
  const b = generateToyStore({ seed: 3 });
  const c = generateToyStore({ seed: 4 });
  expect(JSON.stringify(a.placements)).toBe(JSON.stringify(b.placements));
  expect(JSON.stringify(a.placements)).not.toBe(JSON.stringify(c.placements));
});

test('every item is inside the store floor and only toy items are used', () => {
  for (const p of map.placements) {
    expect(getItem(p.item).map).toBe('toy');
    expect(
      insideMap(map, p.x, p.z, 0),
      `${p.item} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`,
    ).toBe(true);
  }
});

test('every seed holds exactly 22000 points', () => {
  for (const seed of [1, 2, 3, 7, 42])
    expect(stats(generateToyStore({ seed })).points).toBe(22000);
  expect(toyTargetPoints({ points: 22000 })).toBe(22000);
});

test('content budget: tiers and levels covered, all types up to tier 20 placed, enough points', () => {
  const s = stats();
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      s.types[t].size,
      `tier ${t} types: ${[...s.types[t]]}`,
    ).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(s.levelTypes[l].size, `level ${l}`).toBeGreaterThanOrEqual(2);
  const placed = new Set(map.placements.map((p) => p.item));
  for (const it of TOY_ITEMS)
    if (it.tier <= 20) expect(placed.has(it.id), it.id).toBe(true);
  expect(s.points).toBeGreaterThanOrEqual(2 * cumulativeXp(ITEM_LEVELS));
  expect(map.placements.length).toBeGreaterThan(1500);
  expect(map.placements.length).toBeLessThan(13000);
});

test('start is on the floor with small items nearby, and the departments tile the floor', () => {
  expect(insideMap(map, map.start.x, map.start.z, 10)).toBe(true);
  const near = map.placements.filter(
    (p) =>
      Math.hypot(p.x - map.start.x, p.z - map.start.z) < 25 &&
      getItem(p.item).tier <= 3,
  );
  expect(near.length).toBeGreaterThan(15);
  expect(map.zones!.length).toBe(11);
});

test('balance bands: good bot on the toy store, hard / medium / easy', () => {
  const m = generateToyStore({ seed: 1 });
  const hard = runBot(
    new Sim(m, { seconds: difficultyById('hard', 'toy').seconds }),
    BOT_SKILLS.good,
    {
      dt: 1 / 30,
    },
  );
  expect(hard.level).toBeGreaterThanOrEqual(10);
  const medium = runBot(
    new Sim(m, { seconds: difficultyById('medium', 'toy').seconds }),
    BOT_SKILLS.good,
    {
      dt: 1 / 30,
    },
  );
  expect(medium.level).toBeGreaterThanOrEqual(15);
  const easy = runBot(
    new Sim(m, { seconds: difficultyById('easy', 'toy').seconds }),
    BOT_SKILLS.good,
    {
      dt: 1 / 30,
    },
  );
  expect(easy.level).toBeGreaterThanOrEqual(15);
  expect(easy.pct).toBeGreaterThan(0.95);
}, 122000);

test('every item can be reached by a hole of its first level', () => {
  // the hole centre may go to `inset x diameter` from the wall; the item must be inside the commit radius from there
  const b = map.bounds!;
  const bad: string[] = [];
  for (const p of map.placements) {
    const it = getItem(p.item);
    const D = holeDiameter(it.level);
    const inset = (b.inset ?? 0.5) * D;
    const cx = Math.max(-(b.hx - inset), Math.min(b.hx - inset, p.x));
    const cz = Math.max(-(b.hz - inset), Math.min(b.hz - inset, p.z));
    if (Math.hypot(p.x - cx, p.z - cz) > D / 2 - 0.15 * it.size)
      bad.push(`${p.item} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
  }
  expect(bad).toEqual([]);
});

test('layouts B and C: deterministic, exact points, every type placed, items on the floor', () => {
  for (const layout of ['b', 'c']) {
    const m = generateToyStore({ seed: 2, layout });
    const again = generateToyStore({ seed: 2, layout });
    expect(JSON.stringify(m.placements)).toBe(JSON.stringify(again.placements));
    expect(stats(m).points, layout).toBe(22000);
    const placed = new Set(m.placements.map((p) => p.item));
    for (const it of TOY_ITEMS)
      expect(placed.has(it.id), `${layout} ${it.id}`).toBe(true);
    for (const p of m.placements)
      expect(insideMap(m, p.x, p.z, 0), `${layout} ${p.item}`).toBe(true);
    expect(insideMap(m, m.start.x, m.start.z, 5)).toBe(true);
  }
});
