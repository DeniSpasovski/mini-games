import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { Noise2D } from '../../../shared/noise';
import { PALETTE } from './materials';

/**
 * The rocky bowl round the arena floor (DETAILS.md "Style"): a low wall, `TIERS` terraces for the spectators, then a
 * cliff up to a flat rim. Every ring is the floor rectangle grown by an offset `d` (a rounded rectangle), so the stands
 * curve round the corners like a gladiator arena. One merged, flat-shaded geometry in vertex colours: one draw call.
 */
export const TIERS = 4;
/** Depth of one terrace and the height of its step. */
export const TREAD_D = 1.1;
export const TREAD_RISE = 0.8;
/** Height of the first terrace above the floor (the arena wall). */
export const WALL_H = 0.95;
/** Offset from the floor rectangle where the first terrace starts. */
const WALL_D = 0.02;
/** Height of the rim the cliff climbs to. */
export const RIM_H = 10.6;

/** Offset of the middle of terrace `i` and the height its spectators stand on. */
export const treadMidD = (i: number): number => WALL_D + TREAD_D * (i + 0.5);
export const treadY = (i: number): number => WALL_H + TREAD_RISE * i;

/** Straight-side spacing and arc resolution of a ring: the point count depends on `hx`, `hz` only, never on `d`. */
const SIDE_STEP = 1.5;
const CORNER_SEGS = 7;

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
  return treadY(i) + 0.14 * noise.noise2(x * 0.3 + 7, z * 0.3 - 2);
}

const WALL_COL = new Color(0xb4875a);
// carved rock, darker than the floor tiles so the arena reads apart from the stands
const TREAD_COLS = [0xc2a47c, 0xb99b73, 0xb09169].map((c) => new Color(c));
const RISER_COL = new Color(0x9b6f48);
const STRATA = PALETTE.slab.map((c) => new Color(c));
const RIM_COL = new Color(0xcaa670);

/** The bowl for a floor of half extents `hx`, `hz` (world units, centred on the origin). */
export function bowlGeometry(hx: number, hz: number): BufferGeometry {
  const prof = profile();
  const n = ringSize(hx, hz);
  // rock noise only on the cliff and the far rim; the stands stay clean so the crowd stands level
  const rings = prof.map(([d, y, kind]) => {
    const pts = warpedRing(hx, hz, d);
    const cliff = kind === 'cliff' || kind === 'rim';
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      let x = pts[i * 2];
      let z = pts[i * 2 + 1];
      let h = y;
      if (y > WALL_H - 0.01 && d < RIM_D + 8) {
        // swell of the stands, growing from the wall outwards
        const k = Math.min(1, (d - WALL_D) / 1.2);
        h += (treadHeight(0, x, z) - treadY(0)) * k;
      }
      if (cliff && d < RIM_D + 8) {
        const amp = Math.min(1, (d - (WALL_D + TREAD_D * TIERS)) / 2) * 0.9;
        const k = noise.fbm(x * 0.9, z * 0.9 + y * 0.4, 2) * amp;
        const k2 = noise.noise2(x * 1.3 + 9, z * 1.3 + y * 0.6) * amp * 0.9;
        const [ox, oz] = outward(hx, hz, x, z);
        x += ox * k;
        z += oz * k;
        h += k2;
        // the rim itself rises and falls
        if (kind === 'cliff' && y > RIM_H - 0.5)
          h += 1.1 * noise.noise2(x * 0.18, z * 0.18);
      }
      out.push([x, h, z]);
    }
    return out;
  });

  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const push = (a: number[], b: number[], cc: number[], color: Color): void => {
    pos.push(...a, ...b, ...cc);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  for (let s = 1; s < prof.length; s++) {
    const kind = prof[s][2];
    const a = rings[s - 1];
    const b = rings[s];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mid = (a[i][1] + b[j][1]) / 2;
      // colour patches follow the ground, not the ring index
      const r =
        noise.noise2((a[i][0] + b[j][0]) * 0.5, (a[i][2] + b[j][2]) * 0.5) *
          0.9 +
        0.1 * noise.noise2(i * 3.3, s * 5.1);
      if (kind === 'wall') c.copy(WALL_COL).multiplyScalar(0.94 + r * 0.08);
      else if (kind === 'tread')
        c.copy(TREAD_COLS[1]).lerp(
          TREAD_COLS[r > 0 ? 0 : 2],
          Math.abs(r) * 1.4,
        );
      else if (kind === 'riser')
        c.copy(RISER_COL).multiplyScalar(0.93 + r * 0.1);
      else if (kind === 'cliff') {
        const band = Math.max(
          0,
          Math.min(STRATA.length - 1, Math.floor(mid / 3.2 + r * 0.8 - 0.4)),
        );
        c.copy(STRATA[STRATA.length - 1 - band]).multiplyScalar(0.9 + r * 0.14);
      } else c.copy(RIM_COL).multiplyScalar(0.96 + r * 0.06);
      // two triangles per quad; wound so the face looks outward (up for treads, towards the arena for walls)
      push(a[i], b[j], b[i], c);
      push(a[i], a[j], b[j], c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
