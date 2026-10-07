import { expect, test } from '@rstest/core';
import {
  DEFAULT_CONSTRUCTION,
  generateConstructionCity,
} from '../../src/games/hole/map/construction/generate';
import { onRoad } from '../../src/games/hole/map/construction/layout';
import {
  CONSTRUCTION_ITEMS,
  getItem,
} from '../../src/games/hole/items/catalog';
import { insideMap } from '../../src/games/hole/map/types';
import {
  holeDiameter,
  ITEM_LEVELS,
  TIER_COUNT,
  cumulativeXp,
} from '../../src/games/hole/sim/progression';

const map = generateConstructionCity({ seed: 1 });

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

test('construction generation is deterministic per seed', () => {
  const a = generateConstructionCity({ seed: 3 });
  const b = generateConstructionCity({ seed: 3 });
  const c = generateConstructionCity({ seed: 4 });
  expect(JSON.stringify(a.placements)).toBe(JSON.stringify(b.placements));
  expect(JSON.stringify(a.placements)).not.toBe(JSON.stringify(c.placements));
});

test('every item is inside the fence and only construction items are used', () => {
  for (const p of map.placements) {
    expect(getItem(p.item).map).toBe('construction');
    expect(
      insideMap(map, p.x, p.z, 0),
      `${p.item} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`,
    ).toBe(true);
  }
});

test('every seed holds exactly 20000 points', () => {
  for (const seed of [1, 2, 3, 7, 42])
    expect(stats(generateConstructionCity({ seed })).points).toBe(
      DEFAULT_CONSTRUCTION.points,
    );
});

test('content budget: tiers and levels covered, every type placed, enough points', () => {
  const s = stats();
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      s.types[t].size,
      `tier ${t} types: ${[...s.types[t]]}`,
    ).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(s.levelTypes[l].size, `level ${l}`).toBeGreaterThanOrEqual(2);
  const placed = new Set(map.placements.map((p) => p.item));
  for (const it of CONSTRUCTION_ITEMS)
    expect(placed.has(it.id), it.id).toBe(true);
  expect(s.points).toBeGreaterThanOrEqual(2 * cumulativeXp(ITEM_LEVELS));
  expect(map.placements.length).toBeGreaterThan(1500);
  expect(map.placements.length).toBeLessThan(14000);
});

test('start is inside the site with small items nearby', () => {
  expect(insideMap(map, map.start.x, map.start.z, 10)).toBe(true);
  const near = map.placements.filter(
    (p) =>
      Math.hypot(p.x - map.start.x, p.z - map.start.z) < 25 &&
      getItem(p.item).tier <= 3,
  );
  expect(near.length).toBeGreaterThan(15);
});

test('only driving trucks stand on a haul road, and their lanes follow the road graph', () => {
  const bad: string[] = [];
  const nodes = map.roads!.nodes;
  for (const p of map.placements) {
    const it = getItem(p.item);
    if (p.move?.kind === 'drive') {
      const a = nodes.findIndex(
        ([x, z]) =>
          Math.abs(x - p.move!.hx) < 1 && Math.abs(z - p.move!.hz) < 1,
      );
      const b = nodes.findIndex(
        ([x, z]) =>
          Math.abs(x - p.move!.tx!) < 1 && Math.abs(z - p.move!.tz!) < 1,
      );
      if (a < 0 || b < 0) bad.push(`${p.item}: lane not on the road graph`);
    } else if (onRoad(p.x, p.z, Math.max(it.w, it.d) * 0.4))
      bad.push(`${p.item} at ${p.x.toFixed(0)},${p.z.toFixed(0)} on a road`);
  }
  expect(bad).toEqual([]);
  expect(
    map.placements.filter((p) => p.move?.kind === 'drive').length,
  ).toBeGreaterThan(10);
});

test('every item can be reached by a hole of its first level', () => {
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
