import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Fiesta WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing... are
 * separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them. Shapes only, no logos or lettering: white roof, a white + accent wedge running back along both sides
 * (identical left / right), two bonnet stripes. All coordinates are model space (metres).
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

// Front arch starts at z ~0.9, rear arch ends at z ~ -0.95: the stripes live between them, clear of the flares.
const Z_FRONT = 0.9;
const Z_REAR = -0.95;
/** Black sill strip between the arches (same y on the side charts only: the skirt has no end faces). */
const SILL: [number, number] = [0.1, 0.34];

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const white = seed === 0 ? '#f2f2ee' : info.accent;
  const accent = seed === 0 ? '#ff7a1a' : info.accent2;

  ctx.fillStyle = info.base;
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

  // --- sides: a wedge that rises towards the tail, an accent line above it, black sill below ---
  sides(
    ctx,
    [
      [Z_FRONT, 0.4],
      [Z_REAR, 0.4],
      [Z_REAR, 0.56],
      [Z_FRONT, 0.46],
    ],
    white,
  );
  sides(
    ctx,
    [
      [Z_FRONT, 0.5],
      [Z_REAR, 0.6],
      [Z_REAR, 0.65],
      [Z_FRONT, 0.55],
    ],
    accent,
  );
  sides(
    ctx,
    [
      [Z_FRONT, SILL[0]],
      [Z_REAR, SILL[0]],
      [Z_REAR, SILL[1]],
      [Z_FRONT, SILL[1]],
    ],
    '#141516',
  );

  // --- top: white roof, two stripes on the bonnet ---
  fill(
    ctx,
    'top',
    [
      [0.35, -0.7],
      [-1.55, -0.7],
      [-1.55, 0.7],
      [0.35, 0.7],
    ],
    white,
  );
  for (const [x0, x1, color] of [
    [-0.13, -0.03, white],
    [0.03, 0.13, accent],
  ] as [number, number, string][])
    fill(
      ctx,
      'top',
      [
        [0.95, x0],
        [1.88, x0],
        [1.88, x1],
        [0.95, x1],
      ],
      color,
    );
}

export const fiestaLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
