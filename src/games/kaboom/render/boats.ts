import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { Rng, hash3 } from '../../../shared/rng';
import {
  TIERS,
  TREAD_D,
  WALL_D,
  WALL_H,
  ringPoints,
  ringSize,
  treadY,
} from './bowl';
import { WATER_Y } from './sea';

/**
 * The fleet round the raft (Sea Deck): the stands as moored barges. Same terraces as the rocky bowl (the crowd sits on
 * `treadMidD` / `treadY`), but the ring is cut into boats with gaps of open water between them, each with its hull,
 * decks, a mast and a pennant. One merged vertex-colour mesh.
 */
export interface Boat {
  /** First and last ring-point index of the boat (the boat stands over `[a, b]`). */
  a: number;
  b: number;
  hull: number;
  deck: number;
  accent: number;
}

const HULLS = [
  0x2f5d8a, 0x8a3a2e, 0x3a7a5a, 0xb08a3a, 0x5a4a7a, 0x4d4f58, 0x2f7f8a,
];
const DECKS = [0xc9b48a, 0xbfa57a, 0xd2bf94, 0xb9a47d];
const ACCENTS = [0xe05a3a, 0xf2c14e, 0xf4f0e4, 0x62b6e0];
/** Under the waterline the hull goes down to here. */
const BOTTOM = WATER_Y - 0.25;
/** A boat is about this many ring points long (0.7 m apart on a straight). */
const POINTS_PER_BOAT = 17;

const cache = new Map<string, Boat[]>();

/** The boats of a ring of `n` points: the same list for the same `n` (the crowd asks for it too). */
export function boatsFor(n: number): Boat[] {
  const hit = cache.get(String(n));
  if (hit) return hit;
  const rng = new Rng(hash3(n, 0xb0a7, 3, 1));
  const count = Math.max(4, Math.round(n / POINTS_PER_BOAT));
  const span = n / count;
  const boats: Boat[] = [];
  for (let k = 0; k < count; k++) {
    const gap = rng.int(3, 5);
    const a = Math.round(k * span) + 1;
    const b = Math.min(n - 1, Math.round(a + span - gap));
    boats.push({
      a,
      b,
      hull: rng.pick(HULLS),
      deck: rng.pick(DECKS),
      accent: rng.pick(ACCENTS),
    });
  }
  cache.set(String(n), boats);
  return boats;
}

/** Does a boat stand at fractional ring-point index `i` (a half point in from either end, so nobody hangs in the air)? */
export function boatAt(i: number, n: number): boolean {
  for (const b of boatsFor(n))
    if (i >= b.a + 0.5 && i <= b.b - 0.5) return true;
  return false;
}

type Kind = 'hull' | 'tread' | 'riser' | 'outer';
type Pt = [d: number, y: number, kind: Kind];

/** Profile of one boat across the ring: inner hull, the four terraces, the outer hull. */
function profile(): Pt[] {
  const p: Pt[] = [[WALL_D, BOTTOM, 'hull']];
  for (let y = BOTTOM + 0.35; y < WALL_H - 0.01; y += 0.35)
    p.push([WALL_D, y, 'hull']);
  p.push([WALL_D, WALL_H, 'hull']);
  for (let t = 0; t < TIERS; t++) {
    const d1 = WALL_D + TREAD_D * (t + 1);
    p.push([d1, treadY(t), 'tread']);
    if (t < TIERS - 1) p.push([d1, treadY(t + 1), 'riser']);
  }
  const dOut = WALL_D + TREAD_D * TIERS;
  for (let y = treadY(TIERS - 1) - 0.35; y > BOTTOM + 0.01; y -= 0.35)
    p.push([dOut, y, 'outer']);
  p.push([dOut, BOTTOM, 'outer']);
  return p;
}

const noiseOf = (a: number, b: number): number =>
  ((hash3(a, b, 0x51, 9) % 1000) / 1000 - 0.5) * 2;

/** The fleet for a floor of half extents `hx`, `hz`. */
export function boatsGeometry(hx: number, hz: number): BufferGeometry {
  const n = ringSize(hx, hz);
  const boats = boatsFor(n);
  const prof = profile();
  const rings = prof.map(([d]) => ringPoints(hx, hz, d));
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();

  const tri = (
    a: number[],
    b: number[],
    cc: number[],
    color: Color,
    up?: [number, number, number],
  ): void => {
    if (up) {
      // flip the triangle when its normal disagrees with the wanted direction
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = cc[0] - a[0];
      const vy = cc[1] - a[1];
      const vz = cc[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      if (nx * up[0] + ny * up[1] + nz * up[2] < 0) [b, cc] = [cc, b];
    }
    pos.push(...a, ...b, ...cc);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  const at = (s: number, i: number, y?: number): number[] => [
    rings[s][i * 2],
    y ?? prof[s][1],
    rings[s][i * 2 + 1],
  ];

  boats.forEach((boat, k) => {
    const hull = new Color(boat.hull);
    const deck = new Color(boat.deck);
    for (let s = 1; s < prof.length; s++) {
      const kind = prof[s][2];
      const midY = (prof[s - 1][1] + prof[s][1]) / 2;
      for (let i = boat.a; i < boat.b; i++) {
        const j = i + 1;
        const r = noiseOf(i * 7 + k, s);
        if (kind === 'tread') {
          c.copy(deck).multiplyScalar((i & 1 ? 1 : 0.94) + r * 0.03);
        } else if (kind === 'riser') {
          c.copy(deck).multiplyScalar(0.72 + r * 0.03);
        } else if (midY < WATER_Y + 0.12) c.set(0x5b2a28);
        else if (midY < WATER_Y + 0.5) c.set(0xe9e4d6);
        else c.copy(hull).multiplyScalar(0.97 + r * 0.04);
        if (kind === 'outer') c.multiplyScalar(0.9);
        // same winding as the bowl: up for decks, towards the raft for the inner hull, away from it for the outer
        const a = at(s - 1, i);
        const b = at(s, j);
        const b0 = at(s, i);
        const a1 = at(s - 1, j);
        tri(a, b, b0, c);
        tri(a, a1, b, c);
      }
    }
    // open ends: a column down to the water under every deck strip
    for (const [i, dir] of [
      [boat.a, -1],
      [boat.b, 1],
    ] as const) {
      const prev = Math.max(0, i - 1);
      const next = Math.min(n - 1, i + 1);
      const tx = (rings[0][next * 2] - rings[0][prev * 2]) * dir;
      const tz = (rings[0][next * 2 + 1] - rings[0][prev * 2 + 1]) * dir;
      c.copy(hull).multiplyScalar(0.8);
      for (let s = 1; s < prof.length; s++) {
        if (prof[s][2] !== 'tread') continue;
        const p0 = at(s - 1, i);
        const p1 = at(s, i);
        const q0 = at(s - 1, i, BOTTOM);
        const q1 = at(s, i, BOTTOM);
        tri(p0, p1, q1, c, [tx, 0, tz]);
        tri(p0, q1, q0, c, [tx, 0, tz]);
      }
    }
    // foam round the outer hull at the waterline
    const outer = prof.length - 1;
    const foamOut = ringPoints(hx, hz, prof[outer][0] + 0.4);
    c.set(0xdff1f3);
    for (let i = boat.a; i < boat.b; i++) {
      const j = i + 1;
      const y = WATER_Y + 0.035;
      const a = [rings[outer][i * 2], y, rings[outer][i * 2 + 1]];
      const a1 = [rings[outer][j * 2], y, rings[outer][j * 2 + 1]];
      const b = [foamOut[i * 2], y, foamOut[i * 2 + 1]];
      const b1 = [foamOut[j * 2], y, foamOut[j * 2 + 1]];
      tri(a, a1, b1, c, [0, 1, 0]);
      tri(a, b1, b, c, [0, 1, 0]);
    }
    // a mast with a pennant on the outer deck, mid boat
    const m = Math.round((boat.a + boat.b) / 2);
    const mastRing = ringPoints(hx, hz, prof[outer][0] - 0.3);
    const mx = mastRing[m * 2];
    const mz = mastRing[m * 2 + 1];
    const base = treadY(TIERS - 1);
    box(pos, col, mx, base + 1.5, mz, 0.08, 3.0, 0.08, c.set(0x5a4a38));
    box(
      pos,
      col,
      mx + 0.25,
      base + 2.75,
      mz,
      0.5,
      0.2,
      0.02,
      c.set(boat.accent),
    );
  });

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** An axis-aligned box centred on `(cx, cy, cz)`, twelve triangles. */
function box(
  pos: number[],
  col: number[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: Color,
): void {
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const quads: number[][] = [
    [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
    [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0],
    [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1],
    [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0],
    [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0],
    [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1],
  ];
  for (const q of quads) {
    pos.push(...q.slice(0, 3), ...q.slice(3, 6), ...q.slice(6, 9));
    pos.push(...q.slice(0, 3), ...q.slice(6, 9), ...q.slice(9, 12));
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  }
}
