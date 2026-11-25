import { Group, Matrix4, ShapeUtils, Vector2 } from 'three';
import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { World } from '../../../world/world';
import { Bucket, Frame } from '../../ajvatovci/start-row/build/kit';
import type { MatKey } from '../../ajvatovci/start-row/build/materials';
import shapes from './kew-shapes.json';
import {
  KEW_STYLES,
  type BlockStyle,
  type HouseStyle,
  type KewStyle,
} from './kew-styles';

/**
 * The buildings seen from the parkway at the Kew Gardens end, each from its own record: the city's 3-D building model
 * (NYC 3-D Building Model, 2014 survey: every wall and roof of the building, kew-shapes.json) dressed as in the drive
 * video (kew-styles.ts) - brick tinted per building, windows cut into the walls with reveals, sashes, sills, air
 * conditioners, string courses, cornices and copings, steel fire escapes, stacked balconies, glass curtain walls, and
 * Tudor houses with half-timbered gables under red tile roofs. They replace the footprint boxes under them.
 */

type V3 = [number, number, number];
type P2 = [number, number];

interface Shape {
  bin: number;
  address: string;
  /** NAVD88 height of the building's lowest ground point (m). */
  ground: number;
  /** Ground ring, flat x, z, h. */
  foot: number[];
  /** Min-area rectangle of the ring: centre x, z, long side, short side, direction of the long side (rad). */
  rect: number[];
  /** Wall / roof polygons, flat x, z, h (h above `ground`). */
  walls: number[][];
  roofs: number[][];
}

interface Building {
  shape: Shape;
  style: KewStyle;
  ring: P2[];
  /** Game height of the shape's h = 0. */
  base: number;
}

const SHAPES = shapes as Shape[];
/** Below the lowest ground point the walls reach this far down (the terrain under a building is not level). */
const FOOT = 2.5;
/** Window reveal depth (m). */
const REVEAL = 0.2;
/** Roof surface below the parapet top (m). */
const PARAPET = 0.7;

function ringOf(s: Shape): P2[] {
  const r: P2[] = [];
  for (let i = 0; i < s.foot.length; i += 3) r.push([s.foot[i], s.foot[i + 1]]);
  return r;
}

function inside(x: number, z: number, r: P2[]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[j];
    if (z0 > z !== z1 > z && x < x0 + ((z - z0) * (x1 - x0)) / (z1 - z0))
      ins = !ins;
  }
  return ins;
}

function distToRing(x: number, z: number, r: P2[]): number {
  if (inside(x, z, r)) return 0;
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j];
    const [bx, bz] = r[i];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}

const BUILDINGS: { shape: Shape; style: KewStyle; ring: P2[] }[] =
  SHAPES.filter((s) => KEW_STYLES[s.bin]).map((s) => ({
    shape: s,
    style: KEW_STYLES[s.bin],
    ring: ringOf(s),
  }));

/** Game height of the survey's h = 0 for a building: its ring points laid on the game terrain (median, robust). */
function baseOf(s: Shape, ground: TerrainSampler): number {
  const d: number[] = [];
  for (let i = 0; i < s.foot.length; i += 3)
    d.push(ground.height(s.foot[i], s.foot[i + 1]) - s.foot[i + 2]);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** Bearing (deg, 0 = north, 90 = east) of a horizontal outward normal (x east, z south). */
const bearingOf = (nx: number, nz: number): number =>
  ((Math.atan2(nx, -nz) * 180) / Math.PI + 360) % 360;
const near = (a: number, b: number, tol: number): boolean =>
  Math.abs(((a - b + 540) % 360) - 180) <= tol;

// ---------------------------------------------------------------------------------------------------------------
// A wall plane: local frame x = along the wall (s), y = up (h above the building's 0), z = out of the wall.

interface Piece {
  /** Outline in (s, h). */
  pts: P2[];
  s0: number;
  s1: number;
  /** Highest bottom / lowest top over the piece (the band every window must fit in). */
  bot: number;
  top: number;
  /** Bottom on the ground (extended under it). */
  grounded: boolean;
}

interface Plane {
  nx: number;
  nz: number;
  bearing: number;
  /** World x, z of s = 0 on the plane. */
  ox: number;
  oz: number;
  pieces: Piece[];
  s0: number;
  s1: number;
  m: Matrix4;
}

function planesOf(s: Shape, base: number): Plane[] {
  const planes = new Map<string, Plane>();
  for (const w of s.walls) {
    const P: V3[] = [];
    for (let i = 0; i < w.length; i += 3) P.push([w[i], w[i + 1], w[i + 2]]);
    // Newell normal (x, h, z); the survey's walls wind outwards.
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const c = P[(i + 1) % P.length];
      nx += (a[2] - c[2]) * (a[1] + c[1]);
      nz += (a[0] - c[0]) * (a[2] + c[2]);
    }
    const l = Math.hypot(nx, nz);
    if (l < 1e-6) continue;
    nx /= l;
    nz /= l;
    const off = P[0][0] * nx + P[0][1] * nz;
    const ang = Math.round(Math.atan2(nz, nx) * 90);
    const key = `${ang},${Math.round(off * 4)}`;
    let pl = planes.get(key);
    if (!pl) {
      // Local x = (nz, -nx) so that (x, y, z = n) is right-handed.
      const ox = P[0][0];
      const oz = P[0][1];
      const m = new Matrix4().set(
        nz,
        0,
        nx,
        ox,
        0,
        1,
        0,
        base,
        -nx,
        0,
        nz,
        oz,
        0,
        0,
        0,
        1,
      ); // fmt: skip
      pl = {
        nx,
        nz,
        bearing: bearingOf(nx, nz),
        ox,
        oz,
        pieces: [],
        s0: Infinity,
        s1: -Infinity,
        m,
      };
      planes.set(key, pl);
    }
    const pts: P2[] = P.map(([x, z, h]) => [
      (x - pl.ox) * pl.nz - (z - pl.oz) * pl.nx,
      h,
    ]);
    const ss = pts.map((p) => p[0]);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    if (s1 - s0 < 0.05) continue;
    // Bottom / top lines: the lowest / highest point at each end.
    const ends = (sv: number) => pts.filter((p) => Math.abs(p[0] - sv) < 0.02);
    const lo = (q: P2[]) => Math.min(...q.map((p) => p[1]));
    const hi = (q: P2[]) => Math.max(...q.map((p) => p[1]));
    const a = ends(s0);
    const b = ends(s1);
    const bot = Math.max(lo(a), lo(b));
    const top = Math.min(hi(a), hi(b));
    const grounded = Math.min(lo(a), lo(b)) < 3.5;
    const out: P2[] = grounded
      ? pts.map(([sv, h]) => [sv, h < bot + 0.3 && h < 3.5 ? -FOOT : h])
      : pts;
    pl.pieces.push({ pts: out, s0, s1, bot, top, grounded });
    pl.s0 = Math.min(pl.s0, s0);
    pl.s1 = Math.max(pl.s1, s1);
  }
  return [...planes.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Emit helpers (local plane coordinates, `m` = the plane matrix).

class Out {
  constructor(readonly f: Frame) {}

  /** Convex polygon facing `want` (local), UVs in metres from (x, y) or (x, z) for horizontal faces. */
  poly(
    key: MatKey,
    pts: V3[],
    color: string,
    want: V3,
    m: Matrix4,
    uv?: P2[],
  ): void {
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[0];
      let b = pts[i];
      let c = pts[i + 1];
      const ua = uv ? uv[0] : uvOf(a, want);
      let ub = uv ? uv[i] : uvOf(b, want);
      let uc = uv ? uv[i + 1] : uvOf(c, want);
      const n = cross(sub(b, a), sub(c, a));
      if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
        [b, c] = [c, b];
        [ub, uc] = [uc, ub];
      }
      this.f.tri(key, a, b, c, color, [ua, ub, uc], {
        matrix: m,
        rawUv: !!uv,
      });
    }
  }

  box(key: MatKey, a: V3, b: V3, color: string, m: Matrix4): void {
    this.f.box(key, a, b, color, { matrix: m });
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const uvOf = (p: V3, n: V3): P2 =>
  Math.abs(n[1]) > 0.7
    ? [p[0], p[2]]
    : Math.abs(n[0]) > 0.7
      ? [p[2], p[1]]
      : [p[0], p[1]];

/** A flat wall piece (s, h outline with rectangular holes) on the plane, facing out (+z). */
function panel(
  o: Out,
  key: MatKey,
  outline: P2[],
  holes: P2[][],
  color: string,
  m: Matrix4,
  z = 0,
): void {
  const faces = ShapeUtils.triangulateShape(
    outline.map(([s, h]) => new Vector2(s, h)),
    holes.map((q) => q.map(([s, h]) => new Vector2(s, h))),
  );
  const all = [...outline, ...holes.flat()];
  for (const [i, j, k] of faces) {
    const t = [all[i], all[j], all[k]].map(([s, h]): V3 => [s, h, z]);
    o.poly(key, t, color, [0, 0, 1], m);
  }
}

const shade = (hex: string, k: number): string => {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.max(0, Math.min(255, Math.round(x * k))),
  );
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};

// ---------------------------------------------------------------------------------------------------------------
// Blocks.

interface Win {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

/** Floor lines (h of each floor's floor) up to `top`. */
function floorLines(st: BlockStyle, top: number): number[] {
  const out = [0];
  for (let y = st.ground; y + st.floor <= top + 0.2; y += st.floor) out.push(y);
  return out;
}

/** Window columns across a plane: centres of each window. */
function columns(st: BlockStyle, s0: number, s1: number): number[] {
  const len = s1 - s0;
  const n = Math.floor((len - 0.8) / st.win.bay);
  if (n < 1) return len > st.win.w + 0.8 ? [(s0 + s1) / 2] : [];
  const start = s0 + (len - n * st.win.bay) / 2;
  const pair = st.win.pair ?? 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + (i + 0.5) * st.win.bay;
    for (let k = 0; k < pair; k++)
      out.push(c + (k - (pair - 1) / 2) * (st.win.w + 0.3));
  }
  return out;
}

function buildBlock(o: Out, b: Building, st: BlockStyle): void {
  const s = b.shape;
  const planes = planesOf(s, b.base);
  const h = (i: number, j: number) => hash3(s.bin, i, j, 7341) / 4294967296;
  const wallKey: MatKey =
    st.wall === 'brick'
      ? 'paleBrick'
      : st.wall === 'render'
        ? 'render'
        : 'glass';
  const topAll = Math.max(
    ...s.roofs.flatMap((r) => r.filter((_, i) => i % 3 === 2)),
  );
  let pi = 0;
  for (const pl of planes) {
    pi++;
    const m = pl.m;
    if (st.wall === 'glass') {
      curtain(o, pl, st, m);
      continue;
    }
    // Facade with windows: one grid per plane, each window kept where a piece holds it whole.
    const lines = floorLines(st, topAll);
    const cols = columns(st, pl.s0, pl.s1);
    const fire = (st.fire ?? [])
      .filter((f) => near(f.face, pl.bearing, 25) && pl.s1 - pl.s0 > 8)
      .flatMap((f) => f.at.map((t) => pl.s0 + (pl.s1 - pl.s0) * t));
    for (const [qi, pc] of pl.pieces.entries()) {
      const wins: Win[] = [];
      for (const [fi, y] of lines.entries()) {
        const y0 = y + (fi === 0 ? Math.max(st.win.sill, 1.0) : st.win.sill);
        const y1 = y0 + st.win.h;
        if (y0 < pc.bot + 0.3 || y1 > pc.top - 0.5) continue;
        for (const c of cols) {
          const w0 = c - st.win.w / 2;
          const w1 = c + st.win.w / 2;
          if (w0 < pc.s0 + 0.35 || w1 > pc.s1 - 0.35) continue;
          wins.push({ s0: w0, s1: w1, y0, y1 });
        }
      }
      panel(
        o,
        wallKey,
        pc.pts,
        wins.map((w) => [
          [w.s0, w.y0],
          [w.s1, w.y0],
          [w.s1, w.y1],
          [w.s0, w.y1],
        ]),
        st.tint,
        m,
      );
      for (const [wi, w] of wins.entries())
        window_(o, st, w, m, h(pi * 997 + qi, wi));
      // Parapet: inner face, coping and cornice along the top.
      const top = pc.top;
      o.poly(
        wallKey,
        [
          [pc.s0, top - PARAPET - 0.05, -0.25],
          [pc.s1, top - PARAPET - 0.05, -0.25],
          [pc.s1, top, -0.25],
          [pc.s0, top, -0.25],
        ],
        shade(st.tint, 0.8),
        [0, 0, -1],
        m,
      );
      o.box(
        'paint',
        [pc.s0 - 0.05, top - 0.12, -0.3],
        [pc.s1 + 0.05, top + 0.06, 0.06],
        st.coping,
        m,
      );
      if (st.cornice && pc.top > topAll - 4) {
        o.box(
          'paint',
          [pc.s0, top - 0.75, 0],
          [pc.s1, top - 0.45, 0.32],
          st.cornice,
          m,
        );
        o.box(
          'paint',
          [pc.s0, top - 0.95, 0],
          [pc.s1, top - 0.75, 0.16],
          shade(st.cornice, 0.9),
          m,
        );
      }
      for (const y of st.bands?.at ?? [])
        if (y > pc.bot + 0.2 && y < pc.top - 1)
          o.box(
            'paint',
            [pc.s0, y - 0.12, 0],
            [pc.s1, y + 0.08, 0.05],
            st.bands!.color,
            m,
          );
    }
    for (const c of fire) fireEscape(o, lines, c, topAll, m);
    if (st.balconies?.faces.some((f) => near(f, pl.bearing, 25)))
      balconies(o, st, pl, lines, topAll, m);
  }
  roofs(o, s, b.base, st.roof, st.wall === 'glass' ? 0.4 : PARAPET);
}

/** One double-hung window in its hole: reveals, sashes and glass, sill, lintel, sometimes an air conditioner. */
function window_(o: Out, st: BlockStyle, w: Win, m: Matrix4, r: number): void {
  const { s0, s1, y0, y1 } = w;
  const d = -REVEAL;
  const rc = shade(st.tint, 0.82);
  // Reveals (facing into the opening).
  o.poly(
    'paleBrick',
    [
      [s0, y0, 0],
      [s0, y1, 0],
      [s0, y1, d],
      [s0, y0, d],
    ],
    rc,
    [1, 0, 0],
    m,
  );
  o.poly(
    'paleBrick',
    [
      [s1, y0, 0],
      [s1, y1, 0],
      [s1, y1, d],
      [s1, y0, d],
    ],
    rc,
    [-1, 0, 0],
    m,
  );
  o.poly(
    'paleBrick',
    [
      [s0, y1, 0],
      [s1, y1, 0],
      [s1, y1, d],
      [s0, y1, d],
    ],
    shade(rc, 0.7),
    [0, -1, 0],
    m,
  );
  o.poly(
    'paint',
    [
      [s0, y0, 0],
      [s1, y0, 0],
      [s1, y0, d],
      [s0, y0, d],
    ],
    st.sill ?? rc,
    [0, 1, 0],
    m,
  );
  // Glass (one pane texture over the window), a little different behind each (blinds, curtains).
  const g = r < 0.18 ? '#d9d2c2' : r < 0.3 ? '#b9b2a6' : '#ffffff';
  o.poly(
    'glass',
    [
      [s0, y0, d],
      [s1, y0, d],
      [s1, y1, d],
      [s0, y1, d],
    ],
    g,
    [0, 0, 1],
    m,
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
  // Sashes: frame round the opening and the meeting rail (lower sash a touch proud).
  const f = 0.055;
  const z = d + 0.04;
  const fc = st.frame;
  o.box('paint', [s0, y0, d], [s1, y0 + f, z], fc, m);
  o.box('paint', [s0, y1 - f, d], [s1, y1, z], fc, m);
  o.box('paint', [s0, y0, d], [s0 + f, y1, z], fc, m);
  o.box('paint', [s1 - f, y0, d], [s1, y1, z], fc, m);
  const ym = (y0 + y1) / 2;
  o.box('paint', [s0, ym - 0.035, d], [s1, ym + 0.035, z + 0.02], fc, m);
  if (s1 - s0 > 1.1)
    o.box(
      'paint',
      [(s0 + s1) / 2 - 0.03, y0, d],
      [(s0 + s1) / 2 + 0.03, y1, z],
      fc,
      m,
    );
  // Stone sill and lintel.
  if (st.sill)
    o.box(
      'paint',
      [s0 - 0.08, y0 - 0.09, 0],
      [s1 + 0.08, y0 + 0.01, 0.07],
      st.sill,
      m,
    );
  if (st.lintel)
    o.box(
      'paleBrick',
      [s0 - 0.1, y1, 0],
      [s1 + 0.1, y1 + 0.22, 0.02],
      st.lintel,
      m,
    );
  // Window air conditioner in the lower sash, sticking out over the sill.
  if (st.ac && r > 1 - st.ac) {
    const c = (s0 + s1) / 2;
    o.box(
      'paint',
      [c - 0.32, y0 + 0.02, d + 0.05],
      [c + 0.32, y0 + 0.42, 0.38],
      r > 0.97 ? '#b9b6ae' : '#e2dfd6',
      m,
    );
    o.box(
      'paint',
      [c - 0.3, y0 + 0.08, 0.38],
      [c + 0.3, y0 + 0.36, 0.39],
      '#8f8c86',
      m,
    );
  }
}

/** Glass curtain wall: pane colour per face, mullions and floor spandrels. */
function curtain(o: Out, pl: Plane, st: BlockStyle, m: Matrix4): void {
  const light =
    st.light && st.light.bearings.some((b) => near(b, pl.bearing, 12));
  const tint = light ? st.light!.tint : st.tint;
  for (const pc of pl.pieces) {
    const uv = pc.pts.map(([sv, hv]): P2 => [sv / st.win.bay, hv / st.floor]);
    o.poly(
      'glass',
      pc.pts.map(([sv, hv]): V3 => [sv, hv, 0]),
      tint,
      [0, 0, 1],
      m,
      uv,
    );
    // Mullions on the pane grid, spandrels at each floor.
    const y0 = Math.max(pc.bot, 0);
    for (
      let sv = Math.ceil(pc.s0 / st.win.bay) * st.win.bay;
      sv < pc.s1 - 0.05;
      sv += st.win.bay
    )
      o.box(
        'metal',
        [sv - 0.03, y0, 0],
        [sv + 0.03, pc.top, 0.07],
        st.frame,
        m,
      );
    for (let y = st.ground; y < pc.top - 0.3; y += st.floor)
      if (y > pc.bot)
        o.box(
          'metal',
          [pc.s0, y - 0.25, 0],
          [pc.s1, y + 0.05, 0.05],
          shade(st.frame, 1.1),
          m,
        );
    o.box(
      'paint',
      [pc.s0, pc.top - 0.3, -0.25],
      [pc.s1, pc.top + 0.05, 0.1],
      st.coping,
      m,
    );
  }
}

/** Steel fire escape: a landing at each floor from the second up, railings, stairs between, a drop ladder. */
function fireEscape(
  o: Out,
  lines: number[],
  c: number,
  top: number,
  m: Matrix4,
): void {
  const W = 3.4;
  const D = 1.05;
  const col = '#2a2a2a';
  const a = c - W / 2;
  const b = c + W / 2;
  const floors = lines.filter((y, i) => i >= 1 && y < top - 2);
  for (const [k, y] of floors.entries()) {
    o.box('metal', [a, y - 0.06, 0.02], [b, y, D], col, m);
    // Railing: top and middle rails, balusters.
    for (const [y1, t] of [
      [y + 0.95, 0.04],
      [y + 0.45, 0.025],
    ] as [number, number][]) {
      o.box('metal', [a, y1 - t, D - 0.04], [b, y1, D], col, m);
      o.box('metal', [a, y1 - t, 0.02], [a + 0.04, y1, D], col, m);
      o.box('metal', [b - 0.04, y1 - t, 0.02], [b, y1, D], col, m);
    }
    for (let x = a; x <= b + 0.01; x += 0.34)
      o.box(
        'metal',
        [x - 0.012, y, D - 0.03],
        [x + 0.012, y + 0.95, D - 0.006],
        col,
        m,
      );
    for (const x of [a, b])
      for (let zz = 0.3; zz < D; zz += 0.34)
        o.box(
          'metal',
          [x - 0.012, y, zz - 0.012],
          [x + 0.012, y + 0.95, zz + 0.012],
          col,
          m,
        );
    // Stair down to the landing below (alternating direction), or the drop ladder from the lowest one.
    const below = k === 0 ? undefined : floors[k - 1];
    if (below === undefined) {
      const lx = k % 2 ? b - 0.6 : a + 0.2;
      o.box('metal', [lx, y - 2.4, D - 0.45], [lx + 0.04, y, D - 0.41], col, m);
      o.box(
        'metal',
        [lx + 0.4, y - 2.4, D - 0.45],
        [lx + 0.44, y, D - 0.41],
        col,
        m,
      );
      for (let yy = y - 2.3; yy < y; yy += 0.3)
        o.box(
          'metal',
          [lx, yy, D - 0.45],
          [lx + 0.44, yy + 0.025, D - 0.41],
          col,
          m,
        );
      continue;
    }
    const rise = y - below;
    const dir = k % 2 ? 1 : -1;
    const run = W - 0.9;
    const len = Math.hypot(run, rise);
    const ang = Math.atan2(rise, run) * dir;
    const sx = dir > 0 ? a + 0.25 : b - 0.25;
    const rot = new Matrix4()
      .makeTranslation(sx, below, 0)
      .multiply(new Matrix4().makeRotationZ(ang));
    const mm = m.clone().multiply(rot);
    const along = (u: number): number => u * dir;
    for (const zz of [0.12, 0.62]) {
      const [u0, u1] = [along(0), along(len)].sort((p, q) => p - q);
      o.box('metal', [u0, -0.12, zz], [u1, 0.02, zz + 0.04], col, mm);
      o.box('metal', [u0, 0.85, zz], [u1, 0.88, zz + 0.03], col, mm);
    }
    for (let u = 0.25; u < len - 0.1; u += 0.28) {
      const [u0, u1] = [along(u), along(u + 0.2)].sort((p, q) => p - q);
      o.box('metal', [u0, -0.02, 0.16], [u1, 0, 0.62], col, mm);
    }
  }
}

/** Stacked balconies across a face: a concrete slab and a solid white rail panel per floor. */
function balconies(
  o: Out,
  st: BlockStyle,
  pl: Plane,
  lines: number[],
  top: number,
  m: Matrix4,
): void {
  const bal = st.balconies!;
  for (const pc of pl.pieces) {
    if (pc.s1 - pc.s0 < 4) continue;
    const a = pc.s0 + 0.4;
    const b = pc.s1 - 0.4;
    for (const [i, y] of lines.entries()) {
      if (i < bal.from || y < pc.bot + 1 || y > pc.top - 2.5 || y > top - 3)
        continue;
      o.box('paint', [a, y - 0.18, 0], [b, y, 1.4], '#d8d4ca', m);
      o.box('paint', [a, y, 1.34], [b, y + 1.0, 1.4], bal.rail, m);
      o.box('paint', [a, y, 0], [a + 0.06, y + 1.0, 1.4], bal.rail, m);
      o.box('paint', [b - 0.06, y, 0], [b, y + 1.0, 1.4], bal.rail, m);
    }
  }
}

/** Flat roofs a parapet below the wall tops (tar or white coated), each the survey's roof outline. */
function roofs(
  o: Out,
  s: Shape,
  base: number,
  color: string,
  drop: number,
): void {
  for (const r of s.roofs) {
    const pts: Vector2[] = [];
    let y = 0;
    for (let i = 0; i < r.length; i += 3) {
      pts.push(new Vector2(r[i], r[i + 1]));
      y += r[i + 2];
    }
    y /= r.length / 3;
    if (pts.length < 3) continue;
    o.f.polygon('roofing', pts, base + y - drop, color);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tudor houses: the footprint's rectangle, walls to the eaves, a hipped tile roof to the survey's ridge, a cross gable
// to the street with half-timbering.

function buildHouse(o: Out, b: Building, st: HouseStyle): void {
  const s = b.shape;
  const [cx, cz, W, D, ang] = s.rect;
  const ridge = Math.max(
    ...s.roofs.flatMap((r) => r.filter((_, i) => i % 3 === 2)),
  );
  const E = Math.min(st.eaves, ridge - 2.5);
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  // Local frame: x along the long side, z across (+z = the side facing `front` or the nearer of the two), y up.
  const nzx = -sn;
  const nzz = c;
  const flip = near(bearingOf(nzx, nzz), st.front, 90) ? 1 : -1;
  const m = new Matrix4().set(
    c * flip,
    0,
    -sn * flip,
    cx,
    0,
    1,
    0,
    b.base,
    sn * flip,
    0,
    c * flip,
    cz,
    0,
    0,
    0,
    1,
  ); // fmt: skip
  const hw = W / 2;
  const hd = D / 2;
  const h = (i: number) => hash3(s.bin, i, 3, 911) / 4294967296;
  const split = 3.1;
  // Walls: four faces with windows (casement pairs), brick below `split`, stucco / brick above.
  const faces: { len: number; mk: Matrix4 }[] = [
    { len: W, mk: m.clone().multiply(new Matrix4().makeTranslation(0, 0, hd)) },
    {
      len: W,
      mk: m
        .clone()
        .multiply(new Matrix4().makeRotationY(Math.PI).setPosition(0, 0, -hd)),
    },
    {
      len: D,
      mk: m
        .clone()
        .multiply(
          new Matrix4().makeRotationY(Math.PI / 2).setPosition(hw, 0, 0),
        ),
    },
    {
      len: D,
      mk: m
        .clone()
        .multiply(
          new Matrix4().makeRotationY(-Math.PI / 2).setPosition(-hw, 0, 0),
        ),
    },
  ];
  for (const [fi, f] of faces.entries()) {
    const L = f.len / 2;
    const n = Math.max(1, Math.floor((f.len - 1.5) / 3.2));
    const wins: Win[] = [];
    for (let i = 0; i < n; i++) {
      const cxw = -L + (f.len / n) * (i + 0.5);
      const ww = fi < 2 && h(fi * 10 + i) > 0.5 ? 1.5 : 1.0;
      wins.push({ s0: cxw - ww / 2, s1: cxw + ww / 2, y0: 0.9, y1: 2.35 });
      wins.push({
        s0: cxw - ww / 2,
        s1: cxw + ww / 2,
        y0: split + 0.75,
        y1: split + 2.0,
      });
    }
    const lower = wins.filter((w) => w.y1 < split);
    const upper = wins.filter((w) => w.y0 > split);
    const rect = (w: Win): P2[] => [
      [w.s0, w.y0],
      [w.s1, w.y0],
      [w.s1, w.y1],
      [w.s0, w.y1],
    ];
    panel(
      o,
      'paleBrick',
      [
        [-L, -FOOT],
        [L, -FOOT],
        [L, split],
        [-L, split],
      ],
      lower.map(rect),
      st.brick,
      f.mk,
    );
    const up = st.upper === 'brick' ? st.brick : st.stucco;
    panel(
      o,
      st.upper === 'brick' ? 'paleBrick' : 'render',
      [
        [-L, split],
        [L, split],
        [L, E],
        [-L, E],
      ],
      upper.map(rect),
      up,
      f.mk,
    );
    if (st.upper === 'timber') {
      // Half-timbering: posts between the windows, a rail at the sill, the sole plate.
      o.box(
        'paint',
        [-L, split - 0.05, 0],
        [L, split + 0.12, 0.04],
        st.timber,
        f.mk,
      );
      o.box('paint', [-L, E - 0.18, 0], [L, E, 0.04], st.timber, f.mk);
      for (let x = -L; x <= L + 0.01; x += f.len / Math.max(2, n * 2))
        if (!upper.some((w) => x > w.s0 - 0.12 && x < w.s1 + 0.12))
          o.box(
            'paint',
            [x - 0.08, split, 0],
            [x + 0.08, E, 0.035],
            st.timber,
            f.mk,
          );
    }
    for (const w of wins)
      casement(
        o,
        w,
        st,
        f.mk,
        st.upper === 'brick' || w.y1 < split ? st.brick : st.stucco,
      );
  }
  // Hipped roof over the rectangle, eaves overhang 0.35 m.
  const ov = 0.35;
  const rx = hw + ov;
  const rz = hd + ov;
  const yE = E - 0.25;
  const rise = ridge - yE;
  const ridgeHalf = Math.max(0, hw - hd);
  const tiles = st.tiles;
  const tl = (p: V3[], want: V3, col: string) =>
    o.poly('tiles', p, col, want, m, roofUv(p, want));
  tl(
    [
      [-rx, yE, rz],
      [rx, yE, rz],
      [ridgeHalf, ridge, 0],
      [-ridgeHalf, ridge, 0],
    ],
    [0, 1, 1],
    tiles,
  );
  tl(
    [
      [-rx, yE, -rz],
      [rx, yE, -rz],
      [ridgeHalf, ridge, 0],
      [-ridgeHalf, ridge, 0],
    ],
    [0, 1, -1],
    shade(tiles, 0.92),
  );
  tl(
    [
      [rx, yE, -rz],
      [rx, yE, rz],
      [ridgeHalf, ridge, 0],
    ],
    [1, 1, 0],
    shade(tiles, 0.96),
  );
  tl(
    [
      [-rx, yE, -rz],
      [-rx, yE, rz],
      [-ridgeHalf, ridge, 0],
    ],
    [-1, 1, 0],
    shade(tiles, 0.96),
  );
  // Soffit (underside of the overhang).
  o.poly(
    'paint',
    [
      [-rx, yE, -rz],
      [rx, yE, -rz],
      [rx, yE, rz],
      [-rx, yE, rz],
    ],
    shade(st.stucco, 0.75),
    [0, -1, 0],
    m,
  );
  // Cross gable to the street: steep, as tall as the main ridge, half-timbered face over the front wall.
  const gw = Math.min(W * 0.42, 5.2);
  const gx = (h(77) > 0.5 ? 1 : -1) * Math.max(0, hw - gw / 2 - 0.6);
  const gz = hd + 0.3;
  const peak = ridge - 0.3;
  const back = Math.max(0, hd - (peak - yE) / Math.max(rise / (hd + ov), 0.6));
  // Gable face (triangle above the eaves line) and the wall under it pushed out to gz.
  const face: V3[] = [
    [gx - gw / 2, E - 0.2, gz],
    [gx + gw / 2, E - 0.2, gz],
    [gx, peak - 0.35, gz],
  ];
  o.poly(
    st.upper === 'brick' ? 'paleBrick' : 'render',
    face,
    st.upper === 'brick' ? st.brick : st.stucco,
    [0, 0, 1],
    m,
  );
  o.poly(
    'paleBrick',
    [
      [gx - gw / 2, -FOOT, gz],
      [gx + gw / 2, -FOOT, gz],
      [gx + gw / 2, E - 0.2, gz],
      [gx - gw / 2, E - 0.2, gz],
    ],
    st.brick,
    [0, 0, 1],
    m,
  );
  for (const sx of [-1, 1])
    o.poly(
      'paleBrick',
      [
        [gx + (sx * gw) / 2, -FOOT, hd],
        [gx + (sx * gw) / 2, -FOOT, gz],
        [gx + (sx * gw) / 2, E - 0.2, gz],
        [gx + (sx * gw) / 2, E - 0.2, hd],
      ],
      st.brick,
      [sx, 0, 0],
      m,
    );
  if (st.upper !== 'brick') {
    o.box(
      'paint',
      [gx - 0.07, E - 0.2, gz],
      [gx + 0.07, peak - 0.4, gz + 0.04],
      st.timber,
      m,
    );
    for (const sx of [-1, 1]) {
      const p0: V3 = [gx + (sx * gw) / 2, E - 0.2, gz + 0.02];
      const p1: V3 = [gx, peak - 0.35, gz + 0.02];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const mm = m
        .clone()
        .multiply(
          new Matrix4()
            .makeTranslation(p0[0], p0[1], p0[2])
            .multiply(new Matrix4().makeRotationZ(a)),
        );
      o.box('paint', [0, -0.18, 0], [len, 0, 0.03], st.timber, mm);
      // Diagonal braces.
      const q = Math.atan2(1.2, gw / 4) * -sx;
      const mb = m
        .clone()
        .multiply(
          new Matrix4()
            .makeTranslation(gx + (sx * gw) / 4, E - 0.2, gz + 0.02)
            .multiply(new Matrix4().makeRotationZ(q)),
        );
      o.box('paint', [-0.75, -0.06, 0], [0.75, 0.06, 0.03], st.timber, mb);
    }
  }
  // Gable roof planes: from the gable's rakes back into the main roof.
  for (const sx of [-1, 1]) {
    const e: V3 = [gx + sx * (gw / 2 + 0.25), yE, gz + 0.3];
    const p: V3 = [gx, peak, gz + 0.3];
    const eb: V3 = [gx + sx * (gw / 2 + 0.25), yE, back];
    const pb: V3 = [gx, peak, back];
    tl([e, p, pb, eb], [sx, 1, 0], shade(tiles, sx > 0 ? 0.95 : 1));
  }
  // Chimney.
  const chx = (h(5) > 0.5 ? 1 : -1) * (hw - 0.6);
  o.box(
    'paleBrick',
    [chx - 0.45, E - 1, -0.6],
    [chx + 0.45, ridge + 0.9, 0.2],
    st.brick,
    m,
  );
  o.box(
    'paint',
    [chx - 0.5, ridge + 0.9, -0.65],
    [chx + 0.5, ridge + 1.0, 0.25],
    '#8d8880',
    m,
  );
}

const roofUv = (p: V3[], want: V3): P2[] => {
  // u along the eaves, v up the slope (metres).
  const horiz = Math.abs(want[2]) > Math.abs(want[0]);
  return p.map(([x, y, z]): P2 =>
    horiz ? [x, Math.hypot(y, z)] : [z, Math.hypot(y, x)],
  );
};

function casement(
  o: Out,
  w: Win,
  st: HouseStyle,
  m: Matrix4,
  wallCol: string,
): void {
  const { s0, s1, y0, y1 } = w;
  const d = -0.14;
  const rc = shade(wallCol, 0.8);
  o.poly(
    'paint',
    [
      [s0, y0, 0],
      [s0, y1, 0],
      [s0, y1, d],
      [s0, y0, d],
    ],
    rc,
    [1, 0, 0],
    m,
  );
  o.poly(
    'paint',
    [
      [s1, y0, 0],
      [s1, y1, 0],
      [s1, y1, d],
      [s1, y0, d],
    ],
    rc,
    [-1, 0, 0],
    m,
  );
  o.poly(
    'paint',
    [
      [s0, y1, 0],
      [s1, y1, 0],
      [s1, y1, d],
      [s0, y1, d],
    ],
    shade(rc, 0.7),
    [0, -1, 0],
    m,
  );
  o.poly(
    'paint',
    [
      [s0, y0, 0],
      [s1, y0, 0],
      [s1, y0, d],
      [s0, y0, d],
    ],
    '#cfc8b8',
    [0, 1, 0],
    m,
  );
  o.poly(
    'glass',
    [
      [s0, y0, d],
      [s1, y0, d],
      [s1, y1, d],
      [s0, y1, d],
    ],
    '#ffffff',
    [0, 0, 1],
    m,
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
  const f = 0.05;
  const z = d + 0.035;
  o.box('paint', [s0, y0, d], [s1, y0 + f, z], st.frame, m);
  o.box('paint', [s0, y1 - f, d], [s1, y1, z], st.frame, m);
  o.box('paint', [s0, y0, d], [s0 + f, y1, z], st.frame, m);
  o.box('paint', [s1 - f, y0, d], [s1, y1, z], st.frame, m);
  // Casement leaves: a mullion per 0.5 m and a transom.
  const n = Math.max(2, Math.round((s1 - s0) / 0.5));
  for (let i = 1; i < n; i++) {
    const x = s0 + ((s1 - s0) * i) / n;
    o.box('paint', [x - 0.025, y0, d], [x + 0.025, y1, z], st.frame, m);
  }
  const yt = y1 - (y1 - y0) * 0.28;
  o.box('paint', [s0, yt - 0.025, d], [s1, yt + 0.025, z], st.frame, m);
  o.box(
    'paint',
    [s0 - 0.06, y0 - 0.08, 0],
    [s1 + 0.06, y0, 0.06],
    '#cfc8b8',
    m,
  );
}

// ---------------------------------------------------------------------------------------------------------------

function* build(world: World): Generator<void, Group> {
  const bucket = new Bucket();
  for (const b of BUILDINGS) {
    const base = baseOf(b.shape, world.analytic);
    const tile = `kew ${Math.floor(b.shape.rect[0] / 128)},${Math.floor(b.shape.rect[1] / 128)}`;
    const o = new Out(new Frame(bucket, tile, undefined, { x: 0, z: 0 }));
    const bb: Building = { ...b, base };
    if (b.style.type === 'house') buildHouse(o, bb, b.style);
    else buildBlock(o, bb, b.style);
    yield;
  }
  return bucket.build('kew-buildings');
}

function colliders(ground: TerrainSampler): StaticCollider[] {
  return BUILDINGS.map((b) => {
    const [x, z, w, d, ang] = b.shape.rect;
    const y = baseOf(b.shape, ground) - FOOT;
    const top = Math.max(
      ...b.shape.roofs.flatMap((r) => r.filter((_, i) => i % 3 === 2)),
    );
    return {
      kind: 'box',
      x,
      z,
      y,
      h: top + FOOT,
      hx: w / 2,
      hz: d / 2,
      rot: -ang,
      r: Math.hypot(w, d) / 2,
    } satisfies StaticCollider;
  });
}

export const kewBuildingsLandmark: Landmark = {
  id: 'jackie-2-kew-buildings',
  occupies: (x, z, margin) =>
    BUILDINGS.some((b) => distToRing(x, z, b.ring) <= margin),
  // The footprint boxes of the city bake under these buildings.
  replaces: (b) => BUILDINGS.some((k) => inside(b.x, b.z, k.ring)),
  colliders,
  instances: () => [],
  build,
};

/** For tests: the buildings drawn (BIN, address) and how many have a record. */
export const KEW_BUILDINGS = BUILDINGS.map((b) => ({
  bin: b.shape.bin,
  address: b.shape.address,
  type: b.style.type,
}));
