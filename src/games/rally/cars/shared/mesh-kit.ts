import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';

/**
 * Small mesh-building toolkit for hand-built car bodies (`CarModelDef.custom`, e.g.
 * cars/zastava-101/body.ts): a triangle soup with UVs, auto-oriented grids and polygons,
 * profile sweeps and creased normals. DOM-free.
 */
export type V3 = [number, number, number];
export type P2 = [number, number];
export interface Vtx {
  p: V3;
  uv: P2;
}

export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Piecewise-linear lookup in a table of [x, y] rows sorted by ascending x (clamped at the ends). */
export function table(pts: readonly P2[]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    const n = pts.length - 1;
    if (x >= pts[n][0]) return pts[n][1];
    let i = 0;
    while (pts[i + 1][0] < x) i++;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
}

/** Smooth (Catmull-Rom) lookup through [x, y] rows sorted by ascending x. */
export function spline(pts: readonly P2[]): (x: number) => number {
  return (x) => {
    const n = pts.length - 1;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n][0]) return pts[n][1];
    let i = 0;
    while (pts[i + 1][0] < x) i++;
    const p0 = pts[Math.max(0, i - 1)][1];
    const p1 = pts[i][1];
    const p2 = pts[i + 1][1];
    const p3 = pts[Math.min(n, i + 2)][1];
    const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  };
}

const NO_UV: P2 = [0, 0];
/** Vertex without a meaningful UV (untextured materials). */
export const vtx = (x: number, y: number, z: number, uv: P2 = NO_UV): Vtx => ({
  p: [x, y, z],
  uv,
});

/** Triangle soup: positions + UVs, turned into a geometry with creased normals. */
export class Soup {
  readonly pos: number[] = [];
  readonly uv: number[] = [];

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** Triangle; flipped when needed so that its normal points along `out` (if given). Degenerates are dropped. */
  tri(a: Vtx, b: Vtx, c: Vtx, out?: V3): void {
    const [ax, ay, az] = a.p;
    const ux = b.p[0] - ax;
    const uy = b.p[1] - ay;
    const uz = b.p[2] - az;
    const vx = c.p[0] - ax;
    const vy = c.p[1] - ay;
    const vz = c.p[2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;
    if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) [b, c] = [c, b];
    this.pos.push(...a.p, ...b.p, ...c.p);
    this.uv.push(...a.uv, ...b.uv, ...c.uv);
  }

  quad(a: Vtx, b: Vtx, c: Vtx, d: Vtx, out?: V3): void {
    this.tri(a, b, c, out);
    this.tri(a, c, d, out);
  }

  /** Quads between consecutive rows of a vertex grid; `skip(i, j)` leaves cell (row i, column j) open. */
  grid(
    rows: Vtx[][],
    out?: V3,
    skip?: (i: number, j: number) => boolean,
  ): void {
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      for (let j = 0; j + 1 < a.length; j++) {
        if (skip?.(i, j)) continue;
        this.quad(a[j], a[j + 1], b[j + 1], b[j], out);
      }
    }
  }

  /**
   * Filled polygon (with holes) described in a 2D parameter space and lifted to 3D by `map`.
   * Only the outline points become vertices, so sample curved outlines densely.
   */
  polygon(
    contour: P2[],
    holes: P2[][],
    map: (a: number, b: number) => Vtx,
    out?: V3,
  ): void {
    const v2 = (pts: P2[]) => pts.map(([a, b]) => new Vector2(a, b));
    const all = [contour, ...holes].flat().map(([a, b]) => map(a, b));
    for (const [i, j, k] of ShapeUtils.triangulateShape(
      v2(contour),
      holes.map(v2),
    ))
      this.tri(all[i], all[j], all[k], out);
  }

  /**
   * Sweep a closed profile along a path. `frame(i)` gives the profile axes at path point i;
   * profile points are [along n, along up]. `caps` closes both ends.
   */
  sweep(
    path: V3[],
    frame: (i: number) => { n: V3; up: V3 },
    profile: P2[],
    caps = true,
  ): void {
    const rings = path.map((p, i) => {
      const { n, up } = frame(i);
      return profile.map(([o, h]) =>
        vtx(
          p[0] + n[0] * o + up[0] * h,
          p[1] + n[1] * o + up[1] * h,
          p[2] + n[2] * o + up[2] * h,
        ),
      );
    });
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      for (let j = 0; j < profile.length; j++) {
        const k = (j + 1) % profile.length;
        this.quad(a[j], a[k], b[k], b[j]);
      }
    }
    if (caps)
      for (const ring of [rings[0], rings[rings.length - 1]])
        for (let j = 1; j + 1 < ring.length; j++)
          this.tri(ring[0], ring[j], ring[j + 1]);
  }

  /** Non-indexed geometry (position, normal, uv) with normals smoothed below `creaseDeg`. */
  geometry(creaseDeg = 35): BufferGeometry {
    const pos = new Float32Array(this.pos);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute(
      'normal',
      new BufferAttribute(creasedNormals(pos, creaseDeg), 3),
    );
    return g;
  }
}

/**
 * Per-corner normals for a triangle soup: at each corner, the angle-weighted average of the
 * normals of all faces that share that position and lie within `creaseDeg` of the corner's face.
 */
export function creasedNormals(
  pos: Float32Array,
  creaseDeg: number,
): Float32Array {
  const faces = pos.length / 9;
  const fn = new Float32Array(faces * 3);
  const ang = new Float32Array(faces * 3);
  const byPos = new Map<string, number[]>();
  const keys: string[] = new Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const o = f * 9;
    const e = (i: number, j: number): V3 => [
      pos[o + j * 3] - pos[o + i * 3],
      pos[o + j * 3 + 1] - pos[o + i * 3 + 1],
      pos[o + j * 3 + 2] - pos[o + i * 3 + 2],
    ];
    const ab = e(0, 1);
    const ac = e(0, 2);
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[f * 3] = nx / l;
    fn[f * 3 + 1] = ny / l;
    fn[f * 3 + 2] = nz / l;
    for (let c = 0; c < 3; c++) {
      const u = e(c, (c + 1) % 3);
      const v = e(c, (c + 2) % 3);
      const d =
        (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) /
        (Math.hypot(...u) * Math.hypot(...v) || 1);
      ang[f * 3 + c] = Math.acos(clamp(d, -1, 1));
      const p = o + c * 3;
      const key = `${Math.round(pos[p] * 1e4)},${Math.round(pos[p + 1] * 1e4)},${Math.round(pos[p + 2] * 1e4)}`;
      keys[f * 3 + c] = key;
      const list = byPos.get(key);
      if (list) list.push(f * 3 + c);
      else byPos.set(key, [f * 3 + c]);
    }
  }
  const limit = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(faces * 9);
  for (let f = 0; f < faces; f++) {
    const ax = fn[f * 3];
    const ay = fn[f * 3 + 1];
    const az = fn[f * 3 + 2];
    for (let c = 0; c < 3; c++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const corner of byPos.get(keys[f * 3 + c])!) {
        const g = (corner / 3) | 0;
        const bx = fn[g * 3];
        const by = fn[g * 3 + 1];
        const bz = fn[g * 3 + 2];
        if (ax * bx + ay * by + az * bz < limit) continue;
        const w = ang[corner];
        x += bx * w;
        y += by * w;
        z += bz * w;
      }
      const l = Math.hypot(x, y, z) || 1;
      out[f * 9 + c * 3] = x / l;
      out[f * 9 + c * 3 + 1] = y / l;
      out[f * 9 + c * 3 + 2] = z / l;
    }
  }
  return out;
}

/** Polygon with its corners rounded by radius `r` (`seg` segments per corner). */
export function roundedPoly(pts: P2[], r: number, seg = 5): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const ua: P2 = [a[0] - p[0], a[1] - p[1]];
    const ub: P2 = [b[0] - p[0], b[1] - p[1]];
    const la = Math.hypot(...ua);
    const lb = Math.hypot(...ub);
    ua[0] /= la;
    ua[1] /= la;
    ub[0] /= lb;
    ub[1] /= lb;
    const half = Math.acos(clamp(ua[0] * ub[0] + ua[1] * ub[1], -1, 1)) / 2;
    const t = Math.min(r / Math.tan(half), la * 0.45, lb * 0.45);
    const rr = t * Math.tan(half);
    // Arc centre lies on the bisector.
    const bis: P2 = [ua[0] + ub[0], ua[1] + ub[1]];
    const lbis = Math.hypot(...bis) || 1;
    const dist = rr / Math.sin(half);
    const c: P2 = [
      p[0] + (bis[0] / lbis) * dist,
      p[1] + (bis[1] / lbis) * dist,
    ];
    const s: P2 = [p[0] + ua[0] * t, p[1] + ua[1] * t];
    const e: P2 = [p[0] + ub[0] * t, p[1] + ub[1] * t];
    const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let da = Math.atan2(e[1] - c[1], e[0] - c[0]) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let k = 0; k <= seg; k++) {
      const ang = a0 + (da * k) / seg;
      out.push([c[0] + Math.cos(ang) * rr, c[1] + Math.sin(ang) * rr]);
    }
  }
  return out;
}

/** Closed outline grown (d > 0) or shrunk (d < 0) by `d`, whatever its winding. */
export function offsetPoly(pts: P2[], d: number): P2[] {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const sign = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const e0: P2 = [p[0] - a[0], p[1] - a[1]];
    const e1: P2 = [b[0] - p[0], b[1] - p[1]];
    const l0 = Math.hypot(...e0) || 1;
    const l1 = Math.hypot(...e1) || 1;
    // Outward normals of the two edges (for a counter-clockwise outline: (dy, -dx)).
    const n0: P2 = [(e0[1] / l0) * sign, (-e0[0] / l0) * sign];
    const n1: P2 = [(e1[1] / l1) * sign, (-e1[0] / l1) * sign];
    const m: P2 = [n0[0] + n1[0], n0[1] + n1[1]];
    const lm = Math.hypot(...m) || 1;
    const k = Math.min(
      2,
      1 / Math.max(0.3, (m[0] * n0[0] + m[1] * n0[1]) / lm),
    );
    return [p[0] + (m[0] / lm) * d * k, p[1] + (m[1] / lm) * d * k];
  });
}

/** Closed outline with extra points so that no edge is longer than `maxLen`. */
export function densify(pts: P2[], maxLen: number): P2[] {
  const out: P2[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / maxLen),
    );
    for (let k = 0; k < n; k++)
      out.push([lerp(p[0], q[0], k / n), lerp(p[1], q[1], k / n)]);
  });
  return out;
}
