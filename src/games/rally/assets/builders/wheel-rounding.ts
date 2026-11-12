/**
 * Rounder wheels for the baked vehicle models (`street-car-models.ts`), near LOD only. The packs' tyres and hubs are
 * 8 to 20 sided, which shows up close. Wheels are found in the mesh itself (round shells standing on the ground, and the
 * round shells on the same axle inside them); their edges that turn round the axle are split until a step is at most
 * `STEP`, the new points placed on the arc with the normal and uv of the edge's ends turned along with them. Every
 * triangle, uv and texel of the model stays: the body is not touched.
 */

/** A triangle soup: three vertices a triangle (position, normal, uv). */
export interface TriangleSoup {
  pos: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
}

/** Largest turn of an edge round the axle after rounding (rad): 16 sides become 32, 8 become 32, 24 stay. */
const STEP = (16 * Math.PI) / 180;
/** Edges turning more than this are not rounded (rad): an 8-sided hub is, a hexagon nut stays one. */
const MAX_TURN = (50 * Math.PI) / 180;
/** An edge is only split when its middle is this far off the arc (m): the small rings at the hub stay as they are. */
const SAG = 0.0025;
/** Positions closer than this are one point (m). */
const WELD = 0.0005;

interface Wheel {
  cx: number;
  cy: number;
  r: number;
  z0: number;
  z1: number;
}

interface Shell {
  tris: number[];
  min: [number, number, number];
  max: [number, number, number];
}

/** One id per position. */
function weld(pos: ArrayLike<number>): number[] {
  const n = pos.length / 3;
  const rep = new Array<number>(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3] / WELD)},${Math.round(pos[i * 3 + 1] / WELD)},${Math.round(pos[i * 3 + 2] / WELD)}`;
    let id = seen.get(key);
    if (id === undefined) seen.set(key, (id = i));
    rep[i] = id;
  }
  return rep;
}

/** Connected shells of the soup (triangle t has vertices 3t .. 3t + 2). */
function shells(pos: ArrayLike<number>, rep: number[]): Shell[] {
  const n = rep.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let v = 0; v < n; v += 3) {
    const a = find(rep[v]);
    parent[find(rep[v + 1])] = a;
    parent[find(rep[v + 2])] = a;
  }
  const out = new Map<number, Shell>();
  for (let v = 0; v < n; v += 3) {
    const root = find(rep[v]);
    let s = out.get(root);
    if (!s)
      out.set(
        root,
        (s = {
          tris: [],
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        }),
      );
    s.tris.push(v / 3);
    for (let k = 0; k < 9; k++) {
      const p = pos[v * 3 + k];
      if (p < s.min[k % 3]) s.min[k % 3] = p;
      if (p > s.max[k % 3]) s.max[k % 3] = p;
    }
  }
  return [...out.values()];
}

const wrap = (a: number): number =>
  a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a;

/** The wheels of a model facing +X (axles along Z) with their edges split to `STEP`; `soup` itself without wheels. */
export function roundWheels(soup: TriangleSoup): TriangleSoup {
  const ids = weld(soup.pos);
  const all = shells(soup.pos, ids);
  const size = (s: Shell, a: number): number => s.max[a] - s.min[a];
  const round = (s: Shell, tol: number): boolean =>
    Math.abs(size(s, 0) - size(s, 1)) < tol * Math.max(size(s, 0), size(s, 1));
  // Tyres: round shells standing on the ground, thinner than they are tall.
  const wheels: Wheel[] = all
    .filter(
      (s) =>
        round(s, 0.08) &&
        size(s, 0) > 0.3 &&
        size(s, 2) < 0.7 * size(s, 0) &&
        s.min[1] < 0.03,
    )
    .map((s) => ({
      cx: (s.min[0] + s.max[0]) / 2,
      cy: (s.min[1] + s.max[1]) / 2,
      r: (size(s, 0) + size(s, 1)) / 4,
      z0: s.min[2],
      z1: s.max[2],
    }));
  if (!wheels.length) return soup;
  // Wheel of each triangle: the tyre, what turns with it as a shell of its own (rim, hub, disc: round shells on its
  // axle), and any other triangle inside the tyre (a hub that is one shell with its axle).
  const wheelOf = new Map<number, Wheel>();
  for (const s of all) {
    if (!round(s, 0.15)) continue;
    const cx = (s.min[0] + s.max[0]) / 2;
    const cy = (s.min[1] + s.max[1]) / 2;
    const w = wheels.find(
      (k) =>
        Math.hypot(cx - k.cx, cy - k.cy) < 0.08 * k.r &&
        size(s, 0) < 2 * k.r + 0.02 &&
        s.min[2] > k.z0 - 0.15 &&
        s.max[2] < k.z1 + 0.15,
    );
    if (w) for (const t of s.tris) wheelOf.set(t, w);
  }
  for (let t = 0; t < ids.length / 3; t++) {
    if (wheelOf.has(t)) continue;
    const inside = (k: Wheel): boolean => {
      // From the tyre's inner face to a hub's reach outside it.
      const side = Math.sign(k.z0 + k.z1);
      const near = Math.min(Math.abs(k.z0), Math.abs(k.z1)) - 0.02;
      const far = Math.max(Math.abs(k.z0), Math.abs(k.z1)) + 0.15;
      for (let v = t * 3; v < t * 3 + 3; v++) {
        const z = soup.pos[v * 3 + 2] * side;
        if (z < near || z > far) return false;
        const dx = soup.pos[v * 3] - k.cx;
        const dy = soup.pos[v * 3 + 1] - k.cy;
        if (Math.hypot(dx, dy) > 0.95 * k.r) return false;
      }
      return true;
    };
    const w = wheels.find(inside);
    if (w) wheelOf.set(t, w);
  }

  const pos = Array.from(soup.pos);
  const normal = Array.from(soup.normal);
  const uv = Array.from(soup.uv);
  let tris: [number, number, number, Wheel | undefined][] = [];
  for (let t = 0; t < ids.length / 3; t++)
    tris.push([t * 3, t * 3 + 1, t * 3 + 2, wheelOf.get(t)]);

  const edgeKey = (a: number, b: number): string =>
    ids[a] < ids[b] ? `${ids[a]}:${ids[b]}` : `${ids[b]}:${ids[a]}`;
  /** Radius, angle round the axle and place along it of vertex v. */
  const polar = (v: number, w: Wheel): [number, number, number] => {
    const x = pos[v * 3] - w.cx;
    const y = pos[v * 3 + 1] - w.cy;
    return [Math.hypot(x, y), Math.atan2(y, x), pos[v * 3 + 2]];
  };

  for (let pass = 0; pass < 3; pass++) {
    // Per edge of the wheels: its faces, and whether they all lie flat across the axle.
    const faces = new Map<string, [count: number, flat: boolean]>();
    for (const [a, b, c, w] of tris) {
      if (!w) continue;
      const ux = pos[b * 3] - pos[a * 3];
      const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3];
      const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
      const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const flat = Math.abs(n[2]) > 0.995 * Math.hypot(n[0], n[1], n[2]);
      for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
        const f = faces.get(key);
        if (f) {
          f[0]++;
          f[1] &&= flat;
        } else faces.set(key, [1, flat]);
      }
    }

    // Whether an edge is bent (the same answer for both its triangles). Every edge that turns round the axle is,
    // whatever its ends' radii, so the faces between two rings follow their rings without a fold; an edge inside a flat
    // face of the wheel (a chord of a hub cap) stays straight.
    const bent = new Map<string, boolean>();
    const bends = (a: number, b: number, w: Wheel): boolean => {
      const key = edgeKey(a, b);
      let yes = bent.get(key);
      if (yes !== undefined) return yes;
      const p = polar(a, w);
      const q = polar(b, w);
      const turn = Math.abs(wrap(q[1] - p[1]));
      const f = faces.get(key)!;
      yes =
        Math.min(p[0], q[0]) > 0.02 &&
        turn > STEP &&
        turn <= MAX_TURN &&
        ((p[0] + q[0]) / 2) * (1 - Math.cos(turn / 2)) > SAG &&
        !(f[0] > 1 && f[1]);
      bent.set(key, yes);
      return yes;
    };
    /** Id of the new point of each bent edge. */
    const pointIds = new Map<string, number>();
    /** New vertex in the middle of a-b on its arc (-1: the edge stays); its normal turns with it. */
    const mid = (a: number, b: number, w: Wheel): number => {
      if (!bends(a, b, w)) return -1;
      // From the end with the lower id, so both triangles of the edge get the very same point.
      const [lo, hi] = ids[a] < ids[b] ? [a, b] : [b, a];
      const p = polar(lo, w);
      const q = polar(hi, w);
      const t = p[1] + wrap(q[1] - p[1]) / 2;
      const r = (p[0] + q[0]) / 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const v = pos.length / 3;
      pos.push(w.cx + r * ct, w.cy + r * st, (p[2] + q[2]) / 2);
      // Normal: mean of the ends' normals in the wheel's frame (out from the axle, round it, along it).
      let nr = 0;
      let nt = 0;
      let nz = 0;
      for (const [e, angle] of [
        [lo, p[1]],
        [hi, q[1]],
      ]) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        nr += normal[e * 3] * c + normal[e * 3 + 1] * s;
        nt += -normal[e * 3] * s + normal[e * 3 + 1] * c;
        nz += normal[e * 3 + 2];
      }
      const len = Math.hypot(nr, nt, nz) || 1;
      normal.push(
        (nr * ct - nt * st) / len,
        (nr * st + nt * ct) / len,
        nz / len,
      );
      uv.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
      const key = edgeKey(a, b);
      let id = pointIds.get(key);
      if (id === undefined) pointIds.set(key, (id = v));
      ids.push(id);
      return v;
    };

    let split = false;
    const next: typeof tris = [];
    for (const tri of tris) {
      const [a, b, c, w] = tri;
      if (!w) {
        next.push(tri);
        continue;
      }
      const ab = mid(a, b, w);
      const bc = mid(b, c, w);
      const ca = mid(c, a, w);
      const count = +(ab >= 0) + +(bc >= 0) + +(ca >= 0);
      if (!count) {
        next.push(tri);
        continue;
      }
      split = true;
      if (count === 3)
        next.push(
          [a, ab, ca, w],
          [ab, b, bc, w],
          [ca, bc, c, w],
          [ab, bc, ca, w],
        );
      else if (count === 1) {
        // Turned so the split edge is p-q.
        const [p, q, r, m] =
          ab >= 0 ? [a, b, c, ab] : bc >= 0 ? [b, c, a, bc] : [c, a, b, ca];
        next.push([p, m, r, w], [m, q, r, w]);
      } else {
        // Turned so the whole edge is r-p: p-q and q-r are split.
        const [p, q, r, m, k] =
          ca < 0
            ? [a, b, c, ab, bc]
            : ab < 0
              ? [b, c, a, bc, ca]
              : [c, a, b, ca, ab];
        next.push([m, q, k, w], [p, m, k, w], [p, k, r, w]);
      }
    }
    tris = next;
    if (!split) break;
  }

  const out: TriangleSoup = {
    pos: new Float32Array(tris.length * 9),
    normal: new Float32Array(tris.length * 9),
    uv: new Float32Array(tris.length * 6),
  };
  tris.forEach((tri, t) => {
    for (let k = 0; k < 3; k++) {
      const v = tri[k] as number;
      const o = t * 3 + k;
      for (let a = 0; a < 3; a++) {
        out.pos[o * 3 + a] = pos[v * 3 + a];
        out.normal[o * 3 + a] = normal[v * 3 + a];
      }
      out.uv[o * 2] = uv[v * 2];
      out.uv[o * 2 + 1] = uv[v * 2 + 1];
    }
  });
  return out;
}
