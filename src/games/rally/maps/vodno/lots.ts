import type { PadDef, PathDef } from '../shared/types';
import { LOT_ROADS } from './landmarks/lot-road';
import { PLAZA, roadZ } from './landmarks/restaurant';
import {
  LOT_WEST_X,
  RESTAURANT,
  SREDNO_BANDS,
  SREDNO_LOT,
  toWorld,
} from './landmarks/sites';
import {
  GARDEN,
  gardenMeshSink,
  gardenFlightPolygon,
  gardenPadPolygon,
  lawnPolygons,
  rampPad,
  vidikovecVerge,
} from './landmarks/lot-park';
import {
  lotMeshSink,
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
/**
 * The Vidikovec's level (world m, the ground under its slab) at the garden's west end (R1): the stage road's height there
 * less the pad's 30 cm. West of `VIDIKOVEC_MOUTH_X` (lot-local x) its mouth follows the road down to the west tip.
 */
const VIDIKOVEC_LEVEL = 133.2;
/**
 * East of the mouth the lot and its garden levels climb `VIDIKOVEC_RISE` m to the far end, an even slope gentler than the
 * road's (about 5 m), so the wall along the road side grows to about 2 m there.
 */
const VIDIKOVEC_RISE = 2.8;
const vidikovecRise = (lift: number): PadDef['ramp'] => ({
  from: toWorld(VIDIKOVEC.site, 1, -5) as [number, number],
  to: toWorld(VIDIKOVEC.site, -60, 3.5) as [number, number],
  lift: [lift, lift + VIDIKOVEC_RISE],
  linear: true,
});
const VIDIKOVEC_MOUTH_X = 1;
/**
 * The mouth west of it: an even slope from the road's height at the west tip (the slab's top at the road, lot-local x 33.7)
 * up to `VIDIKOVEC_LEVEL` at `VIDIKOVEC_MOUTH_X`, level across (the road's own heights would tilt it and leave a step there).
 */
const vidikovecMouthRamp: PadDef['ramp'] = {
  from: toWorld(VIDIKOVEC.site, 33.7, -1) as [number, number],
  to: toWorld(VIDIKOVEC.site, VIDIKOVEC_MOUTH_X, -5) as [number, number],
  lift: [-2.64, 0],
  linear: true,
};
const vidikovecMouth = (c: [number, number]): boolean =>
  c[0] > VIDIKOVEC_MOUTH_X;
const VIDIKOVEC_FRONTAGE = [
  1500.2, -557.2, 1535, -574.6, 1553, -580.7, 1570.4, -584.9, 1591.3, -584.5,
  1603.7, -581.2,
];

export const LOT_PADS: PadDef[] = [
  // The Vidikovec: at `VIDIKOVEC_LEVEL`, rising `VIDIKOVEC_RISE` to its far end (its mouth at the west tip follows the road down to it), the verge between the
  // road and its wall at the road's level, the garden's three levels behind it (landmarks/lot-park.ts `GARDEN`), the lower
  // first; then the slab's own ground once more (a lower level's blend reaches under it) and the stone steps at the east end.
  // The ones under the road's level `hold` it over the road's embankment.
  {
    name: 'vidikovec_lot',
    polygon: lotPolygon(VIDIKOVEC, GRADED_MARGIN),
    // (a long, gentle embankment down to the land, no cliff under the west kerb)
    blend: 14,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecRise(0),
  },
  {
    name: 'vidikovec_mouth',
    polygon: lotPolygon(VIDIKOVEC, GRADED_MARGIN, vidikovecMouth),
    blend: 6,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecMouthRamp,
  },
  {
    name: 'vidikovec_verge',
    polygon: vidikovecVerge(),
    blend: 2,
    frontage: VIDIKOVEC_FRONTAGE,
    lift: PAD_LIFT + SLAB,
  },
  ...(
    [
      [1, 'green', 6],
      [0, 'red', 0.1],
      [2, 'grey', 0.1],
    ] as const
  ).map(([k, name, blend]): PadDef => ({
    name: `vidikovec_garden_${name}`,
    polygon: gardenPadPolygon(k),
    // (the green terrace falls away to the land below as a grassed embankment)
    blend,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecRise(SLAB + GARDEN.level[name]),
    hold: true,
  })),
  {
    name: 'vidikovec_slab',
    polygon: lotPolygon(VIDIKOVEC, 0.4),
    blend: 0.1,
    // (well under the road at its east end: the road's embankment must not reach in over it)
    hold: true,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecRise(0),
  },
  {
    name: 'vidikovec_mouth_slab',
    polygon: lotPolygon(VIDIKOVEC, 0.4, vidikovecMouth),
    blend: 0.1,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecMouthRamp,
    hold: true,
  },
  // The ground under the two flights down from the lot, at the terrace each leads to (the slab's edge pad reaches under them).
  ...(['green', 'red'] as const).map((name): PadDef => ({
    name: `vidikovec_flight_${name}`,
    polygon: gardenFlightPolygon(name),
    blend: 0.1,
    level: VIDIKOVEC_LEVEL,
    ramp: vidikovecRise(SLAB + GARDEN.level[name]),
    hold: true,
  })),
  // The stone steps from the lot's east end down to the green terrace (`drawGarden`): a sloped pad, applied last.
  (() => {
    const { polygon, from, to } = rampPad();
    return {
      name: 'vidikovec_garden_steps',
      polygon,
      blend: 3,
      // (at the lot's far end: all of its rise)
      level: VIDIKOVEC_LEVEL + VIDIKOVEC_RISE,
      hold: true,
      ramp: {
        from,
        to,
        lift: [SLAB + GARDEN.level.green, 0] as [number, number],
      },
    };
  })(),
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
    // The strip of land between the two lots, levelled with them (left at its own height it stood ~0.8 m above both
    // by the road, a kerbed ramp off the road's edge; the real one is flush): from the road (clipped to its clearance)
    // to the lots' west line.
    name: 'sredno_between',
    polygon: (
      [
        [-75, SREDNO_BANDS.low[1] - 0.5],
        [LOT_WEST_X, SREDNO_BANDS.low[1] - 0.5],
        [LOT_WEST_X, SREDNO_BANDS.top[0] + 0.5],
        [-75, SREDNO_BANDS.top[0] + 0.5],
      ] as const
    ).flatMap(([x, z]) => toWorld(SREDNO_LOT, x, z)),
    blend: 3,
    frontage: [
      497.1, -315.3, 520.2, -321.7, 540.3, -327.9, 560.9, -331.8, 584.8, -332.6,
    ],
    lift: -0.05,
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
    // Its mouth (car-parks.ts `buildMouth`): the verge between the road's edge and the lot's end graded to one even slope,
    // from the road's level up to the slab's, so the apron lies flat on it.
    name: 'trail_mouth',
    polygon: [
      2086.6, -204, 2094.6, -207.6, 2091, -213.4, 2087.8, -219.8, 2086.6, -223,
    ],
    blend: 3,
    frontage: [2083.3, -224, 2084, -204],
    ramp: {
      from: [2086.9, -213.4],
      to: [2090.5, -213.4],
      lift: [-0.03, PAD_LIFT],
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
  {
    // The gravel pull-off at ~2 300 m on the left going up (the owner's photos): a gazebo stands on it and hikers park
    // there; flush with the road's edge, cut into the rising bank behind.
    name: 'gazebo_pulloff',
    polygon: [
      1942.4, -225.2, 1935.7, -226.1, 1927.3, -229.3, 1921.2, -236.1, 1921.4,
      -244.6, 1926.3, -252.5, 1931.8, -258.6, 1934.7, -263.1, 1936.1, -263.1,
      1943.7, -225.8,
    ],
    // (7 m: a footpath crosses the road 7.5 m off its corner)
    blend: 7,
    frontage: [
      1948.3, -224.3, 1945.2, -232.4, 1942.8, -240.6, 1940.9, -249, 1939.8,
      -257.5, 1939.7, -266.1,
    ],
    // (rising gently away from the road, as the bank behind does: flat at the road's edge, 1.4 m up at the back)
    ramp: { from: [1938.8, -241.5], to: [1922.9, -237.7], lift: [-0.1, 1.4] },
    surface: 'gravel',
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
const vidikovecCut = lotMeshSink(VIDIKOVEC);
/** The drawn terrain's cut at the Vidikovec's walls and its garden's (`MapDef.terrain.meshSink`): the larger one. */
export const LOT_MESH_SINK = (
  x: number,
  z: number,
  height: (x: number, z: number) => number,
): number => {
  const a = vidikovecCut(x, z, height);
  const b = gardenMeshSink(x, z, height);
  return Math.abs(a) >= Math.abs(b) ? a : b;
};

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
