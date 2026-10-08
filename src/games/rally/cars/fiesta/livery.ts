import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Fiesta WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing... are
 * separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them. Shapes only, no logos or lettering: navy mountains over light-blue ones along the lower body (peaks rise
 * towards the middle of the car), navy bonnet flanks, white roof (identical left / right). The rear-wing blades are parts
 * (`wingblue` / `winggreen`). All coordinates are model space (metres).
 */
const A = source.atlas;
const { K, B, CH, sidePx, topPx, frontPx, rearPx } = atlasKit(A);

type Chart = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'rear';
/** Solid colour, or a linear gradient between two model-space points of the chart. */
type Fill = string | { from: Pt; to: Pt; stops: [number, string][] };

const PX: Record<Chart, (a: number, b: number) => Pt> = {
  left: (z, y) => sidePx('left', z, y),
  right: (z, y) => sidePx('right', z, y),
  top: topPx,
  // Underside chart, laid out like the top one (z along, x across).
  bottom: (z, x) => [
    (CH.bottom[0] + B.z[1] - z) * K,
    (CH.bottom[1] + x - B.x[0]) * K,
  ],
  front: frontPx,
  rear: rearPx,
};
const SIDE: [number, number] = [B.z[1] - B.z[0], B.y[1] - B.y[0]];
const END: [number, number] = [B.x[1] - B.x[0], B.y[1] - B.y[0]];
const SIZE: Record<Chart, [number, number]> = {
  left: SIDE,
  right: SIDE,
  top: [B.z[1] - B.z[0], B.x[1] - B.x[0]],
  bottom: [B.z[1] - B.z[0], B.x[1] - B.x[0]],
  front: END,
  rear: END,
};

/** Fill a model-space polygon on one chart (clipped to the chart). */
function fill(
  ctx: CanvasRenderingContext2D,
  chart: Chart,
  pts: Pt[],
  style: Fill,
): void {
  const px = PX[chart];
  const [cx, cy] = CH[chart];
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx * K, cy * K, SIZE[chart][0] * K, SIZE[chart][1] * K);
  ctx.clip();
  if (typeof style === 'string') ctx.fillStyle = style;
  else {
    const g = ctx.createLinearGradient(
      ...px(...style.from),
      ...px(...style.to),
    );
    for (const [at, color] of style.stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  pts.forEach(([a, b], i) => {
    const [x, y] = px(a, b);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Same shape on both sides of the car. */
const sides = (ctx: CanvasRenderingContext2D, pts: Pt[], style: Fill) => {
  fill(ctx, 'left', pts, style);
  fill(ctx, 'right', pts, style);
};

// The navy lower body runs the whole car (arch flares included): a mountain range whose peaks rise towards the middle of the car
// and sink towards both ends. Valleys at the nose / tail sit at the end charts' bumper bands (`END_NAVY` / `TAIL_NAVY`).
const Z_NOSE = 2.1;
const Z_TAIL = -2.1;
const END_NAVY = 0.52;
const TAIL_NAVY = 0.55;
/** Navy ridge, nose to tail: [z, y] valleys and peaks. */
const NAVY_RIDGE: Pt[] = [
  [Z_NOSE, END_NAVY],
  [1.55, 0.5],
  [1.15, 0.67],
  [0.75, 0.52],
  [0.2, 0.65],
  [-0.4, 0.55],
  [-0.9, 0.76],
  [-1.4, 0.56],
  [-1.8, 0.64],
  [Z_TAIL, TAIL_NAVY],
];
/** Light-blue range behind it: taller peaks shifted towards the middle, same ends. */
const SKY_RIDGE: Pt[] = [
  [Z_NOSE, END_NAVY],
  [1.7, 0.56],
  [1.3, 0.62],
  [0.95, 0.74],
  [0.5, 0.58],
  [-0.15, 0.7],
  [-0.7, 0.6],
  [-1.15, 0.8],
  [-1.6, 0.6],
  [-1.95, 0.7],
  [Z_TAIL, TAIL_NAVY],
];
const range = (ridge: Pt[]): Pt[] => [
  [Z_NOSE, 0],
  [Z_TAIL, 0],
  ...ridge.slice().reverse(),
];

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const white = '#f3f4f6';
  const navy = seed === 0 ? '#0c2a6e' : info.accent;
  const sky = seed === 0 ? '#3fb6ea' : info.accent2;

  ctx.fillStyle = white;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down.
  fill(
    ctx,
    'bottom',
    [
      [B.z[1], B.x[0]],
      [B.z[0], B.x[0]],
      [B.z[0], B.x[1]],
      [B.z[1], B.x[1]],
    ],
    '#2a2c2f',
  );

  // --- sides: light-blue mountains behind, navy mountains in front (the skirt below the doors is a black part) ---
  sides(ctx, range(SKY_RIDGE), sky);
  sides(ctx, range(NAVY_RIDGE), navy);

  // --- ends: navy bumpers with a light-blue line on the same height as the side edge ---
  for (const [chart, y] of [
    ['front', END_NAVY],
    ['rear', TAIL_NAVY],
  ] as ['front' | 'rear', number][]) {
    fill(
      ctx,
      chart,
      [
        [-1.05, 0],
        [1.05, 0],
        [1.05, y],
        [-1.05, y],
      ],
      navy,
    );
    fill(
      ctx,
      chart,
      [
        [-1.05, y],
        [1.05, y],
        [1.05, y + 0.04],
        [-1.05, y + 0.04],
      ],
      sky,
    );
  }

  // --- top: navy flanks on the bonnet, light-blue shards, white roof with a light-blue chevron at the back ---
  // front fender tops, outside the windscreen corners
  for (const side of [1, -1])
    fill(
      ctx,
      'top',
      [
        [0.5, side * 0.75],
        [0.95, side * 0.75],
        [0.95, side * 1.05],
        [0.5, side * 1.05],
      ],
      navy,
    );
  for (const side of [1, -1])
    fill(
      ctx,
      'top',
      [
        [0.95, side * 0.34],
        [1.95, side * 0.46],
        [1.95, side * 1.05],
        [0.95, side * 1.05],
      ],
      navy,
    );
  for (const side of [1, -1]) {
    fill(
      ctx,
      'top',
      [
        [0.95, side * 0.3],
        [1.95, side * 0.42],
        [1.95, side * 0.46],
        [0.95, side * 0.34],
      ],
      sky,
    );
    fill(
      ctx,
      'top',
      [
        [-0.2, side * 0.05],
        [-1.5, side * 0.62],
        [-1.5, side * 0.4],
        [-0.8, side * 0.05],
      ],
      sky,
    );
  }
}

export const fiestaLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
