import { describe, expect, test } from '@rstest/core';
import { getAssetMeta } from '../../src/games/rally/assets/catalog';
import { VODNO_LANDMARKS } from '../../src/games/rally/maps/vodno/landmarks';
import {
  BUILDING,
  BUILDING_PAD,
  HOTEL,
  HOTEL_AREAS,
  HOTEL_CARS,
  HOTEL_PAD,
  hotelColliders,
} from '../../src/games/rally/maps/vodno/landmarks/hotel';
import { toWorld } from '../../src/games/rally/maps/vodno/landmarks/sites';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * The hotel behind the first crossroad (`landmarks/hotel.ts`): the building across the side street, the forecourt on the
 * road: where they stand relative to the road and the side streets, that their terraces are level, and that scatter
 * keeps off them.
 */
const world = new World(vodnoMap, vodnoMap.stages[0]);
const landmark = VODNO_LANDMARKS.find((l) => l.id === 'vodno-crossroad-hotel')!;
/** The forecourt's frame (on the road) and the building's frame (behind the side street). */
const world2 = (x: number, z: number): [number, number] => toWorld(HOTEL, x, z);
const worldB = (x: number, z: number): [number, number] =>
  toWorld(BUILDING, x, z);
const height = (x: number, z: number): number => {
  const [wx, wz] = world2(x, z);
  return world.analytic.height(wx, wz);
};
const heightB = (x: number, z: number): number => {
  const [wx, wz] = worldB(x, z);
  return world.analytic.height(wx, wz);
};

/** The building's footprint in its site frame (x -8 .. 8, z -10 .. 0). */
const CORNERS: [number, number][] = [
  [-8, 0],
  [8, 0],
  [8, -10],
  [-8, -10],
];

describe('vodno crossroad hotel', () => {
  test('is registered on the map and its terraces are map pads', () => {
    expect(landmark).toBeDefined();
    expect(vodnoMap.landmarks).toContain('vodno-crossroad-hotel');
    expect(world.landmarks.some((l) => l.id === landmark.id)).toBe(true);
    expect(vodnoMap.terrain.pads).toContain(HOTEL_PAD);
    expect(vodnoMap.terrain.pads).toContain(BUILDING_PAD);
  });

  test('stands back from the stage road: the building a good way off, the road wall about two metres', () => {
    const q = newRoadQuery();
    for (const [x, z] of CORNERS) {
      const [wx, wz] = worldB(x, z);
      const r = world.road.query(wx, wz, q);
      // (the road query only finds roads within its search radius: not found = far)
      const gap = r.found ? r.distance - r.halfWidth : Infinity;
      expect(gap, `corner (${x}, ${z})`).toBeGreaterThan(6);
    }
    const walls = hotelColliders(world.analytic).filter(
      (c) => c.kind === 'box' && c.hz !== undefined && c.hz < 1 && c.h > 1,
    );
    // Thin boxes: the road wall's sections (and the board posts).
    expect(walls.length).toBeGreaterThan(8);
    for (const c of walls) {
      const r = world.road.query(c.x, c.z, q);
      expect(r.found).toBe(true);
      expect(r.distance - r.halfWidth, 'wall / post').toBeGreaterThan(1.2);
    }
  });

  test('keeps off the side streets that meet behind it', () => {
    const paths = world.gen.paths!.paths;
    const segDist = (
      px: number,
      pz: number,
      ax: number,
      az: number,
      bx: number,
      bz: number,
    ): number => {
      const ex = bx - ax;
      const ez = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)),
      );
      return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
    };
    let nearest = Infinity;
    for (const p of paths)
      for (let i = 0; i + 3 < p.pts.length; i += 2)
        for (const [x, z] of [...CORNERS, [0, -10] as [number, number]]) {
          const [wx, wz] = worldB(x, z);
          nearest = Math.min(
            nearest,
            segDist(
              wx,
              wz,
              p.pts[i],
              p.pts[i + 1],
              p.pts[i + 2],
              p.pts[i + 3],
            ) -
              p.width / 2,
          );
        }
    expect(nearest).toBeGreaterThan(2.5);
  });

  test('stands on level ground: the terraces hold the footprint and the forecourt', () => {
    const level = heightB(0, 1);
    for (const [x, z] of [...CORNERS, [0, -5], [0, 2], [-8, 2], [8, 2]])
      expect(
        Math.abs(heightB(x, z) - level),
        `building (${x}, ${z})`,
      ).toBeLessThan(0.3);
    const forecourt = height(0, 3.5);
    for (const [x, z] of [
      [0, 3.5],
      [-12, 4],
      [8, 6],
      [-15, 1],
    ])
      expect(
        Math.abs(height(x, z) - forecourt),
        `forecourt (${x}, ${z})`,
      ).toBeLessThan(0.3);
  });

  test('scatter stays off the building, the forecourt, the parking strip and the road wall, not off the road', () => {
    for (const [x, z] of [
      [0, -5],
      [0, 2],
      [-8, -9],
    ]) {
      const [wx, wz] = worldB(x, z);
      expect(landmark.occupies(wx, wz, 0), `building (${x}, ${z})`).toBe(true);
    }
    for (const [x, z] of [
      [0, 4],
      [-15, 4],
      [10, 8],
      [18, 8.3],
    ]) {
      const [wx, wz] = world2(x, z);
      expect(landmark.occupies(wx, wz, 0), `forecourt (${x}, ${z})`).toBe(true);
    }
    for (const [x, z] of [
      [0, 14],
      [0, -8],
      [40, 8],
    ]) {
      const [wx, wz] = world2(x, z);
      expect(landmark.occupies(wx, wz, 0), `(${x}, ${z})`).toBe(false);
    }
    expect(HOTEL_AREAS.length).toBeGreaterThan(2);
  });

  test('the parked cars are fixed variants of street_car on the forecourt, clear of the road', () => {
    const cars = landmark
      .instances(world.analytic)
      .filter((p) => p.asset === 'street_car');
    expect(cars.length).toBe(HOTEL_CARS.length);
    const variants = getAssetMeta('street_car').variants;
    const q = newRoadQuery();
    for (const c of cars) {
      expect(c.variant).toBeGreaterThanOrEqual(16);
      expect(c.variant).toBeLessThan(variants);
      expect(Number.isFinite(c.rotY)).toBe(true);
      const r = world.road.query(c.x, c.z, q);
      expect(r.distance - r.halfWidth).toBeGreaterThan(4);
    }
    expect(new Set(cars.map((c) => c.variant)).size).toBe(cars.length);
  });

  test('has colliders with finite numbers', () => {
    const cs = hotelColliders(world.analytic);
    expect(cs.length).toBeGreaterThan(10);
    for (const c of cs)
      for (const v of [c.x, c.z, c.y, c.h])
        expect(Number.isFinite(v)).toBe(true);
  });
});
