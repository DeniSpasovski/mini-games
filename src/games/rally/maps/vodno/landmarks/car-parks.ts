import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import {
  LOT_ASPHALT,
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
  /** The strip's first end stops short of the road and opens to it through a flared apron of asphalt (`buildMouth`). */
  mouth?: boolean;
  /**
   * The outer edge as a polyline (local, in the centre line's order) for a lot that is not a band: each row of the strip ends
   * where it meets it, its corners become rows of their own, rows that miss it go.
   */
  outer?: V2[];
  /**
   * Drop the tip of a lot cut to an `outer` line where its outer edge still lies within ROAD_SIDE of the road (no kerb or wall
   * stands there): the strip ends where its kerb starts, not in a bare sliver of asphalt past it.
   */
  trimOpenStart?: boolean;
  /** The outer edge's rim at a point (local) of a walled lot: the rock wall with its railing (default), a low parapet, or open (stairs). */
  rim?: (p: V2) => RimKind;
  /**
   * The road side moved in by this much (m) at `s` m along it (from the band's first row): a verge between the road and a lot
   * that lies under the road's level (`flat`), held back by a wall (`rimLeft` 'bank').
   */
  insetLeft?: (s: number) => number;
  /** The road side's rim at `s` m along it (default: open near the road, else the rock wall). */
  rimLeft?: (s: number) => RimKind;
}

/**
 * A walled lot's rim: the rock wall with its railing, a low parapet (`low`), a 20 cm stone kerb with a railing set in it
 * (`kerb`), a retaining wall under a raised verge, its top at the verge's grass, no railing (`bank`), or open
 * (stairs).
 */
export type RimKind = 'wall' | 'low' | 'kerb' | 'bank' | 'open';

/**
 * The Vidikovec's outer edge (local frame, from the owner's level diagrams): a lens from the west tip at the road (`W`, a
 * stone kerb with a railing) to the green terrace's tip (`T`), the corner where the wall between the two terraces starts
 * (`R1`), the red terrace's landing (`P1`-`Q1`), the grey strip's start (`G`), its end (`Eend`) and the lot's east end
 * (`M`-`D`). Past T-R1 the stairs go down to the green terrace, past Q1-G to the red one, past M-D the stone steps to the
 * green terrace's east end; G-Eend is the grey strip's low parapet (lot-park.ts `drawGarden`).
 */
export const VIDIKOVEC_RIM = {
  W: [33.71, -0.76] as V2,
  T: [2.56, -17.16] as V2,
  R1: [0.89, -14.28] as V2,
  // (the red terrace's stairs: a landing at the lot's level out to the line P1-Q1 that runs parallel to the wall between
  // the terraces, then the flight from Q1-G down along the grey strip's wall)
  P1: [-2.11, -14.69] as V2,
  Q1: [-7.78, -18.48] as V2,
  G: [-13.76, -16.28] as V2,
  /** The grey strip's lot edge ends here; Eend-M-D is the lot's east end above the stone steps down to the green terrace. */
  Eend: [-61.99, 3.77] as V2,
  M: [-59.26, 9.62] as V2,
  D: [-63.6, 10.96] as V2,
  F: [-72.16, -1.48] as V2,
};

/** Distance from p to the segment a-b. */
export function segDist(p: V2, a: V2, b: V2): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const u = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1),
    ),
  );
  return Math.hypot(p[0] - a[0] - ex * u, p[1] - a[1] - ez * u);
}

const vidikovecRim = (p: V2): RimKind => {
  const { W, T, R1, P1, Q1, G, Eend, M, D } = VIDIKOVEC_RIM;
  const runs: [V2, V2, RimKind][] = [
    [W, T, 'kerb'],
    [T, R1, 'open'],
    [R1, P1, 'wall'],
    [P1, Q1, 'wall'],
    [Q1, G, 'open'],
    [G, Eend, 'low'],
    [Eend, M, 'wall'],
    [M, D, 'open'],
  ];
  let best = runs[0];
  let d = Infinity;
  for (const r of runs) {
    const dr = segDist(p, r[0], r[1]);
    if (dr < d) {
      d = dr;
      best = r;
    }
  }
  return best[2];
};

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
/**
 * The Vidikovec's grass island along the road (m along the lot's road side, `Lot.insetLeft`): a round head (`head` to
 * `nose`, `noseW` wide: the notice board's bed and the island are one lawn), then `width` m wide. Its lawn is the verge at
 * the road's level, which runs on past `to` to the lot's east end; the lot lies under it, behind a stone wall.
 */
export const VIDIKOVEC_ISLAND = {
  head: 36.5,
  nose: 40.8,
  noseW: 4.7,
  from: 42,
  to: 98,
  width: 2.7,
};
export function vidikovecIslandInset(s: number): number {
  const { head, nose, noseW, width } = VIDIKOVEC_ISLAND;
  if (s <= head) return 0;
  if (s <= nose)
    return noseW * Math.sqrt(1 - ((nose - s) / (nose - head)) ** 2);
  const t = Math.min(1, (s - nose) / 4);
  return noseW + (width - noseW) * (0.5 - 0.5 * Math.cos(Math.PI * t));
}

export const VIDIKOVEC: Lot = {
  site: VIDIKOVEC_LOT,
  // (on past the old end: the east cap runs straight from the road down to D)
  centre: [...VIDIKOVEC_LOT_CENTRE, [-63.4, 14.7]],
  hw: VIDIKOVEC_LOT_HW,
  // (along the straight edge of the grey strip only, from G: the bend before it skews them)
  bays: { depth: 4.8, pitch: 2.6, from: 0.5, to: 0.9, both: false },
  wall: true,
  // The lowered garden north of it (lot-park.ts `GARDEN`) lies 1-2 m under the lot: a thin rock wall, straight down, holds that
  // back (and hides the ground's step beside it, so the slab's own ground is never touched).
  wallDepth: 2.8,
  wallThick: 0.45,
  // (no bare sliver of asphalt west of the kerb's start: the strip begins where the kerb does)
  trimOpenStart: true,
  outer: (() => {
    const { W, T, R1, P1, Q1, G, Eend, M, D } = VIDIKOVEC_RIM;
    return [W, T, R1, P1, Q1, G, Eend, M, D];
  })(),
  rim: vidikovecRim,
  insetLeft: vidikovecIslandInset,
  rimLeft: (s) => (s > VIDIKOVEC_ISLAND.head ? 'bank' : 'open'),
};

/**
 * The hikers' car park below the big hairpin (OSM way 37998024; its stone walls, lamps and shelter: trail-lot.ts): an
 * asphalt strip falling gently from the road (3 m along it, the land 6.5 m: the pad in ../lots.ts), kerbed,
 * a row of bays along its north side.
 */
const TRAIL_SITE: Site = { x: 2086.4, z: -210.9, yaw: 0 };
export const TRAIL: Lot = {
  site: TRAIL_SITE,
  centre: [
    // (the first point short of the road: the end is square, and the mouth joins it to the road)
    [2090.5, -213.4],
    [2104, -221.6],
    [2121.4, -232.2],
  ].map(([x, z]): V2 => [x - TRAIL_SITE.x, z - TRAIL_SITE.z]),
  hw: 4.9,
  bays: {
    depth: 4.8,
    pitch: 2.5,
    from: 0.22,
    to: 0.92,
    both: false,
    straight: true,
  },
  mouth: true,
};

/** Thickness of the slab above the levelled ground (m): the terrain pad lies this far under the lot's top. */
export const SLAB = 0.2;
/** Stage road centre line -> the lot's edge on the road side (half width 2.9 + shoulder 0.6 + a gap, m). */
const ROAD_CLEAR = 3.6;
/** A lot's edge this close to the road (m) is its open road side: no kerb or wall. */
const ROAD_SIDE = ROAD_CLEAR + 2;
/** Stage road centre line -> the outer edge of a lot's mouth (m): at the road ribbon's edge (half width 2.9), so its edge line stays in view. */
const MOUTH_EDGE = 2.95;

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
  /** Distance of each row's road-side point along that side from the band's first row (m; `Lot.insetLeft`). */
  sl: number[];
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
  } else centre = resample(lot.centre, lot.insetLeft ? 1 : 2);
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
    // (no listed road near: nothing to keep clear of)
    if (!Number.isFinite(h.d)) return p;
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
  // (the road side's length from the band's first row: `insetLeft` is measured along it)
  let sl = [0];
  for (let i = 1; i < left.length; i++)
    sl.push(
      sl[i - 1] +
        Math.hypot(left[i][0] - left[i - 1][0], left[i][1] - left[i - 1][1]),
    );
  const s0 = sl[j0];
  sl = sl.map((s) => s - s0);
  if (lot.insetLeft) {
    const inset = lot.insetLeft;
    left = left.map((p, i): V2 => {
      const d = inset(sl[i]);
      if (!d) return p;
      const k = d / (Math.hypot(right[i][0] - p[0], right[i][1] - p[1]) || 1);
      return [p[0] + (right[i][0] - p[0]) * k, p[1] + (right[i][1] - p[1]) * k];
    });
  }
  // (a lot cut to an outer line keeps its narrow tip: that line is its edge)
  if (lot.outer) {
    [left, right, sl] = cutToOuter(left, right, sl, lot.outer, grow);
    if (lot.trimOpenStart) {
      // (the first row whose outer edge, to the next row, is no longer open to the road: where the kerb starts)
      let k = 0;
      while (k < right.length - 3 && dist(right[k + 1]) < ROAD_SIDE) k++;
      left = left.slice(k);
      right = right.slice(k);
      sl = sl.slice(k);
    }
  } else {
    left = left.slice(j0, j1 + 1);
    right = right.slice(j0, j1 + 1);
    sl = sl.slice(j0, j1 + 1);
  }
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
    sl,
  };
}

/**
 * The strip's rows cut to an outer edge polyline: each row runs from its left point to where it meets the line (`grow` m
 * past it), rows that miss it go; each point of the line between two rows (its ends too) becomes a row of its own. `sl`
 * (the road side's length at each row) is carried along.
 */
function cutToOuter(
  left: V2[],
  right: V2[],
  sl: number[],
  outer: V2[],
  grow: number,
): [V2[], V2[], number[]] {
  const unit = (x: number, z: number): V2 => {
    const k = Math.hypot(x, z) || 1;
    return [x / k, z / k];
  };
  const hitAt = (o: V2, d: V2): V2 | undefined => {
    let best = Infinity;
    for (let k = 0; k + 1 < outer.length; k++) {
      const ex = outer[k + 1][0] - outer[k][0];
      const ez = outer[k + 1][1] - outer[k][1];
      const den = d[0] * ez - d[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = outer[k][0] - o[0];
      const wz = outer[k][1] - o[1];
      const t = (wx * ez - wz * ex) / den;
      const u = (wx * d[1] - wz * d[0]) / den;
      if (t > 0.3 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
    }
    return best < Infinity
      ? [o[0] + d[0] * (best + grow), o[1] + d[1] * (best + grow)]
      : undefined;
  };
  const dirs = left.map((p, i) => unit(right[i][0] - p[0], right[i][1] - p[1]));
  /** Which side of row k's line the point lies on (signed). */
  const side = (k: number, v: V2): number =>
    dirs[k][0] * (v[1] - left[k][1]) - dirs[k][1] * (v[0] - left[k][0]);
  const L: V2[] = [];
  const R: V2[] = [];
  const S: number[] = [];
  for (let i = 0; i < left.length; i++) {
    const h = hitAt(left[i], dirs[i]);
    if (h) {
      L.push(left[i]);
      R.push(h);
      S.push(sl[i]);
    }
    if (i + 1 === left.length) break;
    const corners = outer
      .map((v) => ({ v, a: side(i, v), b: side(i + 1, v) }))
      .filter((c) => c.a * c.b < 0)
      .map((c) => ({ v: c.v, u: c.a / (c.a - c.b) }))
      .sort((x, y) => x.u - y.u);
    for (const { v, u } of corners) {
      const lp: V2 = [
        left[i][0] + (left[i + 1][0] - left[i][0]) * u,
        left[i][1] + (left[i + 1][1] - left[i][1]) * u,
      ];
      const d = unit(v[0] - lp[0], v[1] - lp[1]);
      L.push(lp);
      R.push([v[0] + d[0] * grow, v[1] + d[1] * grow]);
      S.push(sl[i] + (sl[i + 1] - sl[i]) * u);
    }
  }
  return [L, R, S];
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
export function lotPolygon(
  lot: Lot,
  grow = 0,
  /** Only the rows whose centre point passes (a run of them). */
  keep?: (centre: V2) => boolean,
): number[] {
  const { left, right, centre } = lotShape(lot, grow);
  const k = keep ? centre.map(keep) : centre.map(() => true);
  const l = left.filter((_, i) => k[i]);
  const r = right.filter((_, i) => k[i]);
  return [...l, ...r.slice().reverse()].flatMap(([x, z]) =>
    toWorld(lot.site, x, z),
  );
}

/**
 * The verge of a lot that lies under the road (`Lot.insetLeft`): from the road's edge to the lot's wall, from `from` m along
 * the road side to the far end and on round the end cap (`beyond` m past it); world, flat.
 */
export function vergePolygon(lot: Lot, from: number, beyond = 6): number[] {
  const { left, right, sl, centre } = lotShape(lot);
  const n = left.length;
  const inner: V2[] = [];
  const road: V2[] = [];
  for (let i = 0; i < n; i++) {
    if (sl[i] < from) continue;
    inner.push(left[i]);
    // (out across the row to the road ribbon's edge)
    const [wx, wz] = toWorld(lot.site, left[i][0], left[i][1]);
    const h = nearestRoad(wx, wz);
    const side = Math.sign(h.lat) || 1;
    road.push(
      toLocal(
        lot.site,
        h.x + side * MOUTH_EDGE * -h.tz,
        h.z + side * MOUTH_EDGE * h.tx,
      ) as V2,
    );
  }
  // Round the far cap: along it to 3/4 of its width, then out past it.
  const a = centre[n - 2];
  const b = centre[n - 1];
  const ol = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const out: V2 = [(b[0] - a[0]) / ol, (b[1] - a[1]) / ol];
  const capAt = (t: number, o: number): V2 => [
    left[n - 1][0] + (right[n - 1][0] - left[n - 1][0]) * t + out[0] * o,
    left[n - 1][1] + (right[n - 1][1] - left[n - 1][1]) * t + out[1] * o,
  ];
  const r = road[road.length - 1];
  const pts: V2[] = [
    ...inner,
    capAt(0.75, 0.05),
    capAt(0.75, beyond),
    [r[0] + out[0] * beyond, r[1] + out[1] * beyond],
    ...road.slice().reverse(),
  ];
  return pts.flatMap(([x, z]) => toWorld(lot.site, x, z));
}

/** A wall for `wallMeshCut`: its line, unit normals to its outer side, the faces' offsets along them (m). */
export interface CutWall {
  p: V2[];
  n: V2[];
  inner: number;
  outer: number;
  /** Under a raised verge (the land behind it is higher, the lot in front of it is a slab). */
  bank?: boolean;
}

/**
 * The drawn terrain's cut at walls (`MapDef.terrain.meshSink`; local frame of `site`): the 1 m terrain mesh cannot hold a
 * wall's step. Inside a wall over lower land its points drop to that land's level, so the slope lies behind the wall's top
 * (under a slab, or a narrow dip behind a parapet) instead of rising in teeth at its foot. At a verge's wall (`bank`) the
 * points in front of it (under the slab) drop far down and those inside it rise to the verge's level, which leaves the
 * slope between them a near-vertical sliver inside the wall's face. `height` = the levelled terrain (world); the physics
 * ground is not changed.
 */
export function wallMeshCut(
  site: Site,
  walls: () => CutWall[],
): (x: number, z: number, height: (x: number, z: number) => number) => number {
  interface Seg {
    a: V2;
    n: V2;
    t: V2;
    len: number;
    T: number;
    bank: boolean;
  }
  let segs: Seg[] | undefined;
  let box: [number, number, number, number] = [0, 0, 0, 0];
  return (x, z, height) => {
    if (!segs) {
      segs = [];
      for (const w of walls())
        for (let k = 0; k + 1 < w.p.length; k++) {
          const [nx, nz] = [
            (w.n[k][0] + w.n[k + 1][0]) / 2,
            (w.n[k][1] + w.n[k + 1][1]) / 2,
          ];
          const nl = Math.hypot(nx, nz) || 1;
          const n: V2 = [nx / nl, nz / nl];
          const a: V2 = [
            w.p[k][0] + n[0] * w.inner,
            w.p[k][1] + n[1] * w.inner,
          ];
          const b: V2 = [
            w.p[k + 1][0] + n[0] * w.inner,
            w.p[k + 1][1] + n[1] * w.inner,
          ];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.01) continue;
          segs.push({
            a,
            n,
            t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len],
            len,
            T: w.outer - w.inner,
            bank: !!w.bank,
          });
        }
      const xs = segs.flatMap((g) => [g.a[0], g.a[0] + g.t[0] * g.len]);
      const zs = segs.flatMap((g) => [g.a[1], g.a[1] + g.t[1] * g.len]);
      box = [
        Math.min(...xs) - 3,
        Math.min(...zs) - 3,
        Math.max(...xs) + 3,
        Math.max(...zs) + 3,
      ];
    }
    const [lx, lz] = toLocal(site, x, z);
    if (lx < box[0] || lz < box[1] || lx > box[2] || lz > box[3]) return 0;
    let best: Seg | undefined;
    let bd = 0;
    let bAbs = Infinity;
    for (const g of segs) {
      const dx = lx - g.a[0];
      const dz = lz - g.a[1];
      const u = dx * g.t[0] + dz * g.t[1];
      if (u < -0.3 || u > g.len + 0.3) continue;
      const d = dx * g.n[0] + dz * g.n[1];
      // (a plain wall also takes the upper pad's overhang past its face: 0.05 + 0.1 blend)
      if (d < (g.bank ? -1.8 : 0) || d > g.T + (g.bank ? 0.05 : 0.3)) continue;
      const ad = Math.abs(d - g.T / 2);
      if (ad < bAbs) {
        bAbs = ad;
        best = g;
        bd = d;
      }
    }
    if (!best) return 0;
    // (the land's level 1.6 m past the wall against the ground's at the point)
    const back = 1.6 + best.T - bd;
    const [bx, bz] = toWorld(
      site,
      lx + best.n[0] * back,
      lz + best.n[1] * back,
    );
    const step = height(bx, bz) - height(x, z);
    if (!best.bank) return step < -0.05 ? -step : 0;
    if (step < 0.05) return 0;
    return bd < 0 ? step * 12 : -step;
  };
}

/** `wallMeshCut` for a walled lot: its verge walls and its rock walls (not the kerbs or the low parapets). */
export function lotMeshSink(
  lot: Lot,
): (x: number, z: number, height: (x: number, z: number) => number) => number {
  const T = lot.wallThick ?? 0.6;
  return wallMeshCut(lot.site, () =>
    wallRuns(lot)
      .filter((r) => r.bank || (r.rail && !r.kerb))
      .map((r) => ({
        p: r.p,
        n: r.n,
        inner: 0.05,
        outer: 0.05 + (r.bank ? 0.5 : T),
        bank: r.bank,
      })),
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

/** A lot's slab outline (local frame) and its world bounding box [minX, minZ, maxX, maxZ]. */
interface SlabOutline {
  poly: V2[];
  box: [number, number, number, number];
}
const outlines = new Map<Lot, SlabOutline>();
const slabOutline = (lot: Lot): SlabOutline => {
  let o = outlines.get(lot);
  if (!o) {
    const { left, right } = lotShape(lot);
    const poly = [...left, ...right.slice().reverse()];
    const world = poly.map(([px, pz]) => toWorld(lot.site, px, pz));
    const xs = world.map((p) => p[0]);
    const zs = world.map((p) => p[1]);
    o = {
      poly,
      box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    };
    outlines.set(lot, o);
  }
  return o;
};

/** True when the world point lies on the lot's slab. Runs for every ground sample on Vodno: the box rejects most. */
export function onLot(lot: Lot, x: number, z: number): boolean {
  const { poly, box } = slabOutline(lot);
  if (x < box[0] || z < box[1] || x > box[2] || z > box[3]) return false;
  const [lx, lz] = toLocal(lot.site, x, z);
  return inPolygon(poly, lx, lz);
}

/** One run of a lot's rock wall: the outline's points, the unit normal to the outer side at each, and whether it carries the railing. */
export interface WallRun {
  p: V2[];
  n: V2[];
  rail: boolean;
  /** A low parapet (`Lot.rim` 'low'): 30 cm over the slab, thin, no railing. */
  low?: boolean;
  /** A 20 cm stone kerb, its railing set in it (`RimKind` 'kerb'). */
  kerb?: boolean;
  /** A retaining wall under a raised verge, its top at the verge's grass (`RimKind` 'bank'). */
  bank?: boolean;
}

/** A cap across the strip's end is open (no kerb, no wall) where it meets the road: a narrow mouth, or a cap that runs along the road. */
function capOpenOf(shape: LotShape, i: number, lot: Lot): boolean {
  if (lot.mouth && i === 0) return true;
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
export function wallRuns(lot: Lot, solid = false): WallRun[] {
  if (!lot.wall) return [];
  const shape = lotShape(lot);
  const { centre, left, right, dl, dr, sl } = shape;
  const n = centre.length;
  const OUT = 0.05 + (lot.wallThick ?? 0.6);
  const stairs = stairsAnchor(lot);
  const capOpen = (i: number): boolean => capOpenOf(shape, i, lot);
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
    let kindNow: RimKind = 'wall';
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
          rail: kindNow === 'wall' || kindNow === 'kerb',
          low: kindNow === 'low',
          kerb: kindNow === 'kerb',
          bank: kindNow === 'bank',
        });
      }
      from = -1;
    };
    for (let i = 0; i + 1 < n; i++) {
      // (a rim the lot spells out is kept up to just short of the road: the edge there is the road's own)
      const ruled = s === 1 ? lot.rim : lot.rimLeft;
      let kind: RimKind =
        s === 1 && lot.rim
          ? lot.rim([
              (pts[i][0] + pts[i + 1][0]) / 2,
              (pts[i][1] + pts[i + 1][1]) / 2,
            ])
          : s === -1 && lot.rimLeft
            ? lot.rimLeft((sl[i] + sl[i + 1]) / 2)
            : 'wall';
      // (the colliders close the stairs' openings: a car never drives down them)
      if (solid && kind === 'open') kind = 'wall';
      const near = ruled ? ROAD_CLEAR + 0.6 : ROAD_SIDE;
      const open =
        kind === 'open' ||
        (s === 1 || !ruled ? d[i] < near && d[i + 1] < near : false) ||
        (s === 1 &&
          stairs !== undefined &&
          (i === stairs.k || i + 1 === stairs.k));
      if (open) close(i);
      else {
        if (from >= 0 && kind !== kindNow) close(i);
        if (from < 0) {
          from = i;
          kindNow = kind;
        }
      }
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
    // (a lot under a raised verge: its far cap holds the land behind it too)
    runs.push({ p, n: p.map(() => out), rail: false, bank: !!lot.rimLeft });
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
        LOT_ASPHALT,
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
    /** A cap: its end of the strip (row 0 or n - 1); a long edge: its row. */
    end?: number;
  }
  /**
   * A cap across the strip's end is open (no kerb, no wall) where it meets the road: a narrow mouth, or a cap that runs along the
   * road (the wide strip cut by it: both its ends within a few metres of the road's edge).
   */
  const shape = lotShape(lot);
  const capOpen = (i: number): boolean => capOpenOf(shape, i, lot);
  const edges: Edge[] = [];
  const push = (
    a: V2,
    b: V2,
    nx: number,
    nz: number,
    open: boolean,
    cap: boolean,
    end?: number,
  ) => edges.push({ a, b, nx, nz, open, cap, end });
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
        i,
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
      push(at(k), at(k + 1), tx / tl, tz / tl, mouth, true, i);
  }

  /**
   * The rock wall of a walled lot: one continuous ribbon along each run of its outline (the long edges - the road side is
   * open, the outer edge opens where the stairs go down - and the end caps), its faces and top sloping with the ground
   * (smoothed: no steps, no cracks at curves), sunk `wallDepth` under the slab, a green railing on the outer edge of the
   * top (not on the caps). The caps run on past the corners, so the corner squares are solid.
   */
  const drawWall = (): void => {
    const lotT = lot.wallThick ?? 0.6;
    const IN = 0.05;
    const depth = lot.wallDepth ?? 1.4;
    const runs = wallRuns(lot);
    for (const run of runs) {
      const m = run.p.length;
      if (m < 2) continue;
      const T = run.low ? 0.4 : run.kerb ? 0.35 : run.bank ? 0.5 : lotT;
      const OUT = IN + T;
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
      // (a bank's top is the verge's grass behind it, a kerb 20 cm over the asphalt)
      const top = (q: V2, k: number): number =>
        run.bank
          ? Math.max(y(q) + 0.15, y(at(k, OUT + 1.6), 0) + 0.05)
          : y(q) + (run.low ? 0.3 : run.kerb ? 0.2 : 0.55);
      const hi = smooth(smooth(run.p.map(top)));
      const sunk = run.kerb ? 0.6 : run.bank ? 1 : depth;
      const foot = run.p.map(
        (_, k) => Math.min(y(at(k, IN)), y(at(k, OUT))) - sunk,
      );
      const lo = foot.map((v, k) =>
        Math.min(v, foot[Math.max(0, k - 1)], foot[Math.min(m - 1, k + 1)]),
      );
      wallRibbon(
        l,
        { p: run.p, n: run.n, hi, lo, inner: IN, outer: OUT },
        // (the kerb: white limestone rubble)
        run.kerb ? '#e6e2d8' : undefined,
      );
      if (!run.rail) continue;
      // The railing: posts about every 2 m set into the top, rails sloping with it; on the outer edge of a thick wall, along
      // the middle of a thin one or a kerb (three rails on a kerb).
      const ro = T > 0.6 ? OUT - 0.2 : IN + T / 2;
      const ks = [0];
      for (let k = 1, acc = 0; k < m; k++) {
        acc += Math.hypot(
          run.p[k][0] - run.p[k - 1][0],
          run.p[k][1] - run.p[k - 1][1],
        );
        if (acc >= 1.8 || k === m - 1) {
          ks.push(k);
          acc = 0;
        }
      }
      const post = (k: number, h: number): V3 => {
        const q = at(k, ro);
        return [q[0], hi[k] + h, q[1]];
      };
      const rails = run.kerb ? [0.15, 0.45, 0.8] : [0.5, 0.95];
      const postTop = run.kerb ? 0.82 : 1;
      for (const k of ks)
        strut(l, post(k, 0), post(k, postTop), 0.07, 'paint', '#2f7a45');
      for (let j = 0; j + 1 < ks.length; j++)
        for (const h of rails)
          strut(
            l,
            post(ks[j], h),
            post(ks[j + 1], h),
            0.06,
            'paint',
            '#2f7a45',
          );
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
      // Its top and foot slope with the slab (no level blocks stepping down a sloped lot): the faces run a few cm
      // past both ends so neighbouring pieces close at a corner.
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      const a0: V2 = [a[0] - ux * 0.03, a[1] - uz * 0.03];
      const b0: V2 = [b[0] + ux * 0.03, b[1] + uz * 0.03];
      const ya = y(a);
      const yb = y(b);
      const depth = lot.wallDepth ?? 1.4;
      const off = (q: V2, o: number): V2 => [q[0] + e.nx * o, q[1] + e.nz * o];
      const [ai, bi, ao, bo] = [
        off(a0, -0.15),
        off(b0, -0.15),
        off(a0, 0.15),
        off(b0, 0.15),
      ];
      const top = (q: V2, h: number): V3 => [q[0], h + 0.14, q[1]];
      const low = (q: V2, h: number): V3 => [q[0], h - depth, q[1]];
      const uvAlong = (q: V3): V2 => [q[0] * ux + q[2] * uz, q[1]];
      const KERB = '#d2d0ca';
      l.fan(
        'concrete',
        [top(ai, ya), top(bi, yb), top(bo, yb), top(ao, ya)],
        KERB,
        [0, 1, 0],
        (q) => [q[0], q[2]],
      );
      l.fan(
        'concrete',
        [top(ao, ya), top(bo, yb), low(bo, yb), low(ao, ya)],
        KERB,
        [e.nx, 0, e.nz],
        uvAlong,
      );
      l.fan(
        'concrete',
        [top(ai, ya), top(bi, yb), low(bi, yb), low(ai, ya)],
        KERB,
        [-e.nx, 0, -e.nz],
        uvAlong,
      );
    }

  /**
   * The mouth of an open end: an apron of asphalt from the end's two corners out to the road's edge (under the road ribbon,
   * drawn over it), flared along the road as far as each corner is from it, so an end that meets the road at an angle joins
   * it all across. It follows the ground, easing from the slab's top to the road's level. False = no road near.
   */
  function buildMouth(i: number): boolean {
    const [mx, mz] = toWorld(site, centre[i][0], centre[i][1]);
    const toRoad = (p: V2): V2 | undefined => {
      const [wx, wz] = toWorld(site, p[0], p[1]);
      const h = nearestRoad(wx, wz);
      if (!Number.isFinite(h.d) || h.d > ROAD_SIDE + 4) return undefined;
      const side = Math.sign(h.lat) || 1;
      // Flared away from the end's middle, along the road, as far as the corner is from the road's edge (45 deg).
      const away = Math.sign((wx - mx) * h.tx + (wz - mz) * h.tz) || 1;
      const f = Math.min(Math.max(0, Math.abs(h.lat) - MOUTH_EDGE), 2.5) * away;
      return toLocal(
        site,
        h.x + side * MOUTH_EDGE * -h.tz + h.tx * f,
        h.z + side * MOUTH_EDGE * h.tx + h.tz * f,
      ) as V2;
    };
    const a = left[i];
    const b = right[i];
    const a2 = toRoad(a);
    const b2 = toRoad(b);
    if (!a2 || !b2) return false;
    const lerp = (p: V2, q: V2, t: number): V2 => [
      p[0] + (q[0] - p[0]) * t,
      p[1] + (q[1] - p[1]) * t,
    ];
    // A fine grid (~0.5 m: the verge's bumps must not poke through), each point on the ground plus a lift easing from
    // the slab's top to just under the road's top at its edge (the ribbon lies 2 cm over the ground), so the apron runs
    // on under the ribbon with no lip and no slot under its edge.
    const M = 20;
    const N = 8;
    const pt = (u: number, v: number): V3 => {
      const p = lerp(lerp(a, b, u / M), lerp(a2, b2, u / M), v / N);
      return [p[0], y(p, SLAB + (0.015 - SLAB) * (v / N)), p[1]];
    };
    for (let u = 0; u < M; u++)
      for (let v = 0; v < N; v++) {
        const q = [pt(u, v), pt(u + 1, v), pt(u + 1, v + 1), pt(u, v + 1)];
        // (each cell wound to face up, whichever way the flare turns it: a cell seen from below is culled)
        const up1 =
          (q[1][2] - q[0][2]) * (q[2][0] - q[0][0]) -
          (q[1][0] - q[0][0]) * (q[2][2] - q[0][2]);
        if (up1 < 0) q.reverse();
        l.fan('asphalt', q, LOT_ASPHALT, up, (c) => [c[0], c[2]]);
      }
    // Its two flared sides: a skirt of asphalt down into the ground, so the land beside never shows a gap or cuts over it.
    const [cx, , cz] = pt(M / 2, N / 2);
    for (const u of [0, M])
      for (let v = 0; v < N; v++) {
        const t0 = pt(u, v);
        const t1 = pt(u, v + 1);
        const foot = (t: V3): V3 => [t[0], y([t[0], t[2]], -0.3), t[2]];
        let nx = -(t1[2] - t0[2]);
        let nz = t1[0] - t0[0];
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        if ((t0[0] - cx) * nx + (t0[2] - cz) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        const q = [t0, t1, foot(t1), foot(t0)];
        // (wound to face out, away from the apron's middle: its face normal (t1 - t0) x (foot - t0) along n)
        const f1 = q[2];
        const ax = t1[0] - t0[0];
        const ay = t1[1] - t0[1];
        const az = t1[2] - t0[2];
        const bx = f1[0] - t0[0];
        const by = f1[1] - t0[1];
        const bz = f1[2] - t0[2];
        if ((ay * bz - az * by) * nx + (ax * by - ay * bx) * nz < 0)
          q.reverse();
        l.fan('asphalt', q, LOT_ASPHALT, [nx, 0, nz], (c) => [
          c[0] * nz - c[2] * nx,
          c[1],
        ]);
      }
    return true;
  }

  // The open road side: a short bevel of asphalt from the slab's edge to the ground beside it (the road's shoulder), so the lot
  // levels out into the road's level - from higher to lower terrain or the other way - without a lip. The road is drawn over it.
  const BEVEL = 0.9;
  const mid = centre[n >> 1];
  const mouths = new Set(lot.mouth && buildMouth(0) ? [0] : []);
  for (const e of edges) {
    if (!e.open) continue;
    // (an open end with a mouth to the road has its own apron: buildMouth)
    if (e.cap && e.end !== undefined && mouths.has(e.end)) continue;
    // (nor do the long edges' rows next to a mouth: their bevels would step out of its apron)
    if (
      !e.cap &&
      e.end !== undefined &&
      ((mouths.has(0) && e.end < 3) || (mouths.has(n - 1) && e.end > n - 5))
    )
      continue;
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
      LOT_ASPHALT,
      up,
      (q) => [q[0], q[2]],
    );
  }

  // Marked bays: a white line every `pitch`, depth `depth` from the edge, and the line closing the bays.
  const bays = lot.bays;
  if (bays) {
    // Old paint: each line its own faded grey-white, worn through in short gaps (seeded by where it lies).
    const line = (a0: V2, b0: V2, w: number): void => {
      const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
      const nx = (-(b0[1] - a0[1]) / len) * (w / 2);
      const nz = ((b0[0] - a0[0]) / len) * (w / 2);
      const seed = hash3(
        Math.round(a0[0] * 10),
        Math.round(a0[1] * 10),
        5,
        811,
      );
      const v = 200 + (seed % 36);
      const color = `rgb(${v},${v},${v - 6})`;
      const pieces = Math.max(1, Math.round(len / 1.6));
      for (let k = 0; k < pieces; k++) {
        const h = hash3(seed, k, 3, 97) % 100;
        if (h < 22) continue;
        const t0 = k / pieces + (h < 40 ? 0.25 / pieces : 0);
        const t1 = (k + 1) / pieces;
        const a: V2 = [
          a0[0] + (b0[0] - a0[0]) * t0,
          a0[1] + (b0[1] - a0[1]) * t0,
        ];
        const b: V2 = [
          a0[0] + (b0[0] - a0[0]) * t1,
          a0[1] + (b0[1] - a0[1]) * t1,
        ];
        quad(
          'marking',
          [
            [a[0] - nx, a[1] - nz],
            [b[0] - nx, b[1] - nz],
            [b[0] + nx, b[1] + nz],
            [a[0] + nx, a[1] + nz],
          ],
          color,
          SLAB + 0.02,
        );
      }
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
  for (const run of wallRuns(lot, true))
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

/**
 * Parked cars in a lot's edge bays (the bays `buildLot` paints): one in `share` of them (seeded), nose in, in the lot's
 * local frame - (x, z), `turn` = the car's +x from the site's +x (rad) - and a `street_car` variant.
 */
export function bayCars(
  lot: Lot,
  share: number,
  seed: number,
): { x: number; z: number; turn: number; variant: number }[] {
  const bays = lot.bays;
  if (!bays) return [];
  const { centre, left, right, hl, hr } = lotShape(lot);
  const n = centre.length;
  const cum = [0];
  for (let i = 1; i < n; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(
          centre[i][0] - centre[i - 1][0],
          centre[i][1] - centre[i - 1][1],
        ),
    );
  const total = cum[n - 1];
  const sample = (s: number) => {
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
  // (as buildLot: the bays begin 1.2 m past the first station of the straight far end)
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
  const out: { x: number; z: number; turn: number; variant: number }[] = [];
  let k = 0;
  for (const sd of bays.both ? [-1, 1] : [1]) {
    const s0 = Math.max(bays.from * total, straightS);
    const s1 = bays.to * total;
    for (let s = s0; s + bays.pitch <= s1 + 0.01; s += bays.pitch, k++) {
      const at = sample(s + bays.pitch / 2);
      const h = (sd < 0 ? at.hl : at.hr) - 0.35;
      const inner = h - bays.depth;
      if (inner < 1.6) continue;
      const r = hash3(k, seed, 7, 4111);
      if ((r % 1000) / 1000 >= share) continue;
      const d = (inner + h) / 2 + 0.2;
      const [nx, nz] = [at.n[0] * sd, at.n[1] * sd];
      out.push({
        x: at.p[0] + nx * d,
        z: at.p[1] + nz * d,
        // nose towards the lot's edge, a little off square
        turn: Math.atan2(nz, nx) + (((r >>> 10) % 100) / 100 - 0.5) * 0.12,
        variant: (r >>> 4) % 10,
      });
    }
  }
  return out;
}
