import { Rng } from '../../../../shared/rng';
import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat, and the side
 * graphic - a crescent swoosh with a cluster of four-point stars, redrawn as shapes after the owner's reference picture
 * (no lettering), bulge and stars at the front, tip trailing back.
 */
const A = source.atlas;
const { K, B, CH, Painter, sidePx, frontPx, rearPx } = atlasKit(A);

const YELLOW = '#e8f03a';
/** Vertical extent on the body side (m): 10 cm above the body's lower edge up to 10 cm below the window sills. */
const Y_BOTTOM = 0.23;
const Y_TOP = 0.8;
/** Reference picture rows spanned by the graphic (crescent tip to lower end). */
const REF_Y = [121, 222];
const PX = (Y_TOP - Y_BOTTOM) / (REF_Y[1] - REF_Y[0]);
/** Rear end of the graphic (z, m), just in front of the rear wheel arch; it grows forward from there. */
const REAR_Z = -0.957;
/** Reference picture columns spanned by the graphic (crescent bulge to tip). */
const REF_X = [168, 422];

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
 * Reference px -> body side (z, y). The same z on both sides, and the picture is mirrored along the car: the bulge and
 * stars lead at the front, the tip trails back like a comet's tail. Seen from the left it reads like the picture (the
 * painter flips z for the left chart itself), from the right it is reversed.
 */
const at = ([x, y]: Pt): Pt => [
  REAR_Z + (REF_X[1] - x) * PX,
  Y_BOTTOM + (REF_Y[1] - y) * PX,
];

/** Dust and mud on the lower body: a fade towards the sills on every chart, plus road-spray speckle round the arches. */
function weather(ctx: CanvasRenderingContext2D, seed: number): void {
  const rng = new Rng(0x22b + seed);
  const yTop = 0.5; // dirt starts this high
  const yLow = B.y[0];
  const px = (
    chart: 'left' | 'right' | 'front' | 'rear',
    z: number,
    y: number,
  ): Pt =>
    chart === 'front'
      ? frontPx(z, y)
      : chart === 'rear'
        ? rearPx(z, y)
        : sidePx(chart, z, y);
  const size = (chart: 'left' | 'right' | 'front' | 'rear') =>
    chart === 'front' || chart === 'rear'
      ? [B.x[1] - B.x[0], B.y[1] - B.y[0]]
      : [B.z[1] - B.z[0], B.y[1] - B.y[0]];
  for (const chart of ['left', 'right', 'front', 'rear'] as const) {
    const [cx, cy] = CH[chart];
    const [w, h] = size(chart);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx * K, cy * K, w * K, h * K);
    ctx.clip();
    const g = ctx.createLinearGradient(
      0,
      px(chart, 0, yTop)[1],
      0,
      px(chart, 0, yLow)[1],
    );
    g.addColorStop(0, 'rgba(112,92,64,0)');
    g.addColorStop(1, 'rgba(112,92,64,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(cx * K, cy * K, w * K, h * K);
    // Speckle: spray thrown up by the wheels, densest low down and round the arches (z of the axles).
    const arches = chart === 'left' || chart === 'right' ? [1.08, -1.46] : [0];
    for (let i = 0; i < 900; i++) {
      const arch = rng.pick(arches);
      const z =
        chart === 'left' || chart === 'right'
          ? arch + rng.gauss() * 0.45
          : rng.range(B.x[0], B.x[1]);
      const y = yLow + Math.abs(rng.gauss()) * 0.16;
      const [x0, y0] = px(chart, z, y);
      ctx.fillStyle = `rgba(${rng.int(70, 110)},${rng.int(55, 85)},${rng.int(40, 60)},${rng.range(0.1, 0.32)})`;
      ctx.beginPath();
      ctx.arc(x0, y0, rng.range(0.003, 0.011) * K, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed = 0,
): void {
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
  weather(ctx, seed); // over the graphic too: the yellow gets dusty like the paint
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
