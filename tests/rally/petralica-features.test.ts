import { describe, expect, test } from '@rstest/core';
import { propertiesLandmark as landmark } from '../../src/games/rally/maps/petralica/properties';
import {
  fenceRuns,
  GATES,
  gateEnds,
  distToLine,
  LOT,
  ORCHARD,
  PAIR_HALF,
  pairToWorld,
  TANK_PAIRS,
  tankBase,
  ROAD_TREES,
  YARD_TREES,
} from '../../src/games/rally/maps/petralica/properties/layout';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

describe('petralica features', () => {
  const world = new World(petralicaMap);
  const road = world.gen.road;
  const rq = newRoadQuery();
  /** Distance from the stage road's centre line. */
  const off = (x: number, z: number) => road.query(x, z, rq).distance;

  test('lines stand off the stage road', () => {
    for (const run of fenceRuns())
      for (let i = 1; i < run.length; i++)
        for (let t = 0; t <= 1; t += 0.05) {
          const x = run[i - 1][0] + (run[i][0] - run[i - 1][0]) * t;
          const z = run[i - 1][1] + (run[i][1] - run[i - 1][1]) * t;
          expect(off(x, z)).toBeGreaterThan(5);
        }
    for (const g of GATES)
      for (const [x, z] of gateEnds(g)) expect(off(x, z)).toBeGreaterThan(5);
  });

  test('fixed scatter stands off the stage road', () => {
    for (const [x, z] of [...ROAD_TREES, ...YARD_TREES])
      expect(off(x, z)).toBeGreaterThan(6);
  });

  test('outlines close up', () => {
    const runs = fenceRuns();
    expect(runs.length).toBe(GATES.length);
    const length = (pts: [number, number][]) =>
      pts.reduce(
        (s, p, i) =>
          i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0,
        0,
      );
    const fence = runs.reduce((s, r) => s + length(r), 0);
    const rings = length([...ORCHARD, ORCHARD[0]]) + length([...LOT, LOT[0]]);
    const gates = GATES.reduce((s, g) => s + g.width, 0);
    expect(Math.abs(fence + gates - rings)).toBeLessThan(0.01);
  });

  test('props sit inside their outline, level', () => {
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = ORCHARD.length - 1; i < ORCHARD.length; j = i++) {
        const [xi, zi] = ORCHARD[i];
        const [xj, zj] = ORCHARD[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
          c = !c;
      }
      return c;
    };
    const ring = [...ORCHARD, ORCHARD[0]];
    const h = (x: number, z: number) => world.analytic.height(x, z);
    for (const pair of TANK_PAIRS) {
      const base = tankBase(pair, h);
      for (const u of [-1, 1])
        for (const v of [-1, 1]) {
          const [x, z] = pairToWorld(pair, u * PAIR_HALF[0], v * PAIR_HALF[1]);
          expect(inside(x, z)).toBe(true);
          expect(distToLine(x, z, ring)).toBeGreaterThan(0.8);
          expect(base - h(x, z)).toBeGreaterThanOrEqual(0.3 - 1e-6);
          expect(base - h(x, z)).toBeLessThan(1);
        }
    }
  });

  test('colliders stay off the road surface', () => {
    for (const c of landmark.colliders(world.analytic))
      expect(off(c.x, c.z)).toBeGreaterThan(4);
  });
});
