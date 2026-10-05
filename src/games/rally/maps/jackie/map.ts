import { buildingsFromData, routePoints, routeSpans } from '../shared/real-map';
import type {
  HeightmapDef,
  LakeDef,
  LandcoverDef,
  MapDef,
  PathDef,
} from '../shared/types';
import data from './data.json';

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

export const jackieMap: MapDef = {
  id: 'jackie',
  name: 'The Jackie',
  year: 2026,
  /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
  tyre: 'tarmac',
  // Fast parkway: the race cars' long final drive (Skoda Rally ~205 km/h instead of 165).
  gearing: 'long',
  description:
    'Real-world city stage in New York: the narrow, winding 1930s Jackie Robinson Parkway from East New York through three cemeteries and Forest Park to the Grand Central Parkway interchange in Queens. 7.3 km of tree-lined tarmac.',
  seed: 4040,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label:
        'Google Maps route (Vermont St -> Jackie Robinson Pkwy -> Kew Gardens)',
      url: 'https://www.google.com/maps/dir/40.6808527,-73.8963462/Jackie+Robinson+Pkwy,+New+York,+NY/40.714605,-73.8298097',
      note: 'stage waypoints',
    },
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'route, parkway carriageways + ramps, streets, bridges, land use, buildings with NYC roof heights - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'USGS 3D Elevation Program (3DEP)',
      url: 'https://www.usgs.gov/3d-elevation-program',
      note: 'bare-earth lidar elevation - US public domain',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'far horizon elevation',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
  ],
  stageNumber: 3,
  buildings: buildingsFromData(data.buildings),
  bounds: { minX: -3150, maxX: 3550, minZ: -2300, maxZ: 2300 },
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
  paths: data.paths as PathDef[],
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
    surface: 'tarmac',
    texture: 'road_parkway',
    // Where the parkway runs on a bridge over a street (OSM bridge=yes): deck over lowered ground.
    spans: routeSpans(data.routeSpans),
    // Cuts deeper than 2.5 m are sheer, held back by a stone retaining wall (the parkway runs sunken there).
    // Stone walls + picket railing on the old parkway; concrete + chain-link from the Kew Gardens approach on.
    cutWalls: { minHeight: 2.5, offset: 1.6, concreteFrom: 6900 },
    // The lidar has a void where the parkway descends into the Kew Gardens trench (7 040-7 190 m: the land reads
    // 5-10 m BELOW the road): the Union Turnpike service roads and the street grid sit at the rim of the trench.
    trenchFills: [{ from: 7035, to: 7186, halfWidth: 75, depth: [0.3, 5.6] }],
    // The baked route ends at the Union Turnpike (7 345 m); the finish is past the Queens Blvd portal, so the stage
    // road runs on along the turnpike (OSM primary, same direction) for ~90 m: the run-out to stop in. Not baked
    // (moving the end waypoint makes the baker take another route).
    points: routePoints(
      [
        ...data.route,
        [2835, -1847],
        [2866, -1858.6],
        [2896, -1870.9],
      ],
      () => 7.4,
    ),
  },
  // Finish at 7 298 m: past the Queens Blvd portal (7 186-7 273 m), 2 m before the last green gantry (7 300 m; the two
  // gantries clipped when they stood on the same spot).
  stage: { start: 40, finishFromEnd: 47, splits: 4 },
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
  environment: {
    sunElevation: 42,
    sunAzimuth: 330,
    turbidity: 6,
    rayleigh: 1.4,
    fogColor: '#bfc8d0',
    fogDensity: 0.00042,
    exposure: 0.84,
    groundTint: { grass: '#7d8f4c', amount: 0.55 },
  },
};
