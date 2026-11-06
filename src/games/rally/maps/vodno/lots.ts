import type { PadDef, PathDef } from '../shared/types';
import { LOT_ROADS } from './landmarks/lot-road';
import { PLAZA, roadZ } from './landmarks/restaurant';
import { RESTAURANT, toWorld } from './landmarks/sites';
import {
  GARDEN,
  gardenPadPolygon,
  lawnPolygons,
  rampPad,
} from './landmarks/lot-park';
import {
  lotPolygon,
  SLAB,
  SREDNO,
  SREDNO_BUS,
  TRAIL,
  VIDIKOVEC,
} from './landmarks/car-parks';

/**
 * The two big car parks on the stage road: the Vidikovec viewpoint lot (beside a hairpin, 1.3 km below the finish) and the
 * Sredno Vodno lot at the finish. OSM draws them as thin aisle lines that stop short of the road; here each is an
 * ai-generated slab (landmarks/car-parks.ts) on a graded pad: the terrain is levelled round it (`GRADED_MARGIN` m wider
 * than the slab, so the terrain mesh never rises through its edge) to `SLAB` + the road's crown under the road's level,
 * which puts the slab's top flush with the road's edge. The pad stops at the stage road's clearance line: the road has priority.
 */
const GRADED_MARGIN = 2.5;
const PAD_LIFT = -(SLAB + 0.1);
/** The trail lot's fall from the road to its far end (m): a gentle slant, not the land's 6.5 m. */
const TRAIL_FALL = 3;
/** Stage road points along the Vidikovec lot (its pad takes their heights). */
const VIDIKOVEC_FRONTAGE = [
  1500.2, -557.2, 1535, -574.6, 1553, -580.7, 1570.4, -584.9, 1591.3, -584.5,
  1603.7, -581.2,
];

export const LOT_PADS: PadDef[] = [
  {
    name: 'vidikovec_lot',
    polygon: lotPolygon(VIDIKOVEC, GRADED_MARGIN),
    blend: 6,
    frontage: VIDIKOVEC_FRONTAGE,
    lift: PAD_LIFT,
  },
  // The lowered garden north of it: two terraces `drop` m under the lot's ground (landmarks/lot-park.ts `GARDEN`). Applied
  // after the lot's pad, which they override beyond its wall; a small blend, the retaining walls hide the step.
  ...([1, 0] as const).map((k): PadDef => ({
    name: `vidikovec_garden_${k + 1}`,
    polygon: gardenPadPolygon(k),
    // (terrace 2 falls away to the land below as a grassed embankment, terrace 1's step is a wall)
    blend: k ? 7 : 0.4,
    frontage: VIDIKOVEC_FRONTAGE,
    lift: PAD_LIFT - GARDEN.drop[k] - GARDEN.sink,
  })),
  // The ramps between the terraces at both ends of the dividing wall: a sloped pad from terrace 1's level to terrace 2's, applied
  // last (its ends meet the two terraces' levels); the blend grades its sides into the terraces as grassy banks.
  ...([0, 1] as const).map((end): PadDef => {
    const { polygon, from, to } = rampPad(end);
    return {
      name: `vidikovec_garden_ramp_${end + 1}`,
      polygon,
      blend: 3,
      frontage: VIDIKOVEC_FRONTAGE,
      ramp: {
        from,
        to,
        lift: [
          PAD_LIFT - GARDEN.drop[0] - GARDEN.sink,
          PAD_LIFT - GARDEN.drop[1] - GARDEN.sink,
        ],
      },
    };
  }),
  {
    name: 'sredno_lot',
    polygon: lotPolygon(SREDNO, GRADED_MARGIN),
    blend: 6,
    // The road alongside the entrance and up to the lot (points of the game road, ./landmarks/lot-road.ts).
    frontage: [
      497.1, -315.3, 520.2, -321.7, 540.3, -327.9, 560.9, -331.8, 584.8, -332.6,
    ],
    lift: PAD_LIFT,
  },
  {
    // The smaller lot below it: a neck off the stage road, then the bay area.
    name: 'sredno_bus_lot',
    polygon: lotPolygon(SREDNO_BUS, GRADED_MARGIN),
    blend: 6,
    frontage: [
      528.8, -324.4, 514.5, -319.9, 500, -316, 485.3, -313.1, 470.3, -312.6,
      455.7, -315.7,
    ],
    lift: PAD_LIFT,
  },
  {
    // The hikers' car park below the big hairpin (landmarks/car-parks.ts `TRAIL`): a gentle fall under its asphalt
    // (3 m down along it; the land falls 6.5 m, its far end stands on a graded bank), the land's own cover round it; its aisle is dropped.
    name: 'trail_lot',
    polygon: lotPolygon(TRAIL, GRADED_MARGIN),
    blend: 5,
    frontage: [2083.3, -224, 2084, -204],
    ramp: {
      from: [2089, -212],
      to: [2121, -232],
      lift: [PAD_LIFT, PAD_LIFT - TRAIL_FALL],
    },
  },
  {
    // Beyond it the earth path down to the picnic shelter and the hiking trail east: one walkable slope instead of the
    // land's step at the lot's end.
    name: 'trail_start',
    polygon: [2119, -240.2, 2126.5, -227.5, 2150, -238, 2148, -254, 2122, -254],
    blend: 4,
    frontage: [2083.3, -224, 2084, -204],
    surface: 'dirt',
    ramp: {
      from: [2124, -232],
      to: [2142, -246],
      lift: [PAD_LIFT - TRAIL_FALL + SLAB, -9.5],
    },
  },
];

/**
 * The baked OSM aisle lines the lots replace (first point, rounded): the Vidikovec aisle, two Sredno aisles, the small lot's
 * ring + its stub, the trail lot's aisle.
 */
const REPLACED = new Set([
  '1492,-570',
  '539,-349',
  '554,-339',
  '477,-329',
  '2094,-213',
]);

/** Painted lawns (`MapDef.terrain.lawns`): the Sredno park strip, the two garden terraces and the trail start's bank. */
export const LAWNS: number[][] = lawnPolygons();

/**
 * The one-way pair of short curved arcs round the junction of the street "Сончев Град" with the hairpin at 2000 m (OSM draws the
 * junction as a knot of six pieces: a double curve): each arc as "first point > last point" of the BAKED way, rounded (not the
 * ends `connectPaths` extends at load time). Dropped: the street itself
 * is kept and `connectPaths` joins its end to the stage road.
 */
const JUNCTION_ARCS = new Set([
  '2158,-64>2162,-58',
  '2162,-58>2158,-59',
  '2134,-50>2149,-51',
  '2162,-58>2159,-77',
  '2149,-51>2162,-58',
]);
const pointKey = (x: number, z: number): string =>
  `${Math.round(x)},${Math.round(z)}`;

export const dropLotAisles = (paths: PathDef[]): PathDef[] =>
  paths
    .filter((p) => {
      const n = p.pts.length;
      return (
        !REPLACED.has(pointKey(p.pts[0], p.pts[1])) &&
        !JUNCTION_ARCS.has(
          `${pointKey(p.pts[0], p.pts[1])}>${pointKey(p.pts[n - 2], p.pts[n - 1])}`,
        )
      );
    })
    .flatMap((p) => (FOOT_KINDS.has(p.kind) ? clipToLots(p) : [p]));

/**
 * Footpaths (bake `osm.footpaths`) stop at a lot's blend edge (their heights come from the land, the lot is graded apart) and
 * at the restaurant's parking (5 m round it, clear of its gate road).
 */
const FOOT_KINDS = new Set(['path', 'footway']);
const KEEP_OFF: { polygon: number[]; blend: number }[] = [
  ...LOT_PADS,
  {
    polygon: [
      [PLAZA.x0, PLAZA.z0],
      [PLAZA.x1, PLAZA.z0],
      [PLAZA.x1, PLAZA.z1],
      [PLAZA.x0, PLAZA.z1],
    ].flatMap(([x, z]) => toWorld(RESTAURANT, x, z)),
    blend: 5,
  },
];
/** Points along a footpath tested against the lots (m). */
const FOOT_STEP = 2;

/** Distance from (x, z) to a flat closed polygon, 0 inside. */
function polygonGap(poly: number[], x: number, z: number): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const [ax, az, bx, bz] = [poly[j], poly[j + 1], poly[i], poly[i + 1]];
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az))
      inside = !inside;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return inside ? 0 : best;
}

/** The runs of footpath `p` outside KEEP_OFF (resampled every FOOT_STEP m). */
function clipToLots(p: PathDef): PathDef[] {
  const clear = (x: number, z: number) =>
    KEEP_OFF.every((d) => polygonGap(d.polygon, x, z) > d.blend);
  const runs: number[][] = [];
  let run: number[] = [];
  const end = () => {
    if (run.length >= 4) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 2 < p.pts.length; i += 2) {
    const [ax, az, bx, bz] = p.pts.slice(i, i + 4);
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bx - ax, bz - az) / FOOT_STEP),
    );
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      if (clear(x, z)) run.push(x, z);
      else end();
    }
  }
  end();
  // Untouched: keep the baked points.
  return runs.length === 1 &&
    !p.pts.some((_, i) => i % 2 === 0 && !clear(p.pts[i], p.pts[i + 1]))
    ? [p]
    : runs.map((pts) => ({ ...p, pts }));
}

/**
 * The road that leaves the stage road to the right at the hairpin below the finish (OSM way, first point rounded): the
 * mountain road on towards the summit - narrower than the stage road, no kerbs or sidewalks.
 */
const SUMMIT_ROAD = '656,-343';
/** The service road that merges into the summit road above the finish (first point, rounded). */
const MERGING_SERVICE = '435,-535';
/**
 * The service road past the restaurant (first > last point of the BAKED way, rounded): the parking in front of the building covers
 * its stretch there, so it is cut to end at the parking's east edge, where the gate stands (`landmarks/restaurant.ts`).
 */
const RESTAURANT_ROAD = '532,-430>464,-463';

/** The nearest point of a flat polyline [x0, z0, x1, z1, ...] to (x, z). */
function snapToRoute(road: number[], x: number, z: number): [number, number] {
  let best: [number, number, number] = [x, z, Infinity];
  for (let i = 2; i < road.length; i += 2) {
    const x0 = road[i - 2];
    const z0 = road[i - 1];
    const dx = road[i] - x0;
    const dz = road[i + 1] - z0;
    const t = Math.max(
      0,
      Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)),
    );
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best[2]) best = [px, pz, d];
  }
  return [best[0], best[1]];
}

/**
 * Walks the end of a way back until it is `clear` m from another way's centre line, so the two ribbons meet at the
 * other's edge instead of lying over each other (they have different textures: a service road is light tarmac, the
 * summit road city asphalt).
 */
function trimEnd(pts: number[], other: number[], clear: number): number[] {
  const out = pts.slice();
  while (out.length > 4) {
    const n = out.length;
    const ax = out[n - 4];
    const az = out[n - 3];
    const bx = out[n - 2];
    const bz = out[n - 1];
    const near = (x: number, z: number): number => {
      const [px, pz] = snapToRoute(other, x, z);
      return Math.hypot(x - px, z - pz);
    };
    if (near(bx, bz) >= clear) return out;
    // The point on the last segment where it first reaches the clearance (from the far end), else drop the segment.
    for (let t = 0.98; t >= 0; t -= 0.02) {
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (near(x, z) >= clear) {
        out[n - 2] = x;
        out[n - 1] = z;
        return out;
      }
    }
    out.length = n - 2;
  }
  return out;
}

/** Narrows the summit road, drops its sidewalks and joins its end to the stage road (OSM stops 13 m short of it). */
export const countryRoad = (paths: PathDef[]): PathDef[] => {
  const summit = paths.find(
    (p) => `${Math.round(p.pts[0])},${Math.round(p.pts[1])}` === SUMMIT_ROAD,
  );
  return paths.map((p) => {
    const key = `${Math.round(p.pts[0])},${Math.round(p.pts[1])}`;
    if (p === summit)
      return {
        ...p,
        width: 5,
        bare: true,
        pts: [...snapToRoute(LOT_ROADS[1], p.pts[0], p.pts[1]), ...p.pts],
      };
    // The street "Сончев Град" ends at the knot of arcs dropped above, 14 m short of the hairpin (the engine's own extension misses
    // it: the hairpin curves away): two points run it on to the stage road's edge, in line with its last stretch.
    if (
      `${pointKey(p.pts[0], p.pts[1])}>${pointKey(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1])}` ===
      '2162,-58>2166,-38'
    )
      return { ...p, pts: [2152.6, -67.8, 2157.6, -63, ...p.pts] };
    // The service road that merges into it above the finish ends at its centre line (within the engine's 0.5 m anchor reach of the
    // road's edge, `terrain-gen.ts` `anchor`, so it is eased to the road's height instead of ending 1.4 m above it) and lies
    // under the summit road's ribbon there (`joinsUnder`): its square end is covered by the road, not poking out of its edge.
    if (
      `${key}>${pointKey(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1])}` ===
      RESTAURANT_ROAD
    )
      return {
        ...p,
        pts: [
          p.pts[0],
          p.pts[1],
          ...toWorld(RESTAURANT, PLAZA.x1 + 0.05, roadZ(PLAZA.x1 + 0.05)),
        ],
      };
    if (key === MERGING_SERVICE && summit)
      return {
        ...p,
        pts: trimEnd(p.pts, summit.pts, 0.3),
        joinsUnder: true,
        mergeTaper: 16,
      };
    return p;
  });
};
