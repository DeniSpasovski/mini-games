import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  SphereGeometry,
  Vector3,
} from 'three';
import { paint } from '../../engine/geo';

/**
 * Smooth body parts for the near figures (people.ts): lofted torso / head / skirt rings, capsule limbs, hands,
 * shaped shoes. Every part is mapped onto its cell of the unwrapped people atlas (engine/people-atlas.ts) - u round
 * the part with the front at 0.5, v down it - and tagged `userData.cell = -1` (already mapped).
 */

/** Cells of the people atlas (4 x 4, the head takes two side by side). */
export const JACKET = 0;
export const KNIT = 1;
export const HIVIS = 2;
export const SLEEVE = 3;
export const JEANS = 4;
export const TROUSERS = 5;
export const SKIN = 6;
export const SHOE = 7;
export const SOLE = 8;
export const HAIR = 9;
export const HEAD = 10;
export const HAT = 12;
export const GLOVE = 13;
export const REFLECT = 14;
export const BAG = 15;

const INSET = 0.02;

/** Atlas UV of (fu, fv) inside a cell that is `wCells` cells wide; fv = 0 at the top of the cell. */
export function cellUV(
  cell: number,
  fu: number,
  fv: number,
  wCells = 1,
): [number, number] {
  const col = cell % 4;
  const row = Math.floor(cell / 4);
  return [
    (col + INSET * wCells + (wCells - 2 * INSET * wCells) * fu) / 4,
    1 - (row + INSET + (1 - 2 * INSET) * fv) / 4,
  ];
}

export const v3 = (x: number, y: number, z: number): Vector3 =>
  new Vector3(x, y, z);

/** Darkens faces turned down, lightens those turned up: a cheap baked occlusion in the vertex colours. */
function bakeAO(g: BufferGeometry): void {
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  if (!n || !c) return;
  for (let i = 0; i < c.count; i++) {
    const k = 0.88 + 0.16 * (n.getY(i) * 0.5 + 0.5);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/** Remaps a geometry whose own uv runs (u round, v up) onto an atlas cell, paints it and marks it mapped. */
function finish(
  g: BufferGeometry,
  color: string,
  cell: number,
  fv: [number, number] = [0, 1],
  wCells = 1,
): BufferGeometry {
  const p = paint(g, color);
  const uv = p.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const [u, w] = cellUV(
      cell,
      uv.getX(i),
      fv[0] + (1 - uv.getY(i)) * (fv[1] - fv[0]),
      wCells,
    );
    uv.setXY(i, u, w);
  }
  uv.needsUpdate = true;
  bakeAO(p);
  p.userData.cell = -1;
  return p;
}

export interface Ring {
  y: number;
  /** Half width (x) and depth (z). */
  w: number;
  d: number;
  /** Offsets of the ring centre. */
  x?: number;
  z?: number;
}

/**
 * A smooth lofted surface through horizontal elliptical rings, listed top to bottom. The seam is at the back, the
 * front (+Z) at u = 0.5.
 */
export function loft(
  rings: Ring[],
  sides: number,
  color: string,
  cell: number,
  opts: {
    capTop?: boolean;
    capBottom?: boolean;
    fv?: [number, number];
    wCells?: number;
  } = {},
): BufferGeometry {
  const rows = rings.length;
  const cols = sides + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < rows; i++) {
    const r = rings[i];
    for (let j = 0; j < cols; j++) {
      const th = (j / sides) * Math.PI * 2 - Math.PI;
      pos.push(
        (r.x ?? 0) + r.w * Math.sin(th),
        r.y,
        (r.z ?? 0) + r.d * Math.cos(th),
      );
      uv.push(j / sides, 1 - i / (rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const addCap = (ring: Ring, row: number, up: boolean) => {
    const base = pos.length / 3;
    pos.push(ring.x ?? 0, ring.y, ring.z ?? 0);
    uv.push(0.5, up ? 1 : 0);
    for (let j = 0; j < sides; j++) {
      const a = row * cols + j;
      const b = a + 1;
      idx.push(...(up ? [base, b, a] : [base, a, b]));
    }
  };
  if (opts.capTop) addCap(rings[0], 0, true);
  if (opts.capBottom) addCap(rings[rows - 1], rows - 1, false);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return finish(g, color, cell, opts.fv, opts.wCells);
}

/** Basis turning +Y into `axis` and +Z towards `forward` (as far as it is perpendicular to the axis). */
function basis(axis: Vector3): Matrix4 {
  const y = axis.clone().normalize();
  let f = v3(0, 0, 1);
  f.sub(y.clone().multiplyScalar(f.dot(y)));
  if (f.lengthSq() < 1e-4) f = v3(1, 0, 0);
  f.normalize();
  const x = y.clone().cross(f).normalize();
  return new Matrix4().makeBasis(x, y, f);
}

/**
 * A smooth tapered limb segment from `a` (radius `ra`) to `b` (`rb`); its front stays towards +Z, v runs from `a`
 * (fv[0]) to `b` (fv[1]).
 */
export function limb(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  color: string,
  cell: number,
  fv: [number, number] = [0, 1],
  sides = 8,
): BufferGeometry {
  const len = Math.max(a.distanceTo(b), 1e-3);
  const g = new CylinderGeometry(ra, rb, len, sides, 1, true, Math.PI);
  g.applyMatrix4(basis(a.clone().sub(b)));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return finish(g, color, cell, fv);
}

/** A joint ball (elbow, knee, shoulder) with the garment's texture. */
export function ball(
  at: Vector3,
  r: number,
  color: string,
  cell: number,
  fv: [number, number] = [0.4, 0.6],
  sx = 1,
  sy = 1,
): BufferGeometry {
  const g = new SphereGeometry(r, 8, 6, -Math.PI / 2);
  g.scale(sx, sy, sx);
  g.translate(at.x, at.y, at.z);
  return finish(g, color, cell, fv);
}

/** A unit-less box mapped on one cell (side faces u / v, top faces by x / z). */
export function slab(
  w: number,
  h: number,
  d: number,
  at: Vector3,
  color: string,
  cell: number,
  m?: Matrix4,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const [u, v] =
      ny > 0.5
        ? [p.getX(i) / w + 0.5, p.getZ(i) / d + 0.5]
        : nx > 0.5
          ? [p.getZ(i) / d + 0.5, 0.5 - p.getY(i) / h]
          : [p.getX(i) / w + 0.5, 0.5 - p.getY(i) / h];
    uv.setXY(i, u, 1 - v);
  }
  if (m) g.applyMatrix4(m);
  g.translate(at.x, at.y, at.z);
  return finish(g, color, cell);
}

/**
 * A hand along `dir` (the forearm direction, pointing down the arm) at `at` (the wrist): palm, a slightly curled
 * finger block and a thumb. `side` = +1 left / -1 right puts the thumb on the inside.
 */
export function hand(
  at: Vector3,
  dir: Vector3,
  side: number,
  color: string,
  cell: number,
): BufferGeometry[] {
  const d = dir.clone().normalize();
  // A sideways direction for the thumb: perpendicular to the arm, towards the body's centre line.
  const out = v3(-side, 0, 0.35)
    .sub(d.clone().multiplyScalar(d.dot(v3(-side, 0, 0.35))))
    .normalize();
  const at1 = at.clone().add(d.clone().multiplyScalar(0.04));
  const f0 = at.clone().add(d.clone().multiplyScalar(0.07));
  const f1 = at.clone().add(d.clone().multiplyScalar(0.145));
  const t0 = at1.clone().add(out.clone().multiplyScalar(0.03));
  const t1 = t0
    .clone()
    .add(out.clone().multiplyScalar(0.025))
    .add(d.clone().multiplyScalar(0.05));
  return [
    ball(at1, 0.042, color, cell, [0.3, 0.7], 1, 1.15),
    limb(f0, f1, 0.037, 0.026, color, cell, [0.2, 0.9], 6),
    limb(t0, t1, 0.017, 0.013, color, cell, [0.2, 0.9], 5),
  ];
}

/** A shoe: tapered upper with the lace panel on top and a rubber sole. */
export function shoe(
  at: Vector3,
  upper: string,
  sole: string,
  long: number,
): BufferGeometry[] {
  const g = new BoxGeometry(0.105, 0.085, long, 2, 1, 5);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) / long + 0.5;
    const top = p.getY(i) > 0;
    if (top)
      p.setY(i, p.getY(i) - 0.05 * Math.max(0, (t - 0.45) / 0.55) ** 1.5);
    p.setX(i, p.getX(i) * (1 - 0.2 * t));
    if (!top && t < 0.12) p.setY(i, p.getY(i) + 0.012);
    const ny = n.getY(i);
    const [u, v] =
      ny > 0.5
        ? [t, 0.15 + 0.3 * (p.getX(i) / 0.105 + 0.5)]
        : [t, 0.5 - p.getY(i) / 0.085];
    const [cu, cv] = cellUV(SHOE, u, Math.min(1, Math.max(0, v)));
    uv.setXY(i, cu, cv);
  }
  g.translate(at.x, at.y, at.z + 0.045);
  const up = paint(g, upper);
  bakeAO(up);
  up.userData.cell = -1;
  const s = slab(
    0.108,
    0.024,
    long + 0.008,
    v3(at.x, at.y - 0.052, at.z + 0.045),
    sole,
    SOLE,
  );
  return [up, s];
}

/** The head (jaw, brow, crown) as rings, centred on the origin: 0.275 m tall, face towards +Z. */
export const HEAD_RINGS: Ring[] = [
  { y: 0.135, w: 0.012, d: 0.016, z: 0.004 },
  { y: 0.122, w: 0.05, d: 0.058 },
  { y: 0.092, w: 0.086, d: 0.092, z: -0.002 },
  { y: 0.05, w: 0.101, d: 0.106, z: -0.004 },
  { y: 0.005, w: 0.105, d: 0.108 },
  { y: -0.04, w: 0.098, d: 0.1, z: 0.004 },
  { y: -0.08, w: 0.082, d: 0.088, z: 0.01 },
  { y: -0.11, w: 0.056, d: 0.066, z: 0.018 },
  { y: -0.13, w: 0.032, d: 0.04, z: 0.024 },
  { y: -0.14, w: 0.01, d: 0.015, z: 0.026 },
];
