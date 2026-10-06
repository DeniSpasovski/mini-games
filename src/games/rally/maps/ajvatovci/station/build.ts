import { BoxGeometry, CylinderGeometry, Group, Matrix4 } from 'three';
import type { World } from '../../../world/world';
import { Bucket } from '../start-row/build/kit';
import {
  Local,
  onWall,
  rectOutline,
  type V3,
  type Wall,
} from '../hilltop/build/shapes';
import {
  CANOPY_COLS,
  CANOPY_Z,
  CROSSING_X,
  FORECOURT,
  HALF_D,
  HALF_L,
  HOUSE_X,
  houseEdge,
  ISLAND_X,
  islandEdges,
  islandTop,
  MAIN_RECT,
  MAIN_TRACK,
  STATION,
  STATION_TRACK,
  stationLevels,
  toWorld,
  trackZ,
  WING_E_RECT,
  WING_W_RECT,
} from './site';
import { RAIL_H } from '../../../world/railways';

/**
 * Geometry of Ilinden station (see index.ts / site.ts), in the station's local frame with y = 0 at the building
 * floor (= the house platform top). Rendered walls with real window / door openings (hilltop `Local.panel`),
 * hipped clay-tile roofs, a flat concrete canopy on columns over the house platform, the platforms (concrete
 * top, light coping, white safety line, track-side faces), a timber-panel crossing over the station track, a
 * shelter + name board on the island platform, benches, the clock and the name boards.
 */

const CREAM = '#f0d6a4';
const TRIM = '#f1eee6';
const PLINTH = '#8d8880';
const FRAME = '#3f3a35';
const CANOPY = '#d7d3ca';
const PLATFORM = '#c4c0b6';
const COPING = '#e3e0d8';
const FACE = '#aaa59b';
const WOOD = '#7a5236';
const IRON = '#2f3236';
const MAIN_TOP = 7.4;
const WING_TOP = 4.2;
const PITCH = 0.47; // 25 degrees
const OVER = 0.6;

/** Shelter on the island platform (local x range, centre line z). */
export const SHELTER = {
  x0: 4,
  x1: 14,
  z: (islandEdges(9)[0] + islandEdges(9)[1]) / 2,
};
/** Benches (local x, z; on the island or the house platform). */
export const BENCHES: { x: number; z: number; island: boolean }[] = [
  { x: -14.5, z: 5.1, island: false },
  { x: -11.5, z: 5.1, island: false },
  { x: 11.5, z: 5.1, island: false },
  { x: 14.5, z: 5.1, island: false },
  { x: 6.5, z: SHELTER.z - 0.6, island: true },
  { x: 11.5, z: SHELTER.z - 0.6, island: true },
];

interface Opening {
  s: number;
  y0: number;
  w: number;
  h: number;
  door?: boolean;
}

const win = (s: number, y0 = 0.9, w = 1.4, h = 2.0): Opening => ({
  s,
  y0,
  w,
  h,
});
const door = (s: number, w = 2.2, h = 2.9): Opening => ({
  s,
  y0: 0.02,
  w,
  h,
  door: true,
});

/** A rendered wall face from s0 to s1 (foot to `top`), with openings, plinth, cornice. */
function facade(
  l: Local,
  w: Wall,
  s0: number,
  s1: number,
  foot: number,
  top: number,
  ops: Opening[],
  band?: number,
): void {
  const rect = (o: Opening, g = 0) =>
    rectOutline(o.s - o.w / 2 - g, o.y0 - g, o.s + o.w / 2 + g, o.y0 + o.h + g);
  l.panel('render', w, rectOutline(s0, foot, s1, top), CREAM, {
    holes: ops.map((o) => rect(o)),
    depth: 0.3,
  });
  // Plinth: grey band up to 0.45 m, broken at the doors.
  const cuts = ops
    .filter((o) => o.door)
    .map((o) => [o.s - o.w / 2, o.s + o.w / 2] as const)
    .sort((a, b) => a[0] - b[0]);
  let s = s0;
  for (const [a, b] of [...cuts, [s1, s1] as const]) {
    if (a - s > 0.05)
      l.panel('paint', w, rectOutline(s, foot, a, 0.45), PLINTH, { off: 0.03 });
    s = Math.max(s, b);
  }
  // Cornice and (two storeys) the band between the floors.
  l.panel('paint', w, rectOutline(s0, top - 0.32, s1, top), TRIM, {
    off: 0.05,
  });
  if (band)
    l.panel('paint', w, rectOutline(s0, band, s1, band + 0.2), TRIM, {
      off: 0.04,
    });
  for (const o of ops) {
    // Recessed glazing (doors: glazed aluminium doors), white surround, sill.
    l.panel('glass', w, rect(o), '#ffffff', { off: -0.16 });
    l.panel('paint', w, rect(o, 0.12), TRIM, { holes: [rect(o)], off: 0.03 });
    if (o.door) {
      // Door frame + middle mullion.
      l.panel(
        'paint',
        w,
        rectOutline(o.s - 0.04, o.y0, o.s + 0.04, o.y0 + o.h),
        FRAME,
        {
          off: -0.14,
        },
      );
    } else {
      l.panel(
        'paint',
        w,
        rectOutline(o.s - o.w / 2 - 0.1, o.y0 - 0.1, o.s + o.w / 2 + 0.1, o.y0),
        TRIM,
        {
          off: 0.08,
        },
      );
      l.panel(
        'paint',
        w,
        rectOutline(o.s - 0.03, o.y0, o.s + 0.03, o.y0 + o.h),
        FRAME,
        {
          off: -0.14,
        },
      );
    }
  }
}

/** Hipped tile roof over a local rectangle, wall top `top`. */
function hipped(
  l: Local,
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  top: number,
): void {
  const X0 = x0 - OVER;
  const X1 = x1 + OVER;
  const Z0 = z0 - OVER;
  const Z1 = z1 + OVER;
  const H = top - OVER * PITCH + 0.05;
  const hd = (Z1 - Z0) / 2;
  const zc = (Z0 + Z1) / 2;
  const R = H + hd * PITCH;
  const r0 = Math.min(X0 + hd, (X0 + X1) / 2);
  const r1 = Math.max(X1 - hd, (X0 + X1) / 2);
  const o = { trim: [0], soffit: '#cfc6b4' };
  l.roof(
    [
      [X0, H, Z1],
      [X1, H, Z1],
      [r1, R, zc],
      [r0, R, zc],
    ],
    o,
  );
  l.roof(
    [
      [X1, H, Z0],
      [X0, H, Z0],
      [r0, R, zc],
      [r1, R, zc],
    ],
    o,
  );
  l.roof(
    [
      [X1, H, Z1],
      [X1, H, Z0],
      [r1, R, zc],
    ],
    o,
  );
  l.roof(
    [
      [X0, H, Z0],
      [X0, H, Z1],
      [r0, R, zc],
    ],
    o,
  );
}

/** A board on wall `w`: s range, y range, pushed out `off`; UVs 0..1 (the stationSign texture). */
function board(
  l: Local,
  w: Wall,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  off: number,
): void {
  const pts: V3[] = [
    onWall(w, s0, y0, off),
    onWall(w, s1, y0, off),
    onWall(w, s1, y1, off),
    onWall(w, s0, y1, off),
  ];
  const uv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as [number, number][];
  l.tri(
    'stationSign',
    pts[0],
    pts[1],
    pts[2],
    '#ffffff',
    [uv[0], uv[1], uv[2]],
    w.n,
  );
  l.tri(
    'stationSign',
    pts[0],
    pts[2],
    pts[3],
    '#ffffff',
    [uv[0], uv[2], uv[3]],
    w.n,
  );
  // Frame behind it.
  l.panel(
    'paint',
    w,
    rectOutline(s0 - 0.06, y0 - 0.06, s1 + 0.06, y1 + 0.06),
    IRON,
    {
      off: off - 0.03,
    },
  );
}

/** Slab of a platform between two edges along x: top `y(x)`, track-side faces down to the ground. */
function platform(
  l: Local,
  x0: number,
  x1: number,
  zA: (x: number) => number,
  zB: (x: number) => number,
  y: (x: number) => number,
  g: (x: number, z: number) => number,
  faceA: boolean,
  faceB: boolean,
): void {
  const n = Math.ceil((x1 - x0) / 2);
  const up: V3 = [0, 1, 0];
  const uvTop = (p: V3): [number, number] => [p[0], p[2]];
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n;
    const b = x0 + ((x1 - x0) * (i + 1)) / n;
    const ya = y(a);
    const yb = y(b);
    const za0 = zA(a);
    const zb0 = zA(b);
    const za1 = zB(a);
    const zb1 = zB(b);
    // Top: coping strips (0.45 m) at the track-side edges, concrete between, a white line 0.9 m in.
    const inA = faceA ? 0.45 : 0;
    const inB = faceB ? 0.45 : 0;
    l.fan(
      'concrete',
      [
        [a, ya, za0 + inA],
        [b, yb, zb0 + inA],
        [b, yb, zb1 - inB],
        [a, ya, za1 - inB],
      ],
      PLATFORM,
      up,
      uvTop,
    );
    if (faceA) {
      l.fan(
        'paint',
        [
          [a, ya + 0.01, za0],
          [b, yb + 0.01, zb0],
          [b, yb + 0.01, zb0 + inA],
          [a, ya + 0.01, za0 + inA],
        ],
        COPING,
        up,
        uvTop,
      );
      l.fan(
        'marking',
        [
          [a, ya + 0.012, za0 + 0.9],
          [b, yb + 0.012, zb0 + 0.9],
          [b, yb + 0.012, zb0 + 1.0],
          [a, ya + 0.012, za0 + 1.0],
        ],
        '#f4f4f0',
        up,
        uvTop,
      );
    }
    if (faceB) {
      l.fan(
        'paint',
        [
          [a, ya + 0.01, za1 - inB],
          [b, yb + 0.01, zb1 - inB],
          [b, yb + 0.01, zb1],
          [a, ya + 0.01, za1],
        ],
        COPING,
        up,
        uvTop,
      );
      l.fan(
        'marking',
        [
          [a, ya + 0.012, za1 - 1.0],
          [b, yb + 0.012, zb1 - 1.0],
          [b, yb + 0.012, zb1 - 0.9],
          [a, ya + 0.012, za1 - 0.9],
        ],
        '#f4f4f0',
        up,
        uvTop,
      );
    }
    // Side faces (the side towards a track gets a 5 cm overhang lip).
    const side = (z0: number, z1: number, out: number, lip: number) => {
      const p: V3[] = [
        [a, ya + 0.01, z0 + out * lip],
        [b, yb + 0.01, z1 + out * lip],
        [b, Math.min(yb, g(b, z1)) - 0.3, z1],
        [a, Math.min(ya, g(a, z0)) - 0.3, z0],
      ];
      l.fan('wall', p, FACE, [0, 0, out], (q) => [q[0], q[1]]);
    };
    side(za0, zb0, -1, faceA ? 0.05 : 0);
    side(za1, zb1, 1, faceB ? 0.05 : 0);
  }
  // End faces.
  for (const [x, out] of [
    [x0, -1],
    [x1, 1],
  ] as const) {
    const z0 = zA(x);
    const z1 = zB(x);
    const yt = y(x);
    const p: V3[] = [
      [x, yt + 0.01, z0],
      [x, yt + 0.01, z1],
      [x, Math.min(yt, g(x, z1)) - 0.3, z1],
      [x, Math.min(yt, g(x, z0)) - 0.3, z0],
    ];
    l.fan('wall', p, FACE, [out, 0, 0], (q) => [q[2], q[1]]);
  }
}

function bench(
  l: Local,
  x: number,
  z: number,
  y: number,
  facing: 1 | -1,
): void {
  for (const dx of [-0.75, 0.75])
    l.box(
      'metal',
      [x + dx - 0.04, y, z - 0.25],
      [x + dx + 0.04, y + 0.45, z + 0.25],
      IRON,
    );
  l.box(
    'paint',
    [x - 0.9, y + 0.42, z - 0.24],
    [x + 0.9, y + 0.48, z + 0.24],
    WOOD,
  );
  const bz = z - facing * 0.24;
  l.box(
    'paint',
    [x - 0.9, y + 0.55, bz - 0.03],
    [x + 0.9, y + 0.9, bz + 0.03],
    WOOD,
  );
}

export function* buildStation(world: World): Generator<void, Group> {
  const started = performance.now();
  const ground = world.analytic;
  const lv = stationLevels(ground);
  const bucket = new Bucket();
  const l = new Local(bucket, 'station', STATION, lv.floor);
  /** Ground under a local point, relative to the floor. */
  const g = (x: number, z: number) => {
    const [wx, wz] = toWorld(STATION, x, z);
    return ground.height(wx, wz) - lv.floor;
  };
  let low = 0;
  for (const [x, z] of [
    [-HALF_L, -HALF_D],
    [HALF_L, -HALF_D],
    [0, -HALF_D],
    [-HALF_L, 4.25],
    [HALF_L, 4.25],
  ])
    low = Math.min(low, g(x, z));
  const foot = Math.min(-1.2, low - 0.3);

  // --- the building ----------------------------------------------------------------
  const [mx0, mx1, mz0, mz1] = MAIN_RECT;
  const south = (z: number): Wall => ({ o: [0, 0, z], n: [0, 0, 1] });
  const north = (z: number): Wall => ({ o: [0, 0, z], n: [0, 0, -1] });
  const east = (x: number): Wall => ({ o: [x, 0, 0], n: [1, 0, 0] });
  const west = (x: number): Wall => ({ o: [x, 0, 0], n: [-1, 0, 0] });
  const upper = (s: number) => win(s, 5.05, 1.3, 1.5);
  // Centre block: the hall (doors to the forecourt and the platform), offices above.
  facade(
    l,
    south(mz1),
    mx0,
    mx1,
    foot,
    MAIN_TOP,
    [
      door(0),
      win(-3.6),
      win(3.6),
      win(-5.8, 0.9, 1.2),
      win(5.8, 0.9, 1.2),
      upper(-3.6),
      upper(3.6),
      upper(-5.8),
      upper(5.8),
    ],
    3.75,
  );
  facade(
    l,
    north(mz0),
    -mx1,
    -mx0,
    foot,
    MAIN_TOP,
    [
      door(0, 2.4, 3.0),
      win(-3.6),
      win(3.6),
      win(-5.8, 0.9, 1.2),
      win(5.8, 0.9, 1.2),
      upper(-1.8),
      upper(1.8),
      upper(-4.2),
      upper(4.2),
    ],
    3.75,
  );
  // End walls: above the wing roofs (no windows - the wings' hips run into them).
  facade(l, east(mx1), -mz1, -mz0, foot, MAIN_TOP, [], 3.75);
  facade(l, west(mx0), mz0, mz1, foot, MAIN_TOP, [], 3.75);
  // Wings: west = waiting room + ticket office, east = the station buffet.
  const [wx0, wx1, wz0, wz1] = WING_W_RECT;
  const [ex0, ex1, ez0, ez1] = WING_E_RECT;
  facade(l, south(wz1), wx0, wx1, foot, WING_TOP, [
    door(-9.6, 1.8, 2.6),
    win(-12.6, 0.9, 1.6, 1.9),
    win(-15.4, 0.9, 1.6, 1.9),
  ]);
  facade(l, south(ez1), ex0, ex1, foot, WING_TOP, [
    door(9.6, 1.8, 2.6),
    win(12.6, 0.9, 1.6, 1.9),
    win(15.4, 0.9, 1.6, 1.9),
  ]);
  facade(l, north(wz0), -wx1, -wx0, foot, WING_TOP, [
    win(9, 1.0, 1.4, 1.6),
    win(12.1, 1.0, 1.4, 1.6),
    win(15.2, 1.0, 1.4, 1.6),
  ]);
  facade(l, north(ez0), -ex1, -ex0, foot, WING_TOP, [
    win(-9, 1.0, 1.4, 1.6),
    win(-12.1, 1.0, 1.4, 1.6),
    win(-15.2, 1.0, 1.4, 1.6),
  ]);
  facade(l, west(wx0), wz0, wz1, foot, WING_TOP, [
    win(-3.2, 1.0, 1.4, 1.6),
    win(1.2, 1.0, 1.4, 1.6),
  ]);
  facade(l, east(ex1), -ez1, -ez0, foot, WING_TOP, [
    win(-1.2, 1.0, 1.4, 1.6),
    win(3.2, 1.0, 1.4, 1.6),
  ]);
  hipped(l, MAIN_RECT, MAIN_TOP);
  hipped(l, WING_W_RECT, WING_TOP);
  hipped(l, WING_E_RECT, WING_TOP);
  yield;

  // Name boards (platform side over the canopy, forecourt side over the door) and the clock.
  board(l, south(mz1), -2.9, 2.9, 3.98, 4.95, 0.08);
  board(l, north(mz0), -2.6, 2.6, 3.25, 3.65 + 0.48, 0.08);
  l.add(
    'paint',
    new CylinderGeometry(0.46, 0.46, 0.06, 28).rotateX(Math.PI / 2),
    IRON,
    new Matrix4().makeTranslation(0, 5.95, mz1 + 0.06),
  );
  l.add(
    'paint',
    new CylinderGeometry(0.4, 0.4, 0.04, 28).rotateX(Math.PI / 2),
    '#fbfaf5',
    new Matrix4().makeTranslation(0, 5.95, mz1 + 0.1),
  );
  // Hands at twenty past nine.
  for (const [len, ang] of [
    [0.3, Math.PI / 2 - (4 / 12) * Math.PI * 2],
    [0.2, Math.PI / 2 - (9.33 / 12) * Math.PI * 2],
  ])
    l.add(
      'paint',
      new BoxGeometry(len, 0.035, 0.015).translate(len / 2 - 0.04, 0, 0),
      '#151515',
      new Matrix4()
        .makeTranslation(0, 5.95, mz1 + 0.13)
        .multiply(new Matrix4().makeRotationZ(ang)),
    );

  // Canopy over the house platform: concrete slab with a fascia, columns on its outer edge.
  const cz1 = CANOPY_Z[1];
  l.box(
    'paint',
    [-HALF_L - 0.3, 3.35, mz1],
    [HALF_L + 0.3, 3.6, cz1 + 0.3],
    CANOPY,
  );
  l.box(
    'paint',
    [-HALF_L - 0.32, 3.3, cz1 + 0.2],
    [HALF_L + 0.32, 3.75, cz1 + 0.34],
    TRIM,
  );
  for (const cx of CANOPY_COLS)
    l.box(
      'paint',
      [cx - 0.15, -0.05, cz1 - 0.45],
      [cx + 0.15, 3.36, cz1 - 0.15],
      TRIM,
    );
  // Steps from the forecourt up to the hall door (the floor is the platform level).
  const rise = -g(0, mz0 - 1);
  const steps = Math.max(0, Math.ceil(rise / 0.17));
  for (let i = 0; i < steps; i++) {
    const top = -rise + ((i + 1) * rise) / steps;
    l.box(
      'concrete',
      [-2, top - 0.4, mz0 - (steps - i) * 0.32],
      [2, top, mz0 - (steps - i - 1) * 0.32],
      PLATFORM,
    );
  }
  for (const b of BENCHES.filter((b) => !b.island)) bench(l, b.x, b.z, 0, 1);
  yield;

  // --- platforms -------------------------------------------------------------------------------
  // House platform: from the building to the station track; ramps down to the ground beyond the canopy.
  const houseY = (x: number) => {
    const e = Math.min(x - HOUSE_X[0], HOUSE_X[1] - x);
    const t = Math.min(1, e / 4);
    return t * 0 + (1 - t) * Math.max(g(x, mz1 + 1), -1);
  };
  platform(
    l,
    HOUSE_X[0],
    HOUSE_X[1],
    () => mz1 - 0.3,
    houseEdge,
    houseY,
    g,
    false,
    true,
  );
  // Island platform between the station track and the main line, ramps at both ends.
  const railY = (x: number) => {
    const t = (track: [number, number][]) => g(x, trackZ(track, x)) + RAIL_H;
    return Math.max(t(STATION_TRACK), t(MAIN_TRACK));
  };
  platform(
    l,
    ISLAND_X[0],
    ISLAND_X[1],
    (x) => islandEdges(x)[0],
    (x) => islandEdges(x)[1],
    (x) => islandTop(lv, x, railY(x) + lv.floor) - lv.floor,
    g,
    true,
    true,
  );
  // Crossing over the station track: rubber / timber panels level with the rail tops.
  {
    const za = houseEdge(CROSSING_X);
    const zb = islandEdges(CROSSING_X)[0];
    const y = lv.crossing - lv.floor;
    l.box(
      'paint',
      [CROSSING_X - 1.2, y - 0.2, za],
      [CROSSING_X + 1.2, y + 0.005, zb],
      '#4a4440',
    );
  }
  // Shelter: two posts, a flat steel roof, a glazed back wall, benches; name boards at both ends.
  const yi = lv.island - lv.floor;
  const sz = SHELTER.z;
  for (const px of [SHELTER.x0 + 0.4, SHELTER.x1 - 0.4])
    l.box(
      'metal',
      [px - 0.08, yi, sz - 0.08],
      [px + 0.08, yi + 2.9, sz + 0.08],
      IRON,
    );
  l.box(
    'paint',
    [SHELTER.x0, yi + 2.9, sz - 1.6],
    [SHELTER.x1, yi + 3.05, sz + 1.6],
    '#5c6670',
  );
  l.box(
    'railGlass',
    [SHELTER.x0 + 0.5, yi + 0.3, sz + 0.25],
    [SHELTER.x1 - 0.5, yi + 2.4, sz + 0.29],
    '#dfe9ee',
  );
  for (const b of BENCHES.filter((b) => b.island)) bench(l, b.x, b.z, yi, -1);
  for (const bx of [-8, 28]) {
    const [za, zb] = islandEdges(bx);
    const zc = (za + zb) / 2;
    for (const dx of [-1.25, 1.25])
      l.box(
        'metal',
        [bx + dx - 0.05, yi, zc - 0.05],
        [bx + dx + 0.05, yi + 2.8, zc + 0.05],
        IRON,
      );
    for (const n of [1, -1] as const)
      board(
        l,
        { o: [bx, 0, zc], n: [0, 0, n] },
        -1.4,
        1.4,
        yi + 2.1,
        yi + 2.62,
        0.04,
      );
  }
  yield;

  // Forecourt: asphalt draped on the ground north of the building.
  const [fx0, fx1, fz0, fz1] = FORECOURT;
  for (let x = fx0; x < fx1; x += 2)
    for (let z = fz0; z < fz1; z += 2) {
      const pts: V3[] = [
        [x, 0, z],
        [x + 2, 0, z],
        [x + 2, 0, Math.min(z + 2, fz1)],
        [x, 0, Math.min(z + 2, fz1)],
      ].map(([px, , pz]) => [px, g(px, pz) + 0.04, pz] as V3);
      l.fan('asphalt', pts, '#b9b7b1', [0, 1, 0], (p) => [p[0], p[2]]);
    }

  const group = bucket.build('station');
  group.userData.stats = {
    triangles: bucket.triangles,
    meshes: group.children.length,
    ms: Math.round(performance.now() - started),
  };
  return group;
}
