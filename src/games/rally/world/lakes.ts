import type { LakeDef } from '../maps/shared/types';

/**
 * Standing water of real-world maps (lakes, ponds, reservoirs from OSM `natural=water`):
 * polygons with a signed distance to the shore. Each lake has one flat water level
 * (`TerrainGenerator` sets it from the land along the shore); the terrain is carved into
 * a basin below it and the shore is cut down / built up (a dam on the low side) to just
 * above it.
 *
 * Pure (no DOM / three.js scene): the world tests run it in node.
 */

/** Shore rim above the water (m). */
export const LAKE_RIM = 0.4;
/** Deepest point below the water (m). */
export const LAKE_DEPTH = 2;
/** Flat shore / dam crest outside the water before the slope back to the land (m). */
export const LAKE_CREST = 2.5;
/** Distance from the shore to full depth (m). */
export const LAKE_SHELF = 8;
/** The shore blends back to the land within this distance (m). */
export const LAKE_REACH = 10;

export interface LakeQuery {
  lake: number;
  /** Signed distance to the shore (m): negative inside the lake. */
  sd: number;
}

export function newLakeQuery(): LakeQuery {
  return { lake: -1, sd: Infinity };
}

export class Lakes {
  readonly polys: Float32Array[];
  /** [minX, minZ, maxX, maxZ] per lake, grown by LAKE_REACH. */
  private boxes: Float32Array;
  /** Water level per lake (set by the terrain generator). */
  levels: number[] = [];

  constructor(readonly defs: LakeDef[]) {
    this.polys = defs.map((d) => new Float32Array(d.pts));
    this.boxes = new Float32Array(defs.length * 4);
    this.polys.forEach((p, i) => {
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k]);
        x1 = Math.max(x1, p[k]);
        z0 = Math.min(z0, p[k + 1]);
        z1 = Math.max(z1, p[k + 1]);
      }
      this.boxes.set(
        [x0 - LAKE_REACH, z0 - LAKE_REACH, x1 + LAKE_REACH, z1 + LAKE_REACH],
        i * 4,
      );
    });
  }

  /** Lake at / nearest to (x, z) within LAKE_REACH of its shore; false if none. */
  query(x: number, z: number, out: LakeQuery): boolean {
    out.lake = -1;
    out.sd = Infinity;
    const b = this.boxes;
    for (let i = 0; i < this.polys.length; i++) {
      const o = i * 4;
      if (x < b[o] || z < b[o + 1] || x > b[o + 2] || z > b[o + 3]) continue;
      const sd = signedDistance(this.polys[i], x, z);
      if (sd < out.sd && sd < LAKE_REACH) {
        out.sd = sd;
        out.lake = i;
      }
    }
    return out.lake >= 0;
  }
}

/** Distance to the polygon outline, negative inside (even-odd rule). */
export function signedDistance(p: Float32Array, x: number, z: number): number {
  let d2 = Infinity;
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2];
    const az = p[j * 2 + 1];
    const bx = p[i * 2];
    const bz = p[i * 2 + 1];
    if (bz > z !== az > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx)
      inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - ax) * ex + (z - az) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - x;
    const dz = az + ez * t - z;
    d2 = Math.min(d2, dx * dx + dz * dz);
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}
