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

/** Warm gold-yellow of the classic works blue-and-yellow rally scheme, and the darker gold of the line under it. */
const YELLOW = '#f4c51c';
const EDGE = '#a8780c';
/** Width of that line (m). */
const EDGE_W = 0.01;

/**
 * The swoosh, drawn after the owner's sketch: a crescent whose belly sits low on the door and whose tail runs back and up
 * along the rear quarter, with two stripes inside it; a dark gold line runs along the underside of each. Shapes are in sketch px (x right = towards the rear, y down), mapped onto the body side by `at`.
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
// front: where its top line starts, behind the bend of the crescent's inner edge (offsetting the bend folds the lines)
const STRIPE_LO = { gap: 0.035, width: 0.04, front: 520 };
/** The lower stripe's front is cut along this curve (sketch px), rising forwards from its underside. */
const STRIPE_LO_FRONT: Pt[] = [
  [606, 215],
  [600, 196],
  [588, 184],
  [570, 174],
  [548, 168],
  [520, 165],
  [495, 164],
];
/** All three tails end on one smooth cut (sketch px, top to bottom), the middle one shortest. */
const REAR_CUT: Pt[] = [
  [1127, 10],
  [1106, 48],
  [1093, 78],
  [1096, 100],
  [1106, 122],
];

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

interface Edged {
  fill: Pt[];
  /** Extra regions the fill is clipped to. */
  fillClip?: Pt[][];
  edges: Pt[][];
  /** Regions the dark lines are clipped to. */
  edgeClip?: Pt[][];
}

/**
 * Yellow shapes with a dark gold line on some edges: the lines are stroked wide first and the shapes filled over them, so
 * only the outer half of each stroke shows. Everything is clipped to `keep` (the rear cut).
 */
function edged(
  ctx: CanvasRenderingContext2D,
  keep: Pt[],
  shapes: Edged[],
): void {
  const size: Pt = [B.z[1] - B.z[0], B.y[1] - B.y[0]];
  for (const s of ['left', 'right'] as const) {
    const path = (pts: Pt[]) =>
      pts.forEach(([z, y], i) => {
        const [x, v] = sidePx(s, z, y);
        if (i) ctx.lineTo(x, v);
        else ctx.moveTo(x, v);
      });
    const clip = (pts: Pt[]) => {
      ctx.beginPath();
      path(pts);
      ctx.closePath();
      ctx.clip();
    };
    const pass = (draw: (sh: Edged) => void) => {
      for (const sh of shapes) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(CH[s][0] * K, CH[s][1] * K, size[0] * K, size[1] * K);
        ctx.clip();
        clip(keep);
        draw(sh);
        ctx.restore();
      }
    };
    pass(({ edges, edgeClip }) => {
      for (const c of edgeClip ?? []) clip(c);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = EDGE_W * 2 * K;
      ctx.strokeStyle = EDGE;
      for (const e of edges) {
        ctx.beginPath();
        path(e);
        ctx.stroke();
      }
    });
    pass(({ fill, fillClip }) => {
      for (const c of fillClip ?? []) clip(c);
      ctx.fillStyle = YELLOW;
      ctx.beginPath();
      path(fill);
      ctx.closePath();
      ctx.fill();
    });
  }
}

/** Even-odd point-in-polygon test (body-side metres). */
function inside([z, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [zi, yi] = poly[i];
    const [zj, yj] = poly[j];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi)
      hit = !hit;
  }
  return hit;
}

/** Region on one side of a cut curve: the curve, then two far corners (sketch px) closing it. */
const region = (cut: Pt[], far: Pt[]): Pt[] => [
  ...curve(cut.map(at)),
  ...far.map(at),
];

function swoosh(ctx: CanvasRenderingContext2D): void {
  const inner = curve(CRESCENT_IN.map(at)); // tail -> low end
  const outer = curve(CRESCENT_OUT.map(at)); // low end -> tail
  // The top line for the stripes: the crescent's inner edge, ordered front -> rear; the rear cut trims all the tails.
  const top = (frontX: number) => {
    const zFront = at([frontX, 0])[0];
    return inner.filter(([z]) => z <= zFront).reverse();
  };
  const forwardOfRearCut = region(REAR_CUT, [
    [1106, 600],
    [-400, 600],
    [-400, -300],
    [1127, -300],
  ]);
  // Going front -> rear, the offset normal points down the car side, away from the crescent.
  const hiTop = top(STRIPE_HI.front);
  const n = hiTop.length;
  const hiWidth = (i: number) => {
    const t = Math.min(1, i / (n * 0.3)); // widens from a point at the front over its first 30%
    return STRIPE_HI.width * t * t * (3 - 2 * t);
  };
  const hiUpper = offset(hiTop, STRIPE_HI.gap);
  const hiLower = offset(hiTop, (i) => STRIPE_HI.gap + hiWidth(i));
  const hiBand = offset(
    hiTop,
    (i) => STRIPE_HI.gap + hiWidth(i) + EDGE_W * 1.5,
  );
  const loTop = top(STRIPE_LO.front);
  const d0 = STRIPE_HI.gap + STRIPE_HI.width + STRIPE_LO.gap;
  const loUpper = offset(loTop, d0);
  const loLower = offset(loTop, d0 + STRIPE_LO.width);
  const loBand = offset(loTop, d0 + STRIPE_LO.width + EDGE_W * 1.5);
  const rearOfLoFront = region(STRIPE_LO_FRONT, [
    [495, -300],
    [2000, -300],
    [2000, 600],
    [606, 600],
  ]);
  // The crescent's dark line never shows outside its outer edge: clip it to the side of the outer edge facing the hollow.
  const insideOuter: Pt[] = [
    ...outer,
    ...(
      [
        [2000, 25],
        [2000, 600],
        [205, 600],
      ] as Pt[]
    ).map(at),
  ];
  // Dark gold only underneath: the crescent's inner edge and low end, each stripe's front and underside. Each line is
  // clipped to between its shape's top edge and just below its underside, so it never runs onto a top edge.
  edged(ctx, forwardOfRearCut, [
    {
      fill: [...outer, ...inner],
      edges: [[...inner, outer[0]]],
      edgeClip: [insideOuter],
    },
    {
      fill: [...hiUpper, ...[...hiLower].reverse()],
      edges: [hiLower],
      edgeClip: [[...hiUpper, ...[...hiBand].reverse()]],
    },
    {
      fill: [...loUpper, ...[...loLower].reverse()],
      fillClip: [rearOfLoFront],
      edges: [
        curve(STRIPE_LO_FRONT.map(at)),
        loLower.filter((q) => inside(q, rearOfLoFront)),
      ],
      edgeClip: [[...loUpper, ...[...loBand].reverse()]],
    },
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
