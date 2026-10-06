import { smoothstep } from '../../../shared/noise';
import type {
  HeightGridDef,
  HeightmapDef,
  LandcoverDef,
  PathDef,
} from '../maps/shared/types';

/**
 * Samplers for real-world map data baked by scripts/realmap/bake.py:
 * elevation grids, the land cover zone raster and the other-roads network.
 * Pure TS (no DOM / three.js scene) so physics tests can use them.
 */

export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class HeightGrid {
  readonly h: Float32Array;
  readonly x1: number;
  readonly z1: number;
  constructor(
    readonly def: HeightGridDef,
    base: number,
    step: number,
  ) {
    const bytes = base64Bytes(def.data);
    const v = new DataView(bytes.buffer);
    this.h = new Float32Array(def.cols * def.rows);
    for (let i = 0; i < this.h.length; i++)
      this.h[i] = base + v.getInt16(i * 2, true) * step;
    this.x1 = def.originX + (def.cols - 1) * def.cell;
    this.z1 = def.originZ + (def.rows - 1) * def.cell;
  }

  /** 0 outside, 1 inside (more than `blend` cells from the edge). */
  weight(x: number, z: number, blend: number): number {
    const d = this.def;
    const e = Math.min(x - d.originX, this.x1 - x, z - d.originZ, this.z1 - z);
    return e <= 0 ? 0 : smoothstep(0, blend * d.cell, e);
  }

  /** Bicubic (Catmull-Rom) sample, clamped at the edges. */
  sample(x: number, z: number): number {
    const d = this.def;
    const fx = (x - d.originX) / d.cell;
    const fz = (z - d.originZ) / d.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    let r = 0;
    for (let m = -1; m <= 2; m++) {
      const jj = Math.min(d.rows - 1, Math.max(0, j + m)) * d.cols;
      const row =
        cr(
          this.h[jj + Math.min(d.cols - 1, Math.max(0, i - 1))],
          this.h[jj + Math.min(d.cols - 1, Math.max(0, i))],
          this.h[jj + Math.min(d.cols - 1, Math.max(0, i + 1))],
          this.h[jj + Math.min(d.cols - 1, Math.max(0, i + 2))],
          tx,
        ) * crWeight(m, tz);
      r += row;
    }
    return r;
  }
}

/** Catmull-Rom interpolation between b and c. */
function cr(a: number, b: number, c: number, d: number, t: number): number {
  return (
    b +
    0.5 *
      t *
      (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
  );
}

/** Catmull-Rom basis weight of tap m (-1..2) at t. */
function crWeight(m: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  switch (m) {
    case -1:
      return 0.5 * (-t3 + 2 * t2 - t);
    case 0:
      return 0.5 * (3 * t3 - 5 * t2 + 2);
    case 1:
      return 0.5 * (-3 * t3 + 4 * t2 + t);
    default:
      return 0.5 * (t3 - t2);
  }
}

/** Real elevation: fine grid blended into the coarse horizon grid. */
export class RealHeight {
  private grids: HeightGrid[];
  private offset: number;

  constructor(def: HeightmapDef) {
    this.grids = def.grids.map((g) => new HeightGrid(g, def.base, def.step));
    this.offset = def.offset ?? 0;
  }

  height(x: number, z: number): number {
    let h = 0;
    let wLeft = 1;
    for (let k = 0; k < this.grids.length && wLeft > 0; k++) {
      const g = this.grids[k];
      const last = k === this.grids.length - 1;
      const w = last ? 1 : g.weight(x, z, 6);
      if (w <= 0) continue;
      h += g.sample(x, z) * w * wLeft;
      wLeft *= 1 - w;
    }
    return h - this.offset;
  }
}

/** Land cover zone raster (nearest cell) with bilinear helpers. */
export class Landcover {
  readonly zones: Uint8Array;
  readonly coverNames: string[];
  /** zone -> index into coverNames */
  readonly zoneCover: Uint8Array;

  constructor(readonly def: LandcoverDef) {
    const n = def.cols * def.rows;
    this.zones = new Uint8Array(n);
    const bytes = base64Bytes(def.rle);
    let p = 0;
    let o = 0;
    while (p < bytes.length && o < n) {
      const v = bytes[p++];
      let len = 0;
      let shift = 0;
      let b: number;
      do {
        b = bytes[p++];
        len |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      this.zones.fill(v, o, Math.min(n, o + len));
      o += len;
    }
    this.coverNames = [...new Set(def.zones.map((z) => z.cover))];
    this.zoneCover = new Uint8Array(
      def.zones.map((z) => this.coverNames.indexOf(z.cover)),
    );
  }

  /** Zone id at a point, -1 outside the raster. */
  zoneAt(x: number, z: number): number {
    const d = this.def;
    const i = Math.floor((x - d.originX) / d.cell);
    const j = Math.floor((z - d.originZ) / d.cell);
    if (i < 0 || j < 0 || i >= d.cols || j >= d.rows) return -1;
    return this.zones[j * d.cols + i];
  }

  coverAt(x: number, z: number): string | undefined {
    const zone = this.zoneAt(x, z);
    return zone < 0 ? undefined : this.def.zones[zone].cover;
  }

  /** Bool per zone: zone's cover is in `covers`. */
  zoneMask(covers: string[]): Uint8Array {
    return new Uint8Array(
      this.def.zones.map((z) => (covers.includes(z.cover) ? 1 : 0)),
    );
  }
}

export interface PathQuery {
  found: boolean;
  /** Distance from the path centreline (m). */
  distance: number;
  halfWidth: number;
  path: number;
  /** Distance along that path to the nearest centreline point (m). */
  along: number;
}

export function newPathQuery(): PathQuery {
  return { found: false, distance: Infinity, halfWidth: 0, path: -1, along: 0 };
}

const PCELL = 32;
/** Length of a lane-drop taper (m). */
const TAPER_LEN = 45;
/** Paths affect terrain at most this far beyond their edge (m). */
export const PATH_REACH = 10;

/** Other roads / tracks / canals with a spatial grid for nearest-edge queries. */
export class PathNetwork {
  private segs: Float32Array;
  private segPath: Uint16Array;
  /** Distance along its path at each segment start (m). */
  private segAlong: Float32Array;
  /** Length of each path (m). */
  readonly lengths: number[] = [];
  private grid = new Map<number, number[]>();
  private twoScratch: {
    pi: number;
    edge: number;
    d: number;
    hw: number;
    along: number;
  }[] = [];

  /** Half width at each path's start / end (the width tapers to meet a continuing way of another width). */
  private endHw: Float32Array;
  /** Length over which each path tapers (m). */
  private taper: Float32Array;

  constructor(readonly paths: PathDef[]) {
    const segs: number[] = [];
    const sp: number[] = [];
    const sa: number[] = [];
    paths.forEach((p, pi) => {
      let along = 0;
      for (let k = 0; k + 3 < p.pts.length; k += 2) {
        segs.push(p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]);
        sp.push(pi);
        sa.push(along);
        along += Math.hypot(
          p.pts[k + 2] - p.pts[k],
          p.pts[k + 3] - p.pts[k + 1],
        );
      }
      this.lengths.push(along);
    });
    this.endHw = new Float32Array(paths.length * 2);
    this.taper = new Float32Array(paths.length);
    this.buildTapers();
    this.segs = new Float32Array(segs);
    this.segPath = new Uint16Array(sp);
    this.segAlong = new Float32Array(sa);
    for (let s = 0; s < sp.length; s++) {
      const r = paths[sp[s]].width / 2 + PATH_REACH;
      const o = s * 4;
      const ax = this.segs[o];
      const az = this.segs[o + 1];
      const bx = this.segs[o + 2];
      const bz = this.segs[o + 3];
      const x0 = Math.floor((Math.min(ax, bx) - r) / PCELL);
      const x1 = Math.floor((Math.max(ax, bx) + r) / PCELL);
      const z0 = Math.floor((Math.min(az, bz) - r) / PCELL);
      const z1 = Math.floor((Math.max(az, bz) + r) / PCELL);
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          const k = (cx + 32768) * 65536 + (cz + 32768);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(s);
        }
    }
  }

  /**
   * Where a carriageway continues into a way of another width (a lane drop / lane gain), both ribbons narrow
   * or widen to the mean over TAPER_LEN so the roads meet without a notch. Only for carriageways of the
   * same class (OSM kind) that join end to end (collinear), never at junctions.
   */
  private buildTapers(): void {
    const n = this.paths.length;
    const ends: { x: number; z: number; dx: number; dz: number }[] = [];
    for (const p of this.paths) {
      const m = p.pts.length;
      for (const atEnd of [false, true]) {
        const e = atEnd ? m - 2 : 0;
        const q = atEnd ? m - 4 : 2;
        const dx = p.pts[e] - p.pts[q];
        const dz = p.pts[e + 1] - p.pts[q + 1];
        const l = Math.hypot(dx, dz) || 1;
        ends.push({ x: p.pts[e], z: p.pts[e + 1], dx: dx / l, dz: dz / l });
      }
    }
    for (let i = 0; i < n; i++) {
      const p = this.paths[i];
      this.endHw[i * 2] = this.endHw[i * 2 + 1] = p.width / 2;
      this.taper[i] = 0;
    }
    const grid = new Map<string, number[]>();
    ends.forEach((e, k) => {
      const key = `${Math.floor(e.x / 4)},${Math.floor(e.z / 4)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
    });
    for (let i = 0; i < n; i++) {
      const p = this.paths[i];
      if (p.surface !== 'tarmac') continue;
      const L = this.lengths[i];
      for (const atEnd of [false, true]) {
        const a = ends[i * 2 + (atEnd ? 1 : 0)];
        const near: number[] = [];
        for (let gx = -1; gx <= 1; gx++)
          for (let gz = -1; gz <= 1; gz++)
            near.push(
              ...(grid.get(
                `${Math.floor(a.x / 4) + gx},${Math.floor(a.z / 4) + gz}`,
              ) ?? []),
            );
        let join = -1;
        for (const k of near) {
          const j = k >> 1;
          if (j === i) continue;
          const q = this.paths[j];
          if (q.surface !== 'tarmac' || q.kind !== p.kind) continue;
          const b = ends[k];
          if (Math.hypot(a.x - b.x, a.z - b.z) > 1.5) continue;
          // End to end: the other way leaves in the direction this one arrives.
          if (a.dx * -b.dx + a.dz * -b.dz < 0.85) continue;
          if (join >= 0) {
            join = -2; // a fork / merge: leave it alone
            break;
          }
          join = j;
        }
        if (join < 0) continue;
        const q = this.paths[join];
        if (Math.abs(q.width - p.width) < 0.6) continue;
        this.endHw[i * 2 + (atEnd ? 1 : 0)] = (p.width + q.width) / 4;
        this.taper[i] = Math.max(this.taper[i], Math.min(TAPER_LEN, L * 0.45));
      }
    }
  }

  /** Half width of path `pi` at `along` metres: its own, tapering towards the ends that meet a different width. */
  halfWidthAt(pi: number, along: number): number {
    const hw = this.paths[pi].width / 2;
    const T = this.taper[pi];
    if (T <= 0) return hw;
    const L = this.lengths[pi];
    const s = Math.max(0, 1 - along / T);
    const e = Math.max(0, 1 - (L - along) / T);
    return (
      hw +
      (this.endHw[pi * 2] - hw) * s * s * (3 - 2 * s) +
      (this.endHw[pi * 2 + 1] - hw) * e * e * (3 - 2 * e)
    );
  }

  /**
   * Path whose EDGE is nearest to (x, z) within PATH_REACH, optionally only paths with
   * a given surface / accepted by `accept(pathIndex)`. `distance` is from the centreline.
   */
  query(
    x: number,
    z: number,
    out: PathQuery,
    surface?: PathDef['surface'],
    accept?: (path: number) => boolean,
  ): PathQuery {
    out.found = false;
    out.distance = Infinity;
    const l = this.grid.get(
      (Math.floor(x / PCELL) + 32768) * 65536 + (Math.floor(z / PCELL) + 32768),
    );
    if (!l) return out;
    let best = PATH_REACH;
    const s = this.segs;
    for (let k = 0; k < l.length; k++) {
      const si = l[k];
      const p = this.paths[this.segPath[si]];
      if (surface && p.surface !== surface) continue;
      if (accept && !accept(this.segPath[si])) continue;
      const o = si * 4;
      const ex = s[o + 2] - s[o];
      const ez = s[o + 3] - s[o + 1];
      const len2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - s[o]) * ex + (z - s[o + 1]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(s[o] + ex * t - x, s[o + 1] + ez * t - z);
      const edge = d - p.width / 2;
      if (edge < best) {
        best = edge;
        out.found = true;
        out.distance = d;
        out.halfWidth = p.width / 2;
        out.path = this.segPath[si];
        out.along = this.segAlong[si] + t * Math.sqrt(len2);
      }
    }
    return out;
  }

  /**
   * Like `query`, but also reports the NEAREST OTHER path (second best, a different path index) in `out2`:
   * where two roads run close together at different heights the terrain blends both instead of flipping
   * between them at the line where they are equally near.
   */
  queryTwo(
    x: number,
    z: number,
    out: PathQuery,
    out2: PathQuery,
    accept?: (path: number) => boolean,
  ): PathQuery {
    out.found = false;
    out.distance = Infinity;
    out2.found = false;
    out2.distance = Infinity;
    const l = this.grid.get(
      (Math.floor(x / PCELL) + 32768) * 65536 + (Math.floor(z / PCELL) + 32768),
    );
    if (!l) return out;
    const s = this.segs;
    // Nearest segment per path (a cell holds few paths).
    const seen = this.twoScratch;
    seen.length = 0;
    for (let k = 0; k < l.length; k++) {
      const si = l[k];
      const pi = this.segPath[si];
      if (accept && !accept(pi)) continue;
      const hw = this.paths[pi].width / 2;
      const o = si * 4;
      const ex = s[o + 2] - s[o];
      const ez = s[o + 3] - s[o + 1];
      const len2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - s[o]) * ex + (z - s[o + 1]) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(s[o] + ex * t - x, s[o + 1] + ez * t - z);
      const edge = d - hw;
      if (edge >= PATH_REACH) continue;
      const along = this.segAlong[si] + t * Math.sqrt(len2);
      const prev = seen.find((c) => c.pi === pi);
      if (!prev) seen.push({ pi, edge, d, hw, along });
      else if (edge < prev.edge) {
        prev.edge = edge;
        prev.d = d;
        prev.along = along;
      }
    }
    if (!seen.length) return out;
    seen.sort((a, b) => a.edge - b.edge);
    const fill = (q: PathQuery, c: (typeof seen)[number]) => {
      q.found = true;
      q.distance = c.d;
      q.halfWidth = c.hw;
      q.path = c.pi;
      q.along = c.along;
    };
    fill(out, seen[0]);
    if (seen.length > 1) fill(out2, seen[1]);
    return out;
  }

  /** Point at `along` metres on path `pi` (clamped to its ends). */
  pointAt(pi: number, along: number, out: { x: number; z: number }): void {
    const pts = this.paths[pi].pts;
    let a = Math.max(0, along);
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const L = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
      if (a <= L || k + 5 >= pts.length) {
        const t = L > 0 ? Math.min(1, a / L) : 0;
        out.x = pts[k] + (pts[k + 2] - pts[k]) * t;
        out.z = pts[k + 1] + (pts[k + 3] - pts[k + 1]) * t;
        return;
      }
      a -= L;
    }
    out.x = pts[0];
    out.z = pts[1];
  }
}

/**
 * World (x, z) -> WGS84 for real-world maps. Same local projection as
 * scripts/realmap/bake.py (+X east, +Z south from `origin`).
 */
export function worldToGeo(
  origin: { lat: number; lon: number },
  x: number,
  z: number,
): { lat: number; lon: number } {
  const p = (origin.lat * Math.PI) / 180;
  const my = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  return { lat: origin.lat - z / my, lon: origin.lon + x / mx };
}
