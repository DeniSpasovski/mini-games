import { CHURCH, toWorld } from './site';

/**
 * The monastery courtyard round the church (pure data, runs in node): its outline is OSM way 1395332301
 * ("Monastery of Ajvatovci", amenity=monastery), which follows the real fence (ways 1395332297-300) and the
 * walls of the buildings on it; reprojected like site.ts. Inside it: a worn lawn (no placeholder boxes), a
 * paved drive from the car park gate to the church's west door, event marquees with tables in front of the
 * church, benches along the east and west walls, round flower beds and a few trees (photos ref-59..63).
 * Round it a very low concrete wall, 0.3 m above the ground, stepped down the slope in short pieces like
 * the real one (ref-59); on the side facing the car park and the road (`FRONT_EDGES`) a taller fence of a
 * block base, pillars and a black iron railing, with an open iron gate (ref-63). Gaps: the car park gate
 * (where the stage road ends) and the footpath down to the court.
 */
export const COURTYARD: [number, number][] = [
  [1504.53, -558.3],
  [1487.98, -515.76],
  [1482.91, -503.66],
  [1481.71, -496.96],
  [1482.1, -481.3],
  [1491.56, -473.54],
  [1495.7, -471.65],
  [1503.95, -465.82],
  [1519.59, -491.75],
  [1520.46, -493.07],
  [1523.89, -498.24],
  [1523.8, -502.12],
  [1526.85, -501.55],
  [1531.72, -527.6],
  [1542.65, -538.41],
  [1510.84, -551.56],
];

/** Gaps in the wall: centre (world x, z) and width (m). */
export const GATES: { x: number; z: number; width: number }[] = [
  // Car park gate, in line with the end of the stage road.
  { x: 1527.24, z: -544.77, width: 5 },
  // Footpath down the hill to the court (OSM footway 1395332283 starts here).
  { x: 1519.2, z: -491.1, width: 1.6 },
];

/** Low wall: height above the ground, thickness, longest straight piece. */
export const WALL = { height: 0.3, thickness: 0.25, piece: 2.5 };

/** Courtyard edges (index i = COURTYARD[i] -> COURTYARD[i + 1]) facing the car park and the road. */
export const FRONT_EDGES = [13, 14, 15];

/** Front fence: block base, iron railing above it, pillars, gate posts, longest panel (m). */
export const FENCE = {
  base: 0.9,
  rail: 0.82,
  pillar: 1.95,
  gatePillar: 2.3,
  piece: 3.0,
};

const XS = COURTYARD.map((p) => p[0]);
const ZS = COURTYARD.map((p) => p[1]);
const BOUNDS = [
  Math.min(...XS),
  Math.max(...XS),
  Math.min(...ZS),
  Math.max(...ZS),
] as const;

/** Inside the courtyard outline grown by `margin` m (negative = shrunk). */
export function inCourtyard(x: number, z: number, margin = 0): boolean {
  const m = Math.max(0, margin);
  if (
    x < BOUNDS[0] - m ||
    x > BOUNDS[1] + m ||
    z < BOUNDS[2] - m ||
    z > BOUNDS[3] + m
  )
    return false;
  let inside = false;
  let best = Infinity;
  const n = COURTYARD.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = COURTYARD[i];
    const [bx, bz] = COURTYARD[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)),
    );
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return inside ? best >= -margin : best <= margin;
}

/** One straight piece of the wall / fence base: centre, length, direction (rad, +X towards +Z), base, top. */
export interface WallPiece {
  x: number;
  z: number;
  length: number;
  angle: number;
  /** Bottom (in the ground) and top of the wall / fence base, world y. */
  y0: number;
  y1: number;
  /** On the front: the iron railing stands on it, between pillars. */
  front: boolean;
}

/** A pillar of the front fence (between panels; the taller gate posts beside the gate). */
export interface Pillar {
  x: number;
  z: number;
  angle: number;
  y0: number;
  y1: number;
  gate: boolean;
}

const edge = (i: number) => {
  const [ax, az] = COURTYARD[i];
  const [bx, bz] = COURTYARD[(i + 1) % COURTYARD.length];
  const len = Math.hypot(bx - ax, bz - az);
  return { ax, az, len, ux: (bx - ax) / len, uz: (bz - az) / len };
};

/** Unit inward normal of edge i (towards the courtyard). */
export function inward(i: number): [number, number] {
  const { ax, az, len, ux, uz } = edge(i);
  const n: [number, number] = [-uz, ux];
  const mx = ax + (ux * len) / 2 + n[0] * 1.5;
  const mz = az + (uz * len) / 2 + n[1] * 1.5;
  return inCourtyard(mx, mz) ? n : [-n[0], -n[1]];
}

/** Free runs of every edge between the gates: [edge, t0, t1, gate at t0, gate at t1]. */
function runs(): [number, number, number, boolean, boolean][] {
  const out: [number, number, number, boolean, boolean][] = [];
  for (let i = 0; i < COURTYARD.length; i++) {
    const { ax, az, len, ux, uz } = edge(i);
    const gaps: [number, number][] = [];
    for (const g of GATES) {
      const t = (g.x - ax) * ux + (g.z - az) * uz;
      const off = Math.abs(-(g.x - ax) * uz + (g.z - az) * ux);
      if (off < 1 && t > -g.width && t < len + g.width)
        gaps.push([t - g.width / 2, t + g.width / 2]);
    }
    let r: [number, number, boolean, boolean][] = [[0, len, false, false]];
    for (const [g0, g1] of gaps)
      r = r.flatMap(([r0, r1, s0, s1]): [number, number, boolean, boolean][] =>
        g1 <= r0 || g0 >= r1
          ? [[r0, r1, s0, s1]]
          : (
              [
                [r0, Math.max(r0, g0), s0, true],
                [Math.min(r1, g1), r1, true, s1],
              ] as [number, number, boolean, boolean][]
            ).filter(([a, b]) => b - a > 0.2),
      );
    for (const [r0, r1, s0, s1] of r) out.push([i, r0, r1, s0, s1]);
  }
  return out;
}

/**
 * The wall round the courtyard, cut into pieces (<= WALL.piece m, front panels <= FENCE.piece m), each level
 * on its highest ground: the low wall 0.3 m above it, the front fence's block base 0.9 m.
 */
export function wallPieces(
  ground: (x: number, z: number) => number,
): WallPiece[] {
  const out: WallPiece[] = [];
  for (const [i, r0, r1] of runs()) {
    const { ax, az, ux, uz } = edge(i);
    const front = FRONT_EDGES.includes(i);
    const k = Math.max(
      1,
      Math.ceil((r1 - r0) / (front ? FENCE.piece : WALL.piece)),
    );
    for (let j = 0; j < k; j++) {
      const t0 = r0 + ((r1 - r0) * j) / k;
      const t1 = r0 + ((r1 - r0) * (j + 1)) / k;
      const hs = [t0, (t0 + t1) / 2, t1].map((t) =>
        ground(ax + ux * t, az + uz * t),
      );
      out.push({
        x: ax + ux * ((t0 + t1) / 2),
        z: az + uz * ((t0 + t1) / 2),
        length: t1 - t0,
        angle: Math.atan2(uz, ux),
        y0: Math.min(...hs) - 0.3,
        y1: Math.max(...hs) + (front ? FENCE.base : WALL.height),
        front,
      });
    }
  }
  return out;
}

/** Pillars of the front fence: at both ends of every panel; the ones beside the gate are gate posts. */
export function fencePillars(
  ground: (x: number, z: number) => number,
): Pillar[] {
  const out: Pillar[] = [];
  const seen = new Set<string>();
  for (const [i, r0, r1, g0, g1] of runs()) {
    if (!FRONT_EDGES.includes(i)) continue;
    const { ax, az, ux, uz } = edge(i);
    const k = Math.max(1, Math.ceil((r1 - r0) / FENCE.piece));
    for (let j = 0; j <= k; j++) {
      const t = r0 + ((r1 - r0) * j) / k;
      const x = ax + ux * t;
      const z = az + uz * t;
      const key = `${x.toFixed(1)},${z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const gate = (j === 0 && g0) || (j === k && g1);
      // Highest ground of the panels either side, so the pillar tops the stepped base.
      const g = Math.max(
        ground(x, z),
        ground(x + ux * 1.5, z + uz * 1.5),
        ground(x - ux * 1.5, z - uz * 1.5),
      );
      out.push({
        x,
        z,
        angle: Math.atan2(uz, ux),
        y0: ground(x, z) - 0.6,
        y1: g + (gate ? FENCE.gatePillar : FENCE.pillar),
        gate,
      });
    }
  }
  return out;
}

/** The open iron gate: two leaves swung into the courtyard from the car park gate's posts. */
export function gateLeaves(): {
  x: number;
  z: number;
  angle: number;
  length: number;
}[] {
  const g = GATES[0];
  const { ux, uz } = edge(14);
  const [nx, nz] = inward(14);
  const length = g.width / 2 - 0.2;
  return [-1, 1].map((side) => {
    // Hinge just inside the post, the leaf pointing into the courtyard.
    const hx = g.x + ux * side * (g.width / 2 - 0.12) + nx * 0.3;
    const hz = g.z + uz * side * (g.width / 2 - 0.12) + nz * 0.3;
    return {
      x: hx + (nx * length) / 2,
      z: hz + (nz * length) / 2,
      angle: Math.atan2(nz, nx),
      length,
    };
  });
}

/**
 * The paved drive: from the car park gate (the asphalt apron outside it, `FORECOURT`), past the marquees, round to
 * the church's west door (control points, world x / z; smoothed and resampled by `drivePoints`).
 */
const DRIVE_CTRL: [number, number][] = [
  [1527.24, -544.77],
  [1525.5, -540.2],
  [1521.5, -532.5],
  [1515.5, -523],
  [1508.5, -516],
  [1502, -512],
  [1499.6, -507.5],
  [1502.6, -504.0],
];
export const DRIVE_WIDTH = 3.4;

let driveCache: [number, number][] | undefined;
/** The drive's centre line: Chaikin-smoothed control points resampled every ~1 m. */
export function drivePoints(): [number, number][] {
  if (driveCache) return driveCache;
  let pts = DRIVE_CTRL;
  for (let k = 0; k < 3; k++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = out[out.length - 1];
    const [bx, bz] = pts[i];
    if (Math.hypot(bx - ax, bz - az) >= 1 || i === pts.length - 1)
      out.push(pts[i]);
  }
  return (driveCache = out);
}

/** Distance from (x, z) to the drive's centre line. */
export function driveDistance(x: number, z: number): number {
  const pts = drivePoints();
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)),
    );
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/** Event marquees (5 x 5 m pagoda tents) with trestle tables, in front of the church (local +x = yaw). */
export const TENTS: { x: number; z: number; yaw: number }[] = [
  { x: 1510.5, z: -528.5, yaw: 0.74 },
  { x: 1505.0, z: -533.5, yaw: 0.74 },
];
export const TENT_HALF = 2.5;

/** Benches 1.2 m inside the east and west walls: [edge, metres along it]. */
const BENCH_SPOTS: [number, number][] = [
  [0, 12],
  [0, 22],
  [0, 32],
  [1, 6.5],
  [3, 8],
  [12, 7],
  [12, 15],
  [12, 22],
];

/** Benches: centre and yaw (local +x along the wall, the seat's front = local +z looks into the courtyard). */
export function benches(): { x: number; z: number; yaw: number }[] {
  return BENCH_SPOTS.map(([i, t]) => {
    const { ax, az, ux, uz } = edge(i);
    const [nx, nz] = inward(i);
    // A site yaw maps local +z to (-sin yaw, cos yaw): make that the inward normal.
    return {
      x: ax + ux * t + nx * 1.2,
      z: az + uz * t + nz * 1.2,
      yaw: Math.atan2(-nx, nz),
    };
  });
}

/** Trees here and there (rally assets): [asset, x, z, scale]. */
export const YARD_TREES: [string, number, number, number][] = [
  ['pine_tree', 1513, -547, 0.55],
  ['pine_tree', 1536, -536.5, 0.5],
  ['pine_tree', 1525, -515, 0.5],
  ['oak_tree', 1490, -526, 0.55],
  ['fruit_tree', 1486.5, -490, 0.8],
  ['birch_tree', 1498, -477, 0.7],
  ['fruit_tree', 1512, -486, 0.75],
  ['oak_tree', 1521, -506, 0.5],
  ['pine_tree', 1488, -500, 0.45],
];

/** Round flower beds round the church (photo ref-62), world x / z (from church-local positions). */
export const FLOWER_BEDS: [number, number][] = (
  [
    [-6, -5.8],
    [-1.5, -6.5],
    [3.5, -6],
    [9, -4.6],
    [9.2, 3.6],
    [2.5, 6.8],
  ] as const
).map(([x, z]) => toWorld(CHURCH, x, z));

/** Point in a polygon (even-odd). */
export function inPolygon(
  poly: [number, number][],
  x: number,
  z: number,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside;
}

/**
 * The gravel car park outside the gate, west of the asphalt apron between the end of the stage road and
 * the trees: traced by the user in lime on a top-down map viewer screenshot (`ref-64`); screenshot px ->
 * world by a similarity fit on the gate, the road end and the two marquees (0.11 m/px, residuals < 0.7 m).
 * (Superseded: an outline traced from the satellite screenshot `ref-50`, and OSM way 1395332287.)
 */
export const PARKING: [number, number][] = [
  [1549.09, -596.96],
  [1526.47, -609.38],
  [1521.91, -606.17],
  [1509.96, -590.39],
  [1507.13, -585.23],
  [1505.5, -580.41],
  [1507.41, -573.02],
  [1509.4, -569.26],
  [1512.18, -567.61],
  [1513.94, -565.5],
  [1522.64, -561.24],
  [1524.29, -561.47],
  [1522.86, -555.4],
  [1523.67, -554.33],
  [1524.99, -553.73],
  [1526.81, -554.5],
  [1527.09, -554.1],
  [1529.06, -561.14],
  [1532.46, -564.34],
  [1545.7, -587.78],
];

/**
 * The asphalt apron in front of the gate: 18 m along the front fence (centred on the gate), 8 m out
 * from it - the end of the stage road runs onto it. No junction barriers / marshals stand on it.
 */
export const FORECOURT: [number, number][] = (() => {
  const { ax, az, ux, uz } = edge(14);
  const [nx, nz] = inward(14);
  const g = GATES[0];
  const t = (g.x - ax) * ux + (g.z - az) * uz;
  const p = (s: number, out: number): [number, number] => [
    ax + ux * (t + s) - nx * out,
    az + uz * (t + s) - nz * out,
  ];
  return [p(-9, 0.1), p(9, 0.1), p(9, 8), p(-9, 8)];
})();
