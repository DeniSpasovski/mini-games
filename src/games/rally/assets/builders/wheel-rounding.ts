/**
 * Rounder wheels for the baked vehicle models (`street-car-models.ts`), near LOD only. The packs' tyres and hubs are
 * 8 to 20 sided, which shows up close. Wheels are found in the mesh itself (round shells standing on the ground, and
 * the shells on the same axle inside them). Only their rings are rounded: an edge that runs round the axle at one
 * radius is split until a step is at most `STEP`, the new points placed on the arc; spokes, nuts and the faces across
 * the wheel keep their edges. An edge is only split when every triangle on it is of that wheel, so no seam opens to
 * the body or the axle. Faceted hubs get normals that follow the round. Every uv and texel of the model stays: the
 * body is not touched.
 */

/** A triangle soup: three vertices a triangle (position, normal, uv). */
export interface TriangleSoup {
  pos: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
}

/** Largest turn of a ring edge round the axle after rounding (rad): 20 sides become 40, 16 become 32, 24 stay. */
const STEP = (16 * Math.PI) / 180;
/** Edges turning more than this are not rounded (rad): an 8-sided hub is, a hexagon nut stays one. */
const MAX_TURN = (50 * Math.PI) / 180;
/** An edge is only split when its middle is this far off the arc (m): the small rings at the hub stay as they are. */
const SAG = 0.0025;
/** Positions closer than this are one point (m). */
const WELD = 0.0005;
/** Ends of a ring edge are this close along the axle (m) ... */
const RING_Z = 0.002;
/** ... and in radius (m, plus `RING_R_PART` of the radius). */
const RING_R = 0.004;
const RING_R_PART = 0.015;
/** A slanted edge between two close rings is at most this long along the axle (m). */
const SLANT_Z = 0.03;
/** The longest ring edge that is rounded when its ring is round elsewhere (rad). */
const LONG_TURN = (80 * Math.PI) / 180;
/** A faceted ring's normals are turned to the round up to this much of them pointing along the ring. */
const FACET = 0.45;

interface Wheel {
  cx: number;
  cy: number;
  r: number;
  /** Its half length and half height over `r`: a model stretched a few percent has oval wheels. */
  sx: number;
  sy: number;
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

type Tri = [a: number, b: number, c: number, wheel: Wheel | undefined];

/** The wheels of a model facing +X (axles along Z) with their rings split to `STEP`; `soup` itself without wheels. */
export function roundWheels(soup: TriangleSoup): TriangleSoup {
  const ids = weld(soup.pos);
  const all = shells(soup.pos, ids);
  const size = (s: Shell, a: number): number => s.max[a] - s.min[a];
  // Tyres: round shells standing on the ground, thinner than they are tall.
  const wheels: Wheel[] = all
    .filter(
      (s) =>
        Math.abs(size(s, 0) - size(s, 1)) <
          0.08 * Math.max(size(s, 0), size(s, 1)) &&
        size(s, 0) > 0.3 &&
        size(s, 2) < 0.7 * size(s, 0) &&
        s.min[1] < 0.03,
    )
    .map((s) => {
      const r = (size(s, 0) + size(s, 1)) / 4;
      return {
        cx: (s.min[0] + s.max[0]) / 2,
        cy: (s.min[1] + s.max[1]) / 2,
        r,
        sx: size(s, 0) / 2 / r,
        sy: size(s, 1) / 2 / r,
        z0: s.min[2],
        z1: s.max[2],
      };
    })
    // The inner tyre of a pair stays as it is (it is behind the outer one, and on some models cut off under the body).
    .filter(
      (k, _i, list) =>
        !list.some(
          (o) =>
            o !== k &&
            Math.hypot(o.cx - k.cx, o.cy - k.cy) < 0.03 &&
            o.z0 * k.z0 > 0 &&
            Math.abs(o.z0 + o.z1) > Math.abs(k.z0 + k.z1),
        ),
    );
  if (!wheels.length) return soup;
  // Wheel of each triangle: the tyre and every shell that is wholly inside its cylinder (rim, hub, disc, the inner
  // tyre of a pair, which is cut off under the body), from one tyre's width inboard to a hub's reach outside.
  const within = (v: number, k: Wheel, reach: number, inboard: number) => {
    const side = Math.sign(k.z0 + k.z1);
    const near = Math.min(Math.abs(k.z0), Math.abs(k.z1)) - inboard;
    const far = Math.max(Math.abs(k.z0), Math.abs(k.z1)) + 0.15;
    const z = soup.pos[v * 3 + 2] * side;
    return (
      z > near &&
      z < far &&
      Math.hypot(
        (soup.pos[v * 3] - k.cx) / k.sx,
        (soup.pos[v * 3 + 1] - k.cy) / k.sy,
      ) < reach
    );
  };
  const wheelOf = new Map<number, Wheel>();
  for (const s of all) {
    const w = wheels.find(
      (k) =>
        s.max[0] < k.cx + k.r + 0.01 &&
        s.min[0] > k.cx - k.r - 0.01 &&
        s.tris.every((t) =>
          [0, 1, 2].every((c) =>
            within(t * 3 + c, k, k.r + 0.01, k.z1 - k.z0 + 0.05),
          ),
        ),
    );
    if (w) for (const t of s.tris) wheelOf.set(t, w);
  }
  // And any other triangle inside the tyre (a hub that is one shell with its axle).
  for (let t = 0; t < ids.length / 3; t++) {
    if (wheelOf.has(t)) continue;
    const w = wheels.find((k) =>
      [0, 1, 2].every((c) => within(t * 3 + c, k, 0.95 * k.r, 0.02)),
    );
    if (w) wheelOf.set(t, w);
  }

  const pos = Array.from(soup.pos);
  const normal = Array.from(soup.normal);
  const uv = Array.from(soup.uv);
  let tris: Tri[] = [];
  for (let t = 0; t < ids.length / 3; t++)
    tris.push([t * 3, t * 3 + 1, t * 3 + 2, wheelOf.get(t)]);

  const edgeKey = (a: number, b: number): number =>
    ids[a] < ids[b] ? ids[a] * 4194304 + ids[b] : ids[b] * 4194304 + ids[a];
  /** Radius, angle round the axle and place along it of vertex v, the wheel taken as round. */
  const polar = (v: number, w: Wheel): [number, number, number] => {
    const x = (pos[v * 3] - w.cx) / w.sx;
    const y = (pos[v * 3 + 1] - w.cy) / w.sy;
    return [Math.hypot(x, y), Math.atan2(y, x), pos[v * 3 + 2]];
  };
  /** Whether a place along the axle is on the half of the wheel that faces out: only that half is rounded. */
  const outer = (z: number, w: Wheel): boolean =>
    Math.abs(z) > Math.abs(w.z0 + w.z1) / 2 - 0.01;
  const turn = (a: number, b: number, w: Wheel): number =>
    Math.abs(wrap(polar(b, w)[1] - polar(a, w)[1]));
  /** Whether a and b carry the same normal and uv (two triangles' copies of one point). */
  const alike = (a: number, b: number): boolean =>
    normal[a * 3] * normal[b * 3] +
      normal[a * 3 + 1] * normal[b * 3 + 1] +
      normal[a * 3 + 2] * normal[b * 3 + 2] >
      0.98 &&
    Math.abs(uv[a * 2] - uv[b * 2]) < 1e-3 &&
    Math.abs(uv[a * 2 + 1] - uv[b * 2 + 1]) < 1e-3;

  for (let pass = 0; pass < 3; pass++) {
    // Per edge: its triangles, whether they are all of one wheel, and whether they all lie flat across the axle.
    const edges = new Map<
      number,
      { tris: number[]; wheel: Wheel | undefined; flat: boolean }
    >();
    tris.forEach(([a, b, c, w], i) => {
      let flat = false;
      if (w) {
        const ux = pos[b * 3] - pos[a * 3];
        const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
        const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const vx = pos[c * 3] - pos[a * 3];
        const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
        const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        flat = Math.abs(n[2]) > 0.995 * Math.hypot(n[0], n[1], n[2]);
      }
      for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
        const e = edges.get(key);
        if (!e) edges.set(key, { tris: [i], wheel: w, flat });
        else {
          e.tris.push(i);
          if (e.wheel !== w) e.wheel = undefined;
          e.flat &&= flat;
        }
      }
    });

    // Whether an edge is bent (the same answer for every triangle on it). A ring edge is: both ends at one radius
    // and one place along the axle, of one wheel only; an edge inside a flat face of the wheel (a chord of a hub cap)
    // stays straight. A ring edge longer than `MAX_TURN` is bent too when it lies between rounded ones (a thinned-out
    // ring: a hexagon nut has no such neighbours). Where a mesh has no clean rings (a thinned-out rim lip that
    // zigzags between two close rings), the slanted edges are bent as well, in triangles that have no ring edge.
    const ringEnds = new Set<number>();
    const kinds = new Map<number, { t: number; ring: boolean; ok: boolean }>();
    const kind = (a: number, b: number, w: Wheel) => {
      const key = edgeKey(a, b);
      let k = kinds.get(key);
      if (k) return k;
      const e = edges.get(key)!;
      const p = polar(a, w);
      const q = polar(b, w);
      const t = Math.abs(wrap(q[1] - p[1]));
      const r = (p[0] + q[0]) / 2;
      const dz = Math.abs(p[2] - q[2]);
      const near = Math.abs(p[0] - q[0]) < RING_R + RING_R_PART * r;
      k = {
        t,
        ring: near && dz < RING_Z,
        ok:
          e.wheel === w &&
          outer(p[2], w) &&
          outer(q[2], w) &&
          near &&
          dz < SLANT_Z &&
          Math.min(p[0], q[0]) > 0.02 &&
          t > STEP &&
          r * (1 - Math.cos(t / 2)) > SAG &&
          !(e.tris.length > 1 && e.flat),
      };
      if (k.ring && e.wheel === w && t <= MAX_TURN)
        ringEnds.add(ids[a]).add(ids[b]);
      kinds.set(key, k);
      return k;
    };
    const corners = (tri: Tri): [number, number][] => [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (const tri of tris)
      if (tri[3]) for (const [a, b] of corners(tri)) kind(a, b, tri[3]);
    const ringBent = (a: number, b: number, w: Wheel): boolean => {
      const k = kind(a, b, w);
      return (
        k.ok &&
        k.ring &&
        (k.t <= MAX_TURN ||
          (k.t <= LONG_TURN && ringEnds.has(ids[a]) && ringEnds.has(ids[b])))
      );
    };
    /** Edges of the triangles without a bent ring edge. */
    const loose = new Set<number>();
    for (const tri of tris) {
      const w = tri[3];
      if (!w || corners(tri).some(([a, b]) => ringBent(a, b, w))) continue;
      for (const [a, b] of corners(tri)) loose.add(edgeKey(a, b));
    }
    const bends = (a: number, b: number, w: Wheel): boolean => {
      const k = kind(a, b, w);
      return (
        ringBent(a, b, w) ||
        (k.ok && !k.ring && k.t <= MAX_TURN && loose.has(edgeKey(a, b)))
      );
    };

    if (pass === 0) {
      // Normals on the rings that get rounded: a faceted ring (its faces creased apart) is shaded round, the part
      // of each normal that points along the ring turned out from the axle.
      const ring = new Set<number>();
      for (const [a, b, c, w] of tris) {
        if (!w) continue;
        for (const [p, q] of [
          [a, b],
          [b, c],
          [c, a],
        ])
          if (bends(p, q, w)) ring.add(ids[p]).add(ids[q]);
      }
      for (const tri of tris) {
        const w = tri[3];
        if (!w) continue;
        for (let k = 0; k < 3; k++) {
          const v = tri[k] as number;
          if (!ring.has(ids[v])) continue;
          const angle = polar(v, w)[1];
          const c = Math.cos(angle);
          const s = Math.sin(angle);
          const nr = normal[v * 3] * c + normal[v * 3 + 1] * s;
          const nt = -normal[v * 3] * s + normal[v * 3 + 1] * c;
          if (Math.abs(nt) > FACET) continue;
          const out = Math.sign(nr) * Math.hypot(nr, nt);
          normal[v * 3] = out * c;
          normal[v * 3 + 1] = out * s;
        }
      }
    }

    /** Id of the new point of each bent edge. */
    const pointIds = new Map<number, number>();
    /** New vertex in the middle of the bent edge a-b on its arc; its normal turns with it. */
    const mid = (a: number, b: number, w: Wheel): number => {
      // From the end with the lower id, so every triangle of the edge gets the very same point.
      const [lo, hi] = ids[a] < ids[b] ? [a, b] : [b, a];
      const p = polar(lo, w);
      const q = polar(hi, w);
      const t = p[1] + wrap(q[1] - p[1]) / 2;
      const r = (p[0] + q[0]) / 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const v = pos.length / 3;
      pos.push(w.cx + r * ct * w.sx, w.cy + r * st * w.sy, (p[2] + q[2]) / 2);
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
    /** Triangle i turned so its one bent edge is p-q (undefined: none or more than one). */
    const oneBent = (i: number): [number, number, number] | undefined => {
      const [a, b, c, w] = tris[i];
      if (!w) return undefined;
      const ab = bends(a, b, w);
      const bc = bends(b, c, w);
      const ca = bends(c, a, w);
      if (+ab + +bc + +ca !== 1) return undefined;
      return ab ? [a, b, c] : bc ? [b, c, a] : [c, a, b];
    };

    let split = false;
    const done = new Uint8Array(tris.length);
    const next: Tri[] = [];
    tris.forEach((tri, i) => {
      if (done[i]) return;
      done[i] = 1;
      const [a, b, c, w] = tri;
      if (!w) {
        next.push(tri);
        return;
      }
      const ab = bends(a, b, w);
      const bc = bends(b, c, w);
      const ca = bends(c, a, w);
      const count = +ab + +bc + +ca;
      if (!count) {
        next.push(tri);
        return;
      }
      split = true;
      if (count === 3) {
        const [x, y, z] = [mid(a, b, w), mid(b, c, w), mid(c, a, w)];
        next.push([a, x, z, w], [x, b, y, w], [z, y, c, w], [x, y, z, w]);
      } else if (count === 2) {
        // Turned so the whole edge is r-p: p-q and q-r are split.
        const [p, q, r] = !ca ? [a, b, c] : !ab ? [b, c, a] : [c, a, b];
        const m = mid(p, q, w);
        const k = mid(q, r, w);
        next.push([m, q, k, w], [p, m, k, w], [p, k, r, w]);
      } else {
        // Turned so the split edge is p-q.
        const [p, q, r] = ab ? [a, b, c] : bc ? [b, c, a] : [c, a, b];
        const m = mid(p, q, w);
        // A strip between two rings: this triangle and the one across its diagonal (the edge that turns with the
        // ring; the other is a rung) are cut as one quad, so the diagonal does not stay as a chord inside the round.
        const t = turn(p, q, w);
        const tq = turn(q, r, w);
        const tp = turn(r, p, w);
        const far =
          tq > 0.75 * t && tp < 0.25 * t
            ? q
            : tp > 0.75 * t && tq < 0.25 * t
              ? p
              : -1;
        const pair = far < 0 ? undefined : edges.get(edgeKey(far, r))!;
        const j =
          pair && pair.wheel === w && pair.tris.length === 2
            ? pair.tris[0] === i
              ? pair.tris[1]
              : pair.tris[0]
            : -1;
        const other = j >= 0 && !done[j] ? oneBent(j) : undefined;
        // The other triangle: its bent edge x-y, its far corner z at this one's `far`, r at x or y.
        if (
          other &&
          ids[other[2]] === ids[far] &&
          alike(other[2], far) &&
          ((far === q && ids[other[1]] === ids[r] && alike(other[1], r)) ||
            (far === p && ids[other[0]] === ids[r] && alike(other[0], r)))
        ) {
          done[j] = 1;
          const k = mid(other[0], other[1], w);
          if (far === q)
            next.push(
              [p, m, r, w],
              [m, k, r, w],
              [m, q, k, w],
              [q, other[0], k, w],
            );
          else
            next.push(
              [m, q, r, w],
              [m, r, k, w],
              [p, m, k, w],
              [p, k, other[1], w],
            );
        } else next.push([p, m, r, w], [m, q, r, w]);
      }
    });
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
