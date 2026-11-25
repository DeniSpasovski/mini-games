/**
 * Reference lines of the v2 road engine: a way's polyline (through its OSM nodes) becomes a smooth curve sampled every
 * STEP m - point, unit tangent, arc length, signed curvature. Joints are gone (a street is one curve across its OSM
 * ways), so nothing downstream ever sees a way end inside a street. Pure.
 */

/** Sample spacing along a way (m). */
export const STEP = 2;

export interface Alignment {
  n: number;
  x: Float64Array;
  z: Float64Array;
  /** Arc length at each sample. */
  s: Float64Array;
  /** Unit tangent (direction of travel). */
  tx: Float64Array;
  tz: Float64Array;
  /** Signed curvature (1/m), + = turning left. */
  k: Float64Array;
  length: number;
}

/** Drop repeated / near-duplicate points (< 0.05 m apart) of a flat [x, z, ...] polyline. */
function clean(pts: number[]): number[] {
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const px = out[out.length - 2];
    const pz = out[out.length - 1];
    if (Math.hypot(pts[i] - px, pts[i + 1] - pz) > 0.05)
      out.push(pts[i], pts[i + 1]);
  }
  if (out.length < 4) {
    out.push(pts[pts.length - 2] + 0.1, pts[pts.length - 1]);
  }
  return out;
}

/**
 * Centripetal Catmull-Rom through the points (exact at every point: junction nodes stay put), densified, then resampled
 * at `step` m by arc length (end points exact).
 */
export function alignPolyline(pts: number[], step = STEP): Alignment {
  const p = clean(pts);
  const m = p.length / 2;
  const dense: number[] = [];
  const P = (i: number): [number, number] => {
    if (i < 0) return [2 * p[0] - p[2], 2 * p[1] - p[3]];
    if (i >= m)
      return [
        2 * p[(m - 1) * 2] - p[(m - 2) * 2],
        2 * p[(m - 1) * 2 + 1] - p[(m - 2) * 2 + 1],
      ];
    return [p[i * 2], p[i * 2 + 1]];
  };
  for (let i = 0; i < m - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const d = (a: number[], b: number[]) =>
      Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const sub = Math.max(2, Math.ceil(segLen / 0.5));
    for (let k = 0; k < sub; k++) {
      const t = t1 + ((t2 - t1) * k) / sub;
      const lerp = (
        a: number[],
        b: number[],
        ta: number,
        tb: number,
      ): number[] => {
        const f = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      const c = lerp(b1, b2, t1, t2);
      dense.push(c[0], c[1]);
    }
  }
  dense.push(p[(m - 1) * 2], p[(m - 1) * 2 + 1]);
  return resample(dense, step);
}

/** Resample a flat polyline every `step` m by arc length (ends exact); tangents and curvature from neighbours. */
export function resample(dense: number[], step = STEP): Alignment {
  const nd = dense.length / 2;
  const acc = new Float64Array(nd);
  for (let i = 1; i < nd; i++)
    acc[i] =
      acc[i - 1] +
      Math.hypot(
        dense[i * 2] - dense[i * 2 - 2],
        dense[i * 2 + 1] - dense[i * 2 - 1],
      );
  const L = acc[nd - 1];
  const n = Math.max(2, Math.ceil(L / step) + 1);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const s = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const a = (L * i) / (n - 1);
    while (j < nd - 2 && acc[j + 1] < a) j++;
    const seg = acc[j + 1] - acc[j] || 1;
    const f = Math.min(1, Math.max(0, (a - acc[j]) / seg));
    x[i] = dense[j * 2] + (dense[j * 2 + 2] - dense[j * 2]) * f;
    z[i] = dense[j * 2 + 1] + (dense[j * 2 + 3] - dense[j * 2 + 1]) * f;
    s[i] = a;
  }
  return withFrames({ n, x, z, s, length: L });
}

/** Tangents + curvature for sampled points. */
export function withFrames(a: {
  n: number;
  x: Float64Array;
  z: Float64Array;
  s: Float64Array;
  length: number;
}): Alignment {
  const { n, x, z } = a;
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const dx = x[i1] - x[i0];
    const dz = z[i1] - z[i0];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 2);
    const i1 = Math.min(n - 1, i + 2);
    const ds = a.s[i1] - a.s[i0] || 1;
    // heading change: cross of tangents; left turn (+) in the x-east / z-south frame = tangent rotating towards (tz, -tx)
    const cr = tx[i0] * tz[i1] - tz[i0] * tx[i1];
    k[i] = -cr / ds;
  }
  return { ...a, tx, tz, k };
}

/** Index of the sample at or before arc length `s` (clamped). */
export function sampleAt(al: Alignment, s: number): number {
  const n = al.n;
  if (s <= 0) return 0;
  if (s >= al.length) return n - 2;
  // samples are (nearly) evenly spaced: the guess, then the neighbours (a stage run-out is spaced a hair apart)
  let i = Math.min(n - 2, Math.max(0, Math.floor((s / al.length) * (n - 1))));
  while (i < n - 2 && al.s[i + 1] < s) i++;
  while (i > 0 && al.s[i] > s) i--;
  return i;
}

/** Linear interpolation of a per-sample array at arc length `s`. */
export function valueAt(
  al: Alignment,
  arr: ArrayLike<number>,
  s: number,
): number {
  const i = sampleAt(al, s);
  const ds = al.s[i + 1] - al.s[i] || 1;
  const f = Math.min(1, Math.max(0, (s - al.s[i]) / ds));
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

/** Point + tangent at arc length `s`. */
export function pointAt(
  al: Alignment,
  s: number,
  out: { x: number; z: number; tx: number; tz: number },
): typeof out {
  const i = sampleAt(al, s);
  const ds = al.s[i + 1] - al.s[i] || 1;
  const f = Math.min(1, Math.max(0, (s - al.s[i]) / ds));
  out.x = al.x[i] + (al.x[i + 1] - al.x[i]) * f;
  out.z = al.z[i] + (al.z[i + 1] - al.z[i]) * f;
  const tx = al.tx[i] + (al.tx[i + 1] - al.tx[i]) * f;
  const tz = al.tz[i] + (al.tz[i + 1] - al.tz[i]) * f;
  const l = Math.hypot(tx, tz) || 1;
  out.tx = tx / l;
  out.tz = tz / l;
  return out;
}

/** Projection of (x, z) on segment i of an alignment: arc length, signed lateral (+ = left), parameter along it. */
export interface Projection {
  s: number;
  t: number;
  /** Segment index and fraction. */
  i: number;
  f: number;
  /** Distance to the segment (m, 0..). */
  d: number;
}

export function projectOnSegment(
  al: Alignment,
  i: number,
  x: number,
  z: number,
  out: Projection,
): Projection {
  const ax = al.x[i];
  const az = al.z[i];
  const ex = al.x[i + 1] - ax;
  const ez = al.z[i + 1] - az;
  const l2 = ex * ex + ez * ez || 1e-9;
  let f = ((x - ax) * ex + (z - az) * ez) / l2;
  f = Math.min(1, Math.max(0, f));
  const px = ax + ex * f;
  const pz = az + ez * f;
  // frame at the projection: interpolated tangent
  let tx = al.tx[i] + (al.tx[i + 1] - al.tx[i]) * f;
  let tz = al.tz[i] + (al.tz[i + 1] - al.tz[i]) * f;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  // left = (tz, -tx)
  out.t = (x - px) * tz - (z - pz) * tx;
  out.s = al.s[i] + (al.s[i + 1] - al.s[i]) * f;
  out.i = i;
  out.f = f;
  out.d = Math.hypot(x - px, z - pz);
  return out;
}

/** Uniform grid of items with bounding boxes. */
export class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(readonly cell: number) {}
  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  add(item: T, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const c = this.cell;
    const x0 = Math.floor(minX / c);
    const x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c);
    const z1 = Math.floor(maxZ / c);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = this.key(cx, cz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
  }
  at(x: number, z: number): readonly T[] {
    return (
      this.cells.get(
        this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)),
      ) ?? EMPTY
    );
  }
}
const EMPTY: never[] = [];

/** Box filter passes (~gaussian) over a profile; `window` in samples. */
export function smooth1d(ys: Float64Array, window: number): void {
  const n = ys.length;
  const r = Math.max(1, Math.round(window / 2));
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < 3; pass++) {
    let acc = 0;
    let cnt = 0;
    // running mean with clamped (reflected-flat) ends
    const get = (i: number) => ys[Math.min(n - 1, Math.max(0, i))];
    for (let i = -r; i <= r; i++) {
      acc += get(i);
      cnt++;
    }
    for (let i = 0; i < n; i++) {
      tmp[i] = acc / cnt;
      acc += get(i + r + 1) - get(i - r);
    }
    ys.set(tmp);
  }
}

/** Limit the grade between samples `step` m apart (forward + backward pass: max climb / drop). */
export function limitGrade(
  ys: Float64Array,
  step: number,
  grade: number,
): void {
  const n = ys.length;
  const d = grade * step;
  for (let i = 1; i < n; i++) ys[i] = Math.min(ys[i], ys[i - 1] + d);
  for (let i = n - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] + d);
  for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i], ys[i - 1] - d);
  for (let i = n - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1] - d);
}

/**
 * Vertical alignment design (the road engineer's profile, not a filtered ground line): the ground profile `raw`
 * (per sample, `s` m) is fitted by tangents between PVIs within `tol` m (Douglas-Peucker), the PVIs are held within
 * `grade`, and every PVI gets a parabolic vertical curve of length max(`minCurve`, K * grade change in %) clipped to the
 * tangents around it. Returns the designed profile per sample.
 */
export function designProfile(
  raw: Float64Array,
  s: Float64Array,
  tol: number,
  grade: number,
  minCurve: number,
  K: number,
): Float64Array {
  const n = raw.length;
  const out = new Float64Array(n);
  if (n < 3) {
    out.set(raw);
    return out;
  }
  // 1. PVIs: Douglas-Peucker on (s, raw)
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ds = s[b] - s[a] || 1;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (s[i] - s[a]) / ds;
      const d = Math.abs(raw[i] - (raw[a] + (raw[b] - raw[a]) * f));
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  // 2. PVI heights within the grade (both directions, a few passes)
  const ys = idx.map((i) => raw[i]);
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 1; k < idx.length; k++) {
      const d = grade * (s[idx[k]] - s[idx[k - 1]]);
      ys[k] = Math.max(ys[k - 1] - d, Math.min(ys[k - 1] + d, ys[k]));
    }
    for (let k = idx.length - 2; k >= 0; k--) {
      const d = grade * (s[idx[k + 1]] - s[idx[k]]);
      ys[k] = Math.max(ys[k + 1] - d, Math.min(ys[k + 1] + d, ys[k]));
    }
  }
  // 3. tangents + parabolic curves at the inner PVIs
  const m = idx.length;
  const g: number[] = [];
  for (let k = 0; k + 1 < m; k++)
    g.push((ys[k + 1] - ys[k]) / (s[idx[k + 1]] - s[idx[k]] || 1));
  const half: number[] = new Array(m).fill(0);
  for (let k = 1; k + 1 < m; k++) {
    const A = Math.abs(g[k] - g[k - 1]) * 100;
    const L = Math.max(minCurve, K * A);
    const room =
      Math.min(s[idx[k]] - s[idx[k - 1]], s[idx[k + 1]] - s[idx[k]]) * 0.5;
    half[k] = Math.min(L / 2, room);
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    const si = s[i];
    while (k + 1 < m - 1 && si > s[idx[k + 1]]) k++;
    // on tangent k (PVI k -> k+1), possibly inside the curve at PVI k or PVI k+1
    const sk = s[idx[k]];
    let y = ys[k] + g[k] * (si - sk);
    const c0 = half[k];
    const c1 = half[k + 1];
    if (c0 > 0 && si < sk + c0) {
      // curve at PVI k: from the previous tangent into this one
      const x = si - (sk - c0);
      const gIn = g[k - 1];
      y = ys[k] - gIn * c0 + gIn * x + ((g[k] - gIn) * x * x) / (4 * c0);
    } else if (c1 > 0 && si > s[idx[k + 1]] - c1) {
      const sk1 = s[idx[k + 1]];
      const x = si - (sk1 - c1);
      y =
        ys[k + 1] -
        g[k] * c1 +
        g[k] * x +
        ((g[k + 1] - g[k]) * x * x) / (4 * c1);
    }
    out[i] = y;
  }
  return out;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
}

/** Point in a flat [x0, z0, ...] polygon. */
export function inPolygon(
  poly: ArrayLike<number>,
  x: number,
  z: number,
): boolean {
  let c = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const zi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const zj = poly[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
}

/** Distance from (x, z) to the outline of a flat polygon. */
export function polygonDistance(
  poly: ArrayLike<number>,
  x: number,
  z: number,
): number {
  let best = Infinity;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j * 2];
    const az = poly[j * 2 + 1];
    const ex = poly[i * 2] - ax;
    const ez = poly[i * 2 + 1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const f = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * f - x, az + ez * f - z));
  }
  return best;
}

/** Convex hull (Andrew's monotone chain) of points, counter-clockwise in the x-east / z-north math sense. */
export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0
    )
      lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0
    )
      upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
