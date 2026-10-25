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
const { K, B, CH, Painter, sidePx, frontPx, rearPx } = atlasKit(A);

/** Warm gold-yellow of the classic works blue-and-yellow rally scheme, and the darker gold of the edge lines under it. */
const YELLOW = '#f4c51c';
const EDGE = '#a8780c';
/** Edge line width (m). */
const EDGE_W = 0.02;

/**
 * The swoosh, drawn after the owner's sketch: a crescent whose belly sits low on the door and whose tail runs back and up
 * along the rear quarter, with two straight stripes inside it; a dark gold line runs under the crescent's inner edge and
 * under each stripe. Shapes are in sketch px (x right = towards the rear, y down), mapped onto the body side by `at`.
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
/** Upper stripe: its front end curves down along the crescent; lower stripe: front end cut on a slant. */
const STRIPE_HI_FRONT: Pt[] = [
  [378, 155],
  [440, 162],
  [482, 180],
];
const STRIPE_HI: { top: Pt[]; bottom: Pt[] } = {
  top: [
    [378, 155],
    [1120, 55],
  ],
  bottom: [
    [482, 180],
    [1120, 73],
  ],
};
const STRIPE_LO: { top: Pt[]; bottom: Pt[] } = {
  top: [
    [488, 188],
    [1112, 86],
  ],
  bottom: [
    [510, 222],
    [1112, 102],
  ],
};

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

/** A line of width `w` (m) along body-side points, laid on one side of them (+1 / -1 picks the side). */
function band(pts: Pt[], w: number, side: 1 | -1): Pt[] {
  const n = pts.length;
  const off: Pt[] = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [
      p[0] - ((b[1] - a[1]) / d) * w * side,
      p[1] + ((b[0] - a[0]) / d) * w * side,
    ];
  });
  return [...pts, ...off.reverse()];
}

/** Straight segment, resampled so band() has points along it. */
const line = ([a, b]: Pt[], n = 24): Pt[] =>
  Array.from({ length: n + 1 }, (_, i): Pt => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);

function swoosh(p: InstanceType<typeof Painter>): void {
  const inner = curve(CRESCENT_IN.map(at));
  p.side([...curve(CRESCENT_OUT.map(at)), ...inner], YELLOW);
  const hiFront = curve(STRIPE_HI_FRONT.map(at));
  const hiBottom = line(STRIPE_HI.bottom.map(at));
  p.side(
    [...hiFront, ...hiBottom, ...line(STRIPE_HI.top.map(at)).reverse()],
    YELLOW,
  );
  const lo = [STRIPE_LO.top[0], STRIPE_LO.bottom[0]].map(at);
  const loBottom = line(STRIPE_LO.bottom.map(at));
  p.side([...loBottom, ...line(STRIPE_LO.top.map(at)).reverse()], YELLOW);
  // Edge lines under the yellow: the crescent's inner edge, each stripe's front and underside.
  p.side(band(inner, EDGE_W, 1), EDGE);
  p.side(band([...hiFront, ...hiBottom], EDGE_W, 1), EDGE);
  p.side(band([...line(lo, 6), ...loBottom], EDGE_W, 1), EDGE);
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

  const p = new Painter(ctx);
  swoosh(p);
  weather(ctx, seed); // over the graphic too: the yellow gets dusty like the paint
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
