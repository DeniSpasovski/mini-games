import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Citroen C4 WRC BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, interior, wing,
 * roof scoop... are separate parts with their own materials (`parts` in model.source.json -> cars/shared/part-materials.ts), so
 * nothing painted here can reach them. Big straight-edged strokes only, shapes without logos or lettering: dark-blue nose,
 * fenders and hood up to a line through the middle of the doors (leaning back 75 deg); red body behind it; a red piece at the
 * front end of the hood under a 1 cm white line, running straight down the nose 3 cm inside the headlamps; a dark-blue rear bumper under the bumper line, bounded by diagonals with a
 * white line (seen from behind only); white roof with a red square and a red edge that follows the door line.
 * All coordinates are model space (metres), measured on the model (see the constants).
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

const Z_NOSE = 2.2;
const Z_TAIL = -2.2;
/** Shades sampled from the source model's own livery texture (the real car's dark crimson, navy and gold). */
const RED = '#a90810';
const BLUE = '#001f60';
const WHITE = '#f1f2f4';
/**
 * Blue / red split on the sides: a straight line leaning back (about 52 deg from horizontal), from z 0.67 at the sill to
 * z -0.48 at the roof line (y 1.45), which ends 15 cm in front of the B pillar (z -0.63).
 */
const SPLIT: [number, number] = [0.67, -0.48];
const SPLIT_ROOF_Y = 1.45;
const splitZ = (y: number): number =>
  SPLIT[0] + ((SPLIT[1] - SPLIT[0]) * y) / SPLIT_ROOF_Y;
/** Rear bumper line: 6.5 cm under the bumper's crest (the ledge across the tail, 0.725 m on the model). */
const BUMPER_Y = 0.66;
/** The bumper's diagonals on the rear chart: |x| at the bumper line (3 cm outside the tail lamp's lower inner corner) and at y = BUMPER_FOOT_Y (the bumper's outer bottom corner). */
const BUMPER_X: [number, number] = [0.58, 0.78];
const BUMPER_FOOT_Y = 0.2;
const WHITE_LINE = 0.03;
/**
 * Hood: the red piece starts at the nose end of the hood with a 1 cm white line on its rear edge; its sides follow the
 * hood's crest (where the flat middle bends down into the wings; [z, |x|] measured on the model's face normals).
 */
const HOOD_REAR_Z = 1.6;
const HOOD_CREST: Pt[] = [
  [1.6, 0.495],
  [1.7, 0.484],
  [1.8, 0.456],
  [1.9, 0.415],
  [2.0, 0.398],
  [2.1, 0.385],
  [Z_NOSE, 0.38],
];
const HOOD_LINE = 0.01;
/** Yellow disc on the side: the fender's rear top / the door's front (centre z, y, radius); cut flat at `top`, the window's lower edge (0.98 m on the model), so it never reaches the pillar. */
const DISC = { z: 0.89, y: 0.76, r: 0.3504, top: 0.98 };
const YELLOW = '#d0ae32';
/** Headlamps' inner edge seen from the front: [y, |x|] from their bottom up (measured on the model). */
const LAMP_INNER: Pt[] = [
  [0.66, 0.398],
  [0.7, 0.408],
  [0.725, 0.416],
  [0.75, 0.433],
  [0.775, 0.442],
];
/** Above the headlamps the red narrows to the hood crest's width at the nose (wider leaked onto the hood's side faces). */
const HOOD_HALF = 0.38;
const HOOD_TOP_Y = 0.8;
/** The red nose stays this far inside the headlamps. */
const NOSE_GAP = 0.03;
/** The model's grille bars: their rearmost top face (top chart). */
const GRILLE_TOP_Z = 1.98;
/** Roof edge (the door line) |x| by z, measured on the model's top-facing faces; the white panel keeps ROOF_RED inside it. */
const ROOF_EDGE: Pt[] = [
  [-1.5, 0.54],
  [-0.4, 0.54],
  [0.3, 0.622],
];
const ROOF_RED = 0.05;
/** Red square on the roof, parallel to the doors: centre z, half side. */
const SQUARE = { z: -0.6, h: 0.3 };

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

  ctx.fillStyle = red;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down.
  fill(ctx, 'bottom', rect(B.z[0], B.z[1], B.x[0], B.x[1]), '#2a2c2f');

  // --- sides: blue in front of the door split, red behind it (the rear stays red down to the sill), black sill ---
  sides(
    ctx,
    [
      [Z_NOSE, 0],
      [Z_NOSE, 1.7],
      [splitZ(1.7), 1.7],
      [splitZ(0), 0],
    ],
    blue,
  );
  const yellow = seed === 0 ? YELLOW : info.accent;
  const disc: Pt[] = Array.from({ length: 48 }, (_, i): Pt => {
    const a = (i / 48) * Math.PI * 2;
    return [
      DISC.z + Math.cos(a) * DISC.r,
      Math.min(DISC.top, DISC.y + Math.sin(a) * DISC.r),
    ];
  });
  sides(ctx, disc, yellow);
  sides(ctx, rect(Z_NOSE, Z_TAIL, 0.1, 0.3), '#141516');

  // --- ends: blue nose; red tail with a blue bumper: trapezoid under the bumper line, white line on its diagonals ---
  fill(ctx, 'front', rect(-1.05, 1.05, 0, 1.7), blue);
  const bumper = (grow: number): Pt[] => {
    const foot = BUMPER_X[1] + grow;
    const head = BUMPER_X[0] + grow;
    return [
      [-foot, 0],
      [foot, 0],
      [foot, BUMPER_FOOT_Y],
      [head, BUMPER_Y],
      [-head, BUMPER_Y],
      [-foot, BUMPER_FOOT_Y],
    ];
  };
  fill(ctx, 'rear', bumper(WHITE_LINE), WHITE);
  fill(ctx, 'rear', bumper(0), blue);

  // --- top: blue forward of the door split (windscreen pillars, cowl, hood), red piece at the nose end of the hood,
  // white roof with a red edge following the door line and a red square ---
  fill(ctx, 'top', rect(splitZ(1.45), Z_NOSE, -1.05, 1.05), blue);
  const hood: Pt[] = [
    ...HOOD_CREST.map(([z, x]): Pt => [z, -x]),
    ...HOOD_CREST.map(([z, x]): Pt => [z, x]).reverse(),
  ];
  fill(ctx, 'top', hood, red);
  // ... and over the hood's front lip, which faces forward (front chart).
  // The red runs straight down the nose to the bottom (grille bars included), NOSE_GAP inside the headlamps.
  const nose: Pt[] = LAMP_INNER.map(([y, x]): Pt => [x - NOSE_GAP, y]);
  fill(
    ctx,
    'front',
    [
      [-nose[0][0], 0],
      [nose[0][0], 0],
      ...nose,
      [HOOD_HALF, HOOD_TOP_Y],
      [HOOD_HALF, 1.7],
      [-HOOD_HALF, 1.7],
      [-HOOD_HALF, HOOD_TOP_Y],
      ...nose.map(([x, y]): Pt => [-x, y]).reverse(),
    ],
    red,
  );
  // The grille bars' top faces (top chart).
  fill(ctx, 'top', rect(GRILLE_TOP_Z, Z_NOSE, -HOOD_HALF, HOOD_HALF), red);
  const lineHalf = HOOD_CREST[0][1];
  fill(
    ctx,
    'top',
    [
      [HOOD_REAR_Z - HOOD_LINE, -lineHalf],
      [HOOD_REAR_Z - HOOD_LINE, lineHalf],
      [HOOD_REAR_Z, lineHalf],
      [HOOD_REAR_Z, -lineHalf],
    ],
    WHITE,
  );
  const edge = (side: 1 | -1): Pt[] =>
    ROOF_EDGE.map(([z, x]): Pt => [z, side * (x - ROOF_RED)]);
  fill(ctx, 'top', [...edge(-1), ...edge(1).reverse()], WHITE);
  fill(
    ctx,
    'top',
    [
      [SQUARE.z - SQUARE.h, -SQUARE.h],
      [SQUARE.z + SQUARE.h, -SQUARE.h],
      [SQUARE.z + SQUARE.h, SQUARE.h],
      [SQUARE.z - SQUARE.h, SQUARE.h],
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
