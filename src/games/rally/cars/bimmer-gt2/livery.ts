import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import { Rng } from '../../../../shared/rng';
import { CELL, blocks } from './livery-pattern';
import girth from './girth.json';
import source from './model.source.json';

/**
 * Runtime paint for the Bimmer GT2 BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, grille, wing,
 * splitter and diffuser are separate parts with their own materials (`gltf.parts` in model.source.json), so nothing
 * painted here can reach them. Seed 0 = diagonal white / blue / red pixel-block scheme (`livery-pattern.ts`), pearl white
 * behind PEARL_Z; other seeds recolour the same blocks with the seed's base / accent colours.
 */
const A = source.atlas;
const { K, B, CH, Painter } = atlasKit(A);

/**
 * The pattern's across-car coordinate p follows the girth: arc length round the body from the roof centre line
 * (`girth.json`, scripts/car-model/girth-table.py). The top chart reads it at |x|, the side charts at y, so a pillar or
 * shoulder that switches charts face by face gets the same block from both.
 */
const G = girth;
/** Girth below which a block is all roof (no side-chart face sits that high). */
const SIDE_P = 0.3;
/** Row of the table at z (linear between the two nearest cuts), metres; cached per millimetre of z. */
const rowCache = new Map<string, number[]>();
const girthRow = (rows: number[][], z: number): number[] => {
  const key = `${rows === G.top ? 't' : 's'}${Math.round(z * 1000)}`;
  let row = rowCache.get(key);
  if (!row) {
    const t = Math.min(rows.length - 1, Math.max(0, (z - G.z0) / G.dz));
    const i = Math.min(rows.length - 2, Math.floor(t));
    const f = t - i;
    row = rows[i].map((v, k) => ((1 - f) * v + f * rows[i + 1][k]) / 1000);
    rowCache.set(key, row);
  }
  return row;
};
/** Inverse of a monotone row: the sample coordinate where the row reaches girth g; 1:1 past either end. Top rows (rising,
 * |x| every dx) or side rows (falling, y every d). */
const invert = (row: number[], g: number, rising: boolean): number => {
  const n = row.length;
  const step = rising ? G.dx : G.d;
  const at = (k: number) => (rising ? row[k] : -row[k]);
  const v = rising ? g : -g;
  if (v <= at(0)) return v - at(0);
  for (let k = 1; k < n; k++)
    if (v <= at(k)) {
      const f = (v - at(k - 1)) / (at(k) - at(k - 1) || 1);
      return (k - 1 + f) * step;
    }
  return (n - 1) * step + v - at(n - 1);
};
/**
 * Below the waist the side keeps straight rows: p = P_REF + (yRef - y), so the rear quarter and doors read level although
 * the section shrinks behind the cabin (boot lower than the roof). Above it p is the girth scaled to fit the section
 * (P_REF at yRef); where that would squash the top more than F_MIN (hood, nose), yRef drops instead (rows dip forward).
 */
const Y_REF = 0.75;
const P_REF = 1.18;
/** Least top squash: the boot corner takes more (its rows stay level by the vent), the hood less. */
const F_MIN = (z: number) => (z < 0 ? 0.65 : 0.8);
/** Table rows past the body ends cut the wing / diffuser: read the end rows instead. */
const zClamp = (z: number) => Math.min(2.1, Math.max(-2.2, z));
const refCache = new Map<number, [number, number]>();
/** [yRef, girth at yRef] at z. */
const ref = (z: number): [number, number] => {
  const key = Math.round(z * 1000);
  let r = refCache.get(key);
  if (!r) {
    const row = girthRow(G.side, z);
    const y = Math.min(Y_REF, invert(row, F_MIN(z) * P_REF, false));
    const t = Math.min(row.length - 1.001, Math.max(0, y / G.d));
    const k = Math.floor(t);
    r = [y, row[k] + (t - k) * (row[k + 1] - row[k])];
    refCache.set(key, r);
  }
  return r;
};
/** Body girth of pattern coordinate |p| at z. */
const girthOf = (z: number, p: number) => {
  const [, s] = ref(z);
  return p <= P_REF ? (p * s) / P_REF : s + p - P_REF;
};
/** x on the top chart of pattern coordinate p at z (signed like p). */
const topX = (z: number, p: number) => {
  const zc = zClamp(z);
  return (
    Math.sign(p) * invert(girthRow(G.top, zc), girthOf(zc, Math.abs(p)), true)
  );
};
/** y on the side charts of pattern coordinate |p| at z. */
const sideY = (z: number, p: number) => {
  const zc = zClamp(z);
  const a = Math.abs(p);
  return a >= P_REF
    ? ref(zc)[0] - (a - P_REF)
    : invert(girthRow(G.side, zc), girthOf(zc, a), false);
};
/** Pattern polygon with its edges cut into STEP pieces, so the curved mapping bends them with the body. */
const STEP = 0.02;
const dense = (poly: Pt[]): Pt[] =>
  poly.flatMap(([z0, p0], i) => {
    const [z1, p1] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(z1 - z0, p1 - p0) / STEP));
    return Array.from({ length: n }, (_, k): Pt => [
      z0 + ((z1 - z0) * k) / n,
      p0 + ((p1 - p0) * k) / n,
    ]);
  });

/** |x| where the red blocks start on the rear end (half-way across a tail light). */
const REAR_X = 0.5;
/** The pearl edge is slightly narrower up on the boot lid. */
const REAR_LID_X = 0.44;
/** y of the boot lid's lower edge on the rear end. */
const REAR_LID_Y = 0.84;
/** Extra height of the arch at the middle. */
/** y where the pearl edge steps in from REAR_X to REAR_LID_X. */
const REAR_LID_SIDE_Y = 0.7;
const REAR_LID_ARCH = 0.05;
const PEARL = '#ece4d8';
const WHITES = [
  '#ece4d8',
  '#ece4d8',
  '#f4eee4',
  '#e2dad0',
  '#dcdbdd',
  '#cdd2da',
];
const BLUES = [
  '#0b3a8f',
  '#1252b8',
  '#1b78e0',
  '#3aa0f2',
  '#6cc3fb',
  '#082a6b',
];
const REDS = ['#d71f26', '#ee2f33', '#ff3d3a', '#f2594f', '#b0141f'];
const PALETTES = [WHITES, BLUES, REDS];

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];
const css = (c: number[]) =>
  `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;
/** Shade of the pattern colour: whites darken toward blue-grey, the rest plainly. */
const shaded = (c: string, f: number, white: boolean) => {
  const [r, g, b] = hex(c);
  return white
    ? css([r * f * 0.92, g * f * 0.96, b * f + 4])
    : css([r * f, g * f, b * f]);
};

/** Dark undercoat on the bottom chart (bumper / sill undersides). */
function underside(ctx: CanvasRenderingContext2D): void {
  const pts: Pt[] = [
    [CH.bottom[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1] + B.x[1] - B.x[0]],
    [CH.bottom[0], CH.bottom[1] + B.x[1] - B.x[0]],
  ];
  ctx.fillStyle = '#2a2c2f';
  ctx.beginPath();
  pts.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * K, y * K) : ctx.moveTo(x * K, y * K),
  );
  ctx.closePath();
  ctx.fill();
}

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  ctx.fillStyle = PEARL;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const P = new Painter(ctx);
  // seed 0: the reference colours; other seeds: base -> accent -> accent2 (shades of each)
  const bands =
    seed === 0 ? PALETTES : [[PEARL], [info.accent], [info.accent2]];
  const colour = (band: number, shade: number) =>
    bands[band][shade % bands[band].length];

  const draw = (poly: Pt[], fill: string) => {
    const pts = dense(poly);
    P.top(
      pts.map(([z, p]): Pt => [z, topX(z, p)]),
      fill,
      false,
    );
    // sides: the left side shows p > 0, the right side p < 0 (a block over the centre line never reaches a side)
    if (poly.some(([, p]) => p > SIDE_P))
      P.side(
        pts.map(([z, p]): Pt => [z, sideY(z, Math.max(0, p))]),
        fill,
        'left',
      );
    if (poly.some(([, p]) => p < -SIDE_P))
      P.side(
        pts.map(([z, p]): Pt => [z, sideY(z, Math.min(0, p))]),
        fill,
        'right',
      );
  };

  // a chessboard grown in 3D: every square keeps its full face, and the lines grow back from the faces that start one.
  // Faces first, then the shaded trails over the neighbours, then the faces that own a trail on top again.
  const all = blocks();
  for (const b of all) draw(b.face, colour(b.band, b.shade));
  for (const b of all) {
    if (!b.trail) continue;
    const base = colour(b.band, b.shade);
    draw(b.trail, seed === 0 ? shaded(base, b.trailF, b.band === 0) : base);
  }
  for (const b of all) if (b.trail) draw(b.face, colour(b.band, b.shade));
  // front end: white / silver-white squares (same block size); rear end: pearl white behind the plate
  const front = new Rng(5);
  for (let x = -1.2; x < 1.2; x += CELL)
    for (let y = 0; y < 1.4; y += CELL)
      P.end(
        'front',
        [
          [x, y],
          [x + CELL, y],
          [x + CELL, y + CELL],
          [x, y + CELL],
        ],
        seed === 0 ? front.pick(WHITES) : PEARL,
        false,
      );
  P.end(
    'rear',
    [
      [-1.2, 0],
      [1.2, 0],
      [1.2, 1.4],
      [-1.2, 1.4],
    ],
    PEARL,
  );
  // rear end: red blocks on the boot lid and the outer corners; the middle (plate area) stays pearl below an arched edge
  // that follows the lid's curve, and the vertical edges at +-REAR_X run straight down to the bumper
  if (seed === 0) {
    const rear = new Rng(9);
    for (let y = 0; y < 1.4; y += CELL)
      for (let x = -1.2; x < 1.2; x += CELL)
        P.end(
          'rear',
          [
            [x, y],
            [x + CELL, y],
            [x + CELL, y + CELL],
            [x, y + CELL],
          ],
          rear.pick(REDS),
          false,
        );
    const arch: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const x = -REAR_LID_X + (2 * REAR_LID_X * i) / 16;
      arch.push([x, REAR_LID_Y + REAR_LID_ARCH * (1 - (x / REAR_LID_X) ** 2)]);
    }
    P.end(
      'rear',
      [
        [-REAR_X, 0],
        [REAR_X, 0],
        [REAR_X, REAR_LID_SIDE_Y],
        [REAR_LID_X, REAR_LID_SIDE_Y],
        ...arch.reverse(),
        [-REAR_LID_X, REAR_LID_SIDE_Y],
        [-REAR_X, REAR_LID_SIDE_Y],
      ],
      PEARL,
      false,
    );
  }
  underside(ctx);
}

export const bimmerGt2Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
