import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import { blocks } from './livery-pattern';
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
/** Side height of pattern coordinate p (the side charts show the pattern running down the body). */
const sideY = (p: number) => Y_CREST - (Math.abs(p) - X_CREST);

const PEARL = '#f7f7f2';
const WHITES = ['#f6f8fb', '#f6f8fb', '#eaf0f6', '#d9e3ee', '#c4d3e4'];
const BLUES = [
  '#0b3a8f',
  '#1252b8',
  '#1b78e0',
  '#3aa0f2',
  '#6cc3fb',
  '#082a6b',
];
const REDS = ['#b81d2a', '#d92b34', '#ee4b45', '#f27a6e', '#8e1626'];
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
      poly.map(([z, p]): Pt => [z, sideY(sign * p)]);
    if (poly.some(([, p]) => p > X_CREST - 0.05))
      P.side(sidePoly(1), fill, 'left');
    if (poly.some(([, p]) => p < -(X_CREST - 0.05)))
      P.side(sidePoly(-1), fill, 'right');
  };

  for (const b of blocks()) {
    const base = colour(b.band, b.shade);
    draw(b.face, base);
    if (b.trail && b.tip) {
      draw(b.trail, seed === 0 ? shaded(base, b.trailF, b.band === 0) : base);
      draw(b.tip, base);
    }
  }
  // rear / front ends: pearl white behind the plate, white at the nose
  P.end(
    'front',
    [
      [-1.2, 0],
      [1.2, 0],
      [1.2, 1.4],
      [-1.2, 1.4],
    ],
    seed === 0 ? WHITES[0] : PEARL,
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
  underside(ctx);
}

export const bimmerGt2Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
