import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat, and the side
 * graphic - a crescent swoosh with a cluster of four-point stars, redrawn as shapes after the owner's reference picture
 * (no lettering), always pointing forward.
 */
const A = source.atlas;
const { K, B, CH, Painter } = atlasKit(A);

const YELLOW = '#e8f03a';
/** Vertical extent on the body side (m): 10 cm above the body's lower edge up to 10 cm below the window sills. */
const Y_BOTTOM = 0.23;
const Y_TOP = 0.8;
/** Reference picture rows spanned by the graphic (crescent tip to lower end). */
const REF_Y = [121, 222];
const PX = (Y_TOP - Y_BOTTOM) / (REF_Y[1] - REF_Y[0]);
/** The crescent's lower-left end ("tail") sits over the rear wheel arch (z, m); the graphic grows forward from there. */
const TAIL_Z = -0.957;
const AT_Z = TAIL_Z + (295 - 168) * PX;

/** Reference picture coordinates (px, y down): the crescent outline, sweeping from the lower end round the left bulge to the upper tip. */
const CRESCENT: Pt[] = [
  [283, 217],
  [272, 220],
  [250, 222],
  [225, 222],
  [200, 219],
  [181, 212],
  [170, 204],
  [168, 195],
  [185, 185],
  [205, 172],
  [225, 162],
  [252, 151],
  [285, 141],
  [320, 132],
  [360, 125],
  [400, 121],
  [422, 121],
  [395, 126],
  [355, 132],
  [315, 140],
  [280, 151],
  [253, 162],
  [235, 173],
  [226, 184],
  [229, 195],
  [243, 204],
  [262, 211],
];
/** Four-point stars: centre x, y (px) and horizontal / vertical point length. */
const STARS: [number, number, number, number][] = [
  [278, 178, 38, 24],
  [344, 180, 19, 14],
  [321, 189, 14, 11],
  [350, 194, 14, 11],
  [297, 207, 13, 10],
  [331, 205, 13, 10],
];

/** Chaikin corner cutting: rounds the hand-placed outline. */
function smooth(pts: Pt[], rounds = 3): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      q.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75],
      );
    }
    p = q;
  }
  return p;
}

/** Four-point star with concave sides, as a reference-px polygon. */
function star(cx: number, cy: number, rh: number, rv: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const k = i % 2 ? 0.2 : 1;
    pts.push([cx + Math.cos(a) * rh * k, cy + Math.sin(a) * rv * k]);
  }
  return pts;
}

/**
 * Reference px -> body side (z, y). The same z on both sides: the graphic always points forward (stars towards the nose),
 * so it is mirrored on one side - the side charts are viewer-oriented, the painter flips z for the left one itself.
 */
const at = ([x, y]: Pt): Pt => [
  AT_Z + (x - 295) * PX,
  Y_BOTTOM + (REF_Y[1] - y) * PX,
];

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Dark undercoat on the bottom chart (bumper / sill undersides).
  const [bx, by] = CH.bottom;
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(bx * K, by * K, (B.z[1] - B.z[0]) * K, (B.x[1] - B.x[0]) * K);

  const p = new Painter(ctx);
  p.side(smooth(CRESCENT).map(at), YELLOW);
  for (const [cx, cy, rh, rv] of STARS)
    p.side(star(cx, cy, rh, rv).map(at), YELLOW);
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
