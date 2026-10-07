import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import { Rng } from '../../../../shared/rng';
import { CELL, blocks } from './livery-pattern';
import source from './model.source.json';

/**
 * Runtime paint for the Bimmer GT2 BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, grille, wing,
 * splitter and diffuser are separate parts with their own materials (`gltf.parts` in model.source.json), so nothing
 * painted here can reach them. Seed 0 = diagonal white / blue / red pixel-block scheme (`livery-pattern.ts`), pearl white
 * behind PEARL_Z; other seeds recolour the same blocks with the seed's base / accent colours.
 */
const A = source.atlas;
const { K, B, CH, Painter } = atlasKit(A);

/** Where the pattern's across-car coordinate p turns from the roof into the side: p = X_CREST is y = Y_CREST. */
const X_CREST = 0.8;
const Y_CREST = 1.15;
/** The crest is lower over the front wing / hood (z > Z_HOOD), blended over 0.7 m so the pattern stays continuous. */
const Y_CREST_HOOD = 0.98;
const Z_HOOD = 0.5;
/** Side height of pattern coordinate p (the side charts show the pattern running down the body). */
const sideY = (z: number, p: number) => {
  const t = Math.min(1, Math.max(0, (z - Z_HOOD) / 0.7));
  const crest = Y_CREST + (Y_CREST_HOOD - Y_CREST) * t;
  return crest - (Math.abs(p) - X_CREST);
};

/** |x| where the red blocks start on the rear end (half-way across a tail light). */
const REAR_X = 0.5;
/** The pearl edge is slightly narrower up on the boot lid. */
const REAR_LID_X = 0.44;
/** y of the boot lid's lower edge on the rear end. */
const REAR_LID_Y = 0.84;
/** Extra height of the arch at the middle. */
/** y where the pearl edge steps in from REAR_X to REAR_LID_X. */
const REAR_LID_SIDE_Y = 0.7;
const REAR_LID_ARCH = 0.05;
const PEARL = '#ece4d8';
const WHITES = [
  '#ece4d8',
  '#ece4d8',
  '#f4eee4',
  '#e2dad0',
  '#dcdbdd',
  '#cdd2da',
];
const BLUES = [
  '#0b3a8f',
  '#1252b8',
  '#1b78e0',
  '#3aa0f2',
  '#6cc3fb',
  '#082a6b',
];
const REDS = ['#d71f26', '#ee2f33', '#ff3d3a', '#f2594f', '#b0141f'];
const PALETTES = [WHITES, BLUES, REDS];

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];
const css = (c: number[]) =>
  `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;
/** Shade of the pattern colour: whites darken toward blue-grey, the rest plainly. */
const shaded = (c: string, f: number, white: boolean) => {
  const [r, g, b] = hex(c);
  return white
    ? css([r * f * 0.92, g * f * 0.96, b * f + 4])
    : css([r * f, g * f, b * f]);
};

/** Dark undercoat on the bottom chart (bumper / sill undersides). */
function underside(ctx: CanvasRenderingContext2D): void {
  const pts: Pt[] = [
    [CH.bottom[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1] + B.x[1] - B.x[0]],
    [CH.bottom[0], CH.bottom[1] + B.x[1] - B.x[0]],
  ];
  ctx.fillStyle = '#2a2c2f';
  ctx.beginPath();
  pts.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * K, y * K) : ctx.moveTo(x * K, y * K),
  );
  ctx.closePath();
  ctx.fill();
}

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  ctx.fillStyle = PEARL;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const P = new Painter(ctx);
  // seed 0: the reference colours; other seeds: base -> accent -> accent2 (shades of each)
  const bands =
    seed === 0 ? PALETTES : [[PEARL], [info.accent], [info.accent2]];
  const colour = (band: number, shade: number) =>
    bands[band][shade % bands[band].length];

  const draw = (poly: Pt[], fill: string) => {
    P.top(
      poly.map(([z, p]): Pt => [z, p]),
      fill,
      false,
    );
    // sides: the left side shows p > 0, the right side p < 0 (both read y = sideY(p))
    const sidePoly = (sign: 1 | -1) =>
      poly.map(([z, p]): Pt => [z, sideY(z, sign * p)]);
    if (poly.some(([, p]) => p > X_CREST - 0.05))
      P.side(sidePoly(1), fill, 'left');
    if (poly.some(([, p]) => p < -(X_CREST - 0.05)))
      P.side(sidePoly(-1), fill, 'right');
  };

  // all block faces first, then the trails on top (a later face must not paint over an earlier block's trail)
  for (const b of blocks()) draw(b.face, colour(b.band, b.shade));
  for (const b of blocks()) {
    if (!b.trail || !b.tip) continue;
    const base = colour(b.band, b.shade);
    draw(b.trail, seed === 0 ? shaded(base, b.trailF, b.band === 0) : base);
    draw(b.tip, base);
  }
  // front end: white / silver-white squares (same block size); rear end: pearl white behind the plate
  const front = new Rng(5);
  for (let x = -1.2; x < 1.2; x += CELL)
    for (let y = 0; y < 1.4; y += CELL)
      P.end(
        'front',
        [
          [x, y],
          [x + CELL, y],
          [x + CELL, y + CELL],
          [x, y + CELL],
        ],
        seed === 0 ? front.pick(WHITES) : PEARL,
        false,
      );
  P.end(
    'rear',
    [
      [-1.2, 0],
      [1.2, 0],
      [1.2, 1.4],
      [-1.2, 1.4],
    ],
    PEARL,
  );
  // rear end: red blocks on the boot lid and the outer corners; the middle (plate area) stays pearl below an arched edge
  // that follows the lid's curve, and the vertical edges at +-REAR_X run straight down to the bumper
  if (seed === 0) {
    const rear = new Rng(9);
    for (let y = 0; y < 1.4; y += CELL)
      for (let x = -1.2; x < 1.2; x += CELL)
        P.end(
          'rear',
          [
            [x, y],
            [x + CELL, y],
            [x + CELL, y + CELL],
            [x, y + CELL],
          ],
          rear.pick(REDS),
          false,
        );
    const arch: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const x = -REAR_LID_X + (2 * REAR_LID_X * i) / 16;
      arch.push([x, REAR_LID_Y + REAR_LID_ARCH * (1 - (x / REAR_LID_X) ** 2)]);
    }
    P.end(
      'rear',
      [
        [-REAR_X, 0],
        [REAR_X, 0],
        [REAR_X, REAR_LID_SIDE_Y],
        [REAR_LID_X, REAR_LID_SIDE_Y],
        ...arch.reverse(),
        [-REAR_LID_X, REAR_LID_SIDE_Y],
        [-REAR_X, REAR_LID_SIDE_Y],
      ],
      PEARL,
      false,
    );
  }
  underside(ctx);
}

export const bimmerGt2Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
