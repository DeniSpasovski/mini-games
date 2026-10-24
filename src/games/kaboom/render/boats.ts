import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  TorusGeometry,
} from 'three';
import { Rng, hash3 } from '../../../shared/rng';
import { ROUGH } from './materials';
import { box, merge, part, strut } from './parts';
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
    const d0 = WALL_D + TREAD_D * t;
    const d1 = d0 + TREAD_D;
    // three deck planks along the boat
    p.push([d0 + TREAD_D / 3, treadY(t), 'tread']);
    p.push([d0 + (TREAD_D * 2) / 3, treadY(t), 'tread']);
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
  const det: number[] = [];
  const c = new Color();
  // detail texture weights of what `tri` draws next (`detail.ts`: red = wood grain, green = weathered paint)
  let dr = 0;
  let dg = 0;

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
    for (let i = 0; i < 3; i++) {
      col.push(color.r, color.g, color.b);
      det.push(dr, dg);
    }
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
          // planks along the boat (one per profile strip), butt joints every second ring point
          c.copy(deck).multiplyScalar(
            (s % 3 === 0 ? 1.02 : s % 3 === 1 ? 0.88 : 0.95) +
              (i & 1 ? 0 : -0.05) +
              r * 0.03,
          );
        } else if (kind === 'riser') {
          c.copy(deck).multiplyScalar(0.72 + r * 0.03);
        } else if (midY < WATER_Y + 0.12) c.set(0x5b2a28);
        else if (midY < WATER_Y + 0.5) c.set(0xe9e4d6);
        else {
          // planked hull: every strake (0.35 m) a shade apart, the top one lighter where the sun bleached it
          const strake = Math.round((midY - BOTTOM) / 0.35);
          c.copy(hull).multiplyScalar(
            (strake & 1 ? 0.9 : 1) +
              r * 0.04 +
              (midY > WALL_H - 0.3 ? 0.06 : 0),
          );
        }
        if (kind === 'outer') c.multiplyScalar(0.9);
        const wood = kind === 'tread' || kind === 'riser';
        // only a faint grain on the decks: stronger, it drowns the painted planks in speckle
        dr = wood ? 0.35 : 0;
        dg = wood || midY < WATER_Y + 0.5 ? 0 : 1;
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
      // the end is a planked transom: strakes of 0.35 m like the hull, the boot-top and antifouling at the waterline
      dr = 0;
      dg = 1;
      for (let s = 1; s < prof.length; s++) {
        if (prof[s][2] !== 'tread') continue;
        const yTop = prof[s][1];
        const cap = yTop - 0.12;
        for (let y0 = BOTTOM; y0 < yTop - 0.01;) {
          // a wooden cap on every step, then strakes down to the keel
          const y1 = y0 < cap - 0.01 ? Math.min(cap, y0 + 0.35) : yTop;
          const mid = (y0 + y1) / 2;
          if (y0 >= cap - 0.01) c.copy(deck).multiplyScalar(0.82);
          else if (mid < WATER_Y + 0.12) c.set(0x5b2a28);
          else if (mid < WATER_Y + 0.5) c.set(0xe9e4d6);
          else
            c.copy(hull).multiplyScalar(
              Math.round((mid - BOTTOM) / 0.35) & 1 ? 0.66 : 0.86,
            );
          const p0 = at(s - 1, i, y1);
          const p1 = at(s, i, y1);
          const q0 = at(s - 1, i, y0);
          const q1 = at(s, i, y0);
          tri(p0, p1, q1, c, [tx, 0, tz]);
          tri(p0, q1, q0, c, [tx, 0, tz]);
          y0 = y1;
        }
      }
    }
    // foam round the outer hull at the waterline
    dr = dg = 0;
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
  });

  const g = new BufferGeometry();
  const count = pos.length / 3;
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // the attributes of `part()`, so the fittings merge into the same draw (painted wood)
  g.setAttribute(
    'aGloss',
    new Float32BufferAttribute(
      new Float32Array(count).fill(1 - ROUGH.paint),
      1,
    ),
  );
  g.setAttribute(
    'uv',
    new Float32BufferAttribute(new Float32Array(count * 2), 2),
  );
  g.setAttribute('aDetail', new Float32BufferAttribute(det, 2));
  return merge([g, ...fittings(hx, hz, boats, prof)]);
}

const WOOD = 0x5a3f2a;
const TYRE = 0x2a2a2e;
const IRON = 0x55585e;

/**
 * Each boat's fittings, mid-poly (DETAILS.md "Style"): rub rails along both hulls, a railing of posts and a top rail round
 * the top deck with a lifebuoy, tyre fenders on both sides, corner posts at the open ends, and a tapered mast with a
 * crosstree, two stays and a pennant in the boat's accent colour.
 */
function fittings(
  hx: number,
  hz: number,
  boats: Boat[],
  prof: Pt[],
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const dIn = WALL_D;
  const dOut = prof[prof.length - 1][0];
  const top = treadY(TIERS - 1);
  const ringAt = (d: number) => ringPoints(hx, hz, d);
  const inner = ringAt(dIn - 0.05);
  const outerRail = ringAt(dOut + 0.05);
  const deckEdge = ringAt(dOut - 0.07);
  const inFender = ringAt(dIn - 0.1);
  const outFender = ringAt(dOut + 0.1);
  const mastRing = ringAt(dOut - 0.35);
  const far = ringAt(dOut + 1);
  const near = ringAt(dOut);
  /** Outward unit vector at ring point `i`. */
  const outward = (i: number): [number, number] => {
    const x = far[i * 2] - near[i * 2];
    const z = far[i * 2 + 1] - near[i * 2 + 1];
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };
  /** A beam along the ring from point `i` to `i + 1` at height `y`. */
  const beam = (
    ring: number[],
    i: number,
    y: number,
    hgt: number,
    thick: number,
    color: number,
  ): BufferGeometry => {
    const x0 = ring[i * 2];
    const z0 = ring[i * 2 + 1];
    const dx = ring[i * 2 + 2] - x0;
    const dz = ring[i * 2 + 3] - z0;
    const len = Math.hypot(dx, dz);
    return part(box(len + 0.03, hgt, thick), color, {
      x: x0 + dx / 2,
      z: z0 + dz / 2,
      y,
      ry: Math.atan2(-dz, dx),
      tint: 0.12,
      rough: ROUGH.wood,
      detail: [0.45, 0],
    });
  };
  /** A tyre hanging flat against the hull at ring point `i`, facing out along `(nx, nz)`. */
  const tyre = (ring: number[], i: number, y: number, sign: number) => {
    const [nx, nz] = outward(i);
    return part(
      new TorusGeometry(0.15, 0.06, 6, 12).rotateY(
        Math.atan2(nx * sign, nz * sign),
      ),
      TYRE,
      { x: ring[i * 2], z: ring[i * 2 + 1], y, tint: 0.05, rough: 0.9 },
    );
  };
  boats.forEach((boat) => {
    for (let i = boat.a; i < boat.b; i++) {
      out.push(
        beam(inner, i, WALL_H - 0.06, 0.12, 0.1, WOOD),
        beam(outerRail, i, top - 0.08, 0.12, 0.1, WOOD),
        beam(deckEdge, i, top + 0.56, 0.05, 0.06, WOOD),
      );
      if ((i - boat.a) % 2 === 0)
        out.push(
          part(box(0.05, 0.56, 0.05), WOOD, {
            x: deckEdge[i * 2],
            z: deckEdge[i * 2 + 1],
            y: top + 0.28,
            tint: 0.1,
            rough: ROUGH.wood,
          }),
        );
      if ((i - boat.a) % 4 === 2)
        out.push(
          tyre(inFender, i, WALL_H - 0.42, -1),
          tyre(outFender, i, top - 0.55, 1),
        );
    }
    // the last railing post and the corner posts at the open ends
    for (const i of [boat.a, boat.b])
      out.push(
        part(box(0.05, 0.56, 0.05), WOOD, {
          x: deckEdge[i * 2],
          z: deckEdge[i * 2 + 1],
          y: top + 0.28,
          rough: ROUGH.wood,
        }),
        part(box(0.12, top - BOTTOM, 0.12), WOOD, {
          x: outerRail[i * 2],
          z: outerRail[i * 2 + 1],
          y: (top + BOTTOM) / 2,
          tint: 0.1,
          rough: ROUGH.wood,
        }),
        part(box(0.12, WALL_H - BOTTOM, 0.12), WOOD, {
          x: inner[i * 2],
          z: inner[i * 2 + 1],
          y: (WALL_H + BOTTOM) / 2,
          tint: 0.1,
          rough: ROUGH.wood,
        }),
      );
    // a lifebuoy on the railing, a quarter of the way along: four quarters, red and white
    {
      const i = Math.round(boat.a + (boat.b - boat.a) * 0.25);
      const [nx, nz] = outward(i);
      for (let q = 0; q < 4; q++)
        out.push(
          part(
            new TorusGeometry(0.17, 0.05, 6, 6, Math.PI / 2)
              .rotateZ((q * Math.PI) / 2)
              .rotateY(Math.atan2(nx, nz)),
            q & 1 ? 0xf2efe6 : 0xd8432f,
            {
              x: deckEdge[i * 2] + nx * 0.06,
              z: deckEdge[i * 2 + 1] + nz * 0.06,
              y: top + 0.36,
              tint: 0.04,
              rough: ROUGH.paint,
            },
          ),
        );
    }
    // the mast: tapered, a crosstree, two stays to the deck ends and a pennant at the top
    const m = Math.round((boat.a + boat.b) / 2);
    const mx = mastRing[m * 2];
    const mz = mastRing[m * 2 + 1];
    const head: [number, number, number] = [mx, top + 3.4, mz];
    out.push(
      part(strut([mx, top, mz], head, 0.075, 7, 0.045), WOOD, {
        tint: 0.1,
        rough: ROUGH.wood,
      }),
      part(box(0.9, 0.05, 0.05), WOOD, {
        x: mx,
        z: mz,
        y: top + 2.6,
        ry: Math.atan2(
          -(mastRing[m * 2 + 3] - mastRing[m * 2 - 1]),
          mastRing[m * 2 + 2] - mastRing[m * 2 - 2],
        ),
        rough: ROUGH.wood,
      }),
      part(box(0.09, 0.09, 0.09), IRON, {
        x: mx,
        z: mz,
        y: top + 3.42,
        tint: 0,
        rough: ROUGH.iron,
      }),
    );
    for (const e of [boat.a + 1, boat.b - 1])
      out.push(
        part(
          strut(
            [mx, top + 3.2, mz],
            [deckEdge[e * 2], top + 0.55, deckEdge[e * 2 + 1]],
            0.012,
            4,
          ),
          0x3a332b,
          { tint: 0, rough: ROUGH.rope },
        ),
      );
    out.push(
      part(pennant(), boat.accent, {
        x: mx,
        z: mz,
        y: top + 3.05,
        ry: 0.5,
        tint: 0.05,
        rough: ROUGH.rope,
      }),
    );
  });
  return out;
}

/** A swallow-tailed pennant flying along +x from a mast at the origin, 0.7 m long, both faces. */
function pennant(): BufferGeometry {
  const v = [
    [0, 0, 0],
    [0.7, -0.02, 0],
    [0.5, 0.11, 0],
    [0, 0, 0],
    [0.5, 0.11, 0],
    [0.7, 0.24, 0],
    [0, 0, 0],
    [0.7, 0.24, 0],
    [0, 0.26, 0],
  ];
  const front = v.flat();
  const back: number[] = [];
  for (let t = 0; t < v.length; t += 3)
    back.push(...v[t], ...v[t + 2], ...v[t + 1]);
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute([...front, ...back], 3),
  );
  g.computeVertexNormals();
  return g;
}
