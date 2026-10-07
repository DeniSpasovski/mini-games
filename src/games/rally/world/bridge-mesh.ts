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
import { baseTexture, hasMarkings, straightJoint } from './street-markings';
import { MarkingBuilder } from './street-markings-mesh';
import { mergePaint } from './merge-paint';
import type { RoadTexture } from '../maps/shared/types';
import { DECK_DEPTH, UNDERPASS_WALL } from './terrain-gen';
import { TWIN_OVERLAP, twinAt } from './twin-decks';
import type { World } from './world';

/**
 * Bridge geometry. Stage-road bridge spans and the elevated decks of other roads (OSM bridge=yes:
 * overpasses, ramps, the interchange) share one detailed bridge builder:
 *
 * - the deck: fascia girders, a recessed soffit with a row of beams (seen from the road below), stone
 *   parapets with pilasters (decks of other roads; MapDef.bridgeStyle 'concrete': a concrete edge beam with
 *   an open steel railing, no stone arch, concrete abutments), dark expansion joints across the road at both ends;
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
/** Outward splay of a modern deck's wing walls: metres away from the road edge per metre along it (~35 deg). */
const WING_FLARE = 0.7;
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
    // (relief from the texture itself: mortar joints and form-board lines catch a low sun)
    stone: new MeshStandardMaterial({
      map: getTexture('bridge_stone'),
      bumpMap: getTexture('bridge_stone'),
      bumpScale: 2.4,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      side: DoubleSide,
    }),
    concrete: new MeshStandardMaterial({
      map: getTexture('bridge_concrete'),
      bumpMap: getTexture('bridge_concrete'),
      bumpScale: 1.2,
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

  /**
   * A vertical wall along a polyline: per point (x, z, bottom, top); uv = (length, height). A tall wall is darker at its
   * foot (road spray, grime), fading up over its height.
   */
  wall(
    pts: { x: number; z: number; bot: number; top: number }[],
    color: RGB,
  ): void {
    if (pts.length < 2) return;
    const v0 = this.pos.length / 3;
    let len = 0;
    pts.forEach((p, i) => {
      if (i) len += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const grime =
        1 - 0.22 * Math.min(1, Math.max(0, (p.top - p.bot - 1) / 2));
      for (const y of [p.bot, p.top]) {
        this.pos.push(p.x, y, p.z);
        const f = y === p.bot ? grime : 1;
        this.col.push(color[0] * f, color[1] * f, color[2] * f);
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
    // Right of the viewer facing the plate (looking along -n) = (nz, -nx): the plate's left (its u = 0) is at the
    // viewer's left (it was (-nz, nx): every plate read mirrored).
    const rx = nz;
    const rz = -nx;
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
    // Wound counter-clockwise seen from the viewer's side (the face normal points at them).
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

/** Height of the concrete edge beam under the steel railing of a `concrete` style deck (m). */
const CURB_H = 0.35;

/**
 * Deck body: fascia girders, soffit + beams, parapets with pilasters (other roads), expansion joints. `arch`: the old
 * stone-bridge look - a shallow arch soffit along the span (low at the abutments, highest at midspan) with stone
 * spandrels instead of the flat soffit and beams. `modern`: a concrete edge beam with an open steel railing instead
 * of the stone parapet (MapDef.bridgeStyle 'concrete').
 */
function deckBody(
  parts: Parts,
  rows: Row[],
  parapet: boolean,
  cov?: Coverage,
  arch = false,
  modern = false,
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
  if (parapet && modern) {
    const I = L - PARAPET_T;
    for (const s of [-1, 1] as const) {
      // Concrete edge beam (outer face, top, inner face) with the railing standing on it.
      for (const rr of openRuns(rows, s > 0 ? cov?.left : cov?.right)) {
        conc.strip(rr, [s * L, 0, s], [s * L, CURB_H, s], CONC);
        conc.strip(rr, [s * L, CURB_H, s], [s * I, CURB_H, s], CONC, false);
        conc.strip(rr, [s * I, CURB_H, s], [s * I, 0, s], CONC);
        railing(parts.metal, rr, s * (L - PARAPET_T / 2), CURB_H, s);
      }
    }
  } else if (parapet) {
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
  modern = false,
  wings = true,
): void {
  const face = modern ? parts.conc : parts.stone;
  const faceCol = modern ? CONC : STONE;
  // The ground under the deck (gen.height), not the surface (analytic: the deck of a stage-road span).
  const ground = world.gen;
  const W = end.hw + OVERHANG;
  const nx = end.tz;
  const nz = -end.tx;
  const topY = end.y - SLAB_T;
  // Face: from -W-RETURN_L to W+RETURN_L across the road.
  const wallPts: { x: number; z: number; bot: number; top: number }[] = [];
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
    wallPts.push({ x, z, bot: g - 0.5, top: Math.max(t, g - 0.3) });
  }
  // The face, its returns and the wing walls never stand in the trench of a street that passes under the deck (the
  // underpass opens through them; its own retaining walls take over).
  const net = world.gen.paths;
  const pq = newPathQuery();
  const onStreet = (p: { x: number; z: number }): boolean => {
    if (!net) return false;
    net.query(p.x, p.z, pq, 'tarmac', (qi) => world.gen.isUnderpass(qi));
    return pq.found && pq.distance <= pq.halfWidth + UNDERPASS_WALL + 0.5;
  };
  if (high >= 0.4) {
    let run: typeof wallPts = [];
    for (const p of wallPts) {
      if (onStreet(p)) {
        face.wall(run, faceCol);
        run = [];
      } else run.push(p);
    }
    face.wall(run, faceCol);
    // Coping: a heavier course on the seat under the slab edge (the full width, 0.35 m).
    face.box(
      end.x - end.tx * inward * 0.2,
      end.z - end.tz * inward * 0.2,
      end.tx,
      end.tz,
      0.2,
      W,
      topY - 0.3,
      topY,
      modern ? CONC : [0.85, 0.83, 0.78],
    );
  }
  // Wing walls beside the road, running away from the span. Modern: splayed outward (the end opens up, never
  // closes in over the approach), the top stepping down with the fill as it leaves the road edge.
  for (const s of wings ? ([-1, 1] as const) : []) {
    const pts: { x: number; z: number; bot: number; top: number }[] = [];
    for (let d = 0; d <= WING_L; d += 1.5) {
      const out = modern ? d * WING_FLARE : 0;
      const l = s * (end.hw + 0.25 + out);
      const x = end.x - end.tx * inward * d + nx * l;
      const z = end.z - end.tz * inward * d + nz * l;
      const g = ground.height(x, z);
      const top = roadYAt(d) - 0.04 - out;
      if (top - g < 0.3) break;
      if (onStreet({ x, z })) {
        face.wall(pts, faceCol);
        pts.length = 0;
        continue;
      }
      pts.push({ x, z, bot: g - 0.4, top });
    }
    face.wall(pts, faceCol);
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

const spanQ = newRoadQuery();
/** A deck row beside an arched stage-road span (the opposite carriageway's twin bridge). */
function besideStageSpan(world: World, r: Row): boolean {
  const q = world.road.query(r.x, r.z, spanQ);
  const sp =
    q.found && q.distance < 40 ? world.road.bridgeAt(q.along) : undefined;
  return !!sp && sp.to - sp.from >= STAGE_ARCH_MIN;
}

/** Shortest stage-road span with an arch soffit (m): a culvert-sized span keeps the flat girders. */
const STAGE_ARCH_MIN = 12;

/** Stage-road bridge spans: arch soffit (or girders + beams), abutments and wing walls (the jersey barriers are barrier runs). */
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
    // The old stone-bridge look (as the street bridges over the parkway) unless the map's bridges are modern.
    const arch =
      world.map.bridgeStyle !== 'concrete' && sp.to - sp.from >= STAGE_ARCH_MIN;
    deckBody(parts, rows, false, undefined, arch);
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
      // Unit tangent BEFORE pt is reused for the row's own point (taking it after gave half-length tangents
      // inside the deck and a zero one at its end: decks drawn half wide, pinched to a point at the far end).
      const tx = (nx.x - pt.x) / tl;
      const tz = (nx.z - pt.z) / tl;
      net.pointAt(pi, a, pt);
      rows.push({
        x: pt.x,
        y: gen.pathHeight(pi, a),
        z: pt.z,
        tx,
        tz,
        d: a,
        hw: gen.deckHalfWidth(pi, a),
      });
    }
    decks.push({ pi, rows });
  }
  // Twin decks (the two directions of one overpass street): widen both so their roadways overlap a little - one
  // slab, the facing edges are inside the other deck (no parapet / fascia between them, see Coverage).
  const isStreetDeck = (q: number) =>
    !!net.paths[q].bridge &&
    !gen.isPortalDeck(q) &&
    net.paths[q].surface === 'tarmac' &&
    // (ramp decks count: the on-ramp beside Highland Blvd at the start is one structure with it)
    !/^(motorway|trunk)$/.test(net.paths[q].kind);
  const widen = decks.map(({ pi, rows }) =>
    isStreetDeck(pi)
      ? rows.map((r) => {
          const t = twinAt(net, isStreetDeck, pi, r.d, r.hw);
          return t ? Math.max(0, t.gap / 2 + TWIN_OVERLAP / 2) : 0;
        })
      : undefined,
  );
  decks.forEach(({ rows }, k) => {
    const w = widen[k];
    if (w) rows.forEach((r, i) => (r.hw += w[i]));
  });
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
  const deckMarks = new MarkingBuilder();
  // Pass 2: surface, body, abutments.
  for (const { pi, rows } of decks) {
    const p = net.paths[pi];
    const L = net.lengths[pi];
    // Decks of modelled streets: base asphalt at true scale, the paint from the marking layer (street-markings.ts).
    const marked = !!world.map.cityStreets && hasMarkings(p, true);
    const tex: RoadTexture = marked
      ? baseTexture(p)
      : pathTexture(p.kind, p.width, !!world.map.cityStreets);
    const roadMat = getRoadMaterial(
      tex,
      tex === 'road_parkway' || tex === 'asphalt_highway' ? 2 : 1,
    );
    const edge = (r: Row, side: number) => ({
      x: r.x + r.tz * (r.hw + 0.2) * side,
      z: r.z - r.tx * (r.hw + 0.2) * side,
    });
    // Inside another deck, or on a portal slab / junction plaza (the slab is the structure there): no body of its own.
    const portals = gen.portals;
    const plazas = gen.plazas;
    // (a measured structure, MapDef.deckStructures: one slab drawn by structureDecks)
    const onSlab = (x: number, z: number) =>
      portals.inside(x, z) ||
      plazas.inside(x, z, 1) ||
      gen.inDeckStructure(x, z);
    const last = rows[rows.length - 1];
    const cov: Coverage = {
      left: rows.map((r) => {
        const e = edge(r, 1);
        return onOther(pi, e.x, e.z, r.y) >= 0 || onSlab(e.x, e.z);
      }),
      right: rows.map((r) => {
        const e = edge(r, -1);
        return onOther(pi, e.x, e.z, r.y) >= 0 || onSlab(e.x, e.z);
      }),
      end0:
        onOther(pi, rows[0].x, rows[0].z, rows[0].y) >= 0 ||
        onSlab(rows[0].x, rows[0].z),
      end1: onOther(pi, last.x, last.z, last.y) >= 0 || onSlab(last.x, last.z),
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
    // Columns across (right edge first, like the stage ribbon: the winding then faces up). Inner columns keep the
    // lane lines straight where the width tapers (two-vertex rows skew the texture into a zigzag).
    const cols = [-1, -0.5, 0, 0.5, 1];
    const nc = cols.length;
    rows.forEach((r, k) => {
      for (const side of cols) {
        pos.push(
          r.x + r.tz * r.hw * side,
          // (on an area that keeps its ribbons the deck surface lies just over the paving)
          r.y + (plazas.keepsRibbons(r.x, r.z) ? 0.05 : 0.03) + stagger * 0.012,
          r.z - r.tx * r.hw * side,
        );
        nor.push(0, 1, 0);
        uv.push(
          marked ? (side * r.hw) / 8 : (1 - side) / 2,
          r.d / texLength(tex),
        );
      }
      // Inside a junction plaza the plaza is the street surface.
      if (
        k < rows.length - 1 &&
        !(
          plazas.inside(r.x, r.z) &&
          plazas.inside(rows[k + 1].x, rows[k + 1].z) &&
          !plazas.keepsRibbons(r.x, r.z)
        )
      ) {
        for (let c = 0; c + 1 < nc; c++) {
          const q = k * nc + c;
          idx.push(q, q + nc, q + nc + 1, q, q + nc + 1, q + 1);
        }
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
    if (marked) {
      const keeps = (r: Row) => plazas.keepsRibbons(r.x, r.z);
      deckMarks.addPath(
        p,
        rows.map((r) => {
          const y = r.y + (keeps(r) ? 0.05 : 0.03) + stagger * 0.012;
          return {
            x: r.x,
            z: r.z,
            tx: r.tx,
            tz: r.tz,
            hw: r.hw,
            d: r.d,
            y: [y, y, y, y, y],
            skip: plazas.inside(r.x, r.z) && !keeps(r),
          };
        }),
        L,
        straightJoint(net.paths, p, false),
        straightJoint(net.paths, p, true),
        mergePaint(net.paths, p),
      );
    }
    const mid = rows[rows.length >> 1];
    const parts = tiles.of(mid.x, mid.z);
    // Streets over the parkway and the opposite carriageway's deck beside a stage-road span (both arched, stageSpans):
    // the old stone arch look; ramps and the other motorway decks keep the beam soffit.
    // A modern overpass (bridgeStyle 'concrete'): beam soffit, edge beam + open railing, concrete abutments.
    const modern = world.map.bridgeStyle === 'concrete';
    const arch =
      !modern &&
      L >= 12 &&
      ((STREET_KINDS.has(p.kind) && !gen.isPortalDeck(pi)) ||
        (gen.isCarriagewayDeck(pi) && besideStageSpan(world, mid)));
    // Inside a measured structure the structure's own body carries it (one soffit, parapets on its outline only).
    const inStructure = rows.every((r) => gen.inDeckStructure(r.x, r.z, 3.5));
    if (!inStructure) deckBody(parts, rows, true, cov, arch, modern);
    // Wing walls retain the approach: their top follows the approach road's height going AWAY from the span
    // (the deck's own profile rises the other way - walls taken from it stand up beside the approach).
    const approach = (end: Row, inward: 1 | -1) => (s: number) =>
      gen.height(end.x - end.tx * inward * s, end.z - end.tz * inward * s);
    // (a walled approach has its own retaining walls, cut-wall-mesh.ts: no short wing walls inside them)
    if (!cov.end0)
      abutment(
        world,
        parts,
        rows[0],
        1,
        approach(rows[0], 1),
        modern,
        !gen.hasApproach(pi, false),
      );
    if (!cov.end1)
      abutment(
        world,
        parts,
        last,
        -1,
        approach(last, -1),
        modern,
        !gen.hasApproach(pi, true),
      );
  }
  const paint = deckMarks.build();
  if (paint) group.add(paint);
}

/**
 * Measured bridge structures (MapDef.deckStructures, e.g. the start's Highland Blvd bridge): ONE slab over the outline on the
 * survey plane - paved top just under the road decks on it, soffit, fascia + parapets along its two long sides (the ends are
 * where the roads go on: their decks keep their own abutments). The road decks inside have no body of their own (pathDecks).
 * A four-corner outline: the end edges are the two opposite ones the roads cross most.
 */
function structureDecks(world: World, group: Group, tiles: TileParts): void {
  const gen = world.gen;
  const net = gen.paths;
  if (!net) return;
  const pt = { x: 0, z: 0 };
  for (const st of gen.structures) {
    const o = st.outline;
    if (o.length !== 8) continue;
    const c = [0, 1, 2, 3].map((i) => [o[i * 2], o[i * 2 + 1]]);
    const crossings = (a: number[], b: number[]) => {
      let n = 0;
      net.paths.forEach((p, pi) => {
        if (!p.bridge || p.surface !== 'tarmac') return;
        const L = net.lengths[pi];
        let prev: number[] | undefined;
        for (let d = 0; d <= L; d += 1) {
          net.pointAt(pi, d, pt);
          const q = [pt.x, pt.z];
          if (prev && segmentsCross(prev, q, a, b)) n++;
          prev = q;
        }
      });
      return n;
    };
    // ends: edges (c1, c2) + (c3, c0), or (c0, c1) + (c2, c3)
    const endsB = crossings(c[1], c[2]) + crossings(c[3], c[0]);
    const endsA = crossings(c[0], c[1]) + crossings(c[2], c[3]);
    // the two long sides, both running from one end edge to the other
    const [a0, a1, b0, b1] =
      endsB >= endsA ? [c[0], c[1], c[3], c[2]] : [c[1], c[2], c[0], c[3]];
    const y = (x: number, z: number) =>
      st.plane[0] + st.plane[1] * x + st.plane[2] * z;
    const len = Math.max(
      Math.hypot(a1[0] - a0[0], a1[1] - a0[1]),
      Math.hypot(b1[0] - b0[0], b1[1] - b0[1]),
    );
    const n = Math.max(2, Math.ceil(len / STEP) + 1);
    const rows: Row[] = [];
    let flip = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const A = [a0[0] + (a1[0] - a0[0]) * u, a0[1] + (a1[1] - a0[1]) * u];
      const B = [b0[0] + (b1[0] - b0[0]) * u, b0[1] + (b1[1] - b0[1]) * u];
      const cx = (A[0] + B[0]) / 2;
      const cz = (A[1] + B[1]) / 2;
      const w = Math.hypot(A[0] - B[0], A[1] - B[1]) || 1;
      // left of the row (tz, -tx) points to side A
      const nx = (A[0] - B[0]) / w;
      const nz = (A[1] - B[1]) / w;
      rows.push({
        x: cx,
        y: y(cx, cz),
        z: cz,
        tx: -nz,
        tz: nx,
        d: 0,
        hw: w / 2,
      });
    }
    for (let i = 1; i < n; i++) {
      const r = rows[i];
      const q = rows[i - 1];
      r.d = q.d + Math.hypot(r.x - q.x, r.z - q.z);
      flip += (r.x - q.x) * r.tx + (r.z - q.z) * r.tz;
    }
    // the tangent must point along the rows: else swap the sides (left = B)
    if (flip < 0)
      for (const r of rows) {
        r.tx = -r.tx;
        r.tz = -r.tz;
      }
    const mid = rows[rows.length >> 1];
    const parts = tiles.of(mid.x, mid.z);
    // Paved top just under the road decks on it (+0.03 there).
    const tex: RoadTexture = 'asphalt_street';
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    rows.forEach((r, k) => {
      for (const side of [-1, 1]) {
        pos.push(
          r.x + r.tz * r.hw * side,
          r.y + 0.015,
          r.z - r.tx * r.hw * side,
        );
        nor.push(0, 1, 0);
        uv.push((side * r.hw) / 8, r.d / texLength(tex));
      }
      if (k < rows.length - 1) {
        const q = k * 2;
        idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const top = new Mesh(g, getRoadMaterial(tex, 1));
    top.receiveShadow = true;
    top.matrixAutoUpdate = false;
    group.add(top);
    deckBody(
      parts,
      rows,
      true,
      {
        left: rows.map(() => false),
        right: rows.map(() => false),
        end0: true,
        end1: true,
      },
      false,
      world.map.bridgeStyle === 'concrete',
    );
  }
}

/** Segments p-q and a-b cross. */
function segmentsCross(
  p: number[],
  q: number[],
  a: number[],
  b: number[],
): boolean {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
  const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
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
        // (the parkway's own carriageway: a lane in its own bore is behind a wall)
        net.query(
          x,
          z,
          pq,
          'tarmac',
          (pi) => gen.isCarriageway(pi) && !gen.isParkwayLane(pi),
        );
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
    // Side parapets along the long edges, open where a street deck crosses the edge. Where a skewed end trims the slab
    // the edge stands over the open cut: a stone face down to the lintel and always a parapet.
    const trimmed = (i: number, side: 1 | -1) =>
      side > 0
        ? src[i].latL0 - src[i].latL > 0.3
        : src[i].latR - src[i].latR0 > 0.3;
    for (const side of [1, -1] as const) {
      let run: Row[] = [];
      const face = () => {
        if (run.length > 1) {
          const edge = (bot: number, top: number) =>
            run.map((r) => ({
              x: r.x + r.tz * r.hw * side,
              z: r.z - r.tx * r.hw * side,
              bot: r.y + bot,
              top: r.y + top,
            }));
          stone.wall(edge(-GIRDER + LINTEL, 0), STONE);
          conc.wall(edge(-GIRDER, -GIRDER + LINTEL), CONC);
        }
        run = [];
      };
      rows.forEach((r, i) => (trimmed(i, side) ? run.push(r) : face()));
      face();
    }
    for (const side of [1, -1] as const) {
      const flags = rows.map((r, i) => {
        if (trimmed(i, side)) return false;
        const x = r.x + r.tz * r.hw * side;
        const z = r.z - r.tx * r.hw * side;
        if (!net) return false;
        // Paved over by a junction plaza: the street continues at grade beyond the edge.
        if (gen.plazas.inside(x, z, 1)) return true;
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
  // Tunnel walls between the parkway lanes and the parkway: from below the road up to the soffit.
  for (const run of world.laneWalls)
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i];
      const b = run[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L = Math.hypot(dx, dz) || 1;
      const { conc } = parts(a.x, a.z);
      conc.box(
        (a.x + b.x) / 2,
        (a.z + b.z) / 2,
        dx / L,
        dz / L,
        L / 2 + 0.03,
        0.25,
        Math.min(a.y, b.y) - 0.4,
        Math.min(a.top, b.top) - SLAB_T,
        CONC,
      );
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
  structureDecks(world, group, tiles);
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
