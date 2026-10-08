import { atlasKit, rect, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Bimmer M3 (`bimmer_m3`) BODY (the M3 ALMS livery, fitted to this mesh; the livery atlas written
 * by stl-to-glb.mjs). Lamps, grille,
 * louvres, glass, wing... are separate parts with their own materials (`parts` in
 * model.source.json -> cars/shared/part-materials.ts), so nothing painted here reaches them.
 *
 * M3 ALMS livery, after the 2001 M3 GTR (white + BMW blue, shapes only - no sponsors, flags or lettering):
 * - bonnet (top chart only): the same solid blue shape on both sides, from the raised centre
 *   section's edge to the end of the bonnet, breaking into small checkers at the A pillars;
 * - sides (identical): a diagonal line from the sill under the door's middle up to the door's
 *   rear top corner splits the car - everything behind it is blue (rear door, C pillars, roof
 *   rails, rear fenders);
 * - tail: behind the rear wheels the blue breaks into a checkered flag that wraps round the
 *   rear corners onto the boot lid and bumper, in the three M colours by height: red on the
 *   bumper, light blue at lamp height, dark blue between and above.
 * All coordinates are model space (metres, +x = car's left).
 */
const A = source.atlas;
const { K, B, CH, sidePx, topPx, frontPx, rearPx } = atlasKit(A);

type Chart = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'rear';

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
const PLAN: [number, number] = [B.z[1] - B.z[0], B.x[1] - B.x[0]];
const END: [number, number] = [B.x[1] - B.x[0], B.y[1] - B.y[0]];
const SIZE: Record<Chart, [number, number]> = {
  left: SIDE,
  right: SIDE,
  top: PLAN,
  bottom: PLAN,
  front: END,
  rear: END,
};

/** Fill a model-space polygon on one chart (clipped to the chart). */
function fill(
  ctx: CanvasRenderingContext2D,
  chart: Chart,
  pts: Pt[],
  style: string,
): void {
  const px = PX[chart];
  const [cx, cy] = CH[chart];
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx * K, cy * K, SIZE[chart][0] * K, SIZE[chart][1] * K);
  ctx.clip();
  ctx.fillStyle = style;
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

const sides = (ctx: CanvasRenderingContext2D, pts: Pt[], style: string) => {
  fill(ctx, 'left', pts, style);
  fill(ctx, 'right', pts, style);
};

// --- side split: sill under the door's middle -> the door's rear top corner (belt line) -------
/** z of the split line at height y (door shut lines z 0.83 / -0.33, belt y 0.95). */
const splitZ = (y: number) => 0.3 - 0.79 * (y - 0.15);

// --- tail checkers: one grid wrapping the sides, the top and the rear -------------------------
// The converter switches a rear-corner triangle from the side chart (which reaches z -2.2) to the
// rear chart (from |x| 0.70 - 0.78), and an upward-facing one to the top chart at the quarter
// panel's crest (y ~0.9, |x| ~0.72). Cell edges are placed so each seam runs INSIDE one cell that
// is painted the same colour on both charts: the side's last column = the rear's outer column, the
// side's crest row = the top chart's outer cell, and the top chart's last column = the rear's top row.
/**
 * Side columns k = 0..TAIL_COLS-1 run rearward from TAIL_Z; the last one reaches the tail. 8 columns: the last starts
 * at z -2.19, so the boot lid (z -1.92 .. -2.35) gets 11 cm cells to its rear edge and the side / rear seam (side
 * chart ends at z -2.22 .. -2.39 beside the lamps) stays inside that last column.
 */
const CELL = 0.11;
const TAIL_Z = -1.42;
const TAIL_COLS = 8;
/**
 * Rows r = 0..7: lower edges on the side / rear charts (the first runs down from the chart bottom,
 * the last up to the top). Row 7 is the CREST row: on the side chart y >= 0.841, on the top chart
 * the outer cell |x| >= COLS_X[0] - it holds the quarter panel's crest (side -> top), so the
 * faces on either side of the crest are in one cell and agree. Rows 8, 9, 10 continue inward
 * across the trunk lid (top chart, the columns of COLS_X; two inward rows now). The bumper ledge (y ~0.5, row 3) is
 * on the top chart's outer cell too, so rows 3 and 7 have the same parity and colour. Rows 5 + 6 = the tail lamps'
 * height (y 0.662 - 0.841, model.source.json `tail` pick), so no sliver of another row shows above or below a lamp.
 */
const ROWS = [0, 0.2, 0.31, 0.42, 0.53, 0.662, 0.75, 0.841];
const CREST = ROWS.length - 1;
/** Rear chart: the crest row's corner cell starts here (below the lamp top 0.841; the lamp covers the rest). */
const CREST_SEAL_Y = 0.82;
/**
 * First checker column per row (bumper .. crest): solid blue in front of it. The lower rows start
 * just behind the arch, the upper ones further forward; each starts on a white cell
 * ((column + row) odd), so the blue ends in a clean stepped cut-out.
 */
const FIRST_COL = [3, 4, 3, 4, 3, 2, 1, 2];
/** |x| lower edges of the columns j = 0..2 on the rear chart AND the top chart's rows 7 + j (outermost first). */
const COLS_X = [0.62, 0.51, 0.4];
/** Top chart: the blue on the roof rails reaches inward to this |x| (the roof's edge is at ~0.46). */
const ROOF_X = 0.42;
/** Checkerboard over (column, row): coloured, else white. */
const coloured = (m: number, n: number) => (m + n) % 2 === 0;

/**
 * Edge between columns 5 and 6, moved 2 cm back from the grid's -2.08: that put it on the curved lip under the tail
 * lamp's lower-front corner (the lamp starts at z -2.075), where it showed as a blue tooth. At -2.10 the fold is inside
 * column 5 and the light-blue lamp-height cell meets the lamp's front edge.
 */
const LAMP_EDGE_Z = -2.1;
/** Front edge of side column k. */
const colEdge = (k: number) => (k === 6 ? LAMP_EDGE_Z : TAIL_Z - k * CELL);
/**
 * Last side column of row r (it runs off the tail). Row 6 (upper lamp row) stops at column 6: column 7 is behind the
 * lamp there except a sliver at the lamp's top front corner (groove at z -2.17 .. -2.19), a white wedge next to the seal.
 */
const lastCol = (r: number) => (r === 6 ? 6 : TAIL_COLS - 1);
/** z range of side column k (the last runs off the tail). */
const colZ = (k: number): Pt => [
  colEdge(k),
  k === TAIL_COLS - 1 ? B.z[0] : colEdge(k + 1),
];
/** |x| range of rear / top column j (the outermost runs off the side). */
const colX = (j: number): Pt => [j === 0 ? B.x[1] : COLS_X[j - 1], COLS_X[j]];
/** y range of row r (the first from the chart bottom, the last to the top). */
const rowY = (r: number): Pt => [
  r === 0 ? B.y[0] : ROWS[r],
  r === ROWS.length - 1 ? B.y[1] : ROWS[r + 1],
];

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  // Seed 0 = the M3 ALMS livery (M blue, light blue, red); other seeds reuse the shapes.
  const blue = seed === 0 ? '#1f2c8c' : info.accent;
  const light = seed === 0 ? '#3f9be0' : info.accent2;
  const red = seed === 0 ? '#d4232b' : info.accent2;
  /** Checker colour by row: red on the bumper, blue, light blue at lamp height, blue on the shoulder. */
  const rowColour = (r: number) => (r <= 2 ? red : r === 5 ? light : blue);
  /** Side cell (k, r): solid blue in front of the row's first column, else the checkerboard. */
  const cellColour = (k: number, r: number) =>
    k < FIRST_COL[r] ? blue : coloured(k, r) ? rowColour(r) : info.base;

  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat (chart laid out like the top one: z along, x across).
  fill(ctx, 'bottom', rect(B.z[1], B.x[0], B.z[0], B.x[1]), '#26272a');

  // --- sides: solid blue behind the split line, then the tail flag ---------------------------
  sides(
    ctx,
    [
      [splitZ(-0.1), -0.1],
      [splitZ(1.5), 1.5],
      [B.z[0], 1.5],
      [B.z[0], -0.1],
    ],
    blue,
  );
  FIRST_COL.forEach((k0, r) => {
    const last = lastCol(r);
    for (let k = k0; k <= last; k++) {
      const z0 = colZ(k)[0];
      const z1 = k === last ? B.z[0] : colZ(k)[1];
      const [y0, y1] = rowY(r);
      sides(ctx, rect(z0, y0, z1, y1), cellColour(k, r));
    }
  });

  // --- rear: the flag carries on round the corners (column j continues the sides' k), white
  // in the middle. At lamp height (rows 5, 6) only the corner column: further in, the lamps
  // leave just slivers. The top row is the boot lid's rear face above the lamps: the same
  // cells as the lid's last column on the top chart, so the squares fold over the lid's edge. --
  for (let r = 0; r < ROWS.length; r++) {
    for (let j = 0; j < (r === 5 || r === 6 ? 1 : COLS_X.length); j++) {
      const m = TAIL_COLS - 1 + j;
      if (!coloured(m, r)) continue;
      const [y0, y1] = rowY(r);
      const [x0, x1] = colX(j);
      // Corner cell of the crest row reaches down over the lamp's top seal: the body band just under it (y 0.82 -
      // 0.841) is row 6 on the rear chart, which is white there (a pale strip on top of the lamp).
      const lo = r === CREST && j === 0 ? CREST_SEAL_Y : y0;
      for (const s of [1, -1])
        fill(ctx, 'rear', rect(s * x0, lo, s * x1, y1), rowColour(r));
    }
  }

  // --- top: blue shoulders, roof rails and C pillars behind the split (ending a little on the
  // roof, |x| 0.45), then the flag's top rows. -----------------------------------------------
  for (const s of [1, -1]) {
    fill(
      ctx,
      'top',
      [
        [splitZ(0.95), s * B.x[1]],
        [splitZ(0.95), s * 0.76],
        [splitZ(1.35), s * 0.6],
        [splitZ(1.4), s * ROOF_X],
        [colZ(FIRST_COL[CREST])[0], s * ROOF_X],
        [colZ(FIRST_COL[CREST])[0], s * B.x[1]],
      ],
      blue,
    );
    // Row 7 + j: the crest cell (j = 0, reaching out over the flare) and three rows of squares
    // inward across the trunk lid; the columns run along z like the side's, the last one is the
    // lid's rear edge and carries on the rear face's top row.
    for (let j = 0; j < COLS_X.length; j++) {
      const [x0, x1] = colX(j);
      for (let k = FIRST_COL[CREST]; k < TAIL_COLS; k++) {
        const [z0, z1] = colZ(k);
        fill(
          ctx,
          'top',
          rect(z0, s * x0, z1, s * x1),
          j === 0
            ? cellColour(k, CREST)
            : coloured(k, CREST + j)
              ? blue
              : info.base,
        );
      }
    }
  }

  // --- bonnet (both sides, mirrored): one solid blue shape from the raised centre section's
  // edge (the diagonal crease, headlight -> A pillar, through the louvre) out to the end of the
  // bonnet (the line along the fender top), front edge on the headlight's rear rim; towards the
  // windscreen it breaks into checkers. Measured on 800 / 1100 px/m top renders of the GLB. The
  // crease walls inside it are sent to the top chart by `atlas.chartBoxes` (model.source.json).
  const hood: Pt[] = [
    // INNER edge = the bonnet's diagonal crest (convex ridge, headlight -> windscreen), measured on a top-down
    // curvature map of the GLB (800 px/m, 5 cm steps): x = 0.64 - 0.264 (z - 1.0) from z 1.0 to 1.95
    [2.05, 0.34], // front end, where the ridge meets the nose
    [1.95, 0.389],
    [1.9, 0.405],
    [1.7, 0.461],
    [1.5, 0.514],
    [1.3, 0.562],
    [1.1, 0.614],
    [1.0, 0.64],
    [0.9, 0.668], // rear end: the bonnet's rear edge at the cowl
    // OUTER edge = the seam groove between bonnet and fender (concave minimum, same map), the end of the bonnet
    [0.9, 0.771],
    [1.0, 0.774],
    [1.1, 0.771],
    [1.2, 0.767],
    [1.35, 0.762],
    [1.45, 0.757],
    [1.55, 0.752],
    [1.65, 0.745],
    [1.72, 0.738],
    [1.79, 0.73],
    [1.84, 0.7], // headlight rear rim (the recess walls stay white)
    [1.87, 0.63],
    [1.97, 0.45],
  ];
  /** Solid in front of this z; behind it 10 cm checkers clipped to the same outline. */
  const FLAG_Z = 1.35;
  for (const s of [1, -1]) {
    ctx.save();
    ctx.beginPath();
    hood.forEach(([z, x], i) => {
      const [u, v] = topPx(z, s * x);
      if (i) ctx.lineTo(u, v);
      else ctx.moveTo(u, v);
    });
    ctx.closePath();
    ctx.clip();
    fill(ctx, 'top', rect(B.z[1], s * 0.3, FLAG_Z, s * 0.9), blue);
    for (let k = 0; FLAG_Z - k * 0.1 > 0.85; k++)
      for (let j = 0; j < 6; j++) {
        if ((k + j) % 2) continue;
        const z0 = FLAG_Z - k * 0.1;
        const x0 = 0.9 - j * 0.1;
        fill(ctx, 'top', rect(z0, s * x0, z0 - 0.1, s * (x0 - 0.1)), blue);
      }
    ctx.restore();
  }
}

const { matteRect } = atlasKit(A);

export const bimmerM3Atlas: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  matteRect,
  layout: A,
  paint(ctx, info, seed) {
    paint(ctx, info, seed);
    // Wheel-well liner (converter `wheels.liner`) maps to this texel patch: black + matte like every car's arches.
    ctx.fillStyle = '#000';
    ctx.fillRect(...matteRect);
  },
};
