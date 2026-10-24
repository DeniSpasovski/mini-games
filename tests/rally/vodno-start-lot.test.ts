import { describe, expect, test } from '@rstest/core';
import {
  LOT_POLYGON,
  START_LOT,
  START_LOT_CARS,
  START_LOT_PAD,
} from '../../src/games/rally/maps/vodno/landmarks/start-lot';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * The start of the run-up (`maps/vodno/start-area.ts`, `landmarks/start-lot.ts`): the main street carries on into the stage
 * road, one two-way side street leaves it (no one-way slips), and the car park lies between the two off both.
 */
const world = new World(vodnoMap, vodnoMap.stages[0]);
const START_AREA = (x: number, z: number): boolean =>
  x > 1540 && x < 1640 && z > -1180 && z < -1060;

const inside = (poly: number[][], x: number, z: number): boolean => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const c = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
};

describe('vodno start area', () => {
  test('streets: no one-way slips, the side street leaves the main street and the main street reaches the stage road', () => {
    const near = world.gen.paths!.paths.filter((p) => {
      for (let i = 0; i < p.pts.length; i += 2)
        if (START_AREA(p.pts[i], p.pts[i + 1])) return true;
      return false;
    });
    expect(near.some((p) => p.oneway)).toBe(false);
    // The side street's first point lies on the main street's line (the tertiary road).
    const side = near.find(
      (p) => p.kind === 'residential' && Math.abs(p.pts[0] - 1566.2) < 0.01,
    )!;
    expect(side).toBeDefined();
    const main = near.find((p) => p.kind === 'tertiary')!;
    const e = world.road.at(0);
    const reach = Math.hypot(
      main.pts[main.pts.length - 2] - e.x,
      main.pts[main.pts.length - 1] - e.z,
    );
    expect(reach).toBeLessThan(1.5);
  });

  test('the lot is a convex outline in the map pads, off the stage road, and its cars stand inside it', () => {
    expect(vodnoMap.terrain.pads).toContain(START_LOT_PAD);
    const poly = LOT_POLYGON;
    const q = newRoadQuery();
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      for (let t = 0; t <= 1; t += 0.1) {
        world.road.query(ax + (bx - ax) * t, az + (bz - az) * t, q);
        expect(q.distance).toBeGreaterThan(q.halfWidth + 0.3);
      }
    }
    for (const c of START_LOT_CARS)
      expect(inside(poly, START_LOT.x + c.x, START_LOT.z + c.z)).toBe(true);
  });

  test('the garage footprints on the lot are gone, the block at its south end is not on it', () => {
    const ids = new Set(vodnoMap.buildings.map((b) => b.id));
    expect(ids.has(53)).toBe(false);
    expect(ids.has(64)).toBe(false);
    const block = vodnoMap.buildings.find((b) => b.id === 900001)!;
    expect(block).toBeDefined();
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      expect(
        inside(
          poly(),
          block.x + (sx * block.w) / 2,
          block.z + (sz * block.d) / 2,
        ),
      ).toBe(false);
  });
});

function poly(): number[][] {
  return LOT_POLYGON;
}
