import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Sculpted figures (people.ts, near LODs): the body is a signed distance field - round cones for limbs, ellipsoids
 * for the torso / head, smoothly unioned - with the clothes as a thickness added to the field, polygonised with
 * surface nets. One smooth skin with armpits, hips, knees and a face instead of tubes. Normals come from the field
 * (plus cloth folds), so a coarse mesh still shades finely.
 */

export type V3 = [number, number, number];

/** What a point of the field is made of: set by every primitive's `cloth` (garment id, thickness added). */
export const cl = { g: 0, t: 0, u: 0, v: 0 };

export type ClothFn = (x: number, y: number, z: number, s: number) => void;

export interface Prim {
  kind: 0 | 1;
  // Round cone a -> b.
  a: V3;
  b: V3;
  ra: number;
  rb: number;
  // Ellipsoid: centre c, rows of the inverse basis (world -> local), radii r.
  c: V3;
  m: number[];
  r: V3;
  /** Smooth-union radius with what came before. */
  k: number;
  cloth: ClothFn;
  /** Mapping group: prims with the same group share a texture frame (see `Frame`). */
  frame: number;
  lo: V3;
  hi: V3;
}

export function cone(
  a: V3,
  b: V3,
  ra: number,
  rb: number,
  k: number,
  frame: number,
  cloth: ClothFn,
): Prim {
  const r = Math.max(ra, rb);
  return {
    kind: 0,
    a,
    b,
    ra,
    rb,
    c: a,
    m: [],
    r: [0, 0, 0],
    k,
    cloth,
    frame,
    lo: [
      Math.min(a[0], b[0]) - r,
      Math.min(a[1], b[1]) - r,
      Math.min(a[2], b[2]) - r,
    ],
    hi: [
      Math.max(a[0], b[0]) + r,
      Math.max(a[1], b[1]) + r,
      Math.max(a[2], b[2]) + r,
    ],
  };
}

/** `basis` = the three local axes (x, y, z) in world space as a 9-array (rows); radii along them. */
export function ellipsoid(
  c: V3,
  r: V3,
  basis: number[] | null,
  k: number,
  frame: number,
  cloth: ClothFn,
): Prim {
  const m = basis ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // For an orthonormal basis, world -> local is the basis rows themselves; the world extent along axis i is
  // sqrt(sum_j (m[j][i] * r[j])^2).
  const ext = [0, 1, 2].map((i) =>
    Math.sqrt(
      (m[i] * r[0]) ** 2 + (m[3 + i] * r[1]) ** 2 + (m[6 + i] * r[2]) ** 2,
    ),
  );
  return {
    kind: 1,
    a: c,
    b: c,
    ra: 0,
    rb: 0,
    c,
    m,
    r,
    k,
    cloth,
    frame,
    lo: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2]],
    hi: [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]],
  };
}

export const fixed =
  (g: number, t: number): ClothFn =>
  () => {
    cl.g = g;
    cl.t = t;
  };

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export { smooth as smoothstep };

/** Distance of one primitive. `s` receives the along-segment parameter of a cone (0..1). */
function primDist(p: Prim, x: number, y: number, z: number): [number, number] {
  if (p.kind === 0) {
    const abx = p.b[0] - p.a[0];
    const aby = p.b[1] - p.a[1];
    const abz = p.b[2] - p.a[2];
    const px = x - p.a[0];
    const py = y - p.a[1];
    const pz = z - p.a[2];
    const l2 = abx * abx + aby * aby + abz * abz + 1e-9;
    let s = (px * abx + py * aby + pz * abz) / l2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const dx = px - abx * s;
    const dy = py - aby * s;
    const dz = pz - abz * s;
    return [
      Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * s),
      s,
    ];
  }
  const px = x - p.c[0];
  const py = y - p.c[1];
  const pz = z - p.c[2];
  const m = p.m;
  const lx = m[0] * px + m[1] * py + m[2] * pz;
  const ly = m[3] * px + m[4] * py + m[5] * pz;
  const lz = m[6] * px + m[7] * py + m[8] * pz;
  const r = p.r;
  const k0x = lx / r[0];
  const k0y = ly / r[1];
  const k0z = lz / r[2];
  const k0 = Math.sqrt(k0x * k0x + k0y * k0y + k0z * k0z);
  const k1x = lx / (r[0] * r[0]);
  const k1y = ly / (r[1] * r[1]);
  const k1z = lz / (r[2] * r[2]);
  const k1 = Math.sqrt(k1x * k1x + k1y * k1y + k1z * k1z);
  if (k1 < 1e-9) return [-Math.min(r[0], r[1], r[2]), 0];
  return [(k0 * (k0 - 1)) / k1, ly / r[1]];
}

/** Lower bound of the distance to a primitive from its bounding box. */
function boxDist(p: Prim, x: number, y: number, z: number): number {
  const dx = Math.max(p.lo[0] - x, 0, x - p.hi[0]);
  const dy = Math.max(p.lo[1] - y, 0, y - p.hi[1]);
  const dz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface Field {
  prims: Prim[];
  /** Subtractions (eye sockets, hood openings): smooth-subtracted from the union. */
  cuts: { p: Prim; k: number }[];
  /** Owner prim of the last evaluation. */
  own: number;
  /** Folds of the cloth, added when shading only. */
  fold: ((x: number, y: number, z: number, g: number) => number) | null;
}

export function makeField(prims: Prim[], cuts: Field['cuts'] = []): Field {
  return { prims, cuts, own: 0, fold: null };
}

/** Evaluates the field: returns the distance; `cl` holds the garment and thickness there, `f.own` the owner. */
export function evalField(f: Field, x: number, y: number, z: number): number {
  let d = 1e9;
  let g = 0;
  let t = 0;
  let own = 0;
  let best = 1e9;
  const prims = f.prims;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const lb = boxDist(p, x, y, z);
    if (i > 0 && lb - d > p.k) continue;
    const [di, s] = primDist(p, x, y, z);
    if (i === 0) {
      p.cloth(x, y, z, s);
      d = di;
      g = cl.g;
      t = cl.t;
      own = 0;
      best = di;
      continue;
    }
    const k = p.k;
    const diff = di - d;
    const h = Math.max(k - Math.abs(diff), 0) / k;
    const mix = Math.min(1, Math.max(0, 0.5 + (0.5 * diff) / k));
    if (mix < 1) {
      p.cloth(x, y, z, s);
      if (mix < 0.5) {
        g = cl.g;
        t = cl.t * (1 - mix) + t * mix;
      } else t = cl.t * (1 - mix) + t * mix;
    }
    d = Math.min(d, di) - h * h * k * 0.25;
    if (di < best) {
      best = di;
      own = i;
    }
  }
  for (const c of f.cuts) {
    const [dc] = primDist(c.p, x, y, z);
    const k = c.k;
    const hh = Math.min(1, Math.max(0, 0.5 - (0.5 * (d + dc)) / k));
    d = d * (1 - hh) + -dc * hh + k * hh * (1 - hh);
  }
  cl.g = g;
  cl.t = t;
  f.own = own;
  return d - t;
}

export interface Mesh {
  pos: Float32Array;
  nor: Float32Array;
  gar: Uint8Array;
  own: Uint16Array;
  ao: Float32Array;
  idx: Uint32Array;
}

/**
 * Surface nets of a field sampled on a grid of `h` cells from `min` (`n` cells per axis). Far from the surface whole
 * blocks are skipped with one sample.
 */
export function polygonise(
  f: Field,
  min: V3,
  n: V3,
  h: number,
  detail: boolean,
): Mesh {
  const nx = n[0] + 1;
  const ny = n[1] + 1;
  const nz = n[2] + 1;
  const val = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const B = 4;
  for (let bk = 0; bk < nz; bk += B)
    for (let bj = 0; bj < ny; bj += B)
      for (let bi = 0; bi < nx; bi += B) {
        const ci = Math.min(bi + B / 2, nx - 1);
        const cj = Math.min(bj + B / 2, ny - 1);
        const ck = Math.min(bk + B / 2, nz - 1);
        const dc = evalField(
          f,
          min[0] + ci * h,
          min[1] + cj * h,
          min[2] + ck * h,
        );
        const far = Math.abs(dc) > B * h * 1.6;
        for (let k = bk; k < Math.min(bk + B, nz); k++)
          for (let j = bj; j < Math.min(bj + B, ny); j++)
            for (let i = bi; i < Math.min(bi + B, nx); i++)
              val[id(i, j, k)] = far
                ? dc
                : evalField(f, min[0] + i * h, min[1] + j * h, min[2] + k * h);
      }
  const cx = n[0];
  const cy = n[1];
  const cz = n[2];
  const cellId = new Int32Array(cx * cy * cz).fill(-1);
  const verts: number[] = [];
  const corner = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v =
            val[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let cnt = 0;
        for (const [a, b] of edges) {
          const va = cv[a];
          const vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += corner[a][0] + t * (corner[b][0] - corner[a][0]);
          sy += corner[a][1] + t * (corner[b][1] - corner[a][1]);
          sz += corner[a][2] + t * (corner[b][2] - corner[a][2]);
          cnt++;
        }
        cellId[i + cx * (j + cy * k)] = verts.length / 3;
        verts.push(
          min[0] + (i + sx / cnt) * h,
          min[1] + (j + sy / cnt) * h,
          min[2] + (k + sz / cnt) * h,
        );
      }
  const idx: number[] = [];
  const cell = (i: number, j: number, k: number) =>
    cellId[i + cx * (j + cy * k)];
  for (let k = 1; k < cz; k++)
    for (let j = 1; j < cy; j++)
      for (let i = 1; i < cx; i++) {
        const v0 = val[id(i, j, k)] < 0;
        for (let a = 0; a < 3; a++) {
          const ni = i + (a === 0 ? 1 : 0);
          const nj = j + (a === 1 ? 1 : 0);
          const nk = k + (a === 2 ? 1 : 0);
          if (ni > cx || nj > cy || nk > cz) continue;
          const v1 = val[id(ni, nj, nk)] < 0;
          if (v0 === v1) continue;
          const u = (a + 1) % 3;
          const w = (a + 2) % 3;
          const o = [i, j, k];
          const ou = [0, 0, 0];
          ou[u] = 1;
          const ow = [0, 0, 0];
          ow[w] = 1;
          const q0 = cell(o[0], o[1], o[2]);
          const q1 = cell(o[0] - ou[0], o[1] - ou[1], o[2] - ou[2]);
          const q2 = cell(
            o[0] - ou[0] - ow[0],
            o[1] - ou[1] - ow[1],
            o[2] - ou[2] - ow[2],
          );
          const q3 = cell(o[0] - ow[0], o[1] - ow[1], o[2] - ow[2]);
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          if (v0) idx.push(q0, q1, q2, q0, q2, q3);
          else idx.push(q0, q2, q1, q0, q3, q2);
        }
      }
  return finishMesh(f, verts, idx, h, detail);
}

/**
 * Projects the vertices onto the surface, splits the edges where the garment changes (so a hem or cuff follows
 * the field closely, not the grid), then gives every vertex its normal, garment, owner and occlusion.
 */
function finishMesh(
  f: Field,
  verts: number[],
  idx: number[],
  h: number,
  detail: boolean,
): Mesh {
  const e = Math.min(0.004, h * 0.3);
  const gars: number[] = [];
  const project = (i: number) => {
    let x = verts[i * 3];
    let y = verts[i * 3 + 1];
    let z = verts[i * 3 + 2];
    const d0 = evalField(f, x, y, z);
    const gx = evalField(f, x + e, y, z) - evalField(f, x - e, y, z);
    const gy = evalField(f, x, y + e, z) - evalField(f, x, y - e, z);
    const gz = evalField(f, x, y, z + e) - evalField(f, x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    const move = Math.max(-h * 0.6, Math.min(h * 0.6, d0));
    x -= (gx / gl) * move;
    y -= (gy / gl) * move;
    z -= (gz / gl) * move;
    verts[i * 3] = x;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = z;
    evalField(f, x, y, z);
    gars[i] = cl.g;
  };
  const n0 = verts.length / 3;
  for (let i = 0; i < n0; i++) project(i);
  // Edge splitting where the garment changes.
  for (let pass = 0; pass < 1; pass++) {
    const mid = new Map<number, number>();
    const split = (a: number, b: number): number => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let m = mid.get(key);
      if (m === undefined) {
        m = verts.length / 3;
        // Bisect along the edge to where the garment changes, so the boundary is not at the mercy of the grid.
        const ga = gars[a];
        let t0 = 0;
        let t1 = 1;
        for (let it = 0; it < 8; it++) {
          const tm = (t0 + t1) / 2;
          evalField(
            f,
            verts[a * 3] + (verts[b * 3] - verts[a * 3]) * tm,
            verts[a * 3 + 1] + (verts[b * 3 + 1] - verts[a * 3 + 1]) * tm,
            verts[a * 3 + 2] + (verts[b * 3 + 2] - verts[a * 3 + 2]) * tm,
          );
          if (cl.g === ga) t0 = tm;
          else t1 = tm;
        }
        const tt = (t0 + t1) / 2;
        verts.push(
          verts[a * 3] + (verts[b * 3] - verts[a * 3]) * tt,
          verts[a * 3 + 1] + (verts[b * 3 + 1] - verts[a * 3 + 1]) * tt,
          verts[a * 3 + 2] + (verts[b * 3 + 2] - verts[a * 3 + 2]) * tt,
        );
        project(m);
        mid.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    let any = false;
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      const sp = [0, 1, 2].map((k) => {
        const a = v[k];
        const b = v[(k + 1) % 3];
        return gars[a] !== gars[b];
      });
      const cnt = sp.filter(Boolean).length;
      if (cnt === 0) {
        next.push(v[0], v[1], v[2]);
        continue;
      }
      any = true;
      const m = [0, 1, 2].map((k) =>
        sp[k] ? split(v[k], v[(k + 1) % 3]) : -1,
      );
      if (cnt === 3) {
        next.push(
          v[0],
          m[0],
          m[2],
          m[0],
          v[1],
          m[1],
          m[2],
          m[1],
          v[2],
          m[0],
          m[1],
          m[2],
        );
      } else if (cnt === 1) {
        const k = sp.indexOf(true);
        const a = v[k];
        const b = v[(k + 1) % 3];
        const c = v[(k + 2) % 3];
        next.push(a, m[k], c, m[k], b, c);
      } else {
        // Two split edges: the unsplit one is `u`; the corner opposite to it is shared by both split edges.
        const u = sp.indexOf(false);
        const a = v[(u + 1) % 3]; // between edge u and edge u+1
        const b = v[(u + 2) % 3];
        const c = v[u];
        // Edges: u (c -> a) unsplit, u+1 (a -> b) split, u+2 (b -> c) split.
        const m1 = m[(u + 1) % 3];
        const m2 = m[(u + 2) % 3];
        next.push(a, m1, c, m1, m2, c, m1, b, m2);
      }
    }
    idx = next;
    if (!any) break;
  }
  const vc = verts.length / 3;
  const pos = new Float32Array(verts);
  const nor = new Float32Array(vc * 3);
  const gar = new Uint8Array(vc);
  const own = new Uint16Array(vc);
  const ao = new Float32Array(vc);
  const fn = (x: number, y: number, z: number): number => {
    const d = evalField(f, x, y, z);
    return detail && f.fold ? d - f.fold(x, y, z, cl.g) : d;
  };
  for (let i = 0; i < vc; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    evalField(f, x, y, z);
    gar[i] = cl.g;
    own[i] = f.own;
    const e2 = detail ? 0.003 : e;
    const gx = fn(x + e2, y, z) - fn(x - e2, y, z);
    const gy = fn(x, y + e2, z) - fn(x, y - e2, z);
    const gz = fn(x, y, z + e2) - fn(x, y, z - e2);
    const gl = Math.hypot(gx, gy, gz) || 1;
    nor[i * 3] = gx / gl;
    nor[i * 3 + 1] = gy / gl;
    nor[i * 3 + 2] = gz / gl;
    // Occlusion: how much closer the field is than the distance along the normal says.
    let occ = 0;
    let wgt = 1;
    for (const dd of [0.02, 0.05, 0.1]) {
      const fx = evalField(
        f,
        x + (gx / gl) * dd,
        y + (gy / gl) * dd,
        z + (gz / gl) * dd,
      );
      occ += Math.max(0, dd - fx) * wgt;
      wgt *= 0.6;
    }
    ao[i] = Math.max(0, 1 - occ * 7);
  }
  return { pos, nor, gar, own, ao, idx: new Uint32Array(idx) };
}

/** Primitive bounds -> grid origin and cell counts for `h`. */
export function gridFor(
  prims: Prim[],
  h: number,
  pad: number,
): { min: V3; n: V3 } {
  const lo: V3 = [1e9, 1e9, 1e9];
  const hi: V3 = [-1e9, -1e9, -1e9];
  for (const p of prims)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.lo[a]);
      hi[a] = Math.max(hi[a], p.hi[a]);
    }
  const min: V3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
  const n: V3 = [
    Math.ceil((hi[0] + pad - min[0]) / h),
    Math.ceil((hi[1] + pad - min[1]) / h),
    Math.ceil((hi[2] + pad - min[2]) / h),
  ];
  return { min, n };
}

export function toGeometry(
  parts: {
    pos: Float32Array;
    nor: Float32Array;
    col: Float32Array;
    uv: Float32Array;
    idx: Uint32Array;
  }[],
): BufferGeometry {
  let vc = 0;
  let ic = 0;
  for (const p of parts) {
    vc += p.pos.length / 3;
    ic += p.idx.length;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const col = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    nor.set(p.nor, vo * 3);
    col.set(p.col, vo * 3);
    uv.set(p.uv, vo * 2);
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    vo += p.pos.length / 3;
    io += p.idx.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}
