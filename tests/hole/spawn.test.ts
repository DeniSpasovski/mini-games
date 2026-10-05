import { expect, test } from '@rstest/core';
import { ITEMS, getItem } from '../../src/games/hole/items/catalog';
import { DEFAULT_CITY, generateCity } from '../../src/games/hole/map/generate';
import {
  SPAWN,
  footprintHalf,
  isRoadItem,
  makeZoneMap,
  spawnViolation,
} from '../../src/games/hole/map/spawn';
import type { MapData } from '../../src/games/hole/map/types';

const zonesOf = (m: MapData) =>
  makeZoneMap({
    rects: m.rects,
    blocks: m.blocks,
    coast: m.coast,
    beachWidth: m.beachWidth,
    pitch: DEFAULT_CITY.pitch,
  });

test('every City Island item has a spawn row (and no row is stale)', () => {
  for (const it of ITEMS) expect(SPAWN[it.id], it.id).toBeDefined();
  const ids = new Set(ITEMS.map((i) => i.id));
  for (const id of Object.keys(SPAWN)) expect(ids.has(id), id).toBe(true);
});

test('only vehicles are road items, buses and trams are road only', () => {
  for (const it of ITEMS)
    if (isRoadItem(it.id)) expect(it.group, it.id).toBe('vehicle');
  expect(SPAWN.bus).toEqual(['road']);
  expect(SPAWN.tram).toEqual(['road']);
  // a scooter is in the vehicle group but is not a car
  expect(isRoadItem('scooter')).toBe(false);
});

test('zone lookup: road strip, sidewalk ring, lot, park, beach', () => {
  const m = generateCity({ seed: 1 });
  const z = zonesOf(m);
  const b = m.blocks.find((q) => q.district === 'residential')!;
  expect(z.zoneAt(b.cx, b.cz)).toBe('lot');
  expect(z.zoneAt(b.cx + 18.5, b.cz)).toBe('sidewalk');
  const park = m.blocks.find((q) => q.district === 'park')!;
  expect(z.zoneAt(park.cx, park.cz)).toBe('park');
  // 25 m from a block centre is the middle of the road to its neighbour (if it has one)
  const nb = m.blocks.find(
    (q) =>
      q.district !== 'edge' &&
      m.blocks.some(
        (o) => o.district !== 'edge' && o.i === q.i + 1 && o.j === q.j,
      ),
  )!;
  expect(z.zoneAt(nb.cx + 25, nb.cz)).toBe('road');
  expect(z.touchesRoad(nb.cx + 25, nb.cz, 0.1, 0.1)).toBe(true);
  expect(z.touchesRoad(nb.cx, nb.cz, 5, 5)).toBe(false);
  // the island centre is far from the coast, the coast ring is beach
  expect(z.zoneAt(DEFAULT_CITY.radius - 3, 0)).toBe('beach');
});

test('footprint half sizes follow the rotation', () => {
  const a = footprintHalf('bus', 0);
  const b = footprintHalf('bus', Math.PI / 2);
  expect(a.ex).toBeCloseTo(5, 5);
  expect(a.ez).toBeCloseTo(1.25, 5);
  expect(b.ex).toBeCloseTo(1.25, 5);
  expect(b.ez).toBeCloseTo(5, 5);
});

for (const seed of [1, 2, 3, 7, 42]) {
  test(`seed ${seed}: every item stands on ground it may spawn on, only vehicles touch roads`, () => {
    const m = generateCity({ seed });
    const z = zonesOf(m);
    const bad: string[] = [];
    for (const p of m.placements) {
      const why = spawnViolation(z, p.item, p.x, p.z, p.rot);
      if (why) bad.push(`${why} @ ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    }
    expect(bad.slice(0, 12), `${bad.length} violations`).toEqual([]);
    // the explicit road rule, independent of the table
    for (const p of m.placements) {
      if (getItem(p.item).group === 'vehicle' && isRoadItem(p.item)) continue;
      const { ex, ez } = footprintHalf(p.item, p.rot);
      expect(z.touchesRoad(p.x, p.z, ex, ez), p.item).toBe(false);
    }
  });
}

test('traffic exists: cars on the road, buses and trams only on the road', () => {
  const m = generateCity({ seed: 1 });
  const z = zonesOf(m);
  const onRoad = m.placements.filter(
    (p) => z.zoneAt(p.x, p.z) === 'road',
  ).length;
  expect(onRoad).toBeGreaterThan(150);
  for (const p of m.placements)
    if (p.item === 'bus' || p.item === 'tram')
      expect(z.zoneAt(p.x, p.z), p.item).toBe('road');
});
