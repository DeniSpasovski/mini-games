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

const YELLOW = '#e8f03a';
/** Sketch px (x right, y down) -> body side (z, y): the nose end is on the left of the sketch, the tails run back. */
const Z_FRONT = -0.08;
const Y_TOP = 0.86;
const SX = 0.0043; // m per sketch px along the car
const SY = 0.0034; // m per sketch px in height
const at = ([x, y]: Pt): Pt => [
  Z_FRONT - (x - 122) * SX,
  Y_TOP - (y - 25) * SY,
];

/** One line of the swoosh: centre line in sketch px, width in metres, and how much its two ends taper (0 = blunt). */
interface Stroke {
  pts: Pt[];
  width: number;
  taper: [number, number];
}
const STROKES: Stroke[] = [
  {
    pts: [
      [185, 193],
      [160, 165],
      [135, 135],
      [122, 105],
      [128, 88],
      [150, 76],
      [200, 64],
      [300, 48],
      [420, 36],
      [542, 25],
    ],
    width: 0.095,
    taper: [0.85, 0.6],
  },
  {
    pts: [
      [190, 160],
      [165, 135],
      [157, 115],
      [170, 100],
      [217, 89],
    ],
    width: 0.06,
    taper: [0.7, 0],
  },
  {
    pts: [
      [260, 85],
      [400, 68],
      [538, 52],
    ],
    width: 0.06,
    taper: [0, 0.6],
  },
  {
    pts: [
      [198, 143],
      [192, 125],
      [200, 113],
      [230, 108],
    ],
    width: 0.045,
    taper: [0.6, 0],
  },
  {
    pts: [
      [270, 106],
      [400, 89],
      [536, 72],
    ],
    width: 0.045,
    taper: [0, 0.6],
  },
];

/** Catmull-Rom curve through the points, resampled. */
function curve(pts: Pt[], per = 14): Pt[] {
  const out: Pt[] = [];
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
  return out;
}

/** A stroke as a closed (z, y) outline: its centre line offset both ways, thinner towards a tapered end. */
function ribbon({ pts, width, taper }: Stroke): Pt[] {
  const c = curve(pts).map(at);
  const n = c.length;
  const w = (i: number) => {
    const t = i / (n - 1);
    const e0 = taper[0] ? Math.min(1, t / 0.25) : 1;
    const e1 = taper[1] ? Math.min(1, (1 - t) / 0.4) : 1;
    return (
      (width / 2) *
      (1 - taper[0] * (1 - e0 * e0 * (3 - 2 * e0))) *
      (1 - taper[1] * (1 - e1 * e1 * (3 - 2 * e1)))
    );
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(i - 1, 0)];
    const b = c[Math.min(i + 1, n - 1)];
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dz, dy) || 1;
    const nz = -dy / len;
    const ny = dz / len;
    left.push([c[i][0] + nz * w(i), c[i][1] + ny * w(i)]);
    right.push([c[i][0] - nz * w(i), c[i][1] - ny * w(i)]);
  }
  return [...left, ...right.reverse()];
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
  for (const stroke of STROKES) p.side(ribbon(stroke), YELLOW);
  weather(ctx, seed); // over the graphic too: the yellow gets dusty like the paint
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
