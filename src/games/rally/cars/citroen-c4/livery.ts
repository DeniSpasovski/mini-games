import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Citroen C4 WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing,
 * roof scoop... are separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so
 * nothing painted here can reach them. Big straight-edged strokes only, shapes without logos or lettering: purple-blue nose, hood
 * sides and front fenders; red body behind a straight diagonal; a red centre piece on the hood framed by a 1 cm white line;
 * dark-blue rear bumper under the bumper line, its sides cut by a diagonal with a white line; white roof with a red diamond.
 * All coordinates are model space (metres).
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
const RED = '#d1121f';
const BLUE = '#2c2f93';
const NAVY = '#111a55';
const WHITE = '#f1f2f4';
/** Front blue ends on a straight diagonal: [z at the roof line, z at the sill]. */
const FRONT_SEAM: [number, number] = [1.0, 0.88];
/** Rear bumper line (the crease across the tail), the same height on the side and rear charts. */
const BUMPER_Y = 0.69;
/** The rear bumper's diagonal: [z at the bumper line, z at the sill]; the white line sits 3 cm in front of it. */
const BUMPER_CUT: [number, number] = [-1.82, -1.55];
const WHITE_LINE = 0.03;
/** Hood centre piece: [z, half width] rear edge, front edge; 1 cm white frame. */
const HOOD_REAR: [number, number] = [1.25, 0.62];
const HOOD_FRONT: [number, number] = [1.8, 0.42];
const HOOD_FRAME = 0.01;
/** Roof: white between these z, half width; the red diamond's centre and half diagonal. */
const ROOF_Z: [number, number] = [-1.5, 0.3];
const ROOF_HALF = 0.6;
const DIAMOND = { z: -0.6, r: 0.42 };

const rect = (z0: number, z1: number, y0: number, y1: number): Pt[] => [
  [z0, y0],
  [z1, y0],
  [z1, y1],
  [z0, y1],
];

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const red = seed === 0 ? RED : info.accent;
  const blue = seed === 0 ? BLUE : info.accent2;
  const navy = seed === 0 ? NAVY : info.accent2;

  ctx.fillStyle = red;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down.
  fill(ctx, 'bottom', rect(B.z[0], B.z[1], B.x[0], B.x[1]), '#2a2c2f');

  // --- sides: blue front behind a straight diagonal, navy tail under the bumper line, black sill ---
  sides(
    ctx,
    [
      [Z_NOSE, 0],
      [Z_NOSE, 1.7],
      [FRONT_SEAM[0], 1.7],
      [FRONT_SEAM[1], 0],
    ],
    blue,
  );
  sides(
    ctx,
    [
      [Z_TAIL, 0],
      [Z_TAIL, BUMPER_Y],
      [BUMPER_CUT[0] + WHITE_LINE, BUMPER_Y],
      [BUMPER_CUT[1] + WHITE_LINE, 0],
    ],
    WHITE,
  );
  sides(
    ctx,
    [
      [Z_TAIL, 0],
      [Z_TAIL, BUMPER_Y],
      [BUMPER_CUT[0], BUMPER_Y],
      [BUMPER_CUT[1], 0],
    ],
    navy,
  );
  sides(ctx, rect(Z_NOSE, Z_TAIL, 0.1, 0.3), '#141516');

  // --- ends: blue nose, red tail with the navy bumper under the same line as on the sides ---
  fill(ctx, 'front', rect(-1.05, 1.05, 0, 1.7), blue);
  fill(ctx, 'rear', rect(-1.05, 1.05, 0, BUMPER_Y), navy);

  // --- top: blue from the windscreen forward, red hood piece in a white frame, white roof with a red diamond ---
  fill(ctx, 'top', rect(FRONT_SEAM[0], Z_NOSE, -1.05, 1.05), blue);
  const hood = (grow: number): Pt[] => [
    [HOOD_REAR[0] - grow, -(HOOD_REAR[1] + grow)],
    [HOOD_REAR[0] - grow, HOOD_REAR[1] + grow],
    [HOOD_FRONT[0] + grow, HOOD_FRONT[1] + grow],
    [HOOD_FRONT[0] + grow, -(HOOD_FRONT[1] + grow)],
  ];
  fill(ctx, 'top', hood(HOOD_FRAME), WHITE);
  fill(ctx, 'top', hood(0), red);
  fill(
    ctx,
    'top',
    [
      [ROOF_Z[0], -ROOF_HALF],
      [ROOF_Z[0], ROOF_HALF],
      [ROOF_Z[1], ROOF_HALF],
      [ROOF_Z[1], -ROOF_HALF],
    ],
    WHITE,
  );
  fill(
    ctx,
    'top',
    [
      [DIAMOND.z + DIAMOND.r, 0],
      [DIAMOND.z, DIAMOND.r],
      [DIAMOND.z - DIAMOND.r, 0],
      [DIAMOND.z, -DIAMOND.r],
    ],
    red,
  );
}

export const citroenC4Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
