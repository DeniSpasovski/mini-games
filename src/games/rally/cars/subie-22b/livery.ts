import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat, and the side
 * graphic - a crescent swoosh with a cluster of four-point stars, redrawn as shapes after the owner's reference picture
 * (no lettering). It is drawn the right way round on both sides (side charts are viewer-oriented, see atlas-painter.ts).
 */
const A = source.atlas;
const { K, B, CH, Painter } = atlasKit(A);

const YELLOW = '#e8f03a';
/** Graphic centre on the body side (m): door / rear door, below the belt, behind the door number plate. */
const AT = { z: -0.5, y: 0.56 };
/** Metres per reference pixel (the reference crescent is 254 px wide). */
const PX = 0.0036;

/** Reference picture coordinates (px, y down): the crescent outline, sweeping from the lower end round the left bulge to the upper tip. */
const CRESCENT: Pt[] = [
  [283, 217],
  [272, 220],
  [250, 222],
  [225, 222],
  [200, 219],
  [181, 212],
  [170, 204],
  [168, 195],
  [185, 185],
  [205, 172],
  [225, 162],
  [252, 151],
  [285, 141],
  [320, 132],
  [360, 125],
  [400, 121],
  [422, 121],
  [395, 126],
  [355, 132],
  [315, 140],
  [280, 151],
  [253, 162],
  [235, 173],
  [226, 184],
  [229, 195],
  [243, 204],
  [262, 211],
];
/** Four-point stars: centre x, y (px) and horizontal / vertical point length. */
const STARS: [number, number, number, number][] = [
  [278, 178, 38, 24],
  [344, 180, 19, 14],
  [321, 189, 14, 11],
  [350, 194, 14, 11],
  [297, 207, 13, 10],
  [331, 205, 13, 10],
];

/** Chaikin corner cutting: rounds the hand-placed outline. */
function smooth(pts: Pt[], rounds = 3): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      q.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75],
      );
    }
    p = q;
  }
  return p;
}

/** Four-point star with concave sides, as a reference-px polygon. */
function star(cx: number, cy: number, rh: number, rv: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const k = i % 2 ? 0.2 : 1;
    pts.push([cx + Math.cos(a) * rh * k, cy + Math.sin(a) * rv * k]);
  }
  return pts;
}

/** Reference px -> body side (z, y); `flip` for the left chart, where the front is on the viewer's left. */
const place =
  (flip: boolean) =>
  ([x, y]: Pt): Pt => [
    AT.z + (flip ? -1 : 1) * (x - 295) * PX,
    AT.y - (y - 172) * PX,
  ];

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Dark undercoat on the bottom chart (bumper / sill undersides).
  const [bx, by] = CH.bottom;
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(bx * K, by * K, (B.z[1] - B.z[0]) * K, (B.x[1] - B.x[0]) * K);

  const p = new Painter(ctx);
  for (const side of ['left', 'right'] as const) {
    const at = place(side === 'left');
    p.side(smooth(CRESCENT).map(at), YELLOW, side);
    for (const [cx, cy, rh, rv] of STARS)
      p.side(star(cx, cy, rh, rv).map(at), YELLOW, side);
  }
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
