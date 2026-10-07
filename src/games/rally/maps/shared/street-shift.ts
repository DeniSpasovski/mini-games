import type { PathDef } from './types';

/**
 * Streets moved sideways onto the real pavement (`scripts/realmap/streets.py` writes `street-shifts.json`: per street the
 * median lateral offset of its OSM centre line from the NYC roadbed mid-line, + = left of its direction). OSM centre lines
 * sit up to 2-3 m off the real street; the junction areas, kerbs and sidewalks come from the real outlines.
 *
 * A shifted street keeps its junctions: the end nodes of ways that meet move together (the mean of their shifts) - a node
 * that touches a way that is NOT shifted (a deck, a ramp, a hand-built street) stays where it is, and the street's own
 * displacement fades in over `FADE` m from each end. Pure (no scene); matched by end positions, never by index.
 */
export interface StreetShift {
  /** The street's end points [x0, z0, x1, z1] as baked (it is matched within `TOL`). */
  k: [number, number, number, number];
  /** Lateral shift (m, + = left of the street's direction). */
  s: number;
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

export function shiftStreets(
  list: PathDef[],
  shifts: readonly StreetShift[],
): { paths: PathDef[]; moved: number } {
  const byIndex = new Map<number, number>();
  list.forEach((p, i) => {
    const n = p.pts.length;
    for (const s of shifts) {
      if (
        Math.hypot(p.pts[0] - s.k[0], p.pts[1] - s.k[1]) <= TOL &&
        Math.hypot(p.pts[n - 2] - s.k[2], p.pts[n - 1] - s.k[3]) <= TOL
      ) {
        byIndex.set(i, s.s);
        break;
      }
    }
  });
  if (!byIndex.size) return { paths: list, moved: 0 };
  // nodes: end points rounded to 0.5 m; the shifted ways at a node, and whether anything else touches it
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
  list.forEach((p, i) => {
    const n = p.pts.length;
    const sh = byIndex.get(i);
    for (const end of [0, n / 2 - 1]) {
      const x = p.pts[end * 2];
      const z = p.pts[end * 2 + 1];
      const e = touch(x, z);
      if (sh === undefined) e.pinned = true;
      else {
        const [lx, lz] = leftAt(p.pts, end);
        e.vecs.push([lx * sh, lz * sh]);
      }
    }
  });
  const out = list.slice();
  let moved = 0;
  byIndex.forEach((sh, i) => {
    const p = list[i];
    const n = p.pts.length / 2;
    // arc distance from the start
    const d = new Float32Array(n);
    for (let k = 1; k < n; k++)
      d[k] =
        d[k - 1] +
        Math.hypot(
          p.pts[k * 2] - p.pts[k * 2 - 2],
          p.pts[k * 2 + 1] - p.pts[k * 2 - 1],
        );
    const L = d[n - 1];
    const nodeVec = (end: number): [number, number] => {
      const e = nodes.get(key(p.pts[end * 2], p.pts[end * 2 + 1]))!;
      if (e.pinned || !e.vecs.length) return [0, 0];
      let sx = 0;
      let sz = 0;
      for (const [vx, vz] of e.vecs) {
        sx += vx;
        sz += vz;
      }
      return [sx / e.vecs.length, sz / e.vecs.length];
    };
    const v0 = nodeVec(0);
    const v1 = nodeVec(n - 1);
    const pts = p.pts.slice();
    for (let k = 0; k < n; k++) {
      const [lx, lz] = leftAt(p.pts, k);
      const own: [number, number] = [lx * sh, lz * sh];
      // from each end the displacement goes from that node's vector to the street's own over FADE m (short streets: a blend)
      const fade = Math.min(FADE, L / 2);
      const w0 = smooth(d[k] / fade);
      const w1 = smooth((L - d[k]) / fade);
      let dx = own[0] * w0 * w1;
      let dz = own[1] * w0 * w1;
      dx += v0[0] * (1 - w0) + v1[0] * (1 - w1);
      dz += v0[1] * (1 - w0) + v1[1] * (1 - w1);
      // (where both end weights are < 1 the two node vectors are blended: weights (1 - w0) + (1 - w1) <= 1 by construction
      // for L >= 2 FADE; a shorter street shares what is left)
      pts[k * 2] += dx;
      pts[k * 2 + 1] += dz;
    }
    out[i] = { ...p, pts };
    moved++;
  });
  return { paths: out, moved };
}
