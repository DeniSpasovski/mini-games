import { BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyStation, CarDef } from './types';

/**
 * Procedural body shape: the lofted lower body + greenhouse surfaces, plus
 * helpers to build "skin patches" - decals that follow the body surface
 * exactly (headlights, vents, window glass + frames, side skirts...).
 *
 * Model space: y = 0 ground at ride height, z = 0 centre of mass, +Z forward.
 * Profiles describe the LEFT half (+X), from the underside centre / beltline
 * round to the top centreline; the right half is mirrored.
 */

export type Profile = [number, number][];

export interface LoftSlice {
  z: number;
  /** 0..1 along the car (rear -> front), drives livery u. */
  t: number;
  /** Half profile for the LEFT side (+X), from bottom/inner to top centre. */
  pts: Profile;
  /** Livery v parameter per profile point (0 = sill, 1 = centreline top). */
  s: number[];
}

export const SLICES = 120;

/** A lofted surface (list of slices along z) that patches can be laid on. */
export class Surface {
  constructor(readonly slices: LoftSlice[]) {}

  get zMin(): number {
    return this.slices[0].z;
  }
  get zMax(): number {
    return this.slices[this.slices.length - 1].z;
  }

  /** Profile linearly interpolated at z (clamped to the surface's z range). */
  profile(z: number): Profile {
    const sl = this.slices;
    if (z <= sl[0].z) return sl[0].pts;
    if (z >= sl[sl.length - 1].z) return sl[sl.length - 1].pts;
    let lo = 0;
    let hi = sl.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sl[mid].z <= z) lo = mid;
      else hi = mid;
    }
    const a = sl[lo].pts;
    const b = sl[hi].pts;
    const t = (z - sl[lo].z) / (sl[hi].z - sl[lo].z);
    return a.map((p, i) => [
      p[0] + (b[i][0] - p[0]) * t,
      p[1] + (b[i][1] - p[1]) * t,
    ]);
  }

  /**
   * Skin patch: a decal following this surface. `range(z, profile)` returns the
   * covered span as fractional profile indices [a0, a1] (or null = no patch at
   * this z). Built on both sides (mirrored) unless `oneSide`.
   * UV = (z, arc length from a0) in metres - for tiling textures (mesh grilles).
   */
  patch(
    z0: number,
    z1: number,
    range: (z: number, pts: Profile) => [number, number] | null,
    opts: {
      offset?: number;
      step?: number;
      astep?: number;
      oneSide?: boolean;
    } = {},
  ): BufferGeometry {
    const offset = opts.offset ?? 0.004;
    // z step ~ loft slice spacing; across: small enough that chords over convex
    // corners stay well under `offset`.
    const step = opts.step ?? 0.035;
    const astep = opts.astep ?? 0.03;
    const nz = Math.max(1, Math.min(160, Math.ceil(Math.abs(z1 - z0) / step)));
    const rows: ({ pts: Profile; a0: number; a1: number } | null)[] = [];
    let maxArc = 0;
    for (let i = 0; i <= nz; i++) {
      const z = z0 + ((z1 - z0) * i) / nz;
      const pts = this.profile(z);
      const r = range(z, pts);
      if (!r || !(r[1] - r[0] > 1e-4)) {
        rows.push(null);
        continue;
      }
      rows.push({ pts, a0: r[0], a1: r[1] });
      maxArc = Math.max(maxArc, arcBetween(pts, r[0], r[1]));
    }
    const na = Math.max(1, Math.min(40, Math.ceil(maxArc / astep)));
    const sides = opts.oneSide ? [1] : [1, -1];
    const out: BufferGeometry[] = [];
    for (const side of sides) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const rowStart: number[] = [];
      rows.forEach((row, i) => {
        rowStart.push(pos.length / 3);
        if (!row) return;
        const z = z0 + ((z1 - z0) * i) / nz;
        const as: number[] = [];
        for (let j = 0; j <= na; j++)
          as.push(row.a0 + ((row.a1 - row.a0) * j) / na);
        let arc = 0;
        let prev: [number, number] | null = null;
        for (const a of as) {
          const [x, y, nx, ny] = pointAt(row.pts, a);
          const px = x + nx * offset;
          const py = y + ny * offset;
          if (prev) arc += Math.hypot(px - prev[0], py - prev[1]);
          prev = [px, py];
          pos.push(side * px, py, z);
          uv.push(z, arc);
        }
      });
      for (let i = 0; i < nz; i++) {
        if (!rows[i] || !rows[i + 1]) continue;
        for (let j = 0; j < na; j++) {
          const a = rowStart[i] + j;
          const b = a + 1;
          const c = rowStart[i + 1] + j;
          const d = c + 1;
          const fwd = z1 > z0 === side > 0;
          if (fwd) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
      if (!idx.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      out.push(g.toNonIndexed());
      g.dispose();
    }
    if (!out.length) return emptyGeometry();
    if (out.length === 1) return out[0];
    const merged = mergeGeometries(out, false)!;
    out.forEach((g) => g.dispose());
    return merged;
  }
}

export function emptyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(0), 2));
  return g;
}

// --- profile helpers ---------------------------------------------------------------------

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Point + outward 2D normal at fractional index `a` of a profile. */
export function pointAt(
  pts: Profile,
  a: number,
): [number, number, number, number] {
  const n = pts.length - 1;
  a = clamp(a, 0, n);
  const i = Math.min(n - 1, Math.floor(a));
  const f = a - i;
  const p = pts[i];
  const q = pts[i + 1];
  const x = p[0] + (q[0] - p[0]) * f;
  const y = p[1] + (q[1] - p[1]) * f;
  // Profiles run counter-clockwise (seen from +Z) -> outward = (ty, -tx).
  let [nx, ny] = segNormal(pts, i);
  if (f < 1e-6 && i > 0) {
    const [px, py] = segNormal(pts, i - 1);
    nx += px;
    ny += py;
  } else if (f > 1 - 1e-6 && i + 1 < n) {
    const [qx, qy] = segNormal(pts, i + 1);
    nx += qx;
    ny += qy;
  }
  const l = Math.hypot(nx, ny) || 1;
  return [x, y, nx / l, ny / l];
}

function segNormal(pts: Profile, i: number): [number, number] {
  // Skip degenerate segments (collapsed flare steps etc).
  for (let k = 0; k < pts.length; k++) {
    for (const j of [i + k, i - k]) {
      if (j < 0 || j >= pts.length - 1) continue;
      const tx = pts[j + 1][0] - pts[j][0];
      const ty = pts[j + 1][1] - pts[j][1];
      const l = Math.hypot(tx, ty);
      if (l > 1e-5) return [ty / l, -tx / l];
    }
  }
  return [1, 0];
}

/** Arc length along the profile between fractional indices a0 < a1. */
export function arcBetween(pts: Profile, a0: number, a1: number): number {
  let len = 0;
  let [px, py] = pointAt(pts, a0);
  for (let i = Math.floor(a0) + 1; i < a1; i++) {
    len += Math.hypot(pts[i][0] - px, pts[i][1] - py);
    [px, py] = pts[i];
  }
  const [x, y] = pointAt(pts, a1);
  return len + Math.hypot(x - px, y - py);
}

/** Fractional index reached by walking `d` metres along the profile from index `a` (d may be negative). */
export function arcIdx(pts: Profile, a: number, d: number): number {
  const n = pts.length - 1;
  const dir = d >= 0 ? 1 : -1;
  let left = Math.abs(d);
  let cur = clamp(a, 0, n);
  while (left > 0) {
    const next = dir > 0 ? Math.floor(cur) + 1 : Math.ceil(cur) - 1;
    if (next < 0 || next > n) return clamp(cur, 0, n);
    const [x0, y0] = pointAt(pts, cur);
    const [x1, y1] = pts[next];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg >= left) return cur + ((next - cur) * left) / Math.max(seg, 1e-9);
    left -= seg;
    cur = next;
  }
  return cur;
}

/** First fractional index (searching upward from `from`) where the profile reaches height y. */
export function idxAtY(pts: Profile, y: number, from = 1): number {
  if (y <= pts[from][1]) return from;
  for (let i = from; i < pts.length - 1; i++) {
    const y0 = pts[i][1];
    const y1 = pts[i + 1][1];
    if (y >= y0 && y <= y1 && y1 > y0) return i + (y - y0) / (y1 - y0);
  }
  return pts.length - 1;
}

/** Fractional index on the top surface (searching from the centreline outward) at half-width x. */
export function idxAtX(pts: Profile, x: number): number {
  for (let i = pts.length - 2; i >= 0; i--) {
    const x0 = pts[i][0];
    const x1 = pts[i + 1][0];
    if (x <= x0 && x >= x1 && x0 > x1) return i + (x0 - x) / (x0 - x1);
  }
  return 0;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function catmull(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

// --- body shape --------------------------------------------------------------------------

/**
 * The car's body: station spline, wide-body flares and the two lofted surfaces.
 * `wide` (parts.arches === 'box') = Rally1-style wide body: the flares are part
 * of the lower-body loft (fender boxes over both axles joined by a flared sill
 * whose top line sweeps up towards the rear arch).
 */
export class BodyShape {
  readonly wide: boolean;
  /** Wheel-arch opening radius. */
  readonly archR: number;
  readonly zFront: number;
  readonly zRear: number;
  readonly lower: Surface;
  readonly cabin: Surface;
  /** Front / rear fender spans (z) for the wide body. */
  readonly fenderFront: [number, number];
  readonly fenderRear: [number, number];

  constructor(readonly def: CarDef) {
    const p = def.physics;
    const st = def.model.stations;
    this.wide = def.model.parts.arches === 'box';
    this.archR = p.wheelRadius + (this.wide ? 0.07 : 0.06);
    this.zRear = st[0].z;
    this.zFront = st[st.length - 1].z;
    this.fenderFront = [p.front.z - this.archR - 0.17, this.zFront];
    this.fenderRear = [this.zRear, p.rear.z + this.archR + 0.12];
    this.lower = new Surface(this.lowerSlices());
    this.cabin = new Surface(this.cabinSlices());
  }

  station(z: number): BodyStation {
    const st = this.def.model.stations;
    if (z <= st[0].z) return st[0];
    if (z >= st[st.length - 1].z) return st[st.length - 1];
    let i = 0;
    while (st[i + 1].z < z) i++;
    const a = st[Math.max(0, i - 1)];
    const b = st[i];
    const c = st[i + 1];
    const d = st[Math.min(st.length - 1, i + 2)];
    const t = (z - b.z) / (c.z - b.z);
    const cr = (k: keyof BodyStation) => catmull(a[k], b[k], c[k], d[k], t);
    return {
      z,
      floor: cr('floor'),
      belt: cr('belt'),
      hw: cr('hw'),
      hwBelt: cr('hwBelt'),
    };
  }

  /** Raise the floor over the wheels so the arches are open. */
  archFloor(z: number, floor: number, belt: number): number {
    const p = this.def.physics;
    const R = this.archR;
    for (const az of [p.front.z, p.rear.z]) {
      const dz = z - az;
      if (Math.abs(dz) < R)
        floor = Math.max(floor, p.wheelRadius + Math.sqrt(R * R - dz * dz));
    }
    return Math.min(floor, belt - 0.14);
  }

  /** Height of the wheel-arch top. */
  get archTop(): number {
    return this.def.physics.wheelRadius + this.archR;
  }

  /** Wide body: how far the flare sticks out at z, and the height of its top edge. */
  flare(z: number): { out: number; top: number } {
    if (!this.wide) return { out: 0, top: 0 };
    const F = this.def.model.flare;
    const s = this.station(z);
    const [ff0] = this.fenderFront;
    const [, rr1] = this.fenderRear;
    const front = smoothstep(ff0 - 0.05, ff0 + 0.05, z);
    const rear = 1 - smoothstep(rr1 - 0.05, rr1 + 0.05, z);
    const fender = Math.max(front, rear);
    const archTop = this.archTop + 0.07;
    // Door section: sill blade whose top line sweeps up into the rear fender.
    const t = clamp((z - rr1) / (ff0 - rr1), 0, 1);
    const sill = 0.34 + 0.18 * (1 - t) ** 1.6;
    // Nose / tail: round the bumper corners in plan.
    const ends =
      smoothstep(this.zRear - 0.02, this.zRear + 0.22, z) *
      (1 - smoothstep(this.zFront - 0.22, this.zFront + 0.02, z));
    return {
      out: F * (0.6 + 0.4 * fender) * (0.45 + 0.55 * ends),
      top: Math.min(sill + (archTop - sill) * fender, s.belt - 0.08),
    };
  }

  private lowerSlices(): LoftSlice[] {
    const z0 = this.zRear;
    const z1 = this.zFront;
    const slices: LoftSlice[] = [];
    for (let k = 0; k <= SLICES; k++) {
      const z = z0 + ((z1 - z0) * k) / SLICES;
      const s = this.station(z);
      const floor = this.archFloor(z, s.floor, s.belt);
      const t = (z - z0) / (z1 - z0);
      const { hw, hwBelt, belt } = s;
      if (!this.wide) {
        const h = belt - floor;
        slices.push({
          z,
          t,
          pts: [
            [0, floor],
            [hw * 0.8, floor],
            [hw * 0.95, floor + 0.035],
            [hw, floor + Math.min(0.12, h * 0.2)],
            [hw, floor + h * 0.55],
            [hw * 0.985, floor + h * 0.8],
            [hw + (hwBelt - hw) * 0.75, belt - 0.025],
            [hwBelt * 0.92, belt + 0.012],
            [hwBelt * 0.55, belt + 0.03],
            [0, belt + 0.035],
          ],
          s: [0, 0.06, 0.1, 0.16, 0.42, 0.6, 0.74, 0.8, 0.9, 1],
        });
        continue;
      }
      const f = this.flare(z);
      const hwE = hw + f.out;
      const top = clamp(f.top, floor + 0.1, belt - 0.06);
      const pts: Profile = [
        [0, floor],
        [hwE * 0.86, floor],
        [hwE - 0.012, floor + 0.022],
        [hwE, floor + 0.06],
        [hwE, top - 0.035],
        [hwE - 0.01, top - 0.006],
        [hw + f.out * 0.3, top + 0.008],
        [hw + 0.003, top + 0.03],
        [hw, top + 0.06],
        [hw * 0.99, belt - 0.12],
        [hw + (hwBelt - hw) * 0.75, belt - 0.025],
        [hwBelt * 0.92, belt + 0.012],
        [hwBelt * 0.55, belt + 0.03],
        [0, belt + 0.035],
      ];
      for (let i = 2; i < pts.length; i++)
        pts[i][1] = Math.max(pts[i][1], pts[i - 1][1] + 0.002);
      // Livery v by height, so the paint isn't squashed over the arches.
      const sv = pts.map(([, y], i) =>
        i === 0
          ? 0
          : i >= 11
            ? [0.8, 0.9, 1][i - 11]
            : 0.04 + 0.7 * clamp((y - s.floor) / (belt - s.floor), 0, 1),
      );
      slices.push({ z, t, pts, s: sv });
    }
    return slices;
  }

  private cabinSlices(): LoftSlice[] {
    const c = this.def.model.cabin;
    const n = 100;
    const slices: LoftSlice[] = [];
    for (let k = 0; k <= n; k++) {
      const z = c.zRear + ((c.zFront - c.zRear) * k) / n;
      const s = this.station(z);
      const hwB = s.hwBelt * 0.95;
      const baseY = s.belt + 0.03;
      let top = c.roofY;
      let hwT = c.roofHw;
      if (z > c.roofFront) {
        const f = (z - c.roofFront) / (c.zFront - c.roofFront);
        top = c.roofY + (baseY - c.roofY) * f;
        hwT = c.roofHw + (hwB - c.roofHw) * f * 0.7;
      } else if (z < c.roofRear) {
        const f = (c.roofRear - z) / (c.roofRear - c.zRear);
        top = c.roofY + (baseY - c.roofY) * f;
        hwT = c.roofHw + (hwB - c.roofHw) * f * 0.7;
      }
      const lift = Math.max(0.005, top - baseY);
      const crown = Math.min(1, lift / 0.3);
      // Side face (beltline -> roof rail) and roof / screens (rail -> centre),
      // both evenly subdivided so window cut-outs line up with the frames.
      const rail: [number, number] = [hwT, baseY + lift * 0.94];
      const pts: Profile = [];
      for (let i = 0; i < CABIN_RAIL; i++) {
        const f = i / CABIN_RAIL;
        pts.push([hwB + (rail[0] - hwB) * f, baseY + (rail[1] - baseY) * f]);
      }
      pts.push(
        ...resample(
          [
            rail,
            [hwT * 0.86, baseY + lift],
            [hwT * 0.42, baseY + lift + 0.03 * crown],
            [0, baseY + lift + 0.035 * crown],
          ],
          CABIN_TOP,
        ),
      );
      slices.push({
        z,
        t: (z - this.zRear) / (this.zFront - this.zRear),
        pts,
        s: pts.map((_, i) =>
          i <= CABIN_RAIL
            ? 0.86 + (0.04 * i) / CABIN_RAIL
            : 0.9 + (0.1 * (i - CABIN_RAIL)) / CABIN_TOP,
        ),
      });
    }
    return slices;
  }

  get bPillar(): number {
    const c = this.def.model.cabin;
    return c.bPillar ?? (c.roofFront + c.roofRear) / 2 + 0.05;
  }

  /**
   * Window openings on the greenhouse (side windows, windscreen, rear screen).
   * `range(pad)` grows the opening by `pad` metres (frames / cut-out checks).
   */
  windows(): WindowDef[] {
    if (this.windowCache) return this.windowCache;
    const c = this.def.model.cabin;
    const bz = this.bPillar;
    const bh = 0.045;
    const zc = c.roofRear + (c.zRear - c.roofRear) * 0.3;
    const side = (z0: number, z1: number, kick: number): WindowDef => ({
      z0,
      z1,
      range: (pad) => (z, pts) => {
        if (z < z0 - pad || z > z1 + pad) return null;
        const top = arcIdx(pts, CABIN_RAIL, -0.035 + pad);
        let bot = arcIdx(pts, 0, 0.03 - pad);
        if (kick > 0)
          bot += (top - bot) * smoothstep(z0 - pad + kick, z0 - pad, z);
        return top - bot > 0.02 ? [bot, top] : null;
      },
    });
    const screen = (z0: number, z1: number, inset: number): WindowDef => ({
      z0,
      z1,
      range: (pad) => (z, pts) =>
        z < z0 - pad || z > z1 + pad
          ? null
          : [arcIdx(pts, CABIN_RAIL, inset - pad), pts.length - 1],
    });
    return (this.windowCache = [
      side(bz + bh, c.zFront, 0),
      side(zc, bz - bh, c.kick ?? 0),
      screen(c.roofFront + 0.035, c.zFront - 0.03, 0.05),
      screen(c.zRear + 0.045, c.roofRear - 0.05, 0.06),
    ]);
  }
  private windowCache?: WindowDef[];

  /** Material index per greenhouse quad: 0 = paint, -1 = window cut-out. */
  cabinQuad = (k: number, seg: number): number => {
    const sl = this.cabin.slices;
    const z = (sl[k].z + sl[k + 1].z) / 2;
    const pts = this.cabin.profile(z);
    const a = seg + 0.5;
    for (const w of this.windows()) {
      const r = w.range(0)(z, pts);
      if (r && a > r[0] && a < r[1]) return -1;
    }
    return 0;
  };
}

/** Greenhouse profile: points 0..CABIN_RAIL = side face, then CABIN_TOP roof segments. */
export const CABIN_RAIL = 12;
const CABIN_TOP = 16;

export interface WindowDef {
  z0: number;
  z1: number;
  range: (pad: number) => Range;
}

export type Range = (z: number, pts: Profile) => [number, number] | null;

/** Resample a polyline into `n` equal-length segments (n + 1 points). */
function resample(line: Profile, n: number): Profile {
  const cum = [0];
  for (let i = 1; i < line.length; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]),
    );
  const total = cum[cum.length - 1];
  const out: Profile = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (j < line.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, (d - cum[j]) / seg);
    out.push([
      line[j][0] + (line[j + 1][0] - line[j][0]) * f,
      line[j][1] + (line[j + 1][1] - line[j][1]) * f,
    ]);
  }
  return out;
}

// --- loft geometry ---------------------------------------------------------------------

/**
 * Loft both halves of a symmetric body. `matOf(slice, segment)` returns a
 * material index (-1 = leave a hole); triangles are grouped per material.
 */
export function loft(
  slices: LoftSlice[],
  matOf: (k: number, seg: number) => number,
  materials: number,
): BufferGeometry {
  const P = slices[0].pts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const groups: number[][] = Array.from({ length: materials }, () => []);
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const sl of slices) {
      for (let p = 0; p < P; p++) {
        pos.push(side * sl.pts[p][0], sl.pts[p][1], sl.z);
        // Right side (x<0) = top half of the atlas, left side = bottom half; see livery.ts.
        if (side < 0) uv.push(sl.t, 0.5 + sl.s[p] / 2);
        else uv.push(1 - sl.t, sl.s[p] / 2);
      }
    }
    for (let k = 0; k < slices.length - 1; k++) {
      for (let p = 0; p < P - 1; p++) {
        const a = base + k * P + p;
        const b = a + 1;
        const c = a + P;
        const d = c + 1;
        const mi = matOf(k, p);
        if (mi < 0) continue; // cut-out
        const g = groups[mi];
        if (side > 0) g.push(a, b, c, b, d, c);
        else g.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  const index: number[] = [];
  groups.forEach((g, i) => {
    geo.addGroup(index.length, g.length, i);
    index.push(...g);
  });
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Flat caps closing the front and rear of the lower body (non-indexed). */
export function endCaps(slices: LoftSlice[]): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const cap = (sl: LoftSlice, rear: boolean) => {
    const P = sl.pts.length;
    const cy = (sl.pts[0][1] + sl.pts[P - 1][1]) / 2;
    for (const side of [1, -1]) {
      for (let p = 0; p < P - 1; p++) {
        const a = sl.pts[p];
        const b = sl.pts[p + 1];
        const tri: [number, number][] = [[0, cy], a, b];
        // Winding: outward = -Z at the rear, +Z at the front; mirrored side flips.
        const flip = side > 0 === rear;
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        for (const o of order) {
          pos.push(side * tri[o][0], tri[o][1], sl.z);
          // s = 0.35: base paint in every livery style.
          uv.push(side < 0 ? sl.t : 1 - sl.t, 0.35 / 2 + (side < 0 ? 0.5 : 0));
        }
      }
    }
  };
  cap(slices[0], true);
  cap(slices[slices.length - 1], false);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  return g;
}
