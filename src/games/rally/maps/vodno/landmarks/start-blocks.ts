import {
  GLASS,
  rectOutline,
  type Local,
  type V2,
  type V3,
  type Wall,
} from './common';
import type { PadDef } from '../../shared/types';
import { toWorld, type Site } from './sites';

/**
 * Two blocks of flats on the street just before the stage start (the Vodno neighbourhood), standing where the baked
 * boxes 7 and 6 are, front to the road: the "balcony block" (stacked balconies, peach and cream render) and the
 * "curved block" beside it (beige cladding on the end bays, three floors of balconies under a segmental arch). The wall
 * in front of both is `start-wall.ts`. A site is the FRONT-CENTRE of a block's footprint: local x along the facade, +z out
 * towards the street (the facade is the plane z = 0), the block stands at z in [-DEPTH, 0], y up from the ground at
 * the front.
 */
const STEEL = '#8a8f93';
const BROWN = '#5e3a22';
const CREAM = '#efdcaa';
const BEIGE = '#e0c28f';
const WHITE = '#f0e6d0';
const SHUTTER = '#8f9396';
const WOOD_SHUTTER = '#6b4326';
/** Walls reach this far down: the ground falls away at one end of the facade. */
const DEEP = -3.4;

export const FRONT: Wall = { o: [0, 0, 0], n: [0, 0, 1] };

/** A block's footprint in its site frame: x along the facade, z in [-depth, 0]. */
export interface BlockSize {
  width: number;
  depth: number;
  height: number;
}

/** Balcony block (OSM-like box 7: 17.0 x 15.8 m) and curved block (box 6: 16.4 x 15.9 m). */
export const BALCONY_SIZE: BlockSize = { width: 17, depth: 15.8, height: 14.5 };
export const CURVED_SIZE: BlockSize = {
  width: 16.4,
  depth: 15.8,
  height: 14.6,
};

/** The front-centre of a baked box (its centre moved half its depth towards the street) as a site. */
export const frontSite = (
  box: { x: number; z: number; angle: number },
  depth: number,
): Site => {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  // Local +z of a site is (-sin, cos) in the world.
  return {
    x: box.x - s * (depth / 2),
    z: box.z + c * (depth / 2),
    yaw: box.angle,
  };
};

/** The two baked boxes the blocks replace (data.json buildings 7 and 6). */
export const BALCONY_BOX = { id: 7, x: 1527.8, z: -1001.3, angle: 0.259 };
export const CURVED_BOX = { id: 6, x: 1545.5, z: -989.8, angle: 0.403 };
export const BALCONY_BLOCK: Site = frontSite(BALCONY_BOX, BALCONY_SIZE.depth);
export const CURVED_BLOCK: Site = frontSite(CURVED_BOX, CURVED_SIZE.depth);

/** A window or door on wall `w`: dark glass in a frame, `mullion` splits it down the middle (a French door). */
function opening(
  l: Local,
  w: Wall,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  o: { fill?: string; frame?: string; mullion?: boolean; off?: number } = {},
): void {
  const off = o.off ?? 0.03;
  const fill = o.fill ?? GLASS;
  const frame = o.frame ?? BROWN;
  l.panel('paint', w, rectOutline(s0, y0, s1, y1), fill, { off });
  l.panel(
    'paint',
    w,
    rectOutline(s0 - 0.09, y0 - 0.07, s1 + 0.09, y1 + 0.09),
    frame,
    { holes: [rectOutline(s0, y0, s1, y1)], off: off + 0.006 },
  );
  if (o.mullion) {
    const m = (s0 + s1) / 2;
    l.panel('paint', w, rectOutline(m - 0.035, y0, m + 0.035, y1), frame, {
      off: off + 0.012,
    });
  }
}

/** A window with a roller-shutter box over it, in the given shutter colour. */
function shuttered(
  l: Local,
  w: Wall,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  shutter: string,
): void {
  opening(l, w, s0, y0, s1, y1, { fill: shutter });
  l.panel(
    'paint',
    w,
    rectOutline(s0 - 0.1, y1 + 0.09, s1 + 0.1, y1 + 0.3),
    WHITE,
    { off: 0.05 },
  );
}

/** A small white air-conditioning unit hung on the facade (the front plane z = 0 pushed out by `z`). */
function ac(l: Local, x: number, y: number, z = 0): void {
  l.box('paint', [x, y, z], [x + 0.85, y + 0.5, z + 0.3], '#e9ebec');
  l.box(
    'paint',
    [x + 0.1, y + 0.08, z + 0.3],
    [x + 0.75, y + 0.42, z + 0.33],
    '#8b9094',
  );
}

/** A balcony: slab y0 - 0.26 .. y0, x0..x1, z0..z1; a steel railing (rods + posts) round its free sides. */
function balcony(
  l: Local,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  slab = CREAM,
  sides = true,
): void {
  l.box('render', [x0, y0 - 0.26, z0], [x1, y0, z1], slab);
  const rail = (a: V3, b: V3): void => {
    l.box(
      'metal',
      [a[0] - 0.02, a[1], a[2] - 0.02],
      [b[0] + 0.02, b[1] + 0.04, b[2] + 0.02],
      STEEL,
    );
  };
  // Front run.
  for (const h of [1.02, 0.72, 0.42])
    rail([x0, y0 + h, z1 - 0.05], [x1, y0 + h, z1 - 0.05]);
  const n = Math.max(2, Math.round((x1 - x0) / 1.3));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    rail([x, y0, z1 - 0.05], [x, y0 + 1.04, z1 - 0.05]);
  }
  if (!sides) return;
  for (const x of [x0 + 0.03, x1 - 0.03])
    for (const h of [1.02, 0.52]) rail([x, y0 + h, z0], [x, y0 + h, z1 - 0.05]);
}

/** A segmental arch (x from -half to half): the outer curve's y at x, spring `y0`, rise `rise`. */
function archY(half: number, y0: number, rise: number): (x: number) => number {
  const r = (half * half + rise * rise) / (2 * rise);
  const yc = y0 + rise - r;
  return (x) => yc + Math.sqrt(Math.max(0, r * r - x * x));
}

/** Window columns on a side wall: `zs` = centres of the windows along the depth, floors at the given sill heights. */
function sideWindows(
  l: Local,
  half: number,
  depth: number,
  sills: number[],
  zs: number[],
): void {
  for (const side of [-1, 1]) {
    const w: Wall = { o: [side * half, 0, 0], n: [side, 0, 0] };
    for (const y of sills)
      for (const z of zs) {
        // On a wall facing +x the run s goes towards -z, on one facing -x towards +z.
        const s = side > 0 ? -z : z;
        if (z < -depth + 1) continue;
        opening(l, w, s - 0.55, y, s + 0.55, y + 1.3, { off: 0.025 });
      }
  }
}

/** The curved block: three floors of balconies under an arch between beige end bays with dark attics. */
export function buildCurvedBlock(l: Local): void {
  const { width: W, depth: D } = CURVED_SIZE;
  const HX = W / 2;
  const BASE = 3.2;
  const FL = 3.0;
  const Y = [BASE, BASE + FL, BASE + 2 * FL];
  const TOP = BASE + 3 * FL;
  const BAY = 3.7;
  const REC = 1.7;
  const cx = HX - BAY;
  // Ground floor (white render), then the body: beige render, the recess wall in light grey.
  l.box('render', [-HX, DEEP, -D], [HX, BASE, 0], WHITE);
  l.box('render', [-HX, BASE, -D], [HX, TOP, -REC], BEIGE);
  for (const side of [-1, 1])
    l.box(
      'panel',
      [side > 0 ? cx : -HX, BASE, -REC],
      [side > 0 ? HX : -cx, TOP, 0],
      '#e5c590',
    );
  // The recess wall up to the arch.
  const outer = archY(cx, TOP, 2.2);
  const NA = 14;
  const xs = Array.from({ length: NA + 1 }, (_, i) => -cx + (2 * cx * i) / NA);
  const inner = (x: number): number => outer(x) - 0.8;
  const rec: Wall = { o: [0, 0, -REC], n: [0, 0, 1] };
  l.panel(
    'render',
    rec,
    [
      [-cx, BASE],
      [cx, BASE],
      ...xs
        .slice()
        .reverse()
        .map((x): V2 => [x, inner(x)]),
    ],
    '#c9bc9e',
    { off: 0.02 },
  );
  // The arch band on the facade plane and the vault above it, closed at the back.
  l.panel(
    'render',
    FRONT,
    [
      ...xs.map((x): V2 => [x, outer(x)]),
      ...xs
        .slice()
        .reverse()
        .map((x): V2 => [x, inner(x)]),
    ],
    CREAM,
    { off: 0.04 },
  );
  for (let i = 0; i < NA; i++) {
    const [a, b] = [xs[i], xs[i + 1]];
    l.fan(
      'sheet',
      [
        [a, outer(a), 0.3],
        [b, outer(b), 0.3],
        [b, outer(b), -D],
        [a, outer(a), -D],
      ],
      '#8d8a84',
      [0, 1, 0],
      (p) => [p[0], p[2]],
    );
    // Soffit of the vault between the facade plane and the recess wall.
    l.fan(
      'render',
      [
        [a, inner(a), 0],
        [b, inner(b), 0],
        [b, inner(b), -REC],
        [a, inner(a), -REC],
      ],
      CREAM,
      [0, -1, 0],
      (p) => [p[0], p[2]],
    );
  }
  l.panel(
    'render',
    { o: [0, 0, -D], n: [0, 0, -1] },
    [
      [cx, TOP - 0.2],
      ...xs
        .slice()
        .reverse()
        .map((x): V2 => [-x, outer(x)]),
      [-cx, TOP - 0.2],
    ],
    BEIGE,
    { off: 0.01 },
  );
  // Balconies on the three floors, with the French doors and shuttered windows behind them.
  for (const y of Y) {
    balcony(l, -cx, cx, -REC, 0.65, y);
    const bottom = y + 0.05;
    opening(l, rec, -3.6, bottom, -2.2, bottom + 2.15, {
      mullion: true,
      off: 0.04,
    });
    shuttered(l, rec, -0.75, bottom + 0.4, 0.75, bottom + 2.0, WOOD_SHUTTER);
    opening(l, rec, 2.2, bottom, 3.6, bottom + 2.15, {
      mullion: true,
      off: 0.04,
    });
  }
  // The top floor's glazing reaches into the arch.
  opening(l, rec, -3.6, TOP + 0.05, -2.2, inner(-2.9) - 0.2, { off: 0.04 });
  opening(l, rec, 2.2, TOP + 0.05, 3.6, inner(2.9) - 0.2, { off: 0.04 });
  // The end bays: a window and shutter per floor, a unit or two on the wall.
  for (const side of [-1, 1]) {
    const mid = side * (HX - BAY / 2);
    for (const y of Y)
      shuttered(l, FRONT, mid - 0.55, y + 0.85, mid + 0.55, y + 2.2, SHUTTER);
    ac(l, mid + side * 0.2 - 0.4, Y[1] + 0.35, 0.03);
    // The dark attic: a steel-clad box over the bay with a pair of dormer windows.
    l.box(
      'sheet',
      [side > 0 ? cx : -HX, TOP, -D],
      [side > 0 ? HX : -cx, TOP + 2.3, -0.7],
      '#4a3b33',
    );
    const attic: Wall = { o: [0, 0, -0.7], n: [0, 0, 1] };
    for (const d of [-0.65, 0.65])
      opening(l, attic, mid + d - 0.4, TOP + 0.55, mid + d + 0.4, TOP + 1.85, {
        off: 0.03,
        frame: '#6d5a4c',
      });
  }
  // Ground floor: door, windows.
  opening(l, FRONT, -0.6, 0.0, 0.6, 2.25, { mullion: true, frame: '#8a8f93' });
  for (const s of [-5.8, -3.1, 3.1, 5.8])
    opening(l, FRONT, s - 0.7, 1.1, s + 0.7, 2.4);
  // Sides and the back.
  sideWindows(
    l,
    HX,
    D,
    [BASE + 0.9, Y[1] + 0.9, Y[2] + 0.9],
    [-3.5, -8, -12.5],
  );
  // Roof edge on the flat parts.
  for (const side of [-1, 1])
    l.box(
      'paint',
      [side > 0 ? cx : -HX, TOP + 2.3, -D],
      [side > 0 ? HX : -cx, TOP + 2.42, -0.7],
      '#5a4a40',
    );
}

/** The balcony block: a stacked-balcony bay on each side of a flush peach wall, four floors under a flat roof slab. */
export function buildBalconyBlock(l: Local): void {
  const { width: W, depth: D } = BALCONY_SIZE;
  const HX = W / 2;
  const BASE = 2.9;
  const FL = 2.8;
  const Y = [BASE, BASE + FL, BASE + 2 * FL, BASE + 3 * FL];
  const TOP = BASE + 4 * FL;
  l.box('render', [-HX, DEEP, -D], [HX, BASE, 0], '#e6dcc4');
  l.box('render', [-HX, BASE, -D], [HX, TOP, 0], '#e8d3a2');
  // The peach middle of the facade, the deeper cream stripe to the right.
  l.panel('render', FRONT, rectOutline(-3.4, BASE, 1.7, TOP), '#cf9468', {
    off: 0.03,
  });
  l.panel('render', FRONT, rectOutline(6.7, BASE, HX, TOP), '#eadbb8', {
    off: 0.03,
  });
  // Balcony columns: left bay and right bay, doors behind them.
  for (const y of Y) {
    balcony(l, -8.1, -4.1, 0, 1.4, y);
    opening(l, FRONT, -7.4, y + 0.05, -5.9, y + 2.15, { mullion: true });
    opening(l, FRONT, -4.9, y + 0.8, -4.1, y + 2.0);
    balcony(l, 2.1, 6.3, 0, 1.6, y);
    opening(l, FRONT, 2.7, y + 0.05, 4.1, y + 2.15, { mullion: true });
    shuttered(l, FRONT, 4.9, y + 0.5, 5.9, y + 2.0, WOOD_SHUTTER);
    // Windows with grey shutters in the peach wall and the right strip.
    shuttered(l, FRONT, -3.0, y + 0.55, -2.0, y + 2.0, SHUTTER);
    shuttered(l, FRONT, -1.0, y + 0.55, 0, y + 2.0, SHUTTER);
    opening(l, FRONT, 7.2, y + 0.7, 8.1, y + 2.0, { off: 0.05 });
  }
  ac(l, -3.0, Y[2] + 2.3, 0.03);
  ac(l, 5.4, Y[3] + 2.3, 0.03);
  ac(l, 0.2, Y[1] + 2.3, 0.03);
  // Ground floor: entrance and windows.
  opening(l, FRONT, -0.7, 0.0, 0.7, 2.2, { mullion: true, frame: STEEL });
  for (const s of [-6.3, -3.4, 3.4, 6.2])
    opening(l, FRONT, s - 0.7, 1.0, s + 0.7, 2.3);
  // Roof slab with a white fascia, a glass canopy over the top balconies.
  l.box('paint', [-HX - 0.4, TOP, -D - 0.4], [HX + 0.4, TOP + 0.3, 1.9], WHITE);
  l.box('paint', [-8.2, TOP - 0.1, 1.4], [-4.0, TOP, 1.9], '#7d8a8c');
  sideWindows(
    l,
    HX,
    D,
    [BASE + 0.9, Y[1] + 0.9, Y[2] + 0.9, Y[3] + 0.9],
    [-3.5, -8, -12.5],
  );
}

/** The baked house on the slope at the corner before the blocks (data.json building 9). */
export const CORNER_HOUSE = {
  id: 9,
  x: 1514.3,
  z: -1017.6,
  w: 23.9,
  d: 10.9,
  angle: -1.268,
};

/** Depth of the front gardens (m from the facade to the street wall). */
export const GARDEN = { balcony: 4.6, curved: 4.4 };

/**
 * The terrace each block stands on (`MapDef.terrain.pads`): level at the middle of its front garden, a little wider than the
 * block, so the flats stand on flat ground (the street's side of it is held up by the wall, `start-wall.ts`).
 */
export const BLOCK_PADS: PadDef[] = [
  ...blockPads(),
  // The corner house stands on a 5 m slope with its road-side corner 5 m from the road (a house stands on its lowest corner):
  // its terrace is cut 3 m into the land there, down to that corner (applied last: it keeps its level where the blocks' meet it).
  terracePad('corner_house', CORNER_HOUSE, 2, [1507.3, -1013.5], -3),
];

function terracePad(
  name: string,
  b: { x: number; z: number; w: number; d: number; angle: number },
  margin: number,
  level: [number, number] = [b.x, b.z],
  lift = 0.1,
): PadDef {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const hw = b.w / 2 + margin;
  const hd = b.d / 2 + margin;
  return {
    name,
    polygon: (
      [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ] as const
    ).flatMap(([u, v]) => [b.x + u * c - v * s, b.z + u * s + v * c]),
    blend: 6,
    level: { at: level, lift },
  };
}

function blockPads(): PadDef[] {
  return (
    [
      ['balcony_block', BALCONY_BLOCK, BALCONY_SIZE, GARDEN.balcony],
      ['curved_block', CURVED_BLOCK, CURVED_SIZE, GARDEN.curved],
    ] as const
  ).map(([name, site, size, garden]): PadDef => ({
    name,
    polygon: (
      [
        [-size.width / 2 - 1.2, -size.depth - 1.5],
        [size.width / 2 + 1.2, -size.depth - 1.5],
        [size.width / 2 + 1.2, garden + 0.4],
        [-size.width / 2 - 1.2, garden + 0.4],
      ] as const
    ).flatMap(([x, z]) => toWorld(site, x, z)),
    blend: 5,
    level: { at: toWorld(site, 0, 2.3), lift: 0.1 },
  }));
}

/** The facade of a block in the world: where scatter stays off (a margin round the block and its front garden). */
export const blockRect = (
  size: BlockSize,
  garden: number,
): readonly [number, number, number, number] => [
  -size.width / 2 - 1,
  size.width / 2 + 1,
  -size.depth - 1,
  garden + 0.5,
];
