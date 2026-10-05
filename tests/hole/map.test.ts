import { expect, test } from '@rstest/core';
import { generateCity, targetPoints } from '../../src/games/hole/map/generate';
import { getItem } from '../../src/games/hole/items/catalog';
import { insideIsland } from '../../src/games/hole/map/types';
import {
  ITEM_LEVELS,
  TIER_COUNT,
  cumulativeXp,
} from '../../src/games/hole/sim/progression';

const map = generateCity({ seed: 1 });

function stats(m = map) {
  const perLevel = new Array(TIER_COUNT + 1).fill(0);
  const types = new Array(TIER_COUNT + 1).fill(0).map(() => new Set<string>());
  const levelTypes = new Array(ITEM_LEVELS + 1)
    .fill(0)
    .map(() => new Set<string>());
  const pts = new Array(TIER_COUNT + 1).fill(0);
  let points = 0;
  for (const p of m.placements) {
    const it = getItem(p.item);
    perLevel[it.tier]++;
    types[it.tier].add(it.id);
    levelTypes[it.level].add(it.id);
    pts[it.tier] += it.points;
    points += it.points;
  }
  return { perLevel, types, levelTypes, pts, points };
}

test('city generation is deterministic per seed', () => {
  const a = generateCity({ seed: 3 });
  const b = generateCity({ seed: 3 });
  const c = generateCity({ seed: 4 });
  expect(JSON.stringify(a.placements)).toBe(JSON.stringify(b.placements));
  expect(JSON.stringify(a.placements)).not.toBe(JSON.stringify(c.placements));
});

test('every item is on the island', () => {
  for (const p of map.placements)
    expect(
      insideIsland(map.coast, p.x, p.z, 0),
      `${p.item} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`,
    ).toBe(true);
});

test('content budget: every tier has >= 2 item types placed and enough points', () => {
  const s = stats();
  for (let t = 1; t <= TIER_COUNT; t++)
    expect(
      s.types[t].size,
      `tier ${t} types: ${[...s.types[t]]}`,
    ).toBeGreaterThanOrEqual(2);
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(s.levelTypes[l].size, `level ${l}`).toBeGreaterThanOrEqual(2);
  // enough content that Easy can clear the island: >= 2x the XP needed for the top level
  expect(s.points).toBeGreaterThanOrEqual(2 * cumulativeXp(ITEM_LEVELS));
  expect(map.placements.length).toBeGreaterThan(2500);
  expect(map.placements.length).toBeLessThan(12000);
});

test('every seed holds exactly tiles x tiles x pointsPerTile points (10 x 10 x 300 = 30000)', () => {
  for (const seed of [1, 2, 3, 7, 42])
    expect(stats(generateCity({ seed })).points).toBe(30000);
  expect(targetPoints({ tiles: 10, pointsPerTile: 300 })).toBe(30000);
  // other sizes follow the same rule
  expect(
    stats(generateCity({ seed: 5, tiles: 8, pointsPerTile: 250 })).points,
  ).toBe(16000);
});

test('start point is on the island with small items nearby', () => {
  expect(insideIsland(map.coast, map.start.x, map.start.z, 10)).toBe(true);
  const near = map.placements.filter(
    (p) =>
      Math.hypot(p.x - map.start.x, p.z - map.start.z) < 25 &&
      getItem(p.item).tier <= 3,
  );
  expect(near.length).toBeGreaterThan(15);
});

test('roads have zebra crossings', () => {
  const zebra = map.rects.filter((r) => r.y === 0.022);
  expect(zebra.length).toBeGreaterThan(100);
  for (const r of zebra) {
    expect(r.x1).toBeGreaterThan(r.x0);
    expect(r.z1).toBeGreaterThan(r.z0);
  }
});
