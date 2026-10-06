import {
  buildingsFromData,
  fitBridgesToStreets,
  lengthenBridges,
  routePoints,
  routeSpans,
} from '../shared/real-map';
import type {
  HeightmapDef,
  LakeDef,
  LandcoverDef,
  MapDef,
  PathDef,
  PlazaIsland,
} from '../shared/types';
import data from './data.json';
import junction from './junction.json';
import laneStart from './junction-lane-start.json';
import { jackieInfo as info } from './info';

/**
 * "Jackie Robinson Parkway" - real-world city stage in New York: from Vermont Street (East New York,
 * Brooklyn) north-east along the 1930s Interboro / Jackie Robinson Parkway through the Cemetery of the
 * Evergreens, Highland Park, Cypress Hills Cemetery, Mount Lebanon and Forest Park to the Union Turnpike /
 * Grand Central Parkway interchange in Kew Gardens (Queens). 7.3 km, one carriageway of a divided parkway.
 *
 * Terrain (USGS 3DEP lidar bare earth), land cover (ESA WorldCover + OSM), roads, buildings (OSM with the
 * NYC roof heights, only 500 m either side of the stage) and the route are baked from open data by
 * `python scripts/realmap/bake.py scripts/realmap/jackie.json` into ./data.json - see ./DETAILS.md.
 * Edit THIS file for gameplay / look; re-bake only to change the source data.
 * World (0, 0) = 40.698 N, -73.863 E; +X east, +Z south. Task list: ./TODO.md.
 */

/** Covers where dry / mown grass grows (detail layer). */
const LAWN = ['grass', 'shrub', 'bare', 'cemetery'];

/**
 * The on-ramp behind the start (OSM way 126109619, from the Highland Blvd ramps under the Highland Blvd bridge to the
 * start waypoint). The route begins part-way along that way and the bake drops every way the route uses, so the
 * piece before route point 0 was missing (the stage road ended in the grass behind the start). Ends exactly on the
 * stage road's first point, at the stage road's width. OSM tags it motorway_link; `motorway` here gives it the stage
 * road's parkway lane markings (a link gets plain tarmac).
 */
const START_RAMP: PathDef = {
  kind: 'motorway',
  width: 7.4,
  surface: 'tarmac',
  oneway: true,
  lanes: 2,
  pts: [
    -2847.1,
    2009.4,
    -2841.3,
    2006.6,
    -2836.0,
    2003.7,
    -2830.7,
    1999.7,
    -2826.1,
    1995.3,
    -2822.2,
    1991.4,
    -2818.8,
    1987.1,
    -2816.1,
    1982.8,
    -2813.7,
    1978.2,
    -2811.7,
    1972.3,
    -2810.5,
    1967.0,
    -2809.5,
    1960.8,
    -2809.3,
    1955.3,
    -2809.5,
    1949.9,
    -2810.2,
    1944.1,
    ...data.route[0],
  ],
};
/**
 * Park Lane over the Union Tpke overlook deck (6 720 m): 4 lanes (OSM `lanes=4`; the bake makes every residential street
 * 5 m wide). The OSM pieces (two deck halves 4 m out of line, the south approach) become ONE straight 13 m path from
 * 40 m north of the deck to just past the south junction: one deck in the middle (bridgeOverUnderSpans), full width to
 * both deck ends; the lane drop to the 5 m one-way street north of it is on the ground. South of the junction OSM has
 * 3 lanes to the Forest Park Dr fork (10 m) and 2 beyond it (7 m): the widths step down, so no wide street end owns the
 * land of the narrow one past the fork (PathNetwork.query takes the full width; terrain came up through the lanes).
 * Matched by end points (path indices shift on a re-bake).
 */
const PARK_LANE_N: [number, number] = [2272.5, -1535.1];
const PARK_LANE_S: [number, number][] = [
  [2290.1, -1515.6],
  [2295.1, -1509.0],
  [2305.7, -1497.0],
];
function parkLane(list: PathDef[]): PathDef[] {
  const near = (x: number, z: number, [px, pz]: [number, number]) =>
    Math.hypot(x - px, z - pz) < 2;
  const out: PathDef[] = [];
  let cut: number[] | undefined;
  for (const p of list) {
    const n = p.pts.length;
    const ends: [number, number][] = [
      [p.pts[0], p.pts[1]],
      [p.pts[n - 2], p.pts[n - 1]],
    ];
    // The OSM pieces of the 4-lane street (dropped, replaced below).
    if (
      p.kind === 'residential' &&
      (p.lanes ?? 0) >= 3 &&
      ends.some(([x, z]) =>
        [PARK_LANE_N, PARK_LANE_S[0], [2289, -1517] as [number, number]].some(
          (e) => near(x, z, e),
        ),
      )
    )
      continue;
    // Park Lane beyond the fork: 2 lanes.
    if (
      p.kind === 'residential' &&
      p.lanes === 2 &&
      ends.some(([x, z]) => near(x, z, PARK_LANE_S[2]))
    )
      out.push({ ...p, width: 7 });
    // The one-way street north of it loses its last 40 m to the 4-lane path.
    else if (
      p.kind === 'residential' &&
      !p.lanes &&
      near(...ends[1], PARK_LANE_N) &&
      n >= 4
    ) {
      const [ax, az, bx, bz] = p.pts.slice(n - 4);
      const t = 1 - 40 / Math.hypot(bx - ax, bz - az);
      if (t > 0.1) {
        cut = [ax + (bx - ax) * t, az + (bz - az) * t];
        out.push({ ...p, pts: [...p.pts.slice(0, n - 2), ...cut] });
      } else out.push(p);
    } else out.push(p);
  }
  if (!cut) return list;
  out.push({
    kind: 'residential',
    width: 13,
    surface: 'tarmac',
    lanes: 4,
    pts: [...cut, ...PARK_LANE_N, ...PARK_LANE_S.slice(0, 2).flat()],
  });
  out.push({
    kind: 'residential',
    width: 10,
    surface: 'tarmac',
    lanes: 3,
    pts: PARK_LANE_S.slice(1).flat(),
  });
  return out;
}
/**
 * OSM nodes moved (from -> to, m): the Union Tpke service roads beside the overlook slab hug the cut so closely that
 * their inner lanes lay over the open trench (the ribbon edge curled down into it) or on the wall's fence line. 1.5-2 m
 * away from the parkway; nothing else uses these nodes.
 */
const MOVED_NODES: [number, number, number, number][] = [
  [2264.0, -1526.7, 2262.7, -1528.3],
  [2239.6, -1505.9, 2238.3, -1507.5],
  // South service road east of the slab: its inner lane lay on the wall top / fence line.
  [2298.7, -1524.0, 2299.6, -1522.8],
];
const moveNodes = (list: PathDef[]): PathDef[] =>
  list.map((p) => {
    let pts: number[] | undefined;
    for (let k = 0; k < p.pts.length; k += 2)
      for (const [fx, fz, tx, tz] of MOVED_NODES)
        if (Math.hypot(p.pts[k] - fx, p.pts[k + 1] - fz) < 0.2) {
          pts ??= [...p.pts];
          pts[k] = tx;
          pts[k + 1] = tz;
        }
    return pts ? { ...p, pts } : p;
  });
/**
 * East of the Queens Blvd portal the land is at the parkway's level: the westbound Union Tpke runs on into the inner
 * lane's bore. OSM ends it on the junction node at the slab corner, so it climbed 6 m in its last 40 m onto the junction
 * box and cut across the trench corner. Split at this node, its last 80 m become a parkway lane (stage-road level, into
 * the bore); the service road beside it keeps clear of it (parkway-lanes.ts).
 */
const UNION_TPKE_EAST_LANE: [number, number] = [2817.0, -1862.5];
/** Split the way with an inner node at (x, z) into two ways sharing that node. */
const splitAt = (list: PathDef[], [x, z]: [number, number]): PathDef[] =>
  list.flatMap((p) => {
    for (let k = 2; k + 2 < p.pts.length; k += 2)
      if (Math.hypot(p.pts[k] - x, p.pts[k + 1] - z) < 0.2)
        return [
          { ...p, pts: p.pts.slice(0, k + 2) },
          { ...p, pts: p.pts.slice(k) },
        ];
    return [p];
  });
/**
 * The eastbound mirror: the inner lane ended at the east headwall (OSM leaves a 20 m gap to the Union Tpke beyond it, where
 * the at-grade service road from the junction box meets it). A lane piece (`UNION_TPKE_EB_LANE`) continues the bore to a
 * node 47 m along that street; the service road runs on beside it (outside the cut wall) and joins there.
 */
const UNION_TPKE_EB_JOIN: [number, number] = [2814.2, -1830.1];
const UNION_TPKE_EB_LANE: PathDef = {
  kind: 'primary',
  name: 'Union Turnpike',
  width: 8,
  surface: 'tarmac',
  oneway: true,
  lanes: 2,
  junction: false,
  pts: [2746.7, -1817.4, ...UNION_TPKE_EB_JOIN],
};
const unionTpkeEast = (list: PathDef[]): PathDef[] =>
  list.map((p) => {
    const [x0, z0] = [p.pts[0], p.pts[1]];
    const [x1, z1] = [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]];
    // The street beyond: starts at the join node.
    if (Math.hypot(x0 - 2766.7, z0 + 1814.6) < 0.2 && p.kind === 'secondary')
      return { ...p, pts: [...UNION_TPKE_EB_JOIN, ...p.pts.slice(2)] };
    // The service road from the junction box: beside the lane, then into the join node.
    if (Math.hypot(x1 - 2766.7, z1 + 1814.6) < 0.2)
      return {
        ...p,
        pts: [
          ...p.pts.slice(0, -2),
          2768.9,
          -1812.3,
          2792.9,
          -1816.8,
          ...UNION_TPKE_EB_JOIN,
        ],
      };
    return p;
  });
const paths = [
  ...unionTpkeEast(
    splitAt(parkLane(moveNodes(data.paths as PathDef[])), UNION_TPKE_EAST_LANE),
  ),
  START_RAMP,
  UNION_TPKE_EB_LANE,
];

// The Union Tpke overlook slab (OSM tunnel 6 708-6 733 m) is as wide as Park Lane on top: 13 m street + kerbs and
// 1.5 m sidewalks, centred on the crossing (6 719.75 m, nearly square to the road).
const baseSpans = routeSpans(data.routeSpans).map((s) =>
  s.kind === 'under' && Math.abs(s.from - 6708) < 1
    ? { ...s, from: 6711, to: 6728.5 }
    : s,
);
const fittedSpans = fitBridgesToStreets(baseSpans, data.route, paths as never, {
  left: 20,
  right: -9,
  margin: 9,
  maxGrow: 40,
});
// Long spans keep their length, except where a skewed street trench reaches the road edge just past an end (B6: a
// sliver of verge hung over the trench at the deck corner) - a few metres at most.
const edgeFitted = fitBridgesToStreets(baseSpans, data.route, paths as never, {
  left: 9,
  right: -9,
  margin: 6,
  maxGrow: 10,
  maxCos: 0.97,
});
const bridgeSpans = lengthenBridges(
  baseSpans.map((s, i) =>
    s.kind !== 'bridge'
      ? s
      : s.to - s.from < 36
        ? fittedSpans[i]
        : edgeFitted[i],
  ),
  36,
);

/** Headwall skew of the Queens Blvd portal (m along / m lateral at its start / end): parallel to Queens Blvd. */
const QUEENS_BLVD_SKEW: [number, number] = [-0.26, -0.46];

export const jackieMap: MapDef = {
  ...info,
  buildings: buildingsFromData(data.buildings),
  terrain: {
    baseHeight: 0,
    // Shift so the start (16.5 m above sea level) sits near y = 0.
    heightmap: { ...(data.heightmap as HeightmapDef), offset: 16.5 },
    layers: [{ scale: 22, amplitude: 0.12, octaves: 2 }],
    edgeRise: 0,
    // Parkway cuts / fills are grassed slopes, not bare rock.
    rockSlope: [0.5, 0.75],
    flatAreas: [],
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // [grass, dirt, rock, gravel] - the city reads as pavement / concrete (rock + gravel greys).
    splat: {
      grass: [0.92, 0.06, 0.02, 0],
      shrub: [0.7, 0.25, 0.05, 0],
      pine: [0.6, 0.4, 0, 0],
      trees: [0.78, 0.2, 0.02, 0],
      orchard: [0.8, 0.2, 0, 0],
      urban: [0.12, 0.08, 0.5, 0.3],
      industrial: [0.05, 0.05, 0.4, 0.5],
      bare: [0.2, 0.5, 0.1, 0.2],
      water: [0.5, 0.5, 0, 0],
      vineyard: [0.3, 0.7, 0, 0],
      cemetery: [0.88, 0.1, 0.02, 0],
      crop: [0.9, 0.1, 0, 0],
    },
  },
  paths,
  lakes: data.lakes as LakeDef[],
  road: {
    // One carriageway of the parkway: two narrow lanes, no real shoulder, concrete barriers each side.
    width: 7.4,
    shoulder: 0.5,
    ditch: 0,
    crown: 0.02,
    // Long vertical curves: at 140 km/h a short crest would launch the car.
    smoothing: 120,
    maxGrade: 0.07,
    // +7 % -> -7 % within 16 m (1.88 km) launched a car at 150 km/h: round the grade changes over 50 m.
    gradeSmoothing: 50,
    surface: 'tarmac',
    texture: 'road_parkway',
    // Where the parkway runs on a bridge over a street (OSM bridge=yes): deck over lowered ground.
    // Short bridges (under 36 m) grow to hold the whole street crossing beneath them (skewed: the footprint along the
    // parkway is longer than the street is wide) + room for the abutment returns and the underpass walls, and are at
    // least 36 m long. The long ones are left as they are.
    // The Queens Blvd portal's ends follow Queens Blvd on top (skewed headwalls, the slab shortened at the corners).
    spans: bridgeSpans.map((s) =>
      s.kind === 'under' && s.from > 7100
        ? { ...s, skew: QUEENS_BLVD_SKEW }
        : s,
    ),
    // Cuts deeper than 2.5 m are sheer, held back by a stone retaining wall (the parkway runs sunken there).
    // Stone walls + picket railing on the old parkway; concrete + chain-link from the Kew Gardens approach on.
    cutWalls: { minHeight: 2.5, offset: 1.6, concreteFrom: 6900 },
    // The lidar has a void where the parkway descends into the Kew Gardens trench (7 040-7 190 m: the land reads
    // 5-10 m BELOW the road): the Union Turnpike service roads and the street grid sit at the rim of the trench.
    // Same at the Union Tpke overlook (6 711-6 728 m): the service roads at the rim of the cut overlapped the cut slope
    // (their inner lanes over the trench floor, terrain through the asphalt); depths follow the streets' height.
    trenchFills: [
      { from: 7035, to: 7186, halfWidth: 75, depth: [0.3, 5.6] },
      { from: 6706, to: 6732, halfWidth: 30, depth: [5.5, 5.6] },
      { from: 6732, to: 6765, halfWidth: 30, depth: [5.6, 1.0] },
    ],
    // The baked route ends at the Union Turnpike (7 345 m); the finish is past the Queens Blvd portal, so the stage
    // road runs on along the turnpike (OSM primary, same direction) for ~90 m: the run-out to stop in. Not baked
    // (moving the end waypoint makes the baker take another route).
    points: routePoints(info.route, () => 7.4),
  },
  scatter: [
    // Forest Park / cemetery woodland: oaks, birches and a few pines.
    {
      asset: 'oak_tree',
      cover: ['trees'],
      density: 12,
      minRoadDist: 3.2,
      maxSlope: 0.7,
      scale: [0.8, 1.35],
      tilt: 3,
      sink: 0.25,
    },
    {
      asset: 'birch_tree',
      cover: ['trees'],
      density: 3,
      minRoadDist: 3.2,
      mask: { scale: 200, threshold: 0.1 },
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.25,
    },
    {
      asset: 'pine_tree',
      cover: ['trees', 'pine'],
      density: 3,
      minRoadDist: 3.5,
      mask: { scale: 260, threshold: 0.3 },
      scale: [0.7, 1.1],
      tilt: 2,
      sink: 0.3,
    },
    {
      asset: 'bush',
      cover: ['trees'],
      density: 6,
      minRoadDist: 2,
      scale: [0.8, 1.4],
      sink: 0.1,
    },
    // Cemetery lawn + park meadow: scattered ornamental trees.
    {
      asset: 'oak_tree',
      cover: ['cemetery', 'grass'],
      density: 1.2,
      minRoadDist: 4,
      mask: { scale: 160, threshold: -0.05 },
      scale: [0.7, 1.15],
      tilt: 3,
      sink: 0.2,
    },
    {
      asset: 'pine_tree',
      cover: ['cemetery'],
      density: 0.8,
      minRoadDist: 4,
      scale: [0.6, 0.95],
      sink: 0.25,
    },
    // Street trees in the built-up grid.
    {
      asset: 'birch_tree',
      cover: ['urban'],
      density: 0.9,
      minRoadDist: 4,
      minPathDist: 2.5,
      scale: [0.7, 1],
      sink: 0.1,
    },
    {
      asset: 'rock_small',
      cover: ['trees', 'shrub'],
      density: 0.6,
      minRoadDist: 1.4,
      scale: [0.6, 1.2],
      alignToGround: true,
      sink: 0.08,
    },
    // Detail: mown grass, greener tufts under the trees.
    {
      asset: 'spring_grass',
      cover: LAWN,
      density: 200,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.3],
    },
    {
      asset: 'grass_tuft',
      cover: ['trees', 'pine', 'orchard'],
      density: 140,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
  ],
  // Concrete parapets on the bridges, a continuous Jersey wall along the median side and a steel guard
  // rail on the outer side everywhere else (broken across the mouths of ramps / side roads).
  barriers: [
    { kind: 'jersey', side: 'both', offset: 0.45, onBridge: true },
    {
      kind: 'jersey',
      side: 'left',
      offset: 0.45,
      onBridge: false,
      // The left side is the median: a street there only meets the parkway across the opposite carriageway, so the
      // wall is broken just wide enough for the closed mouth (the right-hand guard rail keeps a long ramp gap).
      skipJunctions: 4,
    },
    {
      kind: 'guardrail',
      side: 'right',
      offset: 0.55,
      onBridge: false,
      skipJunctions: 12,
    },
  ],
  // The opposite carriageway (a path) gets the same walls: Jersey on the median side, guard rail outside.
  pathBarriers: {
    kinds: ['motorway'],
    minWidth: 5.5,
    median: { kind: 'jersey', offset: 0.45 },
    outer: { kind: 'guardrail', offset: 0.55 },
    medianReach: 40,
  },
  // The inner Union Turnpike lanes run down in the parkway's cut beside its carriageways (4 roadways side by side,
  // the outer Union Tpke service roads at grade): OSM has them as primary streets.
  parkwayLanes: { kinds: ['primary'], names: ['Union Turnpike'], reach: 22 },
  // Parked cars on the side streets, crowds on the overpasses and behind the closed junction mouths, police
  // cars and fire trucks standing at the junctions (all derived from the road network, see world/street-dressing.ts).
  // Kerbs, sidewalks, crosswalks and lamps on the streets within 500 m of the parkway (world/street-detail.ts).
  cityStreets: { reach: 500, sidewalk: 1.5, lampEvery: 34 },
  streetDressing: {
    parked: {
      kinds: [
        'residential',
        'service',
        'tertiary',
        'secondary',
        'unclassified',
        'living_street',
      ],
      reach: 130,
      fill: 0.25,
      taxiShare: 0.07,
    },
    spectators: { perDeck: 7, perJunction: 5, reach: 400 },
    // NYC: police, ambulance and fire truck at nearly every closed mouth.
    emergency: { police: 0.85, fire: 0.4, ambulance: 0.55 },
  },
  roadside: [
    // Cobra-head lamp posts along both sides of the parkway (on the verge behind the barriers).
    {
      asset: 'street_lamp',
      every: 38,
      side: 'both',
      offset: 1.25,
      faceRoad: true,
      skipJunctions: 8,
      scale: [1.05, 1.1],
    },
    {
      asset: 'chevron_sign',
      every: 16,
      maxRadius: 90,
      side: 'outside',
      offset: 2.5,
      faceRoad: true,
    },
    // Crowds at the start, the split points and the finish (behind the guard rail / Jersey wall).
    {
      asset: 'spectator',
      at: [
        30, 62, 95, 1470, 1495, 2910, 2935, 4350, 4375, 5790, 5815, 7120, 7160,
        7205, 7298,
      ],
      side: 'both',
      offset: 3.4,
      count: 6,
      spread: 12,
      depth: 3.5,
      faceRoad: true,
      scale: [0.95, 1.05],
    },
  ],
  // Side roads / ramps meeting the stage road are closed with barriers (as on a real stage).
  junctionBarriers: { asset: 'road_barrier', length: 2.2, setback: 4 },
  // Green guide signs on steel gantries: "EXIT n" before every ramp leaving the parkway, and the real sequence of
  // boards at the Kew Gardens end (plain road names, no route shields).
  goreAreas: true,
  junctionPlazas: [
    // Park Lane x Union Tpke at both ends of the overlook slab (6 720 m): between the headwalls (never on the trench
    // rim beyond them, its fence stays), from inside the trench wall line (no slab edge parapet across Park Lane) to
    // past the Park Lane deck ends (no deck parapets / abutments across the Union Tpke mouths).
    [2279.4, -1514.1, 2293.0, -1525.1, 2301.2, -1515.0, 2287.6, -1504.0],
    [2269.6, -1526.3, 2283.2, -1537.3, 2275.3, -1547.0, 2261.7, -1536.0],
  ],
  // Medians, traffic islands and sidewalks on the Kew Gardens junction box: NYC Planimetric Database (NYC Open Data),
  // clipped to the box by scripts/realmap/plaza_islands.py.
  // The Kew Gardens junction: the street space within 40 m of the box (NYC Planimetric Database roadbed + sidewalks +
  // medians, NYC Open Data), see scripts/realmap/plaza_islands.py.
  // ... and the street space where the inner Union Tpke lanes start (~6 960 m): the service roads, the lane mouths.
  // Both keep the street ribbons: the same road look and painted lines as the streets leading to them.
  ribbonAreas: [junction.area, laneStart.area],
  plazaIslands: [...junction.islands, ...laneStart.islands] as PlazaIsland[],
  // The signalled zebra crossings around it: OSM ways tagged crossing:markings=zebra (same script).
  plazaCrosswalks: [...junction.crosswalks, ...laneStart.crosswalks],
  // Signals: OSM traffic_signals nodes; trees: NYC Street Tree Census 2015 (same script).
  plazaSignals: [...junction.signals, ...laneStart.signals],
  plazaTrees: [...junction.trees, ...laneStart.trees],
  overheadSigns: {
    exits: true,
    signs: [
      {
        along: 6960,
        boards: [
          {
            tab: 'EXITS 8 E-W',
            lines: ['Grand Central Pkwy', 'Eastern Long Island'],
            small: '3/4 MILE',
            arrow: 'down',
          },
          {
            tab: 'EXIT 7',
            lines: ['Van Wyck Expwy', 'Bronx'],
            small: '1/4 MILE',
            arrow: 'right',
          },
        ],
      },
      {
        along: 7300,
        boards: [
          { tab: 'EXITS 8 E-W', lines: ['Grand Central Pkwy'], arrow: 'down' },
          { tab: 'EXIT 7', lines: ['Van Wyck Expwy', 'Bronx'], arrow: 'right' },
        ],
      },
    ],
  },
  // Start / finish gantries, lines and split boards come from `stage` (world/stage-signs.ts).
  props: [],
};
