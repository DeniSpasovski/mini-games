import { CylinderGeometry, Matrix4, SphereGeometry, Vector2 } from 'three';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { PadDef } from '../../shared/types';
import {
  boxCollider,
  cylinderCollider,
  FOOT,
  GLASS,
  rectOutline,
  turnedBoxCollider,
  type Local,
  type V2,
  type V3,
  type Wall,
} from './common';
import { toWorld, type Area, type Site } from './sites';

/**
 * The hotel on the empty lot at the first crossroad of the climb, where the side street leaves the road on the left: a
 * three-storey reinforced-concrete frame filled with terracotta brick (the left bays: a glazed box cantilevered over the
 * shop windows, a terrace on its roof, the entrance under a slab canopy; the right bays: grey render with pairs of
 * tall windows), a flat roof behind a brick parapet with a concrete coping. In front: a gravel forecourt with a paved
 * strip, a low concrete wall along the road with two sign boards behind it, a no-stopping sign, a street lamp, two yellow
 * waste bins, a dark saloon and a white van. Generic shapes only: no lettering, no logos.
 *
 * `HOTEL` is the FRONT-CENTRE of the forecourt, on the road: local x runs up the climb (along the road), +z towards
 * the road, y up from the forecourt; the forecourt, the road wall, the boards, the lamp, the bins and the cars are
 * placed in this frame. The building stands BEHIND it, across the side street (`BUILDING`, same heading): its local
 * facade is the plane z = 0 facing the road, the building at z in [-DEPTH, 0]. Every other piece has its own site (its
 * own ground height).
 */
export const HOTEL: Site = { x: 1777.4, z: -852.47, yaw: 1.0851 };

/** The building's front-centre: 1 m up the climb and 28.5 m behind the forecourt (HOTEL's frame), behind the side street. */
export const BUILDING: Site = (() => {
  const [x, z] = toWorld(HOTEL, 1, -28.5);
  return { x, z, yaw: HOTEL.yaw };
})();

const HX = 8;
const DEPTH = 10;
/** Tops of the floor slabs (ground floor, first floor, roof slab) and the parapet over the roof. */
const S1 = 3.3;
const S2 = 6.5;
const S3 = 9.7;
const PARAPET = 0.85;
/** Depth of the window reveals (the glass sits this far behind the wall face). */
const RECESS = 0.2;
const BAY = (2 * HX) / 6;
/** The cantilevered box over the shop windows: x range and how far it reaches out. */
const BOX_X: [number, number] = [-7.7, -2.95];
const BOX_Z = 1.4;

const CONC = '#c4bfb3';
const CONC_DARK = '#a39f94';
const SILL = '#cdcac2';
const RENDER = '#bfb9ad';
const FRAME = '#e6e4de';
const STEEL = '#7d8286';

type Face = 'front' | 'back' | 'left' | 'right';
type Rect = [number, number, number, number];

const WALLS: Record<Face, Wall> = {
  front: { o: [0, 0, 0], n: [0, 0, 1] },
  back: { o: [0, 0, -DEPTH], n: [0, 0, -1] },
  left: { o: [-HX, 0, 0], n: [-1, 0, 0] },
  right: { o: [HX, 0, 0], n: [1, 0, 0] },
};

/** A box standing on a wall face: s0..s1 along it (the wall's own run direction), y0..y1, d0..d1 out of the face. */
function faceBox(
  l: Local,
  face: Face,
  key: 'wall' | 'paint' | 'brick' | 'metal' | 'render',
  [s0, y0, s1, y1]: Rect,
  d0: number,
  d1: number,
  color: string,
): void {
  const [x0, x1, z0, z1] =
    face === 'front'
      ? [s0, s1, d0, d1]
      : face === 'back'
        ? [-s1, -s0, -DEPTH - d1, -DEPTH - d0]
        : face === 'left'
          ? [-HX - d1, -HX - d0, s0, s1]
          : [HX + d0, HX + d1, -s1, -s0];
  l.box(key, [x0, y0, z0], [x1, y1, z1], color);
}

/**
 * A window or door: the glass set back in the reveal, a white frame with a transom (a tilt sash above) and, when it is
 * wide, a mullion; a concrete sill under it unless it is a door. The hole itself is cut by `wallPanel`.
 */
function glazing(
  l: Local,
  face: Face,
  wall: Wall,
  [s0, y0, s1, y1]: Rect,
  door = false,
): void {
  const off = -RECESS + 0.02;
  const t = y0 + (y1 - y0) * (door ? 0.82 : 0.68);
  l.panel('paint', wall, rectOutline(s0, y0, s1, t), GLASS, { off });
  l.panel('paint', wall, rectOutline(s0, t, s1, y1), '#34414c', { off });
  const f = 0.06;
  l.panel('paint', wall, rectOutline(s0, y0, s1, y1), FRAME, {
    holes: [rectOutline(s0 + f, y0 + f, s1 - f, y1 - f)],
    off: off + 0.014,
  });
  l.panel('paint', wall, rectOutline(s0, t - 0.03, s1, t + 0.03), FRAME, {
    off: off + 0.018,
  });
  if (s1 - s0 > 1.1) {
    const m = (s0 + s1) / 2;
    l.panel('paint', wall, rectOutline(m - 0.03, y0, m + 0.03, y1), FRAME, {
      off: off + 0.022,
    });
  }
  if (!door) {
    // (A front window of the cantilevered box stands on its own plane.)
    const d = face === 'front' ? wall.o[2] : 0;
    faceBox(
      l,
      face,
      'paint',
      [s0 - 0.07, y0 - 0.08, s1 + 0.07, y0],
      d,
      d + 0.11,
      SILL,
    );
  }
}

/** A wall face with its openings cut out (reveals through the wall) and glazed. */
function wallPanel(
  l: Local,
  face: Face,
  key: 'brick' | 'render',
  color: string,
  [s0, y0, s1, y1]: Rect,
  holes: Rect[],
  doors: Rect[] = [],
  wall: Wall = WALLS[face],
): void {
  const all = [...holes, ...doors];
  l.panel(key, wall, rectOutline(s0, y0, s1, y1), color, {
    holes: all.map(([a, b, c, d]) => rectOutline(a, b, c, d)),
    depth: RECESS,
  });
  for (const h of holes) glazing(l, face, wall, h);
  for (const d of doors) glazing(l, face, wall, d, true);
}

/** Window rects centred on `cs` (widths `w`) between sills `y0..y1`. */
const row = (cs: number[], w: number, y0: number, y1: number): Rect[] =>
  cs.map((c): Rect => [c - w / 2, y0, c + w / 2, y1]);

const bayCentre = (i: number): number => -HX + BAY * (i + 0.5);

/** A steel railing (three rails, posts) on a run from a to b, `h` high above `y`. */
function rail(l: Local, a: V2, b: V2, y: number, h = 1.05): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.round(len / 1.2));
  const box = (p: V2, q: V2, y0: number, y1: number): void =>
    l.box(
      'metal',
      [Math.min(p[0], q[0]) - 0.022, y0, Math.min(p[1], q[1]) - 0.022],
      [Math.max(p[0], q[0]) + 0.022, y1, Math.max(p[1], q[1]) + 0.022],
      STEEL,
    );
  for (const k of [h, h * 0.67, h * 0.34]) box(a, b, y + k, y + k + 0.04);
  for (let i = 0; i <= n; i++) {
    const p: V2 = [
      a[0] + ((b[0] - a[0]) * i) / n,
      a[1] + ((b[1] - a[1]) * i) / n,
    ];
    box(p, p, y, y + h + 0.04);
  }
}

/** The building, in a frame at `HOTEL`. */
export function buildHotel(l: Local): void {
  const TOP = S3;
  const [BX0, BX1] = BOX_X;
  // --- the walls: brick on the left of the front, grey render on the right, brick all round the rest.
  const floors = (cs: number[], w: number, a: number, b: number): Rect[] => [
    ...row(cs, w, S1 + a, S1 + b),
    ...row(cs, w, S2 + a, S2 + b),
  ];
  const pair = (i: number): number[] => [
    bayCentre(i) - 0.62,
    bayCentre(i) + 0.62,
  ];
  // Front, brick part (x -8 .. 0): shop windows and the entrance under the box and the canopy, windows and a French door
  // onto the terrace above.
  wallPanel(
    l,
    'front',
    'brick',
    '#ffffff',
    [-HX, FOOT, 0, TOP],
    [
      [-7.75, 0.55, -5.6, 2.65],
      [-5.05, 0.55, -2.9, 2.65],
      [-2.18, S1 + 0.9, -0.48, S1 + 2.4],
      [-7.45, S2 + 0.9, -5.9, S2 + 2.4],
      [-2.18, S2 + 0.9, -0.48, S2 + 2.4],
    ],
    [
      [-1.95, 0.16, -0.75, 2.4],
      [-4.6, S2 + 0.12, -3.4, S2 + 2.4],
    ],
  );
  // Front, grey part (x 0 .. 8): a window per bay below, pairs of tall windows above.
  wallPanel(
    l,
    'front',
    'render',
    RENDER,
    [0, FOOT, HX, TOP],
    [
      ...row([bayCentre(3), bayCentre(4), bayCentre(5)], 1.8, 0.85, 2.3),
      ...floors([3, 4, 5].flatMap(pair), 0.86, 0.8, 2.35),
    ],
  );
  // The glazed box over the shop windows: brick cheeks, a big window in its front, a slab above and below.
  for (const x of [BX0, BX1 - 0.26])
    l.box('brick', [x, S1, 0], [x + 0.26, S2 - 0.34, BOX_Z], '#ffffff');
  wallPanel(
    l,
    'front',
    'brick',
    '#ffffff',
    [BX0, S1, BX1, S2 - 0.34],
    [[BX0 + 0.45, S1 + 0.8, BX1 - 0.45, S2 - 0.75]],
    [],
    { o: [0, 0, BOX_Z], n: [0, 0, 1] },
  );
  l.box(
    'wall',
    [BX0 - 0.14, S1 - 0.34, 0],
    [BX1 + 0.14, S1, BOX_Z + 0.14],
    CONC,
  );
  l.box(
    'wall',
    [BX0 - 0.14, S2 - 0.34, 0],
    [BX1 + 0.14, S2, BOX_Z + 0.14],
    CONC,
  );
  // Its roof is the terrace of the first-floor rooms: a steel railing round it.
  const rz = BOX_Z + 0.08;
  rail(l, [BX0 - 0.06, rz], [BX1 + 0.06, rz], S2);
  rail(l, [BX0 - 0.06, 0.1], [BX0 - 0.06, rz], S2, 0.95);
  rail(l, [BX1 + 0.06, 0.1], [BX1 + 0.06, rz], S2, 0.95);
  // Sides: three windows a floor (a door on the left), the back: one per bay.
  const run = [-8, -5, -2];
  wallPanel(
    l,
    'left',
    'brick',
    '#ffffff',
    [-DEPTH, FOOT, 0, TOP],
    [...row([-5, -8], 1.4, 0.85, 2.2), ...floors([-2, -5, -8], 1.3, 0.9, 2.3)],
    [[-2.6, 0.16, -1.4, 2.3]],
  );
  wallPanel(
    l,
    'right',
    'brick',
    '#ffffff',
    [0, FOOT, DEPTH, TOP],
    [
      ...row([2, 5, 8], 1.4, 0.85, 2.2),
      ...floors(
        run.map((z) => -z),
        1.3,
        0.9,
        2.3,
      ),
    ],
  );
  const back = [0, 1, 2, 3, 4, 5].map((i) => -bayCentre(i));
  wallPanel(
    l,
    'back',
    'brick',
    '#ffffff',
    [-HX, FOOT, HX, TOP],
    [
      ...row(
        back.filter((s) => s !== -bayCentre(3)),
        1.6,
        0.85,
        2.2,
      ),
      ...floors(back, 1.6, 0.9, 2.3),
    ],
    [[-bayCentre(3) - 0.6, 0.16, -bayCentre(3) + 0.6, 2.3]],
  );
  // --- the concrete frame: corner columns, columns between the front bays, a plinth, the slab edges.
  for (const [cx, cz] of [
    [-HX, 0],
    [HX, 0],
    [-HX, -DEPTH],
    [HX, -DEPTH],
  ])
    l.box(
      'wall',
      [cx - 0.24, FOOT, cz - 0.24],
      [cx + 0.24, TOP, cz + 0.24],
      CONC_DARK,
    );
  for (let i = 1; i < 6; i++) {
    const x = -HX + BAY * i;
    l.box('wall', [x - 0.19, 0, -0.04], [x + 0.19, TOP, 0.1], CONC_DARK);
  }
  const ring = (y0: number, y1: number, d: number, color: string): void => {
    l.box('wall', [-HX - d, y0, 0], [HX + d, y1, d], color);
    l.box('wall', [-HX - d, y0, -DEPTH - d], [HX + d, y1, -DEPTH], color);
    l.box('wall', [-HX - d, y0, -DEPTH], [-HX, y1, 0], color);
    l.box('wall', [HX, y0, -DEPTH], [HX + d, y1, 0], color);
  };
  ring(FOOT, 0.42, 0.07, CONC_DARK);
  for (const s of [S1, S2]) ring(s - 0.3, s + 0.02, 0.1, CONC);
  // --- the entrance: a landing and a step, the slab canopy over the door.
  l.box('wall', [-2.35, FOOT, 0], [-0.35, 0.16, 1.05], CONC);
  l.box('wall', [-2.35, FOOT, 1.05], [-0.35, 0.07, 1.5], CONC);
  l.box('wall', [-2.55, 2.74, 0], [-0.15, 2.96, 1.9], CONC);
  l.box('paint', [-2.55, 2.74, 1.86], [-0.15, 2.96, 1.9], STEEL);
  // --- the roof: slab with an overhang, a brick parapet with a coping, the membrane, a stair box.
  const OV = 0.28;
  l.box('wall', [-HX - OV, TOP - 0.34, -DEPTH - OV], [HX + OV, TOP, 0.5], CONC);
  const P = 0.24;
  const pa = (x0: number, x1: number, z0: number, z1: number): void => {
    l.box('brick', [x0, TOP, z0], [x1, TOP + PARAPET, z1], '#ffffff');
    l.box(
      'wall',
      [x0 - 0.04, TOP + PARAPET, z0 - 0.04],
      [x1 + 0.04, TOP + PARAPET + 0.07, z1 + 0.04],
      CONC,
    );
  };
  pa(-HX - OV, HX + OV, 0.5 - P, 0.5);
  pa(-HX - OV, HX + OV, -DEPTH - OV, -DEPTH - OV + P);
  pa(-HX - OV, -HX - OV + P, -DEPTH - OV + P, 0.5 - P);
  pa(HX + OV - P, HX + OV, -DEPTH - OV + P, 0.5 - P);
  l.fan(
    'roofing',
    [
      [-HX - OV + P, TOP + 0.02, -DEPTH - OV + P],
      [HX + OV - P, TOP + 0.02, -DEPTH - OV + P],
      [HX + OV - P, TOP + 0.02, 0.5 - P],
      [-HX - OV + P, TOP + 0.02, 0.5 - P],
    ],
    '#8d8f90',
    [0, 1, 0],
    (p) => [p[0], p[2]],
  );
  l.box('render', [3.2, TOP, -7.6], [6.6, TOP + 2.7, -4.2], '#aeaba5');
  l.box('wall', [3.1, TOP + 2.7, -7.7], [6.7, TOP + 2.88, -4.1], CONC);
  l.panel(
    'paint',
    { o: [0, 0, -4.2], n: [0, 0, 1] },
    rectOutline(4.4, TOP, 5.4, TOP + 2.0),
    '#5d6266',
    { off: 0.02 },
  );
}

/** The forecourt's terrace (HOTEL's frame): a flat pad, the land's height at the road plus a little. */
const PAD_POLYGON: V2[] = [
  [-19.5, 7.6],
  [10.5, 7.6],
  [10.5, -1],
  [-17.4, -1],
  [-19.5, 2],
];
export const HOTEL_PAD: PadDef = {
  name: 'hotel',
  polygon: PAD_POLYGON.flatMap(([x, z]) => toWorld(HOTEL, x, z)),
  blend: 3.5,
  level: { at: toWorld(HOTEL, 0, 3.5), lift: 0.35 },
};

/** The building's terrace (BUILDING's frame): level with the street at its front, filled a little behind. */
export const BUILDING_PAD: PadDef = {
  name: 'hotel-building',
  polygon: (
    [
      [-9.5, 3],
      [9.5, 3],
      [9.5, -11.5],
      [-9.5, -11.5],
    ] as V2[]
  ).flatMap(([x, z]) => toWorld(BUILDING, x, z)),
  blend: 3,
  level: { at: toWorld(BUILDING, 0, -2), lift: 0.1 },
};

/** Where scatter stays off: the building and its frontage, the forecourt, the parking strip on its left, the wall along the road. */
export const HOTEL_AREAS: Area[] = [
  { site: BUILDING, rect: [-10.5, 10.5, -12, 3.2] },
  { site: HOTEL, rect: [-11, 11.5, -1, 8.8] },
  { site: HOTEL, rect: [-20.5, -10, 0.2, 8.8] },
  { site: HOTEL, rect: [-10, 21.5, 6.6, 9.6] },
];

const inPad = (x: number, z: number, shrink: number): boolean => {
  for (let i = 0; i < PAD_POLYGON.length; i++) {
    const [ax, az] = PAD_POLYGON[i];
    const [bx, bz] = PAD_POLYGON[(i + 1) % PAD_POLYGON.length];
    const len = Math.hypot(bx - ax, bz - az);
    // The polygon runs clockwise in (x, z): the inside is on the right of every edge.
    const side = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / len;
    if (side < shrink) return false;
  }
  return true;
};

/** A ground decal over the cells of a grid that lie inside the pad (draped on the terrain by `gy`). */
function patch(
  l: Local,
  key: 'gravel' | 'pavers' | 'concrete',
  color: string,
  [x0, z0, x1, z1]: [number, number, number, number],
  gy: (x: number, z: number) => number,
  cell: number,
  dy: number,
  inside: (x: number, z: number) => boolean,
): void {
  for (let x = x0; x < x1 - 1e-6; x += cell)
    for (let z = z0; z < z1 - 1e-6; z += cell) {
      const xe = Math.min(x + cell, x1);
      const ze = Math.min(z + cell, z1);
      if (!(inside(x, z) && inside(xe, z) && inside(xe, ze) && inside(x, ze)))
        continue;
      l.fan(
        key,
        (
          [
            [x, z],
            [xe, z],
            [xe, ze],
            [x, ze],
          ] as V2[]
        ).map(([px, pz]): V3 => [px, gy(px, pz) + dy, pz]),
        color,
        [0, 1, 0],
        (p) => [p[0], p[2]],
      );
    }
}

/** The road wall's line in the hotel's frame (x, z): 2 m off the road edge, following it. */
const WALL_LINE: V2[] = [
  [-9.4, 8],
  [0, 8.19],
  [8, 8.34],
  [16, 8.44],
  [20, 8.5],
];
/** Longest section of the wall line (m). */
const SECTION = 2.5;

interface WallSection {
  a: V2;
  b: V2;
}

/** The wall line cut into sections. */
function wallSections(): WallSection[] {
  const out: WallSection[] = [];
  for (let i = 0; i + 1 < WALL_LINE.length; i++) {
    const [ax, az] = WALL_LINE[i];
    const [bx, bz] = WALL_LINE[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SECTION));
    for (let j = 0; j < k; j++)
      out.push({
        a: [ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k],
        b: [ax + ((bx - ax) * (j + 1)) / k, az + ((bz - az) * (j + 1)) / k],
      });
  }
  return out;
}

/** The wall's top stands this far over the terrain at the road's edge beside it (the terrain follows the road there). */
const WALL_UP = 0.55;
/** Top of the wall at (x, z). */
const wallTop = (
  g: (x: number, z: number) => number,
  x: number,
  z: number,
): number => {
  const [wx, wz] = toWorld(HOTEL, x, z + 2.1);
  return g(wx, wz) + WALL_UP;
};

/** The low concrete wall along the road: a swept section with a coping, end piers, at the road's height. */
function buildRoadWall(
  l: Local,
  world: (x: number, z: number) => number,
): void {
  const line = [
    ...wallSections().map((s) => s.a),
    WALL_LINE[WALL_LINE.length - 1],
  ].map(([x, z]) => {
    const [wx, wz] = toWorld(HOTEL, x, z);
    return new Vector2(wx - HOTEL.x, wz - HOTEL.z);
  });
  // `lift` gets the frame's offsets: back to world metres for the terrain height at the road's side of the wall.
  const dir = [-Math.sin(HOTEL.yaw), Math.cos(HOTEL.yaw)];
  const lift = (x: number, z: number): number =>
    world(HOTEL.x + x + dir[0] * 2.1, HOTEL.z + z + dir[1] * 2.1) + WALL_UP;
  l.frame.sweep(
    'wall',
    line,
    [
      [0.17, -2.6],
      [0.17, 0],
      [-0.17, 0],
      [-0.17, -2.6],
    ],
    '#bcb9b1',
    { lift },
  );
  l.frame.sweep(
    'wall',
    line,
    [
      [0.23, -0.02],
      [0.23, 0.1],
      [-0.23, 0.1],
      [-0.23, -0.02],
    ],
    '#d9d6ce',
    { lift },
  );
  const base = world(HOTEL.x, HOTEL.z);
  for (const [x, z] of [WALL_LINE[0], WALL_LINE[WALL_LINE.length - 1]]) {
    const top = wallTop(world, x, z) - base;
    l.box(
      'wall',
      [x - 0.27, top - 2.6, z - 0.27],
      [x + 0.27, top + 0.22, z + 0.27],
      '#c4c1b9',
    );
    l.box(
      'wall',
      [x - 0.33, top + 0.22, z - 0.33],
      [x + 0.33, top + 0.31, z + 0.33],
      '#d9d6ce',
    );
  }
}

/** Colliders of the wall: one box per section, from under the road side's ground to its top. */
function wallColliders(g: TerrainSampler): StaticCollider[] {
  const world = (x: number, z: number): number => g.height(x, z);
  return wallSections().map(({ a, b }) => {
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const top = wallTop(world, mx, mz);
    const [wx, wz] = toWorld(HOTEL, mx, mz);
    const bottom = Math.min(world(wx, wz), top - 1.5) - 0.4;
    return turnedBoxCollider(
      HOTEL,
      mx,
      mz,
      Math.atan2(b[1] - a[1], b[0] - a[0]),
      Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 0.05,
      0.25,
      bottom,
      top - bottom + 0.2,
    );
  });
}

/** A site `x` along the road and `z` towards it from the hotel's front-centre, turned `turn` rad from the road's direction. */
const piece = (x: number, z: number, turn = 0): Site => {
  const [wx, wz] = toWorld(HOTEL, x, z);
  return { x: wx, z: wz, yaw: HOTEL.yaw + turn };
};

/**
 * The sign boards behind the wall face the traffic coming up the road, turned a little towards it: a site whose local
 * +z is the face's normal (the face is its z = 0 plane, `s` runs to the viewer's right).
 */
const FACING = Math.PI / 2 - 0.44;
export const SIGN_WHITE = piece(10.8, 6.3, FACING);
export const SIGN_BLACK = piece(15.4, 6.4, FACING);
export const SIGN_STOP = piece(7, 6.6, FACING);
export const LAMP = piece(-10.4, 5.6);
export const BIN_A = piece(-17.2, 5.8, 0.1);
export const BIN_B = piece(-15.8, 6.1, -0.05);

const FACE: Wall = { o: [0, 0, 0], n: [0, 0, 1] };
const POST = '#5c6064';

/** A board on two posts: a grey plate, `w` x `h` m, its lower edge `y` above the ground; the face is painted by the caller. */
function board(
  l: Local,
  w: number,
  y: number,
  h: number,
  face: string,
  edge: string,
): void {
  for (const s of [-w / 2 + 0.3, w / 2 - 0.3])
    l.box(
      'paint',
      [s - 0.045, FOOT, -0.24],
      [s + 0.045, y + h - 0.2, -0.15],
      POST,
    );
  l.box('paint', [-w / 2, y, -0.15], [w / 2, y + h, -0.01], '#858a8e');
  l.panel('paint', FACE, rectOutline(-w / 2, y, w / 2, y + h), edge, {
    off: 0,
  });
  l.panel(
    'paint',
    FACE,
    rectOutline(-w / 2 + 0.05, y + 0.05, w / 2 - 0.05, y + h - 0.05),
    face,
    { off: 0.008 },
  );
}

/** A flat triangle on the board face. */
const tri = (l: Local, a: V2, b: V2, c: V2, color: string, off: number): void =>
  l.panel('paint', FACE, [a, b, c], color, { off });

/** Black board: a gold triangle glyph, two lines of text as plain bars, three arrows pointing left (towards the hotel). */
export function buildBlackBoard(l: Local): void {
  const w = 3.1;
  const y = 1.75;
  const h = 1.95;
  const GOLD = '#c0a15f';
  board(l, w, y, h, '#17181a', '#a8935b');
  const cx = -0.55;
  const top = y + h - 0.32;
  tri(
    l,
    [cx - 0.3, top - 0.55],
    [cx + 0.3, top - 0.55],
    [cx, top],
    GOLD,
    0.014,
  );
  tri(
    l,
    [cx - 0.17, top - 0.5],
    [cx + 0.17, top - 0.5],
    [cx, top - 0.2],
    '#17181a',
    0.02,
  );
  l.panel(
    'paint',
    FACE,
    rectOutline(cx - 0.85, y + 0.75, cx + 0.85, y + 0.8),
    '#8d8667',
    { off: 0.014 },
  );
  l.panel(
    'paint',
    FACE,
    rectOutline(cx - 0.5, y + 0.62, cx + 0.5, y + 0.66),
    '#6f6a55',
    { off: 0.014 },
  );
  for (let i = 0; i < 3; i++) {
    const x = -0.15 + i * 0.4;
    tri(
      l,
      [x - 0.22, y + 0.34],
      [x + 0.1, y + 0.5],
      [x + 0.1, y + 0.18],
      GOLD,
      0.014,
    );
    l.panel(
      'paint',
      FACE,
      rectOutline(x + 0.06, y + 0.31, x + 0.3, y + 0.37),
      GOLD,
      { off: 0.014 },
    );
  }
}

/** White information board: a blue band, then rows of a coloured square and grey text bars. */
export function buildWhiteBoard(l: Local): void {
  const w = 2.7;
  const y = 1.75;
  const h = 2.8;
  board(l, w, y, h, '#f4f3ef', '#9aa0a4');
  const x0 = -w / 2 + 0.2;
  const x1 = w / 2 - 0.2;
  l.panel(
    'paint',
    FACE,
    rectOutline(x0, y + h - 0.5, x1, y + h - 0.2),
    '#2f63a8',
    { off: 0.014 },
  );
  const colours = [
    '#c23a35',
    '#2f63a8',
    '#d9a62c',
    '#3b8a57',
    '#6a4c93',
    '#c23a35',
  ];
  for (let i = 0; i < colours.length; i++) {
    const top = y + h - 0.72 - i * 0.37;
    l.panel(
      'paint',
      FACE,
      rectOutline(x0, top - 0.26, x0 + 0.3, top),
      colours[i],
      { off: 0.014 },
    );
    l.panel(
      'paint',
      FACE,
      rectOutline(x0 + 0.42, top - 0.1, x1 - 0.1 - (i % 3) * 0.28, top),
      '#5d6266',
      { off: 0.014 },
    );
    l.panel(
      'paint',
      FACE,
      rectOutline(x0 + 0.42, top - 0.25, x1 - 0.55 - (i % 2) * 0.3, top - 0.16),
      '#9ea3a6',
      { off: 0.014 },
    );
  }
}

/** Round no-stopping sign on a pole: a blue disc, a red ring and a red cross, its face turned like the boards. */
export function buildStopSign(l: Local): void {
  const y = 2.05;
  l.box('paint', [-0.035, FOOT, -0.07], [0.035, y + 0.3, 0], POST);
  const R = 0.32;
  const disc = (r: number, off: number, color: string): void => {
    const pts: V2[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push([Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    l.panel('paint', FACE, pts, color, { off });
  };
  disc(R, 0.01, '#c4232b');
  disc(R - 0.045, 0.015, '#2358a4');
  for (const sgn of [1, -1]) {
    const a = sgn * (Math.PI / 4);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const half = R - 0.08;
    const t = 0.035;
    const p = (u: number, v: number): V2 => [u * c - v * s, y + u * s + v * c];
    l.panel(
      'paint',
      FACE,
      [p(-half, -t), p(half, -t), p(half, t), p(-half, t)],
      '#c4232b',
      { off: 0.02 },
    );
  }
}

/** Street lamp: a steel pole on a plinth, a white globe. */
export function buildLamp(l: Local): void {
  l.add(
    'paint',
    new CylinderGeometry(0.15, 0.17, 0.5, 10),
    '#6b6f73',
    new Matrix4().makeTranslation(0, 0.1, 0),
  );
  l.add(
    'paint',
    new CylinderGeometry(0.045, 0.06, 3.8, 8),
    '#8b9094',
    new Matrix4().makeTranslation(0, 2.2, 0),
  );
  l.add(
    'paint',
    new CylinderGeometry(0.1, 0.07, 0.12, 8),
    '#6b6f73',
    new Matrix4().makeTranslation(0, 4.15, 0),
  );
  l.add(
    'paint',
    new SphereGeometry(0.29, 14, 10),
    '#f6f6f2',
    new Matrix4().makeTranslation(0, 4.45, 0),
  );
}

/** A yellow wheeled waste bin: body, a darker lid, a rim and four wheels. */
export function buildBin(l: Local): void {
  l.box('paint', [-0.62, 0.12, -0.5], [0.62, 1.05, 0.5], '#e8bd28');
  l.box('paint', [-0.66, 1.05, -0.54], [0.66, 1.13, 0.54], '#d1a61f');
  l.box('paint', [-0.4, 1.13, -0.3], [0.4, 1.18, 0.3], '#b88f1a');
  l.box('paint', [-0.6, 0.62, 0.5], [0.6, 0.7, 0.53], '#d1a61f');
  for (const sx of [-0.5, 0.5])
    for (const sz of [-0.38, 0.38])
      l.box(
        'paint',
        [sx - 0.07, 0, sz - 0.07],
        [sx + 0.07, 0.12, sz + 0.07],
        '#2b2d30',
      );
}

/** The cars parked on the forecourt (variants 16 and 17 of `street_car`: a dark saloon, a white van), local x, z, heading. */
export const HOTEL_CARS: {
  variant: number;
  x: number;
  z: number;
  turn: number;
}[] = [
  { variant: 16, x: -14.6, z: 3.6, turn: Math.PI },
  { variant: 17, x: -8.6, z: 3.6, turn: Math.PI - 0.05 },
];

/** Everything of the hotel, as the landmark's `build`. */
export function buildHotelSite(
  at: (site: Site, tile: string) => Local,
  ground: (x: number, z: number) => number,
): void {
  const building = at(BUILDING, 'hotel');
  buildHotel(building);
  const draped =
    (site: Site) =>
    (x: number, z: number): number => {
      const [wx, wz] = toWorld(site, x, z);
      return ground(wx, wz) - ground(site.x, site.z);
    };
  // A paved strip along the facade; the forecourt by the road gets gravel over its terrace.
  patch(
    building,
    'pavers',
    '#bdb8ad',
    [-9.3, 0, 9.3, 2.2],
    draped(BUILDING),
    1.1,
    0.045,
    () => true,
  );
  const l = at(HOTEL, 'hotel');
  patch(
    l,
    'gravel',
    '#c9c2b4',
    [-19.5, -1, 10.5, 7.6],
    draped(HOTEL),
    1.5,
    0.03,
    (x, z) => inPad(x, z, 0.5),
  );
  buildRoadWall(l, ground);
  buildBlackBoard(at(SIGN_BLACK, 'hotel'));
  buildWhiteBoard(at(SIGN_WHITE, 'hotel'));
  buildStopSign(at(SIGN_STOP, 'hotel'));
  buildLamp(at(LAMP, 'hotel'));
  buildBin(at(BIN_A, 'hotel'));
  buildBin(at(BIN_B, 'hotel'));
}

/** Colliders: the building, the wall, the posts of the boards and the sign, the lamp, the bins. */
export function hotelColliders(g: TerrainSampler): StaticCollider[] {
  const low = (s: Site): number => g.height(s.x, s.z) - 0.8;
  const post = (s: Site, hx: number): StaticCollider =>
    boxCollider(s, [-hx, hx, -0.28, 0], low(s), 2);
  return [
    boxCollider(
      BUILDING,
      [-HX - 0.3, HX + 0.3, -DEPTH - 0.3, 0.12],
      low(BUILDING),
      S3 + PARAPET + 1,
    ),
    ...wallColliders(g),
    post(SIGN_WHITE, 1.2),
    post(SIGN_BLACK, 1.35),
    cylinderCollider(SIGN_STOP, 0, -0.03, low(SIGN_STOP), 0.1, 3),
    cylinderCollider(LAMP, 0, 0, low(LAMP), 0.18, 4.8),
    boxCollider(BIN_A, [-0.62, 0.62, -0.5, 0.5], low(BIN_A), 2),
    boxCollider(BIN_B, [-0.62, 0.62, -0.5, 0.5], low(BIN_B), 2),
  ];
}
