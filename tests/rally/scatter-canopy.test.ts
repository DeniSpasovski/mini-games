import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import type {
  LandcoverDef,
  RasterDef,
  RoadDef,
} from '../../src/games/rally/maps/shared/types';
import type { TerrainSampler } from '../../src/games/rally/world/heightfield';
import { Landcover, Raster } from '../../src/games/rally/world/real-data';
import { Road } from '../../src/games/rally/world/road';
import {
  canopyKeep,
  canopySize,
  ScatterField,
} from '../../src/games/rally/world/scatter';

/** Bytes -> the bake's run-length base64 (runs < 128). */
function rle(bytes: number[]): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length;) {
    let j = i;
    while (j < bytes.length && bytes[j] === bytes[i] && j - i < 127) j++;
    out.push(bytes[i], j - i);
    i = j;
  }
  return btoa(String.fromCharCode(...out));
}

/** A raster over x, z in [-64, 64] (8 m cells): `f(x, z)` at each sample. */
function raster(scale: number, f: (x: number, z: number) => number): RasterDef {
  const v: number[] = [];
  for (let j = 0; j <= 16; j++)
    for (let i = 0; i <= 16; i++) v.push(f(-64 + i * 8, -64 + j * 8));
  return {
    originX: -64,
    originZ: -64,
    cell: 8,
    cols: 17,
    rows: 17,
    rle: rle(v),
    scale,
  };
}

const flat: TerrainSampler = {
  chunkSize: 64,
  height: () => 0,
  normal: (_x, _z, out: Vector3) => out.set(0, 1, 0),
};

// Along z = 40, north of the chunks the tests count (z < 0).
const road = new Road(
  {
    points: [
      [-300, 40],
      [0, 40],
      [300, 40],
    ],
    width: 6,
    shoulder: 0.5,
    ditch: 0,
    crown: 0,
    smoothing: 0,
    surface: 'gravel',
  } as RoadDef,
  () => 0,
);

/** Wood (zone 0) west of x = 0, urban (zone 1) east; canopy closed and 20 m tall in the wood, none east. */
function landcover(): Landcover {
  const zones: number[] = [];
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) zones.push(i < 8 ? 0 : 1);
  return new Landcover({
    originX: -64,
    originZ: -64,
    cell: 8,
    cols: 16,
    rows: 16,
    rle: rle(zones),
    zones: [{ cover: 'wood' }, { cover: 'urban' }],
    splat: {},
    canopy: {
      cover: raster(0.25, (x) => (x < -8 ? 4 : 0)),
      height: raster(2, (x) => (x < -8 ? 10 : 0)),
    },
  } as LandcoverDef);
}

function field(lc: Landcover): ScatterField {
  return new ScatterField(
    flat,
    road,
    7,
    [
      {
        asset: 'oak_tree',
        cover: ['wood', 'urban'],
        density: 20,
        scale: [1, 1],
        canopy: { full: 0.85, min: 0.125, height: 10 },
      },
    ],
    () => true,
    () => false,
    flat,
    { landcover: lc },
  );
}

describe('scatter: real canopy', () => {
  test('raster reads bilinear between samples, 0 outside', () => {
    const r = new Raster(raster(0.5, (x) => (x < 0 ? 0 : 8)));
    expect(r.at(-20, 0)).toBe(0);
    expect(r.at(20, 0)).toBe(4);
    expect(r.at(-4, 0)).toBeCloseTo(2);
    expect(r.at(500, 0)).toBe(0);
  });

  test('keep share and size from the canopy', () => {
    const c = { full: 0.8, min: 0.125, height: 10 };
    expect(canopyKeep(c, 0.1)).toBe(0);
    expect(canopyKeep(c, 0.4)).toBeCloseTo(0.5);
    expect(canopyKeep(c, 0.9)).toBe(1);
    expect(canopySize(c, 12)).toBeCloseTo(1.2);
    expect(canopySize(c, 40)).toBe(1.4);
    expect(canopySize(c, 0)).toBe(1);
    expect(canopySize({ full: 0.8, min: 0.1 }, 20)).toBe(1);
  });

  test('a canopy rule grows only under the canopy, sized by the stand', () => {
    const f = field(landcover());
    const west = f.chunk(-1, -1).instances;
    const east = f.chunk(0, -1).instances;
    expect(west.length).toBeGreaterThan(40);
    expect(east.length).toBe(0);
    // stand 20 m / 10 m -> the 1.4 cap (times the species' own size range)
    const plain = field(
      new Landcover({ ...landcover().def, canopy: undefined }),
    );
    const mean = (l: { scale: number }[]) =>
      l.reduce((s, i) => s + i.scale, 0) / l.length;
    expect(mean(west) / mean(plain.chunk(-1, -1).instances)).toBeCloseTo(
      1.4,
      1,
    );
    // the far forest estimate thins the same way
    const seen: string[] = [];
    f.treeRulesAt(30, -30, (a) => seen.push(a));
    expect(seen).toEqual([]);
  });

  test('real trees: species by cover, kept off the road and unlisted covers', () => {
    const f = new ScatterField(
      flat,
      road,
      7,
      [],
      () => true,
      () => false,
      flat,
      {
        landcover: landcover(),
      },
    );
    const placed = f.addRealTrees({
      // urban, wood (not listed), urban beside the road edge
      trees: [30, -30, 8, -30, -30, 15, 30, 38, 8],
      assets: { urban: ['fruit_tree'] },
      minRoadDist: 3,
      scale: [0.5, 1.5],
    });
    expect(placed).toBe(1);
    const [t] = [...f.fixedInstances()];
    expect(t.asset).toBe('fruit_tree');
    expect(Math.abs(t.x - 30)).toBeLessThanOrEqual(0.5);
    expect(t.tree).toBeDefined();
    // the far forest sees it
    const seen: string[] = [];
    f.treeRulesAt(30, -30, (a) => seen.push(a));
    expect(seen).toContain('fruit_tree');
  });
});
