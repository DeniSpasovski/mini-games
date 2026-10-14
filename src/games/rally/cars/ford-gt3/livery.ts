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
const { K, B, CH, Painter } = atlasKit(A);

const WHITE = '#f1f3f6';
const RED = '#c4202c';
const SKY = '#1fa0e8';

// Rear quarter: RAIL stripes run from behind the door (z -0.8) to the tail; each is thicker than the one before, the colour
// goes white -> red and the last ones merge into solid red. Stripes lean with the bottom edge further forward.
const RAIL = 13;
const REAR_Z0 = -0.8; // behind the door's rear edge (door edge z ~ -0.65)
const REAR_PITCH = 0.1; // stripe pitch along z; the last width equals it, so the stripes close up
const LEAN = 0.42; // bottom edge sits this much further forward than the top (z)
const SHOULDER = 0.98; // top of the stripes beside the window (below the glass)
/** Height where the side chart hands over to the top chart at |x| ~0.7 (chart-probe): 1.15 at the C-pillar, 0.94 at the tail. */
const crestY = (z: number) =>
  0.94 + 0.21 * Math.min(1, Math.max(0, (z + 1.9) / 0.8));
const DECK = 1.5; // above this nothing is painted on the side chart; the top chart carries the roof / deck

// Front fender: solid light blue behind the front arch that breaks up into FIN stripes going rearward and thinning out.
const FIN = 12;
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
    const lean = (y: number) => (LEAN * (SHOULDER - y)) / (SHOULDER - yLo);
    const poly: Pt[] = [
      [z0 + lean(yHi), yHi],
      [z1 + lean(yHi), yHi],
      [z1 + lean(yLo), yLo],
      [z0 + lean(yLo), yLo],
    ];
    P.side(poly, col);
    if (z0 < -1.0) {
      // The top chart carries the stripe where it crosses the roof edge: same z as the side stripe at CREST height.
      const o = lean(crestY(z0));
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
  P.top(
    [
      [-1.75, -1.1],
      [-3, -1.1],
      [-3, 0],
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
  P.end(
    'rear',
    [
      [-REAR_RED_X, 0],
      [REAR_RED_X, 0],
      [REAR_RED_X, 1.6],
      [-REAR_RED_X, 1.6],
    ],
    RED,
  );

  // Front fender: solid light blue on the vent panel (outline traced in the car viewer) and a band along the top of the
  // fender to the nose, then FIN stripes (leaning, bottom edge forward) going back over the door, thinning out. The
  // stripes sit between the shoulder line (FIN_TOP) and the door's lower line (FIN_BOT).
  const VENT: Pt[] = [
    [0.727, 0.848],
    [1.023, 0.842],
    [1.148, 0.717],
    [1.045, 0.569],
    [0.875, 0.569],
    [0.898, 0.717],
  ];
  P.side(VENT, SKY);
  // Fender top / louvre faces (side chart, y 0.70 - 0.90 from the vent to the nose).
  P.side(
    [
      [0.73, 0.9],
      [1.5, 0.9],
      [1.5, 0.7],
      [0.73, 0.7],
    ],
    SKY,
  );
  const FIN_TOP = 0.82;
  const FIN_BOT = 0.38;
  const FIN_SLOPE = 0.43; // z shift per metre of height drop
  const GAP_Z = 0.675; // door / fender cut line: the stripes stop here, the vent block starts on the other side
  const clipZ = (pts: Pt[]): Pt[] => {
    const out: Pt[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (a[0] <= GAP_Z) out.push(a);
      if (a[0] <= GAP_Z !== b[0] <= GAP_Z)
        out.push([
          GAP_Z,
          a[1] + ((b[1] - a[1]) * (GAP_Z - a[0])) / (b[0] - a[0]),
        ]);
    });
    return out;
  };
  for (let k = 0; k < FIN; k++) {
    const t = k / (FIN - 1);
    const zt = 0.82 - k * 0.04;
    const w = 0.03 * (1 - t) + 0.01;
    const sh = (FIN_TOP - FIN_BOT) * FIN_SLOPE;
    const quad = clipZ([
      [zt, FIN_TOP],
      [zt - w, FIN_TOP],
      [zt - w + sh, FIN_BOT],
      [zt + sh, FIN_BOT],
    ]);
    if (quad.length > 2) P.side(quad, SKY);
  }
}

export const fordGt3Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
