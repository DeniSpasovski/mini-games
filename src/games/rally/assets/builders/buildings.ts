import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import { HOUSE_WALL_FRACTION } from '../catalog';
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

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  rng?: Rng,
) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return planarUV(paint(g, color, rng, rng ? 0.03 : 0), 0.3);
};

/** Triangles (flat shaded) from a flat list of [x,y,z] triples. */
function tris(points: number[][], color: string): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(points.flat()), 3),
  );
  g.computeVertexNormals();
  return planarUV(paint(g, color), 0.3);
}

/** Quad a-b-c-d (counter-clockwise seen from outside) as two triangles. */
const quad = (a: number[], b: number[], c: number[], d: number[]) => [
  a,
  b,
  c,
  a,
  c,
  d,
];

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

const WALLS = ['#e7e1d3', '#e6d0a3', '#d8a47a', '#a65a3e'];
const ROOFS = ['#a4462e', '#b5532f', '#8f3f2b', '#9d4a33'];

/** House with a sloped red-tile roof: hip (even styles) or gable (odd styles). */
export const housePitched: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const style = variant % 4;
  const rows = variant >= 4 ? 2 : 1;
  const wall = WALLS[style];
  const roof = rng.pick(ROOFS);
  const W = HOUSE_WALL;
  const parts: BufferGeometry[] = [];
  parts.push(box(1, W, 1, 0, W / 2, 0, wall, rng));
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
  // Roof.
  const o = 0.07; // eave overhang
  const y0 = W - 0.015;
  const X = 0.5 + o;
  const Z = 0.5 + o;
  const pts: number[][] = [];
  if (style % 2 === 0) {
    // Hip: ridge along x.
    const rx = 0.24;
    pts.push(...quad([-X, y0, Z], [X, y0, Z], [rx, 1, 0], [-rx, 1, 0]));
    pts.push(...quad([X, y0, -Z], [-X, y0, -Z], [-rx, 1, 0], [rx, 1, 0]));
    pts.push([X, y0, Z], [X, y0, -Z], [rx, 1, 0]);
    pts.push([-X, y0, -Z], [-X, y0, Z], [-rx, 1, 0]);
  } else {
    // Gable: ridge along x, triangular gable walls at the ends.
    pts.push(...quad([-X, y0, Z], [X, y0, Z], [X, 1, 0], [-X, 1, 0]));
    pts.push(...quad([X, y0, -Z], [-X, y0, -Z], [-X, 1, 0], [X, 1, 0]));
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
      ),
    );
  }
  // Soffit under the eaves (seen from the road).
  pts.push(...quad([-X, y0, -Z], [X, y0, -Z], [X, y0, Z], [-X, y0, Z]));
  const rg = tris(pts, roof);
  shade(rg, (_x, y) =>
    y < y0 + 0.001 ? 0.55 : 0.85 + 0.15 * ((y - y0) / (1 - y0)),
  );
  parts.push(rg);
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
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
  const body = ['#d9dcdc', '#b9bdbf', '#a85d40', '#e4ddce'][style];
  parts.push(box(1, top, 1, 0, top / 2, 0, body, rng));
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
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};
