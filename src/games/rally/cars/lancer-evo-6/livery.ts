import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Lancer EVO VI BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing... are
 * separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them. Shapes only, no logos or lettering: a red car with a white square in the middle of the roof, two white bonnet stripes, a black skirt, front diffuser lip and rear bumper lip (identical left / right). All coordinates are model space (metres, after `offset`).
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
const Z_TAIL = -2.25;
/** Arch edges on the side charts: the skirt runs between them, the bumpers outside them. */
const Z_ARCH_F = 1.62;
const Z_ARCH_R = -1.72;
/** Black sill: the whole skirt between the arches (its up-facing bevel joins the side chart, `chartBoxes`). */
const SILL: [number, number] = [0.1, 0.355];
/** Front diffuser lip top. */
const LIP_F = 0.255;
/** Rear bumper bottom lip: up to the groove that runs under the vent slot and round the corners ([|x|, y] rear, [z, y] sides). */
const LIP_R: Pt[] = [
  [0, 0.459],
  [1.05, 0.459],
];
const LIP_R_SIDE: Pt[] = [
  [Z_TAIL, 0.459],
  [-2.05, 0.457],
  [-1.95, 0.449],
  [-1.85, 0.44],
  [-1.75, 0.433],
  [-1.65, 0.424],
  [-1.55, 0.42],
];
/** White roof square: the middle half of the roof panel (z -1.16..0.2, |x| <= 0.6) both ways. */
const ROOF = { z: [-0.82, -0.14], x: 0.3 };

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const red = seed === 0 ? '#d11a20' : info.base;
  const white = seed === 0 ? '#f3f4f6' : info.accent;

  ctx.fillStyle = red;
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

  // --- black: skirt between the arches, front diffuser lip, rear bumper bottom lip ---
  const black = '#141516';
  const band = (z0: number, z1: number, y0: number, y1: number): Pt[] => [
    [z1, y0],
    [z0, y0],
    [z0, y1],
    [z1, y1],
  ];
  sides(ctx, band(Z_ARCH_R, Z_ARCH_F, SILL[0], SILL[1]), black);
  sides(ctx, band(Z_ARCH_F, Z_NOSE, 0, LIP_F - 0.02), black);
  sides(ctx, [[-1.55, 0], [Z_TAIL, 0], ...LIP_R_SIDE], black);
  fill(
    ctx,
    'front',
    [
      [-1.05, 0],
      [1.05, 0],
      [1.05, LIP_F],
      [-1.05, LIP_F],
    ],
    black,
  );
  fill(
    ctx,
    'rear',
    [
      [-1.05, 0],
      [1.05, 0],
      ...LIP_R.slice().reverse(),
      ...LIP_R.slice(1).map(([x, y]): Pt => [-x, y]),
    ],
    black,
  );

  // --- top: white roof square, two white bonnet stripes outboard of the vents ---
  fill(
    ctx,
    'top',
    [
      [ROOF.z[1], -ROOF.x],
      [ROOF.z[1], ROOF.x],
      [ROOF.z[0], ROOF.x],
      [ROOF.z[0], -ROOF.x],
    ],
    white,
  );
  for (const side of [1, -1])
    fill(
      ctx,
      'top',
      [
        [1.0, side * 0.34],
        [2.0, side * 0.34],
        [2.0, side * 0.5],
        [1.0, side * 0.5],
      ],
      white,
    );
}

export const lancerEvo6Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
