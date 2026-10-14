import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Mustang GT3 BODY (imported GLB, atlas layout in model.source.json): the model has no livery, so this
 * paints ours (seed 0: white quarter stripes, red tail, light-blue fender stripes; other seeds one flat colour) over a dark underside. Glass, lamps, trim
 * and the cockpit are separate parts (`gltf.parts` in model.source.json), so nothing painted here can reach them.
 */
const A = source.atlas;
const { K, B, CH, Painter, sidePx } = atlasKit(A);

const WHITE = '#f1f3f6';
const RED = '#c4202c';
const SKY = '#1fa0e8';

// Rear quarter: RAIL stripes run from behind the door (z -0.8) to the tail; each is thicker than the one before, the colour
// goes white -> red and the last ones merge into solid red. Stripes lean with the bottom edge further forward.
const RAIL = 13;
const REAR_Z0 = -0.8; // behind the door's rear edge (door edge z ~ -0.65)
const REAR_PITCH = 0.1; // stripe pitch along z; the last width equals it, so the stripes close up
const LEAN = 0.42; // bottom edge sits this much further forward than the top (z)
const LEAN_TOP = 0.9;
const SHOULDER = 0.98; // top of the stripes beside the window (below the glass)
const DECK = 1.5; // above this nothing is painted on the side chart; the top chart carries the roof / deck

// Front fender: solid light blue behind the front arch that breaks up into FIN stripes going rearward and thinning out.
const FIN = 28;
/** The rear chart also holds rear-facing walls further forward (door gaps, mirror, vent ribs) at |x| > 0.8: red only on the back panel. */
const REAR_RED_X = 0.8;

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed = 0,
): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down.
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(
    CH.bottom[0] * K,
    CH.bottom[1] * K,
    (B.z[1] - B.z[0]) * K,
    (B.x[1] - B.x[0]) * K,
  );
  if (seed !== 0) return;
  const P = new Painter(ctx);

  // Rear stripes (side + top).
  const rearW = (k: number) =>
    0.015 + (REAR_PITCH - 0.015) * (k / (RAIL - 1)) ** 1.0;
  for (let k = 0; k < RAIL; k++) {
    const z0 = REAR_Z0 - k * REAR_PITCH;
    const z1 = z0 - rearW(k);
    const col = WHITE;
    // y from the sill up; the lean is applied by shifting the lower points forward
    const yLo = 0.12;
    const yHi = k < 2 ? SHOULDER : DECK;
    // Above LEAN_TOP the stripe stops leaning: the side -> top chart seam sits at 0.94 - 1.15 depending on z, and a constant
    // offset there keeps the roof / deck stripes lined up with the side ones wherever the seam is.
    const lean = (y: number) =>
      (LEAN * (SHOULDER - Math.min(y, LEAN_TOP))) / (SHOULDER - yLo);
    const poly: Pt[] = [
      [z0 + lean(yHi), yHi],
      [z1 + lean(yHi), yHi],
      [z1 + lean(LEAN_TOP), LEAN_TOP],
      [z1 + lean(yLo), yLo],
      [z0 + lean(yLo), yLo],
      [z0 + lean(LEAN_TOP), LEAN_TOP],
    ];
    P.side(poly, col);
    if (z0 < -1.0) {
      // The top chart carries the stripe where it crosses the roof edge: same z as the side stripe at CREST height.
      const o = lean(LEAN_TOP);
      P.top(
        [
          [z0 + o, -1.1],
          [z1 + o, -1.1],
          [z1 + o, 0],
          [z0 + o, 0],
        ],
        col,
      );
    }
  }
  const tail = REAR_Z0 - RAIL * REAR_PITCH + REAR_PITCH;
  // White tail behind the last stripe, ending at the trunk / quarter corner crease; the lid is white too.
  P.side(
    [
      [tail + LEAN, DECK],
      [-3, DECK],
      [-3, 0],
      [tail + LEAN, 0],
    ],
    WHITE,
  );
  // Top chart behind the quarters: the lid is white (|x| < 0.82, z > -2.14); the bumper ledge (z < -2.14 shares the lid edge's texels) and corners that share its
  // texels (lower, further back / out) are red.
  P.top(
    [
      [-1.75, -1.1],
      [-3, -1.1],
      [-3, 0],
      [-1.75, 0],
    ],
    RED,
  );
  P.top(
    [
      [-1.75, -0.82],
      [-2.14, -0.82],
      [-2.14, 0],
      [-1.75, 0],
    ],
    WHITE,
  );

  // Corner crease line (measured on the side view): top (z, y) -> bottom; the red back panel starts behind it.
  P.side(
    [
      [-2.385, DECK],
      [-3, DECK],
      [-3, 0],
      [-1.82, 0],
    ],
    RED,
  );
  // Small red pinstripes on the white tail, from the sill up to the top edge (side chart only: the lid stays white), parallel to the red corner panel's edge (z = -1.82 - 0.38 y).
  for (const off of [0.03, 0.062, 0.094, 0.126]) {
    const zAt = (y: number) => -1.82 - 0.38 * y + off;
    P.side(
      [
        [zAt(0.2), 0.2],
        [zAt(0.2) - 0.014, 0.2],
        [zAt(DECK) - 0.014, DECK],
        [zAt(DECK), DECK],
      ],
      RED,
    );
  }
  // Rear chart: the red back panel incl. the lid lip. The chart also holds rear-facing walls elsewhere (door gaps, mirror,
  // vent ribs at |x| > 0.8): red stops at REAR_RED_X. The hood-base edge shares the lip's texels (y 0.88 - 0.94) and stays red.
  P.end(
    'rear',
    [
      [-REAR_RED_X, 0],
      [REAR_RED_X, 0],
      [REAR_RED_X, 1.0],
      [-REAR_RED_X, 1.0],
    ],
    RED,
  );

  // Front fender (traced by hand on the car viewer, mapped with the vent's corners): solid light blue above the vent's
  // louvre lines, leaning stripes below them and over the door, all inside the traced outline FIELD.
  /** Nothing above the fender's top edge (the red line in Deni's trace): the louvre faces end here, the sloped top is bare. */
  const FENDER_TOP = 0.885;
  const SOLID: Pt[] = [
    [0.8, FENDER_TOP],
    [1.9, FENDER_TOP],
    [1.9, 0.85],
    [1.09, 0.855],
    [1.121, 0.746],
    [0.802, 0.694],
  ];
  const DOOR_TOP = 0.84; // stripes stop under the door's shoulder line: none on the cowl / A-pillar base
  const FIELD: Pt[] = [
    [0.39, DOOR_TOP],
    [0.69, DOOR_TOP],
    [0.69, 0.69],
    [0.802, 0.694],
    [1.121, 0.746],
    [1.09, 0.855],
    [1.454, 0.846],
    [1.572, 0.703],
    [1.44, 0.735],
    [1.145, 0.717],
    [1.045, 0.569],
    [0.875, 0.569],
    [0.83, 0.403],
    [0.39, 0.4],
  ];
  P.side(SOLID, SKY);
  const FIN_REF = 0.945; // stripes are defined at this height
  const FIN_SLOPE = 0.5; // z shift per metre of height drop (traced: ~0.45 on the door, steeper on the vent)
  for (const s of ['left', 'right'] as const) {
    ctx.save();
    ctx.beginPath();
    FIELD.forEach(([z, y], i) => {
      const [px, py] = sidePx(s, z, y);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
    for (let k = 0; k < FIN; k++) {
      const zt = 1.6 - k * 0.045;
      const w = 0.022;
      const at = (z: number, y: number): Pt => [
        z + (FIN_REF - y) * FIN_SLOPE,
        y,
      ];
      P.side(
        [at(zt, 1.0), at(zt - w, 1.0), at(zt - w, 0.3), at(zt, 0.3)],
        SKY,
        s,
      );
    }
    ctx.restore();
  }
}

export const fordGt3Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
