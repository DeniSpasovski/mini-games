import type { StaticCollider } from '../../../physics/types';
import {
  lotShape,
  SLAB,
  SREDNO,
  stairsAnchor,
  VIDIKOVEC,
  type Lot,
} from './car-parks';
import {
  cylinderCollider,
  turnedBoxCollider,
  type Local,
  type V2,
  type V3,
} from './common';
import {
  bench,
  bin,
  binocular,
  bollard,
  containers,
  crowdBarrier,
  gazebo,
  infoBoard,
  lampPost,
  latticeTower,
  logRail,
  parkingSign,
  picnicTable,
  solarLamp,
  strut,
  timberTower,
  utilityPole,
  wallSeg,
  woodBoard,
} from './park';
import { smoothHeights, unitV, wallRibbon } from './stone-wall';
import { LOT_WEST_X, SREDNO_BANDS, toLocal, toWorld, type Site } from './sites';

/**
 * What stands round the two big car parks, from the reference photos: the Sredno Vodno lot has a lawn strip with lamps,
 * the parking and pay-and-display signs, bins, benches, shrubs, a log rail fence, containers and the two timber watch
 * towers of the park entrance behind its kerb, and a gazebo where the OSM building stands in the park; the Vidikovec
 * has a stone-kerbed grass island with shrubs and trees between the road and the bays, a lattice lookout tower, solar
 * lamps, a binocular viewer and rusty bollards. Everything is a `Piece` in the lot's local frame (data, pure: runs in
 * node), drawn by `drawPiece`, with a collider from `pieceCollider` where a car could hit it.
 */
export type PieceKind =
  | 'lamp'
  | 'sign'
  | 'board'
  | 'bin'
  | 'bench'
  | 'table'
  | 'containers'
  | 'tower'
  | 'pavilion'
  | 'woodBoard'
  | 'solar'
  | 'binocular'
  | 'pole'
  | 'lattice'
  | 'bollard';

export interface Piece {
  kind: PieceKind;
  x: number;
  z: number;
  /** three.js yaw of the piece (see park.ts); for bollards the lean direction. */
  yaw: number;
  /** Bollards: lean (rad); containers: count; pavilions: apothem (m). */
  r?: number;
  /** Stands on the asphalt slab (else on the ground). */
  onSlab?: boolean;
  /** Stands this far over the ground (the garden's lawn lies above its levelled terrain). */
  lift?: number;
  color?: string;
}

/** A plant for the landmark's `plants` list (a tree asset in the lot's frame). */
export interface ParkPlant {
  asset: string;
  site: Site;
  x: number;
  z: number;
  scale: number;
}

interface Fr {
  p: V2;
  /** Unit tangent along the edge (index order). */
  t: V2;
  /** Unit normal pointing out of the lot. */
  n: V2;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A lot edge as a walkable polyline: the frame at arc length `s`, `side` = which edge. */
class Edge {
  private cum: number[] = [0];
  constructor(
    private pts: V2[],
    private side: 'left' | 'right',
  ) {
    for (let i = 1; i < pts.length; i++)
      this.cum.push(
        this.cum[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
      );
  }
  get length(): number {
    return this.cum[this.cum.length - 1];
  }
  at(s: number): Fr {
    const c = Math.min(this.length, Math.max(0, s));
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < c) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const k = (c - this.cum[i - 1]) / seg;
    const tx = (b[0] - a[0]) / seg;
    const tz = (b[1] - a[1]) / seg;
    return {
      p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)],
      t: [tx, tz],
      n: this.side === 'right' ? [-tz, tx] : [tz, -tx],
    };
  }
  /** Arc length where the edge passes local x (nearest point). */
  sAtX(x: number): number {
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < this.pts.length; i++)
      if (Math.abs(this.pts[i][0] - x) < d) {
        d = Math.abs(this.pts[i][0] - x);
        best = this.cum[i];
      }
    return best;
  }
}

/** `o` m out of the lot from a frame's point, `a` m along the edge. */
const off = (f: Fr, o: number, a = 0): V2 => [
  f.p[0] + f.n[0] * o + f.t[0] * a,
  f.p[1] + f.n[1] * o + f.t[1] * a,
];
/** three.js yaw for a piece whose +z (its front) should look along (dx, dz). */
const yawFacing = (dx: number, dz: number): number =>
  Math.PI / 2 - Math.atan2(dz, dx);
/** The yaw of a piece standing at `f` and facing into the lot. */
const facingLot = (f: Fr): number => yawFacing(-f.n[0], -f.n[1]);

// ---- Sredno Vodno lot ("the top parking") -----------------------------------------------------------------

/** The park beside the lot (local +z side of the lot's strip) and the gazebo that stands in it (OSM building 3932). */
export const GAZEBO_BUILDING = { x: 545.5, z: -371 };
export const GAZEBO: Site = { x: 545.5, z: -371, yaw: 1.202 };
export const GAZEBO_APOTHEM = 4.7;

const pieces = new Map<Lot, Piece[]>();
const plantsOf = new Map<Lot, ParkPlant[]>();
const strips = new Map<Lot, V2[][]>();
const fences = new Map<Lot, V2[][]>();
const barriers = new Map<Lot, V2[][]>();
/** Paved paths: [left line, right line] (local frame). */
const paths = new Map<Lot, V2[][]>();
/** Stairs: where they start (local frame), their direction (unit), the width (m), the number of steps and the run of each (m). */
const stairs = new Map<
  Lot,
  { p: V2; dir: V2; width: number; count: number; run: number }
>();

function srednoLayout(): void {
  const shape = lotShape(SREDNO);
  const right = new Edge(shape.right, 'right');
  const left = new Edge(shape.left, 'left');
  const out: Piece[] = [];
  const trees: ParkPlant[] = [];
  const at = (x: number, o: number, a = 0) => {
    const f = right.at(right.sAtX(x));
    return { f, p: off(f, o, a) };
  };
  const put = (
    kind: PieceKind,
    x: number,
    o: number,
    extra: Partial<Piece> = {},
    a = 0,
  ): void => {
    const { f, p } = at(x, o, a);
    out.push({ kind, x: p[0], z: p[1], yaw: facingLot(f), ...extra });
  };
  // Lamps (arms over the lot), the parking sign and the information board by the entrance (the flag stands there).
  for (const x of [-52, -28, -4, 20, 44]) put('lamp', x, 1.2);
  put('sign', -21.5, 1);
  put('board', -19, 1);
  put('bin', -11.5, 1);
  put('bin', 24, 1);
  put('bench', -1, 1.7);
  put('bench', 11, 1.7);
  // Bushes by the kerb (real foliage: the tree system's bushes, drive-through).
  for (const [x, r] of [
    [-9, 0.8],
    [-7.5, 0.65],
    [-6, 0.75],
    [8, 0.8],
    [9.6, 0.7],
    [11.2, 0.8],
    [-25, 0.7],
    [27, 0.75],
  ] as const) {
    const { p } = at(x, 2.5);
    trees.push({
      asset: x % 2 ? 'bush' : 'scrub_bush',
      site: SREDNO.site,
      x: p[0],
      z: p[1],
      scale: r,
    });
  }
  // Picnic tables in the park, between the lot and the gazebo.
  put('table', -6, 8, { yaw: 0 });
  put('table', 6, 8.5, { yaw: 0.5 });
  put('table', 16, 9, { yaw: -0.3 });
  // Containers by the park edge before the far end.
  put('containers', 25.5, 1.5, { r: 4 });
  // The park entrance at the lot's far end, all of it touching the asphalt (as in the photos): two timber watch towers
  // astride a paved path on the lot's axis, crowd barriers across it against their fronts, a pavilion each side, the big
  // notice board and a log rail fence to the right; stairs up the bank at the far-left corner.
  const n = shape.centre.length;
  const last = shape.centre[n - 1];
  const prev = shape.centre[n - 4];
  const tl = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
  const tx = (last[0] - prev[0]) / tl;
  const tz = (last[1] - prev[1]) / tl;
  /** A point `a` m past the lot's far end along its axis, `o` m to the right (the park side). */
  const beyond = (a: number, o: number): V2 => [
    last[0] + tx * a - tz * o,
    last[1] + tz * a + tx * o,
  ];
  const front = yawFacing(-tx, -tz);
  const hwEnd = shape.hr[n - 1];
  /** The paved path's centre line, m to the right of the lot's axis: 5.4 m in from the left corner. */
  const pathO = -hwEnd + 5.4;
  const entrance = (
    kind: PieceKind,
    a: number,
    o: number,
    extra: Partial<Piece> = {},
  ): void => {
    const p = beyond(a, o);
    out.push({ kind, x: p[0], z: p[1], yaw: front, ...extra });
  };
  // The towers stand in the far-left corner against the asphalt, the path between them (`pathO` = its centre line); the
  // pavilions sit back from the lot, one behind-left on the bank, one to the right of the path.
  entrance('tower', 1.7, pathO - 4.1, { yaw: front + 0.05 });
  entrance('tower', 1.7, pathO + 3.9, { yaw: front - 0.04 });
  entrance('pavilion', 9, pathO - 7, { r: 2.1 });
  entrance('pavilion', 7, pathO + 12.5, { r: 2.3 });
  entrance('woodBoard', 2.2, hwEnd + 3);
  // The paved path between the towers, going on into the park.
  paths.set(SREDNO, [
    Array.from({ length: 9 }, (_, i) => beyond(0.3 + i * 2, pathO - 1.9)),
    Array.from({ length: 9 }, (_, i) => beyond(0.3 + i * 2, pathO + 1.7)),
  ]);
  stoneStart = beyond(0.3 + 8 * 2, pathO);
  // Stairs along the lots' west edge, linking them: from the top lot's south edge across the strip of land between the two
  // lots to the lower lot's north edge (the lower lot lies higher there).
  const gapStart = SREDNO_BANDS.top[0] - 0.3;
  const gapLength = gapStart - (SREDNO_BANDS.low[1] + 0.3);
  const steps = Math.round(gapLength / 0.41);
  stairs.set(SREDNO, {
    p: [LOT_WEST_X - 3.4, gapStart],
    dir: [0, -1],
    width: 3,
    count: steps,
    run: gapLength / steps,
  });
  // Utility pole on the hillside (the other side of the lot).
  const pf = left.at(left.sAtX(-4));
  const pp = off(pf, 1.6);
  out.push({ kind: 'pole', x: pp[0], z: pp[1], yaw: facingLot(pf) });
  // A pay board with parking signs on the hillside edge too, and one by the bins on the park side.
  for (const [x, kind] of [
    [-18, 'board'],
    [-15.5, 'sign'],
    [-13, 'sign'],
  ] as const) {
    const f = left.at(left.sAtX(x));
    const p = off(f, 1);
    out.push({ kind, x: p[0], z: p[1], yaw: facingLot(f) });
  }
  put('board', 21.5, 1.2);
  // Rail fence along the far part of the park edge, and along the far edge from the right pavilion to the corner.
  const fenceFrom = right.sAtX(30);
  fences.set(SREDNO, [
    Array.from(
      { length: Math.max(2, Math.ceil((right.length - fenceFrom) / 2.6)) },
      (_, i) => off(right.at(fenceFrom + i * 2.6), 2.8),
    ),
    [beyond(1.3, pathO + 9.6), beyond(1.3, hwEnd + 2.4)],
  ]);
  // Crowd barriers against the fronts of the towers, the gate on the walkway open: a gap the width of the path and the gate
  // panel swung back into the park.
  barriers.set(SREDNO, [
    [beyond(0.8, pathO - 6.6), beyond(0.8, pathO - 2.1)],
    [beyond(0.8, pathO + 2.1), beyond(0.8, pathO + 6.2)],
    [beyond(0.8, pathO - 2.1), beyond(3, pathO - 2.1)],
  ]);
  // The lawn strip behind the kerb.
  const lawn: V2[] = [];
  const s0 = right.sAtX(-62);
  const s1 = right.sAtX(LOT_WEST_X);
  for (let s = s0; s <= s1; s += 3) lawn.push(off(right.at(s), 0.3));
  const lawnOuter: V2[] = [];
  for (let s = s0; s <= s1; s += 3) lawnOuter.push(off(right.at(s), 3.8));
  strips.set(SREDNO, [lawn, lawnOuter]);
  // Trees of the park: cedars and pines near the kerb, a few cypresses.
  const tree = (asset: string, x: number, o: number, scale: number): void => {
    const { p } = at(x, o);
    trees.push({ asset, site: SREDNO.site, x: p[0], z: p[1], scale });
  };
  tree('pine_tree', -16, 6, 1.25);
  tree('pine_tree', -1, 11, 1.2);
  tree('pine_tree', 15, 7.5, 1.3);
  tree('black_pine', -30, 8, 1.1);
  tree('black_pine', 28, 9.5, 1);
  tree('black_pine', 4, 16, 1.2);
  tree('cypress_tree', -23.5, 3.2, 1);
  tree('cypress_tree', 9, 4.4, 0.9);
  gapTrees(trees);
  pieces.set(SREDNO, out);
  plantsOf.set(SREDNO, trees);
}

/**
 * Trees in the strip of land between the two Sredno lots: a mixed stand along its middle, left clear at the west edge (the
 * stairs) and round the small building that stands there (OSM, local x 0..11).
 */
function gapTrees(trees: ParkPlant[]): void {
  const zMid = (SREDNO_BANDS.top[0] + SREDNO_BANDS.low[1]) / 2;
  const assets = [
    'pine_tree',
    'oak_tree',
    'black_pine',
    'cypress_tree',
    'locust_tree',
    'plantation_pine',
    'juniper',
  ];
  let k = 0;
  for (let x = -13; x <= LOT_WEST_X - 9; x += 4.6) {
    if (x > -3 && x < 14) continue; // (the building)
    const j = Math.sin(x * 12.9898) * 43758.5453;
    const f = j - Math.floor(j);
    trees.push({
      asset: assets[k++ % assets.length],
      site: SREDNO.site,
      x: x + (f - 0.5) * 2,
      z: zMid + (((f * 7) % 1) - 0.5) * 3.2,
      scale: 0.85 + ((f * 13) % 1) * 0.5,
    });
  }
}

// ---- The stone road to the cable car station --------------------------------------------------------------------

/**
 * The stone road: the paved path of the Sredno park entrance carried on to the lower cable car station (the owner's marked
 * route on a top view, read in the lot frame: first up the slope along the axis, then a long straight towards the west, then
 * a turn to the station's wall). Paver ribbon laid on the terrain; the first waypoint is the end of the entrance path.
 */
const STONE_ROAD_POINTS: V2[] = [
  [98.5, -3.7],
  [147.9, 7.4],
  [158.2, 14.6],
];
export const STONE_ROAD_WIDTH = 3.6;
/** The end of the entrance path (set with the layout): where the stone road starts. */
let stoneStart: V2 = [0, 0];

let stoneLine: V2[] | undefined;
/** The road's centre line in the lot frame: the waypoints with rounded corners, a point about every 2 m. */
export function stoneRoad(): V2[] {
  layout(SREDNO);
  if (stoneLine) return stoneLine;
  // Chaikin corner cutting, twice, then an even resample.
  let pts: V2[] = [stoneStart, ...STONE_ROAD_POINTS];
  for (let it = 0; it < 2; it++) {
    const next: V2[] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const out: V2[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 2 - carry; d <= len; d += 2)
      out.push([
        a[0] + ((b[0] - a[0]) * d) / len,
        a[1] + ((b[1] - a[1]) * d) / len,
      ]);
    carry = (carry + len) % 2;
  }
  out.push(pts[pts.length - 1]);
  stoneLine = out;
  return out;
}

/** True when the world point (x, z) lies within `margin` m of the stone road's centre line. */
export function nearStoneRoad(x: number, z: number, margin: number): boolean {
  const [lx, lz] = toLocal(SREDNO.site, x, z) as V2;
  return stoneRoad().some((p) => Math.hypot(p[0] - lx, p[1] - lz) < margin);
}

/** Scatter-free circles along the stone road (world x, z, radius m). */
export function stoneRoadAreas(): { x: number; z: number; r: number }[] {
  return stoneRoad()
    .filter((_, i) => i % 4 === 0)
    .map(([lx, lz]) => {
      const [x, z] = toWorld(SREDNO.site, lx, lz);
      return { x, z, r: 4.5 };
    });
}

/** The paver ribbon, a little over the terrain (local frame; `gy` = the terrain height there). */
function drawStoneRoad(l: Local, gy: LocalGround): void {
  const line = stoneRoad();
  const half = STONE_ROAD_WIDTH / 2;
  const edge = (i: number, side: 1 | -1): V2 => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [nx, nz] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    return [line[i][0] + nx * half * side, line[i][1] + nz * half * side];
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const quad = [edge(i, 1), edge(i + 1, 1), edge(i + 1, -1), edge(i, -1)];
    l.fan(
      'pavers',
      quad.map((p): V3 => [p[0], ribbonHeight(gy, p[0], p[1]), p[1]]),
      '#b9b2a6',
      [0, 1, 0],
      (p) => [p[0], p[2]],
    );
  }
}

// ---- Vidikovec ----------------------------------------------------------------------------------------------

/** Where the grass island lies along the lot's road side (m from the lot's start) and how wide it is. */
const ISLAND = { from: 20, to: 98, width: 2.7 };

function vidikovecLayout(): void {
  const shape = lotShape(VIDIKOVEC);
  const left = new Edge(shape.left, 'left');
  const right = new Edge(shape.right, 'right');
  const out: Piece[] = [];
  const trees: ParkPlant[] = [];
  // The island: bushes along it, a board in the middle, solar lamps at the quarter points.
  const isl = (s: number, inset: number): { f: Fr; p: V2 } => {
    const f = left.at(s);
    return { f, p: off(f, -inset) };
  };
  const mid = ISLAND.width / 2 + 0.2;
  let k = 0;
  for (let s = ISLAND.from + 5; s < ISLAND.to - 4; s += 3.4) {
    const { p } = isl(s, mid + (k % 2 ? -0.2 : 0.2));
    trees.push({
      asset: k % 3 ? 'bush' : 'scrub_bush',
      site: VIDIKOVEC.site,
      x: p[0],
      z: p[1],
      scale: 0.7 + ((k * 37) % 10) / 40,
    });
    k++;
  }
  const board = isl(ISLAND.from + (ISLAND.to - ISLAND.from) * 0.5, mid);
  out.push({
    kind: 'board',
    x: board.p[0],
    z: board.p[1],
    yaw: facingLot(board.f),
    onSlab: true,
  });
  for (const q of [0.22, 0.78]) {
    const l = isl(ISLAND.from + (ISLAND.to - ISLAND.from) * q, mid);
    out.push({
      kind: 'solar',
      x: l.p[0],
      z: l.p[1],
      yaw: facingLot(l.f),
      onSlab: true,
    });
  }
  for (const [q, asset, scale] of [
    [0.12, 'cypress_tree', 0.8],
    [0.3, 'oak_tree', 0.55],
    [0.66, 'oak_tree', 0.6],
    [0.9, 'cypress_tree', 0.85],
  ] as const) {
    const { p } = isl(ISLAND.from + (ISLAND.to - ISLAND.from) * q, mid);
    trees.push({ asset, site: VIDIKOVEC.site, x: p[0], z: p[1], scale });
  }
  // The parking sign at the mouth, bins at the island's ends.
  const mouth = left.at(5);
  const sp = off(mouth, -1.1);
  out.push({
    kind: 'sign',
    x: sp[0],
    z: sp[1],
    yaw: facingLot(mouth),
    onSlab: true,
  });
  for (const s of [ISLAND.from - 3, ISLAND.to + 3]) {
    const f = left.at(s);
    const p = off(f, -1.2);
    out.push({
      kind: 'bin',
      x: p[0],
      z: p[1],
      yaw: facingLot(f),
      onSlab: true,
    });
  }
  // The outer wall: a binocular viewer, solar lamps, a bench.
  const bf = right.at(right.length * 0.5);
  const bp = off(bf, -1.4);
  out.push({
    kind: 'binocular',
    x: bp[0],
    z: bp[1],
    yaw: facingLot(bf),
    onSlab: true,
  });
  for (const q of [0.22, 0.72]) {
    const f = right.at(right.length * q);
    const p = off(f, -0.9);
    out.push({
      kind: 'solar',
      x: p[0],
      z: p[1],
      yaw: yawFacing(f.n[0], f.n[1]),
      onSlab: true,
    });
  }
  const sf = right.at(right.length * 0.34);
  const sb = off(sf, -1.1);
  out.push({
    kind: 'bench',
    x: sb[0],
    z: sb[1],
    yaw: yawFacing(sf.n[0], sf.n[1]),
    onSlab: true,
  });
  // Rusty bollards across the lot beyond the bays' end.
  const end = shape.centre.length - 1;
  const bl = shape.left[Math.max(0, end - 6)];
  const br = shape.right[Math.max(0, end - 6)];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.push({
      kind: 'bollard',
      x: lerp(bl[0], br[0], t),
      z: lerp(bl[1], br[1], t),
      yaw: (i * 2.3) % (Math.PI * 2),
      r: 0.05 + ((i * 7) % 5) * 0.07,
      onSlab: true,
    });
  }
  // The yellow lattice lookout tower past the lot's far end.
  const last = shape.centre[end];
  const prev = shape.centre[end - 3];
  const dx = last[0] - prev[0];
  const dz = last[1] - prev[1];
  const dl = Math.hypot(dx, dz) || 1;
  out.push({
    kind: 'lattice',
    x: last[0] + (dx / dl) * 6,
    z: last[1] + (dz / dl) * 6,
    yaw: -Math.atan2(dz, dx),
  });
  gardenPieces(out, trees);
  pieces.set(VIDIKOVEC, out);
  plantsOf.set(VIDIKOVEC, trees);
}

// ---- The lowered garden north of the Vidikovec ------------------------------------------------------------------

/**
 * Two lowered lawn terraces north of the Vidikovec lot, behind its outer wall (ai-generated from the owner's photos: stone
 * retaining walls, a gazebo, cypresses, hedges, stairs between the levels). `o` = distance from the lot's slab edge (m):
 * terrace 1 [o0, o1], the dividing wall [o1, o2], terrace 2 [o2, o3]; `drop` = how far each lies under the lot's ground.
 * The terrain is levelled to them by pads (../lots.ts); the walls hold the cuts and fills; the lot's own wall runs deep
 * enough (`Lot.wallDepth`) to meet terrace 1's floor.
 */
export const GARDEN = {
  /** The part of the lot's outer edge (share of its length) the garden lies behind. */
  from: 0.14,
  to: 0.88,
  o: [1.65, 7, 7.8, 13.8] as const,
  drop: [1.5, 3] as const,
  /** The terrain pads lie this far under the lawn (m): none - the terrain itself is painted as the lawn (`lawnPolygons`). */
  sink: 0,
  /** The stairs between the terraces: where along the garden (share of it) and how wide (m). */
  stairs: { at: 0.45, width: 2.4 },
};

const outerEdge = (): Edge => new Edge(lotShape(VIDIKOVEC).right, 'right');

/** The garden's long line `o` m from the lot's slab edge, a point every 2 m (local frame). */
function gardenLine(o: number): V2[] {
  const right = outerEdge();
  const s0 = right.length * GARDEN.from;
  const s1 = right.length * GARDEN.to;
  const out: V2[] = [];
  for (let s = s0; s < s1; s += 2) out.push(off(right.at(s), o));
  out.push(off(right.at(s1), o));
  return out;
}

/** A terrace's lawn outline in the lot's local frame (0 = the upper one). */
export function gardenPolygon(k: 0 | 1): V2[] {
  const [o0, o1, o2, o3] = GARDEN.o;
  return [...gardenLine(k ? o2 : o0), ...gardenLine(k ? o3 : o1).reverse()];
}

/** Terrace 1's pad starts here (m from the slab edge): inside the wall, so the terrain mesh's ramp up to the lot's level lies under it. */
const PAD_FROM = 0.55;

/**
 * The same in world metres, flat, for the terrain pads. Terrace 1's reaches in under the lot's rock wall (`PAD_FROM`; its
 * blend is 0.4 m, so the asphalt from 0 m is never touched: the slab is built from the ground height, a pad under it would
 * drag the asphalt down), where the ramp up to the lot's level hides. Terrace 2's pad is applied first (lots.ts): its wide
 * blend must not pull terrace 1 down.
 */
export const gardenPadPolygon = (k: 0 | 1): number[] =>
  (k
    ? gardenPolygon(1)
    : [...gardenLine(PAD_FROM), ...gardenLine(GARDEN.o[1]).reverse()]
  ).flatMap(([x, z]) => toWorld(VIDIKOVEC.site, x, z));

/**
 * The lawns of the Sredno park strip and of the two garden terraces, flat world polygons: `MapDef.terrain.lawns` paints the
 * levelled terrain itself as lush grass there (no green decal laid over a terrain that pokes through it).
 */
export function lawnPolygons(): number[][] {
  layout(SREDNO);
  const [inner, outer] = strips.get(SREDNO)!;
  const strip = [...inner, ...outer.slice().reverse()].flatMap(([x, z]) =>
    toWorld(SREDNO.site, x, z),
  );
  return [
    strip,
    gardenPadPolygon(0),
    gardenPadPolygon(1),
    rampPad(0).polygon,
    rampPad(1).polygon,
  ];
}

/**
 * The ramp pad at one end of the garden (0 = the south-west end, 1 = the north-east end): its outline in world metres (flat)
 * and its two ends (world x, z), terrace 1's side first.
 */
export function rampPad(end: 0 | 1): { polygon: number[]; from: V2; to: V2 } {
  const right = outerEdge();
  const [, o1, o2] = GARDEN.o;
  const s0 = right.length * GARDEN.from;
  const s1 = right.length * GARDEN.to;
  const sa = end ? s1 - NATURAL_GAP : s0 + 0.2;
  const sb = end ? s1 - 0.2 : s0 + NATURAL_GAP;
  const oa = o1 - RAMP_IN;
  const ob = o2 + RAMP_OUT;
  const w = (p: V2): V2 => toWorld(VIDIKOVEC.site, p[0], p[1]) as V2;
  const mid = right.at((sa + sb) / 2);
  return {
    polygon: [
      ...w(off(right.at(sa), oa)),
      ...w(off(right.at(sb), oa)),
      ...w(off(right.at(sb), ob)),
      ...w(off(right.at(sa), ob)),
    ],
    from: w(off(mid, oa)),
    to: w(off(mid, ob)),
  };
}

/** Scatter-free circles over the garden (world x, z, radius m). */
export function gardenAreas(): { x: number; z: number; r: number }[] {
  const right = outerEdge();
  const [o0, , , o3] = GARDEN.o;
  const out: { x: number; z: number; r: number }[] = [];
  const s0 = right.length * GARDEN.from;
  const s1 = right.length * GARDEN.to;
  for (let s = s0; s <= s1 + 6; s += 9) {
    const p = off(right.at(s), (o0 + o3) / 2);
    const [x, z] = toWorld(VIDIKOVEC.site, p[0], p[1]);
    out.push({ x, z, r: 10.5 });
  }
  return out;
}

/** Hedges, benches, lamps, the gazebo and the trees of the garden. */
function gardenPieces(out: Piece[], trees: ParkPlant[]): void {
  const right = outerEdge();
  const L = right.length;
  const [o0, o1, o2, o3] = GARDEN.o;
  const span = GARDEN.to - GARDEN.from;
  const at = (q: number, o: number): { f: Fr; p: V2 } => {
    const f = right.at(L * (GARDEN.from + span * q));
    return { f, p: off(f, o) };
  };
  const put = (
    kind: PieceKind,
    q: number,
    o: number,
    extra: Partial<Piece> = {},
    facing: 'out' | 'in' = 'out',
  ): void => {
    const { f, p } = at(q, o);
    out.push({
      kind,
      x: p[0],
      z: p[1],
      yaw: facing === 'out' ? yawFacing(f.n[0], f.n[1]) : facingLot(f),
      lift: GARDEN.sink,
      ...extra,
    });
  };
  // A hedge of bushes along the lot's wall (open where the stairs come down), a looser row along the north wall, beds by the
  // stairs between the terraces.
  const stairs = stairsAnchor(VIDIKOVEC);
  /**
   * True where the flight of stairs from the lot comes down (and a margin round it): nothing is planted there, nothing may clip
   * the steps or their handrails (`out` = m out from the lot's edge, `lat` = m along it from the stairs' middle).
   */
  const onStairs = (p: V2): boolean => {
    if (!stairs) return false;
    const dx = p[0] - stairs.p[0];
    const dz = p[1] - stairs.p[1];
    const out = dx * stairs.n[0] + dz * stairs.n[1];
    const lat = dx * stairs.t[0] + dz * stairs.t[1];
    return out > -1 && out < 7 && Math.abs(lat) < stairs.width / 2 + 3.2;
  };
  const bush = (asset: string, q: number, o: number, scale: number): void => {
    const { p } = at(q, o);
    if (onStairs(p)) return;
    trees.push({ asset, site: VIDIKOVEC.site, x: p[0], z: p[1], scale });
  };
  // (the hedge stands clear of the wall: a bush is 1-1.5 m across)
  for (let q = 0.03; q < 0.98; q += 0.045) bush('bush', q, o0 + 1.5, 0.75);
  for (let q = 0.06; q < 0.96; q += 0.07) bush('scrub_bush', q, o3 - 1.3, 0.75);
  for (const q of [0.4, 0.5])
    for (const o of [o2 + 1.2, o2 + 2.2]) bush('bush', q, o, 0.65);
  // The gazebo on terrace 1, benches facing the view, solar lamps.
  put('pavilion', 0.2, (o0 + o1) / 2, { r: 2.4, color: '#3f6a3c' });
  for (const q of [0.62, 0.78]) put('bench', q, o1 - 1.1);
  for (const q of [0.3, 0.66]) put('bench', q, o3 - 2.4);
  for (const q of [0.38, 0.72]) put('solar', q, o0 + 1.9, {}, 'in');
  // Trees: cypresses along both walls, junipers and oaks in the lawns.
  const tree = (asset: string, q: number, o: number, scale: number): void => {
    const { p } = at(q, o);
    if (onStairs(p)) return;
    trees.push({ asset, site: VIDIKOVEC.site, x: p[0], z: p[1], scale });
  };
  for (const q of [0.06, 0.34, 0.58, 0.84])
    tree('cypress_tree', q, o1 - 0.9, 0.95);
  for (const q of [0.16, 0.46, 0.7, 0.92])
    tree('cypress_tree', q, o3 - 0.9, 1.05);
  for (const q of [0.33, 0.56, 0.9]) tree('juniper', q, o0 + 2.2, 0.7);
  for (const q of [0.3, 0.66]) tree('oak_tree', q, o2 + 3.2, 0.6);
}

export interface GardenWall {
  /** The wall's inner face line (local frame), the unit normals to its outer side, its thickness (m). */
  p: V2[];
  n: V2[];
  thick: number;
  /** A low kerb on an embankment (not a solid wall). */
  low: boolean;
}

/**
 * The garden's rock walls (pure, shared by the drawing and the colliders): the low kerb along the north edge of terrace 2, the
 * dividing wall between the terraces - open at both ends (the ramps) and for the stairs between them - and the end walls.
 */
export function gardenWallRuns(): GardenWall[] {
  const right = outerEdge();
  const [o0, o1, o2, o3] = GARDEN.o;
  const s0 = right.length * GARDEN.from;
  const s1 = right.length * GARDEN.to;
  const sStairs =
    right.length * (GARDEN.from + (GARDEN.to - GARDEN.from) * GARDEN.stairs.at);
  const gapHalf = GARDEN.stairs.width / 2 + 0.5;
  /** The garden's line `o` m from the lot edge between arc lengths `sa` and `sb`, a point about every 2 m, with its outward normals. */
  const run = (o: number, sa: number, sb: number): { p: V2[]; n: V2[] } => {
    const p: V2[] = [];
    for (let s = sa; s < sb - 0.3; s += 2) p.push(off(right.at(s), o));
    p.push(off(right.at(sb), o));
    const n = p.map((_, k): V2 => {
      const a = p[Math.max(0, k - 1)];
      const b = p[Math.min(p.length - 1, k + 1)];
      return unitV(-(b[1] - a[1]), b[0] - a[0]);
    });
    return { p, n };
  };
  const out: GardenWall[] = [];
  out.push({ ...run(o3, s0, s1), thick: 0.7, low: true });
  for (const [sa, sb] of [
    [s0 + NATURAL_GAP, sStairs - gapHalf],
    [sStairs + gapHalf, s1 - NATURAL_GAP],
  ] as const)
    out.push({ ...run(o1, sa, sb), thick: o2 - o1, low: false });
  for (const [side, sEnd] of [
    [-1, s0],
    [1, s1],
  ] as const) {
    const f = right.at(sEnd);
    const n: V2 = [f.t[0] * side, f.t[1] * side];
    for (const [oa, ob] of [
      [o0, o2],
      [o2, o3 + 0.7],
    ] as const)
      out.push({
        p: [off(f, oa), off(f, ob)],
        n: [n, n],
        thick: 0.7,
        low: false,
      });
  }
  return out;
}

/**
 * The solid garden walls as colliders (the kerb on the embankment is not one): a box per run segment, from 1.5 m under the lower
 * floor beside it to 0.9 m over the higher one. `ground` = the levelled terrain (world x, z).
 */
export function gardenColliders(
  ground: (x: number, z: number) => number,
): StaticCollider[] {
  const out: StaticCollider[] = [];
  for (const w of gardenWallRuns()) {
    if (w.low) continue;
    for (let k = 0; k + 1 < w.p.length; k++) {
      const [a, b] = [w.p[k], w.p[k + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const nx = (w.n[k][0] + w.n[k + 1][0]) / 2;
      const nz = (w.n[k][1] + w.n[k + 1][1]) / 2;
      const cx = (a[0] + b[0]) / 2 + nx * (w.thick / 2);
      const cz = (a[1] + b[1]) / 2 + nz * (w.thick / 2);
      // From the lower floor beside the wall to 0.9 m over the higher one.
      const side = (o: number): number => {
        const [gx, gz] = toWorld(
          VIDIKOVEC.site,
          (a[0] + b[0]) / 2 + nx * o,
          (a[1] + b[1]) / 2 + nz * o,
        );
        return ground(gx, gz);
      };
      const hiG = Math.max(side(-0.6), side(w.thick + 0.6));
      const loG = Math.min(side(-0.6), side(w.thick + 0.6));
      out.push(
        turnedBoxCollider(
          VIDIKOVEC.site,
          cx,
          cz,
          Math.atan2(b[1] - a[1], b[0] - a[0]),
          len / 2 + 0.05,
          w.thick / 2,
          loG - 1.5,
          hiG + 0.9 - (loG - 1.5),
        ),
      );
    }
  }
  return out;
}

/**
 * The dividing wall is left out this far from each end of the garden (m): the terrain ramps there from terrace 1 down to
 * terrace 2 (a sloped pad, `rampPad`): a grassy path, no steps.
 */
const NATURAL_GAP = 4;
/** The ramp's lateral reach: from `o1 - RAMP_IN` to `o2 + RAMP_OUT` m from the lot's edge. */
const RAMP_IN = 0.3;
const RAMP_OUT = 6.5;

/** Retaining walls, the stairs and their handrails (local frame; `gy` = the levelled terrain; the lawns are the terrain itself). */
export function drawGarden(l: Local, gy: LocalGround): void {
  const [, o1, o2] = GARDEN.o;
  /**
   * A rock wall along `pts` (its inner face on the line, `thick` m out along the normals `ns`): one ribbon, its top 45 cm over
   * the floor beside it - or at the land behind it where that is higher (a cut) - smoothed along the run; it runs under whatever
   * lies lower past it (a fill, the lower terrace). `low`: a kerb (30 cm), it only reaches down to the pad's level, the land
   * falls away under it as an embankment.
   */
  const wall = (pts: V2[], ns: V2[], thick = 0.7, low = false): void => {
    const hi: number[] = [];
    const foot: number[] = [];
    pts.forEach(([x, z], k) => {
      const [nx, nz] = ns[k];
      const inY = gy(x - nx * 0.4, z - nz * 0.4) + GARDEN.sink;
      const outY = Math.min(
        gy(x + nx * (thick + 1), z + nz * (thick + 1)),
        gy(x + nx * (thick + 2), z + nz * (thick + 2)),
      );
      hi.push(
        low
          ? inY + 0.3
          : Math.max(inY + 0.45, outY > inY ? outY + 0.15 : -Infinity),
      );
      foot.push(
        low ? inY - GARDEN.sink - 0.5 : Math.min(inY - GARDEN.sink, outY) - 0.9,
      );
    });
    const lo = foot.map((v, k) =>
      Math.min(
        v,
        foot[Math.max(0, k - 1)],
        foot[Math.min(foot.length - 1, k + 1)],
      ),
    );
    wallRibbon(l, {
      p: pts,
      n: ns,
      hi: smoothHeights(hi),
      lo,
      inner: 0,
      outer: thick,
    });
  };
  const right = outerEdge();
  const sStairs =
    right.length * (GARDEN.from + (GARDEN.to - GARDEN.from) * GARDEN.stairs.at);
  const stairsHalf = GARDEN.stairs.width / 2;
  for (const w of gardenWallRuns()) wall(w.p, w.n, w.thick, w.low);
  // Stairs down from the lot through its rock wall to terrace 1 (the wall opens there: `Lot.stairsAt`): treads of 32 cm run,
  // about 17 cm a step, from the slab's top to the lawn, a log handrail each side.
  const lotStairs = stairsAnchor(VIDIKOVEC);
  if (lotStairs) {
    const { p, t, n } = lotStairs;
    const y0 = gy(p[0], p[1]) + SLAB;
    const yL = gy(p[0] + n[0] * 3.6, p[1] + n[1] * 3.6) + GARDEN.sink + 0.02;
    const count = Math.max(3, Math.round((y0 - yL) / 0.17) - 1);
    const run = 0.32;
    // As wide as the opening in the wall (the wall's end faces are the stairs' sides).
    const width = lotStairs.width;
    const riser = (y0 - yL) / (count + 1);
    /** A point `d` m out from the slab edge, `lat` m along it. */
    const at = (d: number, lat = 0): V2 => [
      p[0] + n[0] * d + t[0] * lat,
      p[1] + n[1] * d + t[1] * lat,
    ];
    const tops: number[] = [];
    for (let k = 0; k < count; k++) {
      const top = y0 - riser * (k + 1);
      tops.push(top);
      const d = -0.1 + run * (k + 0.5);
      wallSeg(
        l,
        at(d, -width / 2),
        at(d, width / 2),
        top - 1.8,
        top,
        run,
        'concrete',
        '#cfcac0',
      );
    }
    for (const side of [-1, 1]) {
      const lat = side * (width / 2 - 0.15);
      const post = (k: number): V3 => {
        const [x, z] = at(-0.1 + run * (k + 0.5), lat);
        return [x, tops[k] + 0.95, z];
      };
      for (let k = 0; k < count; k += 2) {
        const [x, y, z] = post(k);
        strut(l, [x, y - 1, z], [x, y, z], 0.1, 'paint', '#5e3a20');
      }
      for (let k = 0; k + 2 < count; k += 2)
        strut(l, post(k), post(k + 2), 0.08, 'paint', '#6d4a2b');
    }
  }
  // The stairs: four treads through the dividing wall's gap, a step of a fifth of the drop each, a handrail each side.
  const f0 = right.at(sStairs - stairsHalf);
  const f1 = right.at(sStairs + stairsHalf);
  const fm = right.at(sStairs);
  const floor2 = gy(...off(fm, o2 + 3)) + GARDEN.sink;
  const level1 = gy(...off(fm, o1 - 1)) + GARDEN.sink;
  const step = (level1 - floor2) / 5;
  for (let k = 0; k < 4; k++) {
    const oc = o1 + 0.4 * k + 0.2;
    wallSeg(
      l,
      off(f0, oc),
      off(f1, oc),
      floor2 - 0.3,
      level1 - step * (k + 1),
      0.4,
      'concrete',
      '#cfcac0',
    );
  }
  for (const f of [f0, f1]) {
    const hi = off(f, o1 - 0.3);
    const lo = off(f, o1 + 1.8);
    const yh = level1 + 0.95;
    const yl = floor2 + 0.95 + step;
    strut(l, [hi[0], yh, hi[1]], [lo[0], yl, lo[1]], 0.05, 'metal', '#2f7a45');
    for (const [p, y0, y1] of [
      [hi, level1, yh],
      [lo, floor2, yl],
    ] as const)
      strut(l, [p[0], y0, p[1]], [p[0], y1, p[1]], 0.05, 'metal', '#2f7a45');
  }
}

const layout = (lot: Lot): void => {
  if (pieces.has(lot)) return;
  if (lot === SREDNO) srednoLayout();
  else if (lot === VIDIKOVEC) vidikovecLayout();
};

export const parkPieces = (lot: Lot): Piece[] => {
  layout(lot);
  return pieces.get(lot) ?? [];
};
export const parkPlants = (lot: Lot): ParkPlant[] => {
  layout(lot);
  return plantsOf.get(lot) ?? [];
};

// ---- Drawing ------------------------------------------------------------------------------------------------

/** Height of the ground (levelled terrain) at a local point of the lot's site, relative to the site's base. */
export type LocalGround = (x: number, z: number) => number;

/**
 * The height for a ribbon laid on the terrain (a path, a road): 10 cm over the highest ground within 1.5 m of the point,
 * so the terrain mesh (coarser than the analytic height, rising through a thin object on slopes and pad edges) never
 * clips it.
 */
const ribbonHeight = (gy: LocalGround, x: number, z: number): number =>
  Math.max(
    gy(x, z),
    gy(x + 1.5, z),
    gy(x - 1.5, z),
    gy(x, z + 1.5),
    gy(x, z - 1.5),
  ) + 0.1;

/** The ground-level lawn of the Sredno park side and the island of the Vidikovec. */
export function drawParkGround(l: Local, lot: Lot, gy: LocalGround): void {
  layout(lot);
  const up: V3 = [0, 1, 0];
  const quad = (pts: V2[], color: string, dy: number, onSlab: boolean): void =>
    l.fan(
      'lawn',
      pts.map((p): V3 => [
        p[0],
        gy(p[0], p[1]) + dy + (onSlab ? SLAB : 0),
        p[1],
      ]),
      color,
      up,
      (p) => [p[0], p[2]],
    );
  if (lot === SREDNO) {
    for (const rail of fences.get(SREDNO)!) logRail(l, rail, gy, 1.05);
    for (const [a, b] of barriers.get(SREDNO)!) crowdBarrier(l, a, b, gy);
    const [pl, pr] = paths.get(SREDNO)!;
    for (let i = 0; i + 1 < pl.length; i++)
      l.fan(
        'pavers',
        [pl[i], pl[i + 1], pr[i + 1], pr[i]].map((p): V3 => [
          p[0],
          ribbonHeight(gy, p[0], p[1]),
          p[1],
        ]),
        '#b9b2a6',
        up,
        (p) => [p[0], p[2]],
      );
    drawStoneRoad(l, gy);
    drawStairs(l, gy);
    return;
  }
  // Vidikovec island: a lens of lawn inside a stone kerb.
  const shape = lotShape(lot);
  const left = new Edge(shape.left, 'left');
  const outerLine: V2[] = [];
  const innerLine: V2[] = [];
  for (let s = ISLAND.from; s <= ISLAND.to + 0.01; s += 2) {
    const f = left.at(s);
    const ramp = Math.max(
      0.35,
      Math.min(1, (s - ISLAND.from) / 3, (ISLAND.to - s) / 3),
    );
    outerLine.push(off(f, -0.2));
    innerLine.push(off(f, -(0.2 + ISLAND.width * ramp)));
  }
  for (let i = 0; i + 1 < outerLine.length; i++)
    quad(
      [outerLine[i], outerLine[i + 1], innerLine[i + 1], innerLine[i]],
      '#7eab4f',
      0.16,
      true,
    );
  for (const line of [outerLine, innerLine])
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const y = gy((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) + SLAB;
      wallSeg(l, a, b, y - 0.3, y + 0.2, 0.24, 'rubble', '#e2dccf');
    }
  // The rounded ends.
  for (const [a, b] of [
    [outerLine[0], innerLine[0]],
    [outerLine[outerLine.length - 1], innerLine[innerLine.length - 1]],
  ]) {
    const y = gy((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) + SLAB;
    wallSeg(l, a, b, y - 0.3, y + 0.2, 0.24, 'rubble', '#e2dccf');
  }
}

/** Concrete stairs with log handrails, following the terrain (tread tops 12 cm over it, at most 32 cm a step). */
function drawStairs(l: Local, gy: LocalGround): void {
  const s = stairs.get(SREDNO);
  if (!s) return;
  const { count, run } = s;
  const [dx, dz] = s.dir;
  const px = -dz;
  const pz = dx;
  const half = s.width / 2;
  // (flush with the top lot's slab at the start; a step is 0-32 cm, flat where the land is flat)
  let prev = gy(s.p[0], s.p[1]) + 0.2;
  const tops: number[] = [];
  for (let k = 0; k < count; k++) {
    const d = run * (k + 0.5);
    const cx = s.p[0] + dx * d;
    const cz = s.p[1] + dz * d;
    const top = Math.max(prev, Math.min(prev + 0.32, gy(cx, cz) + 0.12));
    prev = top;
    tops.push(top);
    wallSeg(
      l,
      [cx - px * half, cz - pz * half],
      [cx + px * half, cz + pz * half],
      top - 1.4,
      top,
      run,
      'concrete',
      '#c9c5bb',
    );
  }
  // Handrails: a log post every second step with a rail along the posts' tops, both sides.
  for (const side of [-1, 1]) {
    const post = (k: number): V3 => {
      const d = run * (k + 0.5);
      return [
        s.p[0] + dx * d + px * (half + 0.12) * side,
        tops[k] + 0.95,
        s.p[1] + dz * d + pz * (half + 0.12) * side,
      ];
    };
    for (let k = 0; k < count; k += 2) {
      const [x, y, z] = post(k);
      strut(l, [x, y - 1, z], [x, y, z], 0.1, 'paint', '#5e3a20');
    }
    for (let k = 0; k + 2 < count; k += 2)
      strut(l, post(k), post(k + 2), 0.08, 'paint', '#6d4a2b');
  }
}

/** Draws one piece. */
export function drawPiece(l: Local, piece: Piece, gy: LocalGround): void {
  const { x, z, yaw } = piece;
  const y = gy(x, z) + (piece.onSlab ? SLAB : 0) + (piece.lift ?? 0);
  switch (piece.kind) {
    case 'lamp':
      lampPost(l, x, y, z, yaw);
      break;
    case 'sign':
      parkingSign(l, x, y, z, yaw);
      break;
    case 'board':
      infoBoard(l, x, y, z, yaw);
      break;
    case 'bin':
      bin(l, x, y, z, yaw);
      break;
    case 'bench':
      bench(l, x, y, z, yaw);
      break;
    case 'table':
      picnicTable(l, x, y, z, yaw);
      break;
    case 'containers':
      containers(l, x, y, z, yaw, piece.r ?? 4);
      break;
    case 'tower':
      timberTower(l, x, y, z, yaw);
      break;
    case 'pavilion':
      gazebo(l, x, y, z, yaw, {
        apothem: piece.r ?? 1.9,
        roof: piece.color ?? '#8b4a42',
        roofKey: piece.color ? 'sheet' : 'tiles',
        open: [1, 5],
        tables: 1,
      });
      break;
    case 'woodBoard':
      woodBoard(l, x, y, z, yaw);
      break;
    case 'solar':
      solarLamp(l, x, y + (piece.onSlab ? 0.16 : 0), z, yaw);
      break;
    case 'binocular':
      binocular(l, x, y, z, yaw);
      break;
    case 'pole':
      utilityPole(l, x, y, z, yaw);
      break;
    case 'lattice':
      latticeTower(l, x, y, z, yaw);
      break;
    case 'bollard':
      bollard(l, x, y, z, yaw, piece.r ?? 0.1);
      break;
  }
}

/** The collider of a piece a car can hit (none for the small ones). */
export function pieceCollider(
  site: Site,
  p: Piece,
  yBase: number,
): StaticCollider | undefined {
  const lx = p.x;
  const lz = p.z;
  switch (p.kind) {
    case 'lamp':
    case 'solar':
      return cylinderCollider(site, lx, lz, yBase, 0.1, 6);
    case 'sign':
    case 'board':
      return cylinderCollider(site, lx, lz, yBase, 0.45, 2.4);
    case 'bin':
      return cylinderCollider(site, lx, lz, yBase, 0.25, 1);
    case 'binocular':
      return cylinderCollider(site, lx, lz, yBase, 0.4, 1.5);
    case 'pole':
      return cylinderCollider(site, lx, lz, yBase, 0.16, 9);
    case 'woodBoard':
      return turnedBoxCollider(site, lx, lz, -p.yaw, 1.4, 0.2, yBase, 3);
    case 'containers': {
      // The bell at x -0.55 .. 0.55, then n containers 1.12 m apart from x 1.5: the row's middle and half length.
      const end = 1.5 + ((p.r ?? 4) - 1) * 1.12 + 0.55;
      const mid = (end - 0.55) / 2;
      return turnedBoxCollider(
        site,
        lx + Math.cos(p.yaw) * mid,
        lz - Math.sin(p.yaw) * mid,
        -p.yaw,
        (end + 0.55) / 2,
        0.55,
        yBase,
        1.7,
      );
    }
    case 'tower':
      return turnedBoxCollider(site, lx, lz, -p.yaw, 0.95, 0.95, yBase, 6.5);
    case 'pavilion':
      return cylinderCollider(site, lx, lz, yBase, (p.r ?? 1.9) + 0.1, 3);
    case 'lattice':
      return turnedBoxCollider(site, lx, lz, -p.yaw, 1.2, 1.2, yBase, 9);
    default:
      return undefined;
  }
}

/** All colliders of a lot's park pieces; `base(x, z)` = the ground level (world x, z) they start from. */
export function parkColliders(
  lot: Lot,
  base: (x: number, z: number) => number,
): StaticCollider[] {
  return parkPieces(lot)
    .map((p) => {
      const [wx, wz] = toWorld(lot.site, p.x, p.z);
      return pieceCollider(lot.site, p, base(wx, wz) + (p.onSlab ? SLAB : 0));
    })
    .filter((c): c is StaticCollider => !!c);
}

// ---- The gazebo -----------------------------------------------------------------------------------------------

/** The side of the gazebo that faces the lot is left open. */
export function drawGazebo(l: Local): void {
  const [lx, lz] = toLocal(GAZEBO, SREDNO.site.x, SREDNO.site.z) as V2;
  const a = Math.atan2(lz, lx);
  // Side k lies between corners k and k + 1, so it faces (k + 1) * 45 degrees.
  const k = (((Math.round(a / (Math.PI / 4)) - 1) % 8) + 8) % 8;
  gazebo(l, 0, 0, 0, 0, {
    apothem: GAZEBO_APOTHEM,
    roof: '#3f6a3c',
    roofKey: 'sheet',
    open: [k, (k + 4) % 8],
    tables: 3,
  });
}

export function gazeboCollider(yBase: number): StaticCollider {
  return cylinderCollider(GAZEBO, 0, 0, yBase, GAZEBO_APOTHEM * 1.05, 3);
}

// ---- Painted marks ----------------------------------------------------------------------------------------------

const PAINT = '#f1f1ec';
const YELLOW = '#e0b52a';

/** Painted marks on the asphalt: the white X marks and flow arrows, the yellow bays by the Sredno entrance. */
export function drawMarkings(l: Local, lot: Lot, gy: LocalGround): void {
  const up: V3 = [0, 1, 0];
  const mark = (pts: V2[], color: string): void =>
    l.fan(
      'marking',
      pts.map((p): V3 => [p[0], gy(p[0], p[1]) + SLAB + 0.025, p[1]]),
      color,
      up,
      (p) => [p[0], p[2]],
    );
  /** A bar of `len` x `w` m centred at (cx, cz), its length along `ang`. */
  const bar = (
    cx: number,
    cz: number,
    len: number,
    w: number,
    ang: number,
    color = PAINT,
  ): void => {
    const ux = Math.cos(ang) * (len / 2);
    const uz = Math.sin(ang) * (len / 2);
    const vx = -Math.sin(ang) * (w / 2);
    const vz = Math.cos(ang) * (w / 2);
    mark(
      [
        [cx - ux - vx, cz - uz - vz],
        [cx + ux - vx, cz + uz - vz],
        [cx + ux + vx, cz + uz + vz],
        [cx - ux + vx, cz - uz + vz],
      ],
      color,
    );
  };
  const shape = lotShape(lot);
  const n = shape.centre.length;
  /** Centre line point and direction at a fraction of its length. */
  const centreAt = (q: number, lateral = 0): { p: V2; ang: number } => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(q * (n - 1))));
    const a = shape.centre[i];
    const b = shape.centre[i + 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return {
      p: [a[0] - Math.sin(ang) * lateral, a[1] + Math.cos(ang) * lateral],
      ang,
    };
  };
  const cross = (cx: number, cz: number, ang: number): void => {
    bar(cx, cz, 2, 0.14, ang + 0.62);
    bar(cx, cz, 2, 0.14, ang - 0.62);
  };
  const arrow = (cx: number, cz: number, ang: number): void => {
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    bar(cx - dx * 0.4, cz - dz * 0.4, 2.2, 0.2, ang);
    mark(
      [
        [cx + dx * 0.7 - dz * 0.5, cz + dz * 0.7 + dx * 0.5],
        [cx + dx * 1.7, cz + dz * 1.7],
        [cx + dx * 0.7 + dz * 0.5, cz + dz * 0.7 - dx * 0.5],
      ],
      PAINT,
    );
  };
  if (lot === SREDNO) {
    // In the drive aisles beside the middle lanes (their centre lines lie 8.5 m off the lot's axis).
    for (const [q, lat] of [
      [0.28, 8.5],
      [0.66, -8.5],
    ] as const) {
      const c = centreAt(q, lat);
      cross(c.p[0], c.p[1], c.ang);
    }
    for (const [q, lat] of [
      [0.12, 0],
      [0.4, -8.5],
      [0.75, 8.5],
    ] as const) {
      const c = centreAt(q, lat);
      arrow(c.p[0], c.p[1], c.ang);
    }
    // Three yellow bays (hatched like a disabled bay) in the far-left corner, in front of the stairs.
    const last = shape.centre[n - 1];
    const prev = shape.centre[n - 4];
    const tl = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
    const tx = (last[0] - prev[0]) / tl;
    const tz = (last[1] - prev[1]) / tl;
    const ang = Math.atan2(tz, tx);
    /** A point `a` m along the lot's axis from its far end (negative = into the lot), `o` m to the right. */
    const at = (a: number, o: number): V2 => [
      last[0] + tx * a - tz * o,
      last[1] + tz * a + tx * o,
    ];
    const o0 = -shape.hl[n - 1] + 0.5;
    for (let i = 0; i < 4; i++) {
      const c = at(-2.9, o0 + i * 2.8);
      bar(c[0], c[1], 5, 0.1, ang, YELLOW);
    }
    for (let i = 0; i < 3; i++) {
      const back = at(-5.4, o0 + i * 2.8 + 1.4);
      bar(back[0], back[1], 2.7, 0.1, ang + Math.PI / 2, YELLOW);
      for (let d = 1.2; d < 5.2; d += 0.8) {
        const c = at(-d, o0 + i * 2.8 + 1.4);
        bar(c[0], c[1], 2.5, 0.14, ang + Math.PI / 2, YELLOW);
      }
    }
    return;
  }
  for (const q of [0.42, 0.62]) {
    const c = centreAt(q);
    cross(c.p[0], c.p[1], c.ang);
  }
}
