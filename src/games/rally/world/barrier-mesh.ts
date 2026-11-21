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
import { bridgeMaterials } from './bridge-mesh';

/**
 * Continuous barriers: the cross section of a New Jersey wall / steel guard rail swept along the road
 * edge as ONE smooth mesh (no separate 4 m props that never line up on a curve). The Jersey wall is
 * textured (concrete with a joint every 4 m, u = along / 4); the rail is vertex coloured (galvanised or rusty) times
 * a weathering map (`barrier_rail`: road grime, streaks, rust bleed; u = along / 8, v = height), posts every 2 m.
 * Cut into ~100 m pieces for frustum culling. Colliders: barriers.ts.
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

/**
 * W-beam rail: the pressed steel sheet with its two ribs facing the road, [o, dy] from the bottom edge to the top
 * (crests at o = 0, the middle valley and the edges 6-8 cm back), 0.31 m tall. Open polyline: one double-sided sheet,
 * each segment lit by its own slope so the ribs read in any light.
 */
const RAIL: [number, number][] = [
  [0.08, 0.47],
  [0.06, 0.476],
  [0.015, 0.51],
  [0, 0.53],
  [0, 0.555],
  [0.015, 0.575],
  [0.055, 0.61],
  [0.065, 0.625],
  [0.055, 0.64],
  [0.015, 0.675],
  [0, 0.695],
  [0, 0.72],
  [0.015, 0.74],
  [0.06, 0.774],
  [0.08, 0.78],
];

/** How far the second beam of a two-tier rail sits under the first (m). */
const TIER2 = 0.32;

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
  uvOf: (row: Row, dy: number, o: number) => [number, number],
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
      acc.uv.push(...uvOf(r, dy, o));
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
      acc.uv.push(0.004, q[1] - row.y);
    }
    acc.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }
}

/** Small slab-bridge kerb (kind 'kerb'): from the road edge + 5 cm out to the deck edge (rule offset 0.45), o < 0 = inward. */
const KERB_IN = -0.4;
const KERB_H = 0.28;
const KERB_TS = 4;
/** Painted pipe railing on a kerb: posts on its outer half, two rails (m above the kerb top). */
const PIPE_O = -0.12;
const PIPE_R = 0.03;
const POST_R = 0.035;
const RAIL_HI = 0.75;
const RAIL_LO = 0.38;
const POST_GAP = 2;
/** Linear vertex colours: the faded mustard yellow paint, where it chipped off (rust / bare grey). */
const PAINT: [number, number, number] = [0.6, 0.45, 0.035];
const RUST: [number, number, number] = [0.2, 0.075, 0.025];
const BARE: [number, number, number] = [0.3, 0.29, 0.26];

/** Deterministic 0..1 hash of a number. */
function hash1(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Chipped paint colour of the piece of a pipe at `key`: mostly paint, some rust or bare steel, a slight fade. */
function chipped(key: number): [number, number, number] {
  const h = hash1(key);
  const f = 0.85 + 0.2 * hash1(key + 7.3);
  if (h < 0.1) return RUST;
  if (h < 0.17) return BARE;
  if (h < 0.3) {
    // Paint half gone: between paint and rust.
    return [
      (PAINT[0] + RUST[0]) / 2,
      (PAINT[1] + RUST[1]) / 2,
      (PAINT[2] + RUST[2]) / 2,
    ];
  }
  return [PAINT[0] * f, PAINT[1] * f, PAINT[2] * f];
}

/** Octagon around (oc, yc) in profile space. */
function tube(oc: number, yc: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    out.push([oc + Math.cos(a) * r, yc + Math.sin(a) * r]);
  }
  return out;
}

/** Vertical round post (octagon) at lateral `o` of `row`, from y0 to y1. */
function roundPost(
  acc: Acc,
  row: Row,
  o: number,
  r: number,
  y0: number,
  y1: number,
  color: [number, number, number],
): void {
  const cx = row.x + row.ox * o;
  const cz = row.z + row.oz * o;
  const v0 = acc.pos.length / 3;
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    for (const y of [y0, y1]) {
      acc.pos.push(cx + nx * r, y, cz + nz * r);
      acc.nor.push(nx, 0, nz);
      acc.col.push(...color);
      acc.uv.push(0, 0);
    }
  }
  for (let k = 0; k < 8; k++) {
    const q = v0 + k * 2;
    acc.idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
  }
  // Cap.
  const c0 = acc.pos.length / 3;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    acc.pos.push(cx + Math.cos(a) * r, y1, cz + Math.sin(a) * r);
    acc.nor.push(0, 1, 0);
    acc.col.push(...color);
    acc.uv.push(0, 0);
  }
  for (let k = 1; k < 7; k++) acc.idx.push(c0, c0 + k + 1, c0 + k);
}

/** One horizontal pipe swept along `rows`, in pieces of its own chipped colour. */
function pipe(
  acc: Acc,
  rows: Row[],
  oc: number,
  yc: number,
  seed: number,
): void {
  const prof = tube(oc, yc, PIPE_R);
  for (let i = 0; i < rows.length - 1; i++) {
    const seg = [rows[i], rows[i + 1]];
    const col = chipped(seed + Math.round(rows[i].d * 4));
    for (let k = 0; k < prof.length; k++)
      strip(
        acc,
        seg,
        prof[k],
        prof[(k + 1) % prof.length],
        convexNormal(prof, k),
        col,
        () => [0, 0],
      );
  }
  for (const [row, dir] of [
    [rows[0], -1],
    [rows[rows.length - 1], 1],
  ] as const)
    cap(acc, row, prof, dir, chipped(seed + row.d));
}

/**
 * A small slab bridge's kerb (kind 'kerb'): a low weathered concrete beam along the deck edge, a dark crack where it
 * meets the asphalt, and (rule.rail) a chipped yellow pipe railing on it - whole, or what is left of one.
 */
function kerb(
  kerbAcc: Acc,
  paintAcc: Acc,
  rows: Row[],
  fine: Row[],
  run: BarrierRun,
  first: boolean,
  last: boolean,
): void {
  // The inner face reaches a little below the deck line: the crowned asphalt is lower at its edge.
  const prof: [number, number][] = [
    [KERB_IN, -0.06],
    [0, 0],
    [0, KERB_H],
    [KERB_IN + 0.02, KERB_H],
    [KERB_IN, KERB_H - 0.02],
  ];
  const uvOf = (r: Row, dy: number): [number, number] => [
    r.d / KERB_TS,
    dy / KERB_TS,
  ];
  // Weathered concrete, a little darker per piece (stains) - one strip per row pair.
  for (let i = 0; i < rows.length - 1; i++) {
    const seg = [rows[i], rows[i + 1]];
    const t = 0.6 + 0.12 * hash1(rows[i].d + run.side * 31);
    const col: [number, number, number] = [t, t * 0.98, t * 0.93];
    for (let k = 1; k < prof.length; k++) {
      const a = prof[k];
      const b = prof[(k + 1) % prof.length];
      strip(kerbAcc, seg, a, b, convexNormal(prof, k), col, uvOf);
    }
    // The outer face runs down over the deck fascia a little (no seam line at road level).
    strip(kerbAcc, seg, [0, -0.15], [0, 0], [1, 0], col, uvOf);
  }
  // The crack along the kerb foot: a dark band on the asphalt.
  strip(
    kerbAcc,
    rows,
    [KERB_IN - 0.05, 0.012],
    [KERB_IN, 0.012],
    [0, 1],
    [0.12, 0.11, 0.1],
    uvOf,
  );
  if (first) cap(kerbAcc, rows[0], prof, -1, [0.62, 0.6, 0.56]);
  if (last) cap(kerbAcc, rows[rows.length - 1], prof, 1, [0.62, 0.6, 0.56]);
  const rail = run.rule.rail;
  if (!rail) return;
  const seed = run.side * 1000 + run.from;
  const base = KERB_H;
  // Posts every 2 m from 0.4 m in, the last one 0.4 m short of the end.
  const span = fine[fine.length - 1].d - fine[0].d;
  const n = Math.max(1, Math.round((span - 0.8) / POST_GAP));
  const posts: Row[] = [];
  for (let k = 0; k <= n; k++) {
    const d = fine[0].d + 0.4 + ((span - 0.8) * k) / n;
    posts.push(
      fine.reduce((b, r) => (Math.abs(r.d - d) < Math.abs(b.d - d) ? r : b)),
    );
  }
  if (rail === 'pipe') {
    posts.forEach((p, k) =>
      roundPost(
        paintAcc,
        p,
        PIPE_O,
        POST_R,
        p.y + base,
        p.y + base + RAIL_HI + 0.02,
        chipped(seed + k * 3.7),
      ),
    );
    const along = fine.filter(
      (r) => r.d >= posts[0].d - 0.05 && r.d <= posts[n].d + 0.05,
    );
    pipe(paintAcc, along, PIPE_O, base + RAIL_HI, seed);
    pipe(paintAcc, along, PIPE_O, base + RAIL_LO, seed + 500);
  } else {
    // Broken: the first two posts stand with one pipe between them, snapped off past the second; the rest are stubs.
    posts.forEach((p, k) => {
      if (k < 2)
        roundPost(
          paintAcc,
          p,
          PIPE_O,
          POST_R,
          p.y + base,
          p.y + base + RAIL_HI + 0.02,
          chipped(seed + k * 3.7),
        );
      else
        roundPost(
          paintAcc,
          p,
          PIPE_O,
          POST_R,
          p.y + base,
          p.y + base + 0.06,
          RUST,
        );
    });
    if (posts.length > 1) {
      const end = posts[1].d + 0.6;
      const along = fine.filter((r) => r.d >= posts[0].d - 0.05 && r.d <= end);
      pipe(paintAcc, along, PIPE_O, base + RAIL_HI, seed);
    }
  }
}

/**
 * Edge kerb (kind 'edge'): a flush strip of pale concrete slabs `width` m wide (o = metres out from the run line, its
 * outer edge; dy = height over the verge), standing 3 cm proud with a chamfered inner arris.
 */
const edgeProfile = (width: number): [number, number][] => [
  [-width, -0.06],
  [-width, 0.015],
  [-width + 0.02, 0.03],
  [0, 0.03],
  [0, -0.06],
];

/** Flat kerb slabs along the asphalt edge (kind 'edge'): weathered pale concrete, a tone per 1 m slab. */
function edgeKerb(
  acc: Acc,
  rows: Row[],
  run: BarrierRun,
  first: boolean,
  last: boolean,
): void {
  // (v across the slab's top as well as up its sides: the concrete never smears into streaks along it)
  const uvOf = (r: Row, dy: number, o: number): [number, number] => [
    r.d / KERB_TS,
    (dy - o) / KERB_TS,
  ];
  const edge = edgeProfile(run.rule.width ?? 0.5);
  for (let i = 0; i < rows.length - 1; i++) {
    const seg = [rows[i], rows[i + 1]];
    // the slab this row pair lies on: its own tone (the change of tone reads as the joint)
    const slab = Math.floor(rows[i].d + 0.01);
    const t = 0.68 + 0.14 * hash1(slab * 1.7 + run.side * 31);
    const col: [number, number, number] = [t, t * 0.98, t * 0.94];
    for (let k = 0; k < edge.length - 1; k++)
      strip(acc, seg, edge[k], edge[k + 1], convexNormal(edge, k), col, uvOf);
  }
  const end: [number, number, number] = [0.7, 0.69, 0.66];
  if (first) cap(acc, rows[0], edge, -1, end);
  if (last) cap(acc, rows[rows.length - 1], edge, 1, end);
}

/** A ditch's lining (kind 'gutter'), o = metres out from its middle, dy = height over the ditch floor: a shallow dish. */
const GUTTER: [number, number][] = [
  [-0.38, 0.1],
  [-0.22, 0.04],
  [0, 0.02],
  [0.22, 0.04],
  [0.38, 0.1],
];

/**
 * A ditch lined with concrete slabs (a tone per 1 m slab) or pitched stones (`cobbles`: a tone per stone, three across,
 * the joints dark), sunk into the ditch at its edges.
 */
function gutter(acc: Acc, rows: Row[], run: BarrierRun): void {
  const uvOf = (r: Row, dy: number, o: number): [number, number] => [
    r.d / KERB_TS,
    (dy - o) / KERB_TS,
  ];
  const cobbles = !!run.rule.cobbles;
  for (let i = 0; i < rows.length - 1; i++) {
    const seg = [rows[i], rows[i + 1]];
    const k = Math.floor(rows[i].d * (cobbles ? 4 : 1) + 0.01);
    for (let j = 0; j < GUTTER.length - 1; j++) {
      const h = hash1(k * 3.1 + j * 17 + run.side * 31);
      const t = cobbles ? 0.32 + 0.3 * h : 0.48 + 0.16 * h;
      const col: [number, number, number] = cobbles
        ? [t, t * 0.95, t * 0.86]
        : [t, t * 0.98, t * 0.94];
      strip(acc, seg, GUTTER[j], GUTTER[j + 1], [0, 1], col, uvOf);
    }
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
  // Weathered: the grime map over the vertex colour, duller than new zinc.
  const railMat = new MeshStandardMaterial({
    map: getTexture('barrier_rail'),
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.3,
    side: DoubleSide,
  });
  // Rusted rails are painted steel gone brown: not metallic (no sky-blue reflection).
  const rustMat = new MeshStandardMaterial({
    map: getTexture('barrier_rail'),
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1,
    side: DoubleSide,
  });
  // Kerbs: the bridge deck's concrete; their railings: painted steel (vertex colour), not shiny.
  const kerbMat = bridgeMaterials().concrete;
  const paintMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.15,
  });
  const ctx: BarrierContext = { road: world.road, net: world.gen.paths };
  const white: [number, number, number] = [1, 1, 1];
  const steel: [number, number, number] = [0.52, 0.53, 0.53];
  // (weathered zinc gone grey-brown: a slim post, not a dark block)
  const postCol: [number, number, number] = [0.4, 0.37, 0.33];
  // (linear vertex colours: a weathered brown rust, the posts darker)
  const rustSteel: [number, number, number] = [0.26, 0.095, 0.04];
  const rustPost: [number, number, number] = [0.17, 0.065, 0.03];
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
      if (run.rule.kind === 'kerb') {
        const fine: Row[] = [];
        for (let d = from; d < to; d += 0.25)
          fine.push(rowsOf(ctx, world.analytic, run, d, d + 0.01)[0]);
        fine.push(rows[rows.length - 1]);
        // Kerb pieces in 1 m rows (stains), the railing on the fine rows.
        const kr: Row[] = fine.filter((_, i) => i % 4 === 0);
        if (kr[kr.length - 1] !== fine[fine.length - 1])
          kr.push(fine[fine.length - 1]);
        kerb(
          tileAcc('kerb', rows[0].x, rows[0].z, kerbMat),
          tileAcc('paint', rows[0].x, rows[0].z, paintMat),
          kr,
          fine,
          run,
          from === run.from,
          to === run.to,
        );
        continue;
      }
      if (run.rule.kind === 'edge' || run.rule.kind === 'gutter') {
        // 1 m stones / slabs (a tone each), on 0.5 m rows (0.25 m for pitched stones) so the line follows the bends
        const step = run.rule.cobbles ? 0.25 : 0.5;
        const fine: Row[] = [];
        for (let d = from; d < to; d += step)
          fine.push(rowsOf(ctx, world.analytic, run, d, d + 0.01)[0]);
        fine.push(rows[rows.length - 1]);
        const acc = tileAcc('kerb', rows[0].x, rows[0].z, kerbMat);
        if (run.rule.kind === 'edge')
          edgeKerb(acc, fine, run, from === run.from, to === run.to);
        else gutter(acc, fine, run);
        continue;
      }
      const rusty = run.rule.kind === 'guardrail' && !!run.rule.rusty;
      const acc = tileAcc(
        rusty ? 'rust' : run.rule.kind,
        rows[0].x,
        rows[0].z,
        run.rule.kind === 'jersey' ? jerseyMat : rusty ? rustMat : railMat,
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
        const uvOf = (r: Row, dy: number): [number, number] => [r.d / 8, dy];
        // A two-tier rail: the same beam again, TIER2 m lower on the same posts.
        for (const lower of run.rule.tiers === 2 ? [0, TIER2] : [0])
          for (let i = 0; i < RAIL.length - 1; i++) {
            const a: [number, number] = [RAIL[i][0], RAIL[i][1] - lower];
            const b: [number, number] = [
              RAIL[i + 1][0],
              RAIL[i + 1][1] - lower,
            ];
            // The road side of the sheet: the segment's own normal, towards the road (-o).
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const n: [number, number] = [
              -(b[1] - a[1]) / len,
              (b[0] - a[0]) / len,
            ];
            strip(acc, rows, a, b, n, run.rule.rusty ? rustSteel : steel, uvOf);
          }
        // Posts every 2 m (aligned to the rail's own metres so they never shift between pieces).
        for (let d = Math.ceil(from / 2) * 2; d < to; d += 2) {
          const r = rowsOf(ctx, world.analytic, run, d, d + 0.01)[0];
          post(
            acc,
            r,
            0.14,
            0.09,
            0.78,
            0.08,
            run.rule.rusty ? rustPost : postCol,
          );
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
