/**
 * Seamless critter bodies from a signed distance field (DETAILS.md "Cast"). A body is a list of solids - ellipsoids
 * (optionally turned and pressed flat by cut planes: the mid-poly planes) and round cones (limbs, necks, tails) - each
 * joined to what came before by a smooth union with its own blend radius, or carved out of it (`sub`: eye sockets, ear
 * bowls, a mouth groove). The field is polygonised with surface nets on a grid of `cell` size, every vertex is pulled
 * onto the true surface and gets its normal from the field's gradient, so there are no seams at the neck, shoulders or
 * wrists. Shading and skin weights come from the same solids: each vertex blends the solids it lies on (by how close
 * each one's own surface is), and ambient occlusion sampled from the field darkens creases, armpits and the underside
 * of the chin (the colour is painted per pixel, `toon.ts`). DOM-free and deterministic.
 */

export type V3 = readonly [number, number, number];
/** A flat face pressed into an ellipsoid: plane normal in the solid's own frame, at `k` x its reach along that normal. */
export type Cut = readonly [number, number, number, number];

/** An ellipsoid (`c`, `r`, turned by `rot` = z, then x, then y radians) or a round cone from `a` (`ra`) to `b` (`rb`). */
export interface Solid {
  c?: V3;
  r?: V3;
  rot?: V3;
  cuts?: readonly Cut[];
  /** Softness of the cut edges (a bevel). */
  bevel?: number;
  a?: V3;
  b?: V3;
  ra?: number;
  rb?: number;
}

export interface Shape extends Solid {
  /** The bone that moves it (skin weights). */
  bone: number;
  color: number;
  /** Smooth-union (or carve) radius against everything before it. */
  blend?: number;
  /** Carve it out instead of adding it. */
  sub?: boolean;
}

export interface BodySpec {
  shapes: readonly Shape[];
  /** Extra solids that only shade (ambient occlusion): the vest and hat brim. */
  occluders?: readonly Solid[];
  /** Grid cell (critter units): smaller = more triangles. */
  cell: number;
  bones: number;
}

export interface BodyMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Four bones and weights per vertex. */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
}

// ------------------------------------------------------------------ solids

interface Compiled {
  cone: boolean;
  // ellipsoid
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  /** World -> local rotation, row major. */
  m: Float64Array;
  cuts: Float64Array;
  bevel: number;
  // round cone
  ax: number;
  ay: number;
  az: number;
  bax: number;
  bay: number;
  baz: number;
  l2: number;
  rr: number;
  a2: number;
  il2: number;
  r1: number;
  r2: number;
  // bounds
  min: [number, number, number];
  max: [number, number, number];
}

function rotation(rot: V3 = [0, 0, 0]): Float64Array {
  const [x, y, z] = rot;
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const mul = (a: number[], b: number[]) => {
    const o = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return o;
  };
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const r = mul(Ry, mul(Rx, Rz));
  // the inverse of a rotation is its transpose
  return Float64Array.from([
    r[0],
    r[3],
    r[6],
    r[1],
    r[4],
    r[7],
    r[2],
    r[5],
    r[8],
  ]);
}

function compile(s: Solid): Compiled {
  const o = {
    cone: !!s.a,
    cx: 0,
    cy: 0,
    cz: 0,
    rx: 1,
    ry: 1,
    rz: 1,
    m: rotation(s.rot),
    cuts: new Float64Array(0),
    bevel: s.bevel ?? 0.012,
    ax: 0,
    ay: 0,
    az: 0,
    bax: 0,
    bay: 0,
    baz: 0,
    l2: 1,
    rr: 0,
    a2: 1,
    il2: 1,
    r1: 0,
    r2: 0,
    min: [0, 0, 0] as [number, number, number],
    max: [0, 0, 0] as [number, number, number],
  };
  if (s.a && s.b) {
    const [ax, ay, az] = s.a;
    const [bx, by, bz] = s.b;
    o.ax = ax;
    o.ay = ay;
    o.az = az;
    o.bax = bx - ax;
    o.bay = by - ay;
    o.baz = bz - az;
    o.l2 = o.bax * o.bax + o.bay * o.bay + o.baz * o.baz;
    o.r1 = s.ra ?? 0.05;
    o.r2 = s.rb ?? o.r1;
    o.rr = o.r1 - o.r2;
    o.a2 = o.l2 - o.rr * o.rr;
    o.il2 = 1 / o.l2;
    const r = Math.max(o.r1, o.r2);
    for (let i = 0; i < 3; i++) {
      o.min[i] = Math.min(s.a[i], s.b[i]) - r;
      o.max[i] = Math.max(s.a[i], s.b[i]) + r;
    }
  } else {
    const c = s.c ?? [0, 0, 0];
    const r = s.r ?? [0.1, 0.1, 0.1];
    [o.cx, o.cy, o.cz] = c;
    [o.rx, o.ry, o.rz] = r;
    const cuts: number[] = [];
    for (const [x, y, z, k] of s.cuts ?? []) {
      const l = Math.hypot(x, y, z);
      const nx = x / l;
      const ny = y / l;
      const nz = z / l;
      cuts.push(nx, ny, nz, k * Math.hypot(r[0] * nx, r[1] * ny, r[2] * nz));
    }
    o.cuts = Float64Array.from(cuts);
    const m = Math.max(r[0], r[1], r[2]);
    for (let i = 0; i < 3; i++) {
      o.min[i] = c[i] - m;
      o.max[i] = c[i] + m;
    }
  }
  return o;
}

const smin = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

/** Distance from (x, y, z) to a compiled solid (negative inside; an ellipsoid's is the usual close bound). */
function dist(s: Compiled, x: number, y: number, z: number): number {
  if (s.cone) {
    // round cone (Inigo Quilez)
    const pax = x - s.ax;
    const pay = y - s.ay;
    const paz = z - s.az;
    const yy = pax * s.bax + pay * s.bay + paz * s.baz;
    const zz = yy - s.l2;
    const qx = pax * s.l2 - s.bax * yy;
    const qy = pay * s.l2 - s.bay * yy;
    const qz = paz * s.l2 - s.baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * s.l2;
    const z2 = zz * zz * s.l2;
    const k = Math.sign(s.rr) * s.rr * s.rr * x2;
    if (Math.sign(zz) * s.a2 * z2 > k) return Math.sqrt(x2 + z2) * s.il2 - s.r2;
    if (Math.sign(yy) * s.a2 * y2 < k) return Math.sqrt(x2 + y2) * s.il2 - s.r1;
    return (Math.sqrt(x2 * s.a2 * s.il2) + yy * s.rr) * s.il2 - s.r1;
  }
  const dx = x - s.cx;
  const dy = y - s.cy;
  const dz = z - s.cz;
  const m = s.m;
  const lx = m[0] * dx + m[1] * dy + m[2] * dz;
  const ly = m[3] * dx + m[4] * dy + m[5] * dz;
  const lz = m[6] * dx + m[7] * dy + m[8] * dz;
  const ax = lx / s.rx;
  const ay = ly / s.ry;
  const az = lz / s.rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / s.rx;
  const by = ay / s.ry;
  const bz = az / s.rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  let d = k1 < 1e-9 ? -Math.min(s.rx, s.ry, s.rz) : (k0 * (k0 - 1)) / k1;
  const c = s.cuts;
  for (let i = 0; i < c.length; i += 4)
    d = smax(d, lx * c[i] + ly * c[i + 1] + lz * c[i + 2] - c[i + 3], s.bevel);
  return d;
}

// ------------------------------------------------------------------ the field

interface Op {
  s: Compiled;
  blend: number;
  sub: boolean;
}

/** Bricks of the grid know which solids reach into them, so a sample only looks at its neighbours. */
const BRICK = 6;
const FAR = 1;

class Field {
  readonly ops: Op[];
  readonly lo: [number, number, number];
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  private readonly bx: number;
  private readonly by: number;
  private readonly bz: number;
  private readonly lists: Int32Array[];

  constructor(
    shapes: readonly Shape[],
    readonly h: number,
  ) {
    this.ops = shapes.map((s) => ({
      s: compile(s),
      blend: s.blend ?? 0.04,
      sub: !!s.sub,
    }));
    const lo: [number, number, number] = [1e9, 1e9, 1e9];
    const hi: [number, number, number] = [-1e9, -1e9, -1e9];
    for (const o of this.ops) {
      if (o.sub) continue;
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], o.s.min[i]);
        hi[i] = Math.max(hi[i], o.s.max[i]);
      }
    }
    for (let i = 0; i < 3; i++) {
      lo[i] -= h * 3;
      hi[i] += h * 3;
    }
    this.lo = lo;
    this.nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
    this.ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
    this.nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
    this.bx = Math.ceil(this.nx / BRICK);
    this.by = Math.ceil(this.ny / BRICK);
    this.bz = Math.ceil(this.nz / BRICK);
    this.lists = [];
    const pad = h * 2;
    for (let k = 0; k < this.bz; k++)
      for (let j = 0; j < this.by; j++)
        for (let i = 0; i < this.bx; i++) {
          const b0 = [i, j, k].map((v, a) => lo[a] + v * BRICK * h);
          const b1 = b0.map((v) => v + BRICK * h);
          const list: number[] = [];
          this.ops.forEach((o, n) => {
            const m = o.blend + pad;
            for (let a = 0; a < 3; a++)
              if (o.s.min[a] - m > b1[a] || o.s.max[a] + m < b0[a]) return;
            list.push(n);
          });
          this.lists.push(Int32Array.from(list));
        }
  }

  private listAt(x: number, y: number, z: number): Int32Array {
    const h = this.h * BRICK;
    const i = Math.min(
      this.bx - 1,
      Math.max(0, Math.floor((x - this.lo[0]) / h)),
    );
    const j = Math.min(
      this.by - 1,
      Math.max(0, Math.floor((y - this.lo[1]) / h)),
    );
    const k = Math.min(
      this.bz - 1,
      Math.max(0, Math.floor((z - this.lo[2]) / h)),
    );
    return this.lists[i + this.bx * (j + this.by * k)];
  }

  value(x: number, y: number, z: number): number {
    return this.eval(this.listAt(x, y, z), x, y, z);
  }

  eval(list: Int32Array, x: number, y: number, z: number): number {
    let d = FAR;
    const ops = this.ops;
    for (let n = 0; n < list.length; n++) {
      const o = ops[list[n]];
      const e = dist(o.s, x, y, z);
      d = o.sub ? smax(d, -e, o.blend) : smin(d, e, o.blend);
    }
    return d;
  }

  /** Samples on the grid points. */
  sample(): Float32Array {
    const { nx, ny, nz, h, lo } = this;
    const v = new Float32Array(nx * ny * nz).fill(FAR);
    for (let k = 0; k < this.bz; k++)
      for (let j = 0; j < this.by; j++)
        for (let i = 0; i < this.bx; i++) {
          const list = this.lists[i + this.bx * (j + this.by * k)];
          if (!list.length) continue;
          // a brick far from the surface (by its centre's distance) is all one sign: fill it, skip the samples
          const x1 = Math.min(nx - 1, (i + 1) * BRICK - 1);
          const y1 = Math.min(ny - 1, (j + 1) * BRICK - 1);
          const z1 = Math.min(nz - 1, (k + 1) * BRICK - 1);
          const cx = lo[0] + ((i * BRICK + x1) / 2) * h;
          const cy = lo[1] + ((j * BRICK + y1) / 2) * h;
          const cz = lo[2] + ((k * BRICK + z1) / 2) * h;
          const dc = this.eval(list, cx, cy, cz);
          if (Math.abs(dc) > BRICK * h * 1.3) {
            for (let gz = k * BRICK; gz <= z1; gz++)
              for (let gy = j * BRICK; gy <= y1; gy++)
                for (let gx = i * BRICK; gx <= x1; gx++)
                  v[gx + nx * (gy + ny * gz)] = dc;
            continue;
          }
          for (let gz = k * BRICK; gz < Math.min(nz, (k + 1) * BRICK); gz++)
            for (let gy = j * BRICK; gy < Math.min(ny, (j + 1) * BRICK); gy++)
              for (let gx = i * BRICK; gx < Math.min(nx, (i + 1) * BRICK); gx++)
                v[gx + nx * (gy + ny * gz)] = this.eval(
                  list,
                  lo[0] + gx * h,
                  lo[1] + gy * h,
                  lo[2] + gz * h,
                );
        }
    return v;
  }

  /** The value at (x, y, z), and its gradient (forward differences) in `out`. */
  gradient(x: number, y: number, z: number, out: Float64Array): number {
    const e = this.h * 0.1;
    const list = this.listAt(x, y, z);
    const d = this.eval(list, x, y, z);
    out[0] = (this.eval(list, x + e, y, z) - d) / e;
    out[1] = (this.eval(list, x, y + e, z) - d) / e;
    out[2] = (this.eval(list, x, y, z + e) - d) / e;
    return d;
  }

  /** Indices (into `ops`) of the solids near (x, y, z). */
  near(x: number, y: number, z: number): Int32Array {
    return this.listAt(x, y, z);
  }
}

// ------------------------------------------------------------------ surface nets

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const;
const EDGES = [
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
] as const;

function polygonise(f: Field): { pos: number[]; tris: number[] } {
  const { nx, ny, nz, h, lo } = f;
  const v = f.sample();
  const at = (i: number, j: number, k: number) => v[i + nx * (j + ny * k)];
  const cx = nx - 1;
  const cy = ny - 1;
  const cell = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const val = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = CORNERS[c];
          val[c] = at(i + a, j + b, k + d);
          if (val[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [e0, e1] of EDGES) {
          const v0 = val[e0];
          const v1 = val[e1];
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          const p0 = CORNERS[e0];
          const p1 = CORNERS[e1];
          sx += p0[0] + (p1[0] - p0[0]) * t;
          sy += p0[1] + (p1[1] - p0[1]) * t;
          sz += p0[2] + (p1[2] - p0[2]) * t;
          n++;
        }
        cell[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(
          lo[0] + (i + sx / n) * h,
          lo[1] + (j + sy / n) * h,
          lo[2] + (k + sz / n) * h,
        );
      }
  const tris: number[] = [];
  const c = (i: number, j: number, k: number) => cell[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, d: number, e: number) => {
    if (a < 0 || b < 0 || d < 0 || e < 0) return;
    // split along the shorter diagonal
    const l = (p: number, q: number) =>
      (pos[p * 3] - pos[q * 3]) ** 2 +
      (pos[p * 3 + 1] - pos[q * 3 + 1]) ** 2 +
      (pos[p * 3 + 2] - pos[q * 3 + 2]) ** 2;
    if (l(a, d) <= l(b, e)) tris.push(a, b, d, a, d, e);
    else tris.push(a, b, e, b, d, e);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = at(i, j, k) < 0;
        if (
          i < cx &&
          j > 0 &&
          k > 0 &&
          j < cy &&
          k < nz - 1 &&
          v0 !== at(i + 1, j, k) < 0
        )
          quad(c(i, j - 1, k - 1), c(i, j, k - 1), c(i, j, k), c(i, j - 1, k));
        if (
          j < cy &&
          i > 0 &&
          k > 0 &&
          i < cx &&
          k < nz - 1 &&
          v0 !== at(i, j + 1, k) < 0
        )
          quad(c(i - 1, j, k - 1), c(i, j, k - 1), c(i, j, k), c(i - 1, j, k));
        if (
          k < nz - 1 &&
          i > 0 &&
          j > 0 &&
          i < cx &&
          j < cy &&
          v0 !== at(i, j, k + 1) < 0
        )
          quad(c(i - 1, j - 1, k), c(i, j - 1, k), c(i, j, k), c(i - 1, j, k));
      }
  return { pos, tris };
}

// ------------------------------------------------------------------ the body

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** sRGB hex -> linear rgb (vertex colours are linear). */
function linear(hex: number, out: Float64Array, o = 0): void {
  for (let i = 0; i < 3; i++) {
    const c = ((hex >> (16 - i * 8)) & 255) / 255;
    out[o + i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
}

/** Polygonise, project, paint, weigh and shade one body. */
export function buildBody(spec: BodySpec): BodyMesh {
  const f = new Field(spec.shapes, spec.cell);
  const { pos, tris } = polygonise(f);
  const nv = pos.length / 3;
  const g = new Float64Array(3);
  const P = new Float32Array(pos);
  const N = new Float32Array(nv * 3);
  const h = spec.cell;

  // onto the true surface (Newton steps along the gradient, never further than a cell), normal from the gradient
  for (let i = 0; i < nv; i++) {
    let x = P[i * 3];
    let y = P[i * 3 + 1];
    let z = P[i * 3 + 2];
    const x0 = x;
    const y0 = y;
    const z0 = z;
    for (let it = 0; it < 2; it++) {
      const d = f.gradient(x, y, z, g);
      const l2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (l2 < 1e-12 || Math.abs(d) < h * 0.01) break;
      x -= (d * g[0]) / l2;
      y -= (d * g[1]) / l2;
      z -= (d * g[2]) / l2;
    }
    const m = Math.hypot(x - x0, y - y0, z - z0);
    if (m > h) {
      const k = h / m;
      x = x0 + (x - x0) * k;
      y = y0 + (y - y0) * k;
      z = z0 + (z - z0) * k;
    }
    P[i * 3] = x;
    P[i * 3 + 1] = y;
    P[i * 3 + 2] = z;
    f.gradient(x, y, z, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    N[i * 3] = g[0] / l;
    N[i * 3 + 1] = g[1] / l;
    N[i * 3 + 2] = g[2] / l;
  }
  // wind every triangle outwards
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const nx = N[a * 3] + N[b * 3] + N[c * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) {
      tris[t + 1] = c;
      tris[t + 2] = b;
    }
  }

  // which solids each vertex lies on: colour and bones blend over them
  const adds = f.ops.map((o, n) => ({ o, shape: spec.shapes[n] }));
  const cols = new Float64Array(adds.length * 3);
  adds.forEach((a, n) => linear(a.shape.color, cols, n * 3));
  const B = spec.bones;
  const bw = new Float32Array(nv * B);
  const C = new Float32Array(nv * 3);
  const ds = new Float64Array(adds.length);
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    const near = f.near(x, y, z);
    let dmin = 1e9;
    for (let q = 0; q < near.length; q++) {
      const n = near[q];
      if (adds[n].o.sub) continue;
      ds[n] = dist(adds[n].o.s, x, y, z);
      dmin = Math.min(dmin, ds[n]);
    }
    let sum = 0;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let q = 0; q < near.length; q++) {
      const n = near[q];
      if (adds[n].o.sub) continue;
      const fall = Math.max(adds[n].o.blend, h);
      const t = 1 - Math.min(1, (ds[n] - dmin) / fall);
      if (t <= 0) continue;
      const w = t * t;
      sum += w;
      r += cols[n * 3] * w;
      gg += cols[n * 3 + 1] * w;
      b += cols[n * 3 + 2] * w;
      bw[i * B + adds[n].shape.bone] += w;
    }
    C[i * 3] = r / sum;
    C[i * 3 + 1] = gg / sum;
    C[i * 3 + 2] = b / sum;
  }

  // adjacency, for smoothing the skin weights
  const nb: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e];
      const b = tris[t + ((e + 1) % 3)];
      if (!nb[a].includes(b)) nb[a].push(b);
      if (!nb[b].includes(a)) nb[b].push(a);
    }
  let cur = bw;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < nv; i++) {
      let s = 0;
      for (let b = 0; b < B; b++) s += cur[i * B + b];
      for (let b = 0; b < B; b++) next[i * B + b] += (cur[i * B + b] / s) * 2;
      for (const j of nb[i]) {
        let sj = 0;
        for (let b = 0; b < B; b++) sj += cur[j * B + b];
        for (let b = 0; b < B; b++) next[i * B + b] += cur[j * B + b] / sj;
      }
    }
    cur = next;
  }
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const top = new Int32Array(4);
  for (let i = 0; i < nv; i++) {
    top.fill(-1);
    for (let b = 0; b < B; b++) {
      const w = cur[i * B + b];
      if (w <= 0) continue;
      for (let s = 0; s < 4; s++) {
        if (top[s] < 0 || w > cur[i * B + top[s]]) {
          for (let q = 3; q > s; q--) top[q] = top[q - 1];
          top[s] = b;
          break;
        }
      }
    }
    let s = 0;
    for (let q = 0; q < 4; q++) if (top[q] >= 0) s += cur[i * B + top[q]];
    for (let q = 0; q < 4; q++) {
      skinIndex[i * 4 + q] = Math.max(0, top[q]);
      skinWeight[i * 4 + q] = top[q] >= 0 ? cur[i * B + top[q]] / s : 0;
    }
  }

  // ambient occlusion from the field (and the gear's own solids), the painted look (warm above, cool below)
  const occ = (spec.occluders ?? []).map(compile);
  let yMin = 1e9;
  let yMax = -1e9;
  for (let i = 0; i < nv; i++) {
    yMin = Math.min(yMin, P[i * 3 + 1]);
    yMax = Math.max(yMax, P[i * 3 + 1]);
  }
  const STEPS = [0.012, 0.03, 0.055, 0.09, 0.14];
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    const nx = N[i * 3];
    const ny = N[i * 3 + 1];
    const nz = N[i * 3 + 2];
    let o = 0;
    let wsum = 0;
    let w = 1;
    for (const s of STEPS) {
      const px = x + nx * s;
      const py = y + ny * s;
      const pz = z + nz * s;
      let d = f.value(px, py, pz);
      for (const oc of occ) d = Math.min(d, dist(oc, px, py, pz));
      o += (Math.max(0, s - d) / s) * w;
      wsum += w;
      w *= 0.75;
    }
    const ao = 1 - Math.min(1, (o / wsum) * 1.6);
    let v = (0.5 + 0.5 * ao) * (1 + 0.1 * ny);
    v *= 0.82 + 0.18 * smoothstep(0, 0.4, (y - yMin) / (yMax - yMin));
    C[i * 3] *= v * (1 + 0.03 * ny);
    C[i * 3 + 1] *= v;
    C[i * 3 + 2] *= v * (1 - 0.04 * ny);
  }

  return {
    position: P,
    normal: N,
    color: C,
    skinIndex,
    skinWeight,
    index: Uint32Array.from(tris),
  };
}

/** Query fields by the shapes' content: builders ask many questions of the same solids (and edit them in place). */
const fields = new Map<string, Field>();

/** The field of `shapes` for surface queries (cell 0.02), built once per distinct set of solids. */
function queryField(shapes: readonly Shape[]): Field {
  const key = JSON.stringify(shapes);
  let f = fields.get(key);
  if (!f) {
    // a page builds eight critters: keep the cache small
    if (fields.size > 32) fields.clear();
    f = new Field(shapes, 0.02);
    fields.set(key, f);
  }
  return f;
}

/**
 * Half-widths of the solids `shapes` (only those) at height `y`: how far the surface reaches along +x and +z from the
 * axis. For fitting the vest and the belt.
 */
export function extentAt(
  shapes: readonly Shape[],
  y: number,
  z0 = 0,
): { x: number; z: number } {
  const f = queryField(shapes);
  const march = (dx: number, dz: number) => {
    let t = 0;
    while (t < 1 && f.value(dx * t, y, z0 + dz * t) < 0) t += 0.003;
    return t;
  };
  return { x: march(1, 0), z: march(0, 1) + z0 };
}

/**
 * How far the solids `shapes` reach from the y axis at height `y`, along each of `dirs` (unit [x, z] directions): the
 * outermost surface point in that direction. For fitting gear round the whole torso, not just its front and side.
 */
export function reachAt(
  shapes: readonly Shape[],
  y: number,
  dirs: readonly (readonly [number, number])[],
): number[] {
  const f = queryField(shapes);
  return dirs.map(([dx, dz]) => {
    // from outside in: the first point inside is the outermost surface
    let t = 0.8;
    while (t > 0 && f.value(dx * t, y, dz * t) > 0) t -= 0.003;
    return Math.max(0, t);
  });
}

/** Where a ray along -z at (`x`, `y`) first meets the solids `shapes` (their front surface), or `fallback`. */
export function surfaceZ(
  shapes: readonly Shape[],
  x: number,
  y: number,
  fallback = 0,
): number {
  const f = queryField(shapes);
  for (let z = 0.8; z > -0.8; z -= 0.002) if (f.value(x, y, z) < 0) return z;
  return fallback;
}

/** Where a ray down at (`x`, `z`) first meets the solids `shapes` (their top), or `fallback`. */
export function surfaceY(
  shapes: readonly Shape[],
  x: number,
  z: number,
  fallback = 0,
): number {
  const f = queryField(shapes);
  for (let y = 1.4; y > 0; y -= 0.002) if (f.value(x, y, z) < 0) return y;
  return fallback;
}

/** Where a ray from `o` (inside) along the unit vector `d` leaves the solids `shapes`. */
export function surfaceRay(shapes: readonly Shape[], o: V3, d: V3): V3 {
  const f = queryField(shapes);
  let t = 0;
  while (
    t < 1 &&
    f.value(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0
  )
    t += 0.003;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}
