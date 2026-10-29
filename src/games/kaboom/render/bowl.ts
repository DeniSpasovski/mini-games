import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { Noise2D } from '../../../shared/noise';
import { Rng, hash3 } from '../../../shared/rng';
import { ROUGH } from './materials';
import { bbox, flagstone, merge, part, rock } from './parts';

/**
 * The rocky bowl round the arena floor (DETAILS.md "Style"): a low wall, `TIERS` terraces for the spectators, then a
 * cliff up to a flat rim. Every ring is the floor rectangle grown by an offset `d` (a rounded rectangle), so the stands
 * curve round the corners like a gladiator arena. One merged geometry in vertex colours (`bowlGeometry`): one draw call.
 */
export const TIERS = 4;
/** Depth of one terrace and the height of its step. */
export const TREAD_D = 1.1;
export const TREAD_RISE = 0.8;
/** Height of the first terrace above the floor (the arena wall). */
export const WALL_H = 0.95;
/** Offset from the floor rectangle where the first terrace starts. */
export const WALL_D = 0.02;
/** Height of the rim the cliff climbs to. */
export const RIM_H = 10.6;

/** Offset of the middle of terrace `i` and the height its spectators stand on. */
export const treadMidD = (i: number): number => WALL_D + TREAD_D * (i + 0.5);
export const treadY = (i: number): number => WALL_H + TREAD_RISE * i;

/** Straight-side spacing and arc resolution of a ring: the point count depends on `hx`, `hz` only, never on `d`. */
const SIDE_STEP = 0.7;
const CORNER_SEGS = 10;

/** Points per ring for a floor of half extents `hx`, `hz`. */
export function ringSize(hx: number, hz: number): number {
  const sx = Math.max(0, Math.ceil((hx * 2) / SIDE_STEP) - 1);
  const sz = Math.max(0, Math.ceil((hz * 2) / SIDE_STEP) - 1);
  return 4 * (CORNER_SEGS + 1) + 2 * sx + 2 * sz;
}

/**
 * The ring at offset `d` from the floor rectangle `hx x hz`, counter-clockwise from above (x right, z down the screen,
 * so it runs +x side -> +z side ...): `[x0, z0, x1, z1, ...]`. Same point count and meaning for every `d`.
 */
export function ringPoints(hx: number, hz: number, d: number): number[] {
  const out: number[] = [];
  const sx = Math.max(0, Math.ceil((hx * 2) / SIDE_STEP) - 1);
  const sz = Math.max(0, Math.ceil((hz * 2) / SIDE_STEP) - 1);
  // corners in order of their start angle: (+,+) 0, (-,+) 90, (-,-) 180, (+,-) 270 degrees
  const corners = [
    [hx, hz],
    [-hx, hz],
    [-hx, -hz],
    [hx, -hz],
  ];
  for (let c = 0; c < 4; c++) {
    const [cx, cz] = corners[c];
    for (let k = 0; k <= CORNER_SEGS; k++) {
      const a = ((c + k / CORNER_SEGS) * Math.PI) / 2;
      out.push(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
    }
    // the straight side to the next corner (along z for c = 0 and 2, along x for 1 and 3)
    const [nx, nz] = corners[(c + 1) % 4];
    const ex = cx + Math.cos(((c + 1) * Math.PI) / 2) * d;
    const ez = cz + Math.sin(((c + 1) * Math.PI) / 2) * d;
    const fx = nx + Math.cos(((c + 1) * Math.PI) / 2) * d;
    const fz = nz + Math.sin(((c + 1) * Math.PI) / 2) * d;
    const n = c % 2 === 0 ? sx : sz;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push(ex + (fx - ex) * t, ez + (fz - ez) * t);
    }
  }
  return out;
}

type Kind = 'wall' | 'tread' | 'riser' | 'cliff' | 'rim';
/** Profile point: offset `d`, height `y`, and what the segment ENDING here is. */
type ProfilePoint = [number, number, Kind];

/** Finest step of the profile: long faces are cut into pieces so the noise can carve them. */
const PROFILE_STEP = 0.4;

/** `prof` with every segment cut into pieces of at most `PROFILE_STEP`; also returns each point's position along its face (0..1). */
function subdivide(prof: ProfilePoint[]): { pts: ProfilePoint[]; t: number[] } {
  const pts: ProfilePoint[] = [prof[0]];
  const t = [1];
  for (let i = 1; i < prof.length; i++) {
    const [d0, y0] = prof[i - 1];
    const [d1, y1, kind] = prof[i];
    const len = Math.hypot(d1 - d0, y1 - y0);
    // the rim is coarser (it is far away), but fine enough near the cliff top that the finale's wide view shows no
    // big flat quads
    const n =
      kind === 'rim'
        ? len > 30
          ? 6
          : Math.max(1, Math.ceil(len / 1.5))
        : Math.max(1, Math.ceil(len / PROFILE_STEP));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      pts.push([d0 + (d1 - d0) * f, y0 + (y1 - y0) * f, kind]);
      t.push(f);
    }
  }
  return { pts, t };
}

function profile(): ProfilePoint[] {
  const p: ProfilePoint[] = [
    [WALL_D, -0.3, 'wall'],
    [WALL_D, WALL_H, 'wall'],
  ];
  for (let i = 0; i < TIERS; i++) {
    const d1 = WALL_D + TREAD_D * (i + 1);
    p.push([d1, treadY(i), 'tread']);
    if (i < TIERS - 1) {
      p.push([d1, treadY(i + 1), 'riser']);
    }
  }
  const d0 = WALL_D + TREAD_D * TIERS;
  const y0 = treadY(TIERS - 1);
  p.push(
    [d0 + 0.1, y0 + 1.2, 'cliff'],
    [d0 + 0.9, y0 + 2.6, 'cliff'],
    [d0 + 1.3, y0 + 4.2, 'cliff'],
    [d0 + 2.2, y0 + 5.8, 'cliff'],
    [d0 + 2.7, RIM_H, 'cliff'],
    [d0 + 5, RIM_H + 0.1, 'rim'],
    [d0 + 12, RIM_H + 0.25, 'rim'],
    [d0 + 24, RIM_H, 'rim'],
    [d0 + 90, RIM_H, 'rim'],
  );
  return p;
}

/** Outer offset where the flat rim starts, for placing rocks and checks. */
export const RIM_D = WALL_D + TREAD_D * TIERS + 2.7;

const noise = new Noise2D(515);

/** Unit vector pointing away from the floor rectangle at ring point `(x, z)`. */
function outward(
  hx: number,
  hz: number,
  x: number,
  z: number,
): [number, number] {
  const ox = x - Math.max(-hx, Math.min(hx, x));
  const oz = z - Math.max(-hz, Math.min(hz, z));
  const len = Math.hypot(ox, oz) || 1;
  return [ox / len, oz / len];
}

/**
 * How far the bowl is pushed in or out at world position `(x, z)` on a ring at offset `d`: slow noise, nothing at the
 * arena wall and more and more towards the cliff, so the stands wander and the terraces change width like carved rock.
 * A function of the position, never of the ring index, so the crowd and the geometry always agree.
 */
function warp(x: number, z: number, d: number): number {
  const n =
    noise.fbm(x * 0.2 + 3, z * 0.2 - 5, 3) +
    0.3 * noise.noise2(x * 0.65, z * 0.65);
  return Math.max(0, d - 0.4) * 0.3 * n;
}

/** [`ringPoints`](#) bent by `warp`: `[x0, z0, x1, z1, ...]`. */
export function warpedRing(hx: number, hz: number, d: number): number[] {
  const pts = ringPoints(hx, hz, d);
  for (let i = 0; i < pts.length; i += 2) {
    const [ox, oz] = outward(hx, hz, pts[i], pts[i + 1]);
    const k = warp(pts[i], pts[i + 1], d);
    pts[i] += ox * k;
    pts[i + 1] += oz * k;
  }
  return pts;
}

/** Height of terrace `i` at `(x, z)`: its step plus a slow swell, so the stands are not a flat staircase. */
export function treadHeight(i: number, x: number, z: number): number {
  return (
    treadY(i) +
    0.14 * noise.noise2(x * 0.3 + 7, z * 0.3 - 2) +
    0.07 * noise.noise2(x * 1.3, z * 1.3 + 4)
  );
}

/**
 * Colours of the bowl: the wall at the arena, the stands (treads + risers), the cut stones (coping on every terrace lip
 * and the wall's facing), the cliff strata (high to low) and the rim.
 */
export interface BowlColors {
  wall: Color;
  treads: Color[];
  riser: Color;
  stones: Color[];
  strata: Color[];
  rim: Color;
}

const colors = (c: {
  wall: number;
  treads: number[];
  riser: number;
  stones: number[];
  strata: number[];
  rim: number;
}): BowlColors => ({
  wall: new Color(c.wall),
  treads: c.treads.map((x) => new Color(x)),
  riser: new Color(c.riser),
  stones: c.stones.map((x) => new Color(x)),
  strata: c.strata.map((x) => new Color(x)),
  rim: new Color(c.rim),
});

// carved rock, darker than the floor tiles so the arena reads apart from the stands; cut stones a shade lighter
export const QUARRY_BOWL: BowlColors = colors({
  wall: 0xa97d55,
  treads: [0xc6a77c, 0xbb9b71, 0xb08f67],
  riser: 0x936846,
  stones: [0xd7b98a, 0xcdae7f, 0xdfc396, 0xc4a374],
  strata: [0xdcb27a, 0xc28e58, 0xa47459, 0x80695a],
  rim: 0xcca671,
});

const KINDS: readonly Kind[] = ['wall', 'tread', 'riser', 'cliff', 'rim'];
/** Weights of the level's detail texture per face kind (`detail.ts`: red = gravelly sand, green = rock). */
const DETAIL: Record<Kind, readonly [number, number]> = {
  wall: [0.2, 0.8],
  tread: [1, 0],
  riser: [0.25, 0.85],
  cliff: [0, 1],
  rim: [1, 0.15],
};
/** How far the step edges crumble in and out (the coping stones sit on them, so they stay close to the ring). */
const CRUMBLE = 0.1;

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Height of the stands at `(x, z)` on a ring at offset `d` (the swell `bowlGeometry` gives every tread). */
function standY(tier: number, x: number, z: number, d: number): number {
  const grow = Math.min(1, (d - WALL_D) / 1.2);
  return treadY(tier) + (treadHeight(0, x, z) - treadY(0)) * grow;
}

/**
 * The bowl for a floor of half extents `hx`, `hz` (world units, centred on the origin), mid-poly (DETAILS.md "Style"):
 * carved rock with smooth shading inside each face and hard creases at the step edges, painted per vertex (strata, darker
 * crevices, lighter lips), a course of cut coping stones on every terrace lip, scree at the foot of the cliff and (High)
 * an ashlar facing on the arena wall. One merged geometry with the attributes of `part()`: one draw call.
 */
export function bowlGeometry(
  hx: number,
  hz: number,
  pal: BowlColors = QUARRY_BOWL,
  low = false,
): BufferGeometry {
  const { pts: prof, t: along } = subdivide(profile());
  const n = ringSize(hx, hz);
  // rock noise only on the cliff and the far rim; the stands stay clean so the crowd stands level
  const rings = prof.map(([d, y, kind]) => {
    const pts = warpedRing(hx, hz, d);
    const cliff = kind === 'cliff' || kind === 'rim';
    const grow = Math.min(1, (d - WALL_D) / 1.2); // nothing at the arena wall
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      let x = pts[i * 2];
      let z = pts[i * 2 + 1];
      let h = y;
      const [ox, oz] = outward(hx, hz, x, z);
      if (y > WALL_H - 0.01 && d < RIM_D + 8) {
        // swell of the stands plus fine bumps
        h += (treadHeight(0, x, z) - treadY(0)) * grow;
      }
      if (kind === 'riser' || kind === 'tread') {
        // carved faces: the step edge crumbles in and out, the tread is lumpy
        const k = noise.fbm(x * 1.1 + y, z * 1.1, 2) * CRUMBLE * grow;
        x += ox * k;
        z += oz * k;
      }
      if (cliff && d < RIM_D + 8) {
        const amp = Math.min(1, (d - (WALL_D + TREAD_D * TIERS)) / 2) * 1.1;
        const k = noise.fbm(x * 0.8, z * 0.8 + y * 0.5, 3) * amp;
        const k2 = noise.noise2(x * 1.2 + 9, z * 1.2 + y * 0.7) * amp * 0.9;
        x += ox * k;
        z += oz * k;
        h += k2;
        // the rim itself rises and falls
        if (kind === 'cliff' && y > RIM_H - 0.5)
          h += 1.2 * noise.noise2(x * 0.18, z * 0.18);
      }
      out.push([x, h, z]);
    }
    return out;
  });

  // normals: averaged over the faces of one kind that meet at a vertex (smooth rock), split between kinds (creases)
  const K = KINDS.length;
  const kindOf = prof.map(([, , kind]) => KINDS.indexOf(kind));
  const vn = new Float32Array(prof.length * n * K * 3);
  const slot = (s: number, i: number, k: number) => ((s * n + i) * K + k) * 3;
  const addN = (
    k: number,
    v: readonly (readonly [number, number])[],
    p0: number[],
    p1: number[],
    p2: number[],
  ): void => {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0];
    const wy = p2[1] - p0[1];
    const wz = p2[2] - p0[2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    for (const [s, i] of v) {
      const o = slot(s, i, k);
      vn[o] += nx;
      vn[o + 1] += ny;
      vn[o + 2] += nz;
    }
  };
  for (let s = 1; s < prof.length; s++) {
    const a = rings[s - 1];
    const b = rings[s];
    const k = kindOf[s];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      addN(
        k,
        [
          [s - 1, i],
          [s, j],
          [s, i],
        ],
        a[i],
        b[j],
        b[i],
      );
      addN(
        k,
        [
          [s - 1, i],
          [s - 1, j],
          [s, j],
        ],
        a[i],
        a[j],
        b[j],
      );
    }
  }

  // painted colour of a vertex of a face of kind `kind` (`at` = how far up its face, 0 foot .. 1 top edge)
  const paint = (kind: Kind, p: number[], at: number, out: Color): Color => {
    const [x, y, z] = p;
    const r =
      noise.noise2(x * 0.5, z * 0.5) * 0.7 +
      noise.noise2(x * 1.7 + 3, z * 1.7 + y) * 0.3;
    if (kind === 'wall') out.copy(pal.wall).multiplyScalar(0.94 + r * 0.1);
    else if (kind === 'tread')
      out
        .copy(pal.treads[1])
        .lerp(pal.treads[r > 0 ? 0 : 2], Math.min(1, Math.abs(r) * 1.4));
    else if (kind === 'riser')
      out.copy(pal.riser).multiplyScalar(0.92 + r * 0.12);
    else if (kind === 'cliff') {
      // strata: wavy bands that follow the height, a light seam on top of each and a dark one under it
      const f = y / 2.6 + noise.noise2(x * 0.2, z * 0.2) * 0.7;
      const band = Math.floor(f);
      const t = f - band;
      const m = pal.strata.length;
      out.copy(pal.strata[((band % m) + m) % m]).multiplyScalar(0.9 + r * 0.14);
      if (t > 0.9) out.multiplyScalar(1.12);
      else if (t < 0.08) out.multiplyScalar(0.86);
    } else out.copy(pal.rim).multiplyScalar(0.95 + r * 0.08);
    // crevices: the foot of a riser, wall or cliff is darker, its top edge catches the light
    if (kind === 'riser' || kind === 'cliff' || kind === 'wall')
      out.multiplyScalar(0.72 + 0.4 * smooth01(at));
    // warm above, cool below (the painted look of `part()`)
    out.r *= 1.02;
    out.b *= 0.97 + 0.04 * (1 - at);
    return out;
  };

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const det: number[] = [];
  const c = new Color();
  for (let s = 1; s < prof.length; s++) {
    const a = rings[s - 1];
    const b = rings[s];
    const k = kindOf[s];
    const kind = KINDS[k];
    // detail texture: gravelly sand on the treads and the rim, rock on the wall, the risers and the cliff
    const [dr, dg] = DETAIL[kind];
    // where on its face each ring sits: the upper ring at `along[s]`, the lower one a step below (0 at a face's foot)
    const hi = along[s];
    const lo = kindOf[s - 1] === k ? along[s - 1] : 0;
    const put = (ss: number, ii: number, p: number[]): void => {
      const o = slot(ss, ii, k);
      const l = Math.hypot(vn[o], vn[o + 1], vn[o + 2]) || 1;
      pos.push(p[0], p[1], p[2]);
      nor.push(vn[o] / l, vn[o + 1] / l, vn[o + 2] / l);
      paint(kind, p, ss === s ? hi : lo, c);
      col.push(c.r, c.g, c.b);
      det.push(dr, dg, 0);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      put(s - 1, i, a[i]);
      put(s, j, b[j]);
      put(s, i, b[i]);
      put(s - 1, i, a[i]);
      put(s - 1, j, a[j]);
      put(s, j, b[j]);
    }
  }

  const ground = new BufferGeometry();
  const count = pos.length / 3;
  ground.setAttribute('position', new Float32BufferAttribute(pos, 3));
  ground.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  ground.setAttribute('color', new Float32BufferAttribute(col, 3));
  ground.setAttribute(
    'aGloss',
    new Float32BufferAttribute(
      new Float32Array(count).fill(1 - ROUGH.stone),
      1,
    ),
  );
  ground.setAttribute(
    'uv',
    new Float32BufferAttribute(new Float32Array(count * 2), 2),
  );
  ground.setAttribute('aDetail', new Float32BufferAttribute(det, 3));
  return merge([ground, ...cutStones(hx, hz, pal, low)]);
}

/** Cumulative lengths along the closed ring `pts` (`[x0, z0, ...]`), one more entry than points. */
function cumulative(pts: number[]): number[] {
  const n = pts.length / 2;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum.push(
      cum[i] +
        Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]),
    );
  }
  return cum;
}

/** Point and unit tangent at arc length `s` along the closed ring `pts` (`cum` from `cumulative`). */
function alongRing(
  pts: number[],
  cum: number[],
  s: number,
): [number, number, number, number] {
  const total = cum[cum.length - 1];
  s = ((s % total) + total) % total;
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1] < s) k++;
  const n = pts.length / 2;
  const a = k % n;
  const b = (k + 1) % n;
  const seg = cum[k + 1] - cum[k] || 1;
  const t = (s - cum[k]) / seg;
  const ax = pts[a * 2];
  const az = pts[a * 2 + 1];
  const dx = pts[b * 2] - ax;
  const dz = pts[b * 2 + 1] - az;
  return [ax + dx * t, az + dz * t, dx / seg, dz / seg];
}

/**
 * The bowl's cut stones: coping blocks of random length on every terrace lip (chamfered slabs, some with a corner
 * knocked off), scree at the foot of the cliff and, on High, two courses of ashlar in running bond on the arena wall.
 */
function cutStones(
  hx: number,
  hz: number,
  pal: BowlColors,
  low: boolean,
): BufferGeometry[] {
  const r = new Rng(hash3(Math.round(hx * 4), Math.round(hz * 4), 0xc0b, 2));
  const out: BufferGeometry[] = [];
  const stone = (): number =>
    pal.stones[r.int(0, pal.stones.length - 1)]
      .clone()
      .multiplyScalar(r.range(0.94, 1.05))
      .getHex();
  // coping on every terrace lip; the first course caps the arena wall
  for (let t = 0; t < TIERS; t++) {
    // flush with the ashlar on the wall and the risers (0.15 m proud of the rock), reaching back over the tread
    const dMid = WALL_D + TREAD_D * t + 0.06;
    const pts = warpedRing(hx, hz, dMid);
    const cum = cumulative(pts);
    const total = cum[cum.length - 1];
    let s = r.range(0, 0.6);
    const end = s + total;
    while (s < end - 0.5) {
      const len = Math.min(r.range(0.75, 1.3), end - s);
      const [x, z, tx, tz] = alongRing(pts, cum, s + len / 2);
      const L = len / 2 - 0.025;
      // counter-clockwise from above; one corner in three knocked off
      const outline: [number, number][] = [
        [-L, 0.21],
        [L, 0.21],
        [L, -0.21],
        [-L, -0.21],
      ];
      if (r.chance(0.3)) {
        const k = r.int(0, 3);
        const [cx, cz] = outline[k];
        const [px, pz] = outline[(k + 3) % 4];
        const [qx, qz] = outline[(k + 1) % 4];
        const cut = 0.08;
        const lp = Math.hypot(px - cx, pz - cz);
        const lq = Math.hypot(qx - cx, qz - cz);
        outline.splice(
          k,
          1,
          [cx + ((px - cx) / lp) * cut, cz + ((pz - cz) / lp) * cut],
          [cx + ((qx - cx) / lq) * cut, cz + ((qz - cz) / lq) * cut],
        );
      }
      out.push(
        part(flagstone(outline, 0.15 + r.range(0, 0.035), 0.035), stone(), {
          x,
          z,
          y: standY(t, x, z, dMid) - 0.05,
          ry: Math.atan2(-tz, tx) + r.range(-0.025, 0.025),
          tint: 0.14,
          rough: ROUGH.stone,
          detail: [0, 0.45],
        }),
      );
      s += len;
    }
  }
  // scree: fallen rocks along the foot of the cliff, behind the top terrace's crowd
  {
    const dFoot = WALL_D + TREAD_D * TIERS - 0.12;
    const pts = warpedRing(hx, hz, dFoot);
    const cum = cumulative(pts);
    const total = cum[cum.length - 1];
    for (let s = 0; s < total; s += r.range(0.9, 1.8)) {
      if (!r.chance(0.6)) continue;
      const [x, z] = alongRing(pts, cum, s);
      const rad = r.range(0.14, 0.34);
      const y0 = standY(TIERS - 1, x, z, dFoot);
      out.push(
        part(rock(rad, low ? 0 : 1), pal.strata[r.int(1, 3)].getHex(), {
          x,
          z,
          y: y0 + rad * 0.3,
          sy: r.range(0.6, 0.85),
          ry: r.range(0, 6.28),
          smooth: !low,
          lumpy: rad * 0.2,
          base: y0 - 0.02,
          tint: 0.14,
          rough: ROUGH.stone,
          detail: [0, 0.7],
        }),
      );
    }
  }
  // ashlar on the risers (High): one course of big cut blocks under each terrace's coping, so the stands read as built
  // masonry like the arena wall
  if (!low)
    for (let t = 1; t < TIERS; t++) {
      const dFace = WALL_D + TREAD_D * t - 0.075;
      const pts = warpedRing(hx, hz, dFace);
      const cum = cumulative(pts);
      const total = cum[cum.length - 1];
      let s = r.range(0, 0.5);
      const end = s + total;
      while (s < end - 0.4) {
        const len = Math.min(r.range(0.85, 1.3), end - s);
        const [x, z, tx, tz] = alongRing(pts, cum, s + len / 2);
        const y0 = standY(t - 1, x, z, dFace) - 0.08;
        const y1 = standY(t, x, z, dFace) - 0.05;
        out.push(
          part(bbox(len - 0.035, y1 - y0, 0.15, 0.035), stone(), {
            x,
            z,
            y: (y0 + y1) / 2,
            ry: Math.atan2(-tz, tx) + r.range(-0.015, 0.015),
            tint: 0.12,
            rough: ROUGH.stone,
            detail: [0, 0.45],
          }),
        );
        s += len;
      }
    }
  // ashlar on the arena wall (High): two courses in running bond, bevelled blocks standing proud of the rock
  if (!low) {
    const dFace = WALL_D - 0.075;
    const pts = ringPoints(hx, hz, dFace);
    const cum = cumulative(pts);
    const total = cum[cum.length - 1];
    for (const [y0, y1, shift] of [
      [-0.05, 0.42, 0],
      [0.42, WALL_H - 0.04, 0.45],
    ] as const) {
      let s = shift;
      const end = s + total;
      while (s < end - 0.4) {
        const len = Math.min(r.range(0.8, 1.15), end - s);
        const [x, z, tx, tz] = alongRing(pts, cum, s + len / 2);
        out.push(
          part(bbox(len - 0.035, y1 - y0 - 0.03, 0.15, 0.03), stone(), {
            x,
            z,
            y: (y0 + y1) / 2,
            ry: Math.atan2(-tz, tx),
            tint: 0.12,
            rough: ROUGH.stone,
            detail: [0, 0.45],
          }),
        );
        s += len;
      }
    }
  }
  return out;
}
