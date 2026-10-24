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

/**
 * The swoosh: one smooth guide curve on the body side (z, y in metres), from a low tip at the front of the door, round a wide
 * bulge and back along the rear quarter, rising with the shoulder line. The three lines are this curve and two parallel
 * copies inside it; the inner two are cut by a gap behind the bulge.
 */
/** Whole graphic moved (z, y) from where it was first placed: 20 cm forward, 10 cm lower. */
const SHIFT: Pt = [0.2, -0.1];
const GUIDE: Pt[] = (
  [
    [-1.12, 0.3],
    [-0.88, 0.39],
    [-0.7, 0.5],
    [-0.62, 0.63],
    [-0.66, 0.74],
    [-0.8, 0.82],
    [-1.05, 0.86],
    [-1.4, 0.88],
    [-1.75, 0.9],
    [-2.05, 0.92],
  ] as Pt[]
).map(([z, y]) => [z + SHIFT[0], y + SHIFT[1]]);
/** Where the guide's bulge is, as a fraction of its length: the outer line is twice as thick here. */
const BULGE_AT = 0.3;
const OUTER_WIDTH = 0.07;

interface Line {
  /** Distance inside the guide (m). */
  offset: number;
  /** Width (m) away from the bulge. */
  width: number;
  /** Pieces of the guide, as length fractions; each end tapers to a point unless it sits at 0 / 1 of the whole guide. */
  pieces: [number, number][];
}
const LINES: Line[] = [
  // The outer line starts a little way along the guide so its low tip stays above the sill crease.
  { offset: 0, width: OUTER_WIDTH, pieces: [[0.07, 1]] },
  {
    offset: 0.12,
    width: 0.045,
    pieces: [
      [0.1, 0.36],
      [0.46, 1],
    ],
  },
  {
    offset: 0.21,
    width: 0.035,
    pieces: [[0.34, 1]],
  },
];

/** Catmull-Rom curve through the points, resampled, then rounded off by corner cutting. */
function curve(pts: Pt[], per = 16): Pt[] {
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

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Outline (z, y) of one piece of a line: the guide offset inwards, widened at the bulge, pointed at cut ends. */
function ribbon(guide: Pt[], line: Line, [t0, t1]: [number, number]): Pt[] {
  const n = guide.length;
  const len = [0];
  for (let i = 1; i < n; i++)
    len.push(
      len[i - 1] +
        Math.hypot(
          guide[i][0] - guide[i - 1][0],
          guide[i][1] - guide[i - 1][1],
        ),
    );
  const total = len[n - 1];
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const s = len[i] / total;
    if (s < t0 || s > t1) continue;
    const a = guide[Math.max(i - 1, 0)];
    const b = guide[Math.min(i + 1, n - 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tz = (b[0] - a[0]) / d;
    const ty = (b[1] - a[1]) / d;
    // Inside normal (towards the centre of the bulge, below the tail).
    const cz = guide[i][0] - ty * line.offset;
    const cy = guide[i][1] + tz * line.offset;
    let w = line.width;
    if (line.offset === 0) {
      const k = (s - BULGE_AT) / 0.25;
      w *= 1 + 0.9 * Math.exp(-k * k);
    }
    // Clean ends: a cut end stays blunt, the outer line's low tip and the tails narrow a little and end square.
    const e0 = line.offset === 0 ? smoothstep(Math.min(1, (s - t0) / 0.15)) : 1;
    const e1 = t1 === 1 ? smoothstep(Math.min(1, (1 - s) / 0.35)) : 1;
    w *= (0.55 + 0.45 * e0) * (0.5 + 0.5 * e1);
    const nz = -ty;
    const ny = tz;
    left.push([cz + nz * (w / 2), cy + ny * (w / 2)]);
    right.push([cz - nz * (w / 2), cy - ny * (w / 2)]);
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
  const guide = curve(GUIDE);
  for (const line of LINES)
    for (const piece of line.pieces) p.side(ribbon(guide, line, piece), YELLOW);
  weather(ctx, seed); // over the graphic too: the yellow gets dusty like the paint
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
