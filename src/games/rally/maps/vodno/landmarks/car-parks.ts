import type { StaticCollider } from '../../../physics/types';
import {
  placeAt,
  turnedBoxCollider,
  type Local,
  type V2,
  type V3,
} from './common';
import { strut } from './park';
import { wallRibbon } from './stone-wall';
import { LOT_ROADS } from './lot-road';
import {
  SREDNO_BUS_CENTRE,
  SREDNO_BUS_LOT,
  SREDNO_BUS_WIDTHS,
  SREDNO_LOT,
  SREDNO_LOT_CENTRE,
  SREDNO_LOT_HW,
  SREDNO_LOT_WIDTHS,
  toLocal,
  toWorld,
  VIDIKOVEC_LOT,
  VIDIKOVEC_LOT_CENTRE,
  VIDIKOVEC_LOT_HW,
  type Site,
} from './sites';

/**
 * The two big car parks on the stage road, ai-generated objects: the Sredno Vodno lot at the finish (a double-row lot
 * with marked bays that narrows towards its top end) and the Vidikovec viewpoint lot beside the hairpin (a paved terrace
 * along the road: stone retaining wall all round, green railing, a few bays and the painted crosses).
 *
 * Each lot is a slab: the asphalt top `SLAB` above the levelled ground (the terrain pad, ../lots.ts, lies that much
 * under the road's level), a solid edge (kerb or retaining wall) that runs well below the ground so the terrain never
 * shows through, and the car drives on its top (`slabHeight`). The stage road has priority: the lot's edge stays
 * `ROAD_CLEAR` from its centre line, the part of a lot that would lie on the road is cut away.
 */
type Ground = (x: number, z: number) => number;

export interface Lot {
  /** The lot's frame: local x runs along the centre line. */
  site: Site;
  /** Centre line (local x, z), the "outer" side is +z of its direction of travel. */
  centre: V2[];
  /** Half width of the paved strip (m), unless `widths` gives one per centre point (an irregular lot). */
  hw: number;
  widths?: number[];
  /**
   * Bays on the lot: depth (m), spacing (m), the share of the length (0..1) from the start, both sides? `middle` = a
   * back-to-back double row (two lanes of bays) down the middle, over that share of the length, where each side still
   * has an aisle of at least `aisle` m between it and the bays at the edge.
   */
  bays?: {
    depth: number;
    pitch: number;
    from: number;
    to: number;
    both: boolean;
    middle?: { from: number; to: number; aisle: number };
    /** Bays start only where both long edges run straight and parallel (the road-cut east end of a straight band has none). */
    straight?: boolean;
  };
  /** Stone retaining wall + green railing all round (else a kerb). */
  wall?: boolean;
  /** How far under the slab's top the wall runs (m), default 1.4: deeper where a lowered garden lies beside it. */
  wallDepth?: number;
  /** Stairs down through the wall at this share (0..1) of the outer edge's length: the wall and its railing open there. */
  stairsAt?: number;
  /** Thickness of the wall (m), default 0.6: a thick one hides the ground's step down to a lowered garden; its railing then stands on its outer edge. */
  wallThick?: number;
}

export const SREDNO: Lot = {
  site: SREDNO_LOT,
  centre: SREDNO_LOT_CENTRE,
  hw: SREDNO_LOT_HW,
  widths: SREDNO_LOT_WIDTHS,
  bays: {
    depth: 5.2,
    pitch: 2.5,
    from: 0.3,
    to: 0.95,
    both: true,
    middle: { from: 0.3, to: 0.9, aisle: 6 },
    straight: true,
  },
};
export const SREDNO_BUS: Lot = {
  site: SREDNO_BUS_LOT,
  centre: SREDNO_BUS_CENTRE,
  hw: 6,
  widths: SREDNO_BUS_WIDTHS,
  bays: {
    depth: 4.4,
    pitch: 2.5,
    from: 0.25,
    to: 0.9,
    both: true,
    straight: true,
  },
};
export const VIDIKOVEC: Lot = {
  site: VIDIKOVEC_LOT,
  centre: VIDIKOVEC_LOT_CENTRE,
  hw: VIDIKOVEC_LOT_HW,
  bays: { depth: 4.8, pitch: 2.6, from: 0.3, to: 0.8, both: false },
  wall: true,
  // The lowered garden north of it (lot-park.ts `GARDEN`) is 3 m under the lot: a thick rock wall, straight down, holds that back
  // (and hides the ground's step beside it, so the slab's own ground is never touched).
  wallDepth: 3.4,
  wallThick: 1.5,
  stairsAt: 0.2,
};

/** Thickness of the slab above the levelled ground (m): the terrain pad lies this far under the lot's top. */
export const SLAB = 0.2;
/** Stage road centre line -> the lot's edge on the road side (half width 2.9 + shoulder 0.6 + a gap, m). */
const ROAD_CLEAR = 3.6;
/** A lot's edge this close to the road (m) is its open road side: no kerb or wall. */
const ROAD_SIDE = ROAD_CLEAR + 2;

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

/** The stage road's centre line nearest to a world point. */
interface RoadHit {
  x: number;
  z: number;
  /** Distance to it (m). */
  d: number;
  /** Unit tangent there. */
  tx: number;
  tz: number;
  /** Signed offset of the point across the road (+ = on the side of the normal (-tz, tx)). */
  lat: number;
}

function nearestRoad(x: number, z: number): RoadHit {
  let best: RoadHit = { x: 0, z: 0, d: Infinity, tx: 1, tz: 0, lat: 0 };
  for (const R of LOT_ROADS)
    for (let i = 2; i < R.length; i += 2) {
      const x0 = R[i - 2];
      const z0 = R[i - 1];
      if (Math.abs(x - x0) > 120 || Math.abs(z - z0) > 120) continue;
      const dx = R[i] - x0;
      const dz = R[i + 1] - z0;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(
        0,
        Math.min(1, ((x - x0) * dx + (z - z0) * dz) / len2),
      );
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.d) {
        const len = Math.sqrt(len2);
        best = {
          x: px,
          z: pz,
          d,
          tx: dx / len,
          tz: dz / len,
          lat: (-dz / len) * (x - px) + (dx / len) * (z - pz),
        };
      }
    }
  return best;
}

/** The lot's outline: `centre` and both long edges (local x, z, same length), the road side kept ROAD_CLEAR off the road. */
export interface LotShape {
  centre: V2[];
  left: V2[];
  right: V2[];
  /** Half width at each row (after the road clamp). */
  hl: number[];
  hr: number[];
  /** Distance of each edge point to the stage road centre line (m). */
  dl: number[];
  dr: number[];
}

/**
 * The strip of a lot: its centre line and edges. `grow` widens it on every side but the road's (the terrain pad that
 * levels the ground round the slab, ../lots.ts). Where an edge would lie closer than ROAD_CLEAR to the stage road it is
 * pushed out to it, and the rows of the strip that lie on the road (a lot that ends at a hairpin) are cut off.
 */
export function lotShape(lot: Lot, grow = 0): LotShape {
  if (grow) return computeShape(lot, grow);
  let shape = slabShapes.get(lot);
  if (!shape) slabShapes.set(lot, (shape = computeShape(lot, 0)));
  return shape;
}

const slabShapes = new Map<Lot, LotShape>();

/** `resample` that carries a width per point (interpolated). */
function resampleWidths(
  pts: V2[],
  ws: number[],
  step: number,
): { pts: V2[]; ws: number[] } {
  const out = { pts: [pts[0]], ws: [ws[0]] };
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 1; k <= n; k++) {
      out.pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
      out.ws.push(ws[i - 1] + ((ws[i] - ws[i - 1]) * k) / n);
    }
  }
  return out;
}

function computeShape(lot: Lot, grow: number): LotShape {
  const { site } = lot;
  let centre: V2[];
  let widths: number[] | undefined;
  if (lot.widths) {
    const r = resampleWidths(lot.centre, lot.widths, 2);
    centre = r.pts;
    widths = r.ws;
  } else centre = resample(lot.centre, 2);
  if (grow > 0) {
    // The ends run on by `grow` along their direction.
    const a = centre[0];
    const b = centre[1];
    const y = centre[centre.length - 2];
    const z = centre[centre.length - 1];
    const l0 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const l1 = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
    centre = [
      [a[0] + ((a[0] - b[0]) / l0) * grow, a[1] + ((a[1] - b[1]) / l0) * grow],
      ...centre,
      [z[0] + ((z[0] - y[0]) / l1) * grow, z[1] + ((z[1] - y[1]) / l1) * grow],
    ];
    if (widths) widths = [widths[0], ...widths, widths[widths.length - 1]];
  }
  /** The slab's half width at each row (the pad's is `grow` more). */
  const slabHw = centre.map((_, i) => (widths ? widths[i] : lot.hw));
  const side = (sign: 1 | -1, extra: number): V2[] =>
    centre.map((p, i) => {
      const a = centre[Math.max(0, i - 1)];
      const b = centre[Math.min(centre.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const d = sign * (slabHw[i] + extra);
      return [
        p[0] - ((b[1] - a[1]) / len) * d,
        p[1] + ((b[0] - a[0]) / len) * d,
      ];
    });
  let left = side(-1, grow);
  let right = side(1, grow);
  const hit = (p: V2): RoadHit => {
    const [wx, wz] = toWorld(site, p[0], p[1]);
    return nearestRoad(wx, wz);
  };
  const dist = (p: V2): number => hit(p).d;
  // Rows that lie on the road (the end of a lot at a bend) go: judged by the slab's own edges, not the pad's.
  const slabLeft = grow ? side(-1, 0) : left;
  const slabRight = grow ? side(1, 0) : right;
  const onRoad = (i: number): boolean =>
    Math.min(dist(slabLeft[i]), dist(slabRight[i])) < ROAD_CLEAR * 0.6;
  let k0 = 0;
  let k1 = centre.length - 1;
  while (k0 < k1 - 2 && onRoad(k0)) k0++;
  while (k1 > k0 + 2 && onRoad(k1)) k1--;
  centre = centre.slice(k0, k1 + 1);
  left = left.slice(k0, k1 + 1);
  right = right.slice(k0, k1 + 1);
  // The lot lies on one side of the road: where most of its centre line is. An edge that is closer to the road than
  // ROAD_CLEAR, or across it, is put back on the lot's side at ROAD_CLEAR (the stage road has priority).
  let votes = 0;
  for (const p of centre) {
    const h = hit(p);
    if (h.d > 1 && h.d < 60) votes += Math.sign(h.lat);
  }
  const lotSide = votes >= 0 ? 1 : -1;
  const clamp = (p: V2): V2 => {
    const h = hit(p);
    // (a point across the road is brought back whatever its distance: a straight band that meets the road at an angle
    // runs far across it, and its end then follows the road)
    if (lotSide * h.lat >= ROAD_CLEAR) return p;
    if (h.d > ROAD_CLEAR * 2.5 && lotSide * h.lat > 0) return p;
    return toLocal(
      site,
      h.x + lotSide * ROAD_CLEAR * -h.tz,
      h.z + lotSide * ROAD_CLEAR * h.tx,
    ) as V2;
  };
  left = left.map(clamp);
  right = right.map(clamp);
  // Where a clamped edge squeezes the strip it narrows (the lot's start along the road); rows under 2.5 m wide at the ends go.
  const width = (i: number): number =>
    Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1]);
  let j0 = 0;
  let j1 = left.length - 1;
  while (j0 < j1 - 2 && width(j0) < 2.5) j0++;
  while (j1 > j0 + 2 && width(j1) < 2.5) j1--;
  left = left.slice(j0, j1 + 1);
  right = right.slice(j0, j1 + 1);
  // The centre line follows the squeezed strip.
  centre = left.map((p, i): V2 => [
    (p[0] + right[i][0]) / 2,
    (p[1] + right[i][1]) / 2,
  ]);
  const half = left.map((_, i) => width(i) / 2);
  return {
    centre,
    left,
    right,
    hl: half,
    hr: half,
    dl: left.map(dist),
    dr: right.map(dist),
  };
}

/** Where a lot's stairs through its wall start: the vertex `k` of the outer (+z) edge, its tangent and outward normal (local frame). */
export function stairsAnchor(
  lot: Lot,
): { p: V2; t: V2; n: V2; k: number; width: number } | undefined {
  if (lot.stairsAt === undefined) return undefined;
  const { right } = lotShape(lot);
  const k = Math.min(
    right.length - 2,
    Math.max(1, Math.round(lot.stairsAt * (right.length - 1))),
  );
  const dx = right[k + 1][0] - right[k - 1][0];
  const dz = right[k + 1][1] - right[k - 1][1];
  const len = Math.hypot(dx, dz) || 1;
  const t: V2 = [dx / len, dz / len];
  // (the opening in the wall is the two edges either side of vertex k: the stairs are as wide as that)
  return { p: right[k], t, n: [-t[1], t[0]], k, width: len };
}

/** The lot's outline in world metres, flat [x0, z0, x1, z1, ...] (the slab, or with `grow` the terrain pad round it). */
export function lotPolygon(lot: Lot, grow = 0): number[] {
  const { left, right } = lotShape(lot, grow);
  return [...left, ...right.slice().reverse()].flatMap(([x, z]) =>
    toWorld(lot.site, x, z),
  );
}

const inPolygon = (poly: V2[], lx: number, lz: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[j];
    if (az > lz !== bz > lz && lx < ((bx - ax) * (lz - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside;
};

const outlines = new Map<Lot, V2[]>();
const slabOutline = (lot: Lot): V2[] => {
  let poly = outlines.get(lot);
  if (!poly) {
    const { left, right } = lotShape(lot);
    outlines.set(lot, (poly = [...left, ...right.slice().reverse()]));
  }
  return poly;
};

/** True when the world point lies on the lot's slab. */
export function onLot(lot: Lot, x: number, z: number): boolean {
  const [lx, lz] = toLocal(lot.site, x, z);
  return inPolygon(slabOutline(lot), lx, lz);
}

/** One run of a lot's rock wall: the outline's points, the unit normal to the outer side at each, and whether it carries the railing. */
export interface WallRun {
  p: V2[];
  n: V2[];
  rail: boolean;
}

/** A cap across the strip's end is open (no kerb, no wall) where it meets the road: a narrow mouth, or a cap that runs along the road. */
function capOpenOf(shape: LotShape, i: number): boolean {
  const { left, right, dl, dr } = shape;
  return (
    (Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1]) < 9 &&
      Math.min(dl[i], dr[i]) < ROAD_SIDE) ||
    Math.max(dl[i], dr[i]) < ROAD_SIDE + 3
  );
}

/**
 * The runs of a walled lot's rock wall (pure, shared by the drawing and the colliders): one along each long edge - the road
 * side is open, the outer edge opens where the stairs go down - and the end caps, which run on past the corners so the corner
 * squares are solid.
 */
export function wallRuns(lot: Lot): WallRun[] {
  if (!lot.wall) return [];
  const shape = lotShape(lot);
  const { centre, left, right, dl, dr } = shape;
  const n = centre.length;
  const OUT = 0.05 + (lot.wallThick ?? 0.6);
  const stairs = stairsAnchor(lot);
  const capOpen = (i: number): boolean => capOpenOf(shape, i);
  const runs: WallRun[] = [];
  const unit = (x: number, z: number): V2 => {
    const k = Math.hypot(x, z) || 1;
    return [x / k, z / k];
  };
  for (const [pts, d, s] of [
    [left, dl, -1],
    [right, dr, 1],
  ] as const) {
    let from = -1;
    const close = (to: number): void => {
      if (from >= 0 && to - from >= 1) {
        const seg: V2[] = [];
        for (let i = from; i < to; i++)
          seg.push(
            unit(
              -(pts[i + 1][1] - pts[i][1]) * s,
              (pts[i + 1][0] - pts[i][0]) * s,
            ),
          );
        runs.push({
          p: pts.slice(from, to + 1),
          n: seg.length
            ? Array.from({ length: to - from + 1 }, (_, k) =>
                k === 0
                  ? seg[0]
                  : k === seg.length
                    ? seg[k - 1]
                    : unit(
                        seg[k - 1][0] + seg[k][0],
                        seg[k - 1][1] + seg[k][1],
                      ),
              )
            : [],
          rail: true,
        });
      }
      from = -1;
    };
    for (let i = 0; i + 1 < n; i++) {
      const open =
        (d[i] < ROAD_SIDE && d[i + 1] < ROAD_SIDE) ||
        (s === 1 &&
          stairs !== undefined &&
          (i === stairs.k || i + 1 === stairs.k));
      if (open) close(i);
      else if (from < 0) from = i;
    }
    close(n - 1);
  }
  for (const [i, j] of [
    [0, 1],
    [n - 1, n - 2],
  ] as const) {
    const w = Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1]);
    // (a cap that meets the road is the lot's mouth: open)
    if (capOpen(i)) continue;
    const out = unit(centre[i][0] - centre[j][0], centre[i][1] - centre[j][1]);
    const along = unit(right[i][0] - left[i][0], right[i][1] - left[i][1]);
    const m = Math.max(1, Math.ceil(w / 2));
    const p: V2[] = [];
    if (!(dl[i] < ROAD_SIDE && dl[j] < ROAD_SIDE))
      p.push([left[i][0] - along[0] * OUT, left[i][1] - along[1] * OUT]);
    for (let k = 0; k <= m; k++)
      p.push([
        left[i][0] + ((right[i][0] - left[i][0]) * k) / m,
        left[i][1] + ((right[i][1] - left[i][1]) * k) / m,
      ]);
    if (!(dr[i] < ROAD_SIDE && dr[j] < ROAD_SIDE))
      p.push([right[i][0] + along[0] * OUT, right[i][1] + along[1] * OUT]);
    runs.push({ p, n: p.map(() => out), rail: false });
  }
  return runs;
}

export function buildLot(l: Local, lot: Lot, ground: Ground): void {
  const { site } = lot;
  const baseY = ground(site.x, site.z);
  const { centre, left, right, hl, hr, dl, dr } = lotShape(lot);
  const n = centre.length;
  /** Height of a local point: the ground (the levelled pad) + dy, relative to the site. */
  const y = (p: V2, dy = SLAB): number => {
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
  for (let i = 0; i + 1 < n; i++)
    for (let k = 0; k < K; k++)
      quad(
        'asphalt',
        [row(i, k), row(i + 1, k), row(i + 1, k + 1), row(i, k + 1)],
        '#b4b4b0',
        SLAB,
      );

  // The edge of the slab: a segment of the outline [a, b] (local), outward = away from the centre line.
  interface Edge {
    a: V2;
    b: V2;
    /** Outward unit normal (local). */
    nx: number;
    nz: number;
    /** The open road side: no kerb, no wall. */
    open: boolean;
    /** A cap across the strip's end: a wall without railing. */
    cap: boolean;
  }
  /**
   * A cap across the strip's end is open (no kerb, no wall) where it meets the road: a narrow mouth, or a cap that runs along the
   * road (the wide strip cut by it: both its ends within a few metres of the road's edge).
   */
  const shape = lotShape(lot);
  const capOpen = (i: number): boolean => capOpenOf(shape, i);
  const edges: Edge[] = [];
  const push = (
    a: V2,
    b: V2,
    nx: number,
    nz: number,
    open: boolean,
    cap: boolean,
  ) => edges.push({ a, b, nx, nz, open, cap });
  for (let i = 0; i + 1 < n; i++) {
    for (const [pts, d, s] of [
      [left, dl, -1],
      [right, dr, 1],
    ] as const) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // Normal of the edge pointing away from the centre line (s = +1: the +z side).
      push(
        a,
        b,
        (-(b[1] - a[1]) / len) * s,
        ((b[0] - a[0]) / len) * s,
        d[i] < ROAD_SIDE && d[i + 1] < ROAD_SIDE,
        false,
      );
    }
  }
  for (const [i, j] of [
    [0, 1],
    [n - 1, n - 2],
  ] as const) {
    // The cap runs across the strip at its end, facing away along the centre line.
    const tx = centre[i][0] - centre[j][0];
    const tz = centre[i][1] - centre[j][1];
    const tl = Math.hypot(tx, tz) || 1;
    const mouth = capOpen(i);
    // In pieces of about 2 m, so the kerb follows the ground across the strip.
    const w = Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1]);
    const m = Math.max(1, Math.ceil(w / 2));
    const at = (k: number): V2 => [
      left[i][0] + ((right[i][0] - left[i][0]) * k) / m,
      left[i][1] + ((right[i][1] - left[i][1]) * k) / m,
    ];
    for (let k = 0; k < m; k++)
      push(at(k), at(k + 1), tx / tl, tz / tl, mouth, true);
  }

  const piece = (
    key: 'concrete' | 'rubble' | 'paint',
    mid: V2,
    yaw: number,
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
  /**
   * The rock wall of a walled lot: one continuous ribbon along each run of its outline (the long edges - the road side is
   * open, the outer edge opens where the stairs go down - and the end caps), its faces and top sloping with the ground
   * (smoothed: no steps, no cracks at curves), sunk `wallDepth` under the slab, a green railing on the outer edge of the
   * top (not on the caps). The caps run on past the corners, so the corner squares are solid.
   */
  const drawWall = (): void => {
    const T = lot.wallThick ?? 0.6;
    const IN = 0.05;
    const OUT = IN + T;
    const depth = lot.wallDepth ?? 1.4;
    const runs = wallRuns(lot);
    for (const run of runs) {
      const m = run.p.length;
      if (m < 2) continue;
      const at = (k: number, o: number): V2 => [
        run.p[k][0] + run.n[k][0] * o,
        run.p[k][1] + run.n[k][1] * o,
      ];
      // Heights: the top 55 cm over the slab's level at the outline vertex (shared by a cap and the edge it meets), smoothed twice; the foot under the lower of the
      // two faces, the lowest of the neighbours.
      const smooth = (v: number[]): number[] =>
        v.map((x, k) =>
          k === 0 || k === m - 1 ? x : (v[k - 1] + 2 * x + v[k + 1]) / 4,
        );
      const hi = smooth(smooth(run.p.map((q) => y(q) + 0.55)));
      const foot = run.p.map(
        (_, k) => Math.min(y(at(k, IN)), y(at(k, OUT))) - depth,
      );
      const lo = foot.map((v, k) =>
        Math.min(v, foot[Math.max(0, k - 1)], foot[Math.min(m - 1, k + 1)]),
      );
      wallRibbon(l, { p: run.p, n: run.n, hi, lo, inner: IN, outer: OUT });
      if (!run.rail) continue;
      // The railing: a post at every vertex, two rails sloping with the top; on the outer edge of a thick wall.
      const ro = T > 0.6 ? OUT - 0.2 : IN + T / 2;
      const post = (k: number, h: number): V3 => {
        const q = at(k, ro);
        return [q[0], hi[k] + h, q[1]];
      };
      for (let k = 0; k < m; k++)
        strut(l, post(k, 0), post(k, 1), 0.07, 'paint', '#2f7a45');
      for (let k = 0; k + 1 < m; k++)
        for (const h of [0.5, 0.95])
          strut(l, post(k, h), post(k + 1, h), 0.06, 'paint', '#2f7a45');
    }
  };

  // Kerbs: a solid edge from well under the ground to 14 cm over the asphalt.
  if (lot.wall) drawWall();
  else
    for (const e of edges) {
      if (e.open) continue;
      const a: V2 = [e.a[0] + e.nx * 0.15, e.a[1] + e.nz * 0.15];
      const b: V2 = [e.b[0] + e.nx * 0.15, e.b[1] + e.nz * 0.15];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const ya = y(a);
      const yb = y(b);
      piece(
        'concrete',
        [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        -Math.atan2(b[1] - a[1], b[0] - a[0]),
        -len / 2 - 0.03,
        Math.min(ya, yb) - (lot.wallDepth ?? 1.4),
        -0.15,
        len / 2 + 0.03,
        Math.max(ya, yb) + 0.14,
        0.15,
        '#d2d0ca',
      );
    }

  // The open road side: a short bevel of asphalt from the slab's edge to the ground beside it (the road's shoulder), so the lot
  // levels out into the road's level - from higher to lower terrain or the other way - without a lip. The road is drawn over it.
  const BEVEL = 0.9;
  const mid = centre[n >> 1];
  for (const e of edges) {
    if (!e.open) continue;
    let [nx, nz] = [e.nx, e.nz];
    if (e.cap) {
      const dx = e.b[0] - e.a[0];
      const dz = e.b[1] - e.a[1];
      const len = Math.hypot(dx, dz) || 1;
      nx = -dz / len;
      nz = dx / len;
      // (the side away from the lot's middle)
      if (
        ((e.a[0] + e.b[0]) / 2 - mid[0]) * nx +
          ((e.a[1] + e.b[1]) / 2 - mid[1]) * nz <
        0
      ) {
        nx = -nx;
        nz = -nz;
      }
    }
    const a2: V2 = [e.a[0] + nx * BEVEL, e.a[1] + nz * BEVEL];
    const b2: V2 = [e.b[0] + nx * BEVEL, e.b[1] + nz * BEVEL];
    l.fan(
      'asphalt',
      [
        [e.a[0], y(e.a, SLAB), e.a[1]],
        [e.b[0], y(e.b, SLAB), e.b[1]],
        [b2[0], y(b2, 0.04), b2[1]],
        [a2[0], y(a2, 0.04), a2[1]],
      ],
      '#b4b4b0',
      up,
      (q) => [q[0], q[2]],
    );
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
        SLAB + 0.02,
      );
    };
    const cum = centre.map((_, i) =>
      centre
        .slice(1, i + 1)
        .reduce(
          (s, p, k) => s + Math.hypot(p[0] - centre[k][0], p[1] - centre[k][1]),
          0,
        ),
    );
    const total = cum[n - 1];
    // The strip at distance s along the centre line: the point, the normal (+z side) and the half widths there.
    const sample = (s: number): { p: V2; n: V2; hl: number; hr: number } => {
      let i = 1;
      while (i < n - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
      const mix = (a: number, b: number): number => a + (b - a) * t;
      return {
        p: [
          mix(centre[i - 1][0], centre[i][0]),
          mix(centre[i - 1][1], centre[i][1]),
        ],
        n: [
          -(centre[i][1] - centre[i - 1][1]) / seg,
          (centre[i][0] - centre[i - 1][0]) / seg,
        ],
        hl: mix(hl[i - 1], hl[i]),
        hr: mix(hr[i - 1], hr[i]),
      };
    };
    const sides = bays.both ? [-1, 1] : [1];
    // The first station from which both edges stay on the far end's lines (within 5 cm): the bays begin 1.2 m past it.
    let straightS = 0;
    if (bays.straight) {
      const zl = left[n - 1][1];
      const zr = right[n - 1][1];
      let k = n - 1;
      while (
        k > 0 &&
        Math.abs(left[k - 1][1] - zl) < 0.05 &&
        Math.abs(right[k - 1][1] - zr) < 0.05
      )
        k--;
      straightS = cum[k] + 1.2;
    }
    for (const sd of sides) {
      const s0 = Math.max(bays.from * total, straightS);
      const s1 = bays.to * total;
      const bounds = (
        at: ReturnType<typeof sample>,
      ): [number, number] | null => {
        const h = (sd < 0 ? at.hl : at.hr) - 0.35;
        const inner = h - bays.depth;
        return inner < 1.6 ? null : [inner, h];
      };
      for (let s = s0; s <= s1 + 0.01; s += bays.pitch) {
        const at = sample(s);
        const b = bounds(at);
        if (!b) continue;
        line(
          [at.p[0] + at.n[0] * sd * b[0], at.p[1] + at.n[1] * sd * b[0]],
          [at.p[0] + at.n[0] * sd * b[1], at.p[1] + at.n[1] * sd * b[1]],
          0.11,
        );
      }
      // The line closing the bays (along the lot).
      let prev: V2 | undefined;
      for (let s = s0; s <= s1 + 0.01; s += 3) {
        const at = sample(Math.min(s, s1));
        const b = bounds(at);
        if (!b) {
          prev = undefined;
          continue;
        }
        const q: V2 = [
          at.p[0] + at.n[0] * sd * b[0],
          at.p[1] + at.n[1] * sd * b[0],
        ];
        if (prev) line(prev, q, 0.11);
        prev = q;
      }
    }
    // The two middle lanes: lines across both rows, a line along each outer edge and one between the rows.
    const mid = bays.middle;
    if (mid) {
      const room = (at: ReturnType<typeof sample>): boolean =>
        Math.min(at.hl, at.hr) -
          0.35 -
          (bays.both ? bays.depth : 0) -
          bays.depth >=
        mid.aisle;
      const across = (at: ReturnType<typeof sample>, d: number): V2 => [
        at.p[0] + at.n[0] * d,
        at.p[1] + at.n[1] * d,
      ];
      const s0 = mid.from * total;
      const s1 = mid.to * total;
      for (let s = s0; s <= s1 + 0.01; s += bays.pitch) {
        const at = sample(s);
        if (room(at))
          line(across(at, -bays.depth), across(at, bays.depth), 0.11);
      }
      for (const d of [-bays.depth, 0, bays.depth]) {
        let prev: V2 | undefined;
        for (let s = s0; s <= s1 + 0.01; s += 3) {
          const at = sample(Math.min(s, s1));
          if (!room(at)) {
            prev = undefined;
            continue;
          }
          const q = across(at, d);
          if (prev) line(prev, q, 0.11);
          prev = q;
        }
      }
    }
  }
}

/**
 * The solid wall of a walled lot: a box per 2 m of its runs (the whole thickness, from 3 m under the slab's level to 1.4 m over it), and
 * one across the opening of its stairs (the stairs are for walkers: a car is stopped there too). `ground` = the levelled terrain.
 */
export function wallColliders(
  lot: Lot,
  ground: (x: number, z: number) => number,
): StaticCollider[] {
  const T = lot.wallThick ?? 0.6;
  const mid = 0.05 + T / 2;
  const out: StaticCollider[] = [];
  const box = (a: V2, b: V2, nx: number, nz: number): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const cx = (a[0] + b[0]) / 2 + nx * mid;
    const cz = (a[1] + b[1]) / 2 + nz * mid;
    // The slab's level just inside the wall (the ground at the wall itself is the cliff's edge, a couple of metres under it).
    const [ix, iz] = toWorld(
      lot.site,
      (a[0] + b[0]) / 2 - nx * 0.5,
      (a[1] + b[1]) / 2 - nz * 0.5,
    );
    const slab = ground(ix, iz) + SLAB;
    out.push(
      turnedBoxCollider(
        lot.site,
        cx,
        cz,
        Math.atan2(b[1] - a[1], b[0] - a[0]),
        len / 2 + 0.05,
        T / 2,
        slab - 3,
        3 + 1.4,
      ),
    );
  };
  for (const run of wallRuns(lot))
    for (let k = 0; k + 1 < run.p.length; k++)
      box(
        run.p[k],
        run.p[k + 1],
        (run.n[k][0] + run.n[k + 1][0]) / 2,
        (run.n[k][1] + run.n[k + 1][1]) / 2,
      );
  const stairs = stairsAnchor(lot);
  if (stairs) {
    const { right } = lotShape(lot);
    box(right[stairs.k - 1], right[stairs.k + 1], stairs.n[0], stairs.n[1]);
  }
  return out;
}

/**
 * The physical ground of a lot: the top of its slab, flush with the stage road where it opens onto it. Pure (runs in
 * node): `ground` = the levelled terrain.
 */
export function slabHeight(
  lots: Lot[],
  ground: (x: number, z: number) => number,
): (x: number, z: number) => number {
  return (x, z) => {
    for (const lot of lots) if (onLot(lot, x, z)) return ground(x, z) + SLAB;
    return NaN;
  };
}
