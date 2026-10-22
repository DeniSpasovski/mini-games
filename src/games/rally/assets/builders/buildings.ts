import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import { HOUSE_WALL_FRACTION } from '../catalog';
import { HOUSE_LAYER } from '../../engine/house-walls';
import type { AssetBuilder } from '../types';

/**
 * Placeholder buildings for real-world maps. UNIT footprint: x (long side / width) and
 * z (depth) in [-0.5, 0.5], y in [0, 1]. Instances are scaled per axis to the real
 * footprint and height (ScatterInstance sx / sy / sz), so details are relative.
 *
 * Variants: v % 4 = style, v >= 4 = two floors of windows (else one).
 * Buildings get detailed one by one later ("stage 1 - building N - lat, lon").
 */

/** Wall top of the sloped-roof house as a fraction of its total height (roof = the rest). */
const HOUSE_WALL = HOUSE_WALL_FRACTION;

/** Texture-array layer of every vertex (-1 = detail map x vertex colour; see engine/house-walls.ts). */
function setLayer(g: BufferGeometry, layer: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute(
    'layer',
    new BufferAttribute(new Float32Array(n).fill(layer), 1),
  );
  return g;
}

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  rng?: Rng,
  layer = -1,
) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return setLayer(planarUV(paint(g, color, rng, rng ? 0.03 : 0), 0.3), layer);
};

/** Triangles (flat shaded) from a flat list of [x,y,z] triples. */
function tris(points: number[][], color: string, layer = -1): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(points.flat()), 3),
  );
  g.computeVertexNormals();
  return setLayer(planarUV(paint(g, color), 0.3), layer);
}

/** Windows (and a door) on the four walls, protruding a hair from the faces. */
function openings(
  parts: BufferGeometry[],
  rows: number,
  wallTop: number,
  frame: string,
  door: string,
): void {
  const glass = '#2c3238';
  const e = 0.504;
  const rowH = wallTop / rows;
  for (let r = 0; r < rows; r++) {
    const y = rowH * r + rowH * 0.58;
    const h = rowH * 0.36;
    for (const x of [-0.32, 0, 0.32]) {
      if (r === 0 && x === 0) continue; // door below
      for (const z of [-e, e]) {
        parts.push(box(0.13, h * 1.12, 0.004, x, y, z, frame));
        parts.push(box(0.1, h, 0.008, x, y, z, glass));
      }
    }
    for (const x of [-e, e]) {
      parts.push(box(0.004, h * 1.12, 0.17, x, y, 0, frame));
      parts.push(box(0.008, h, 0.13, x, y, 0, glass));
    }
  }
  const dh = rowH * 0.78;
  parts.push(box(0.1, dh, 0.01, 0, dh / 2, e, door));
}

// Styles: 0-2 render in three paints, 3 unfinished red clay brick, 4 / 5 lime-plastered rubble stone (hip / gable).
const WALLS = [
  '#f0ece2',
  '#e6d6a6',
  '#e0b49a',
  '#f4f0ea',
  '#f4f0ea',
  '#f4f0ea',
];
const WALL_LAYER = [
  HOUSE_LAYER.render,
  HOUSE_LAYER.render,
  HOUSE_LAYER.render,
  HOUSE_LAYER.clay,
  HOUSE_LAYER.rubble,
  HOUSE_LAYER.rubble,
];
// Multiplied onto the roof-tile scan: near white keeps the terracotta, the rest weathers it.
const ROOFS = ['#ffffff', '#f1e3da', '#e2cfc2', '#f7ebe3'];

/** House with a sloped red-tile roof: hip (even styles) or gable (odd styles). */
export const housePitched: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const style = variant % 6;
  const rows = variant >= 6 ? 2 : 1;
  const wall = WALLS[style];
  const roof = rng.pick(ROOFS);
  const W = HOUSE_WALL;
  const parts: BufferGeometry[] = [];
  parts.push(box(1, W, 1, 0, W / 2, 0, wall, rng, WALL_LAYER[style]));
  if (lod === 0) {
    parts.push(box(1.012, 0.05, 1.012, 0, 0.025, 0, '#8e8a82'));
    // Unfinished brick houses: grey concrete slabs at the floor lines.
    if (style === 3)
      for (let r = 1; r <= rows; r++)
        parts.push(
          box(1.01, 0.025, 1.01, 0, (W / rows) * r - 0.0125, 0, '#b9b6ae'),
        );
    openings(parts, rows, W, style === 3 ? '#9a9890' : '#f2f0ea', '#5b3b28');
  }
  // Roof: a slab with a top, an underside and edges (tile thickness `T`), so it holds up from below and from the side.
  const o = 0.07; // eave overhang
  const T = 0.02; // slab thickness (unit height)
  const y0 = W - 0.015;
  const X = 0.5 + o;
  const Z = 0.5 + o;
  // Roof planes (polygons) and the outer edges of the slab (the ridge and the hip lines are shared, no edge there).
  let planes: number[][][];
  let outline: number[][][];
  if (style % 2 === 0) {
    // Hip: ridge along x.
    const rx = 0.24;
    const a = [-X, y0, Z];
    const b = [X, y0, Z];
    const c = [X, y0, -Z];
    const d = [-X, y0, -Z];
    const r1 = [rx, 1, 0];
    const r0 = [-rx, 1, 0];
    planes = [
      [a, b, r1, r0],
      [c, d, r0, r1],
      [b, c, r1],
      [d, a, r0],
    ];
    outline = [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ];
  } else {
    // Gable: ridge along x, triangular gable walls at the ends; the roof overhangs them.
    const a = [-X, y0, Z];
    const b = [X, y0, Z];
    const c = [X, y0, -Z];
    const d = [-X, y0, -Z];
    const r1 = [X, 1, 0];
    const r0 = [-X, 1, 0];
    planes = [
      [a, b, r1, r0],
      [c, d, r0, r1],
    ];
    outline = [
      [a, b],
      [c, d],
      [b, r1],
      [r1, c],
      [d, r0],
      [r0, a],
    ];
    parts.push(
      tris(
        [
          [0.5, W, 0.5],
          [0.5, W, -0.5],
          [0.5, 1 - 0.02, 0],
          [-0.5, W, -0.5],
          [-0.5, W, 0.5],
          [-0.5, 1 - 0.02, 0],
        ],
        wall,
        WALL_LAYER[style],
      ),
    );
  }
  const down = (p: number[]) => [p[0], p[1] - T, p[2]];
  const fan = (poly: number[][], facing: number[]): number[][] => {
    // Triangle fan of a convex polygon, wound so its normal points along `facing`.
    const out: number[][] = [];
    for (let k = 1; k < poly.length - 1; k++)
      out.push(poly[0], poly[k], poly[k + 1]);
    const [p0, p1, p2] = out;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const dot = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2];
    if (dot >= 0) return out;
    // Reverse every triangle.
    const rev: number[][] = [];
    for (let k = 0; k < out.length; k += 3)
      rev.push(out[k], out[k + 2], out[k + 1]);
    return rev;
  };
  const centre = [0, (y0 + 1) / 2, 0];
  const top: number[][] = [];
  const under: number[][] = [];
  const edges: number[][] = [];
  for (const poly of planes) {
    top.push(...fan(poly, [0, 1, 0]));
    under.push(...fan(poly.map(down), [0, -1, 0]));
  }
  for (const [p, q] of outline) {
    const mid = [
      (p[0] + q[0]) / 2,
      (p[1] + q[1]) / 2 - T / 2,
      (p[2] + q[2]) / 2,
    ];
    edges.push(
      ...fan(
        [p, q, down(q), down(p)],
        [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]],
      ),
    );
  }
  const rg = tris(top, roof, HOUSE_LAYER.roof);
  shade(rg, (_x, y) => 0.85 + 0.15 * ((y - y0) / (1 - y0)));
  parts.push(rg);
  // Underside (rafters, in shadow) and the thin edge of the tiles.
  parts.push(tris(under, '#8a7666'));
  parts.push(tris(edges, '#8c6650'));
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('house') }],
  };
};

/**
 * Flat-roofed building. Styles: 0/1 industrial hall (no windows, band, roller door),
 * 2 unfinished brick block, 3 rendered block (shop / flat-roof house).
 */
export const buildingFlat: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const style = variant % 4;
  const rows = variant >= 4 ? 2 : 1;
  const parts: BufferGeometry[] = [];
  const top = 0.965;
  const body = ['#f0f2f2', '#d6dadb', '#f4f0ea', '#f0e9da'][style];
  const layer = [
    HOUSE_LAYER.sheet,
    HOUSE_LAYER.sheet,
    HOUSE_LAYER.clay,
    HOUSE_LAYER.render,
  ][style];
  parts.push(box(1, top, 1, 0, top / 2, 0, body, rng, layer));
  // Parapet / roof edge and roof membrane.
  const cap = style < 2 ? '#7d8287' : style === 2 ? '#8f8c86' : '#a7a29a';
  parts.push(box(1.01, 1 - top, 1.01, 0, (top + 1) / 2, 0, cap));
  parts.push(box(0.97, 0.004, 0.97, 0, 1.002, 0, '#6d6f70'));
  if (lod === 0) {
    parts.push(box(1.008, 0.04, 1.008, 0, 0.02, 0, '#8a8780'));
    if (style < 2) {
      const accent = style === 0 ? '#5d7591' : '#8a4a3a';
      parts.push(box(1.006, 0.08, 1.006, 0, 0.8, 0, accent));
      parts.push(box(0.16, 0.5, 0.01, 0.22, 0.25, 0.504, '#8d9296'));
      parts.push(box(0.08, 0.28, 0.01, -0.3, 0.14, 0.504, '#4b5157'));
    } else {
      if (style === 2)
        for (let r = 1; r <= rows; r++)
          parts.push(
            box(1.01, 0.03, 1.01, 0, (top / rows) * r - 0.015, 0, '#b9b6ae'),
          );
      openings(
        parts,
        rows,
        top,
        style === 2 ? '#9a9890' : '#f2f0ea',
        '#4a3a30',
      );
    }
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('house') }],
  };
};
