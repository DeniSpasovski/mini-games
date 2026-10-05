import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  ShapeUtils,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { ORIGIN } from '../frame';
import { castsShadow, lotMaterial, tileOf, type MatKey } from './materials';

/**
 * Geometry toolkit of the start row: pieces (boxes, quads, flat polygons, sweeps, any three.js
 * geometry) are written into per-material "soups" with the paint baked into vertex colours, so the
 * whole row ends up as a few dozen meshes (merged per 64 m tile and material).
 *
 * Pieces are built in *site* metres (x east, z south, y up above the lot's ground, see frame.ts).
 * A `Frame` moves them into the world: translate by the site origin, then shear y onto the lot's
 * graded plane (a lot is a level pad on a slope along the street, so walls stay vertical and
 * every edge keeps its length). Street dressing has no plane and drapes itself on the terrain.
 */

/** y offset = a * X + b * Z + c in world metres. */
export interface Plane {
  a: number;
  b: number;
  c: number;
}

/** Least-squares plane through (x, z, y) samples. */
export function fitPlane(samples: [number, number, number][]): Plane {
  // Centre the data for conditioning, then solve the 3x3 normal equations.
  const n = samples.length;
  const mx = samples.reduce((s, p) => s + p[0], 0) / n;
  const mz = samples.reduce((s, p) => s + p[1], 0) / n;
  const my = samples.reduce((s, p) => s + p[2], 0) / n;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let sxy = 0;
  let szy = 0;
  for (const [x, z, y] of samples) {
    const dx = x - mx;
    const dz = z - mz;
    const dy = y - my;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  const a = Math.abs(det) < 1e-9 ? 0 : (sxy * szz - szy * sxz) / det;
  const b = Math.abs(det) < 1e-9 ? 0 : (szy * sxx - sxy * sxz) / det;
  return { a, b, c: my - a * mx - b * mz };
}

/** Growing arrays of one mesh: positions, normals, uvs and vertex colours (all triangles). */
export class Soup {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.pos), 3),
    );
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(this.nor), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** All soups of a build, by tile and material. */
export class Bucket {
  private tiles = new Map<string, Map<MatKey, Soup>>();

  soup(tile: string, key: MatKey): Soup {
    let t = this.tiles.get(tile);
    if (!t) this.tiles.set(tile, (t = new Map()));
    let s = t.get(key);
    if (!s) t.set(key, (s = new Soup()));
    return s;
  }

  /** Total triangles written so far. */
  get triangles(): number {
    let n = 0;
    for (const t of this.tiles.values())
      for (const s of t.values()) n += s.triangles;
    return n;
  }

  build(name: string): Group {
    const group = new Group();
    group.name = name;
    for (const [tile, soups] of this.tiles)
      for (const [key, soup] of soups) {
        if (!soup.pos.length) continue;
        const mesh = new Mesh(soup.geometry(), lotMaterial(key));
        mesh.name = `${tile} ${key}`;
        mesh.castShadow = castsShadow(key);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    return group;
  }
}

/** Tile key (64 m) of a site point. */
export const tileKey = (x: number, z: number): string =>
  `${Math.floor((x + ORIGIN.x) / 64)},${Math.floor((z + ORIGIN.z) / 64)}`;

type V3 = [number, number, number];

const colorCache = new Map<string, Color>();
const colorOf = (c: ColorRepresentation): Color => {
  if (typeof c !== 'string') return new Color(c);
  let v = colorCache.get(c);
  if (!v) colorCache.set(c, (v = new Color(c)));
  return v;
};

const _p = new Vector3();
const _n = new Vector3();

/** Options shared by the emit helpers. */
export interface EmitOptions {
  /** Local matrix (rigid: rotation + translation) applied before the frame transform. */
  matrix?: Matrix4;
}

/**
 * Where pieces go: one tile of the bucket, one lot's plane (or none: the pieces carry their own
 * heights). All coordinates in and out are site metres; `y` is above the plane.
 */
export class Frame {
  constructor(
    readonly bucket: Bucket,
    readonly tile: string,
    readonly plane?: Plane,
  ) {}

  /** A derived frame on another tile of the same bucket (long street runs are split). */
  onTile(tile: string): Frame {
    return new Frame(this.bucket, tile, this.plane);
  }

  private write(
    soup: Soup,
    p: V3,
    n: V3,
    uv: [number, number],
    c: Color,
    m?: Matrix4,
    nm?: Matrix3,
  ): void {
    _p.set(p[0], p[1], p[2]);
    _n.set(n[0], n[1], n[2]);
    if (m) {
      _p.applyMatrix4(m);
      _n.applyMatrix3(nm!).normalize();
    }
    const X = _p.x + ORIGIN.x;
    const Z = _p.z + ORIGIN.z;
    let Y = _p.y;
    if (this.plane) {
      Y += this.plane.a * X + this.plane.b * Z + this.plane.c;
      // Normal of a sheared surface: (nx - a ny, ny, nz - b ny).
      _n.set(
        _n.x - this.plane.a * _n.y,
        _n.y,
        _n.z - this.plane.b * _n.y,
      ).normalize();
    }
    soup.pos.push(X, Y, Z);
    soup.nor.push(_n.x, _n.y, _n.z);
    soup.uv.push(uv[0], uv[1]);
    soup.col.push(c.r, c.g, c.b);
  }

  /**
   * One triangle (counter-clockwise seen from the front). `uv` in metres (divided by the
   * material's tile here) unless `rawUv`, then 0..1 as given.
   */
  tri(
    key: MatKey,
    a: V3,
    b: V3,
    c: V3,
    color: ColorRepresentation,
    uv: [[number, number], [number, number], [number, number]],
    o: EmitOptions & { rawUv?: boolean } = {},
  ): void {
    const soup = this.bucket.soup(this.tile, key);
    const [tu, tv] = o.rawUv ? [1, 1] : tileOf(key);
    const col = colorOf(color);
    const n = normalOf(a, b, c);
    const nm = o.matrix ? new Matrix3().getNormalMatrix(o.matrix) : undefined;
    [a, b, c].forEach((p, i) =>
      this.write(soup, p, n, [uv[i][0] / tu, uv[i][1] / tv], col, o.matrix, nm),
    );
  }

  /** A quad p0 p1 p2 p3 (counter-clockwise seen from the front). */
  quad(
    key: MatKey,
    p0: V3,
    p1: V3,
    p2: V3,
    p3: V3,
    color: ColorRepresentation,
    uv: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    o: EmitOptions & { rawUv?: boolean } = {},
  ): void {
    this.tri(key, p0, p1, p2, color, [uv[0], uv[1], uv[2]], o);
    this.tri(key, p0, p2, p3, color, [uv[0], uv[2], uv[3]], o);
  }

  /** Axis-aligned box with metre UVs taken from its own local coordinates (u along x / z, v up). */
  box(
    key: MatKey,
    [x0, y0, z0]: V3,
    [x1, y1, z1]: V3,
    color: ColorRepresentation,
    o: EmitOptions & { bottom?: boolean; top?: boolean } = {},
  ): void {
    const q = (a: V3, b: V3, c: V3, d: V3, uv: [number, number][]): void =>
      this.quad(key, a, b, c, d, color, uv, o);
    // +z (front), -z, +x, -x, +y, -y. UV: wall faces (x or z, y); top / bottom (x, z).
    q(
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
    );
    q(
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [
        [x1, y0],
        [x0, y0],
        [x0, y1],
        [x1, y1],
      ],
    );
    q(
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [
        [z1, y0],
        [z0, y0],
        [z0, y1],
        [z1, y1],
      ],
    );
    q(
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
      [
        [z0, y0],
        [z1, y0],
        [z1, y1],
        [z0, y1],
      ],
    );
    if (o.top !== false)
      q(
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
        [
          [x0, z1],
          [x1, z1],
          [x1, z0],
          [x0, z0],
        ],
      );
    if (o.bottom !== false)
      q(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
      );
  }

  /**
   * Any three.js geometry (cylinders, lathes, icospheres...): positions / normals / uvs copied
   * (uvs scaled by 1 / tile), indexed or not.
   */
  add(
    key: MatKey,
    g: BufferGeometry,
    color: ColorRepresentation = '#ffffff',
    o: EmitOptions = {},
  ): void {
    const soup = this.bucket.soup(this.tile, key);
    const col = colorOf(color);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const nm = o.matrix ? new Matrix3().getNormalMatrix(o.matrix) : undefined;
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      this.write(
        soup,
        [pos.getX(v), pos.getY(v), pos.getZ(v)],
        nor ? [nor.getX(v), nor.getY(v), nor.getZ(v)] : [0, 1, 0],
        uv ? [uv.getX(v), uv.getY(v)] : [0, 0],
        col,
        o.matrix,
        nm,
      );
    }
  }

  /**
   * A flat polygon (outline in site x, z; optional holes) at height `y`, facing up, UVs planar in
   * metres. `lift(x, z)` adds a height per vertex (draped surfaces); big polygons are subdivided
   * first when it is given.
   */
  polygon(
    key: MatKey,
    outline: Vector2[],
    y: number,
    color: ColorRepresentation,
    o: {
      holes?: Vector2[][];
      lift?: (x: number, z: number) => number;
      step?: number;
    } = {},
  ): void {
    const soup = this.bucket.soup(this.tile, key);
    const [tu, tv] = tileOf(key);
    const col = colorOf(color);
    const holes = o.holes ?? [];
    // (Earcut inside three copes with either winding.)
    const faces = ShapeUtils.triangulateShape(outline, holes);
    const all = [...outline, ...holes.flat()];
    let tris: [Vector2, Vector2, Vector2][] = faces.map(([a, b, c]) => [
      all[a],
      all[b],
      all[c],
    ]);
    if (o.lift && o.step) tris = tris.flatMap((t) => subdivide(t, o.step!));
    for (const t of tris) {
      // Face up: flip when the winding comes out downwards.
      const cross =
        (t[1].x - t[0].x) * (t[2].y - t[0].y) -
        (t[1].y - t[0].y) * (t[2].x - t[0].x);
      const order = cross > 0 ? [t[0], t[2], t[1]] : t;
      for (const p of order)
        this.write(
          soup,
          [p.x, y + (o.lift ? o.lift(p.x, p.y) : 0), p.y],
          [0, 1, 0],
          [(p.x + ORIGIN.x) / tu, (p.y + ORIGIN.z) / tv],
          col,
        );
    }
  }

  /**
   * Sweeps a cross-section along a polyline (site x, z). `section` is (offset to the left of the
   * direction of travel, height) pairs; each segment of it becomes a strip facing up / out of the
   * left. `lift(x, z)` drapes the line over the terrain. UVs: u along the line, v across, metres.
   */
  sweep(
    key: MatKey,
    line: Vector2[],
    section: [number, number][],
    color: ColorRepresentation,
    o: { lift?: (x: number, z: number) => number; closed?: boolean } = {},
  ): void {
    if (line.length < 2) return;
    const soup = this.bucket.soup(this.tile, key);
    const [tu, tv] = tileOf(key);
    const col = colorOf(color);
    const left = line.map((_, i) => {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const d = b.clone().sub(a).normalize();
      return new Vector2(d.y, -d.x);
    });
    const along = [0];
    for (let i = 1; i < line.length; i++)
      along.push(along[i - 1] + line[i].distanceTo(line[i - 1]));
    const at = (i: number, k: number): V3 => {
      const [off, h] = section[k];
      const x = line[i].x + left[i].x * off;
      const z = line[i].y + left[i].y * off;
      return [x, h + (o.lift ? o.lift(line[i].x, line[i].y) : 0), z];
    };
    const acrossAt = [0];
    for (let k = 1; k < section.length; k++)
      acrossAt.push(
        acrossAt[k - 1] +
          Math.hypot(
            section[k][0] - section[k - 1][0],
            section[k][1] - section[k - 1][1],
          ),
      );
    for (let k = 0; k < section.length - 1; k++) {
      const across0 = acrossAt[k];
      const across1 = acrossAt[k + 1];
      for (let i = 0; i < line.length - 1; i++) {
        const p0 = at(i, k);
        const p1 = at(i + 1, k);
        const p2 = at(i + 1, k + 1);
        const p3 = at(i, k + 1);
        // Face: to the left of travel / upwards. Pick the winding whose normal has the larger
        // component along the strip's intended facing (up for flat strips, left for walls).
        const nrm = normalOf(p0, p3, p2);
        const flip =
          nrm[1] < -0.0001 ||
          (Math.abs(nrm[1]) < 0.0001 &&
            nrm[0] * left[i].x + nrm[2] * left[i].y < 0);
        const uvs: [number, number][] = [
          [along[i] / tu, across0 / tv],
          [along[i + 1] / tu, across0 / tv],
          [along[i + 1] / tu, across1 / tv],
          [along[i] / tu, across1 / tv],
        ];
        const emit = (
          a: V3,
          b: V3,
          c: V3,
          ua: [number, number],
          ub: [number, number],
          uc: [number, number],
        ) => {
          const n = normalOf(a, b, c);
          [a, b, c].forEach((p, j) =>
            this.write(soup, p, n, [ua, ub, uc][j], col),
          );
        };
        if (!flip) {
          emit(p0, p3, p2, uvs[0], uvs[3], uvs[2]);
          emit(p0, p2, p1, uvs[0], uvs[2], uvs[1]);
        } else {
          emit(p0, p2, p3, uvs[0], uvs[2], uvs[3]);
          emit(p0, p1, p2, uvs[0], uvs[1], uvs[2]);
        }
      }
    }
  }
}

/** Triangle normal (counter-clockwise front). */
function normalOf(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Splits a triangle (x, z points) until every edge is shorter than `step`. */
function subdivide(
  t: [Vector2, Vector2, Vector2],
  step: number,
): [Vector2, Vector2, Vector2][] {
  const edges = [
    t[0].distanceTo(t[1]),
    t[1].distanceTo(t[2]),
    t[2].distanceTo(t[0]),
  ];
  if (Math.max(...edges) <= step) return [t];
  const mid = (a: Vector2, b: Vector2) => a.clone().add(b).multiplyScalar(0.5);
  const [a, b, c] = t;
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  return [
    ...subdivide([a, ab, ca], step),
    ...subdivide([ab, b, bc], step),
    ...subdivide([ca, bc, c], step),
    ...subdivide([ab, bc, ca], step),
  ];
}
