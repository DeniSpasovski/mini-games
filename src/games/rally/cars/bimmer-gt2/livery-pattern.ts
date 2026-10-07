import { Rng } from '../../../../shared/rng';
import type { Pt } from '../shared/atlas-painter';

/**
 * Pixel-block pattern of the GT2 livery: our own artwork inspired by a modern GT racer scheme. Pure data (no canvas), in a
 * (z, p) plane: z along the car (nose +), p across it (+ = the car's LEFT), covering the roof / bonnet / boot (|p| <= 1.07)
 * and carried down the sides (|p| up to P_MAX). Bands run diagonally: white nose -> blue -> red rear. Every cell is a
 * ~20 cm block (sizes vary +-12 %); some blocks leave a rearward trail slanted toward +p (an extruded-cube look).
 */
export interface Block {
  /** Polygon (z, p) of the block itself. */
  face: Pt[];
  /** Swept trail behind the block (z, p), or null. */
  trail: Pt[] | null;
  /** The block's square at the far end of the trail (drawn in the block colour over the trail). */
  tip: Pt[] | null;
  band: 0 | 1 | 2;
  /** Shade 0..n-1 into the band's palette. */
  shade: number;
  /** Trail brightness factor. */
  trailF: number;
}

export const Z_NOSE = 2.4;
export const Z_TAIL = -2.4;
/** Rear deck behind this z stays clear pearl white (plate area). */
export const PEARL_Z = -1.85;
export const P_MAX = 2.3;
const CELL = 0.2;
const ANG = (32 * Math.PI) / 180;
const EDGES = [1.15, -0.45];
const PALETTE_SIZES = [5, 6, 5] as const;

const u = (z: number, p: number) => z * Math.cos(ANG) + p * Math.sin(ANG);
/** Slow wobble so the band edges wander instead of running ruler-straight. */
const wobble = (z: number, p: number) =>
  0.12 * Math.sin(z * 3.1 + p * 2.3) + 0.08 * Math.sin(z * 7.7 - p * 5.1);

function hull(pts: Pt[]): Pt[] {
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const sp = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0)
        h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(sp), ...half([...sp].reverse())];
}

let cache: Block[] | null = null;

export function blocks(): Block[] {
  if (cache) return cache;
  const rng = new Rng(11);
  const zb = [Z_NOSE];
  while (zb[zb.length - 1] > Z_TAIL)
    zb.push(zb[zb.length - 1] - CELL * rng.range(0.88, 1.12));
  const pb = [P_MAX];
  while (pb[pb.length - 1] > -P_MAX)
    pb.push(pb[pb.length - 1] - CELL * rng.range(0.88, 1.12));
  const out: Block[] = [];
  for (let i = 0; i < zb.length - 1; i++) {
    for (let j = 0; j < pb.length - 1; j++) {
      const z0 = zb[i],
        z1 = zb[i + 1],
        p0 = pb[j],
        p1 = pb[j + 1];
      const cz = (z0 + z1) / 2,
        cp = (p0 + p1) / 2;
      if (cz < PEARL_Z) continue;
      const v = u(cz, cp) + wobble(cz, cp) + rng.range(-0.05, 0.05);
      const band = (v > EDGES[0] ? 0 : v > EDGES[1] ? 1 : 2) as 0 | 1 | 2;
      const shade = Math.floor(rng.next() * PALETTE_SIZES[band]);
      const face: Pt[] = [
        [z0, p0],
        [z0, p1],
        [z1, p1],
        [z1, p0],
      ];
      let trail: Pt[] | null = null;
      let tip: Pt[] | null = null;
      let trailF = 1;
      if (rng.next() < 0.34) {
        const L = rng.range(2, 8) * (z0 - z1);
        const dz = -L;
        if (z1 + dz >= PEARL_Z) {
          tip = face.map(([z, p]): Pt => [z + dz, p + L * 0.55]);
          trail = hull([...face, ...tip]);
          trailF = rng.pick([0.78, 0.86, 1.12]);
        }
      }
      out.push({ face, trail, tip, band, shade, trailF });
    }
  }
  return (cache = out);
}
