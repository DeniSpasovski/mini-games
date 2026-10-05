import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Texture,
} from 'three';
import {
  advisoryPlateTexture,
  clearancePlateTexture,
  feetInches,
  namePlateTexture,
} from '../engine/structure-textures';
import { getTexture } from '../engine/textures';
import { DECK_OVERHANG, PARAPET_H, PARAPET_T, SLAB_T } from './portals';
import { newPathQuery } from './real-data';
import { newRoadQuery } from './road';
import { getRoadMaterial, pathTexture, texLength } from './road-mesh';
import { STREET_KINDS } from './street-detail';
import { DECK_DEPTH } from './terrain-gen';
import type { World } from './world';

/**
 * Bridge geometry. Stage-road bridge spans and the elevated decks of other roads (OSM bridge=yes:
 * overpasses, ramps, the interchange) share one detailed bridge builder:
 *
 * - the deck: fascia girders, a recessed soffit with a row of beams (seen from the road below), stone
 *   parapets with pilasters (decks of other roads), dark expansion joints across the road at both ends;
 * - abutments: a stone-faced wall under each deck end from the ground up to the soffit, with returns that
 *   taper into the slope, and wing walls retaining the approach fill beside the road;
 * - piers (decks of other roads): a column with a cap beam, drawn here, solid via World.piers.
 *
 * The road surface of a stage-road span is drawn by road-mesh on the deck; decks of other roads get
 * their own surface here. Everything is swept from rows of cross sections along a centreline; every strip
 * has its own vertices (flat shaded). Double-sided materials, so winding does not matter.
 */

/** Depth of the girder / fascia under the deck surface (m). */
const GIRDER = DECK_DEPTH;
/** Slab overhang beyond the road edge (m) and parapet size (portals.ts: the colliders use the same). */
const OVERHANG = DECK_OVERHANG;
const STEP = 3;
/** Beam spacing under the deck (m) and beam width. */
const BEAM_GAP = 2.2;
const BEAM_W = 0.4;
/** Abutment return length beyond the deck edge (tapers into the slope) and wing wall length along the road (m). */
const RETURN_L = 5;
const WING_L = 10;
/** Stone texture repeat (m). */
const STONE_TS = 2;
/** Concrete texture repeat (m). */
const CONC_TS = 4;

let materials:
  | {
      stone: MeshStandardMaterial;
      concrete: MeshStandardMaterial;
      metal: MeshStandardMaterial;
    }
  | undefined;
export function bridgeMaterials() {
  return (materials ??= {
    // Railings, posts, fence frames: vertex colour only.
    metal: new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.55,
      side: DoubleSide,
    }),
    stone: new MeshStandardMaterial({
      map: getTexture('bridge_stone'),
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      side: DoubleSide,
    }),
    concrete: new MeshStandardMaterial({
      map: getTexture('bridge_concrete'),
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      side: DoubleSide,
    }),
  });
}

export interface Row {
  x: number;
  y: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Distance along (m). */
  d: number;
  /** Half width of the road surface. */
  hw: number;
}

export type RGB = [number, number, number];
/** Section point: lateral offset = off + frac * halfWidth (+ = left), dy relative to the row height. */
export type SP = [off: number, dy: number, frac: number];

export class Builder {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  constructor(private readonly ts: number) {}

  /** Sweep the segment a -> b of a cross section along `rows`. `wall`: uv = (along, height), else (across, along). */
  strip(rows: Row[], a: SP, b: SP, color: RGB, wall = true): void {
    const v0 = this.pos.length / 3;
    for (const r of rows) {
      for (const [off, dy, frac] of [a, b]) {
        const l = off + frac * r.hw;
        const y = r.y + dy;
        this.pos.push(r.x + r.tz * l, y, r.z - r.tx * l);
        this.col.push(...color);
        if (wall) this.uv.push(r.d / this.ts, y / this.ts);
        else this.uv.push(l / this.ts, r.d / this.ts);
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const p = v0 + i * 2;
      this.idx.push(p, p + 2, p + 3, p, p + 3, p + 1);
    }
  }

  /** A vertical wall along a polyline: per point (x, z, bottom, top); uv = (length, height). */
  wall(
    pts: { x: number; z: number; bot: number; top: number }[],
    color: RGB,
  ): void {
    if (pts.length < 2) return;
    const v0 = this.pos.length / 3;
    let len = 0;
    pts.forEach((p, i) => {
      if (i) len += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      for (const y of [p.bot, p.top]) {
        this.pos.push(p.x, y, p.z);
        this.col.push(...color);
        this.uv.push(len / this.ts, y / this.ts);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const p = v0 + i * 2;
      this.idx.push(p, p + 2, p + 3, p, p + 3, p + 1);
    }
  }

  /** Box aligned to the tangent (tx, tz): half sizes along / across, from y0 to y1. */
  box(
    cx: number,
    cz: number,
    tx: number,
    tz: number,
    hl: number,
    hn: number,
    y0: number,
    y1: number,
    color: RGB,
  ): void {
    const nx = tz;
    const nz = -tx;
    const P = (u: number, v: number, y: number): [number, number, number] => [
      cx + tx * u + nx * v,
      y,
      cz + tz * u + nz * v,
    ];
    const faces: [number, number][][] = [
      [
        [hl, -hn],
        [hl, hn],
      ],
      [
        [hl, hn],
        [-hl, hn],
      ],
      [
        [-hl, hn],
        [-hl, -hn],
      ],
      [
        [-hl, -hn],
        [hl, -hn],
      ],
    ];
    for (const [a, b] of faces) {
      const v0 = this.pos.length / 3;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const q = [
        { p: P(a[0], a[1], y0), u: 0, v: y0 },
        { p: P(b[0], b[1], y0), u: len, v: y0 },
        { p: P(b[0], b[1], y1), u: len, v: y1 },
        { p: P(a[0], a[1], y1), u: 0, v: y1 },
      ];
      for (const { p, u, v } of q) {
        this.pos.push(...p);
        this.col.push(...color);
        this.uv.push(u / this.ts, v / this.ts);
      }
      this.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
    // Top (and an underside, for cap beams seen from below).
    for (const y of [y1, y0]) {
      const v0 = this.pos.length / 3;
      for (const [u, v] of [
        [-hl, -hn],
        [hl, -hn],
        [hl, hn],
        [-hl, hn],
      ]) {
        this.pos.push(...P(u, v, y));
        this.col.push(...color);
        this.uv.push(u / this.ts, v / this.ts);
      }
      this.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  }

  empty(): boolean {
    return this.idx.length === 0;
  }

  build(mat: Material): Mesh {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.pos), 3),
    );
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

const CONC: RGB = [0.82, 0.8, 0.77];
const SOFFIT: RGB = [0.42, 0.41, 0.4];
const BEAM: RGB = [0.62, 0.61, 0.59];
export const STONE: RGB = [0.95, 0.92, 0.86];
const JOINT: RGB = [0.1, 0.1, 0.11];

/** The builders that make one bridge (stone + concrete faces, metal railings). */
export class Parts {
  stone = new Builder(STONE_TS);
  conc = new Builder(CONC_TS);
  metal = new Builder(1);
  add(group: Group): void {
    const m = bridgeMaterials();
    if (!this.stone.empty()) group.add(this.stone.build(m.stone));
    if (!this.conc.empty()) group.add(this.conc.build(m.concrete));
    if (!this.metal.empty()) group.add(this.metal.build(m.metal));
  }
}

/** Textured plates (signs on a headwall): one mesh per texture. */
export class Plates {
  private geo = new Map<
    Texture,
    { pos: number[]; uv: number[]; idx: number[] }
  >();
  /**
   * A `w` x `h` plate centred at (x, y, z) facing unit direction (nx, nz) (horizontal), readable from that side.
   */
  add(
    tex: Texture,
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    w: number,
    h: number,
  ): void {
    let g = this.geo.get(tex);
    if (!g) this.geo.set(tex, (g = { pos: [], uv: [], idx: [] }));
    // Right of the viewer facing the plate = (nz, -nx)... the plate's left (its u = 0) is at the viewer's left.
    const rx = -nz;
    const rz = nx;
    const v0 = g.pos.length / 3;
    const corners: [number, number, number, number][] = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    for (const [u, v, tu, tv] of corners) {
      g.pos.push(x + rx * (w / 2) * u, y + (h / 2) * v, z + rz * (w / 2) * u);
      g.uv.push(tu, tv);
    }
    g.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
  flush(group: Group): void {
    for (const [tex, g] of this.geo) {
      const geo = new BufferGeometry();
      geo.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(g.pos), 3),
      );
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(g.uv), 2));
      geo.setIndex(g.idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const m = new Mesh(
        geo,
        new MeshStandardMaterial({
          map: tex,
          roughness: 0.6,
          side: DoubleSide,
        }),
      );
      m.matrixAutoUpdate = false;
      m.receiveShadow = true;
      group.add(m);
    }
  }
}

/**
 * Where a deck lies inside another deck of the same height (a ramp merging into a wide road, two parts of one
 * junction) its edge treatment (fascia, parapet) and its ends (abutment, joint) are left out there: the road
 * continues across, there is no wall in the middle of the roadway.
 */
interface Coverage {
  /** Per row: the left / right road edge is inside another deck. */
  left: boolean[];
  right: boolean[];
  /** The first / last row is inside another deck (the end is embedded, not a free end). */
  end0: boolean;
  end1: boolean;
}

/** Consecutive runs (>= 2 rows) of `rows` whose flag is false. */
function openRuns(rows: Row[], flags?: boolean[]): Row[][] {
  if (!flags) return [rows];
  const out: Row[][] = [];
  let cur: Row[] = [];
  rows.forEach((r, i) => {
    if (flags[i]) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(r);
  });
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Rise of a shallow arch soffit: the intrados springs from the abutments at girder depth up to the slab at midspan. */
const ARCH_RISE = GIRDER - SLAB_T;

/**
 * Deck body: fascia girders, soffit + beams, parapets with pilasters (other roads), expansion joints. `arch`: the old
 * stone-bridge look - a shallow arch soffit along the span (low at the abutments, highest at midspan) with stone
 * spandrels instead of the flat soffit and beams.
 */
function deckBody(
  parts: Parts,
  rows: Row[],
  parapet: boolean,
  cov?: Coverage,
  arch = false,
): void {
  const { conc, stone } = parts;
  const L = OVERHANG;
  const top = parapet ? PARAPET_H : 0;
  // Fascia (concrete) up to the road level, stone parapet above it.
  if (arch) {
    // Arch intrados: depth below the road surface per row (parabola: ARCH_RISE + SLAB_T at the ends, SLAB_T at midspan).
    const n = rows.length - 1;
    const depth = rows.map((_, i) => {
      const u = (2 * i) / n - 1;
      return SLAB_T + ARCH_RISE * u * u;
    });
    const low = rows.map((r, i) => ({ ...r, y: r.y - depth[i] }));
    const index = new Map(rows.map((r, i) => [r, i]));
    for (const side of [1, -1] as const) {
      const flags = side > 0 ? cov?.left : cov?.right;
      for (const rr of openRuns(rows, flags)) {
        // Spandrel face, stone: from the road surface down to the arch edge (one strip per row pair, own vertices).
        const v0 = stone.pos.length / 3;
        for (const r of rr) {
          const i = index.get(r)!;
          const l = side * (r.hw + L);
          const x = r.x + r.tz * l;
          const z = r.z - r.tx * l;
          for (const y of [r.y, low[i].y]) {
            stone.pos.push(x, y, z);
            stone.col.push(...STONE);
            stone.uv.push(r.d / STONE_TS, y / STONE_TS);
          }
        }
        for (let k = 0; k < rr.length - 1; k++) {
          const q = v0 + k * 2;
          stone.idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
        }
      }
    }
    // The intrados itself (darker stone), across the full width.
    stone.strip(low, [L, 0, 1], [-L, 0, -1], [0.6, 0.58, 0.54], false);
  } else {
    for (const rr of openRuns(rows, cov?.left))
      conc.strip(rr, [L, 0, 1], [L, -GIRDER, 1], CONC);
    for (const rr of openRuns(rows, cov?.right))
      conc.strip(rr, [-L, 0, -1], [-L, -GIRDER, -1], CONC);
    // Soffit (the underside of the slab, in shadow).
    conc.strip(rows, [L, -SLAB_T, 1], [-L, -SLAB_T, -1], SOFFIT, false);
  }
  // Beams hanging below the flat soffit.
  const hw = Math.min(...rows.map((r) => r.hw));
  const nb = arch ? 0 : Math.max(2, Math.round((2 * hw) / BEAM_GAP) + 1);
  for (let k = 0; k < nb; k++) {
    const f = -1 + (2 * k) / (nb - 1);
    for (const s of [-1, 1] as const) {
      const o = s * BEAM_W * 0.5;
      conc.strip(rows, [o, -SLAB_T, f], [o, -GIRDER, f], BEAM);
    }
    conc.strip(
      rows,
      [-BEAM_W * 0.5, -GIRDER, f],
      [BEAM_W * 0.5, -GIRDER, f],
      SOFFIT,
      false,
    );
  }
  // Closing diaphragm walls across both ends of the span (the soffit's end faces).
  for (const [r, embedded] of [
    [rows[0], cov?.end0],
    [rows[rows.length - 1], cov?.end1],
  ] as const) {
    if (embedded) continue;
    const hwr = r.hw + L;
    conc.box(
      r.x,
      r.z,
      r.tx,
      r.tz,
      0.25,
      hwr,
      r.y - (arch ? SLAB_T + ARCH_RISE : GIRDER),
      r.y - SLAB_T,
      SOFFIT,
    );
  }
  if (parapet) {
    const I = L - PARAPET_T;
    for (const s of [-1, 1] as const) {
      // Outer face, top, inner face of the stone parapet (a coping stone ledge on top).
      for (const rr of openRuns(rows, s > 0 ? cov?.left : cov?.right)) {
        stone.strip(rr, [s * L, 0, s], [s * L, top, s], STONE);
        stone.strip(
          rr,
          [s * L, top, s],
          [s * I, top, s],
          [1, 0.97, 0.92],
          false,
        );
        stone.strip(rr, [s * I, top, s], [s * I, 0, s], STONE);
      }
    }
    // Pilasters: a heavier stone post every 8 m (and at both ends).
    let nextD = Math.ceil(rows[0].d / 8) * 8;
    const posts: number[] = [0];
    rows.forEach((r, i) => {
      if (r.d >= nextD) {
        posts.push(i);
        nextD += 8;
      }
    });
    posts.push(rows.length - 1);
    for (const i of posts)
      for (const s of [-1, 1] as const) {
        if ((s > 0 ? cov?.left : cov?.right)?.[i]) continue;
        const r = rows[i];
        const lat = s * (r.hw + L - PARAPET_T / 2);
        stone.box(
          r.x + r.tz * lat,
          r.z - r.tx * lat,
          r.tx,
          r.tz,
          0.42,
          PARAPET_T / 2 + 0.1,
          r.y,
          r.y + top + 0.3,
          STONE,
        );
      }
  }
  // Expansion joints: a dark band across the road at both (free) deck ends.
  for (const [r, sgn, embedded] of [
    [rows[0], 1, cov?.end0],
    [rows[rows.length - 1], -1, cov?.end1],
  ] as const) {
    if (embedded) continue;
    const v0 = conc.pos.length / 3;
    for (const [dd, l] of [
      [0, -r.hw],
      [0.35 * sgn, -r.hw],
      [0.35 * sgn, r.hw],
      [0, r.hw],
    ]) {
      conc.pos.push(
        r.x + r.tx * dd + r.tz * l,
        r.y + 0.07,
        r.z + r.tz * dd - r.tx * l,
      );
      conc.col.push(...JOINT);
      conc.uv.push(0.02, 0.02);
    }
    conc.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
}

/**
 * Abutment at one end of a deck: a stone face under the slab (ground -> soffit) with returns that taper
 * into the slope on both sides, and wing walls along the road edges retaining the approach fill.
 * `end` = frame of the end row, `inward` = +1 when the span lies ahead of `end` along the tangent.
 */
function abutment(
  world: World,
  parts: Parts,
  end: Row,
  inward: 1 | -1,
  roadYAt: (s: number) => number,
): void {
  // The ground under the deck (gen.height), not the surface (analytic: the deck of a stage-road span).
  const ground = world.gen;
  const W = end.hw + OVERHANG;
  const nx = end.tz;
  const nz = -end.tx;
  const topY = end.y - SLAB_T;
  // Face: from -W-RETURN_L to W+RETURN_L across the road.
  const face: { x: number; z: number; bot: number; top: number }[] = [];
  let high = 0;
  const half = W + RETURN_L;
  const n = Math.ceil((2 * half) / 1.2);
  for (let i = 0; i <= n; i++) {
    const l = -half + (2 * half * i) / n;
    const x = end.x + nx * l;
    const z = end.z + nz * l;
    const g = ground.height(x, z);
    const over = Math.max(0, Math.abs(l) - W);
    const t =
      over > 0 ? Math.max(g, topY + (g - topY) * (over / RETURN_L)) : topY;
    high = Math.max(high, t - g);
    face.push({ x, z, bot: g - 0.5, top: Math.max(t, g - 0.3) });
  }
  if (high >= 0.4) {
    parts.stone.wall(face, STONE);
    // Coping: a heavier stone course on the seat under the slab edge (the full width, 0.35 m).
    parts.stone.box(
      end.x - end.tx * inward * 0.2,
      end.z - end.tz * inward * 0.2,
      end.tx,
      end.tz,
      0.2,
      W,
      topY - 0.3,
      topY,
      [0.85, 0.83, 0.78],
    );
  }
  // Wing walls beside the road, running away from the span.
  for (const s of [-1, 1] as const) {
    const pts: { x: number; z: number; bot: number; top: number }[] = [];
    for (let d = 0; d <= WING_L; d += 1.5) {
      const l = s * (end.hw + 0.25);
      const x = end.x - end.tx * inward * d + nx * l;
      const z = end.z - end.tz * inward * d + nz * l;
      const g = ground.height(x, z);
      const top = roadYAt(d) - 0.04;
      if (top - g < 0.3) break;
      pts.push({ x, z, bot: g - 0.4, top });
    }
    parts.stone.wall(pts, STONE);
  }
}

/** One `Parts` per 256 m tile: the bridges of a tile become two meshes (stone + concrete) instead of two per bridge. */
class TileParts {
  private map = new Map<string, Parts>();
  of(x: number, z: number): Parts {
    const k = `${Math.floor(x / 256)},${Math.floor(z / 256)}`;
    let p = this.map.get(k);
    if (!p) this.map.set(k, (p = new Parts()));
    return p;
  }
  flush(group: Group): void {
    for (const p of this.map.values()) p.add(group);
  }
}

/** Stage-road bridge spans: girders, beams, abutments and wing walls (the jersey barriers are barrier runs). */
function stageSpans(world: World, tiles: TileParts): void {
  for (const sp of world.road.bridges) {
    const rows: Row[] = [];
    for (let a = sp.from; ; a += STEP / 1.5) {
      const d = Math.min(a, sp.to);
      const s = world.road.at(d);
      // Top of the deck at the road centre (crown below 5 cm: ignored).
      rows.push({
        x: s.x,
        y: s.y - 0.02,
        z: s.z,
        tx: s.tx,
        tz: s.tz,
        d,
        hw: s.halfWidth,
      });
      if (d >= sp.to) break;
    }
    if (rows.length < 2) continue;
    const mid = rows[rows.length >> 1];
    const parts = tiles.of(mid.x, mid.z);
    deckBody(parts, rows, false);
    abutment(world, parts, rows[0], 1, (s) => world.road.at(sp.from - s).y);
    abutment(
      world,
      parts,
      rows[rows.length - 1],
      -1,
      (s) => world.road.at(sp.to + s).y,
    );
  }
}

/** Elevated decks of the other roads (OSM bridge=yes): road surface + girders + parapets + abutments + piers. */
function pathDecks(world: World, group: Group, tiles: TileParts): void {
  const gen = world.gen;
  const net = gen.paths;
  if (!net) return;
  // Pass 1: every deck's rows (centre line, height, half width).
  const decks: { pi: number; rows: Row[] }[] = [];
  for (const pi of gen.deckPaths()) {
    const L = net.lengths[pi];
    if (L < 4) continue;
    const n = Math.max(2, Math.ceil(L / STEP) + 1);
    const pt = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1)) * L;
      net.pointAt(pi, Math.max(0, a - 1.5), pt);
      net.pointAt(pi, Math.min(L, a + 1.5), nx);
      const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
      net.pointAt(pi, a, pt);
      rows.push({
        x: pt.x,
        y: gen.pathHeight(pi, a),
        z: pt.z,
        tx: (nx.x - pt.x) / tl,
        tz: (nx.z - pt.z) / tl,
        d: a,
        hw: net.halfWidthAt(pi, a),
      });
    }
    decks.push({ pi, rows });
  }
  /** Is (x, z, y) on the roadway of a deck other than `self` (same height within 1.5 m)? */
  const onOther = (self: number, x: number, z: number, y: number): number => {
    for (const d of decks) {
      if (d.pi === self) continue;
      for (let k = 0; k + 1 < d.rows.length; k++) {
        const a = d.rows[k];
        const b = d.rows[k + 1];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(
          0,
          Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2),
        );
        const dd = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
        const hw = a.hw + (b.hw - a.hw) * t;
        const yy = a.y + (b.y - a.y) * t;
        if (dd <= hw - 0.15 && Math.abs(yy - y) < 1.5) return d.pi;
      }
    }
    return -1;
  };
  // Pass 2: surface, body, abutments.
  for (const { pi, rows } of decks) {
    const p = net.paths[pi];
    const L = net.lengths[pi];
    const tex = pathTexture(p.kind, p.width, !!world.map.cityStreets);
    const roadMat = getRoadMaterial(tex, tex === 'road_parkway' ? 2 : 1);
    const edge = (r: Row, side: number) => ({
      x: r.x + r.tz * (r.hw + 0.2) * side,
      z: r.z - r.tx * (r.hw + 0.2) * side,
    });
    // Inside another deck, or on a portal slab (the slab is the structure there): no body of its own.
    const portals = gen.portals;
    const last = rows[rows.length - 1];
    const cov: Coverage = {
      left: rows.map((r) => {
        const e = edge(r, 1);
        return onOther(pi, e.x, e.z, r.y) >= 0 || portals.inside(e.x, e.z);
      }),
      right: rows.map((r) => {
        const e = edge(r, -1);
        return onOther(pi, e.x, e.z, r.y) >= 0 || portals.inside(e.x, e.z);
      }),
      end0:
        onOther(pi, rows[0].x, rows[0].z, rows[0].y) >= 0 ||
        portals.inside(rows[0].x, rows[0].z),
      end1:
        onOther(pi, last.x, last.z, last.y) >= 0 ||
        portals.inside(last.x, last.z),
    };
    // Roads lying on top of each other (a ramp merging into a wide road): the narrower one is drawn a hair higher.
    let stagger = 0;
    {
      const owners = new Set<number>();
      for (const r of rows) {
        const o = onOther(pi, r.x, r.z, r.y);
        if (o >= 0) owners.add(o);
      }
      for (const o of owners) {
        const ow = net.paths[o].width;
        if (ow > p.width + 0.3 || (Math.abs(ow - p.width) <= 0.3 && o < pi))
          stagger++;
      }
    }
    // Road surface.
    const surf = new BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const nor: number[] = [];
    rows.forEach((r, k) => {
      // Right edge first, like the stage ribbon: the winding then faces up.
      for (const side of [-1, 1]) {
        pos.push(
          r.x + r.tz * r.hw * side,
          r.y + 0.03 + stagger * 0.012,
          r.z - r.tx * r.hw * side,
        );
        nor.push(0, 1, 0);
        uv.push(side < 0 ? 1 : 0, r.d / texLength(tex));
      }
      if (k < rows.length - 1) {
        const q = k * 2;
        idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
      }
    });
    surf.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(pos), 3),
    );
    surf.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    surf.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    surf.setIndex(idx);
    surf.computeBoundingSphere();
    const top = new Mesh(surf, roadMat);
    top.receiveShadow = true;
    top.matrixAutoUpdate = false;
    group.add(top);
    const mid = rows[rows.length >> 1];
    const parts = tiles.of(mid.x, mid.z);
    // Streets over the parkway: the old stone arch look (ramps and the motorway decks keep the beam soffit).
    const arch = STREET_KINDS.has(p.kind) && L >= 12 && !gen.isPortalDeck(pi);
    deckBody(parts, rows, true, cov, arch);
    if (!cov.end0)
      abutment(world, parts, rows[0], 1, (s) => gen.pathHeight(pi, s));
    if (!cov.end1)
      abutment(world, parts, rows[rows.length - 1], -1, (s) =>
        gen.pathHeight(pi, L - s),
      );
  }
}

/** Piers: column + cap beam (the collider is the column box, World.pierColliders). */
function piers(world: World, tiles: TileParts): void {
  if (!world.piers.length) return;
  for (const p of world.piers) {
    const parts = tiles.of(p.x, p.z);
    // Local +X of the pier runs along the deck: the tangent is (cos(-rot), sin(-rot)) in (x, z).
    const tx = Math.cos(p.rot);
    const tz = -Math.sin(p.rot);
    const capH = p.cap === false ? 0 : 0.8;
    const colTop = p.y1 - capH;
    parts.conc.box(
      p.x,
      p.z,
      tx,
      tz,
      p.length / 2,
      p.width / 2,
      p.y0,
      colTop,
      CONC,
    );
    if (!capH) continue;
    // Cap beam across the deck, wider than the column, with the soffit shade under it.
    parts.conc.box(
      p.x,
      p.z,
      tx,
      tz,
      p.length / 2 + 0.5,
      p.width / 2 + 0.9,
      colTop,
      p.y1,
      [0.9, 0.88, 0.85],
    );
  }
}

/** Headwall height above the slab top (the parapet along the opening) and the concrete lintel under the stone (m). */
const HEAD_H = 1.1;
const LINTEL = 0.45;
/** Beam spacing along a portal (m). */
const PORTAL_BEAM_GAP = 2.4;

/**
 * Portal structures (portals.ts): the cut-and-cover slab over the sunken parkway - soffit with cross beams,
 * stone headwalls with a concrete lintel at both ends (name + clearance plates facing the drivers),
 * parapets along the long edges (open where a street deck crosses them), a light concrete top between
 * the streets. The piers come from World.piers like the decks'.
 */
function portalStructures(
  world: World,
  parts: (x: number, z: number) => Parts,
  plates: Plates,
  lights: Builder,
): void {
  const gen = world.gen;
  const net = gen.paths;
  const pq = newPathQuery();
  const isDeck = (pi: number) => !!net!.paths[pi].bridge;
  for (const portal of gen.portals.list) {
    const src = portal.rows;
    if (src.length < 2) continue;
    // Rows centred between the walls, half width = half the wall-to-wall distance, y = slab top.
    const rows: Row[] = src.map((r) => {
      const c = (r.latL + r.latR) / 2;
      return {
        x: r.x + r.tz * c,
        z: r.z - r.tx * c,
        y: r.top,
        tx: r.tx,
        tz: r.tz,
        d: r.along,
        hw: (r.latL - r.latR) / 2,
      };
    });
    const mid = rows[rows.length >> 1];
    const { conc, stone, metal } = parts(mid.x, mid.z);
    // Top (pavement between the streets) and soffit.
    conc.strip(rows, [0, 0, 1], [0, 0, -1], [0.8, 0.79, 0.76], false);
    conc.strip(rows, [0, -SLAB_T, 1], [0, -SLAB_T, -1], SOFFIT, false);
    // Cross beams spanning wall to wall, every PORTAL_BEAM_GAP along the road.
    for (
      let d = src[0].along + 1.2;
      d < src[src.length - 1].along - 0.6;
      d += PORTAL_BEAM_GAP
    ) {
      const t = Math.min(
        rows.length - 1.001,
        (d - src[0].along) / (src[1].along - src[0].along),
      );
      const i = Math.floor(t);
      const f = t - i;
      const a = rows[i];
      const b = rows[i + 1];
      const lerp = (u: number, v: number) => u + (v - u) * f;
      conc.box(
        lerp(a.x, b.x),
        lerp(a.z, b.z),
        a.tz,
        -a.tx,
        lerp(a.hw, b.hw),
        BEAM_W / 2,
        lerp(a.y, b.y) - GIRDER,
        lerp(a.y, b.y) - SLAB_T,
        BEAM,
      );
    }
    // Fluorescent strip lights under the soffit, in two rows over the carriageways, one between every third pair of beams.
    const lanesAt = (r: (typeof src)[number]): number[] => {
      const out = [0];
      if (!net) return out;
      let a = NaN;
      let b = NaN;
      for (let l = r.latR; l <= r.latL; l += 0.5) {
        const x = r.x + r.tz * l;
        const z = r.z - r.tx * l;
        const rq = world.road.query(x, z, roadQ);
        if (rq.found && rq.distance <= rq.halfWidth) continue;
        net.query(x, z, pq, 'tarmac', (pi) => gen.isCarriageway(pi));
        if (pq.found && pq.distance <= pq.halfWidth) {
          if (Number.isNaN(a)) a = l;
          b = l;
        }
      }
      if (!Number.isNaN(a)) out.push((a + b) / 2);
      return out;
    };
    for (
      let d = src[0].along + 1.2 + PORTAL_BEAM_GAP * 0.5;
      d < src[src.length - 1].along - 0.6;
      d += PORTAL_BEAM_GAP * 3
    ) {
      const t = Math.min(
        src.length - 1.001,
        (d - src[0].along) / (src[1].along - src[0].along),
      );
      const i = Math.floor(t);
      const r = src[i];
      for (const lat of lanesAt(r)) {
        for (const off of [-1.7, 1.7]) {
          const l = lat + off;
          if (l > r.latL - 0.5 || l < r.latR + 0.5) continue;
          lights.box(
            r.x + r.tz * l,
            r.z - r.tx * l,
            r.tx,
            r.tz,
            0.9,
            0.08,
            r.top - GIRDER - 0.14,
            r.top - GIRDER - 0.04,
            [1, 0.96, 0.82],
          );
        }
      }
    }
    // Side parapets along the long edges, open where a street deck crosses the edge.
    for (const side of [1, -1] as const) {
      const flags = rows.map((r) => {
        const x = r.x + r.tz * r.hw * side;
        const z = r.z - r.tx * r.hw * side;
        if (!net) return false;
        net.query(x, z, pq, 'tarmac', isDeck);
        return pq.found && pq.distance <= pq.halfWidth + 0.6;
      });
      for (const rr of openRuns(rows, flags)) {
        const o = side * PARAPET_T;
        stone.strip(rr, [0, 0, side], [0, PARAPET_H, side], STONE);
        stone.strip(
          rr,
          [0, PARAPET_H, side],
          [-o, PARAPET_H, side],
          [1, 0.97, 0.92],
          false,
        );
        stone.strip(rr, [-o, PARAPET_H, side], [-o, 0, side], STONE);
        railing(metal, rr, side * (-PARAPET_T / 2), PARAPET_H, side);
      }
    }
    // Headwalls at both ends: stone from the lintel up to the parapet top, the lintel below, a coping on top.
    for (const [r, out] of [
      [rows[0], -1],
      [rows[rows.length - 1], 1],
    ] as const) {
      const pts = (bot: number, top: number, push: number) => {
        const line: { x: number; z: number; bot: number; top: number }[] = [];
        const n = Math.ceil((2 * r.hw) / 1.5);
        for (let i = 0; i <= n; i++) {
          const l = -r.hw + (2 * r.hw * i) / n;
          line.push({
            x: r.x + r.tz * l + r.tx * out * push,
            z: r.z - r.tx * l + r.tz * out * push,
            bot,
            top,
          });
        }
        return line;
      };
      stone.wall(pts(r.y - GIRDER + LINTEL, r.y + HEAD_H, 0), STONE);
      conc.wall(pts(r.y - GIRDER, r.y - GIRDER + LINTEL, 0.03), CONC);
      stone.box(
        r.x,
        r.z,
        r.tz,
        -r.tx,
        r.hw + 0.15,
        0.32,
        r.y + HEAD_H,
        r.y + HEAD_H + 0.12,
        [0.88, 0.86, 0.82],
      );
      // Plates facing the drivers who approach this headwall: the stage road comes from behind the first
      // row (out = -1), the opposite carriageway leaves through the last one (out = +1).
      const nx = r.tx * out;
      const nz = r.tz * out;
      const srcRow = out < 0 ? src[0] : src[src.length - 1];
      const lanes: number[] = [];
      if (out < 0) lanes.push(0);
      if (net) {
        // Centre of the opposite carriageway: the middle of the run of carriageway samples on the left.
        let a = NaN;
        let b = NaN;
        for (let l = srcRow.latR; l <= srcRow.latL; l += 0.5) {
          const x = srcRow.x + srcRow.tz * l;
          const z = srcRow.z - srcRow.tx * l;
          const rq = world.road.query(x, z, roadQ);
          if (rq.found && rq.distance <= rq.halfWidth) continue;
          net.query(x, z, pq, 'tarmac', (pi) => gen.isCarriageway(pi));
          if (pq.found && pq.distance <= pq.halfWidth) {
            if (Number.isNaN(a)) a = l;
            b = l;
          }
        }
        if (!Number.isNaN(a) && out > 0) lanes.push((a + b) / 2);
      }
      const clearance = feetInches(r.y - GIRDER - srcRow.y);
      const plateY = r.y + HEAD_H - 0.42;
      // Yellow advisory speed plate on the headwall right of the stage road's lane (drivers approaching it only).
      if (out < 0 && srcRow.latR + 1.2 < -3.4)
        plates.add(
          advisoryPlateTexture(35),
          srcRow.x + srcRow.tz * -3.4 + nx * 0.06,
          plateY - 0.05,
          srcRow.z - srcRow.tx * -3.4 + nz * 0.06,
          nx,
          nz,
          0.75,
          0.75,
        );
      lanes.forEach((lat, k) => {
        const px = srcRow.x + srcRow.tz * lat + nx * 0.06;
        const pz = srcRow.z - srcRow.tx * lat + nz * 0.06;
        plates.add(
          clearancePlateTexture(clearance),
          px + srcRow.tz * -1.3,
          plateY,
          pz - srcRow.tx * -1.3,
          nx,
          nz,
          0.96,
          0.6,
        );
        if (k === 0 && portal.name)
          plates.add(
            namePlateTexture(portal.name),
            px + srcRow.tz * 1.3,
            plateY,
            pz - srcRow.tx * 1.3,
            nx,
            nz,
            2.2,
            0.55,
          );
      });
    }
  }
}
const roadQ = newRoadQuery();

/** Steel railing on top of a wall / parapet: posts every ~2 m and two rails, at lateral `off` (+ `frac` x hw) of the rows. */
export function railing(
  metal: Builder,
  rows: Row[],
  off: number,
  base: number,
  frac: number,
): void {
  const col: RGB = [0.22, 0.23, 0.25];
  const H = 1.05;
  for (const [lo, hi] of [
    [H - 0.06, H],
    [0.5, 0.55],
  ]) {
    metal.strip(
      rows,
      [off - 0.025, base + lo, frac],
      [off - 0.025, base + hi, frac],
      col,
    );
    metal.strip(
      rows,
      [off + 0.025, base + lo, frac],
      [off + 0.025, base + hi, frac],
      col,
    );
    metal.strip(
      rows,
      [off - 0.025, base + hi, frac],
      [off + 0.025, base + hi, frac],
      col,
      false,
    );
  }
  let next = Math.ceil(rows[0].d / 2) * 2;
  for (const r of rows) {
    if (r.d < next) continue;
    next += 2;
    const l = off + frac * r.hw;
    metal.box(
      r.x + r.tz * l,
      r.z - r.tx * l,
      r.tx,
      r.tz,
      0.035,
      0.035,
      r.y + base,
      r.y + base + H,
      col,
    );
  }
}

/** Girders / decks of every bridge in the map (stage spans + other roads' decks). */
export function* bridgeMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  if (
    !world.road.bridges.length &&
    !world.gen.deckPaths().length &&
    world.gen.portals.empty
  )
    return undefined;
  const group = new Group();
  group.name = 'bridges';
  const tiles = new TileParts();
  stageSpans(world, tiles);
  yield;
  pathDecks(world, group, tiles);
  yield;
  piers(world, tiles);
  yield;
  const plates = new Plates();
  const lights = new Builder(1);
  portalStructures(world, (x, z) => tiles.of(x, z), plates, lights);
  plates.flush(group);
  if (!lights.empty()) {
    // Lit fittings: unaffected by the (dark) shade under the slab.
    const m = lights.build(
      new MeshBasicMaterial({ vertexColors: true, fog: true }),
    );
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }
  yield;
  tiles.flush(group);
  return group;
}
