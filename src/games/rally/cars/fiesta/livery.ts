import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Fiesta WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing... are
 * separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them. Shapes only, no logos or lettering, after a white / navy / light-blue / green rally scheme: navy lower
 * body rising towards the tail, a green wedge and light-blue ribbon on its edge, navy bonnet flanks, white roof (identical left /
 * right). All coordinates are model space (metres).
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

// Front arch starts at z ~0.9, rear arch ends at z ~ -0.95. The navy lower body runs the whole car (arch flares included, as on
// the real car), so its top edge `yNavy(z)` is one smooth curve that every chart reads at the same z.
const Z_NOSE = 2.1;
const Z_TAIL = -2.1;
/** Navy / white boundary on the sides: low at the nose, rising towards the tail. */
const yNavy = (z: number) => {
  const t = (Z_NOSE - z) / (Z_NOSE - Z_TAIL);
  return 0.52 + 0.33 * (t * t * (3 - 2 * t) * 0.6 + t * 0.4);
};
/** Points of the curve between two z values (a shape that follows the boundary). */
const along = (z0: number, z1: number, dy = 0, n = 14): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const z = z0 + ((z1 - z0) * i) / n;
    return [z, yNavy(z) + dy] as Pt;
  });
/** Black sill strip between the arches (same y on the side charts only: the skirt has no end faces). */
const SILL: [number, number] = [0.1, 0.34];
const END_NAVY = yNavy(Z_NOSE);
const TAIL_NAVY = yNavy(Z_TAIL);

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const white = '#f3f4f6';
  const navy = seed === 0 ? '#0c2a6e' : info.accent;
  const sky = seed === 0 ? '#3fb6ea' : info.accent2;
  const green = seed === 0 ? '#2eaa4a' : info.accent2;

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

  // --- sides: navy lower body, green wedge and a light-blue ribbon on its edge, black sill ---
  sides(ctx, [[Z_NOSE, 0], [Z_TAIL, 0], ...along(Z_TAIL, Z_NOSE)], {
    from: [Z_NOSE, 0.5],
    to: [Z_TAIL, 0.9],
    stops: [
      [0, navy],
      [1, '#12408f'],
    ],
  });
  // green wedge on the white above the edge, between the door and the rear arch
  sides(ctx, [...along(0.5, -1.2, 0.0, 8), [-1.2, yNavy(-1.2) + 0.3]], green);
  // light-blue ribbon: thin over the door, a blade round the rear quarter, a second blade over the front arch
  sides(
    ctx,
    [...along(1.5, -0.2, 0.0, 10), ...along(-0.2, 1.5, 0.045, 10)],
    sky,
  );
  sides(
    ctx,
    [
      ...along(-0.2, -1.95, 0.0, 10),
      [-1.95, yNavy(-1.95) + 0.17],
      [-1.2, yNavy(-1.2) + 0.1],
      [-0.2, yNavy(-0.2) + 0.045],
    ],
    sky,
  );
  // front fender shard
  sides(
    ctx,
    [
      [1.9, 0.5],
      [1.15, 0.64],
      [0.95, yNavy(0.95) + 0.14],
      [1.4, yNavy(1.4) + 0.02],
    ],
    sky,
  );
  sides(
    ctx,
    [
      [Z_NOSE, SILL[0]],
      [Z_TAIL, SILL[0]],
      [Z_TAIL, SILL[1]],
      [Z_NOSE, SILL[1]],
    ],
    '#141516',
  );

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
  paint,
};
