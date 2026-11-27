import type { Local, V3 } from '../hilltop/build/shapes';
import type { MatKey } from '../start-row/build/materials';
import type { BuildingDef } from '../../shared/types';
import { roofOf, type FarmModel } from './models';

/**
 * Geometry of the village farm buildings (see models.ts), in each building's own frame: x along its long side, z
 * across, y up from its lowest corner (the plinth runs down under the ground on a slope). `front` = the long wall that
 * faces the road (+1 = local +z): the doors and the balcony go there.
 */

const PLINTH = '#a39e95';
const GUTTER = '#8e9294';
const SOFFIT = '#6b6c69';

/** Where the building stands. */
export interface Site {
  /** The long wall with the doors: +1 = local +z. */
  front: number;
  /** The foot of the plinth (y), under the lowest ground round it. */
  foot: number;
  /** Height of the ground at a local point (x, z), from the floor. */
  ground: (x: number, z: number) => number;
  /** Is a local point (x, z) clear of the neighbouring buildings? */
  free: (x: number, z: number) => boolean;
}

/** Is the wall face u0..u1 on side `s` clear of the neighbours (a door / window there opens onto something)? */
function clear(
  free: Site['free'],
  b: BuildingDef,
  s: Side,
  u0: number,
  u1: number,
): boolean {
  return [u0, (u0 + u1) / 2, u1].every((u) => {
    const p = onFace(b, s, u, 0, 0.5);
    return free(p[0], p[2]);
  });
}

interface Side {
  axis: 'x' | 'z';
  sign: number;
}

/** Point on a wall face: `u` along the wall, `y` up, `off` out of it. */
const onFace = (
  b: BuildingDef,
  s: Side,
  u: number,
  y: number,
  off: number,
): V3 =>
  s.axis === 'z'
    ? [u, y, s.sign * (b.d / 2 + off)]
    : [s.sign * (b.w / 2 + off), y, u];

/** A box on a wall face: u0..u1 along it, y0..y1, from `o0` to `o1` out of it. */
function onWall(
  l: Local,
  b: BuildingDef,
  s: Side,
  key: MatKey,
  [u0, u1]: [number, number],
  [y0, y1]: [number, number],
  [o0, o1]: [number, number],
  color: string,
): void {
  const a = onFace(b, s, u0, y0, o0);
  const c = onFace(b, s, u1, y1, o1);
  l.box(
    key,
    [Math.min(a[0], c[0]), y0, Math.min(a[2], c[2])],
    [Math.max(a[0], c[0]), y1, Math.max(a[2], c[2])],
    color,
  );
}

/**
 * A concrete ramp down from a door (u0..u1 on wall `s`) to the ground in front of it when that lies lower than the
 * floor (a building on a terrace above its lane), about 1 in 5.
 */
function apron(
  l: Local,
  b: BuildingDef,
  s: Side,
  [u0, u1]: [number, number],
  ground: Site['ground'],
): void {
  const at = (u: number, y: number, o: number) => onFace(b, s, u, y, o);
  const p = at((u0 + u1) / 2, 0, 1.5);
  const drop = Math.max(-2.5, ground(p[0], p[2]));
  if (drop > -0.15) return;
  const len = Math.min(6, Math.max(1.2, -drop * 5));
  const y1 = drop - 0.1;
  const below = drop - 0.6;
  const along: V3 = s.axis === 'z' ? [1, 0, 0] : [0, 0, 1];
  const uv = (q: V3): [number, number] => [
    s.axis === 'z' ? q[0] : q[2],
    s.axis === 'z' ? q[2] : q[0],
  ];
  l.fan(
    'wall',
    [at(u0, 0.03, 0), at(u1, 0.03, 0), at(u1, y1, len), at(u0, y1, len)],
    '#b4b0a7',
    [0, 1, 0],
    uv,
  );
  for (const [u, k] of [
    [u0, -1],
    [u1, 1],
  ])
    l.fan(
      'wall',
      [at(u, 0.03, 0), at(u, y1, len), at(u, below, len), at(u, below, 0)],
      '#a9a59c',
      [along[0] * k, 0, along[2] * k],
      (q) => [s.axis === 'z' ? q[2] : q[0], q[1]],
    );
}

/** A glass pane on a wall face, `off` out of it: one quad with the pane texture once over it (UV 0..1). */
function pane(
  l: Local,
  b: BuildingDef,
  s: Side,
  [u0, u1]: [number, number],
  [y0, y1]: [number, number],
  off: number,
): void {
  const along = (p: V3) => (s.axis === 'z' ? p[0] : p[2]);
  l.fan(
    'glass',
    [
      onFace(b, s, u0, y0, off),
      onFace(b, s, u1, y0, off),
      onFace(b, s, u1, y1, off),
      onFace(b, s, u0, y1, off),
    ],
    '#ffffff',
    s.axis === 'z' ? [0, 0, s.sign] : [s.sign, 0, 0],
    (p) => [(along(p) - u0) / (u1 - u0), (p[1] - y0) / (y1 - y0)],
  );
}

/** Half length of a wall (along it). */
const halfOf = (b: BuildingDef, s: Side): number =>
  s.axis === 'z' ? b.w / 2 : b.d / 2;

/** A window: frame, glass, a mullion, a sill and (houses) the roller-shutter box over it. */
function windowOn(
  l: Local,
  b: BuildingDef,
  s: Side,
  u: number,
  yc: number,
  w: number,
  h: number,
  o: { frame: string; shutter?: string; sill?: string; free: Site['free'] },
): void {
  if (!clear(o.free, b, s, u - w / 2, u + w / 2)) return;
  const f = 0.08;
  onWall(
    l,
    b,
    s,
    'paint',
    [u - w / 2 - f, u + w / 2 + f],
    [yc - h / 2 - f, yc + h / 2 + f],
    [0, 0.04],
    o.frame,
  );
  pane(l, b, s, [u - w / 2, u + w / 2], [yc - h / 2, yc + h / 2], 0.045);
  onWall(
    l,
    b,
    s,
    'paint',
    [u - 0.03, u + 0.03],
    [yc - h / 2, yc + h / 2],
    [0.05, 0.065],
    o.frame,
  );
  onWall(
    l,
    b,
    s,
    'paint',
    [u - w / 2 - 0.12, u + w / 2 + 0.12],
    [yc - h / 2 - f - 0.05, yc - h / 2 - f],
    [0, 0.15],
    o.sill ?? '#d4d0c6',
  );
  if (o.shutter)
    onWall(
      l,
      b,
      s,
      'paint',
      [u - w / 2 - f, u + w / 2 + f],
      [yc + h / 2 + f, yc + h / 2 + f + 0.22],
      [0, 0.12],
      o.shutter,
    );
}

/** Evenly spaced positions along a wall `half` long, about `pitch` apart, `margin` clear of the corners. */
function spots(half: number, pitch: number, margin: number): number[] {
  const len = 2 * (half - margin);
  if (len < 0) return [];
  const n = Math.max(1, Math.round(len / pitch));
  return Array.from({ length: n }, (_, i) => -len / 2 + (len * (i + 0.5)) / n);
}

/** Gutter along an eave (local z = `z`, y = `y`) and downpipes at both ends. */
function gutter(l: Local, b: BuildingDef, z: number, y: number): void {
  const half = b.w / 2;
  const zs = Math.sign(z);
  l.box(
    'metal',
    [-half - 0.1, y - 0.14, Math.min(z, z + zs * 0.14)],
    [half + 0.1, y, Math.max(z, z + zs * 0.14)],
    GUTTER,
  );
  for (const x of [-half + 0.25, half - 0.25]) {
    const zc = zs * (b.d / 2 + 0.08);
    l.box(
      'metal',
      [x - 0.05, 0.12, zc - 0.05],
      [x + 0.05, y - 0.3, zc + 0.05],
      GUTTER,
    );
    // Swan neck from the gutter to the pipe, the shoe at its foot.
    const zg = z + zs * 0.07;
    l.box(
      'metal',
      [x - 0.05, y - 0.36, Math.min(zc, zg) - 0.05],
      [x + 0.05, y - 0.12, Math.max(zc, zg) + 0.05],
      GUTTER,
    );
    l.box(
      'metal',
      [x - 0.05, 0.02, Math.min(zc, zc + zs * 0.25) - 0.05],
      [x + 0.05, 0.14, Math.max(zc, zc + zs * 0.25) + 0.05],
      GUTTER,
    );
  }
}

/** Plinth (concrete, down to `foot`, under the lowest ground round it) and the main walls (`key`) from `y0` to the eaves `h`. */
function shell(
  l: Local,
  b: BuildingDef,
  key: MatKey,
  color: string,
  y0: number,
  h: number,
  foot: number,
): void {
  const w = b.w / 2;
  const d = b.d / 2;
  l.box('wall', [-w - 0.04, foot, -d - 0.04], [w + 0.04, y0, d + 0.04], PLINTH);
  l.box(key, [-w, y0, -d], [w, h, d], color);
}

/**
 * A two-pitch roof, ridge along x over the eaves at `h`: the two planes (with soffit and fascia), the gable ends filled
 * with `wallKey`, a ridge cap. `tiles` = a clay-tile roof, else steel sheet.
 */
function gableRoof(
  l: Local,
  b: BuildingDef,
  h: number,
  pitch: number,
  over: number,
  color: string,
  o: { tiles?: boolean; wallKey: MatKey; wall: string; inner?: boolean },
): number {
  const t = Math.tan(pitch);
  const W = b.w / 2 + over;
  const D = b.d / 2 + over;
  const yE = h - over * t;
  const yR = h + (b.d / 2) * t;
  for (const s of [1, -1]) {
    const pts: V3[] = [
      [-W * s, yE, D * s],
      [W * s, yE, D * s],
      [W * s, yR, 0],
      [-W * s, yR, 0],
    ];
    if (o.tiles) l.roof(pts, { color, trim: [0, 1, 3], soffit: SOFFIT });
    else sheetPlane(l, pts, color);
    // Gable end (and its inside face, for an open building).
    const x = (s * b.w) / 2;
    for (const k of o.inner ? [1, -1] : [1])
      l.fan(
        o.wallKey,
        [
          [x, h, -b.d / 2],
          [x, h, b.d / 2],
          [x, yR - 0.05, 0],
        ],
        o.wall,
        [k * s, 0, 0],
        (p) => [p[2], p[1]],
      );
  }
  l.box(
    o.tiles ? 'tiles' : 'sheet',
    [-W, yR - 0.04, -0.18],
    [W, yR + 0.1, 0.18],
    color,
  );
  return yE;
}

/** A steel-sheet roof plane (first edge = the eave), closed below like the tiled ones. */
function sheetPlane(
  l: Local,
  pts: V3[],
  color: string,
  key: MatKey = 'sheet',
): void {
  const e = norm(sub(pts[1], pts[0]));
  const toC = sub(pts[pts.length - 1], pts[0]);
  const up = norm(sub(toC, scale(e, dot(toC, e))));
  const n = norm(cross(e, up));
  const nUp: V3 = n[1] >= 0 ? n : [-n[0], -n[1], -n[2]];
  const uvOf = (p: V3): [number, number] => [
    dot(sub(p, pts[0]), e),
    dot(sub(p, pts[0]), up),
  ];
  l.fan(key, pts, color, nUp, uvOf);
  l.slab(pts, nUp, uvOf, {
    trim: [0],
    under: 0.1,
    soffit: SOFFIT,
    fascia: '#9a9e9f',
  });
}

/** A hip roof (tiles, or `key` sheet) over the eaves at `h`, its ridge at least `ridge` long. */
function hipRoof(
  l: Local,
  b: BuildingDef,
  h: number,
  pitch: number,
  over: number,
  color: string,
  key: MatKey,
  ridge = 0,
): number {
  const tiles = key === 'tiles';
  const plane = (pts: V3[]) =>
    tiles
      ? l.roof(pts, { color, trim: [0], soffit: SOFFIT })
      : sheetPlane(l, pts, color, key);
  const t = Math.tan(pitch);
  const W = b.w / 2 + over;
  const D = b.d / 2 + over;
  const yE = h - over * t;
  const yR = h + (b.d / 2) * t;
  // Half the ridge: what the plan gives, or longer (`ridge`, steeper hip ends).
  const rx = Math.min(b.w / 2 - 1, Math.max((b.w - b.d) / 2, ridge / 2, 0));
  for (const s of [1, -1]) {
    const side: V3[] =
      rx > 0.05
        ? [
            [-W * s, yE, D * s],
            [W * s, yE, D * s],
            [rx * s, yR, 0],
            [-rx * s, yR, 0],
          ]
        : [
            [-W * s, yE, D * s],
            [W * s, yE, D * s],
            [0, yR, 0],
          ];
    plane(side);
    plane([
      [W * s, yE, D * s],
      [W * s, yE, -D * s],
      [rx * s, yR, 0],
    ]);
  }
  if (rx > 0.05)
    l.box(key, [-rx, yR - 0.04, -0.15], [rx, yR + 0.1, 0.15], color);
  return yE;
}

/** Farm hall: block plinth wall, sheet cladding, a translucent strip under the eaves, sliding doors, a roller door. */
function hall(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  { front, foot, ground, free }: Site,
): void {
  const h = b.h;
  const { pitch, over } = roofOf(m);
  shell(l, b, 'sheet', m.walls, 0.3, h, foot);
  // Concrete block base course, 1.2 m.
  l.box(
    'wall',
    [-b.w / 2 - 0.03, 0.3, -b.d / 2 - 0.03],
    [b.w / 2 + 0.03, 1.5, b.d / 2 + 0.03],
    '#c4c0b7',
  );
  const fs: Side = { axis: 'z', sign: front };
  const bs: Side = { axis: 'z', sign: -front };
  const doorH = Math.min(4.2, h - 1.4);
  // Translucent polycarbonate strip along both long walls.
  for (const s of [fs, bs])
    onWall(
      l,
      b,
      s,
      'paint',
      [-b.w / 2 + 0.3, b.w / 2 - 0.3],
      [h - 1.1, h - 0.45],
      [0, 0.03],
      '#d5dcd6',
    );
  // Sliding doors on the front (one per ~18 m), a door track over each, a man door beside the first.
  const doors = spots(b.w / 2, 18, 3);
  for (const u of doors) {
    const dw = Math.min(5, b.w / 3);
    if (!clear(free, b, fs, u - dw, u + dw / 2 + 0.2)) continue;
    onWall(
      l,
      b,
      fs,
      'sheet',
      [u - dw / 2, u + dw / 2],
      [0.04, 0.3 + doorH],
      [0.03, 0.12],
      '#c9cdcc',
    );
    onWall(
      l,
      b,
      fs,
      'metal',
      [u - dw, u + dw / 2 + 0.2],
      [0.3 + doorH + 0.05, 0.3 + doorH + 0.25],
      [0.03, 0.18],
      GUTTER,
    );
    apron(l, b, fs, [u - dw / 2 - 0.3, u + dw / 2 + 0.3], ground);
  }
  if (doors.length) {
    const u = doors[0] + Math.min(5, b.w / 3) / 2 + 1.4;
    if (u + 0.6 < b.w / 2 && clear(free, b, fs, u - 0.5, u + 0.5)) {
      onWall(
        l,
        b,
        fs,
        'paint',
        [u - 0.5, u + 0.5],
        [0.04, 2.2],
        [0, 0.06],
        '#6f7577',
      );
      apron(l, b, fs, [u - 0.7, u + 0.7], ground);
    }
  }
  // Roller door in one gable end.
  const es: Side = { axis: 'x', sign: front };
  if (b.d > 9 && clear(free, b, es, -2.5, 2.5)) {
    const rw = Math.min(4.5, b.d - 4);
    onWall(
      l,
      b,
      es,
      'roller',
      [-rw / 2, rw / 2],
      [0.04, 0.3 + doorH],
      [0, 0.05],
      '#d9dbd9',
    );
    onWall(
      l,
      b,
      es,
      'paint',
      [-rw / 2 - 0.15, rw / 2 + 0.15],
      [0.3 + doorH, 0.3 + doorH + 0.45],
      [0, 0.35],
      '#b8bcbd',
    );
    apron(l, b, es, [-rw / 2 - 0.3, rw / 2 + 0.3], ground);
  }
  const yE = gableRoof(l, b, h, pitch, over, m.roof, {
    wallKey: 'sheet',
    wall: m.walls,
  });
  // Roof lights: translucent sheets across both slopes.
  const t = Math.tan(pitch);
  for (const x of spots(b.w / 2, 7, 2))
    for (const s of [1, -1]) {
      const z0 = s * (b.d / 2 - 0.6);
      const z1 = s * 1.2;
      const y = (z: number) => h + (b.d / 2 - Math.abs(z)) * t + 0.03;
      l.fan(
        'paint',
        [
          [x - 0.55, y(z0), z0],
          [x + 0.55, y(z0), z0],
          [x + 0.55, y(z1), z1],
          [x - 0.55, y(z1), z1],
        ],
        '#c5d0cb',
        [0, 1, 0],
        (p) => [p[0], p[2]],
      );
    }
  for (const s of [1, -1]) gutter(l, b, s * (b.d / 2 + over), yE);
}

/** Old barn / stable: rendered or brick walls, a tiled gable roof, wooden doors, small windows. */
function barn(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  { front, foot, ground, free }: Site,
): void {
  const h = b.h;
  const { pitch, over } = roofOf(m);
  const key: MatKey = m.brick ? 'brick' : 'render';
  shell(l, b, key, m.walls, 0.45, h, foot);
  const fs: Side = { axis: 'z', sign: front };
  const bs: Side = { axis: 'z', sign: -front };
  const doors = spots(b.w / 2, 8, 1.8);
  doors.forEach((u, i) => {
    if (i % 2 === 1 && doors.length > 2) {
      windowOn(l, b, fs, u, h - 0.9, 0.7, 0.55, {
        frame: '#7d6a55',
        sill: '#bdb5a7',
        free,
      });
      return;
    }
    // Two wooden leaves in a frame.
    if (!clear(free, b, fs, u - 1.45, u + 1.45)) return;
    apron(l, b, fs, [u - 1.5, u + 1.5], ground);
    onWall(
      l,
      b,
      fs,
      'paint',
      [u - 1.35, u + 1.35],
      [0.04, 2.75],
      [0, 0.04],
      '#5f4a36',
    );
    for (const k of [-1, 1])
      onWall(
        l,
        b,
        fs,
        'paint',
        [u + (k < 0 ? -1.25 : 0.03), u + (k < 0 ? -0.03 : 1.25)],
        [0.08, 2.65],
        [0.04, 0.08],
        '#7a5a3c',
      );
    onWall(
      l,
      b,
      fs,
      'paint',
      [u - 1.45, u + 1.45],
      [2.75, 2.92],
      [0, 0.1],
      '#bdb5a7',
    );
  });
  for (const u of spots(b.w / 2, 4, 1.5))
    windowOn(l, b, bs, u, h - 0.9, 0.6, 0.5, {
      frame: '#8a8378',
      sill: '#bdb5a7',
      free,
    });
  gableRoof(l, b, h, pitch, over, m.roof, {
    tiles: true,
    wallKey: key,
    wall: m.walls,
  });
}

/** Village house: rendered, a plinth, windows with roller-shutter boxes, a door, a balcony over it, a chimney. */
function house(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  { front, foot, ground, free }: Site,
): void {
  const h = b.h;
  const { pitch, over } = roofOf(m);
  const y0 = 0.6;
  shell(l, b, 'render', m.walls, y0, h, foot);
  const floors = Math.max(1, b.floors);
  const storey = (h - y0) / floors;
  const frame = m.dark ? '#3b3e41' : '#f4f3ef';
  const shutter = m.dark ? '#46494c' : '#e6e4de';
  // Band between the floors.
  for (let f = 1; f < floors; f++)
    l.box(
      'paint',
      [-b.w / 2 - 0.03, y0 + f * storey - 0.1, -b.d / 2 - 0.03],
      [b.w / 2 + 0.03, y0 + f * storey + 0.08, b.d / 2 + 0.03],
      '#d9d4c8',
    );
  const fs: Side = { axis: 'z', sign: front };
  const door = 0;
  for (const s of [
    fs,
    { axis: 'z', sign: -front } as Side,
    { axis: 'x', sign: 1 } as Side,
    { axis: 'x', sign: -1 } as Side,
  ])
    for (const u of spots(halfOf(b, s), s.axis === 'z' ? 3.4 : 3.2, 1.2))
      for (let f = 0; f < floors; f++) {
        if (s === fs && f === 0 && Math.abs(u - door) < 1.6) continue;
        const wide = m.dark && s === fs;
        windowOn(
          l,
          b,
          s,
          u,
          y0 + f * storey + storey * 0.52,
          wide ? 1.6 : 1.2,
          f === 0 && wide ? 1.9 : 1.4,
          { frame, shutter, free },
        );
      }
  // Front door with a step and, upstairs, the balcony over it.
  onWall(
    l,
    b,
    fs,
    'paint',
    [door - 0.6, door + 0.6],
    [y0, y0 + 2.25],
    [0, 0.06],
    m.dark ? '#2f3236' : '#6b4a32',
  );
  apron(l, b, fs, [door - 1.2, door + 1.2], ground);
  for (const [k, y, o] of [
    [1.15, y0 / 2, 1.5],
    [1, y0, 1.1],
  ])
    onWall(l, b, fs, 'wall', [door - k, door + k], [0, y], [0, o], '#b9b5ac');
  if (floors > 1) {
    const yb = y0 + storey;
    onWall(
      l,
      b,
      fs,
      'wall',
      [door - 2.2, door + 2.2],
      [yb - 0.18, yb],
      [0, 1.4],
      '#d1cdc4',
    );
    // Railing: posts, a top rail, bars.
    for (let u = -2.1; u <= 2.11; u += 0.14)
      onWall(
        l,
        b,
        fs,
        'metal',
        [door + u - 0.015, door + u + 0.015],
        [yb, yb + 1.0],
        [1.3, 1.33],
        '#4a4d50',
      );
    onWall(
      l,
      b,
      fs,
      'metal',
      [door - 2.2, door + 2.2],
      [yb + 0.98, yb + 1.04],
      [1.27, 1.37],
      '#4a4d50',
    );
    for (const k of [-1, 1])
      onWall(
        l,
        b,
        fs,
        'metal',
        [door + k * 2.17 - 0.02, door + k * 2.17 + 0.02],
        [yb, yb + 1.04],
        [0, 1.37],
        '#4a4d50',
      );
  } else
    onWall(
      l,
      b,
      fs,
      'wall',
      [door - 1.1, door + 1.1],
      [y0 + 2.45, y0 + 2.6],
      [0, 1.0],
      '#d1cdc4',
    );
  const yE = m.sheet
    ? gableRoof(l, b, h, pitch, over, m.roof, {
        wallKey: 'render',
        wall: m.walls,
      })
    : hipRoof(l, b, h, pitch, over, m.roof, m.painted ?? 'tiles', m.ridge);
  const ridge = h + (b.d / 2) * Math.tan(pitch);
  // Chimney through the back slope.
  const cx = b.w / 4;
  const cz = -front * Math.min(1.6, b.d / 4);
  l.box(
    'render',
    [cx - 0.3, h - 0.5, cz - 0.3],
    [cx + 0.3, ridge + 0.7, cz + 0.3],
    m.walls,
  );
  l.box(
    'wall',
    [cx - 0.38, ridge + 0.7, cz - 0.38],
    [cx + 0.38, ridge + 0.82, cz + 0.38],
    '#8f8b84',
  );
  for (const s of [1, -1]) gutter(l, b, s * (b.d / 2 + over), yE);
}

/** Flat-roofed concrete block: rendered, rows of windows per floor, a roller door and a door on the front, a parapet. */
function block(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  { front, foot, ground, free }: Site,
): void {
  const h = b.h;
  const y0 = 0.4;
  shell(l, b, 'render', m.walls, y0, h, foot);
  const floors = Math.max(1, b.floors);
  const storey = (h - y0) / floors;
  const fs: Side = { axis: 'z', sign: front };
  const gate = -b.w / 2 + 3;
  for (const s of [
    fs,
    { axis: 'z', sign: -front } as Side,
    { axis: 'x', sign: 1 } as Side,
    { axis: 'x', sign: -1 } as Side,
  ])
    for (const u of spots(halfOf(b, s), 3, 1.2))
      for (let f = 0; f < floors; f++) {
        if (
          s === fs &&
          f === 0 &&
          (Math.abs(u - gate) < 2.6 || Math.abs(u) < 1)
        )
          continue;
        windowOn(l, b, s, u, y0 + f * storey + storey * 0.55, 1.4, 1.3, {
          frame: '#e9e8e3',
          sill: '#bcb8af',
          free,
        });
      }
  for (let f = 1; f < floors; f++)
    l.box(
      'paint',
      [-b.w / 2 - 0.03, y0 + f * storey - 0.12, -b.d / 2 - 0.03],
      [b.w / 2 + 0.03, y0 + f * storey + 0.1, b.d / 2 + 0.03],
      '#b7b2a8',
    );
  onWall(
    l,
    b,
    fs,
    'roller',
    [gate - 1.8, gate + 1.8],
    [0.04, y0 + Math.min(3.3, storey - 0.2)],
    [0, 0.05],
    '#c8cbcb',
  );
  onWall(
    l,
    b,
    fs,
    'paint',
    [-0.55, 0.55],
    [y0, y0 + 2.2],
    [0, 0.06],
    '#5b5f62',
  );
  onWall(l, b, fs, 'wall', [-0.9, 0.9], [0, y0], [0, 0.9], '#b9b5ac');
  apron(l, b, fs, [-1, 1], ground);
  apron(l, b, fs, [gate - 2, gate + 2], ground);
  onWall(l, b, fs, 'wall', [-1, 1], [y0 + 2.5, y0 + 2.65], [0, 1.0], '#c9c5bc');
  // Flat roof and parapet with a coping.
  l.box(
    'roofing',
    [-b.w / 2 + 0.25, h, -b.d / 2 + 0.25],
    [b.w / 2 - 0.25, h + 0.1, b.d / 2 - 0.25],
    m.roof,
  );
  const W = b.w / 2;
  const D = b.d / 2;
  const top = h + 0.55;
  for (const [a, c] of [
    [
      [-W, h, -D],
      [W, top, -D + 0.25],
    ],
    [
      [-W, h, D - 0.25],
      [W, top, D],
    ],
    [
      [-W, h, -D],
      [-W + 0.25, top, D],
    ],
    [
      [W - 0.25, h, -D],
      [W, top, D],
    ],
  ] as [V3, V3][])
    l.box('render', a, c, m.walls);
  l.box(
    'wall',
    [-W - 0.05, top, -D - 0.05],
    [W + 0.05, top + 0.06, -D + 0.3],
    '#c7c3ba',
  );
  l.box(
    'wall',
    [-W - 0.05, top, D - 0.3],
    [W + 0.05, top + 0.06, D + 0.05],
    '#c7c3ba',
  );
  l.box('wall', [-W - 0.05, top, -D], [-W + 0.3, top + 0.06, D], '#c7c3ba');
  l.box('wall', [W - 0.3, top, -D], [W + 0.05, top + 0.06, D], '#c7c3ba');
}

/** Open-fronted machinery shed: block back and end walls, steel posts along the open front, a low two-pitch sheet roof. */
function shed(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  { front, foot, ground }: Site,
): void {
  const { pitch, over } = roofOf(m);
  const h = b.h;
  const W = b.w / 2;
  // The open front: a ramp along it where the yard lies lower.
  apron(l, b, { axis: 'z', sign: front }, [-b.w / 2, b.w / 2], ground);
  const D = b.d / 2;
  const back = -front * D;
  // Floor slab, back wall, end walls.
  l.box('wall', [-W, foot, -D], [W, 0.12, D], '#b3afa6');
  l.box(
    'wall',
    [-W, 0, Math.min(back, back + front * 0.25)],
    [W, h, Math.max(back, back + front * 0.25)],
    m.walls,
  );
  for (const x0 of [-W, W - 0.25])
    l.box('wall', [x0, 0, -D], [x0 + 0.25, h, D], m.walls);
  // Posts and the eave beam along the open front, under the roof.
  const zf = front * (D - 0.15);
  for (const u of [-W + 0.4, ...spots(W, 5.2, 1), W - 0.4])
    l.box(
      'metal',
      [u - 0.1, 0.12, zf - 0.1],
      [u + 0.1, h - 0.35, zf + 0.1],
      '#5d6a6c',
    );
  l.box(
    'metal',
    [-W, h - 0.35, zf - 0.12],
    [W, h - 0.02, zf + 0.12],
    '#5d6a6c',
  );
  // A purlin under the ridge, seen through the open front.
  const yR = h + D * Math.tan(pitch);
  l.box('metal', [-W, yR - 0.3, -0.08], [W, yR - 0.1, 0.08], '#5d6a6c');
  const yE = gableRoof(l, b, h, pitch, over, m.roof, {
    wallKey: 'wall',
    wall: m.walls,
    inner: true,
  });
  for (const s of [1, -1]) gutter(l, b, s * (D + over), yE);
}

/** One farm building into its frame. */
export function buildFarm(
  l: Local,
  b: BuildingDef,
  m: FarmModel,
  site: Site,
): void {
  ({ hall, barn, house, block, shed })[m.kind](l, b, m, site);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
