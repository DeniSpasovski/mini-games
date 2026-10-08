import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Skoda Rally BODY (imported GLB, atlas layout in model.source.json) (the livery atlas). Glass, lamps, grille,
 * intakes, vents, wing, handles... are separate parts with their own materials
 * (`parts` in model.source.json -> cars/shared/part-materials.ts), so nothing painted
 * here can reach them.
 *
 * Livery after the works anniversary car (white + green speed stripes; shapes only, no
 * logos): identical on both sides - a slanted block of stripes on the front door that
 * breaks into fading streaks over the rear door and rear quarter - and asymmetric down the
 * middle: five stripes left of centre run bonnet (arrow tip) -> roof -> tailgate, plus one
 * green wedge on the front bumper. All coordinates are model space (metres).
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

/** `#rrggbb` -> `rgba(r, g, b, a)` (gradient stops that fade out without a grey fringe). */
const alpha = (hex: string, a: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${a})`;

// --- side stripes: rows from the top down, all leaning forward (italic) ---------------------
const LEAN = 0.42; // metres of z per metre of y
const lean = (y: number) => LEAN * (y - 0.6);
/** Rows from y = 0.86 down: thin bright rows between thick dark ones. */
const ROWS: { y0: number; y1: number; thick: boolean }[] = (() => {
  const rows = [];
  let y = 0.86;
  for (let i = 0; i < 9; i++) {
    const thick = i % 2 === 1;
    const h = thick ? 0.072 : 0.03;
    rows.push({ y0: y - h, y1: y, thick });
    y -= h + 0.012;
  }
  return rows;
})();
/** z of the front door's front shut line: the side stripes start here, clear of the front arch. */
const DOOR_FRONT = 0.55;
/**
 * Height range of the green band round the rear bumper corners: from the black diffuser up over
 * the bumper's rear face (y 0.38 - 0.55). The same range on the side and rear charts, and the side
 * part runs right up to the arch, so the two charts agree on the rounded corner (no seam).
 */
const REAR_BAND: [number, number] = [0.29, 0.52];
/** Green band on the front splitter lip: from the black intake openings' bottom edge (y 0.215) all the way down to the splitter's underside, same y on the side and front charts. */
const FRONT_LIP: [number, number] = [0.0, 0.225];
/** A leaning row segment between two z positions (given at y = 0.6). */
const row = (zFront: number, zRear: number, y0: number, y1: number): Pt[] => [
  [zFront + lean(y0), y0],
  [zRear + lean(y0), y0],
  [zRear + lean(y1), y1],
  [zFront + lean(y1), y1],
];

/** Top edge of the tailgate panel under the rear screen's black frame (rear chart y). */
const TAILGATE_TOP = 1.07;

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const bright = seed === 0 ? '#21c7a3' : info.accent;
  const dark = seed === 0 ? '#0b5446' : info.accent2;
  const mint = seed === 0 ? '#93e6d3' : alpha(info.accent, 0.45);

  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down (bumper and sill undersides...).
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

  // --- sides (identical left / right) -------------------------------------------------------
  ROWS.forEach(({ y0, y1, thick }, i) => {
    const upper = i < 4;
    // Front-door block: it starts at the door's front shut line (the flared wheel arch in
    // front of it stays plain); upper rows run further back, so the rear edge steps.
    const zEnd = upper ? -0.34 : 0.0;
    sides(
      ctx,
      [
        [DOOR_FRONT, y0],
        [zEnd + lean(y0), y0],
        [zEnd + lean(y1), y1],
        [DOOR_FRONT, y1],
      ],
      thick
        ? {
            from: [DOOR_FRONT, y0],
            to: [zEnd, y0],
            stops: [
              [0, bright],
              [0.55, dark],
              [1, dark],
            ],
          }
        : bright,
    );
    // Streaks behind the block, fading out towards the tail.
    const [z0, z1] = upper ? [-0.5, -1.52] : [-0.14, -0.94];
    const c = thick ? dark : bright;
    sides(ctx, row(z0, z1, y0, y1), {
      from: [z0, y0],
      to: [z1, y0],
      stops: [
        [0, c],
        [0.35, alpha(c, 0.75)],
        [1, alpha(c, 0)],
      ],
    });
  });
  // Bumper corners: a green lip round the nose and a plain green band round the rear corner.
  // Both are level (same y on the side and end charts), so they meet cleanly at the corner.
  sides(
    ctx,
    [
      [1.63, FRONT_LIP[0]],
      [2.1, FRONT_LIP[0]],
      [2.1, FRONT_LIP[1]],
      [1.63, FRONT_LIP[1]],
    ],
    bright,
  );
  sides(
    ctx,
    [
      [-1.72, REAR_BAND[0]],
      [-2.15, REAR_BAND[0]],
      [-2.15, REAR_BAND[1]],
      [-1.72, REAR_BAND[1]],
    ],
    bright,
  );
  // Black sill strip between the wheels.
  sides(
    ctx,
    [
      [0.66, 0],
      [-1.0, 0],
      [-1.0, 0.205],
      [0.66, 0.205],
    ],
    '#141516',
  );

  // --- middle (asymmetric): five stripes left of centre, bonnet -> roof -> tailgate ---------
  const tip = (x: number) => 1.66 - 1.15 * Math.abs(x - 0.28);
  for (let i = 0; i < 5; i++) {
    const x0 = 0.1 + i * 0.075;
    const x1 = x0 + 0.06;
    const color = i % 2 ? mint : bright;
    // Bonnet: the stripes end on a chevron, an arrow tip pointing at the nose.
    fill(
      ctx,
      'top',
      [
        [0.9, x0],
        [tip(x0), x0],
        [tip(x1), x1],
        [0.9, x1],
      ],
      {
        from: [0.9, x0],
        to: [1.66, x0],
        stops: [
          [0, dark],
          [0.5, color],
        ],
      },
    );
    // Roof (the tailgate is painted on the rear chart below; nothing on the bumper ledge behind it).
    fill(
      ctx,
      'top',
      [
        [0.3, x0],
        [-1.46, x0],
        [-1.46, x1],
        [0.3, x1],
      ],
      color,
    );
    // Tailgate, darker towards the bumper.
    fill(
      ctx,
      'rear',
      [
        [x0, 0.64],
        [x1, 0.64],
        [x1, TAILGATE_TOP],
        [x0, TAILGATE_TOP],
      ],
      {
        from: [x0, TAILGATE_TOP],
        to: [x0, 0.64],
        stops: [
          [0.35, color],
          [1, dark],
        ],
      },
    );
  }

  // --- front: only the splitter's edge band is green (the bumper face and intake surrounds stay plain) ---
  fill(
    ctx,
    'front',
    [
      [-1.06, FRONT_LIP[0]],
      [1.06, FRONT_LIP[0]],
      [1.06, FRONT_LIP[1]],
      [-1.06, FRONT_LIP[1]],
    ],
    bright,
  );

  // --- rear: the corner bands carry on round from the sides, cut on a slant, and under the
  // bumper's corner so no white shows from below ------------------------------------------------
  for (const s of [1, -1]) {
    fill(
      ctx,
      'bottom',
      [
        [-1.75, s * 0.55],
        [-2.2, s * 0.55],
        [-2.2, s * 1.05],
        [-1.75, s * 1.05],
      ],
      bright,
    );
    fill(
      ctx,
      'rear',
      [
        [s * 1.06, REAR_BAND[0]],
        [s * 1.06, REAR_BAND[1]],
        [s * 0.56, REAR_BAND[1]],
        [s * 0.48, REAR_BAND[0]],
      ],
      bright,
    );
  }
}

export const skodaRallyLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
