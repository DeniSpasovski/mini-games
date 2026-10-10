import { expect, test } from '@rstest/core';
import {
  generateToyStore,
  toyTargetPoints,
  VERY_BIG_TIER,
} from '../../src/games/hole/map/toy/generate';
import { TOY_ITEMS, getItem } from '../../src/games/hole/items/catalog';
import { insideMap } from '../../src/games/hole/map/types';
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

test('every seed holds exactly 9000 points', () => {
  for (const seed of [1, 2, 3, 7, 42])
    expect(stats(generateToyStore({ seed })).points).toBe(9000);
  expect(toyTargetPoints({ points: 9000 })).toBe(9000);
});

test('content budget: tiers and levels covered, every type below the very big tier placed, enough points', () => {
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
    if (it.tier < VERY_BIG_TIER) expect(placed.has(it.id), it.id).toBe(true);
  expect(s.points).toBeGreaterThanOrEqual(cumulativeXp(ITEM_LEVELS));
  expect(map.placements.length).toBeGreaterThan(1500);
  expect(map.placements.length).toBeLessThan(9000);
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

test('seeds: deterministic, exact points, every normal type placed, departments move', () => {
  const zoneKey = (m: ReturnType<typeof generateToyStore>) =>
    m.zones!.map((z) => `${z.id}:${z.x0},${z.z0}`).join('|');
  const keys = new Set<string>();
  for (const seed of [2, 3, 4, 5]) {
    const m = generateToyStore({ seed });
    const again = generateToyStore({ seed });
    expect(JSON.stringify(m.placements)).toBe(JSON.stringify(again.placements));
    expect(stats(m).points, `seed ${seed}`).toBe(9000);
    const placed = new Set(m.placements.map((p) => p.item));
    for (const it of TOY_ITEMS)
      if (it.tier < VERY_BIG_TIER)
        expect(placed.has(it.id), `${seed} ${it.id}`).toBe(true);
    for (const p of m.placements)
      expect(insideMap(m, p.x, p.z, 0), `${seed} ${p.item}`).toBe(true);
    expect(insideMap(m, m.start.x, m.start.z, 5)).toBe(true);
    keys.add(zoneKey(m));
  }
  expect(keys.size).toBeGreaterThan(1);
  // the entrance moves along the south wall with the checkout, and the start stays inside the checkout
  const doors = new Set<number>();
  for (let seed = 1; seed <= 12; seed++) {
    const m = generateToyStore({ seed });
    const door = m.bounds!.door!;
    doors.add(door);
    const checkout = m.zones!.find((z) => z.id === 'checkout')!;
    expect(door).toBeGreaterThanOrEqual(checkout.x0);
    expect(door).toBeLessThanOrEqual(checkout.x1);
    expect(m.start.x).toBeGreaterThan(checkout.x0);
    expect(m.start.x).toBeLessThan(checkout.x1);
    expect(m.start.z).toBeGreaterThan(checkout.z0);
  }
  expect(doors.size).toBe(3);
});
