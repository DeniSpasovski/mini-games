import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/**
 * Highway structures: bridge piers / abutments / retaining walls (`concrete_block`), median and
 * bridge-edge barriers (`jersey_barrier`) and steel guard rails (`guard_rail`).
 *
 * `concrete_block` is a UNIT box (x, z in [-0.5, 0.5], y in [0, 1]) scaled per instance (sx / sy / sz,
 * like the buildings). The barriers are real size, 4 m long along local X, so they are placed every 4 m
 * along the road with scale 1.
 */

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
  return planarUV(paint(g, color, rng, rng ? 0.035 : 0), 0.4);
};

/** Extruded polygon (x-z cross-section, same profile along x in [-hx, hx]) as flat-shaded triangles. */
function prism(
  profile: [number, number][],
  hx: number,
  color: string,
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
  return planarUV(paint(g, color), 0.4);
}

/** Plain weathered concrete block (unit footprint, scaled per instance): piers, abutments, retaining walls. */
export const concreteBlock: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [box(1, 1, 1, 0, 0.5, 0, '#aeaba3', rng)];
  if (lod === 0) {
    // Cap slab and a darker, stained foot.
    parts.push(box(1.01, 0.03, 1.01, 0, 0.985, 0, '#b8b5ae'));
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.8 + 0.2 * Math.min(1, y * 1.2));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
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
    [0.09, 0.81],
    [-0.09, 0.81],
    [-0.2, 0.33],
    [-0.3, 0.2],
  ];
  const parts = [
    prism(profile, hx, rng.pick(['#b4b1a9', '#aaa7a0', '#bcb9b1'])),
  ];
  if (lod === 0) {
    // Joint between the segments and the dark stain at the foot.
    parts.push(box(0.02, 0.5, 0.58, -hx + 0.01, 0.28, 0, '#7e7c76'));
    parts.push(box(0.02, 0.5, 0.58, hx - 0.01, 0.28, 0, '#7e7c76'));
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.78 + 0.22 * Math.min(1, y / 0.5));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

/**
 * Crash cushion at the nose of a gore area: a concrete backup block and a graduated row of yellow sand drums
 * (small at the nose, big at the back), 5.2 m long along X, nose at +X (facing the oncoming traffic).
 */
export const crashCushion: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [
    box(1.0, 0.9, 1.5, -2.35, 0.45, 0, '#aeaba3'),
  ];
  const drum = (x: number, z: number, r: number, h: number) => {
    const g = new CylinderGeometry(r, r * 1.04, h, lod === 0 ? 12 : 8);
    g.translate(x, h / 2, z);
    parts.push(planarUV(paint(g, '#f0c01e', undefined, 0), 0.4));
    if (lod === 0) {
      // Black reflective band near the top.
      const b = new CylinderGeometry(r * 1.02, r * 1.02, h * 0.18, 12);
      b.translate(x, h * 0.72, z);
      parts.push(planarUV(paint(b, '#1c1c1e', undefined, 0), 0.4));
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
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
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
