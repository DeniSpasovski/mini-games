import {
  type CarriagewayShift,
  shiftCarriageways,
} from '../shared/carriageway-shift';
import { decksInOutline, extendDecks } from '../shared/deck-fit';
import { type ShiftKey, shiftRoute } from '../shared/route-shift';
import { type StreetShift, shiftStreets } from '../shared/street-shift';
import {
  buildingsFromData,
  fitBridgesToStreets,
  lengthenBridges,
  routePoints,
  routeSpans,
} from '../shared/real-map';
import type {
  HeightmapDef,
  HorizonDef,
  LakeDef,
  LandcoverDef,
  MapDef,
  PathDef,
  PlazaIsland,
} from '../shared/types';
import data from './data.json';
import retainingWalls from './retaining-walls.json';
import spotHeights from './spot-heights.json';
import horizon from './horizon.json';
import junction from './junction.json';
import junctionCores from './junction-cores.json';
import streetTrees from './street-trees.json';
import routeShiftKeys from './route-shift.json';
import routeWidthKeys from './route-width.json';
import streetShifts from './street-shifts.json';
import carriagewayShifts from './carriageway-shift.json';
import laneStart from './junction-lane-start.json';
import { JACKIE_RAW_ROUTE, jackieInfo as info } from './info';

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

/**
 * Width of the stage road (m) `a` m along the route: the real carriageway (NYC planimetric roadbed minus the medians,
 * `route-width.json` from scripts/realmap/parkway_width.py): two narrow lanes, 5.6-7.0 m, smoothed over ~200 m (the
 * finish cut's tunnel bores and walls follow it).
 */
function roadWidth(a: number): number {
  const k = routeWidthKeys as [number, number][];
  if (a <= k[0][0]) return k[0][1];
  if (a >= k[k.length - 1][0]) return k[k.length - 1][1];
  let i = 0;
  while (k[i + 1][0] < a) i++;
  const t = (a - k[i][0]) / (k[i + 1][0] - k[i][0] || 1);
  return k[i][1] + (k[i + 1][1] - k[i][1]) * t;
}

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
  width: roadWidth(0),
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
 * 5 m wide). The OSM pieces (two deck halves 4 m out of line, the south approach) become ONE straight 15.2 m path from
 * 40 m north of the deck to just past the south junction: one deck in the middle (bridgeOverUnderSpans), full width to
 * both deck ends; the lane drop to the 5 m one-way street north of it is on the ground. South of the junction OSM has
 * 3 lanes to the Forest Park Dr fork (10 m) and 2 beyond it (7 m): the widths step down, so no wide street end owns the
 * land of the narrow one past the fork (PathNetwork.query takes the full width; terrain came up through the lanes).
 * Matched by end points (path indices shift on a re-bake).
 */
/** NYC street data (CSCL street width 50 ft, scripts/realmap/streets.py): travel lanes and parking, curb to curb (m). */
const PARK_LANE_WIDTH = 15.2;
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
    width: PARK_LANE_WIDTH,
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
/**
 * Woodhaven Boulevard's main lanes under the parkway (B9, 4 750 m): OSM ways 1461894340 / 1461894342, tunnel=yes layer -1.
 * The bake drops street tunnels, so both directions ended at the parkway's edges and the lanes stood at deck level
 * under the bridge (the service roads beside them dipped). Added back between the baked ends: the underpass dip
 * (TerrainGenerator.dipUnderBridges) takes the whole boulevard down under the span.
 */
const WOODHAVEN_UNDER: PathDef[] = [
  [632.7, -630.4, 628.7, -636.9, 624.5, -643.1, 622.8, -645.5],
  [616.0, -644.2, 617.6, -642.0, 621.3, -636.4, 625.7, -629.4, 626.8, -627.4],
].map((pts) => ({
  kind: 'primary',
  name: 'Woodhaven Boulevard',
  width: 8,
  surface: 'tarmac',
  oneway: true,
  lanes: 2,
  pts,
}));

const basePaths = [
  ...unionTpkeEast(
    splitAt(parkLane(moveNodes(data.paths as PathDef[])), UNION_TPKE_EAST_LANE),
  ),
  START_RAMP,
  UNION_TPKE_EB_LANE,
  ...WOODHAVEN_UNDER,
];

/** Distance from (x, z) to the stage route (m). */
function routeDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < data.route.length; i++) {
    const [ax, az] = data.route[i];
    const [bx, bz] = data.route[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)),
    );
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}
/**
 * Street decks that stop over the road they cross (OSM bridge ways are shorter than the structure) are lengthened to
 * clear it (`maps/shared/deck-fit.ts`) - in the Kew Gardens grid and the interchange east of it (x > 2 000), never
 * within 25 m of the stage road (the approved B4 / B8 structures) or at the start bridge. The stage road's own spans
 * are fitted to the unextended streets (below).
 */
/**
 * The opposite carriageway sits at its real distance from the stage road (`carriageway-shift.json`, written by
 * scripts/realmap/carriageway_offset.py from the NYC roadbed; `maps/shared/carriageway-shift.ts`).
 * 57 streets whose OSM centre line is 0.8-3 m off the real pavement are moved onto it (`street-shifts.json`, written by
 * scripts/realmap/streets.py from the NYC roadbed; `maps/shared/street-shift.ts`: junction nodes move together, nodes that
 * touch a deck / ramp / hand-built street stay put). The stage road's spans are fitted to the unshifted streets (below).
 */
const shiftedPaths = shiftCarriageways(
  shiftStreets(basePaths, streetShifts as StreetShift[]).paths,
  carriagewayShifts as CarriagewayShift[],
).paths;
/**
 * The Highland Blvd bridge behind the start (Bushwick Ave end): one structure carries Highland Blvd and every ramp over
 * the parkway (NYC Planimetric Database transportation structure, 50 x 23 m; spot elevations 32.6-33.0 m all over it).
 * Every street / ramp inside the outline is deck; OSM had two narrow decks over the lanes only, the loop ramp sloping
 * down to the parkway between them and abutments standing at the lane edges.
 */
const START_DECK = [
  -2895.5, 2038.1, -2888.6, 2013.5, -2853.0, 2006.1, -2845.8, 2028.3,
];
/**
 * The loop ramp onto the start ramp (OSM motorway_link) ends on that deck where the bake dropped the way it merges into
 * (the stage route's own ramp): it joins the start ramp at the deck's east end.
 */
const LOOP_RAMP_END: [number, number] = [-2874.6, 2013.3];
/** (x, z) inside the outline `poly` ([x0, z0, x1, z1, ...]). */
function insideOutline(poly: number[], x: number, z: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi, xj, zj] = [
      poly[i * 2],
      poly[i * 2 + 1],
      poly[j * 2],
      poly[j * 2 + 1],
    ];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}
const START_RAMP_MERGE: [number, number] = [-2858.0, 2011.8];
const joinedPaths = shiftedPaths.map((p) => {
  const n = p.pts.length;
  if (
    p.kind !== 'motorway_link' ||
    Math.hypot(
      p.pts[n - 2] - LOOP_RAMP_END[0],
      p.pts[n - 1] - LOOP_RAMP_END[1],
    ) > 1
  )
    return p;
  return { ...p, pts: [...p.pts, ...START_RAMP_MERGE] };
});
const paths = decksInOutline(
  extendDecks(joinedPaths, {
    minX: 2000,
    skip: (x, z) => routeDistance(x, z) < 25,
  }).paths,
  START_DECK,
  (p) => /^(motorway|trunk)$/.test(p.kind),
);

// The Union Tpke overlook slab (OSM tunnel 6 708-6 733 m) is as wide as Park Lane on top: 15.2 m street + kerbs and
// 1.5 m sidewalks (18.5 m), centred on the crossing (6 719.75 m, nearly square to the road).
const baseSpans = routeSpans(data.routeSpans).map((s) =>
  s.kind === 'under' && Math.abs(s.from - 6708) < 1
    ? { ...s, from: 6710.5, to: 6729 }
    : s,
);
const fittedSpans = fitBridgesToStreets(
  baseSpans,
  data.route,
  basePaths as never,
  {
    left: 20,
    right: -9,
    margin: 9,
    maxGrow: 40,
  },
);
// Long spans keep their length, except where a skewed street trench reaches the road edge just past an end (B6: a
// sliver of verge hung over the trench at the deck corner) - a few metres at most.
const edgeFitted = fitBridgesToStreets(
  baseSpans,
  data.route,
  basePaths as never,
  {
    left: 9,
    right: -9,
    margin: 6,
    maxGrow: 10,
    maxCos: 0.97,
  },
);
/**
 * Stage-road bridges whose real structure is much longer than OSM's bridge way (NYC Planimetric Database transportation
 * structures, projected on the route: the deck spans the whole street below, its skewed corners included). B9 at
 * Woodhaven Blvd spans the main lanes, the medians and both service roads (80 m); Metropolitan Ave 90 m.
 */
const NYC_SPANS: Record<number, [number, number]> = {
  4729: [4710, 4790],
  6130: [6112, 6202],
};
const bridgeSpans = lengthenBridges(
  baseSpans.map((s, i) => {
    if (s.kind !== 'bridge') return s;
    const nyc = NYC_SPANS[Math.round(s.from)];
    // (the abutments are walls behind the sidewalks: a short fill ramp, the ground under the deck at street level)
    if (nyc) return { ...s, from: nyc[0], to: nyc[1], ramp: 3, open: true };
    return s.to - s.from < 36 ? fittedSpans[i] : edgeFitted[i];
  }),
  36,
);

/**
 * The stage road moved onto the real eastbound carriageway between 5 800 and 6 955 m (<= 1.5 m, mostly 1.1-1.5 m to the right;
 * `route-shift.json` from the NYC roadbed, scripts/realmap/route_offset.py; zero within 40 m of every bridge span, the
 * overlook and the approved finish cut). Everything keyed to a distance along the road goes through `along` (the same
 * place on the road gets its new distance). The baked spans were fitted to the streets on the unshifted road (above).
 */
const along = shiftRoute(
  routePoints(JACKIE_RAW_ROUTE, () => 7.4),
  routeShiftKeys as ShiftKey[],
).alongMap;

/** Height of the start above sea level (m): the heightmap's offset, so the start sits near y = 0. */
const START_HEIGHT = 32.9;
/**
 * NYC Planimetric Database spot elevations (`spot-heights.json`, scripts/realmap/spot_heights.py: m above sea level) in
 * world heights.
 */
const surveyed = (pts: number[][]): [number, number, number][] =>
  pts.map(([x, z, y]) => [x, z, y - START_HEIGHT]);

/** Headwall skew of the Queens Blvd portal (m along / m lateral at its start / end): parallel to Queens Blvd. */
const QUEENS_BLVD_SKEW: [number, number] = [-0.26, -0.46];
/**
 * ... and of the Myrtle Ave portal (B8, 4 511 m): the real bridge is a parallelogram (NYC Planimetric Database transportation
 * structure, Myrtle Ave crosses the parkway at ~37 deg): headwalls parallel to Myrtle Ave, not square to the parkway.
 */
const MYRTLE_AVE_SKEW: [number, number] = [-1.3, -1.27];

export const jackieMap: MapDef = {
  ...info,
  buildings: buildingsFromData(data.buildings),
  // Far land around the map as a backdrop (scripts/realmap/horizon.py): terrain + water only (bays, rivers), no
  // roads / buildings / trees - the config's `horizon.cover` keeps just the water channel.
  horizon: horizon as HorizonDef,
  terrain: {
    baseHeight: 0,
    heightmap: { ...(data.heightmap as HeightmapDef), offset: START_HEIGHT },
    layers: [{ scale: 22, amplitude: 0.12, octaves: 2 }],
    edgeRise: 0,
    // Parkway cuts / fills are grassed slopes, not bare rock (sheer cuts have their stone walls): only steeper than ~40 deg.
    rockSlope: [0.85, 1.25],
    flatAreas: [],
    // The rowhouse blocks lot by lot: paved round each building, green yards behind.
    lotYards: true,
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
      // Built-up ground between the buildings: yards and lawns as much as pavement (a block is mostly back yards).
      urban: [0.4, 0.1, 0.32, 0.18],
      industrial: [0.05, 0.05, 0.4, 0.5],
      bare: [0.2, 0.5, 0.1, 0.2],
      water: [0.5, 0.5, 0, 0],
      vineyard: [0.3, 0.7, 0, 0],
      cemetery: [0.88, 0.1, 0.02, 0],
      crop: [0.9, 0.1, 0, 0],
      // The 2 km ring (scripts/realmap/extend.py): built-up ground grey like `urban`, the rest grass; no scatter.
      paved: [0.12, 0.08, 0.5, 0.3],
      open: [0.92, 0.06, 0.02, 0],
    },
  },
  paths,
  // The streets follow the NYC spot elevations on them too (ground streets; decks keep their clearance line).
  streetHeights: surveyed(spotHeights.streets),
  // The NYC retaining walls beside the parkway up to the Union Tpke overlook (scripts/realmap/retaining_walls.py).
  retainingWalls: retainingWalls.walls,
  // The Highland Blvd bridge behind the start: one deck surface through the NYC spot elevations on it (START_DECK).
  deckStructures: [
    {
      outline: START_DECK,
      heights: surveyed(spotHeights.streets).filter(([x, z]) =>
        insideOutline(START_DECK, x, z),
      ),
    },
  ],
  lakes: data.lakes as LakeDef[],
  road: {
    // One carriageway of the parkway: two narrow lanes, no real shoulder, concrete barriers each side. The points carry
    // the real width (`roadWidth`); this is the widest.
    width: 7.0,
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
    // The parkway's bridges are low: 5.7 m from deck to the street below (NYC spot elevations at B9, 1 120 m, 3 430 m;
    // Forest Park Dr 4.6 m).
    bridgeClearance: 5.7,
    // The bare-earth DEM drops the decks and their approach fills: the road follows the NYC spot elevations on it.
    heights: surveyed(spotHeights.route),
    // The Queens Blvd portal's ends follow Queens Blvd on top (skewed headwalls, the slab shortened at the corners).
    spans: bridgeSpans.map((s) => {
      const m = { ...s, from: along(s.from), to: along(s.to) };
      if (s.kind !== 'under') {
        if (Math.abs(s.from - 4113) < 1) return { ...m, clearance: 4.6 };
        // B6: the NYC structure reaches 13 m further west than the deck (approved as it is) and the land under it is at
        // street level (NYC spots): open under the whole deck, abutment walls at its ends.
        if (Math.abs(s.from - 3413) < 3) return { ...m, ramp: 3, open: true };
        return m;
      }
      if (s.from > 7100) return { ...m, skew: QUEENS_BLVD_SKEW };
      if (Math.abs(s.from - 4511) < 20) return { ...m, skew: MYRTLE_AVE_SKEW };
      return m;
    }),
    // Cuts deeper than 2.5 m are sheer, held back by a stone retaining wall (the parkway runs sunken there).
    // Stone walls + picket railing on the old parkway; concrete + chain-link from the Kew Gardens approach on.
    cutWalls: { minHeight: 2.5, offset: 1.6, concreteFrom: along(6900) },
    // The 10 m DEM blurs the narrow Kew Gardens trench (7 040-7 190 m: the land beside the road reads up to 2 m below
    // its rim): the Union Turnpike service roads and the street grid sit at the rim of the trench (NYC spots agree).
    // Same at the Union Tpke overlook (6 711-6 728 m): the service roads at the rim of the cut overlapped the cut slope
    // (their inner lanes over the trench floor, terrain through the asphalt); depths follow the streets' height.
    trenchFills: [
      { from: along(7035), to: along(7186), halfWidth: 75, depth: [0.3, 5.6] },
      { from: along(6706), to: along(6732), halfWidth: 30, depth: [5.5, 5.6] },
      { from: along(6732), to: along(6765), halfWidth: 30, depth: [5.6, 1.0] },
    ],
    // The baked route ends at the Union Turnpike (7 345 m); the finish is past the Queens Blvd portal, so the stage
    // road runs on along the turnpike (OSM primary, same direction) for ~90 m: the run-out to stop in. Not baked
    // (moving the end waypoint makes the baker take another route).
    // (info.route is the shifted route)
    points: routePoints(info.route, roadWidth),
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
    // The interchange east of the finish (imported later, scripts/realmap/east.py): its ramps get guard rails / Jersey walls too.
    extra: { kinds: ['motorway_link'], minX: 2900, minWidth: 3.4 },
  },
  // The inner Union Turnpike lanes run down in the parkway's cut beside its carriageways (4 roadways side by side,
  // the outer Union Tpke service roads at grade): OSM has them as primary streets.
  parkwayLanes: { kinds: ['primary'], names: ['Union Turnpike'], reach: 22 },
  // Parked cars on the side streets, crowds on the overpasses and behind the closed junction mouths, police
  // cars and fire trucks standing at the junctions (all derived from the road network, see world/street-dressing.ts).
  // Kerbs, sidewalks, crosswalks and lamps on the streets within 560 m of the parkway (world/street-detail.ts): the
  // NYC street-model corridor (scripts/realmap/corridor.py REACH), out to which the start area's streets are baked.
  cityStreets: { reach: 560, sidewalk: 1.5, lampEvery: 34 },
  streetDressing: {
    parked: {
      kinds: [
        'primary',
        'residential',
        'service',
        'tertiary',
        'secondary',
        'unclassified',
        'living_street',
      ],
      reach: 130,
      fill: 0.4,
      taxiShare: 0.07,
    },
    spectators: { perDeck: 7, perJunction: 5, reach: 400 },
    // The interchange east of the finish: marker posts along the ramps, chevrons on their bends.
    rampMarkers: {
      fromX: 2900,
      postEvery: 25,
      chevronEvery: 14,
      maxRadius: 90,
    },
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
      ].map(along),
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
  gorePathsFromX: 2900,
  junctionPlazas: [
    // Park Lane x Union Tpke at both ends of the overlook slab (6 720 m): between the headwalls (never on the trench
    // rim beyond them, its fence stays), from inside the trench wall line (no slab edge parapet across Park Lane) to
    // past the Park Lane deck ends (no deck parapets / abutments across the Union Tpke mouths).
    [2279.4, -1514.1, 2293.0, -1525.1, 2301.2, -1515.0, 2287.6, -1504.0],
    [2269.6, -1526.3, 2283.2, -1537.3, 2275.3, -1547.0, 2261.7, -1536.0],
  ],
  // The Kew Gardens junction core (Queens Blvd x Union Tpke on the finish slab): one source only - the NYC Planimetric
  // Database roadbed within 3 m of the box, its medians / islands / sidewalks (scripts/realmap/plaza_islands.py); no OSM
  // ribbons, lane lines or crossings inside (they did not line up with the survey). The streets leading in keep their
  // own ribbons and paint and get their crosswalks at its edge.
  // ... and the other big NYC intersections the survey marks (roadbed code 350010: the start's five-way junction, the
  // Queens Blvd junctions either side of the portal): `junction-cores.json`, same script (--cores).
  junctionAreas: [junction.area, ...junctionCores.cores.map((c) => c.area)],
  // The street space where the inner Union Tpke lanes start (~6 960 m): the service roads, the lane mouths; it keeps the
  // street ribbons (the same road look and painted lines as the streets leading to it).
  ribbonAreas: [laneStart.area],
  plazaIslands: [
    ...junction.islands,
    ...laneStart.islands,
    ...junctionCores.cores.flatMap((c) => c.islands),
  ] as PlazaIsland[],
  // The signalled zebra crossings at the lane starts: OSM ways tagged crossing:markings=zebra (same script).
  plazaCrosswalks: laneStart.crosswalks,
  // Signals: OSM traffic_signals nodes; trees: NYC Street Tree Census 2015 (same script).
  plazaSignals: [...junction.signals, ...laneStart.signals],
  plazaTrees: [
    ...junction.trees,
    ...laneStart.trees,
    ...junctionCores.cores.flatMap((c) => c.trees),
  ],
  // NYC Street Tree Census 2015 over the Kew Gardens end (scripts/realmap/street_trees.py).
  streetTrees,
  overheadSigns: {
    exits: true,
    // The Kew Gardens interchange east of the finish: a gantry before every split (Grand Central / Van Wyck / Jackie).
    splits: { minX: 2900, ahead: 110 },
    signs: [
      {
        along: along(6960),
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
        along: along(7300),
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
