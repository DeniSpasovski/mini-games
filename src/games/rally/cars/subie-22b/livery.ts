import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat, and the side
 * star graphic (yellow crescent, three streaks, a cluster of four-point stars - generic shapes, no logo, no lettering).
 * Side points are (z, y) in model metres, front = +z.
 */
const A = source.atlas;
const { K, B, CH, Painter } = atlasKit(A);

/** The graphic sits between the wheel arches; shapes below are drawn around the rear quarter and shifted forward. */
const FWD = 0.5;
const YELLOW = '#f4c20d';
const EDGE = '#2aa7d8';

/** Crescent sweeping from the rear quarter along the sill, tip rising at the door's front edge. */
const CRESCENT: Pt[] = [
  [-2.25, 0.8],
  [-2.2, 0.6],
  [-2.05, 0.44],
  [-1.8, 0.34],
  [-1.4, 0.29],
  [-1.0, 0.28],
  [-0.65, 0.31],
  [-0.4, 0.38],
  [-0.28, 0.46],
  [-0.5, 0.43],
  [-0.75, 0.38],
  [-1.05, 0.37],
  [-1.4, 0.38],
  [-1.7, 0.43],
  [-1.9, 0.52],
  [-2.0, 0.64],
  [-2.05, 0.8],
];

const shift = (pts: Pt[], dz: number, dy = 0): Pt[] =>
  pts.map(([z, y]) => [z + dz, y + dy]);

/** Four-point star of outer radius r (m) at (z, y). */
function star(z: number, y: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.28 : r;
    pts.push([z + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  return pts;
}

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Dark undercoat on the bottom chart (bumper / sill undersides).
  const [bx, by] = CH.bottom;
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(bx * K, by * K, (B.z[1] - B.z[0]) * K, (B.x[1] - B.x[0]) * K);

  const p = new Painter(ctx);
  p.side(shift(CRESCENT, FWD), EDGE);
  p.side(shift(CRESCENT, FWD + 0.02, 0.008), YELLOW);
  for (const [z, w] of [
    [-1.55, 0.07],
    [-1.74, 0.065],
    [-1.92, 0.06],
  ] as const)
    p.side(
      shift(
        [
          [z, 0.5],
          [z - w, 0.5],
          [z - w - 0.26, 0.88],
          [z - 0.26, 0.88],
        ],
        FWD,
      ),
      YELLOW,
    );
  for (const [z, y, r] of [
    [-1.05, 0.56, 0.09],
    [-0.83, 0.5, 0.055],
    [-1.28, 0.6, 0.05],
    [-1.12, 0.7, 0.045],
    [-0.9, 0.42, 0.04],
  ] as const)
    p.side(star(z + FWD, y, r), YELLOW);
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
