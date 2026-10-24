import type { StaticCollider } from '../../../physics/types';
import {
  boxCollider,
  cylinderCollider,
  LOT_ASPHALT,
  type Local,
  type V3,
} from './common';
import { strut } from './park';
import { RESTAURANT, RESTAURANT_PAD, toWorld, type Site } from './sites';

/**
 * The restaurant beside the church of the Sredno Vodno monastery, ai-generated from the owner's photos (rough masses, flat
 * colours, no lettering). It stands on OSM's building 3974 (one grey box, 72 x 41 m, seven notches) and is three masses, read from
 * the plaza in front of it, east to west:
 *  - the east hall (R3): a tall glass-fronted hall under a corrugated-metal gable roof with a chimney, raised on a low concrete
 *    deck with a planter along its edge over a dark undercroft; in front a row of tall pinkish-brown concrete
 *    columns, wider at the top and leaning west as they rise, carry the roof's deep front overhang (the owner's close-up photo);
 *  - the lowered part (R2, R2E): one white storey with a flat roof, shop windows and a flat entrance porch;
 *  - the last building: the stem on the front (R2W), three white storeys from the plaza level (two over the lowered part), and
 *    the block behind it (R1), a floor lower: one over the lowered part, two from the plaza level (the ground falls away behind,
 *    so its walls run down), windows, balconies on its free west end, a low hip roof on each.
 * In front, a plain asphalt plaza closed by a barrier arm; cedars stand at its west and back.
 *
 * Local frame (the site's, `RESTAURANT`): +x along the facade (west to east), +z out to the front (the plaza), y up from the
 * ground under the site. The hill rises to the front: the hall and the plaza stand on the flat pad (`RESTAURANT_PAD`), the
 * other masses on the slope with their walls running down to the lowest ground.
 */
/** The three masses: x, z extents of their footprints (m), the corners of the map's footprint. */
export const R1 = { x0: -36, x1: 5.4, z0: -20.5, z1: -2.1 };
/** The last building's stem on the front: the west end of the front. */
export const R2W = { x0: -26.5, x1: -11.8, z0: -2.1, z1: 15.9 };
/** The lowered part between it and the hall (the hall's west wall is at `R3.x0`): its main body and its east wing. */
export const R2 = { x0: -11.8, x1: 5.4, z0: -2.1, z1: 15.9 };
export const R2E = { x0: 5.4, x1: 14.3, z0: -3.2, z1: 17.9 };
export const R3 = { x0: 14.3, x1: 36.1, z0: -3.2, z1: 17.9 };
/** The hall's deck (x range, front edge z), the plane of its tall columns, and the entrance porch of the lowered part. */
const DECK = { x0: 15.2, x1: 35, z1: 20.3 };
const PIER_Z = 20.75;
const PORCH = { x0: -11.8, x1: -5.2, z1: 19.8 };
/**
 * The parking in front (local extents): the whole ground between the facade and the line of the service road that used to cross the
 * slope here (OSM way, first point (532, -430)). The road is cut at its east edge `PLAZA.x1`, where the gate stands.
 */
export const PLAZA = { x0: -30, x1: 36.1, z0: 15.9, z1: 40.7 };
/** The old service road's centre line (local z at x) and its half width: the parking's south edge is the road's south edge. */
export const roadZ = (x: number): number => 38.87 + (x - 49.6) * 0.02144;
export const ROAD_HALF = 2;
export const plazaSouth = (x: number): number => roadZ(x) + ROAD_HALF;
/** The gate across the end of the road, just outside the parking. */
const GATE_X = 37.2;
/** The parking's north edge by strip (x0, x1, z): it runs right up to the facade, round the porch and the canopy's terrace. */
export const NORTH: [number, number, number][] = [
  [PLAZA.x0, R2W.x1, R2W.z1],
  [R2W.x1, PORCH.x1, PORCH.z1],
  [PORCH.x1, R2E.x0, R2.z1],
  [R2E.x0, DECK.x0 - 0.5, R2E.z1],
  [DECK.x0 - 0.5, DECK.x1 + 0.5, R3.z1],
  [DECK.x1 + 0.5, PLAZA.x1, R3.z1],
];

const WHITE = '#ecebe5';
const PYLON_COL = '#b4887a';
const DARK = '#3b3f44';
const GLASS = '#27313a';
const SLAB = '#cfc8bc';
const STOREY = 3.4;

/** The protected ground (scatter stays off it): the masses, the plaza, the cedars' strips. */
export const RESTAURANT_AREAS: {
  site: Site;
  rect: [number, number, number, number];
}[] = [
  { site: RESTAURANT, rect: [-38, 38, -22, 22] },
  { site: RESTAURANT, rect: [-31, 37, 15, 41.5] },
  { site: RESTAURANT, rect: [-52, -37, -6, 24] },
  { site: RESTAURANT, rect: [-26, 28, -30, -22] },
];

/** Cedars and spruces (local x, z, scale): tall and dark, west of the building and behind it. */
export const RESTAURANT_TREES: [string, number, number, number][] = [
  ['pine_tree', -42, 6, 1.7],
  ['black_pine', -46, 14, 1.6],
  ['pine_tree', -40, 21, 1.5],
  ['black_pine', -44, -3, 1.6],
  ['pine_tree', -34, 25, 1.4],
  ['pine_tree', -20, -25, 1.7],
  ['black_pine', -6, -26, 1.5],
  ['pine_tree', 8, -25, 1.6],
  ['black_pine', 20, -12, 1.4],
  ['pine_tree', 31, -10, 1.5],
];

/** Floor levels from a ground function over the site's frame: the hall and the plaza, the lowered part and the last building; `Ht` = the stem's eaves, `Hb` = the back block's. */
function levels(gl: (x: number, z: number) => number): {
  Lp: number;
  L2: number;
  Ht: number;
  Hb: number;
} {
  const L2 = gl(-12, 17) + 0.15;
  return {
    Lp: gl(RESTAURANT_PAD.x, RESTAURANT_PAD.z) + 0.15,
    L2,
    Ht: L2 + 3 * STOREY + 0.2,
    Hb: L2 + 2 * STOREY + 0.2,
  };
}

/** The feet of the five tall columns along the hall's front (local x). */
export const pylonXs = (): number[] => {
  const xs: number[] = [];
  for (let x = DECK.x0 + 1.8; x <= DECK.x1 - 0.7; x += 4.3) xs.push(x);
  return xs;
};

/** The solid parts as colliders: the three masses, the pylons, the porch posts. `g` = the levelled ground (world x, z). */
export function restaurantColliders(
  g: (x: number, z: number) => number,
): StaticCollider[] {
  const gl = (lx: number, lz: number): number => {
    const [wx, wz] = toWorld(RESTAURANT, lx, lz);
    return g(wx, wz);
  };
  const { Lp, L2, Ht, Hb } = levels(gl);
  const mass = (
    r: { x0: number; x1: number; z0: number; z1: number },
    top: number,
  ): StaticCollider => {
    const low =
      Math.min(
        gl(r.x0, r.z0),
        gl(r.x1, r.z0),
        gl(r.x0, r.z1),
        gl(r.x1, r.z1),
        gl((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2),
      ) - 1;
    return boxCollider(RESTAURANT, [r.x0, r.x1, r.z0, r.z1], low, top - low);
  };
  const out: StaticCollider[] = [
    mass(R1, Hb + 2.4),
    mass(R2W, Ht + 2.0),
    mass(R2, L2 + 4.6),
    mass(R2E, L2 + 4.6),
    mass(R3, Lp + 12.6),
  ];
  for (const x of pylonXs())
    out.push(cylinderCollider(RESTAURANT, x, PIER_Z, Lp - 0.5, 0.5, 4));
  // The deck and the undercroft under it are solid to a car.
  out.push(
    boxCollider(
      RESTAURANT,
      [DECK.x0 - 0.2, DECK.x1 + 0.2, R3.z1, DECK.z1],
      Lp - 0.5,
      3.6,
    ),
  );
  for (const x of [PORCH.x0 + 0.2, PORCH.x1 - 0.2])
    out.push(cylinderCollider(RESTAURANT, x, PORCH.z1 - 0.2, L2 - 0.5, 0.2, 4));
  // The gate: its two posts and the closed arm between them (1 m over the road).
  const gz = roadZ(GATE_X);
  for (const z of [gz - ROAD_HALF - 0.6, gz + ROAD_HALF + 0.6])
    out.push(
      cylinderCollider(RESTAURANT, GATE_X, z, gl(GATE_X, z) - 0.3, 0.16, 1.8),
    );
  out.push(
    boxCollider(
      RESTAURANT,
      [
        GATE_X - 0.08,
        GATE_X + 0.08,
        gz - ROAD_HALF - 0.4,
        gz + ROAD_HALF + 0.4,
      ],
      gl(GATE_X, gz) + 0.85,
      0.35,
    ),
  );
  return out;
}

/** Builds the masses, the pylons and canopy, the plaza and its barrier. `gy` = ground height at local (x, z), relative to the site's base. */
export function buildRestaurant(
  l: Local,
  gy: (x: number, z: number) => number,
): void {
  const up: V3 = [0, 1, 0];
  const { Lp, L2, Ht, Hb } = levels(gy);
  type Rect = { x0: number; x1: number; z0: number; z1: number };
  /** The lowest ground round a footprint, a little under it: where a mass's walls start. */
  const lowest = (r: Rect): number => {
    let m = Infinity;
    for (const x of [r.x0, (r.x0 + r.x1) / 2, r.x1])
      for (const z of [r.z0, (r.z0 + r.z1) / 2, r.z1])
        m = Math.min(m, gy(x, z));
    return m - 1.2;
  };
  /** A white block over a footprint, from the lowest ground to `top`. */
  const block = (r: Rect, top: number): void =>
    l.box('render', [r.x0, lowest(r), r.z0], [r.x1, top, r.z1], WHITE);
  /** One window in a z-face (`axis` 'z', plane z = c) or an x-face (plane x = c); `s` = outward side; `m` = centre along the face. */
  const pane = (
    axis: 'x' | 'z',
    c: number,
    s: 1 | -1,
    m: number,
    ya: number,
    yb: number,
    w: number,
  ): void => {
    const lo = s > 0 ? c : c - 0.05;
    const hi = s > 0 ? c + 0.05 : c;
    const sl = s > 0 ? c : c - 0.1;
    const sh = s > 0 ? c + 0.1 : c;
    if (axis === 'z') {
      l.box('glass', [m - w / 2, ya, lo], [m + w / 2, yb, hi], GLASS);
      l.box(
        'paint',
        [m - w / 2 - 0.1, ya - 0.1, sl],
        [m + w / 2 + 0.1, ya, sh],
        DARK,
      );
    } else {
      l.box('glass', [lo, ya, m - w / 2], [hi, yb, m + w / 2], GLASS);
      l.box(
        'paint',
        [sl, ya - 0.1, m - w / 2 - 0.1],
        [sh, ya, m + w / 2 + 0.1],
        DARK,
      );
    }
  };
  /** Rows of windows along a face between `a0` and `a1`, about every `pitch` m. */
  const windows = (
    axis: 'x' | 'z',
    c: number,
    s: 1 | -1,
    a0: number,
    a1: number,
    rows: [number, number][],
    pitch = 2.6,
    w = 1.3,
  ): void => {
    const n = Math.max(1, Math.floor((a1 - a0) / pitch));
    const step = (a1 - a0) / n;
    for (let i = 0; i < n; i++)
      for (const [ya, yb] of rows)
        pane(axis, c, s, a0 + step * (i + 0.5), ya, yb, w);
  };
  const sheet = (pts: V3[], want: V3, color: string): void => {
    const uv = (p: V3): [number, number] => [p[0] + p[2], p[1]];
    l.fan('sheet', pts, color, want, uv);
    l.slab(pts, want, uv, { soffit: '#6b6e6c', fascia: '#5d605e' });
  };

  // ---- The last building: R1 (the block behind, two storeys from the plaza level) and R2W (the stem on the front, three) ----
  const rows: [number, number][] = [-1, 0, 1, 2].map((k) => [
    L2 + k * STOREY + 0.9,
    L2 + k * STOREY + 2.3,
  ]);
  const H1 = Hb;
  block(R1, H1);
  windows('z', R1.z1, 1, R1.x0 + 1.2, R2W.x0 - 0.8, rows.slice(0, 3));
  windows('z', R1.z1, 1, R2W.x1 + 1.2, R1.x1 - 1.2, rows.slice(2, 3));
  windows('z', R1.z0, -1, R1.x0 + 1.2, R1.x1 - 1.2, rows.slice(0, 3), 3.2);
  windows('x', R1.x0, -1, R1.z0 + 1.5, R1.z1 - 1.5, rows.slice(0, 3), 3.4);
  windows('x', R1.x1, 1, R1.z0 + 1.5, R2E.z0 - 1, rows.slice(1, 3), 3.4);
  for (const yb of [L2 + 0.1, L2 + STOREY + 0.1]) {
    const xa = R1.x0 + 0.6;
    const xb = R2W.x0 - 0.5;
    l.box('paint', [xa, yb, R1.z1], [xb, yb + 0.22, R1.z1 + 1.5], SLAB);
    for (const y of [yb + 0.22, yb + 1.0])
      l.box(
        'metal',
        [xa, y, R1.z1 + 1.4],
        [xb, y + 0.06, R1.z1 + 1.5],
        '#9aa0a3',
      );
    for (let x = xa + 0.1; x <= xb; x += 1.1)
      l.box(
        'metal',
        [x - 0.03, yb + 0.22, R1.z1 + 1.43],
        [x + 0.03, yb + 1.0, R1.z1 + 1.47],
        '#9aa0a3',
      );
  }
  {
    // Hip roof: eaves 45 cm out, ridge 2.4 m over the eaves line.
    const o = 0.45;
    const zr = (R1.z0 + R1.z1) / 2;
    const rx = (R1.z1 - R1.z0) / 2 + o;
    const yr = H1 + 2.4;
    const [x0, x1, za, zb] = [R1.x0 - o, R1.x1 + o, R1.z0 - o, R1.z1 + o];
    const col = '#8d8f8c';
    sheet(
      [
        [x0, H1, zb],
        [x1, H1, zb],
        [x1 - rx, yr, zr],
        [x0 + rx, yr, zr],
      ],
      [0, 0.6, 1],
      col,
    );
    sheet(
      [
        [x1, H1, za],
        [x0, H1, za],
        [x0 + rx, yr, zr],
        [x1 - rx, yr, zr],
      ],
      [0, 0.6, -1],
      col,
    );
    sheet(
      [
        [x0, H1, za],
        [x0, H1, zb],
        [x0 + rx, yr, zr],
      ],
      [-1, 0.6, 0],
      col,
    );
    sheet(
      [
        [x1, H1, zb],
        [x1, H1, za],
        [x1 - rx, yr, zr],
      ],
      [1, 0.6, 0],
      col,
    );
  }

  /**
   * A one-storey block with a flat roof and a parapet on the sides named (n back, s front, w west). The walls stop 4 cm under the
   * roof surface: a box top and a roof over it at the same height would fight for the pixels.
   */
  const flatBlock = (r: Rect, top: number, sides: string): void => {
    l.box('render', [r.x0, lowest(r), r.z0], [r.x1, top - 0.04, r.z1], WHITE);
    if (sides.includes('s'))
      l.box(
        'render',
        [r.x0, top - 0.1, r.z1 - 0.15],
        [r.x1, top + 0.4, r.z1],
        WHITE,
      );
    if (sides.includes('n'))
      l.box(
        'render',
        [r.x0, top - 0.1, r.z0],
        [r.x1, top + 0.4, r.z0 + 0.15],
        WHITE,
      );
    if (sides.includes('w'))
      l.box(
        'render',
        [r.x0, top - 0.1, r.z0],
        [r.x0 + 0.15, top + 0.4, r.z1],
        WHITE,
      );
    l.fan(
      'roofing',
      [
        [r.x0, top, r.z0],
        [r.x1, top, r.z0],
        [r.x1, top, r.z1],
        [r.x0, top, r.z1],
      ],
      '#6e6c68',
      up,
      (p) => [p[0], p[2]],
    );
  };
  block(R2W, Ht);
  windows('z', R2W.z1, 1, R2W.x0 + 1, R2W.x1 - 1, rows.slice(1), 2.8, 1.5);
  windows('x', R2W.x0, -1, R2W.z0 + 2, R2W.z1 - 2, rows.slice(1), 3.4, 1.5);
  windows('x', R2W.x1, 1, R2W.z0 + 2, R2W.z1 - 2, rows.slice(2), 3.4, 1.5);
  {
    // The stem's hip roof, the same slope as R1's: a ridge along z, hipped at both ends.
    const o = 0.45;
    const [xl, xr] = [R2W.x0 - o, R2W.x1 + o];
    const [zb, zf] = [R2W.z0 - o, R2W.z1 + o];
    const xc = (xl + xr) / 2;
    const hw = (xr - xl) / 2;
    const yr = Ht + (2.4 / ((R1.z1 - R1.z0) / 2 + o)) * hw;
    const col = '#8d8f8c';
    sheet(
      [
        [xl, Ht, zf],
        [xl, Ht, zb],
        [xc, yr, zb + hw],
        [xc, yr, zf - hw],
      ],
      [-1, 0.6, 0],
      col,
    );
    sheet(
      [
        [xr, Ht, zb],
        [xr, Ht, zf],
        [xc, yr, zf - hw],
        [xc, yr, zb + hw],
      ],
      [1, 0.6, 0],
      col,
    );
    sheet(
      [
        [xl, Ht, zf],
        [xr, Ht, zf],
        [xc, yr, zf - hw],
      ],
      [0, 0.6, 1],
      col,
    );
    sheet(
      [
        [xr, Ht, zb],
        [xl, Ht, zb],
        [xc, yr, zb + hw],
      ],
      [0, 0.6, -1],
      col,
    );
  }

  // ---- R2, R2E: the lowered part - one storey, a flat roof with a parapet, shop windows, the entrance porch ----
  const H2 = L2 + 4.2;
  flatBlock(R2, H2, 's');
  flatBlock(R2E, H2, 'sn');
  const shop: [number, number][] = [[L2 + 0.9, L2 + 3.0]];
  windows('z', R2E.z1, 1, R2E.x0 + 0.8, R2E.x1 - 0.8, shop, 2.8, 1.8);
  windows('z', R2.z1, 1, PORCH.x1 + 1, R2.x1 - 0.8, shop, 2.8, 1.8);
  // The porch: a flat canopy on two posts over a glass door, a step.
  l.box(
    'paint',
    [PORCH.x0, L2 + 3.2, R2.z1],
    [PORCH.x1, L2 + 3.45, PORCH.z1],
    SLAB,
  );
  for (const x of [PORCH.x0 + 0.2, PORCH.x1 - 0.2])
    l.box(
      'metal',
      [x - 0.12, L2 - 0.1, PORCH.z1 - 0.35],
      [x + 0.12, L2 + 3.2, PORCH.z1 - 0.11],
      '#7d8286',
    );
  l.box(
    'glass',
    [PORCH.x0 + 1.4, L2, R2.z1],
    [PORCH.x1 - 1.4, L2 + 2.8, R2.z1 + 0.05],
    GLASS,
  );
  l.box(
    'paint',
    [PORCH.x0 + 1.3, L2 + 2.8, R2.z1],
    [PORCH.x1 - 1.3, L2 + 2.95, R2.z1 + 0.1],
    DARK,
  );
  l.box(
    'paint',
    [PORCH.x0, lowest(R2), R2.z1],
    [PORCH.x1, L2 + 0.02, PORCH.z1],
    '#a6a39b',
  );

  // ---- R3: the east hall - tall glass over a low deck, a corrugated gable roof with a deep front overhang on tall leaning columns ----
  const EAVE = Lp + 9.7;
  /** The deck = the hall's floor, over the dark undercroft. */
  const FLOOR = Lp + 2.0;
  const SLAB_COL = '#a89c90';
  /** The columns' tops: they lean out over the plaza (and west) as they rise to the canopy's front beam. */
  const ZT = PIER_Z + 2.4;
  block(R3, EAVE);
  l.box(
    'paint',
    [DECK.x0, Lp - 0.3, R3.z1],
    [DECK.x1, FLOOR - 0.6, R3.z1 + 0.05],
    '#2a2926',
  );
  // The glass wall over the deck: two rows of tall panes between full-height mullions, a transom between the rows.
  const bays = Math.round((DECK.x1 - DECK.x0 - 0.6) / 2.3);
  const bw = (DECK.x1 - DECK.x0 - 0.6) / bays;
  const gLow = FLOOR + 0.3;
  const gTop = EAVE - 1.05;
  const gMid = (gLow + gTop) / 2;
  for (let i = 0; i < bays; i++) {
    const a = DECK.x0 + 0.3 + i * bw;
    for (const [y0, y1] of [
      [gLow, gMid - 0.06],
      [gMid + 0.06, gTop],
    ])
      l.box(
        'glass',
        [a + 0.06, y0, R3.z1],
        [a + bw - 0.06, y1, R3.z1 + 0.05],
        GLASS,
      );
  }
  for (let i = 0; i <= bays; i++) {
    const a = DECK.x0 + 0.3 + i * bw;
    l.box(
      'paint',
      [a - 0.07, FLOOR, R3.z1],
      [a + 0.07, EAVE - 0.95, R3.z1 + 0.14],
      DARK,
    );
  }
  for (const [y0, y1] of [
    [FLOOR, gLow],
    [gMid - 0.06, gMid + 0.06],
    [gTop, EAVE - 0.95],
  ])
    l.box(
      'paint',
      [DECK.x0 + 0.2, y0, R3.z1],
      [DECK.x1 - 0.2, y1, R3.z1 + 0.14],
      DARK,
    );
  const tall: [number, number][] = [[Lp + 1.2, EAVE - 1.0]];
  windows('x', R3.x1, 1, R3.z0 + 2.5, R3.z1 - 2, tall, 2.4, 1.1);
  windows('z', R3.z0, -1, R3.x0 + 1.5, R3.x1 - 1.5, tall, 3.4, 1.4);
  {
    // Corrugated-metal gable roof: ridge along x, 45 cm overhang; the two gable ends white.
    const zr = (R3.z0 + R3.z1) / 2;
    const ridge = EAVE + 2.4;
    const o = 0.45;
    const ye = EAVE - o * ((ridge - EAVE) / ((R3.z1 - R3.z0) / 2));
    const col = '#9ca09d';
    sheet(
      [
        [R3.x0 - o, ye, R3.z1 + o],
        [R3.x1 + o, ye, R3.z1 + o],
        [R3.x1 + o, ridge, zr],
        [R3.x0 - o, ridge, zr],
      ],
      [0, 0.5, 1],
      col,
    );
    sheet(
      [
        [R3.x0 - o, ye, R3.z0 - o],
        [R3.x1 + o, ye, R3.z0 - o],
        [R3.x1 + o, ridge, zr],
        [R3.x0 - o, ridge, zr],
      ],
      [0, 0.5, -1],
      col,
    );
    for (const [x, sgn] of [
      [R3.x1 + o, 1],
      [R3.x0 - o, -1],
    ] as const)
      l.fan(
        'render',
        [
          [x, EAVE, R3.z0],
          [x, EAVE, R3.z1],
          [x, ridge, zr],
        ],
        WHITE,
        [sgn, 0, 0],
        (p) => [p[2], p[1]],
      );
    // The flat concrete canopy at the eaves, out over the plaza on the columns, a deep beam along its front edge.
    l.box(
      'paint',
      [R3.x0 - o, EAVE - 1.1, R3.z1],
      [R3.x1 + o, EAVE - 0.5, ZT + 0.45],
      SLAB,
    );
    l.box(
      'paint',
      [R3.x0 - o, EAVE - 1.7, ZT - 0.45],
      [R3.x1 + o, EAVE - 0.5, ZT + 0.45],
      '#bdb4a8',
    );
    // The chimney, on the back slope.
    l.box(
      'paint',
      [R3.x0 + 1.5, EAVE + 0.3, R3.z0 + 3],
      [R3.x0 + 2.4, ridge + 2.4, R3.z0 + 3.9],
      '#8a4b3c',
    );
    l.box(
      'paint',
      [R3.x0 + 1.38, ridge + 2.4, R3.z0 + 2.88],
      [R3.x0 + 2.52, ridge + 2.6, R3.z0 + 4.02],
      '#5e5e5c',
    );
  }
  // The deck: a slab with a deep fascia, a planter along its front edge with a lawn top.
  l.box(
    'paint',
    [DECK.x0 - 0.2, FLOOR - 0.65, R3.z1],
    [DECK.x1 + 0.2, FLOOR, DECK.z1],
    SLAB_COL,
  );
  l.box(
    'paint',
    [DECK.x0 - 0.2, FLOOR - 0.85, DECK.z1 - 0.3],
    [DECK.x1 + 0.2, FLOOR + 0.05, DECK.z1],
    '#b0a498',
  );
  l.box(
    'paint',
    [DECK.x0 - 0.1, FLOOR, DECK.z1 - 0.8],
    [DECK.x1 + 0.1, FLOOR + 0.45, DECK.z1 - 0.1],
    SLAB_COL,
  );
  l.fan(
    'lawn',
    [
      [DECK.x0, FLOOR + 0.47, DECK.z1 - 0.7],
      [DECK.x1, FLOOR + 0.47, DECK.z1 - 0.7],
      [DECK.x1, FLOOR + 0.47, DECK.z1 - 0.2],
      [DECK.x0, FLOOR + 0.47, DECK.z1 - 0.2],
    ],
    '#6a9a4a',
    up,
    (p) => [p[0], p[2]],
  );
  const feet = pylonXs();
  // The tall columns: wedges, narrow at the foot, wide at the top, leaning west and out over the plaza as they rise to the
  // canopy's front beam; a short brace joins each foot to the deck's edge.
  for (const xc of feet) {
    const xt = xc - 1.6;
    const yt = EAVE - 0.6;
    const f = (dx: number, dz: number): V3 => [xc + dx, Lp, PIER_Z + dz];
    const t = (dx: number, dz: number): V3 => [xt + dx, yt, ZT + dz];
    const faces: [V3[], V3][] = [
      [
        [f(-0.3, 0.25), f(0.3, 0.25), t(0.65, 0.45), t(-0.65, 0.45)],
        [0, 0, 1],
      ],
      [
        [f(0.3, -0.25), f(-0.3, -0.25), t(-0.65, -0.45), t(0.65, -0.45)],
        [0, 0, -1],
      ],
      [
        [f(-0.3, -0.25), f(-0.3, 0.25), t(-0.65, 0.45), t(-0.65, -0.45)],
        [-1, 0, 0],
      ],
      [
        [f(0.3, 0.25), f(0.3, -0.25), t(0.65, -0.45), t(0.65, 0.45)],
        [1, 0, 0],
      ],
    ];
    for (const [pts, want] of faces)
      l.fan('paint', pts, PYLON_COL, want, (p) => [p[0] + p[2], p[1]]);
    l.box(
      'paint',
      [xc - 0.5, Lp, PIER_Z - 0.4],
      [xc + 0.5, Lp + 0.2, PIER_Z + 0.4],
      '#a37c6f',
    );
    strut(
      l,
      [xc, Lp + 0.2, PIER_Z - 0.1],
      [xc, FLOOR - 0.5, DECK.z1 - 0.15],
      0.3,
      'paint',
      PYLON_COL,
    );
  }

  // ---- The parking: plain asphalt from the facade to the old road's south edge, a gate across the road's end ----
  /** The parking's level at a point: the highest ground round it, a few cm over. */
  const level = (x: number, z: number): number =>
    Math.max(
      gy(x, z),
      gy(x + 1.5, z),
      gy(x - 1.5, z),
      gy(x, z + 1.5),
      gy(x, z - 1.5),
    ) + 0.04;
  /** Asphalt in cells of about 2 m between the facade (`zn`) and the road's south edge, over [xa, xb]: each cell follows the ground at its corners. */
  const asphalt = (xa: number, xb: number, zn: number): void => {
    const nx = Math.max(1, Math.ceil((xb - xa) / 2));
    const nz = Math.max(1, Math.ceil((plazaSouth((xa + xb) / 2) - zn) / 2));
    const at = (x: number, j: number): V3 => {
      const z = zn + ((plazaSouth(x) - zn) * j) / nz;
      return [x, level(x, z), z];
    };
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x0 = xa + ((xb - xa) * i) / nx;
        const x1 = xa + ((xb - xa) * (i + 1)) / nx;
        l.fan(
          'asphalt',
          [at(x0, j), at(x1, j), at(x1, j + 1), at(x0, j + 1)],
          LOT_ASPHALT,
          up,
          (p) => [p[0], p[2]],
        );
      }
  };
  for (const [xa, xb, zn] of NORTH) asphalt(xa, xb, zn);
  // The gate: a post on each side of the road, the closed swing arm (red and white) across it, a yellow cap on each post.
  const gz = roadZ(GATE_X);
  const pz = [gz - ROAD_HALF - 0.6, gz + ROAD_HALF + 0.6];
  const gyr = gy(GATE_X, gz);
  for (const z of pz) {
    const y = gy(GATE_X, z);
    l.box(
      'metal',
      [GATE_X - 0.14, y - 0.3, z - 0.14],
      [GATE_X + 0.14, y + 1.5, z + 0.14],
      '#4a4d50',
    );
    l.box(
      'metal',
      [GATE_X - 0.2, y + 1.5, z - 0.2],
      [GATE_X + 0.2, y + 1.62, z + 0.2],
      '#d8cb3a',
    );
  }
  l.box(
    'barrier',
    [GATE_X - 0.07, gyr + 1.0, pz[0] + 0.14],
    [GATE_X + 0.07, gyr + 1.14, pz[1] - 0.14],
    '#ffffff',
  );
}
