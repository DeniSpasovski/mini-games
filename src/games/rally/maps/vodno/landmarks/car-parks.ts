import route from '../route.json';
import { placeAt, type Local, type V2, type V3 } from './common';
import {
  SREDNO_LOT,
  SREDNO_LOT_CENTRE,
  SREDNO_LOT_HW,
  toLocal,
  toWorld,
  VIDIKOVEC_LOT,
  VIDIKOVEC_LOT_CENTRE,
  VIDIKOVEC_LOT_HW,
  type Site,
} from './sites';

/**
 * The two big car parks on the stage road, ai-generated models (no road ribbons): the Sredno Vodno lot at the finish (a
 * long double-row lot with marked bays, kerbs and lamps) and the Vidikovec viewpoint lot beside the hairpin (a paved
 * terrace along the road: stone retaining wall, green railing, a few bays and the painted crosses). The asphalt is a
 * strip draped on the levelled ground (`flatAreas`, ../lots.ts); the road side is clamped to the road's edge.
 */
type Ground = (x: number, z: number) => number;

export interface Lot {
  /** The lot's frame: local x runs along the centre line. */
  site: Site;
  /** Centre line (local x, z), the "outer" side is +z of its direction of travel. */
  centre: V2[];
  /** Half width of the paved strip (m). */
  hw: number;
  /** Bays on the lot: depth (m), spacing (m), the share of the length (0..1) from the start, both sides? */
  bays?: {
    depth: number;
    pitch: number;
    from: number;
    to: number;
    both: boolean;
  };
  /** Stone retaining wall + green railing on the outer edge. */
  wall?: boolean;
  /** The strip's edge is clamped to the stage road's edge where it would lie on the road. */
  clampRoad?: boolean;
}

export const SREDNO: Lot = {
  site: SREDNO_LOT,
  centre: SREDNO_LOT_CENTRE,
  hw: SREDNO_LOT_HW,
  bays: { depth: 5.2, pitch: 2.5, from: 0.2, to: 0.97, both: true },
  clampRoad: true,
};
export const VIDIKOVEC: Lot = {
  site: VIDIKOVEC_LOT,
  centre: VIDIKOVEC_LOT_CENTRE,
  hw: VIDIKOVEC_LOT_HW,
  bays: { depth: 4.8, pitch: 2.6, from: 0.3, to: 0.8, both: false },
  wall: true,
};

/** Stage road edge (half width 3.2 + shoulder 0.6 + margin). */
const ROAD_EDGE = 4.2;
const ROUTE: number[][] = route.route;

/** Resample a polyline to points at most `step` apart. */
function resample(pts: V2[], step: number): V2[] {
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 1; k <= n; k++)
      out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  return out;
}

/** The edge of the centre line pushed sideways by `d` (+ = the outer side). */
function edge(centre: V2[], d: number): V2[] {
  return centre.map((p, i) => {
    const a = centre[Math.max(0, i - 1)];
    const b = centre[Math.min(centre.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * d, p[1] + ((b[0] - a[0]) / len) * d];
  });
}

/** Nearest point of the stage road's centre line to a world point: [x, z, distance]. */
function nearestRoad(x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [0, 0, Infinity];
  const R = ROUTE;
  for (let i = 1; i < R.length; i++) {
    const [x0, z0] = R[i - 1];
    const [x1, z1] = R[i];
    if (Math.abs(x - x0) > 200 || Math.abs(z - z0) > 200) continue;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const t = Math.max(
      0,
      Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)),
    );
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best[2]) best = [px, pz, d];
  }
  return best;
}

/** The lot's strip: centre line and both long edges (local x, z); where it opens onto the road the edges run on to its edge. */
export function lotEdges(lot: Lot): { centre: V2[]; left: V2[]; right: V2[] } {
  const { site, hw } = lot;
  const centre = resample(lot.centre, 2);
  const left = edge(centre, -hw);
  const right = edge(centre, hw);
  if (lot.clampRoad)
    for (const side of [left, right]) {
      const p = side[0];
      const q = side[1];
      const len = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      const dx = (p[0] - q[0]) / len;
      const dz = (p[1] - q[1]) / len;
      let x = p[0];
      let z = p[1];
      for (let i = 0; i < 40; i++) {
        const [wx, wz] = toWorld(site, x, z);
        if (nearestRoad(wx, wz)[2] <= ROAD_EDGE) break;
        x += dx * 0.25;
        z += dz * 0.25;
      }
      side.unshift([x, z]);
    }
  return { centre, left, right };
}

/** The lot's outline in world metres, flat [x0, z0, x1, z1, ...] (a terrain pad polygon). */
export function lotPolygon(lot: Lot): number[] {
  const { left, right } = lotEdges(lot);
  return [...left, ...right.slice().reverse()].flatMap(([x, z]) =>
    toWorld(lot.site, x, z),
  );
}

/** True when the world point lies on the lot's paving. */
export function onLot(lot: Lot, x: number, z: number): boolean {
  const { left, right } = lotEdges(lot);
  const [lx, lz] = toLocal(lot.site, x, z);
  const poly = [...left, ...right.slice().reverse()];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[j];
    if (az > lz !== bz > lz && lx < ((bx - ax) * (lz - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside;
}

export function buildLot(l: Local, lot: Lot, ground: Ground): void {
  const { site, hw } = lot;
  const baseY = ground(site.x, site.z);
  const { centre, left, right } = lotEdges(lot);
  const y = (p: V2, dy = 0.12): number => {
    const [wx, wz] = toWorld(site, p[0], p[1]);
    return ground(wx, wz) - baseY + dy;
  };
  const up: V3 = [0, 1, 0];
  const quad = (
    key: 'asphalt' | 'marking' | 'concrete',
    pts: V2[],
    color: string,
    dy: number,
  ): void =>
    l.fan(
      key,
      pts.map((p): V3 => [p[0], y(p, dy), p[1]]),
      color,
      up,
      (p) => [p[0], p[2]],
    );

  // The asphalt strip.
  const K = 4;
  const row = (i: number, k: number): V2 => [
    left[i][0] + ((right[i][0] - left[i][0]) * k) / K,
    left[i][1] + ((right[i][1] - left[i][1]) * k) / K,
  ];
  for (let i = 0; i + 1 < left.length; i++)
    for (let k = 0; k < K; k++)
      quad(
        'asphalt',
        [row(i, k), row(i + 1, k), row(i + 1, k + 1), row(i, k + 1)],
        '#b4b4b0',
        0.12,
      );

  // Kerb along both long edges (concrete, 14 cm), but not where the lot opens onto the road.
  for (const side of [left, right]) {
    for (let i = 0; i + 1 < side.length; i++) {
      const a = side[i];
      const b = side[i + 1];
      if (lot.clampRoad && i === 0) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const yaw = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      l.box(
        'concrete',
        [-len / 2 - 0.03, -0.1, -0.15],
        [len / 2 + 0.03, 0.14, 0.15],
        '#d2d0ca',
        placeAt(
          (a[0] + b[0]) / 2,
          Math.min(y(a), y(b)),
          (a[1] + b[1]) / 2,
          yaw,
        ),
      );
    }
  }

  // Marked bays: a white line every `pitch`, depth `depth` from the edge, and the line closing the bays.
  const bays = lot.bays;
  if (bays) {
    const line = (a: V2, b: V2, w: number): void => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (-(b[1] - a[1]) / len) * (w / 2);
      const nz = ((b[0] - a[0]) / len) * (w / 2);
      quad(
        'marking',
        [
          [a[0] - nx, a[1] - nz],
          [b[0] - nx, b[1] - nz],
          [b[0] + nx, b[1] + nz],
          [a[0] + nx, a[1] + nz],
        ],
        '#f1f1ec',
        0.14,
      );
    };
    const total = centre.reduce(
      (s, p, i) =>
        i
          ? s + Math.hypot(p[0] - centre[i - 1][0], p[1] - centre[i - 1][1])
          : 0,
      0,
    );
    // The centre line sampled at distance s along it.
    const sample = (s: number): { p: V2; n: V2 } => {
      let acc = 0;
      for (let i = 1; i < centre.length; i++) {
        const seg = Math.hypot(
          centre[i][0] - centre[i - 1][0],
          centre[i][1] - centre[i - 1][1],
        );
        if (acc + seg >= s || i === centre.length - 1) {
          const t = Math.min(1, Math.max(0, (s - acc) / (seg || 1)));
          const p: V2 = [
            centre[i - 1][0] + (centre[i][0] - centre[i - 1][0]) * t,
            centre[i - 1][1] + (centre[i][1] - centre[i - 1][1]) * t,
          ];
          return {
            p,
            n: [
              -(centre[i][1] - centre[i - 1][1]) / (seg || 1),
              (centre[i][0] - centre[i - 1][0]) / (seg || 1),
            ],
          };
        }
        acc += seg;
      }
      return { p: centre[0], n: [0, 1] };
    };
    const sides = bays.both ? [-1, 1] : [1];
    for (const sd of sides) {
      const inner = hw - 0.35 - bays.depth;
      const outer = hw - 0.35;
      const s0 = bays.from * total;
      const s1 = bays.to * total;
      for (let s = s0; s <= s1 + 0.01; s += bays.pitch) {
        const { p, n } = sample(s);
        line(
          [p[0] + n[0] * sd * inner, p[1] + n[1] * sd * inner],
          [p[0] + n[0] * sd * outer, p[1] + n[1] * sd * outer],
          0.11,
        );
      }
      // The line closing the bays (along the lot).
      let prev: V2 | undefined;
      for (let s = s0; s <= s1 + 0.01; s += 3) {
        const { p, n } = sample(Math.min(s, s1));
        const q: V2 = [p[0] + n[0] * sd * inner, p[1] + n[1] * sd * inner];
        if (prev) line(prev, q, 0.11);
        prev = q;
      }
    }
  }

  // Stone retaining wall and a green railing on the outer edge.
  if (lot.wall) {
    const out = edge(centre, hw + 0.35);
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i];
      const b = out[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const yaw = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const lo = Math.min(y(a, 0), y(b, 0));
      const hi = Math.max(y(a, 0), y(b, 0));
      const piece = (
        key: 'rubble' | 'paint',
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        color: string,
      ): void =>
        l.box(
          key,
          [x0, y0, z0],
          [x1, y1, z1],
          color,
          placeAt(mid[0], 0, mid[1], yaw),
        );
      // Wall: 75 cm over the higher end, sunk into the slope below.
      piece(
        'rubble',
        -len / 2 - 0.03,
        lo - 1.2,
        -0.3,
        len / 2 + 0.03,
        hi + 0.75,
        0.3,
        '#ddd7ca',
      );
      // Railing: two rails and a post, standing on the wall.
      for (const h of [0.4, 0.9])
        piece(
          'paint',
          -len / 2,
          hi + 0.75 + h - 0.03,
          -0.03,
          len / 2,
          hi + 0.75 + h + 0.03,
          0.03,
          '#2f7a45',
        );
      piece(
        'paint',
        -len / 2 - 0.03,
        hi + 0.75,
        -0.04,
        -len / 2 + 0.03,
        hi + 1.75,
        0.04,
        '#2f7a45',
      );
    }
  }
}
