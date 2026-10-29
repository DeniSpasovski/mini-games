import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Vector3,
} from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { Rng } from '../../../../shared/rng';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { HOUSE_LAYER } from '../../engine/house-walls';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/**
 * Highway structures: bridge piers / abutments / retaining walls (`concrete_block`), median and
 * bridge-edge barriers (`jersey_barrier`) and steel guard rails (`guard_rail`).
 *
 * `concrete_block` is a UNIT box (x, z in [-0.5, 0.5], y in [0, 1]) scaled per instance (sx / sy / sz,
 * like the buildings). The barriers are real size, 4 m long along local X, so they are placed every 4 m
 * along the road with scale 1.
 *
 * Concrete wears the building walls' cast-concrete scan (`HOUSE_LAYER.block`, house material: texture coordinates in
 * metres from the instance scale); a `layer` of -1 keeps the detail map x vertex colour (drums, steel).
 */

/** Texture-array layer of every vertex (engine/house-walls.ts). */
function setLayer(g: BufferGeometry, layer: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute(
    'layer',
    new BufferAttribute(new Float32Array(n).fill(layer), 1),
  );
  return g;
}

const CONCRETE = HOUSE_LAYER.block;

/** Box with its edges and corners cut at 45 degrees by `c` (flat-shaded, non-indexed), on the concrete scan. */
function chamferBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  c: number,
  color: string,
  rng?: Rng,
): BufferGeometry {
  const pts: Vector3[] = [];
  const [a, b, e] = [w / 2, h / 2, d / 2];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        pts.push(
          new Vector3(sx * a, sy * (b - c), sz * (e - c)),
          new Vector3(sx * (a - c), sy * b, sz * (e - c)),
          new Vector3(sx * (a - c), sy * (b - c), sz * e),
        );
  const g = new ConvexGeometry(pts);
  g.translate(x, y, z);
  return setLayer(
    planarUV(paint(g, color, rng, rng ? 0.03 : 0), 0.4),
    CONCRETE,
  );
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
) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return setLayer(planarUV(paint(g, color, rng, rng ? 0.035 : 0), 0.4), -1);
};

/** Extruded polygon (x-z cross-section, same profile along x in [-hx, hx]) as flat-shaded triangles. */
function prism(
  profile: [number, number][],
  hx: number,
  color: string,
  layer = -1,
): BufferGeometry {
  const pts: number[][] = [];
  const n = profile.length;
  // Side faces.
  for (let i = 0; i < n; i++) {
    const [z0, y0] = profile[i];
    const [z1, y1] = profile[(i + 1) % n];
    pts.push(
      [-hx, y0, z0],
      [hx, y0, z0],
      [hx, y1, z1],
      [-hx, y0, z0],
      [hx, y1, z1],
      [-hx, y1, z1],
    );
  }
  // End caps (fan from the first vertex; the profile is convex).
  for (let i = 1; i < n - 1; i++) {
    pts.push(
      [hx, profile[0][1], profile[0][0]],
      [hx, profile[i][1], profile[i][0]],
      [hx, profile[i + 1][1], profile[i + 1][0]],
      [-hx, profile[0][1], profile[0][0]],
      [-hx, profile[i + 1][1], profile[i + 1][0]],
      [-hx, profile[i][1], profile[i][0]],
    );
  }
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(pts.flat()), 3),
  );
  g.computeVertexNormals();
  return setLayer(planarUV(paint(g, color), 0.4), layer);
}

/** Plain weathered concrete block (unit footprint, scaled per instance): piers, abutments, retaining walls. */
export const concreteBlock: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [
    lod === 0
      ? chamferBox(1, 0.97, 1, 0, 0.485, 0, 0.012, '#e6e4de', rng)
      : setLayer(
          planarUV(
            paint(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), '#e6e4de'),
            0.4,
          ),
          CONCRETE,
        ),
  ];
  if (lod === 0) {
    // Cap slab, chamfered too.
    parts.push(chamferBox(1.01, 0.03, 1.01, 0, 0.985, 0, 0.006, '#eeece6'));
  }
  const g = merge(parts);
  // Darker, stained foot.
  shade(g, (_x, y) => 0.8 + 0.2 * Math.min(1, y * 1.2));
  return { parts: [{ geometry: g, material: getMaterial('house') }] };
};

/** New Jersey concrete barrier, 4 m long along X (profile: wide base, sloped faces, 0.81 m high). */
export const jerseyBarrier: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const hx = 2;
  const profile: [number, number][] = [
    [-0.3, 0],
    [0.3, 0],
    [0.3, 0.2],
    [0.2, 0.33],
    // Top corners chamfered (2 cm).
    [0.092, 0.79],
    [0.075, 0.81],
    [-0.075, 0.81],
    [-0.092, 0.79],
    [-0.2, 0.33],
    [-0.3, 0.2],
  ];
  const parts = [
    prism(profile, hx, rng.pick(['#e8e6e0', '#dcdad3', '#f0eee8']), CONCRETE),
  ];
  if (lod === 0) {
    // Joint between the segments and the dark stain at the foot.
    parts.push(box(0.02, 0.5, 0.58, -hx + 0.01, 0.28, 0, '#7e7c76'));
    parts.push(box(0.02, 0.5, 0.58, hx - 0.01, 0.28, 0, '#7e7c76'));
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.78 + 0.22 * Math.min(1, y / 0.5));
  return { parts: [{ geometry: g, material: getMaterial('house') }] };
};

/**
 * Crash cushion at the nose of a gore area: a concrete backup block and a graduated row of yellow sand drums
 * (small at the nose, big at the back), 5.2 m long along X, nose at +X (facing the oncoming traffic).
 */
export const crashCushion: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [
    lod === 0
      ? chamferBox(1.0, 0.9, 1.5, -2.35, 0.45, 0, 0.02, '#e6e4de')
      : setLayer(box(1.0, 0.9, 1.5, -2.35, 0.45, 0, '#e6e4de'), CONCRETE),
  ];
  const drum = (x: number, z: number, r: number, h: number) => {
    const g = new CylinderGeometry(r, r * 1.04, h, lod === 0 ? 12 : 8);
    g.translate(x, h / 2, z);
    parts.push(setLayer(planarUV(paint(g, '#f0c01e', undefined, 0), 0.4), -1));
    if (lod === 0) {
      // Black reflective band near the top.
      const b = new CylinderGeometry(r * 1.02, r * 1.02, h * 0.18, 12);
      b.translate(x, h * 0.72, z);
      parts.push(
        setLayer(planarUV(paint(b, '#1c1c1e', undefined, 0), 0.4), -1),
      );
    }
  };
  // Rows from the nose: 1, 2, 2, 3 drums across, growing in size.
  const rows: [number, number[], number][] = [
    [2.35, [0], 0.3],
    [1.5, [-0.28, 0.28], 0.34],
    [0.55, [-0.34, 0.34], 0.4],
    [-0.55, [-0.6, 0, 0.6], 0.42],
  ];
  for (const [x, zs, r] of rows) for (const z of zs) drum(x, z, r, 0.9);
  const g = merge(parts);
  shade(g, (_x, y) => 0.8 + 0.2 * Math.min(1, y * 1.2));
  return { parts: [{ geometry: g, material: getMaterial('house') }] };
};

/** Steel W-beam guard rail on posts, 4 m long along X, rail top 0.75 m. */
export const guardRail: AssetBuilder = ({ lod }) => {
  const steel = '#b9bec2';
  const parts: BufferGeometry[] = [];
  // Corrugated rail: two ribs and a flat web (cheap W profile).
  parts.push(box(4, 0.11, 0.03, 0, 0.7, 0.045, steel));
  parts.push(box(4, 0.11, 0.03, 0, 0.55, 0.045, steel));
  parts.push(box(4, 0.2, 0.02, 0, 0.63, 0.02, '#a4a9ad'));
  if (lod === 0) {
    parts.push(box(4, 0.02, 0.07, 0, 0.77, 0.04, '#c7ccd0'));
    for (const x of [-1.9, 0, 1.9]) {
      parts.push(box(0.12, 0.8, 0.07, x, 0.4, 0.1, '#7d8185'));
      parts.push(box(0.14, 0.2, 0.09, x, 0.63, 0.075, '#656a6e'));
    }
  } else {
    for (const x of [-1.9, 1.9])
      parts.push(box(0.12, 0.8, 0.07, x, 0.4, 0.1, '#7d8185'));
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};
