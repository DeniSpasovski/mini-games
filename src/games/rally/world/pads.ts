import { smoothstep } from '../../../shared/noise';
import type { PadDef } from '../maps/shared/types';
import type { SurfaceId } from '../physics/surfaces';
import { newRoadQuery, type Road } from './road';

interface Pad {
  pts: Float64Array;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  blend: number;
  surface?: SurfaceId;
  /** Start of the frontage and its direction (unit), metres. */
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  /** Along-frontage distance and level (road height + lift) of each knot, sorted. */
  ts: number[];
  hs: number[];
  /** Slope used beyond the first / last knot (end to end average). */
  slope: number;
}

/**
 * Graded lots (MapDef.terrain.pads): inside a pad the terrain is level across the street and follows the
 * stage road's height along it (piecewise linear between the frontage points), outside it blends back to the
 * land. Built after the road, so the road profile itself is not changed by the pads.
 */
export class PadField {
  private pads: Pad[] = [];

  constructor(defs: PadDef[], road: Road) {
    const q = newRoadQuery();
    for (const d of defs) {
      const lift = d.lift ?? 0.1;
      if (d.level !== undefined) {
        // A fixed level: no stage road beside the lot to follow.
        this.add(d, 0, 0, 1, 0, [0, 1], [d.level + lift, d.level + lift], 0);
        continue;
      }
      const knots: { x: number; z: number; h: number }[] = [];
      for (let i = 0; i + 1 < d.frontage.length; i += 2) {
        const x = d.frontage[i];
        const z = d.frontage[i + 1];
        if (road.query(x, z, q).found) knots.push({ x, z, h: q.height + lift });
      }
      if (knots.length < 2) continue;
      const first = knots[0];
      const last = knots[knots.length - 1];
      const length = Math.hypot(last.x - first.x, last.z - first.z) || 1;
      const dx = (last.x - first.x) / length;
      const dz = (last.z - first.z) / length;
      const along = knots
        .map((k) => ({
          t: (k.x - first.x) * dx + (k.z - first.z) * dz,
          h: k.h,
        }))
        .sort((a, b) => a.t - b.t);
      this.add(
        d,
        first.x,
        first.z,
        dx,
        dz,
        along.map((a) => a.t),
        along.map((a) => a.h),
        (along[along.length - 1].h - along[0].h) /
          Math.max(1e-6, along[along.length - 1].t - along[0].t),
      );
    }
  }

  private add(
    d: PadDef,
    x0: number,
    z0: number,
    dx: number,
    dz: number,
    ts: number[],
    hs: number[],
    slope: number,
  ): void {
    const pts = Float64Array.from(d.polygon);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minZ = Math.min(minZ, pts[i + 1]);
      maxZ = Math.max(maxZ, pts[i + 1]);
    }
    this.pads.push({
      pts,
      minX: minX - d.blend,
      maxX: maxX + d.blend,
      minZ: minZ - d.blend,
      maxZ: maxZ + d.blend,
      blend: d.blend,
      surface: d.surface,
      x0,
      z0,
      dx,
      dz,
      ts,
      hs,
      slope,
    });
  }

  /**
   * Level of the pad at (x, z): level across the street, following the road along it. A lot may be deep and
   * skewed to the street, so the along-street coordinate runs well past the frontage: beyond the ends the
   * average slope continues (limited to 120 m), so one bad frontage can never send a pad skywards.
   */
  private level(p: Pad, x: number, z: number): number {
    const t = (x - p.x0) * p.dx + (z - p.z0) * p.dz;
    const n = p.ts.length;
    if (t <= p.ts[0]) return p.hs[0] + p.slope * Math.max(-120, t - p.ts[0]);
    if (t >= p.ts[n - 1])
      return p.hs[n - 1] + p.slope * Math.min(120, t - p.ts[n - 1]);
    let i = 1;
    while (i < n - 1 && p.ts[i] < t) i++;
    const u = (t - p.ts[i - 1]) / (p.ts[i] - p.ts[i - 1] || 1);
    return p.hs[i - 1] + (p.hs[i] - p.hs[i - 1]) * u;
  }

  /** Surface of a pad with one at (x, z) (inside its outline), else undefined. */
  surfaceAt(x: number, z: number): SurfaceId | undefined {
    for (const p of this.pads) {
      if (!p.surface || x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ)
        continue;
      if (distance(p.pts, x, z) === 0) return p.surface;
    }
    return undefined;
  }

  /** Gravel weight (1 inside, fading out over 3 m) of the pads whose surface is gravel. */
  gravel(x: number, z: number): number {
    let w = 0;
    for (const p of this.pads) {
      if (
        (p.surface !== 'gravel' && p.surface !== 'gravel_loose') ||
        x < p.minX ||
        x > p.maxX ||
        z < p.minZ ||
        z > p.maxZ
      )
        continue;
      w = Math.max(w, 1 - smoothstep(0, 3, distance(p.pts, x, z)));
    }
    return w;
  }

  /** `h` (the land height) with every pad applied. */
  apply(x: number, z: number, h: number): number {
    for (const p of this.pads) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      const d = distance(p.pts, x, z);
      if (d > p.blend) continue;
      const target = this.level(p, x, z);
      const reach = Math.min(p.blend, 1.5 + Math.abs(h - target) * 1.6);
      h += (target - h) * (1 - smoothstep(0, reach, d));
    }
    return h;
  }
}

/** Distance from (x, z) to the polygon (0 inside). */
export function distance(pts: Float64Array, x: number, z: number): number {
  let inside = false;
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[i * 2];
    const az = pts[i * 2 + 1];
    const bx = pts[j * 2];
    const bz = pts[j * 2 + 1];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = len2
      ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2))
      : 0;
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return inside ? 0 : best;
}
