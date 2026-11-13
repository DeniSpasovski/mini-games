import type { StaticCollider } from '../../../physics/types';
import {
  lotShape,
  SLAB,
  SREDNO,
  vergePolygon,
  VIDIKOVEC,
  wallMeshCut,
  VIDIKOVEC_ISLAND,
  VIDIKOVEC_RIM,
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

/** The grass island along the lot's road side (car-parks.ts `VIDIKOVEC_ISLAND`): its planted stretch. */
const ISLAND = VIDIKOVEC_ISLAND;
/** The notice board on the island's round head, `inset` m in from the road side. */
// (in the middle of the round head)
const BOARD_BED = {
  s: ISLAND.head + (ISLAND.nose - ISLAND.head) * 0.5,
  inset: 2,
};
/**
 * The Vidikovec as the plain band along its centre line (no lens-shaped outer edge, no island cut out of it): the island and
 * its pieces are measured along its road side.
 */
const VIDIKOVEC_BAND: Lot = {
  ...VIDIKOVEC,
  outer: undefined,
  rim: undefined,
  insetLeft: undefined,
  rimLeft: undefined,
};

function vidikovecLayout(): void {
  const shape = lotShape(VIDIKOVEC);
  const left = new Edge(lotShape(VIDIKOVEC_BAND).left, 'left');
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
  // The wooden notice board on the island's round head, two low shrubs behind it.
  const board = isl(BOARD_BED.s, BOARD_BED.inset);
  out.push({
    kind: 'woodBoard',
    x: board.p[0],
    z: board.p[1],
    // (across the island, facing along it)
    yaw: facingLot(board.f) + Math.PI / 2,
    onSlab: false,
  });
  for (const [ds, di] of [
    [-0.9, 0.9],
    [0.8, 0.8],
  ]) {
    const { p } = isl(BOARD_BED.s + ds, BOARD_BED.inset + di);
    trees.push({
      asset: 'bush',
      site: VIDIKOVEC.site,
      x: p[0],
      z: p[1],
      scale: 0.45,
    });
  }
  for (const q of [0.22, 0.78]) {
    const l = isl(ISLAND.from + (ISLAND.to - ISLAND.from) * q, mid);
    out.push({
      kind: 'solar',
      x: l.p[0],
      z: l.p[1],
      yaw: facingLot(l.f),
      onSlab: false,
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
  // The parking sign at the mouth, outside the west kerb (behind its railing), bins at the island's ends.
  const mouth = right.at(right.sAtX(24));
  const sp = off(mouth, 0.9);
  out.push({
    kind: 'sign',
    x: sp[0],
    z: sp[1],
    yaw: facingLot(mouth),
    onSlab: false,
    lift: 0,
  });
  // (on the grass, a little in from the island's ends, standing on its lawn)
  for (const s of [ISLAND.from + 2.5, ISLAND.to - 2.5]) {
    const { f, p } = isl(s, 0.2 + ISLAND.width * 0.4);
    out.push({
      kind: 'bin',
      x: p[0],
      z: p[1],
      yaw: facingLot(f),
      onSlab: false,
      lift: 0,
    });
  }
  // The binocular viewer on the red terrace's grass, in front of its flight's foot, looking out; solar lamps along the outer
  // edge (the west one outside the kerb, behind its railing).
  const foot = redRiser(RED_FLIGHT.count + 1);
  const bp = push(
    [(foot.w[0] + foot.s[0]) / 2, (foot.w[1] + foot.s[1]) / 2],
    RED_FLIGHT.g,
    2.5,
  );
  out.push({
    kind: 'binocular',
    x: bp[0],
    z: bp[1],
    yaw: yawFacing(RED_FLIGHT.g[0], RED_FLIGHT.g[1]),
    onSlab: false,
    lift: 0,
  });
  for (const [q, o] of [
    [0.16, 0.9],
    [0.96, -0.9],
  ] as const) {
    const f = right.at(right.length * q);
    const p = off(f, o);
    out.push({
      kind: 'solar',
      x: p[0],
      z: p[1],
      yaw: yawFacing(f.n[0], f.n[1]),
      onSlab: o < 0,
      ...(o < 0 ? {} : { lift: 0 }),
    });
  }
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
  // (the lattice tower stands on the garden's grey strip)
  gardenPieces(out, trees);
  pieces.set(VIDIKOVEC, out);
  plantsOf.set(VIDIKOVEC, trees);
}

// ---- The garden behind the Vidikovec ----------------------------------------------------------------------------

/**
 * The garden behind the Vidikovec lot's outer edge, three flat levels from the owner's diagrams: the grey strip along the lot's
 * east half (no access: rough grass a step over the lot behind a low parapet, the lattice tower on it), the red terrace a metre
 * under the lot and the green one two metres under it, which wraps round the red in an arc. Stairs go down to the green one
 * from the lot's west end (T-R1, beside the wall between the terraces), to the red one from a landing at its corner by the grey
 * strip (Q1-G, along the grey strip's wall), and wide stone steps from the lot's east end (M-D) down to the green one's east
 * end (`VIDIKOVEC_RIM`). `level` = m over the lot's asphalt. The terrain is levelled to them by pads (../lots.ts) and painted
 * as lawn; retaining walls 45 cm thick hold the steps between them.
 */
export const GARDEN = {
  level: { grey: 0.15, red: -1, green: -2 },
};

/** The garden's corners past the lot's edge (local frame): the grey strip's far side (`Gb`, `Gc`), the red terrace's far corners. */
const GP = {
  Gb: [-19.76, -19.29] as V2,
  Gc: [-61.35, -3.01] as V2,
  RE: [-64.4, -4.16] as V2,
  RS: [-60.87, -16.58] as V2,
  RT: [-26.0, -30.58] as V2,
};

/** The green terrace's outer arc, from its east end by the road round to the far side of the red terrace. */
const GREEN_ARC: V2[] = [
  [-69.2, 11.03],
  [-71.19, 10.39],
  [-73.44, 9.73],
  [-73.61, 6.9],
  [-73.31, 5.42],
  [-72.65, 2.58],
  [-71.98, -0.11],
  [-71.31, -2.69],
  [-70.57, -5.18],
  [-69.77, -7.57],
  [-68.99, -9.9],
  [-68.17, -12.16],
  [-67.2, -14.34],
  [-66.27, -16.5],
  [-65.21, -18.58],
  [-64.11, -20.62],
  [-62.8, -22.54],
  [-61.52, -24.46],
  [-60.12, -26.29],
  [-58.61, -28.03],
  [-56.99, -29.67],
  [-55.2, -31.13],
  [-53.33, -32.47],
  [-51.39, -33.68],
  [-49.29, -34.61],
  [-47.14, -35.38],
  [-44.97, -36.01],
  [-42.73, -36.32],
  [-40.49, -36.48],
  [-38.3, -36.58],
  [-36.12, -36.44],
  [-33.98, -36.16],
  [-31.89, -35.83],
  // (on to the green's tip at the lot, bowing out a little)
  ...[0.2, 0.4, 0.6, 0.8].map((t): V2 => {
    const a: V2 = [-31.89, -35.83];
    const b = VIDIKOVEC_RIM.T;
    const bow = 4 * t * (1 - t) * 2.6;
    const [tx, tz] = unitV(b[0] - a[0], b[1] - a[1]);
    return [
      a[0] + (b[0] - a[0]) * t + tz * bow,
      a[1] + (b[1] - a[1]) * t - tx * bow,
    ];
  }),
];
/** The arc's first points lie east of the straight edge F of the stone steps: the green terrace's edge starts at this one. */
const ARC_FROM = 7;

/** Unit normal of the line a-b, pointing away from the side `inside` lies on. */
const edgeNormal = (a: V2, b: V2, inside: V2): V2 => {
  const [tx, tz] = unitV(b[0] - a[0], b[1] - a[1]);
  const n: V2 = [tz, -tx];
  const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (inside[0] - m[0]) * n[0] + (inside[1] - m[1]) * n[1] > 0
    ? [-n[0], -n[1]]
    : n;
};
/** A point well inside the lot (local). */
const LOT_INSIDE: V2 = [-10, -6];
/** The outward normal of the lot's outer edge from a to b (its points run west to east: the lot lies on the left). */
const rimNormal = (a: V2, b: V2): V2 => {
  const [tx, tz] = unitV(b[0] - a[0], b[1] - a[1]);
  return [-tz, tx];
};
const N_TR = rimNormal(VIDIKOVEC_RIM.T, VIDIKOVEC_RIM.R1);
const N_GE = rimNormal(VIDIKOVEC_RIM.G, VIDIKOVEC_RIM.Eend);
const push = (p: V2, n: V2, d: number): V2 => [
  p[0] + n[0] * d,
  p[1] + n[1] * d,
];
const mid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The three levels' outlines (local frame). */
const greyPoly = (): V2[] => {
  const { G, Eend } = VIDIKOVEC_RIM;
  return [G, Eend, GP.Gc, GP.Gb];
};
const redPoly = (): V2[] => {
  const { Q1, G } = VIDIKOVEC_RIM;
  return [Q1, G, GP.Gb, GP.Gc, GP.RE, GP.RS, GP.RT];
};
const greenPoly = (): V2[] => {
  // (under the lot's one thin wall from T round to Q1, under the wall between the terraces from Q1 on)
  const { T, R1, P1, Q1, F } = VIDIKOVEC_RIM;
  return [T, R1, P1, Q1, GP.RT, GP.RS, GP.RE, F, ...GREEN_ARC.slice(ARC_FROM)];
};

/** A level's outline in the lot's local frame (0 = red, 1 = green, 2 = grey). */
export function gardenPolygon(k: 0 | 1 | 2): V2[] {
  return k === 0 ? redPoly() : k === 1 ? greenPoly() : greyPoly();
}

/** Pads start this far out from the lot's slab edge (m): under its wall, so the terrain's step down never drags the slab's own ground. */
const PAD_FROM = 0.6;
/**
 * Thickness of the retaining walls between the levels (m). An upper level's pad reaches out over the wall: the terrain mesh's
 * slope down to the lower one (up to about a metre wide on its 1 m grid) lies at the wall's foot, a bank of soil against it.
 */
const STEP_WALL = 0.45;

/**
 * The polygon with each edge moved out by `d[i]` m (edge i runs from point i to i + 1; negative = in), its corners mitred.
 */
function offsetEdges(poly: V2[], d: number[]): V2[] {
  const m = poly.length;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % m];
    area += ax * bz - bx * az;
  }
  // (outward: right of the edge's direction for a counter-clockwise outline in x-z, left for a clockwise one)
  const s = area > 0 ? 1 : -1;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % m];
    const [tx, tz] = unitV(b[0] - a[0], b[1] - a[1]);
    const n: V2 = [tz * s, -tx * s];
    return { p: push(a, n, d[i]), t: [tx, tz] as V2, n };
  });
  return poly.map((v, i) => {
    const A = lines[(i + m - 1) % m];
    const B = lines[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 0.05)
      return push(push(v, A.n, d[(i + m - 1) % m]), B.n, 0);
    const wx = B.p[0] - A.p[0];
    const wz = B.p[1] - A.p[1];
    const u = (wx * B.t[1] - wz * B.t[0]) / den;
    return [A.p[0] + A.t[0] * u, A.p[1] + A.t[1] * u];
  });
}

const worldFlat = (pts: V2[]): number[] =>
  pts.flatMap(([x, z]) => toWorld(VIDIKOVEC.site, x, z));

/**
 * A level's terrain pad in world metres, flat (0 = red, 1 = green, 2 = grey): its outline with the lot's edge moved out by
 * `PAD_FROM` and, for an upper level, its edges over a lower one moved out over the wall there.
 */
export function gardenPadPolygon(k: 0 | 1 | 2): number[] {
  const W = STEP_WALL + 0.05;
  // red: [Q1 G Gb Gc RE RS RT], its lot edge in, its far side (Gc .. Q1) over the green one
  if (k === 0)
    return worldFlat(offsetEdges(redPoly(), [-PAD_FROM, 0, 0, W, W, W, W]));
  // green: [T R1 P1 Q1 RT ... ], only its edges at the lot move (the levels over it are applied after it)
  if (k === 1) {
    const g = greenPoly();
    return worldFlat(
      offsetEdges(
        g,
        g.map((_, i) => (i < 3 ? -PAD_FROM : 0)),
      ),
    );
  }
  // grey: [G Eend Gc Gb], all but its edge at the lot over the levels beside it
  return worldFlat(offsetEdges(greyPoly(), [-PAD_FROM, W, W, W]));
}

/**
 * The stone steps from the lot's east end (M-D) down to the green terrace: their strip's outline and the slope's two ends
 * (local), between the lot's east end, the grey and red levels' ends and the straight line D-F.
 */
const TAIL = (() => {
  const { Eend, M, D, F } = VIDIKOVEC_RIM;
  return {
    poly: [M, D, F, GP.RE, GP.Gc, Eend] as V2[],
    from: mid(F, GP.RE),
    to: mid(M, D),
    steps: 12,
  };
})();

/** The sloped pad of the stone steps (world, flat) and its ends (world x, z), the low end first. */
export function rampPad(): { polygon: number[]; from: V2; to: V2 } {
  return {
    polygon: worldFlat(TAIL.poly),
    from: toWorld(VIDIKOVEC.site, ...TAIL.from) as V2,
    to: toWorld(VIDIKOVEC.site, ...TAIL.to) as V2,
  };
}

/** The verge between the road and the Vidikovec's road-side wall (world, flat): from just before the island's round head. */
export function vidikovecVerge(): number[] {
  return vergePolygon(VIDIKOVEC, VIDIKOVEC_ISLAND.head - 0.5);
}

/**
 * The lawns of the Sredno park strip, the Vidikovec's verge and the garden's levels, flat world polygons:
 * `MapDef.terrain.lawns` paints the levelled terrain itself as lush grass there (no green decal laid over a terrain that pokes
 * through it).
 */
export function lawnPolygons(): number[][] {
  layout(SREDNO);
  const [inner, outer] = strips.get(SREDNO)!;
  const strip = [...inner, ...outer.slice().reverse()].flatMap(([x, z]) =>
    toWorld(SREDNO.site, x, z),
  );
  return [
    strip,
    vidikovecVerge(),
    gardenPadPolygon(0),
    gardenPadPolygon(1),
    gardenPadPolygon(2),
    // (the lot's east end: grass, the stone steps' flight down the middle of it)
    worldFlat(TAIL.poly),
  ];
}

const inPoly = (poly: V2[], x: number, z: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside;
};
const inGarden = (x: number, z: number): boolean =>
  inPoly(redPoly(), x, z) ||
  inPoly(greenPoly(), x, z) ||
  inPoly(greyPoly(), x, z) ||
  inPoly(TAIL.poly, x, z);

/** Scatter-free circles over the garden (world x, z, radius m). */
export function gardenAreas(): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (let x = -76; x <= 6; x += 6)
    for (let z = -40; z <= 14; z += 6) {
      if (!inGarden(x, z)) continue;
      const [wx, wz] = toWorld(VIDIKOVEC.site, x, z);
      out.push({ x: wx, z: wz, r: 5.5 });
    }
  return out;
}

/**
 * The green terrace's flight from the lot (T-R1): its head from `a` across to `b`, down along `n` in `count` treads of `run`
 * m, each tread from the wall between the terraces to the green's kerb (`greenTreads`).
 */
const GREEN_FLIGHT = (() => {
  const { T, R1 } = VIDIKOVEC_RIM;
  // (the wall between the terraces stands on its R1 side)
  const k = (STEP_WALL + 0.15) / Math.hypot(T[0] - R1[0], T[1] - R1[1]);
  const b: V2 = [R1[0] + (T[0] - R1[0]) * k, R1[1] + (T[1] - R1[1]) * k];
  const drop = GARDEN.level.green;
  return { a: T, b, n: N_TR, drop, count: 11, run: 0.55 };
})();
/**
 * The red terrace's flight (the owner's sketch): down from the landing's edge Q1-G along the grey strip's wall (`g`), each
 * riser parallel to Q1-G, between the wall and the wall between the terraces, Q1-RT (`side`).
 */
const RED_FLIGHT = (() => {
  const { Q1, G } = VIDIKOVEC_RIM;
  return {
    g: unitV(GP.Gb[0] - G[0], GP.Gb[1] - G[1]),
    across: unitV(Q1[0] - G[0], Q1[1] - G[1]),
    side: unitV(GP.RT[0] - Q1[0], GP.RT[1] - Q1[1]),
    count: 5,
    run: 0.85,
  };
})();
/**
 * The green flight's treads, wall to wall: tread k at `d` m down the flight, from `lo` (the kerb side, negative) to `hi` (the
 * terrace wall's face) across it, measured from the middle of its head along a-b.
 */
const greenTreads = (): { d: number; lo: number; hi: number }[] => {
  const { a, b, n, count, run } = GREEN_FLIGHT;
  const t = unitV(b[0] - a[0], b[1] - a[1]);
  const m = mid(a, b);
  // the green terrace less the lot's wall (R1-P1-Q1, out from the slab's edge), the wall between the terraces (it stands on
  // the green side of Q1-RT) and a hair off the kerb
  const g = greenPoly();
  const lotWall = (VIDIKOVEC.wallThick ?? 0.6) + 0.07;
  const clear = offsetEdges(
    g,
    g.map((_, i) =>
      i === 0 ? 0 : i < 3 ? -lotWall : i === 3 ? -(STEP_WALL + 0.02) : -0.02,
    ),
  );
  const reach = (c: V2, s: number): number => {
    let r = 0;
    while (
      r < 12 &&
      inPoly(clear, c[0] + t[0] * s * (r + 0.05), c[1] + t[1] * s * (r + 0.05))
    )
      r += 0.05;
    return r;
  };
  return Array.from({ length: count }, (_, k) => {
    const d = run * (k + 0.5);
    const c = push(m, n, d);
    return { d, lo: -reach(c, -1), hi: reach(c, 1) };
  });
};
/** Where riser k of the red flight (k = 0: the landing's edge Q1-G) meets the grey wall's face and the side line. */
const redRiser = (k: number): { w: V2; s: V2 } => {
  const { G, Q1 } = VIDIKOVEC_RIM;
  const { g, across, side, run } = RED_FLIGHT;
  // (off the wall's face, along the riser)
  const w = push(push(G, g, run * k), across, STEP_WALL + 0.1);
  // the riser line w + across * t meets the side line Q1 + side * u
  const den = across[0] * side[1] - across[1] * side[0];
  const t = ((Q1[0] - w[0]) * side[1] - (Q1[1] - w[1]) * side[0]) / den;
  return { w, s: push(w, across, t) };
};
/**
 * The ground under a flight (world, flat): from 15 cm past the lot's slab edge at its head (the slab's own ground stays) to
 * its foot; `../lots.ts` levels it to the terrace below, so no ground pokes up through the treads.
 */
export function gardenFlightPolygon(k: 'green' | 'red'): number[] {
  if (k === 'green') {
    const { a, b, n } = GREEN_FLIGHT;
    const t = unitV(b[0] - a[0], b[1] - a[1]);
    const m = mid(a, b);
    const tr = greenTreads();
    const at = (d: number, lat: number): V2 => push(push(m, n, d), t, lat);
    const half = GREEN_FLIGHT.run / 2;
    return worldFlat([
      at(0.15, tr[0].lo),
      at(0.15, tr[0].hi),
      ...tr.map(({ d, hi }) => at(d + half, hi)),
      ...tr
        .slice()
        .reverse()
        .map(({ d, lo }) => at(d + half, lo)),
    ]);
  }
  const { g, count } = RED_FLIGHT;
  const r0 = redRiser(0);
  const rN = redRiser(count + 0.3);
  return worldFlat([push(r0.w, g, 0.15), push(r0.s, g, 0.15), rN.s, rN.w]);
}
/** The flights' outlines (local), a margin round them: nothing is planted there. */
const flightAreas = (): V2[][] => {
  const { a, b, n } = GREEN_FLIGHT;
  const t = unitV(b[0] - a[0], b[1] - a[1]);
  const m = mid(a, b);
  const tr = greenTreads();
  const last = tr[tr.length - 1];
  const at = (d: number, lat: number): V2 => push(push(m, n, d), t, lat);
  const r0 = redRiser(0);
  const r1 = redRiser(RED_FLIGHT.count + 1);
  return [
    [a, b, at(last.d + 0.5, last.hi), at(last.d + 0.5, last.lo)],
    [VIDIKOVEC_RIM.G, r0.s, r1.s, r1.w],
  ].map((p) =>
    offsetEdges(
      p,
      p.map(() => 1.5),
    ),
  );
};
const onFlight = (p: V2): boolean =>
  flightAreas().some((poly) => inPoly(poly, p[0], p[1]));

/** The tower, benches, lamps, the gazebo and the trees of the garden. */
function gardenPieces(out: Piece[], trees: ParkPlant[]): void {
  const { G, Q1 } = VIDIKOVEC_RIM;
  const [gx, gz] = unitV(GP.Gc[0] - GP.Gb[0], GP.Gc[1] - GP.Gb[1]);
  // The yellow lattice tower on the grey strip, at its west end, square to the strip.
  const tw = push(push(G, [gx, gz], 7.5), N_GE, 2.6);
  out.push({ kind: 'lattice', x: tw[0], z: tw[1], yaw: -Math.atan2(gz, gx) });
  const plant = (asset: string, p: V2, scale: number): void => {
    if (onFlight(p)) return;
    trees.push({ asset, site: VIDIKOVEC.site, x: p[0], z: p[1], scale });
  };
  /** A point `t` of the way along a -> b, `o` m off it along n. */
  const along = (a: V2, b: V2, t: number, n: V2, o: number): V2 =>
    push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n, o);
  // Grey strip: rough scrub along its middle, clear of the tower.
  for (const t of [0.3, 0.45, 0.6, 0.75, 0.9])
    plant(
      t % 0.3 ? 'scrub_bush' : 'bush',
      along(GP.Gb, GP.Gc, t, N_GE, -2.4),
      0.7,
    );
  // Red terrace: the gazebo in its middle, benches and lamps along its far wall looking out, cypresses along it.
  const nRed = edgeNormal(GP.RT, GP.RS, LOT_INSIDE);
  out.push({
    kind: 'pavilion',
    x: -38,
    z: -19.5,
    yaw: -Math.atan2(gz, gx),
    r: 2.4,
    color: '#3f6a3c',
  });
  for (const t of [0.25, 0.7]) {
    const p = along(GP.RT, GP.RS, t, nRed, -1.3);
    out.push({
      kind: 'bench',
      x: p[0],
      z: p[1],
      yaw: yawFacing(nRed[0], nRed[1]),
    });
  }
  for (const t of [0.12, 0.5, 0.88]) {
    const p = along(GP.RT, GP.RS, t, nRed, -0.9);
    out.push({
      kind: 'solar',
      x: p[0],
      z: p[1],
      yaw: yawFacing(-nRed[0], -nRed[1]),
    });
  }
  for (const t of [0.05, 0.4, 0.6, 0.97])
    plant('cypress_tree', along(GP.RT, GP.RS, t, nRed, -0.9), 0.95);
  const nRT = edgeNormal(Q1, GP.RT, LOT_INSIDE);
  for (const t of [0.45, 0.7, 0.9])
    plant('juniper', along(Q1, GP.RT, t, nRT, -1.6), 0.7);
  for (const t of [0.2, 0.55])
    plant('bush', along(GP.Gb, GP.Gc, t, N_GE, 1.6), 0.7);
  plant('oak_tree', [-50, -11], 0.6);
  plant('oak_tree', [-28, -24], 0.55);
  // Green terrace: cypresses and oaks along its outer arc, benches looking out, a hedge of scrub at its foot.
  for (let i = ARC_FROM + 2; i < GREEN_ARC.length - 2; i += 3) {
    const a = GREEN_ARC[i - 1];
    const b = GREEN_ARC[i + 1];
    const n = edgeNormal(a, b, [-40, -18]);
    const p = push(GREEN_ARC[i], n, -1.6);
    plant(i % 2 ? 'cypress_tree' : 'scrub_bush', p, i % 2 ? 1.05 : 0.8);
  }
  for (const i of [14, 24, 32]) {
    const n = edgeNormal(GREEN_ARC[i - 1], GREEN_ARC[i + 1], [-40, -18]);
    const p = push(GREEN_ARC[i], n, -3.2);
    if (onFlight(p)) continue;
    out.push({
      kind: 'bench',
      x: p[0],
      z: p[1],
      yaw: yawFacing(n[0], n[1]),
    });
  }
  for (const i of [10, 20, 28]) {
    const n = edgeNormal(GREEN_ARC[i - 1], GREEN_ARC[i + 1], [-40, -18]);
    plant('oak_tree', push(GREEN_ARC[i], n, -4.2), 0.6);
  }
}

export interface GardenWall {
  /** The wall's inner face line (local frame), the unit normals to its outer side, its thickness (m). */
  p: V2[];
  n: V2[];
  thick: number;
  /** A low kerb on an embankment (not a solid wall). */
  low: boolean;
  /** A green railing on its top. */
  rail?: boolean;
}

/**
 * The garden's retaining walls (pure, shared by the drawing and the colliders), each on the upper level's edge reaching
 * out over the lower one: the grey strip's three sides (railed), the red terrace's far side over the green one (railed
 * beside the stairs), the low kerb along the green terrace's arc and the stone steps' east side.
 */
export function gardenWallRuns(): GardenWall[] {
  const { G, Q1, T, D, F, Eend } = VIDIKOVEC_RIM;
  const greyIn: V2 = [-40, -6];
  /** A wall along the corners `p`, a point about every 2 m (its top follows the levels). */
  const run = (
    p: V2[],
    inside: V2,
    thick: number,
    low = false,
    rail = false,
  ): GardenWall => {
    const seg = p.slice(0, -1).map((a, k) => edgeNormal(a, p[k + 1], inside));
    const pts: V2[] = [];
    const ns: V2[] = [];
    p.forEach((a, k) => {
      pts.push(a);
      ns.push(
        k === 0
          ? seg[0]
          : k === seg.length
            ? seg[k - 1]
            : unitV(seg[k - 1][0] + seg[k][0], seg[k - 1][1] + seg[k][1]),
      );
      if (k === seg.length) return;
      const b = p[k + 1];
      const m = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
      for (let j = 1; j < m; j++) {
        pts.push([
          a[0] + ((b[0] - a[0]) * j) / m,
          a[1] + ((b[1] - a[1]) * j) / m,
        ]);
        ns.push(seg[k]);
      }
    });
    return { p: pts, n: ns, thick, low, rail };
  };
  const redIn: V2 = [-40, -20];
  return [
    run([G, GP.Gb, GP.Gc, Eend], greyIn, STEP_WALL, false, true),
    // (from the red flight's foot: beside the flight its own cheek wall and handrail rise over it)
    run([Q1, redRiser(RED_FLIGHT.count + 1).s], redIn, STEP_WALL),
    run(
      [redRiser(RED_FLIGHT.count + 1).s, GP.RT],
      redIn,
      STEP_WALL,
      false,
      true,
    ),
    run([GP.RT, GP.RS, GP.RE, GP.Gc], redIn, STEP_WALL),
    run([D, F, ...GREEN_ARC.slice(ARC_FROM), T], [-40, -18], 0.35, true),
  ];
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
      const hiG = Math.max(side(-0.6), side(w.thick + 1.2));
      const loG = Math.min(side(-0.6), side(w.thick + 1.2));
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

/** The drawn terrain's cut inside the garden's retaining walls (car-parks.ts `wallMeshCut`; not the kerb on the embankment). */
export const gardenMeshSink = wallMeshCut(VIDIKOVEC.site, () =>
  gardenWallRuns()
    .filter((w) => !w.low)
    .map((w) => ({ p: w.p, n: w.n, inner: 0, outer: w.thick })),
);

const RAIL_GREEN = '#2f7a45';

/** A handrail from p (height y0) to q (y1), 95 cm over them, a post at each end (local frame). */
function handrail(l: Local, p: V2, y0: number, q: V2, y1: number): void {
  strut(
    l,
    [p[0], y0 + 0.95, p[1]],
    [q[0], y1 + 0.95, q[1]],
    0.05,
    'metal',
    RAIL_GREEN,
  );
  for (const [r, y] of [
    [p, y0],
    [q, y1],
  ] as const)
    strut(
      l,
      [r[0], y, r[1]],
      [r[0], y + 0.95, r[1]],
      0.05,
      'metal',
      RAIL_GREEN,
    );
}

/** Retaining walls, the stairs and their handrails, the stone steps of the lot's east end (local frame; `gy` = the levelled terrain). */
export function drawGarden(l: Local, gy: LocalGround): void {
  /**
   * A rock wall along `pts` (its inner face on the line, `thick` m out along the normals `ns`): one ribbon, its top 45 cm over
   * the floor beside it - or at the land behind it where that is higher (a cut) - smoothed along the run; it runs under whatever
   * lies lower past it. `low`: a kerb (30 cm), it only reaches down to the pad's level, the land falls away under it as an
   * embankment. `rail`: a green railing along its top.
   */
  const wall = (w: GardenWall): void => {
    const { p: pts, n: ns, thick, low } = w;
    const hi: number[] = [];
    const foot: number[] = [];
    /** The lawn's level at the wall's outer face: where its stone plinth ends. */
    const lawn: number[] = [];
    pts.forEach(([x, z], k) => {
      const [nx, nz] = ns[k];
      const inY = Math.max(
        gy(x - nx * 0.6, z - nz * 0.6),
        gy(x - nx * 1.2, z - nz * 1.2),
      );
      const outY = Math.min(
        gy(x + nx * (thick + 1.2), z + nz * (thick + 1.2)),
        gy(x + nx * (thick + 2), z + nz * (thick + 2)),
      );
      hi.push(
        low
          ? inY + 0.3
          : Math.max(inY + 0.45, outY > inY ? outY + 0.15 : -Infinity),
      );
      foot.push(low ? inY - 0.5 : Math.min(inY, outY) - 0.9);
      lawn.push(outY);
    });
    const lo = foot.map((v, k) =>
      Math.min(
        v,
        foot[Math.max(0, k - 1)],
        foot[Math.min(foot.length - 1, k + 1)],
      ),
    );
    const top = smoothHeights(hi);
    wallRibbon(l, { p: pts, n: ns, hi: top, lo, inner: 0, outer: thick });
    // A stone plinth at the foot of a retaining wall, leaning out from its face to the lawn: the drawn terrain's 1 m grid
    // leaves a grass wedge against the face where no grid point falls inside the thin wall, and the plinth stands over it.
    if (!low) {
      const base = smoothHeights(lawn);
      const PLINTH = 0.6;
      const tan = unitV(
        pts[pts.length - 1][0] - pts[0][0],
        pts[pts.length - 1][1] - pts[0][1],
      );
      for (let k = 0; k + 1 < pts.length; k++) {
        const [nx, nz] = unitV(
          ns[k][0] + ns[k + 1][0],
          ns[k][1] + ns[k + 1][1],
        );
        const q = (j: number, o: number, y: number): V3 => [
          pts[j][0] + ns[j][0] * o,
          y,
          pts[j][1] + ns[j][1] * o,
        ];
        l.fan(
          'drystone',
          [
            q(k, thick, base[k] + PLINTH),
            q(k + 1, thick, base[k + 1] + PLINTH),
            q(k + 1, thick + PLINTH, base[k + 1] - 0.05),
            q(k, thick + PLINTH, base[k] - 0.05),
          ],
          '#ddd7ca',
          [nx * 0.7, 0.7, nz * 0.7],
          (v) => [v[0] * tan[0] + v[2] * tan[1], v[1]],
        );
      }
    }
    if (!w.rail) return;
    // The railing: posts about every 2 m, two rails sloping with the top.
    const posts: V3[] = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const len = Math.hypot(
        pts[k + 1][0] - pts[k][0],
        pts[k + 1][1] - pts[k][1],
      );
      const m = Math.max(1, Math.round(len / 2));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        const nx = ns[k][0] + (ns[k + 1][0] - ns[k][0]) * t;
        const nz = ns[k][1] + (ns[k + 1][1] - ns[k][1]) * t;
        posts.push([
          pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t + nx * thick * 0.5,
          top[k] + (top[k + 1] - top[k]) * t,
          pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t + nz * thick * 0.5,
        ]);
      }
    }
    const k = pts.length - 1;
    posts.push([
      pts[k][0] + ns[k][0] * thick * 0.5,
      top[k],
      pts[k][1] + ns[k][1] * thick * 0.5,
    ]);
    for (const [x, y, z] of posts)
      strut(l, [x, y, z], [x, y + 1, z], 0.07, 'paint', RAIL_GREEN);
    for (let j = 0; j + 1 < posts.length; j++)
      for (const h of [0.5, 0.95]) {
        const [a, b] = [posts[j], posts[j + 1]];
        strut(
          l,
          [a[0], a[1] + h, a[2]],
          [b[0], b[1] + h, b[2]],
          0.06,
          'paint',
          RAIL_GREEN,
        );
      }
  };
  for (const w of gardenWallRuns()) wall(w);
  const { G, Q1 } = VIDIKOVEC_RIM;
  // (the lot and its levels slope up to the east: each flight runs from the slab's top at its head to the floor at its foot)
  // The green terrace's flight from the lot: concrete treads from the terrace wall to the kerb, about 17 cm a step, a green
  // handrail each side.
  {
    const { a, b, n, count, run } = GREEN_FLIGHT;
    const t = unitV(b[0] - a[0], b[1] - a[1]);
    const m = mid(a, b);
    const treads = greenTreads();
    const at = (d: number, lat = 0): V2 => [
      m[0] + n[0] * d + t[0] * lat,
      m[1] + n[1] * d + t[1] * lat,
    ];
    const slabTop = gy(...at(-1.5)) + SLAB;
    const yF = gy(...at(run * count + 0.8));
    const riser = (slabTop - yF) / (count + 1);
    treads.forEach(({ d, lo, hi }, k) => {
      const top = slabTop - riser * (k + 1);
      wallSeg(
        l,
        at(d, lo),
        at(d, hi),
        yF - 0.4,
        top,
        run,
        'concrete',
        '#cfcac0',
      );
    });
    const f = treads[0];
    const e = treads[treads.length - 1];
    // A cheek wall in the green's kerb beside the treads, its top over them (the kerb alone stays low there).
    const out: V2 = [-t[0], -t[1]];
    const cheek: V2[] = [at(f.d - run * 0.5, f.lo)];
    const cheekTop: number[] = [slabTop + 0.1];
    treads.forEach(({ d, lo }, k) => {
      cheek.push(at(d + run * 0.5, lo));
      cheekTop.push(slabTop - riser * (k + 1) + 0.1);
    });
    wallRibbon(l, {
      p: cheek,
      n: cheek.map(() => out),
      hi: cheekTop,
      lo: cheekTop.map(() => yF - 0.5),
      // (inside the kerb, which runs on under it: only its top shows)
      inner: 0.03,
      outer: 0.33,
    });
    for (const side of ['lo', 'hi'] as const) {
      const inset = side === 'lo' ? 0.15 : -0.15;
      handrail(
        l,
        at(f.d - run * 0.5 - 0.2, f[side] + inset),
        slabTop,
        at(e.d + run * 0.5 + 0.2, e[side] + inset),
        yF,
      );
    }
  }
  // The red terrace's flight: down from the landing's edge Q1-G along the grey strip's wall, its risers parallel to Q1-G,
  // a low cheek wall and a handrail along its open side.
  {
    const { across, run, count, g } = RED_FLIGHT;
    // (the lot slopes along the landing's edge: from its lower end, so the slab never stands over the top tread)
    const slabTop =
      Math.min(gy(...push(Q1, g, -1.5)), gy(...push(G, g, -1.5))) + SLAB;
    const foot = redRiser(count + 1);
    const yF = gy(...push(mid(foot.w, foot.s), g, 0.8));
    const riser = (slabTop - yF) / (count + 1);
    const depth =
      run * Math.abs(RED_FLIGHT.g[0] * across[1] - RED_FLIGHT.g[1] * across[0]);
    const cheek: V2[] = [Q1];
    const cheekTop: number[] = [slabTop + 0.1];
    for (let k = 0; k < count; k++) {
      const top = slabTop - riser * (k + 1);
      const r0 = redRiser(k);
      const r1 = redRiser(k + 1);
      // (a block along the tread's middle line, from inside the wall to the cheek's middle)
      const w = mid(r0.w, r1.w);
      const s = mid(r0.s, r1.s);
      wallSeg(
        l,
        push(w, across, -0.3),
        push(s, across, 0.15),
        yF - 0.4,
        top,
        depth,
        'concrete',
        '#cfcac0',
      );
      cheek.push(r1.s);
      cheekTop.push(top + 0.1);
    }
    const last = redRiser(count + 1).s;
    cheek.push(last);
    cheekTop.push(yF + 0.1);
    const nCheek = edgeNormal(Q1, last, G);
    wallRibbon(l, {
      p: cheek,
      n: cheek.map(() => nCheek),
      hi: cheekTop,
      lo: cheekTop.map(() => yF - 0.5),
      // (inside the wall between the terraces, which runs on under it: only its top shows)
      inner: 0.02,
      outer: 0.43,
    });
    handrail(
      l,
      push(Q1, nCheek, 0.15),
      slabTop + 0.1,
      push(last, nCheek, 0.15),
      yF + 0.1,
    );
  }
  // The lot's east end: a short flight of shallow stone steps from the lot down the middle of the grass strip, grass on below.
  const [fx, fz] = TAIL.from;
  const dir = unitV(TAIL.to[0] - fx, TAIL.to[1] - fz);
  const L = Math.hypot(TAIL.to[0] - fx, TAIL.to[1] - fz);
  const tread = L / TAIL.steps;
  // (only from the lot's end down to the corner of the wall beside it, Gc: grass on below)
  const cut = (GP.Gc[0] - fx) * dir[0] + (GP.Gc[1] - fz) * dir[1];
  for (let k = 0; k < TAIL.steps; k++) {
    if (tread * (k + 0.5) < cut) continue;
    const c: V2 = [
      fx + dir[0] * tread * (k + 0.5),
      fz + dir[1] * tread * (k + 0.5),
    ];
    /** How far the tread reaches each way across the slope, inside the strip (clear of its walls). */
    const reach = (s: number): number => {
      let r = 0;
      while (
        r < 12 &&
        inPoly(
          TAIL.poly,
          c[0] - dir[1] * s * (r + 0.6),
          c[1] + dir[0] * s * (r + 0.6),
        )
      )
        r += 0.25;
      return r;
    };
    // (one flight about 3.6 m wide down the middle of the strip, grass either side)
    const ra = Math.min(1.8, reach(1));
    const rb = Math.min(1.8, reach(-1));
    if (ra + rb < 1) continue;
    const pa: V2 = [c[0] - dir[1] * ra, c[1] + dir[0] * ra];
    const pb: V2 = [c[0] + dir[1] * rb, c[1] - dir[0] * rb];
    // (flat, level with the ground at its top edge: the slope's rise shows as a riser at its foot)
    const hiEnd: V2 = [
      c[0] + dir[0] * tread * 0.5,
      c[1] + dir[1] * tread * 0.5,
    ];
    const top =
      Math.max(
        gy(...hiEnd),
        gy(...push(pa, dir, tread * 0.5)),
        gy(...push(pb, dir, tread * 0.5)),
      ) + 0.04;
    wallSeg(l, pa, pb, top - 0.7, top, tread, 'drystone', '#bdb6a8');
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
  // (the Vidikovec island is the verge's own lawn, at the road's level: `vidikovecVerge`, its wall the lot's `bank` rim)
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
