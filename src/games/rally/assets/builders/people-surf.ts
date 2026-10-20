import { BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three';
import { BONES, skinPoints, type Mesh } from './people-body';

/**
 * A triangle surface in the rest frame with named per-vertex columns (position, normal, uv, skin weights, zone fields):
 * the working form of everything that is cut from the body (people-tailor.ts). `clip` keeps the part where a scalar
 * field is >= 0 and interpolates every column along the cut, so a hem is an exact contour whatever the mesh density.
 */
export interface Surf {
  n: number;
  /** Columns by name; the stride is `length / n`. */
  a: Record<string, Float32Array>;
  idx: number[];
}

export const stride = (s: Surf, name: string): number => s.a[name].length / s.n;

/** The body mesh as a surface with the columns the tailoring cuts along. */
export function surfOf(m: Mesh): Surf {
  const a: Record<string, Float32Array> = {
    pos: m.pos,
    nor: m.nor,
    w: m.w,
    arm: m.arm,
    armT: m.armT,
    leg: m.leg,
    legT: m.legT,
  };
  if (m.uv) a.uv = m.uv;
  return { n: m.n, a, idx: Array.from(m.index) };
}

/** Adds a column (one value per vertex) to a surface. */
export function withColumn(s: Surf, name: string, v: Float32Array): Surf {
  return { n: s.n, a: { ...s.a, [name]: v }, idx: s.idx };
}

/**
 * The part of `s` where `f` >= 0 (one value per vertex). Triangles across f = 0 are cut; the new vertices are shared
 * between the triangles on either side of an edge.
 */
export function clip(s: Surf, f: ArrayLike<number>): Surf {
  const names = Object.keys(s.a);
  const strides = names.map((k) => stride(s, k));
  const cols: number[][] = names.map(() => []);
  const remap = new Int32Array(s.n).fill(-1);
  const edge = new Map<number, number>();
  let count = 0;
  const copy = (i: number): number => {
    if (remap[i] >= 0) return remap[i];
    names.forEach((k, c) => {
      const st = strides[c];
      for (let j = 0; j < st; j++) cols[c].push(s.a[k][i * st + j]);
    });
    return (remap[i] = count++);
  };
  const cut = (i: number, j: number): number => {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const key = lo * s.n + hi;
    const hit = edge.get(key);
    if (hit !== undefined) return hit;
    const t = f[lo] / (f[lo] - f[hi]);
    names.forEach((k, c) => {
      const st = strides[c];
      const col = s.a[k];
      const at = cols[c].length;
      for (let q = 0; q < st; q++)
        cols[c].push(
          col[lo * st + q] + (col[hi * st + q] - col[lo * st + q]) * t,
        );
      if (k === 'nor') {
        const l =
          Math.hypot(cols[c][at], cols[c][at + 1], cols[c][at + 2]) || 1;
        for (let q = 0; q < 3; q++) cols[c][at + q] /= l;
      }
    });
    const id = count++;
    edge.set(key, id);
    return id;
  };
  const idx: number[] = [];
  const poly: number[] = [];
  for (let t = 0; t < s.idx.length; t += 3) {
    const v = [s.idx[t], s.idx[t + 1], s.idx[t + 2]];
    const inside = v.map((i) => f[i] >= 0);
    const k = (inside[0] ? 1 : 0) + (inside[1] ? 1 : 0) + (inside[2] ? 1 : 0);
    if (k === 0) continue;
    if (k === 3) {
      idx.push(copy(v[0]), copy(v[1]), copy(v[2]));
      continue;
    }
    // Sutherland-Hodgman against the one plane: three or four corners.
    poly.length = 0;
    for (let e = 0; e < 3; e++) {
      const i = v[e];
      const j = v[(e + 1) % 3];
      if (inside[e]) poly.push(copy(i));
      // A vertex exactly on the plane is its own crossing: no second vertex on top of it (a sliver per cut edge).
      if ((f[i] > 0 && f[j] < 0) || (f[i] < 0 && f[j] > 0))
        poly.push(cut(i, j));
    }
    for (let q = 1; q + 1 < poly.length; q++)
      idx.push(poly[0], poly[q], poly[q + 1]);
  }
  const a: Record<string, Float32Array> = {};
  names.forEach((k, c) => (a[k] = Float32Array.from(cols[c])));
  return { n: count, a, idx };
}

/** `s` clipped by each field in turn (the fields ride along as columns, so later cuts see the earlier ones' new vertices). */
export function clipAll(s: Surf, fs: ArrayLike<number>[]): Surf {
  const a: Record<string, Float32Array> = { ...s.a };
  fs.forEach((f, k) => (a[`f${k}`] = Float32Array.from(f)));
  let cur: Surf = { n: s.n, a, idx: s.idx };
  for (let k = 0; k < fs.length; k++) cur = clip(cur, cur.a[`f${k}`]);
  const out: Record<string, Float32Array> = {};
  for (const name of Object.keys(s.a)) out[name] = cur.a[name];
  return { n: cur.n, a: out, idx: cur.idx };
}

/** Moves every vertex along its normal by `off(i)`; `down` (0..1) scales the vertical part of a normal that faces down. */
export function offset(s: Surf, off: (i: number) => number, down = 1): Surf {
  const pos = new Float32Array(s.a.pos);
  const nor = s.a.nor;
  for (let i = 0; i < s.n; i++) {
    const d = off(i);
    const ny = nor[i * 3 + 1];
    pos[i * 3] += nor[i * 3] * d;
    pos[i * 3 + 1] += (ny < 0 ? ny * down : ny) * d;
    pos[i * 3 + 2] += nor[i * 3 + 2] * d;
  }
  return { n: s.n, a: { ...s.a, pos }, idx: s.idx };
}

/** Smooth value noise in 3D (~[-1, 1]), the folds of cloth: a hash lattice, cubic blend. */
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const h = (i: number, j: number, k: number): number => {
    let n = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(
      l(h(xi, yi, zi), h(xi + 1, yi, zi), sx),
      l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx),
      sy,
    ),
    l(
      l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx),
      l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx),
      sy,
    ),
    sz,
  );
}

/** Area-weighted vertex normals of a surface (after its shape changed). */
export function normals(s: Surf): Float32Array {
  const p = s.a.pos;
  const out = new Float32Array(s.n * 3);
  for (let t = 0; t < s.idx.length; t += 3) {
    const a = s.idx[t] * 3;
    const b = s.idx[t + 1] * 3;
    const c = s.idx[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      out[i] += nx;
      out[i + 1] += ny;
      out[i + 2] += nz;
    }
  }
  for (let i = 0; i < s.n; i++) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1;
    out[i * 3] /= l;
    out[i * 3 + 1] /= l;
    out[i * 3 + 2] /= l;
  }
  return out;
}

/** Vertices on an open edge of a surface (hems, necklines), and the directed boundary edges. */
export function boundary(s: Surf): { pinned: Uint8Array; edges: number[] } {
  const seen = new Map<number, number>();
  for (let t = 0; t < s.idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = s.idx[t + e];
      const b = s.idx[t + ((e + 1) % 3)];
      seen.set(a * s.n + b, 1);
    }
  const pinned = new Uint8Array(s.n);
  const edges: number[] = [];
  for (const k of seen.keys()) {
    const a = Math.floor(k / s.n);
    const b = k - a * s.n;
    if (seen.has(b * s.n + a)) continue;
    pinned[a] = pinned[b] = 1;
    edges.push(a, b);
  }
  return { pinned, edges };
}

/**
 * Laplacian smoothing of the positions: the garment drapes over the body's small forms instead of printing them
 * (muscle lines, ribs). Open edges stay where they are; `k` (0..1 per vertex) scales the pull.
 */
export function relax(
  s: Surf,
  iters: number,
  lambda = 0.5,
  k?: (i: number) => number,
): Surf {
  const { pinned } = boundary(s);
  const nb: number[][] = Array.from({ length: s.n }, () => []);
  for (let t = 0; t < s.idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = s.idx[t + e];
      const b = s.idx[t + ((e + 1) % 3)];
      nb[a].push(b);
      nb[b].push(a);
    }
  let cur = new Float32Array(s.a.pos);
  let next = new Float32Array(cur.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < s.n; i++) {
      const list = nb[i];
      if (pinned[i] || !list.length) {
        next[i * 3] = cur[i * 3];
        next[i * 3 + 1] = cur[i * 3 + 1];
        next[i * 3 + 2] = cur[i * 3 + 2];
        continue;
      }
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of list) {
        x += cur[j * 3];
        y += cur[j * 3 + 1];
        z += cur[j * 3 + 2];
      }
      const w = lambda * (k ? k(i) : 1);
      next[i * 3] = cur[i * 3] + (x / list.length - cur[i * 3]) * w;
      next[i * 3 + 1] = cur[i * 3 + 1] + (y / list.length - cur[i * 3 + 1]) * w;
      next[i * 3 + 2] = cur[i * 3 + 2] + (z / list.length - cur[i * 3 + 2]) * w;
    }
    [cur, next] = [next, cur];
  }
  return { n: s.n, a: { ...s.a, pos: cur }, idx: s.idx };
}

/**
 * Closes the open edges of a garment with a thin wall down to the body (`depth` m inward along the normals): a hem or a
 * cuff has a thickness and nothing can be seen through it.
 */
export function seal(s: Surf, depth: number): Surf {
  const { edges } = boundary(s);
  if (!edges.length) return s;
  const names = Object.keys(s.a);
  const strides = names.map((k) => stride(s, k));
  const ring = new Map<number, number>();
  const extra: number[][] = names.map(() => []);
  let n = s.n;
  const dup = (i: number): number => {
    let j = ring.get(i);
    if (j !== undefined) return j;
    j = n++;
    ring.set(i, j);
    names.forEach((k, c) => {
      const st = strides[c];
      for (let q = 0; q < st; q++) extra[c].push(s.a[k][i * st + q]);
      if (k === 'pos')
        for (let q = 0; q < 3; q++)
          extra[c][extra[c].length - 3 + q] -= s.a.nor[i * 3 + q] * depth;
    });
    return j;
  };
  const idx = s.idx.slice();
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e];
    const b = edges[e + 1];
    const a2 = dup(a);
    const b2 = dup(b);
    idx.push(a, a2, b, b, a2, b2);
  }
  const a: Record<string, Float32Array> = {};
  names.forEach((k, c) => {
    const old = s.a[k];
    const out = new Float32Array(old.length + extra[c].length);
    out.set(old);
    out.set(extra[c], old.length);
    a[k] = out;
  });
  return { n, a, idx };
}

/** Vertex value of a column by index, for fields built from several columns. */
export const col = (s: Surf, name: string): Float32Array => s.a[name];

/** A surface of the same shape with a new column made per vertex. */
export function field(s: Surf, fn: (i: number) => number): Float32Array {
  const f = new Float32Array(s.n);
  for (let i = 0; i < s.n; i++) f[i] = fn(i);
  return f;
}

/** Appends surfaces (the columns of the first decide which are kept). */
export function join(list: Surf[]): Surf {
  const names = Object.keys(list[0].a);
  const a: Record<string, number[]> = {};
  for (const k of names) a[k] = [];
  const idx: number[] = [];
  let n = 0;
  for (const s of list) {
    for (const k of names) {
      const col = s.a[k];
      for (let i = 0; i < col.length; i++) a[k].push(col[i]);
    }
    for (const i of s.idx) idx.push(i + n);
    n += s.n;
  }
  const out: Record<string, Float32Array> = {};
  for (const k of names) out[k] = Float32Array.from(a[k]);
  return { n, a: out, idx };
}

/** A part that rides one bone rigidly (weights = 1 on it), with a uniform colour: hats, glasses, buckles. */
export function rigid(g: BufferGeometry, bone: number, color?: string): Surf {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute('position').count;
  const w = new Float32Array(n * BONES);
  for (let i = 0; i < n; i++) w[i * BONES + bone] = 1;
  const a: Record<string, Float32Array> = {
    pos: Float32Array.from(ng.getAttribute('position').array),
    nor: Float32Array.from(ng.getAttribute('normal').array),
    w,
  };
  const uv = ng.getAttribute('uv');
  a.uv = uv ? Float32Array.from(uv.array) : new Float32Array(n * 2);
  const c = ng.getAttribute('color');
  if (c) a.color = Float32Array.from(c.array as ArrayLike<number>);
  else if (color) a.color = solid(n, color);
  return { n, a, idx: Array.from({ length: n }, (_, i) => i) };
}

/** A colour column of `n` vertices. */
export function solid(n: number, css: string): Float32Array {
  const c = new Color(css);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

/** Posed geometry of a surface: the columns skinned by `bones` after `widen` (people-body.ts) put them in the figure's shape. */
export function posed(
  s: Surf,
  bones: Matrix4[],
  warp: (s: Surf, out: Float32Array) => void,
  attrs: string[],
): BufferGeometry {
  const rest = new Float32Array(s.n * 3);
  warp(s, rest);
  const pos = new Float32Array(s.n * 3);
  const nor = new Float32Array(s.n * 3);
  skinPoints(s.n, rest, s.a.nor, s.a.w, bones, pos, nor);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  for (const k of attrs)
    if (s.a[k]) g.setAttribute(k, new BufferAttribute(s.a[k], stride(s, k)));
  g.setIndex(s.idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Keeps a skirt (posed geometry) outside the posed legs: a stride swings a thigh through a skirt built in the rest
 * frame. Each skirt vertex is pushed outwards, away from the skirt's axis at its height, until the body points beside
 * it are inside; the push is dilated over `reach` so the cloth bulges smoothly instead of spiking.
 */
export function clearLegs(
  g: BufferGeometry,
  body: ArrayLike<number>,
  margin = 0.006,
  reach = 0.1,
): void {
  const pa = g.getAttribute('position');
  const n = pa.count;
  const pos = pa.array as Float32Array;
  let top = -Infinity;
  for (let i = 0; i < n; i++) top = Math.max(top, pos[i * 3 + 1]);
  // Axis of the skirt per 2 cm of height.
  const BIN = 0.02;
  const sums = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const b = Math.round(pos[i * 3 + 1] / BIN);
    const e = sums.get(b) ?? [0, 0, 0];
    e[0] += pos[i * 3];
    e[1] += pos[i * 3 + 2];
    e[2]++;
    sums.set(b, e);
  }
  const legs: number[] = [];
  for (let i = 0; i < body.length; i += 3)
    if (body[i + 1] < top - 0.12) legs.push(body[i], body[i + 1], body[i + 2]);
  const hx = new Float32Array(n);
  const hz = new Float32Array(n);
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = sums.get(Math.round(pos[i * 3 + 1] / BIN))!;
    const cx = e[0] / e[2];
    const cz = e[1] / e[2];
    const dx = pos[i * 3] - cx;
    const dz = pos[i * 3 + 2] - cz;
    const l = Math.hypot(dx, dz) || 1;
    hx[i] = dx / l;
    hz[i] = dz / l;
    let m = 0;
    for (let k = 0; k < legs.length; k += 3) {
      if (Math.abs(legs[k + 1] - pos[i * 3 + 1]) > 0.03) continue;
      const qx = legs[k] - cx;
      const qz = legs[k + 2] - cz;
      if (Math.abs(qx * hz[i] - qz * hx[i]) > 0.1) continue;
      m = Math.max(m, qx * hx[i] + qz * hz[i] + margin - l);
    }
    need[i] = Math.min(0.3, m);
  }
  const push = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let j = 0; j < n; j++) {
      if (need[j] <= d) continue;
      const dist = Math.hypot(
        pos[i * 3] - pos[j * 3],
        pos[i * 3 + 1] - pos[j * 3 + 1],
        pos[i * 3 + 2] - pos[j * 3 + 2],
      );
      if (dist < reach) d = Math.max(d, need[j] * (1 - dist / reach));
    }
    push[i] = d;
  }
  for (let i = 0; i < n; i++) {
    pos[i * 3] += hx[i] * push[i];
    pos[i * 3 + 2] += hz[i] * push[i];
  }
  pa.needsUpdate = true;
  g.computeBoundingSphere();
}
