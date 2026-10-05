import type { BufferGeometry } from 'three';

/**
 * Z-fighting finder for the blocky item models. Two triangles fight when they
 * face the same way, lie in (nearly) the same plane and overlap in area: the
 * depth buffer cannot tell them apart, so the surface flickers or shows the
 * wrong colour. DOM-free, so tests and the CLI can run it.
 */
export interface ClipPair {
  /** Triangle indices. */
  a: number;
  b: number;
  /** Plane normal and the centre of triangle `a`, for the report. */
  normal: [number, number, number];
  at: [number, number, number];
  /** Distance between the two planes (m). */
  gap: number;
}

type V = [number, number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function tri(pos: ArrayLike<number>, t: number): [V, V, V] {
  const o = t * 9;
  return [
    [pos[o], pos[o + 1], pos[o + 2]],
    [pos[o + 3], pos[o + 4], pos[o + 5]],
    [pos[o + 6], pos[o + 7], pos[o + 8]],
  ];
}

/** Project onto the two axes that are not the dominant normal axis. */
function project(p: V, drop: number): [number, number] {
  return drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[0], p[2]] : [p[0], p[1]];
}

/** True when two 2D triangles overlap by more than `eps` along every axis (SAT, touching does not count). */
function overlap2D(a: [number, number][], b: [number, number][], eps: number) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 3];
      const ax: [number, number] = [-(q[1] - p[1]), q[0] - p[0]];
      const len = Math.hypot(ax[0], ax[1]) || 1;
      let min1 = Infinity;
      let max1 = -Infinity;
      let min2 = Infinity;
      let max2 = -Infinity;
      for (const v of a) {
        const d = (v[0] * ax[0] + v[1] * ax[1]) / len;
        min1 = Math.min(min1, d);
        max1 = Math.max(max1, d);
      }
      for (const v of b) {
        const d = (v[0] * ax[0] + v[1] * ax[1]) / len;
        min2 = Math.min(min2, d);
        max2 = Math.max(max2, d);
      }
      if (Math.min(max1, max2) - Math.max(min1, min2) <= eps) return false;
    }
  }
  return true;
}

/** Möller-Trumbore: does the ray (o, d) hit the triangle at 0 < t < tMax? */
function rayHits(o: V, d: V, T: [V, V, V], tMax: number): boolean {
  const e1 = sub(T[1], T[0]);
  const e2 = sub(T[2], T[0]);
  const h = cross(d, e2);
  const a = dot(e1, h);
  if (Math.abs(a) < 1e-9) return false;
  const f = 1 / a;
  const s = sub(o, T[0]);
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return false;
  const q = cross(s, e1);
  const v = f * dot(d, q);
  if (v < 0 || u + v > 1) return false;
  const t = f * dot(e2, q);
  return t > 1e-4 && t < tMax;
}

/**
 * True when a point just above the surface (along `n`) can be seen from the
 * outside: one of a few rays leaving the surface escapes the model. Faces that
 * point down are never exposed (the camera is always above).
 */
function exposed(p: V, n: V, tris: [V, V, V][]): boolean {
  if (n[1] < -0.3) return false;
  const o: V = [p[0] + n[0] * 0.01, p[1] + n[1] * 0.01, p[2] + n[2] * 0.01];
  const dirs: V[] = [n];
  for (const k of [
    [0, 1, 0],
    [0.5, 1, 0.5],
    [-0.5, 1, 0.5],
    [0.5, 1, -0.5],
    [-0.5, 1, -0.5],
    [0, 1, 1],
    [0, 1, -1],
    [1, 1, 0],
    [-1, 1, 0],
  ] as V[]) {
    const m: V = [n[0] + k[0], n[1] + k[1], n[2] + k[2]];
    const l = Math.hypot(...m) || 1;
    const d: V = [m[0] / l, m[1] / l, m[2] / l];
    if (dot(d, n) > 0.25) dirs.push(d);
  }
  return dirs.some((d) => !tris.some((T) => rayHits(o, d, T, 1e4)));
}

/**
 * All z-fighting triangle pairs of a geometry.
 * @param planeTol max distance (m) between the planes to count as coplanar
 * @param visibleOnly drop pairs hidden inside the model (they never show)
 */
export function findZFights(
  geo: BufferGeometry,
  planeTol = 0.004,
  visibleOnly = true,
): ClipPair[] {
  const pos = geo.getAttribute('position').array;
  const n = geo.getAttribute('position').count / 3;
  const normals: V[] = [];
  const tris: [V, V, V][] = [];
  for (let t = 0; t < n; t++) {
    const T = tri(pos, t);
    tris.push(T);
    const c = cross(sub(T[1], T[0]), sub(T[2], T[0]));
    const l = Math.hypot(...c) || 1;
    normals.push([c[0] / l, c[1] / l, c[2] / l]);
  }
  const out: ClipPair[] = [];
  for (let i = 0; i < n; i++) {
    const ni = normals[i];
    if (!Number.isFinite(ni[0])) continue;
    const drop =
      Math.abs(ni[0]) >= Math.abs(ni[1]) && Math.abs(ni[0]) >= Math.abs(ni[2])
        ? 0
        : Math.abs(ni[1]) >= Math.abs(ni[2])
          ? 1
          : 2;
    const pi = tris[i].map((v) => project(v, drop));
    for (let j = i + 1; j < n; j++) {
      if (dot(ni, normals[j]) < 0.999) continue;
      const gap = Math.max(
        ...tris[j].map((v) => Math.abs(dot(ni, sub(v, tris[i][0])))),
      );
      if (gap > planeTol) continue;
      const pj = tris[j].map((v) => project(v, drop));
      if (!overlap2D(pi, pj, 1e-3)) continue;
      const a = tris[i];
      const c: V = [
        (a[0][0] + a[1][0] + a[2][0]) / 3,
        (a[0][1] + a[1][1] + a[2][1]) / 3,
        (a[0][2] + a[1][2] + a[2][2]) / 3,
      ];
      if (visibleOnly && !exposed(c, ni, tris)) continue;
      out.push({
        a: i,
        b: j,
        normal: ni,
        at: [
          (a[0][0] + a[1][0] + a[2][0]) / 3,
          (a[0][1] + a[1][1] + a[2][1]) / 3,
          (a[0][2] + a[1][2] + a[2][2]) / 3,
        ],
        gap,
      });
    }
  }
  return out;
}

/**
 * Primitives (box / cylinder / roof) that are completely hidden inside other
 * geometry: nothing of them can be seen from outside, e.g. a door placed
 * behind the wall it belongs to. Needs a geometry built with `Mesher.trace`.
 * Returns the call site of every such primitive.
 */
export function findBuried(geo: BufferGeometry): string[] {
  const pos = geo.getAttribute('position').array;
  const n = geo.getAttribute('position').count / 3;
  const prims = geo.userData.prims as number[] | undefined;
  const sites = geo.userData.sites as string[] | undefined;
  if (!prims || !sites) return [];
  const tris: [V, V, V][] = [];
  for (let t = 0; t < n; t++) tris.push(tri(pos, t));
  const seen = new Map<number, { site: string; up: number; shown: number }>();
  for (let t = 0; t < n; t++) {
    const T = tris[t];
    const c = cross(sub(T[1], T[0]), sub(T[2], T[0]));
    const l = Math.hypot(...c);
    if (l < 1e-9) continue;
    const nn: V = [c[0] / l, c[1] / l, c[2] / l];
    const rec = seen.get(prims[t]) ?? { site: sites[t], up: 0, shown: 0 };
    seen.set(prims[t], rec);
    if (nn[1] < -0.3) continue;
    rec.up++;
    const mid: V = [
      (T[0][0] + T[1][0] + T[2][0]) / 3,
      (T[0][1] + T[1][1] + T[2][1]) / 3,
      (T[0][2] + T[1][2] + T[2][2]) / 3,
    ];
    if (
      exposed(
        mid,
        nn,
        tris.filter((_, k) => prims[k] !== prims[t]),
      )
    )
      rec.shown++;
  }
  return [...seen.values()]
    .filter((r) => r.up > 0 && r.shown === 0)
    .map((r) => r.site);
}
