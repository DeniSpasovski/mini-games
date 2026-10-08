import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Citroen C4 WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing... are
 * separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them. Shapes only, no logos or lettering: a white body with a red lower flank that climbs from nose to tail under a thin
 * navy line, a navy bonnet stripe and roof chevron (identical left / right). The wing and the black lower trim are parts. All
 * coordinates are model space (metres).
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

const Z_NOSE = 2.1;
const Z_TAIL = -2.1;
/** Red flank top, nose to tail: climbs towards the tail; the end charts use the end values so the bands meet at the corners. */
const RED_RIDGE: Pt[] = [
  [Z_NOSE, 0.48],
  [1.2, 0.56],
  [0.3, 0.64],
  [-0.8, 0.72],
  [-1.6, 0.78],
  [Z_TAIL, 0.8],
];
const NAVY_LINE = 0.045;
/** Black sill strip between the arches (side charts only: the skirt has no end faces). */
const SILL: [number, number] = [0.1, 0.3];
const ridge = (up: number): Pt[] => RED_RIDGE.map(([z, y]) => [z, y + up]);

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const white = '#eef0f3';
  const red = seed === 0 ? '#c4162c' : info.accent;
  const navy = seed === 0 ? '#0c2a6e' : info.accent2;

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

  // --- sides: navy line above the red flank, black sill ---
  sides(
    ctx,
    [[Z_NOSE, 0], [Z_TAIL, 0], ...ridge(NAVY_LINE).slice().reverse()],
    navy,
  );
  sides(ctx, [[Z_NOSE, 0], [Z_TAIL, 0], ...RED_RIDGE.slice().reverse()], red);
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

  // --- ends: red bumpers at the side ridge's end heights, thin navy line above ---
  for (const [chart, y] of [
    ['front', RED_RIDGE[0][1]],
    ['rear', RED_RIDGE[RED_RIDGE.length - 1][1]],
  ] as ['front' | 'rear', number][]) {
    for (const [top, bottom, color] of [
      [y + NAVY_LINE, 0, navy],
      [y, 0, red],
    ] as [number, number, string][])
      fill(
        ctx,
        chart,
        [
          [-1.05, bottom],
          [1.05, bottom],
          [1.05, top],
          [-1.05, top],
        ],
        color,
      );
  }

  // --- top: navy stripe down the bonnet, navy chevron on the roof's rear half ---
  fill(
    ctx,
    'top',
    [
      [0.95, 0.17],
      [2.1, 0.22],
      [2.1, -0.22],
      [0.95, -0.17],
    ],
    navy,
  );
  for (const side of [1, -1])
    fill(
      ctx,
      'top',
      [
        [-0.2, side * 0.05],
        [-1.5, side * 0.62],
        [-1.5, side * 0.46],
        [-0.8, side * 0.05],
      ],
      navy,
    );
}

export const citroenC4Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
