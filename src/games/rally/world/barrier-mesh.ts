import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import {
  barrierPoint,
  frameAt,
  type BarrierContext,
  type BarrierRun,
} from './barriers';
import type { TerrainSampler } from './heightfield';
import type { World } from './world';

/**
 * Continuous barriers: the cross section of a New Jersey wall / steel guard rail swept along the road
 * edge as ONE smooth mesh (no separate 4 m props that never line up on a curve). The Jersey wall is
 * textured (concrete with a joint every 4 m, u = along / 4); the rail is vertex coloured with posts
 * every 2 m. Cut into ~100 m pieces for frustum culling. Colliders: barriers.ts.
 */

const PIECE = 100;
/** Barrier pieces of one kind are merged into one mesh per tile of this size (m): few draw calls, culling still works. */
const TILE = 192;
/** Texture repeat along a Jersey wall (m): one slab. */
const SLAB = 4;
const JERSEY_H = 0.81;

/** Jersey profile (o = metres away from the road, dy = height), closed. */
const JERSEY: [number, number][] = [
  [-0.3, 0],
  [0.3, 0],
  [0.3, 0.2],
  [0.2, 0.33],
  [0.09, JERSEY_H],
  [-0.09, JERSEY_H],
  [-0.2, 0.33],
  [-0.3, 0.2],
];

/** W-beam rail: [o, dy] front (road side) zig-zag, top lip, flat back. Open polyline. */
const RAIL: [number, number][] = [
  [0.03, 0.5],
  [0, 0.55],
  [0.03, 0.6],
  [0, 0.65],
  [0.03, 0.7],
  [0, 0.75],
  [0.02, 0.78],
  [0.06, 0.78],
  [0.06, 0.5],
];

class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
}

interface Row {
  x: number;
  y: number;
  z: number;
  /** Outward unit vector (away from the road) in x-z. */
  ox: number;
  oz: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  d: number;
}

function rowsOf(
  ctx: BarrierContext,
  ground: TerrainSampler,
  run: BarrierRun,
  from: number,
  to: number,
): Row[] {
  const rows: Row[] = [];
  for (let a = from; ;) {
    const d = Math.min(a, to);
    const p = barrierPoint(ctx, ground, run, d);
    const s = frameAt(ctx, run, d);
    rows.push({
      x: p.x,
      y: s.deck ? s.y : p.y,
      z: p.z,
      // left = (tz, -tx); outward = away from the road centre.
      ox: run.side * s.tz,
      oz: -run.side * s.tx,
      tx: s.tx,
      tz: s.tz,
      d,
    });
    if (d >= to) break;
    // Long steps on straights, 1 m on tight bends.
    a += Math.abs(s.curvature) > 0.01 ? 1 : 3;
  }
  return rows;
}

/** Sweep one profile segment (o0,dy0)-(o1,dy1) along the rows with the given outward-facing 2D normal. */
function strip(
  acc: Acc,
  rows: Row[],
  a: [number, number],
  b: [number, number],
  n: [number, number],
  color: [number, number, number],
  uvOf: (row: Row, dy: number) => [number, number],
): void {
  if (rows.length < 2) return;
  const v0 = acc.pos.length / 3;
  for (const r of rows) {
    for (const [o, dy] of [a, b]) {
      acc.pos.push(r.x + r.ox * o, r.y + dy, r.z + r.oz * o);
      const nx = r.ox * n[0];
      const nz = r.oz * n[0];
      const l = Math.hypot(nx, n[1], nz) || 1;
      acc.nor.push(nx / l, n[1] / l, nz / l);
      acc.col.push(...color);
      acc.uv.push(...uvOf(r, dy));
    }
  }
  // Wind the quads so the geometric normal agrees with `n` (first quad decides for all).
  const p = (i: number) => [
    acc.pos[(v0 + i) * 3],
    acc.pos[(v0 + i) * 3 + 1],
    acc.pos[(v0 + i) * 3 + 2],
  ];
  const p0 = p(0);
  const p1 = p(2);
  const p2 = p(1);
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const gx = e1[1] * e2[2] - e1[2] * e2[1];
  const gy = e1[2] * e2[0] - e1[0] * e2[2];
  const gz = e1[0] * e2[1] - e1[1] * e2[0];
  const want = [acc.nor[v0 * 3], acc.nor[v0 * 3 + 1], acc.nor[v0 * 3 + 2]];
  const flip = gx * want[0] + gy * want[1] + gz * want[2] < 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const q = v0 + i * 2;
    if (flip) acc.idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
    else acc.idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
  }
}

/** Closed convex cap at a run end (fan), facing along `dir` (+1 = forward tangent). */
function cap(
  acc: Acc,
  row: Row,
  prof: [number, number][],
  dir: 1 | -1,
  color: [number, number, number],
): void {
  const v0 = acc.pos.length / 3;
  for (const [o, dy] of prof) {
    acc.pos.push(row.x + row.ox * o, row.y + dy, row.z + row.oz * o);
    acc.nor.push(row.tx * dir, 0, row.tz * dir);
    acc.col.push(...color);
    acc.uv.push(0.5 + o, dy / JERSEY_H);
  }
  const P = (i: number) => [
    acc.pos[(v0 + i) * 3],
    acc.pos[(v0 + i) * 3 + 1],
    acc.pos[(v0 + i) * 3 + 2],
  ];
  for (let i = 1; i < prof.length - 1; i++) {
    const a = P(0);
    const b = P(i);
    const c = P(i + 1);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const gx = e1[1] * e2[2] - e1[2] * e2[1];
    const gz = e1[0] * e2[1] - e1[1] * e2[0];
    if (gx * row.tx * dir + gz * row.tz * dir >= 0)
      acc.idx.push(v0, v0 + i, v0 + i + 1);
    else acc.idx.push(v0, v0 + i + 1, v0 + i);
  }
}

/** Axis-aligned-to-the-road box (posts). */
function post(
  acc: Acc,
  row: Row,
  o: number,
  w: number,
  h: number,
  t: number,
  color: [number, number, number],
): void {
  const cx = row.x + row.ox * o;
  const cz = row.z + row.oz * o;
  const hw = w / 2;
  const ht = t / 2;
  const P = (u: number, v: number, y: number): [number, number, number] => [
    cx + row.tx * u + row.ox * v,
    y,
    cz + row.tz * u + row.oz * v,
  ];
  const faces: {
    n: [number, number, number];
    q: [number, number, number][];
  }[] = [
    {
      n: [row.tx, 0, row.tz],
      q: [
        P(hw, -ht, row.y),
        P(hw, ht, row.y),
        P(hw, ht, row.y + h),
        P(hw, -ht, row.y + h),
      ],
    },
    {
      n: [-row.tx, 0, -row.tz],
      q: [
        P(-hw, ht, row.y),
        P(-hw, -ht, row.y),
        P(-hw, -ht, row.y + h),
        P(-hw, ht, row.y + h),
      ],
    },
    {
      n: [row.ox, 0, row.oz],
      q: [
        P(hw, ht, row.y),
        P(-hw, ht, row.y),
        P(-hw, ht, row.y + h),
        P(hw, ht, row.y + h),
      ],
    },
    {
      n: [-row.ox, 0, -row.oz],
      q: [
        P(-hw, -ht, row.y),
        P(hw, -ht, row.y),
        P(hw, -ht, row.y + h),
        P(-hw, -ht, row.y + h),
      ],
    },
    {
      n: [0, 1, 0],
      q: [
        P(-hw, -ht, row.y + h),
        P(hw, -ht, row.y + h),
        P(hw, ht, row.y + h),
        P(-hw, ht, row.y + h),
      ],
    },
  ];
  for (const f of faces) {
    const v0 = acc.pos.length / 3;
    for (const q of f.q) {
      acc.pos.push(...q);
      acc.nor.push(...f.n);
      acc.col.push(...color);
      acc.uv.push(0, 0);
    }
    acc.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
}

function toMesh(a: Acc, mat: MeshStandardMaterial): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(a.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(a.nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(a.col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(a.uv), 2));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  const m = new Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** Outward 2D normal of a segment of a convex closed profile (away from its centroid). */
function convexNormal(prof: [number, number][], i: number): [number, number] {
  const a = prof[i];
  const b = prof[(i + 1) % prof.length];
  let n: [number, number] = [b[1] - a[1], -(b[0] - a[0])];
  const cx = prof.reduce((s, p) => s + p[0], 0) / prof.length;
  const cy = prof.reduce((s, p) => s + p[1], 0) / prof.length;
  if (n[0] * ((a[0] + b[0]) / 2 - cx) + n[1] * ((a[1] + b[1]) / 2 - cy) < 0)
    n = [-n[0], -n[1]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l];
}

export function* barrierMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const runs = world.barrierRuns;
  if (!runs.length) return undefined;
  const group = new Group();
  group.name = 'barriers';
  const jerseyMat = new MeshStandardMaterial({
    map: getTexture('barrier_jersey'),
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  });
  const railMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.5,
    side: DoubleSide,
  });
  const ctx: BarrierContext = { road: world.road, net: world.gen.paths };
  const white: [number, number, number] = [1, 1, 1];
  const steel: [number, number, number] = [0.62, 0.64, 0.66];
  const postCol: [number, number, number] = [0.3, 0.31, 0.32];
  const tiles = new Map<string, { acc: Acc; mat: MeshStandardMaterial }>();
  const tileAcc = (
    kind: string,
    x: number,
    z: number,
    mat: MeshStandardMaterial,
  ) => {
    const k = `${kind}:${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { acc: new Acc(), mat }));
    return t.acc;
  };
  for (const run of runs) {
    for (let from = run.from; from < run.to - 0.5; from += PIECE) {
      const to = Math.min(run.to, from + PIECE);
      const rows = rowsOf(ctx, world.analytic, run, from, to);
      const acc = tileAcc(
        run.rule.kind,
        rows[0].x,
        rows[0].z,
        run.rule.kind === 'jersey' ? jerseyMat : railMat,
      );
      if (run.rule.kind === 'jersey') {
        const uvOf = (r: Row, dy: number): [number, number] => [
          r.d / SLAB,
          dy / JERSEY_H,
        ];
        for (let i = 0; i < JERSEY.length; i++)
          strip(
            acc,
            rows,
            JERSEY[i],
            JERSEY[(i + 1) % JERSEY.length],
            convexNormal(JERSEY, i),
            white,
            uvOf,
          );
        // Slightly darker wall base: handled by the texture. Close the ends.
        if (from === run.from) cap(acc, rows[0], JERSEY, -1, white);
        if (to === run.to) cap(acc, rows[rows.length - 1], JERSEY, 1, white);
      } else {
        const uvOf = (): [number, number] => [0, 0];
        for (let i = 0; i < RAIL.length - 1; i++) {
          const a = RAIL[i];
          const b = RAIL[i + 1];
          // Front zig-zag faces the road, the lip faces up, the back faces away.
          const n: [number, number] =
            i < 6 ? [-1, 0] : i === 6 ? [0, 1] : [1, 0];
          strip(acc, rows, a, b, n, steel, uvOf);
        }
        // Posts every 2 m (aligned to the rail's own metres so they never shift between pieces).
        for (let d = Math.ceil(from / 2) * 2; d < to; d += 2) {
          const r = rowsOf(ctx, world.analytic, run, d, d + 0.01)[0];
          post(acc, r, 0.14, 0.12, 0.78, 0.1, postCol);
        }
      }
    }
    yield;
  }
  for (const { acc, mat } of tiles.values()) {
    group.add(toMesh(acc, mat));
    yield;
  }
  return group;
}
