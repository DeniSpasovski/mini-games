import { describe, expect, test } from '@rstest/core';
import data from '../../src/games/rally/maps/jackie/data.json';
import type { PathDef } from '../../src/games/rally/maps/shared/types';

/**
 * Street model of the Jackie END BOX (`scripts/realmap/streets.py`): every tarmac path with a point in the box carries
 * its real curb width, lane layout, sidewalks, paving and paint. Pure data (no World): the checks run on `data.json`.
 */
const BOX = { x0: 1500, x1: 4300, z0: -2300, z1: -900 };
const BIG = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const PARK_W = 2.2;
const LANE_W = 2.7;
const BIKE_W = 1.5;

const inBox = (p: PathDef): boolean => {
  for (let k = 0; k < p.pts.length; k += 2)
    if (
      p.pts[k] >= BOX.x0 &&
      p.pts[k] <= BOX.x1 &&
      p.pts[k + 1] >= BOX.z0 &&
      p.pts[k + 1] <= BOX.z1
    )
      return true;
  return false;
};

const all = data.paths as PathDef[];
const modelled = all.filter((p) => p.surface === 'tarmac' && inBox(p));

describe('jackie: street model (END BOX)', () => {
  test('every tarmac path in the box has the model; nothing outside it got one', () => {
    expect(modelled.length).toBeGreaterThan(300);
    for (const p of modelled) {
      expect(p.curbWidth, `${p.kind} ${p.pts.slice(0, 2)}`).toBeGreaterThan(0);
      expect(p.layout).toBeDefined();
      expect(p.sidewalk).toBeDefined();
      expect(p.pave).toMatch(/^(asphalt|concrete)$/);
      expect(p.marks).toBeDefined();
    }
    // outside the box: the WEST corridor (scripts/realmap/corridor.py) has its own model run; nothing else
    const meta = (
      data.meta as { streets?: { paths: number; paths_west?: number } }
    ).streets;
    const outside = all.filter((p) => !modelled.includes(p) && p.layout);
    expect(meta?.paths).toBe(modelled.length);
    expect(outside.length).toBe(meta?.paths_west ?? 0);
  });

  test('widths are plausible: 2 - 24 m, residential streets about 9 m, no street narrower than its lanes', () => {
    const residential: number[] = [];
    for (const p of modelled) {
      const w = p.curbWidth!;
      expect(w, `${p.kind} at ${p.pts.slice(0, 2)}`).toBeGreaterThanOrEqual(2);
      expect(w, `${p.kind} at ${p.pts.slice(0, 2)}`).toBeLessThanOrEqual(24);
      if (p.kind === 'residential') residential.push(w);
    }
    residential.sort((a, b) => a - b);
    const median = residential[residential.length >> 1];
    expect(median).toBeGreaterThan(7);
    expect(median).toBeLessThan(12);
  });

  test('the layout fits the width: parking / bike lanes are dropped before the travel lanes are squeezed', () => {
    for (const p of modelled) {
      const l = p.layout!;
      for (const v of [l.fwd, l.back, l.parkL, l.parkR, l.bikeL, l.bikeR])
        expect(Number.isInteger(v)).toBe(true);
      expect(l.fwd + l.back).toBeGreaterThanOrEqual(1);
      if (BIG.has(p.kind) || p.kind === 'service') {
        // carriageways / ramps / alleys: no parking, the lane count follows the baked width
        expect(l.parkL + l.parkR).toBe(0);
        continue;
      }
      const extra = (l.parkL + l.parkR) * PARK_W + (l.bikeL + l.bikeR) * BIKE_W;
      if (extra > 0)
        expect(
          p.curbWidth! - 2 * l.shoulder - extra - (l.fwd + l.back) * LANE_W,
          `${p.kind} ${p.pts.slice(0, 2)}`,
        ).toBeGreaterThanOrEqual(-0.31);
    }
  });

  test('one-way paths have no lane against them; two-way ones have lanes both ways unless OSM says otherwise', () => {
    for (const p of modelled) {
      if (p.oneway) expect(p.layout!.back).toBe(0);
      expect(p.layout!.fwd).toBeGreaterThanOrEqual(p.layout!.back);
    }
  });

  test('sidewalks are 0 - 8 m; marks are consistent with the layout', () => {
    for (const p of modelled) {
      for (const w of p.sidewalk!) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(8);
      }
      // a double yellow only on a two-way street with a lane each way
      if (p.marks!.centre === 'double_yellow') {
        expect(p.layout!.back).toBeGreaterThanOrEqual(1);
        expect(p.oneway).toBeFalsy();
      }
      expect(p.marks!.stop).toHaveLength(2);
    }
  });

  test('the baked width of a carriageway is never above lanes x 3.3 + 0.8 (the baker narrows it beside the stage road); the model leaves it alone', () => {
    for (const p of modelled)
      if (p.kind === 'motorway' && p.lanes)
        expect(p.width).toBeLessThanOrEqual(p.lanes * 3.3 + 0.8 + 0.05);
  });
});
