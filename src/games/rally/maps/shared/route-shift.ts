import type { RoadPoint } from './types';

/**
 * The stage road moved sideways onto the real carriageway (`scripts/realmap/route_offset.py` writes `route-shift.json`:
 * keyframes [metres along, lateral shift] from the NYC roadbed, + = left of travel, zero near every structure). Only the control
 * points move (the road is a spline through them). Everything keyed to a distance along the road (bridge spans, trench fills,
 * sign gantries, crowds) is carried over with `alongMap`: the same place on the road gets its new distance.
 */
export type ShiftKey = [number, number];

export interface ShiftedRoute {
  points: RoadPoint[];
  /** Distance along the unshifted route -> distance along the shifted one (the same place on the road). */
  alongMap: (along: number) => number;
}

const xz = (p: RoadPoint): [number, number] =>
  Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z];

/** The shifted route as plain [x, z] pairs (rounded to 0.1 m like the baked route) - the light map info uses it. */
export function shiftRouteXY(
  route: number[][],
  keys: readonly ShiftKey[],
): number[][] {
  return shiftRoute(
    route.map(([x, z]) => ({ x, z }) as RoadPoint),
    keys,
  ).points.map((p) => {
    const [x, z] = xz(p);
    return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  });
}

export function shiftRoute(
  points: RoadPoint[],
  keys: readonly ShiftKey[],
): ShiftedRoute {
  const n = points.length;
  const old = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const [ax, az] = xz(points[i - 1]);
    const [bx, bz] = xz(points[i]);
    old[i] = old[i - 1] + Math.hypot(bx - ax, bz - az);
  }
  const lateralAt = (a: number): number => {
    if (!keys.length || a <= keys[0][0] || a >= keys[keys.length - 1][0])
      return 0;
    let k = 0;
    while (keys[k + 1][0] < a) k++;
    const [a0, v0] = keys[k];
    const [a1, v1] = keys[k + 1];
    return v0 + ((v1 - v0) * (a - a0)) / (a1 - a0 || 1);
  };
  const moved: RoadPoint[] = points.map((p, i) => {
    const [ax, az] = xz(points[Math.max(0, i - 1)]);
    const [bx, bz] = xz(points[Math.min(n - 1, i + 1)]);
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const s = lateralAt(old[i]);
    const [x, z] = xz(p);
    // left of travel = (tz, -tx)
    const nx = x + (dz / l) * s;
    const nz = z - (dx / l) * s;
    return Array.isArray(p) ? [nx, nz] : { ...p, x: nx, z: nz };
  });
  const next = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const [ax, az] = xz(moved[i - 1]);
    const [bx, bz] = xz(moved[i]);
    next[i] = next[i - 1] + Math.hypot(bx - ax, bz - az);
  }
  const alongMap = (a: number): number => {
    if (a <= 0) return a;
    if (a >= old[n - 1]) return a + (next[n - 1] - old[n - 1]);
    let k = 0;
    while (old[k + 1] < a) k++;
    const t = (a - old[k]) / (old[k + 1] - old[k] || 1);
    const delta0 = next[k] - old[k];
    const delta1 = next[k + 1] - old[k + 1];
    return a + delta0 + (delta1 - delta0) * t;
  };
  return { points: moved, alongMap };
}
