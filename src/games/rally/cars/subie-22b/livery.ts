import { Rng } from '../../../../shared/rng';
import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat, the side
 * swoosh (three cut-out yellow lines, outer one thickest, drawn after a sketch from the owner; no lettering, no logo) and dust.
 */
const A = source.atlas;
const { K, B, CH, sidePx, frontPx, rearPx } = atlasKit(A);

/** Warm gold-yellow of the classic works blue-and-yellow rally scheme, and the darker gold of its outline. */
const YELLOW = '#f4c51c';
const EDGE = '#a8780c';
/** Outline width (m). */
const EDGE_W = 0.01;

/**
 * The swoosh, drawn after the owner's sketch: a crescent whose belly sits low on the door and whose tail runs back and up
 * along the rear quarter, with two stripes inside it, all outlined in dark gold. Shapes are in sketch px (x right = towards the rear, y down), mapped onto the body side by `at`.
 */
const Z_FRONT = -0.42; // front of the belly (sketch x 75)
const Y_TOP = 0.8; // tail tip (sketch y 25)
const SX = 0.00136; // m per sketch px along the car
const SY = 0.0017; // m per sketch px in height
const at = ([x, y]: Pt): Pt => [Z_FRONT - (x - 75) * SX, Y_TOP - (y - 25) * SY];

/** Crescent: outer edge from its low end round the belly to the tail tip, inner edge from the tail back down. */
const CRESCENT_OUT: Pt[] = [
  [205, 318],
  [125, 262],
  [82, 205],
  [86, 165],
  [130, 130],
  [230, 96],
  [400, 68],
  [600, 49],
  [850, 35],
  [1140, 25],
];
const CRESCENT_IN: Pt[] = [
  [1127, 44],
  [900, 62],
  [700, 81],
  [500, 102],
  [385, 126],
  [322, 156],
  [292, 196],
  [300, 240],
  [325, 284],
  [355, 318],
];
/**
 * The two stripes run parallel to the crescent's inner edge (the top line), each an even distance below it: the upper one
 * from a point at the front, the lower one from a slanted cut further back. Distances in metres.
 */
const STRIPE_HI = { gap: 0.04, width: 0.045, front: 380 }; // front: sketch x of the front tip
const STRIPE_LO = { gap: 0.035, width: 0.04, front: 490, slant: 0.03 }; // slant: how far back the cut's bottom corner sits
/** Rear end of both stripes (sketch x), a little short of the crescent's tail tip. */
const STRIPES_END = 1118;

/** Catmull-Rom curve through the points, resampled, then rounded off by corner cutting. */
function curve(pts: Pt[], per = 16): Pt[] {
  if (pts.length < 3) return pts;
  let out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t * t +
          (-a + 3 * b - 3 * c + d) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  for (let r = 0; r < 2; r++) {
    const q: Pt[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const [x0, y0] = out[i];
      const [x1, y1] = out[i + 1];
      q.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75],
      );
    }
    q.push(out[out.length - 1]);
    out = q;
  }
  return out;
}

/** Body-side points offset by `d` (m) along the normal (-dy, dz) of their direction of travel. */
function offset(pts: Pt[], d: number | ((i: number) => number)): Pt[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const di = typeof d === 'number' ? d : d(i);
    return [p[0] - ((b[1] - a[1]) / l) * di, p[1] + ((b[0] - a[0]) / l) * di];
  });
}

/** Shapes with a dark gold outline: each one stroked wide, then filled, so the outline sits round its edge. */
function outlined(ctx: CanvasRenderingContext2D, shapes: Pt[][]): void {
  const size: Pt = [B.z[1] - B.z[0], B.y[1] - B.y[0]];
  for (const s of ['left', 'right'] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(CH[s][0] * K, CH[s][1] * K, size[0] * K, size[1] * K);
    ctx.clip();
    const path = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach(([z, y], i) => {
        const [x, v] = sidePx(s, z, y);
        if (i) ctx.lineTo(x, v);
        else ctx.moveTo(x, v);
      });
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = EDGE_W * 2 * K;
    ctx.strokeStyle = EDGE;
    for (const pts of shapes) {
      path(pts);
      ctx.stroke();
    }
    ctx.fillStyle = YELLOW;
    for (const pts of shapes) {
      path(pts);
      ctx.fill();
    }
    ctx.restore();
  }
}

function swoosh(ctx: CanvasRenderingContext2D): void {
  const inner = curve(CRESCENT_IN.map(at)); // tail -> low end
  const crescent = [...curve(CRESCENT_OUT.map(at)), ...inner];
  // The top line for the stripes: the inner edge from the stripes' rear end forward, ordered front -> rear.
  const zEnd = at([STRIPES_END, 0])[0];
  const top = (frontX: number) => {
    const zFront = at([frontX, 0])[0];
    return inner.filter(([z]) => z <= zFront && z >= zEnd).reverse();
  };
  // Going front -> rear, the offset normal points down the car side, away from the crescent.
  const hiTop = top(STRIPE_HI.front);
  const n = hiTop.length;
  const hiUpper = offset(hiTop, STRIPE_HI.gap);
  const hiLower = offset(hiTop, (i) => {
    const t = Math.min(1, i / (n * 0.3)); // widens from a point at the front over its first 30%
    return STRIPE_HI.gap + STRIPE_HI.width * t * t * (3 - 2 * t);
  });
  const loTop = top(STRIPE_LO.front);
  const d0 = STRIPE_HI.gap + STRIPE_HI.width + STRIPE_LO.gap;
  const loUpper = offset(loTop, d0);
  const loLower = offset(loTop, d0 + STRIPE_LO.width).filter(
    ([z]) => z <= loTop[0][0] - STRIPE_LO.slant,
  );
  outlined(ctx, [
    crescent,
    [...hiUpper, ...hiLower.reverse()],
    [...loUpper, ...loLower.reverse()],
  ]);
}

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
    g.addColorStop(1, 'rgba(112,92,64,0.3)');
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

  swoosh(ctx);
  weather(ctx, seed); // over the graphic too: the yellow gets dusty like the paint
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
