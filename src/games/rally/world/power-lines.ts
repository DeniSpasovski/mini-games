import type { ScatterInstance } from './scatter';

/**
 * Power lines of a real-world map (MapDef.pylons / MapDef.powerLines, baked from OSM `power=tower|pole|line`):
 * which support stands where (lattice tower on the long spans, wooden pole on the short ones), how it is
 * turned, and the spans (support pairs) the cables hang between. Pure (no scene), the world tests run it.
 */

export interface PowerSupport {
  x: number;
  z: number;
  /** Unit direction of the line through this support. */
  tx: number;
  tz: number;
  tower: boolean;
  /** Index of the line it belongs to. */
  line: number;
}

export interface PowerSpan {
  a: PowerSupport;
  b: PowerSupport;
}

/** Spacing (m) above which a support is a transmission tower (lattice), below a wooden pole. */
const TOWER_SPAN = 90;

/** Nearest point on polyline `pts` to (x, z): along-distance, distance and unit tangent. */
function project(pts: number[], x: number, z: number) {
  let best = Infinity;
  let along = 0;
  let acc = 0;
  let tx = 1;
  let tz = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ex = pts[k + 2] - pts[k];
    const ez = pts[k + 3] - pts[k + 1];
    const L = Math.hypot(ex, ez) || 1e-9;
    const t = Math.max(
      0,
      Math.min(1, ((x - pts[k]) * ex + (z - pts[k + 1]) * ez) / (L * L)),
    );
    const d = Math.hypot(pts[k] + ex * t - x, pts[k + 1] + ez * t - z);
    if (d < best) {
      best = d;
      along = acc + t * L;
      tx = ex / L;
      tz = ez / L;
    }
    acc += L;
  }
  return { d: best, along, tx, tz };
}

export function powerNetwork(
  pylons: readonly (readonly [number, number])[],
  lines: readonly number[][],
): { supports: PowerSupport[]; spans: PowerSpan[] } {
  const supports: PowerSupport[] = [];
  const spans: PowerSpan[] = [];
  lines.forEach((pts, li) => {
    // Supports that stand on this line (within 6 m), in order along it.
    const on = pylons
      .map(([x, z]) => ({ x, z, ...project(pts, x, z) }))
      .filter((p) => p.d < 6)
      .sort((a, b) => a.along - b.along);
    const made: PowerSupport[] = on.map((p, i) => {
      const next = on[i + 1];
      const prev = on[i - 1];
      const gap = Math.max(
        next ? next.along - p.along : 0,
        prev ? p.along - prev.along : 0,
      );
      return {
        x: p.x,
        z: p.z,
        tx: p.tx,
        tz: p.tz,
        tower: gap > TOWER_SPAN,
        line: li,
      };
    });
    for (let i = 0; i + 1 < made.length; i++)
      // Skip a gap with no pylon between far-apart supports of different kinds being one span (OSM misses a few).
      spans.push({ a: made[i], b: made[i + 1] });
    supports.push(...made);
  });
  return { supports, spans };
}

/** Instances of the supports (y filled by the caller's ground sampler). */
export function supportInstances(
  supports: readonly PowerSupport[],
  height: (x: number, z: number) => number,
): ScatterInstance[] {
  return supports.map((s) => ({
    asset: s.tower ? 'power_pylon' : 'power_pole',
    variant: 0,
    x: s.x,
    y: height(s.x, s.z) - 0.2,
    z: s.z,
    // Local +X runs along the line (three.js yaw maps +X to (cos t, -sin t)).
    rotY: -Math.atan2(s.tz, s.tx),
    scale: 1,
    tiltX: 0,
    tiltZ: 0,
  }));
}
