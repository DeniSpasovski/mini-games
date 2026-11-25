import type { PathDef } from './types';

/**
 * Streets that run along the stage road and lie in its verge. OSM draws a street beside a bending parkway as a few long
 * chords: where the parkway curves away from a chord the street cuts into the road's shoulder and guard rail (the ribbon
 * and the road's embankment fought over the same ground: a sawtooth edge). Such a street is resampled every `step` m and
 * its interior points are pushed sideways until its edge is `gap` m clear of the road's edge. End points never move (the
 * junctions stay joined). Pure (no scene): `maps/jackie/map.ts` runs it on the baked paths.
 */
export interface ClearanceOptions {
  /** Street kinds that are moved (never the carriageways / ramps of the highway or its lanes). */
  kinds: ReadonlySet<string>;
  /** Half width of the stage road incl. its shoulder (m). */
  halfRoad: number;
  /** Free ground between the road's edge and the street's edge (the guard rail stands there, m). */
  gap: number;
  /** Resampling step of a violating chord (m). */
  step: number;
}

/** A street runs alongside the road above this |cos| of the angle between them. */
const ALONGSIDE = 0.85;

interface Hit {
  /** Signed distance to the route (+ = left of its direction). */
  lat: number;
  /** The route's unit tangent there. */
  tx: number;
  tz: number;
}

/** Nearest point of the route polyline to (x, z): signed lateral distance and the tangent. */
function nearest(route: number[][], x: number, z: number): Hit {
  let best = Infinity;
  let hit: Hit = { lat: 0, tx: 1, tz: 0 };
  for (let i = 0; i + 1 < route.length; i++) {
    const ax = route[i][0];
    const az = route[i][1];
    const ex = route[i + 1][0] - ax;
    const ez = route[i + 1][1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
    if (d >= best) continue;
    best = d;
    const l = Math.sqrt(l2);
    // left of the travel direction = (tz, -tx)
    const side = ((x - ax) * ez - (z - az) * ex) / l;
    hit = { lat: side >= 0 ? d : -d, tx: ex / l, tz: ez / l };
  }
  return hit;
}

export function keepClearOfRoute(
  list: PathDef[],
  route: number[][],
  opts: ClearanceOptions,
): { paths: PathDef[]; moved: number } {
  let moved = 0;
  const out = list.map((p) => {
    if (
      p.surface !== 'tarmac' ||
      p.bridge ||
      !opts.kinds.has(p.kind) ||
      p.pts.length < 4
    )
      return p;
    const need = opts.halfRoad + opts.gap + p.width / 2;
    const pts: number[] = [p.pts[0], p.pts[1]];
    let changed = false;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ax = p.pts[k];
      const az = p.pts[k + 1];
      const bx = p.pts[k + 2];
      const bz = p.pts[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / (len || 1);
      const dz = (bz - az) / (len || 1);
      const n = Math.max(1, Math.ceil(len / opts.step));
      // Samples of this chord that lie in the verge, along the road, on one side.
      const pushed: [number, number][] = [];
      for (let i = 1; i < n; i++) {
        const x = ax + (bx - ax) * (i / n);
        const z = az + (bz - az) * (i / n);
        const h = nearest(route, x, z);
        if (Math.abs(h.tx * dx + h.tz * dz) < ALONGSIDE) continue;
        const d = Math.abs(h.lat);
        if (d >= need) continue;
        // Away from the road: along the normal, to the side the street is on.
        const s = h.lat >= 0 ? 1 : -1;
        pushed.push([x + h.tz * s * (need - d), z - h.tx * s * (need - d)]);
      }
      // Both chord ends in the verge as well (a short chord with no interior sample): resample all of it.
      if (!pushed.length) {
        pts.push(bx, bz);
        continue;
      }
      changed = true;
      for (let i = 1; i < n; i++) {
        const x = ax + (bx - ax) * (i / n);
        const z = az + (bz - az) * (i / n);
        const h = nearest(route, x, z);
        const d = Math.abs(h.lat);
        const along = Math.abs(h.tx * dx + h.tz * dz) >= ALONGSIDE;
        if (along && d < need) {
          const s = h.lat >= 0 ? 1 : -1;
          pts.push(x + h.tz * s * (need - d), z - h.tx * s * (need - d));
        } else pts.push(x, z);
      }
      pts.push(bx, bz);
    }
    if (!changed) return p;
    moved++;
    return { ...p, pts };
  });
  return { paths: out, moved };
}
