import type { PathDef } from './types';

/**
 * The opposite carriageway moved sideways to its real distance from the stage road (`scripts/realmap/carriageway_offset.py`
 * writes `carriageway-shift.json`: per way the lateral offset of each vertex, + = left of the way's direction, measured
 * from the NYC planimetric roadbed). A node shared by shifted ways moves by the mean of their vectors; a way that is not
 * shifted but ends at such a node (a ramp, a street) follows with its end, the displacement fading out over `FADE` m; a
 * deck end stays put (the script fades the offsets to zero there). Pure (no scene); matched by end positions.
 */
export interface CarriagewayShift {
  /** The way's end points [x0, z0, x1, z1] as baked (matched within `TOL`). */
  k: [number, number, number, number];
  /** Lateral offset per vertex (m). */
  o: number[];
}

const TOL = 0.3;
const FADE = 18;

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** Left unit vector (tz, -tx) of a polyline at vertex `i`. */
function leftAt(pts: number[], i: number): [number, number] {
  const n = pts.length / 2;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  const dx = pts[b * 2] - pts[a * 2];
  const dz = pts[b * 2 + 1] - pts[a * 2 + 1];
  const l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
}

export function shiftCarriageways(
  list: PathDef[],
  shifts: readonly CarriagewayShift[],
): { paths: PathDef[]; moved: number } {
  const byIndex = new Map<number, number[]>();
  list.forEach((p, i) => {
    const n = p.pts.length;
    for (const s of shifts) {
      if (
        s.o.length === n / 2 &&
        Math.hypot(p.pts[0] - s.k[0], p.pts[1] - s.k[1]) <= TOL &&
        Math.hypot(p.pts[n - 2] - s.k[2], p.pts[n - 1] - s.k[3]) <= TOL
      ) {
        byIndex.set(i, s.o);
        break;
      }
    }
  });
  if (!byIndex.size) return { paths: list, moved: 0 };
  const key = (x: number, z: number) =>
    `${Math.round(x / 0.5)},${Math.round(z / 0.5)}`;
  const nodes = new Map<
    string,
    { vecs: [number, number][]; pinned: boolean }
  >();
  const touch = (x: number, z: number) => {
    const k = key(x, z);
    let e = nodes.get(k);
    if (!e) nodes.set(k, (e = { vecs: [], pinned: false }));
    return e;
  };
  byIndex.forEach((o, i) => {
    const p = list[i];
    const n = p.pts.length / 2;
    for (const end of [0, n - 1]) {
      const [lx, lz] = leftAt(p.pts, end);
      touch(p.pts[end * 2], p.pts[end * 2 + 1]).vecs.push([
        lx * o[end],
        lz * o[end],
      ]);
    }
  });
  list.forEach((p, i) => {
    if (!p.bridge || byIndex.has(i)) return;
    const n = p.pts.length / 2;
    for (const end of [0, n - 1]) {
      const e = nodes.get(key(p.pts[end * 2], p.pts[end * 2 + 1]));
      if (e) e.pinned = true;
    }
  });
  const nodeVec = (x: number, z: number): [number, number] => {
    const e = nodes.get(key(x, z));
    if (!e || e.pinned || !e.vecs.length) return [0, 0];
    let sx = 0;
    let sz = 0;
    for (const [vx, vz] of e.vecs) {
      sx += vx;
      sz += vz;
    }
    return [sx / e.vecs.length, sz / e.vecs.length];
  };
  const out = list.slice();
  let moved = 0;
  list.forEach((p, i) => {
    const n = p.pts.length / 2;
    const o = byIndex.get(i);
    const pts = p.pts.slice();
    if (o) {
      for (let k = 0; k < n; k++) {
        const [lx, lz] = leftAt(p.pts, k);
        const [dx, dz] =
          k === 0 || k === n - 1
            ? nodeVec(p.pts[k * 2], p.pts[k * 2 + 1])
            : [lx * o[k], lz * o[k]];
        pts[k * 2] += dx;
        pts[k * 2 + 1] += dz;
      }
      out[i] = { ...p, pts };
      moved++;
      return;
    }
    if (p.bridge) return;
    // a way that ends at a shifted node: its end follows, fading out along it
    const v0 = nodeVec(p.pts[0], p.pts[1]);
    const v1 = nodeVec(p.pts[n * 2 - 2], p.pts[n * 2 - 1]);
    if (!v0[0] && !v0[1] && !v1[0] && !v1[1]) return;
    const d = new Float32Array(n);
    for (let k = 1; k < n; k++)
      d[k] =
        d[k - 1] +
        Math.hypot(
          p.pts[k * 2] - p.pts[k * 2 - 2],
          p.pts[k * 2 + 1] - p.pts[k * 2 - 1],
        );
    const L = d[n - 1];
    const fade = Math.min(FADE, L / 2) || 1;
    for (let k = 0; k < n; k++) {
      const w0 = 1 - smooth(d[k] / fade);
      const w1 = 1 - smooth((L - d[k]) / fade);
      pts[k * 2] += v0[0] * w0 + v1[0] * w1;
      pts[k * 2 + 1] += v0[1] * w0 + v1[1] * w1;
    }
    out[i] = { ...p, pts };
  });
  return { paths: out, moved };
}
