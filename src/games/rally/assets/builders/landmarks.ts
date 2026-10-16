import { CylinderGeometry, type BufferGeometry } from 'three';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';
import { slab, strut } from './power';

/**
 * Big landmarks that must read from far away (Vodno: the Millennium Cross, the antenna mast on the ridge, the cable car
 * pylons). Procedural lattice work, origin at ground level, no real-world marks or lettering. The cross and the mast
 * also have a far version (their last LOD) drawn with the horizon backdrop (world/horizon.ts), so they stay on the
 * skyline beyond the streamed scatter.
 */

type V3 = [number, number, number];

/** Millennium Cross: height (m) of the real one, the arm's centre height and half span (approximate proportions). */
export const CROSS_H = 66;
const CROSS_ARM_Y = 46;
const CROSS_ARM_HALF = 14;
/** Section of the lattice shaft / arm (m, full width). */
const CROSS_SHAFT_W = 2.8;
const CROSS_ARM_W = 2.2;
/** The foot goes this deep into the slope (the summit ground under it is not level). */
const CROSS_FOOT = 8;
const STEEL_WHITE = '#e6e8e6';

/** AEK antenna mast on the ridge: height (m) of the real one. */
export const MAST_H = 155;
const MAST_BODY = 122;
const MAST_R0 = 3.6;
const MAST_R1 = 0.95;
const RED = '#c4372d';
const WHITE = '#ecebe6';

/** Cable car pylon: unit height (m); instances scale it uniformly. */
export const GONDOLA_PYLON_H = 20;
/** The two ropes hang this far to each side of the pylon's axis, a little above its head (unit scale). */
export const GONDOLA_ROPE_LAT = 2.1;
export const GONDOLA_ROPE_Y = GONDOLA_PYLON_H + 0.9;
const PYLON_GREY = '#8a9189';

/**
 * A square-section lattice beam from `a` to `b`: four corner chords, rings and X braces on the four faces every
 * `bay` m. `p` and `q` are the unit vectors across the section.
 */
function lattice(
  parts: BufferGeometry[],
  a: V3,
  b: V3,
  p: V3,
  q: V3,
  half: number,
  o: {
    bay: number;
    chord: number;
    ring?: number;
    brace?: number;
    color: string;
  },
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.round(len / o.bay));
  const at = (t: number, sp: number, sq: number): V3 => [
    a[0] + (b[0] - a[0]) * t + (p[0] * sp + q[0] * sq) * half,
    a[1] + (b[1] - a[1]) * t + (p[1] * sp + q[1] * sq) * half,
    a[2] + (b[2] - a[2]) * t + (p[2] * sp + q[2] * sq) * half,
  ];
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  for (const [sp, sq] of corners)
    parts.push(strut(at(0, sp, sq), at(1, sp, sq), o.chord, o.color));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (o.ring)
      for (let i = 0; i < 4; i++) {
        const [s0, r0] = corners[i];
        const [s1, r1] = corners[(i + 1) % 4];
        parts.push(strut(at(t, s0, r0), at(t, s1, r1), o.ring, o.color));
      }
    if (o.brace && k < n) {
      const t1 = (k + 1) / n;
      for (let i = 0; i < 4; i++) {
        const [s0, r0] = corners[i];
        const [s1, r1] = corners[(i + 1) % 4];
        // Alternate the diagonal's direction bay by bay.
        const flip = k % 2 === 0;
        parts.push(
          strut(
            at(t, flip ? s0 : s1, flip ? r0 : r1),
            at(t1, flip ? s1 : s0, flip ? r1 : r0),
            o.brace,
            o.color,
          ),
        );
      }
    }
  }
}

/**
 * `millennium_cross`: a 66 m lattice steel Latin cross (the 2002 monument on Krstovar above Skopje). LOD 0 = full
 * lattice, LOD 1 = coarse lattice, LOD 2 = solid slabs (the horizon backdrop draws this one, so it is fat enough to
 * read at several kilometres).
 */
export const millenniumCross: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  const X: V3 = [1, 0, 0];
  const Y: V3 = [0, 1, 0];
  const Z: V3 = [0, 0, 1];
  if (lod >= 2) {
    const w = 3;
    parts.push(
      slab(w, CROSS_H + 15, w, 0, (CROSS_H - 15) / 2, 0, STEEL_WHITE),
      slab(CROSS_ARM_HALF * 2, w * 0.85, w, 0, CROSS_ARM_Y, 0, STEEL_WHITE),
    );
  } else {
    const fine = lod === 0;
    lattice(
      parts,
      [0, -CROSS_FOOT, 0],
      [0, CROSS_H, 0],
      X,
      Z,
      CROSS_SHAFT_W / 2,
      fine
        ? { bay: 3.3, chord: 0.3, ring: 0.14, brace: 0.12, color: STEEL_WHITE }
        : { bay: 8, chord: 0.7, ring: 0.4, brace: 0.45, color: STEEL_WHITE },
    );
    lattice(
      parts,
      [-CROSS_ARM_HALF, CROSS_ARM_Y, 0],
      [CROSS_ARM_HALF, CROSS_ARM_Y, 0],
      Y,
      Z,
      CROSS_ARM_W / 2,
      fine
        ? { bay: 2.8, chord: 0.26, ring: 0.13, brace: 0.11, color: STEEL_WHITE }
        : { bay: 7, chord: 0.6, ring: 0.35, brace: 0.4, color: STEEL_WHITE },
    );
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.82 + 0.18 * Math.min(1, Math.max(0, y) / CROSS_H));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

/** Radius of the mast's triangular body at height y. */
const mastR = (y: number): number =>
  MAST_R0 + (MAST_R1 - MAST_R0) * Math.min(1, y / MAST_BODY);

/** Red / white band colour of the mast at height y (aviation marking, 15 m bands). */
const mastBand = (y: number): string =>
  Math.floor(y / 15) % 2 === 0 ? RED : WHITE;

/**
 * `antenna_mast`: a 155 m red / white lattice mast (the antenna tower on the Vodno ridge): triangular body, a slim
 * antenna above it. LOD 2 is a tapered solid prism for the horizon backdrop.
 */
export const antennaMast: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  if (lod >= 2) {
    // Tapered triangular prism in 15 m bands.
    for (let y = 0; y < MAST_BODY; y += 15) {
      const y1 = Math.min(MAST_BODY, y + 15);
      const g = new CylinderGeometry(
        mastR(y1) * 1.9,
        mastR(y) * 1.9,
        y1 - y,
        3,
      );
      g.translate(0, (y + y1) / 2, 0);
      parts.push(planarUV(paint(g, mastBand(y)), 0.5));
    }
    parts.push(
      slab(
        0.9,
        MAST_H - MAST_BODY + 2,
        0.9,
        0,
        (MAST_H + MAST_BODY) / 2,
        0,
        RED,
      ),
    );
  } else {
    const bay = lod === 0 ? 6 : 15;
    const n = Math.round(MAST_BODY / bay);
    const corner = (y: number, i: number): V3 => {
      const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
      return [Math.cos(a) * mastR(y), y, Math.sin(a) * mastR(y)];
    };
    for (let k = 0; k < n; k++) {
      const y0 = (k * MAST_BODY) / n;
      const y1 = ((k + 1) * MAST_BODY) / n;
      const col = mastBand((y0 + y1) / 2);
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        parts.push(strut(corner(y0, i), corner(y1, i), 0.34, col));
        parts.push(
          strut(
            corner(y0, k % 2 ? i : j),
            corner(y1, k % 2 ? j : i),
            0.14,
            '#8b9096',
          ),
        );
        if (lod === 0)
          parts.push(strut(corner(y1, i), corner(y1, j), 0.13, '#8b9096'));
      }
    }
    parts.push(
      slab(
        0.5,
        MAST_H - MAST_BODY + 1,
        0.5,
        0,
        (MAST_H + MAST_BODY) / 2,
        0,
        RED,
      ),
    );
    if (lod === 0) {
      // Platform ring and a few dishes' worth of mass at the shoulder of the body.
      parts.push(slab(3.2, 0.3, 3.2, 0, MAST_BODY - 2, 0, '#6e7378'));
      parts.push(slab(1.4, 1.4, 1.4, 1.6, MAST_BODY - 6, 0.4, '#c9cbc8'));
    }
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.8 + 0.2 * Math.min(1, y / MAST_H));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

/**
 * `gondola_pylon`: lattice support of the cable car (20 m at unit scale). The ropes run along local X, two of them
 * `GONDOLA_ROPE_LAT` m to each side on the head arm, over a pair of sheave wheels (world/aerialway-mesh.ts hangs the
 * ropes at `GONDOLA_ROPE_Y`).
 */
export const gondolaPylon: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [];
  const H = GONDOLA_PYLON_H;
  const base = 2.4;
  const top = 0.85;
  const r = (y: number): number => base + (top - base) * (y / H);
  const corners = (y: number): [number, number][] => [
    [r(y), r(y)],
    [r(y), -r(y)],
    [-r(y), -r(y)],
    [-r(y), r(y)],
  ];
  const lo = corners(0);
  const hi = corners(H);
  for (let i = 0; i < 4; i++)
    parts.push(
      strut([lo[i][0], 0, lo[i][1]], [hi[i][0], H, hi[i][1]], 0.3, PYLON_GREY),
    );
  if (lod === 0) {
    const levels = [0.25, 0.5, 0.75].map((f) => f * H);
    for (const y of [0, ...levels, H]) {
      const c = corners(y);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        parts.push(
          strut([c[i][0], y, c[i][1]], [c[j][0], y, c[j][1]], 0.14, PYLON_GREY),
        );
      }
    }
    const ys = [0, ...levels, H];
    for (let k = 0; k + 1 < ys.length; k++) {
      const c0 = corners(ys[k]);
      const c1 = corners(ys[k + 1]);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        parts.push(
          strut(
            [c0[i][0], ys[k], c0[i][1]],
            [c1[j][0], ys[k + 1], c1[j][1]],
            0.11,
            PYLON_GREY,
          ),
        );
      }
    }
  }
  // Head: a cross arm over the top, a walkway and the two sheave trains.
  parts.push(
    slab(1.2, 0.5, GONDOLA_ROPE_LAT * 2 + 2.4, 0, H + 0.1, 0, PYLON_GREY),
  );
  parts.push(slab(3.4, 0.2, 1.1, 0, H + 0.45, 0, '#6d736d'));
  for (const s of [-1, 1]) {
    const wheel = new CylinderGeometry(0.75, 0.75, 0.35, lod === 0 ? 10 : 6);
    wheel.rotateX(Math.PI / 2).translate(0, H + 0.1, s * GONDOLA_ROPE_LAT);
    parts.push(planarUV(paint(wheel, '#2f3336'), 0.5));
  }
  const g = merge(parts);
  shade(g, (_x, y) => 0.72 + 0.28 * Math.min(1, y / H));
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};
