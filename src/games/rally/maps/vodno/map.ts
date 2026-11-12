import { greenInSpring, seedingGrass } from '../shared/seasonal-grass';
import {
  buildingsFromData,
  hairpinRails,
  routePoints,
} from '../shared/real-map';
import type {
  BarrierRule,
  CulvertsDef,
  HeightmapDef,
  HorizonDef,
  LandcoverDef,
  MapFeatures,
  MapDef,
  PathDef,
  PropPlacement,
  RailwayDef,
  RasterDef,
  ScatterRule,
} from '../shared/types';
import canopy from './canopy.json';
import culverts from './culverts.json';
import data from './data.json';
import horizon from './horizon.json';
import { vodnoInfo as info } from './info';
import { VODNO_FLATS } from './landmarks';
import { GATE_PAD } from './landmarks/gate';
import { BUILDING_PAD, HOTEL_PAD } from './landmarks/hotel';
import { LOWER_NODE } from './landmarks/sites';
import { BLOCK_PADS } from './landmarks/start-blocks';
import { SIDE_ROAD_BLOCK, TRAIL_PATH } from './landmarks/trail-lot';
import {
  CROSSROAD_BANK,
  laneExtra,
  laneShift,
  MARKINGS,
  WALL_RANGE,
  WIDE_FROM,
  WIDE_TO,
} from './crossroad';
import { countryRoad, dropLotAisles, LAWNS, LOT_PADS } from './lots';
import { SKYLINE } from './skyline';
import { START_SIDEWALKS, startBuildings, startStreets } from './start-area';
import { START_LOT_PAD } from './landmarks/start-lot';
import { FINISH, ROAD_LENGTH, START } from './stages';

/**
 * "Vodno Hillclimb" - Mount Vodno above Skopje (North Macedonia): the 4 km hillclimb from the Vodno neighbourhood up the
 * hairpins of the north face to Sredno Vodno, with the Millennium Cross (66 m), the antenna mast on the ridge and the
 * cable car in view, and the whole 6 x 4 km of streets and houses around. One world, one stage (./stages.ts).
 *
 * Baked from open data by `python scripts/realmap/bake.py scripts/realmap/vodno.json` (terrain, land cover, every
 * road and building of the box) and `python scripts/realmap/horizon.py scripts/realmap/vodno.json` (the Skopje valley
 * and the mountains round it as a backdrop: it reaches far to the north, where the view from the stage goes, and
 * little to the south, behind the ridge). Edit THIS file for the look; re-bake only to change the source data.
 * World (0, 0) = 41.97219 N, 21.40287 E; +X east, +Z south. Task list: ./TODO.md.
 */

/** Height of the stage start (a street of the Vodno neighbourhood): y = 0 there. */
const BASE_HEIGHT = 349;

/**
 * The approach to the Vidikovec car park (m along the road): a rusted guard rail on the drop at its right up to the
 * lot's wall (`to`), and a short galvanised one between the road and the lot from the start of its grass island (`lot`).
 */
const VIDIKOVEC_RAIL = { from: 2600, to: 2796, lot: [2834, 2900] as const };
/** The dark stone retaining wall on the uphill side opposite the upper half of the Vidikovec lot (`road.rockCuts.walls`):
 * ~1.8 m high, 3.5 m back from the road edge behind a grass strip with bushes ~1 m off the road (the owner's photos). */
const VIDIKOVEC_WALL = {
  from: 2860,
  to: 2928,
  side: 1,
  height: 1.8,
  offset: 3.5,
} as const;
/** The one real rock cut of the road: the big hairpin blasted through a spur (m along, `road.rockCuts`). */
const ROCK_CUT: [number, number] = [1985, 2125];
/** Guard rails stand on the 0.6 m verge (`road.shoulder`), not past it on the falling slope (posts hanging in the air). */
const RAIL_OFFSET = 0.4;

/** Covers where dry grass grows (detail layer). */
const DRY = ['grass', 'shrub', 'bare', 'crop', 'urban'];

/** The Millennium Cross on Krstovar (OSM way 229939246) and the antenna mast 270 m east of it (way 1178638147). */
const CROSS = { x: -700, z: 796 };
const MAST = { x: -433, z: 741 };

/**
 * The cable car (OSM way 172141444): lower station at Sredno Vodno -> upper station beside the cross. OSM draws the line
 * with a node at every tower (three of them are tagged pylons), so the pylons stand on its vertices; the ropes and the
 * cabins running round the loop follow from them (world/aerialway.ts).
 */
const CABLE_CAR = [
  LOWER_NODE.x,
  LOWER_NODE.z,
  ...[334, -403, 227, -284, 29, -64, -79, 58, -178, 164, -325, 338, -559, 597],
  ...[-599, 645, -684, 741],
];

/**
 * Woods in bands from the road edge: a closed canopy at the verge, thinner across the slope where the crowns are still
 * drawn as sprites (the costly part of a tree; the road side within ~100 m is most of it), the full forest behind (trees
 * past 250 m are only impostors). [from, to, share of the density] (m).
 */
const WOOD_BANDS: [number, number | undefined, number][] = [
  [0, 40, 1.4],
  [40, 100, 1],
  [100, 245, 0.8],
  [245, undefined, 1],
];

/** Every wood cover (the bake's leaf type split, scripts/realmap/leaf_type.py): pine stands, mixed, oak coppice. */
const WOODS = ['pine', 'mixed', 'oakwood'];

/**
 * The woods follow the real canopy (scripts/realmap/canopy.py): full density where it is closed (85 %), none in the
 * gaps (under 1/8); trees sized by the stand height against each cover's median stand (m), so the gully stands grow
 * tall and the ridge coppice low while the mean size stays.
 */
const STAND: Record<string, number> = { pine: 15, mixed: 14, oakwood: 12 };
const canopyOf = (cover: string): ScatterRule['canopy'] => ({
  full: 0.85,
  min: 0.125,
  height: STAND[cover],
});

/** The gaps of the woods: full where the canopy share is under 1/8, none from a half up. */
const GAPS: ScatterRule['canopy'] = { full: 0.5, min: 0.125, open: true };

/** A wood rule split into the road-distance bands (WOOD_BANDS), thinned by the real canopy of its cover. */
function banded(
  cover: [string],
  rule: Omit<ScatterRule, 'cover' | 'maxRoadDist'>,
): ScatterRule[] {
  return WOOD_BANDS.map(([from, to, share]) => ({
    ...rule,
    cover,
    canopy: canopyOf(cover[0]),
    density: rule.density * share,
    minRoadDist: Math.max(rule.minRoadDist ?? 0, from),
    maxRoadDist: to,
  }));
}

/** The understorey (middle layer, thickets) grows within this distance of the road (m): behind it only the canopy shows. */
const UNDER = 120;
/** The pine blocks of the mixed stands (`mask.group` 1): pines where the field is high, broadleaf (`invert`) between. */
const PINE_BLOCKS = { scale: 55, threshold: 0, group: 1 };
/** Thicket clumps under the woods (one field for every shrub kind: a clump mixes them). */
const THICKETS = { scale: 20, threshold: -0.05, group: 4 };
/** Shrub clumps along the verge. */
const VERGE_CLUMPS = { scale: 24, threshold: -0.1, group: 5 };
/** Planting rows of the regrowth on a logged slope: ~3 m apart on its ~20 deg, 1.2 m wide, wavering. */
const REGROWTH_ROWS = { period: 1.1, width: 0.4, jitter: 0.5 };

// ---- Ground layer and rock bands (used by `landcover.needles` and the end of `scatter`) ----
/** Pine-needle carpet: the whole floor of the black pine stands, patches of it in the mixed stands. */
const NEEDLE_FLOOR = { pine: 1, mixed: 0.5 };
/** Ferns in the shade of the oak / hornbeam coppice and the mixed stands; rock bands on the steep spurs. */
const GROUND_LAYER: ScatterRule[] = [
  // Ferns in drifts under closed crowns: unfurling in spring, full in summer, dead rust-brown bracken in autumn.
  ...(
    [
      ['fern', ['spring'], [0.55, 0.8]],
      ['fern', ['summer'], [0.8, 1.15]],
      ['fern_autumn', ['autumn'], [0.8, 1.1]],
    ] as const
  ).map(([asset, season, scale]): ScatterRule => ({
    asset,
    season: [...season],
    cover: ['oakwood', 'mixed', 'trees'],
    canopy: { full: 0.75, min: 0.35 },
    density: 40,
    detail: true,
    mask: { scale: 28, threshold: 0.15 },
    minRoadDist: 1.5,
    maxSlope: 0.4,
    scale: [scale[0], scale[1]],
    sink: 0.05,
  })),
  // Schist breaking through the wooded hillside where it steepens past ~27 deg (the spurs of 650-850 m, 1 300-1 400 m
  // and 2 550-2 750 m): short bands of rock faces along the contour, faces down the slope, backs in the hill. Past the
  // road's cut faces and fill banks (steeper than any natural slope here: `maxSlope`).
  {
    asset: 'rock_outcrop',
    cover: [...WOODS, 'shrub', 'bare', 'grass'],
    density: 2.5,
    minRoadDist: 9,
    minSlope: 0.095,
    maxSlope: 0.17,
    mask: { scale: 45, threshold: 0 },
    scale: [1.2, 1.7],
    sink: 0.4,
    outcrop: { pieces: [3, 6], lean: 0.5 },
  },
];

const props: PropPlacement[] = [
  // The cross faces the city: its arm runs north-west / south-east, square to the view from the stage.
  { asset: 'millennium_cross', x: CROSS.x, z: CROSS.z, rotY: -45 },
  { asset: 'antenna_mast', x: MAST.x, z: MAST.z },
];

export const vodnoMap: MapDef = {
  ...info,
  country: 'mk',
  buildings: startBuildings(buildingsFromData(data.buildings)),
  horizon: horizon as HorizonDef,
  skyline: SKYLINE,
  terrain: {
    baseHeight: 0,
    heightmap: { ...(data.heightmap as HeightmapDef), offset: BASE_HEIGHT },
    // ~30 m elevation data: add the small undulations it can't see.
    layers: [
      { scale: 60, amplitude: 0.9, octaves: 2 },
      { scale: 14, amplitude: 0.2, octaves: 2 },
    ],
    edgeRise: 0,
    rockSlope: [0.65, 1.0],
    // Bare schist and its scree where the hillside steepens past ~25-30 deg (the elevation data tops out at ~30 deg
    // near the road: the spurs of 650-850 m, 1 300-1 400 m and 2 550-2 750 m).
    talus: { slope: [0.09, 0.13], reach: 12 },
    flatAreas: VODNO_FLATS,
    pads: [
      ...LOT_PADS,
      ...BLOCK_PADS,
      CROSSROAD_BANK,
      GATE_PAD,
      HOTEL_PAD,
      BUILDING_PAD,
      START_LOT_PAD,
    ],
    lawns: LAWNS,
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    canopy: {
      cover: canopy.cover as RasterDef,
      height: canopy.height as RasterDef,
    },
    needles: NEEDLE_FLOOR,
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.78, 0.16, 0.06, 0],
      shrub: [0.62, 0.22, 0.16, 0],
      trees: [0.6, 0.35, 0.05, 0],
      // Pine plantation floor: needles and bare earth.
      pine: [0.38, 0.6, 0.02, 0],
      beech: [0.25, 0.73, 0.02, 0],
      // Oak / hornbeam coppice floor: leaf litter with grass and moss in the gaps (the owner's photos: green under the trees).
      oakwood: [0.5, 0.46, 0.04, 0],
      mixed: [0.45, 0.52, 0.03, 0],
      pasture: [0.62, 0.1, 0.28, 0],
      orchard: [0.7, 0.3, 0, 0],
      crop: [0.6, 0.4, 0, 0],
      urban: [0.55, 0.3, 0.05, 0.1],
      industrial: [0.25, 0.25, 0, 0.5],
      bare: [0.1, 0.35, 0.5, 0.05],
      water: [0.5, 0.5, 0, 0],
      vineyard: [0.3, 0.7, 0, 0],
      cemetery: [0.7, 0.2, 0, 0.1],
    },
  },
  // Appended last: the baked paths keep their index.
  paths: [
    ...startStreets(countryRoad(dropLotAisles(data.paths as PathDef[]))),
    TRAIL_PATH,
  ],
  // The side roads are streets and forest tracks: tracks are gravel ribbons (objects), streets city asphalt.
  trackRibbons: true,
  // Tracks over steep pine woods: a longer height window than the default track (25 m) keeps them smooth.
  pathProfiles: {
    track: [70, 0.2],
    unclassified: [70, 0.12],
    // Streets on a 20-30 % hillside: a longer height window and room for the grade keep them smooth.
    residential: [60, 0.16],
    living_street: [45, 0.16],
    service: [40, 0.18],
    // Footpaths (bake `osm.footpaths`) follow the land: no trench through a lot or across the hillside.
    path: [6, 1.5],
    footway: [6, 1.5],
  },
  // Culverts where the elevation data says water crosses the road (scripts/realmap/culverts.py; OSM has none here),
  // kept only where the owner confirmed one on the ground (1.7 and 3.3 km).
  culverts: culverts as CulvertsDef,
  pylons: data.pylons as [number, number][],
  powerLines: data.powerLines as number[][],
  aerialways: [
    {
      name: 'Millennium Cross cable car',
      line: CABLE_CAR,
      pylonsAtVertices: true,
    },
  ],
  // Kerbs, sidewalks and lamps on the streets round the stage road (the Vodno neighbourhood at the start).
  cityStreets: {
    reach: 320,
    // the suburb only: the closed side road at the 2 000 m hairpin is a bare hill road
    until: 1300,
    sidewalk: 1.4,
    lampEvery: 38,
    // the side streets in the stage road's own asphalt
    asphalt: 'road_tarmac_plain_kerbed',
    links: START_SIDEWALKS,
  },
  road: {
    // Salvador Aljende street at the start, then the narrow hillside road, then the R2138 regional road.
    width: 6,
    shoulder: 0.6,
    ditch: 0.3,
    crown: 0.04,
    smoothing: 40,
    // The real road is graded (average 5.4 %, short ramps in the hairpins); the ~30 m elevation data on 30 % slopes
    // asks for 25 % in places (an OSM line a few metres off on a steep slope reads metres of height): cap it, the road
    // is cut / filled into the mountainside like the built one.
    maxGrade: 0.11,
    // The concrete retaining wall on the right of the first crossroad (./crossroad.ts): the only sheer cut of the road.
    cutWalls: {
      minHeight: 1,
      offset: 0.9,
      concreteFrom: 0,
      range: WALL_RANGE,
      solid: true,
    },
    // Layered shale faces where the land stands 3 m above the road - only at the big hairpin (the owner's photos). Elsewhere
    // the ~30 m elevation data (a surface model: tree tops) lies metres above the road where the real banks are low and
    // green: no faked cliffs there. At Vidikovec the uphill bank is held by a low dark stone wall along the upper half of
    // the lot.
    rockCuts: {
      minRise: 3,
      slope: 1.3,
      foot: 1.2,
      maxFace: 7,
      exclude: [
        [0, ROCK_CUT[0]],
        [ROCK_CUT[1], ROAD_LENGTH],
      ],
      walls: [VIDIKOVEC_WALL],
    },
    // ... and its spoil tipped over the valley side: a straight bank of rock and earth from the verge's rim.
    fills: { minDrop: 1.5, slope: 0.8 },
    // The big hairpin (2 000 m): the road is blasted through a spur the 30 m elevation data smooths to ~2 m - a 6-8 m
    // shale face round the outside of the bend and along the leg above it (the owner's photos).
    trenchFills: [
      { from: 1998, to: 2105, halfWidth: 15, depth: [8, 6], side: 1 },
    ],
    surface: 'tarmac',
    // Old tarmac with white edge and centre lines all along; at the first crossroad every line is paint (`markings`).
    texture: 'road_tarmac_lines',
    sections: [
      { from: WIDE_FROM, surface: 'tarmac', texture: 'road_tarmac_plain' },
      { from: WIDE_TO, surface: 'tarmac', texture: 'road_tarmac_lines' },
    ],
    markings: MARKINGS,
    points: routePoints(
      data.route,
      (along) => (along < START + 500 ? 6.4 : 5.8) + laneExtra(along),
      laneShift,
    ),
  },
  // Nothing grows south of the ridge (the cross stands at z 796): no stage camera sees the far side of Vodno, 1.1 km and more from the
  // road, past the forest distance and behind the mountain.
  scatterBounds: { maxZ: 900 },
  // The lower road runs through open ground: grass and bushes to the verge, the forest standing 8 m and more back (the pines
  // come to the edge further up).
  treeSetback: [{ from: 250, to: 1150, dist: 8, fade: 80 }],
  // Elsewhere the woods come to the verge; no low limb hangs over the road.
  treeCrownClear: 1.5,
  // Every crown of the canopy height model outside the woods (gardens, hedgerows, field and edge trees) and the lone
  // ones in them (clearings, edges), where it stands (scripts/realmap/canopy.py); the species from the cover there.
  realTrees: {
    trees: canopy.trees,
    assets: {
      urban: [
        ...['fruit_tree', 'fruit_tree', 'fruit_tree', 'locust_tree'],
        ...['locust_tree', 'walnut_tree', 'pale_tree', 'cypress_tree'],
      ],
      grass: ['oak_tree', 'oak_tree', 'locust_tree'],
      shrub: ['oak_tree', 'oak_tree', 'locust_tree'],
      bare: ['oak_tree', 'locust_tree'],
      pasture: ['oak_tree', 'locust_tree'],
      crop: ['locust_tree', 'walnut_tree', 'oak_tree', 'fruit_tree'],
      industrial: ['locust_tree', 'pale_tree'],
      cemetery: ['cypress_tree'],
      trees: ['oak_tree', 'locust_tree', 'hornbeam_tree'],
      pine: ['plantation_pine', 'black_pine'],
      mixed: ['black_pine', 'oak_tree', 'hornbeam_tree'],
      oakwood: ['oak_tree', 'oak_tree', 'hornbeam_tree'],
    },
    minRoadDist: 3.5,
    minPathDist: 2,
    scale: [0.45, 1.5],
    tilt: 3,
    sink: 0.15,
    // Real crowns by the road lean out over it a little.
    lean: { deg: [2, 5], within: 12 },
  },
  scatter: [
    // The woods of the north face (leaf type from winter / summer satellite scenes, scripts/realmap/leaf_type.py): low
    // downy / Turkey oak and oriental hornbeam coppice (the natural forest), black pine plantations from the 1950s in
    // blocks and terrace strips across the slope, mixed stands between. The road verges are mostly broadleaf.
    //
    // Layered stands (the owner's photos ref-07 / ref-13 / ref-14): tall black pines over a 4-10 m broadleaf layer
    // (hornbeam, oak, locust, saplings) over a shrub thicket, every age in one stand. The understorey stays within
    // UNDER m of the road (behind it only the canopy shows).
    //
    // Pine stands: the 1950s black pine plantations, 15 m typical, 20 m in the gullies (the canopy model's stand height).
    ...banded(['pine'], {
      asset: 'tall_black_pine',
      density: 2.5,
      minRoadDist: 3,
      maxSlope: 0.8,
      scale: [0.65, 0.9],
      tilt: 2,
      lean: { deg: [1, 3], within: 12 },
      sink: 0.3,
    }),
    ...banded(['pine'], {
      asset: 'black_pine',
      density: 5,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      scale: [1.05, 1.45],
      tilt: 2,
      lean: { deg: [1, 3], within: 12 },
      sink: 0.3,
    }),
    ...banded(['pine'], {
      asset: 'plantation_pine',
      density: 3,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      scale: [0.85, 1.2],
      tilt: 2,
      sink: 0.3,
    }),
    // Mixed stands: the pines in tight blocks and strips with hard edges (the satellite: dark pine blocks in grey-brown
    // broadleaf), oak / hornbeam coppice between them, on one shared block field.
    ...banded(['mixed'], {
      asset: 'tall_black_pine',
      density: 4,
      minRoadDist: 3,
      maxSlope: 0.8,
      mask: PINE_BLOCKS,
      scale: [0.62, 0.85],
      tilt: 2,
      lean: { deg: [1, 3], within: 12 },
      sink: 0.3,
    }),
    ...banded(['mixed'], {
      asset: 'black_pine',
      density: 8,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      mask: PINE_BLOCKS,
      scale: [1.05, 1.45],
      tilt: 2,
      sink: 0.3,
    }),
    ...banded(['mixed'], {
      asset: 'plantation_pine',
      density: 4,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      mask: PINE_BLOCKS,
      scale: [0.85, 1.2],
      tilt: 2,
      sink: 0.3,
    }),
    ...banded(['mixed'], {
      asset: 'oak_tree',
      density: 7,
      minRoadDist: 3.5,
      maxSlope: 0.75,
      mask: { ...PINE_BLOCKS, invert: true },
      scale: [0.6, 1.1],
      tilt: 4,
      lean: { deg: [2, 5], within: 12 },
      sink: 0.25,
    }),
    ...banded(['mixed'], {
      asset: 'hornbeam_tree',
      density: 3,
      minRoadDist: 3,
      maxSlope: 0.8,
      mask: { ...PINE_BLOCKS, invert: true },
      scale: [0.7, 1.15],
      tilt: 5,
      lean: { deg: [2, 5], within: 12 },
      sink: 0.2,
    }),
    // Oak coppice (downy / Turkey oak) with oriental hornbeam, crowns 6-12 m; planted black pines in small tight groups.
    ...banded(['oakwood'], {
      asset: 'hornbeam_tree',
      density: 4,
      minRoadDist: 3,
      maxSlope: 0.8,
      scale: [0.7, 1.15],
      tilt: 5,
      lean: { deg: [2, 5], within: 12 },
      sink: 0.2,
    }),
    ...banded(['oakwood'], {
      asset: 'oak_tree',
      density: 7.5,
      minRoadDist: 3.5,
      maxSlope: 0.75,
      scale: [0.6, 1.1],
      tilt: 4,
      lean: { deg: [2, 5], within: 12 },
      sink: 0.25,
    }),
    {
      asset: 'oak_tree',
      cover: ['pine', 'trees'],
      canopy: canopyOf('oakwood'),
      density: 1.5,
      minRoadDist: 3.5,
      maxSlope: 0.75,
      mask: { scale: 150, threshold: 0.1 },
      scale: [0.65, 1.15],
      tilt: 4,
      sink: 0.25,
    },
    {
      asset: 'black_pine',
      cover: ['oakwood'],
      canopy: canopyOf('oakwood'),
      density: 4,
      minRoadDist: 4,
      maxSlope: 0.8,
      mask: { scale: 40, threshold: 0.45, group: 2 },
      scale: [0.8, 1.2],
      tilt: 2,
      sink: 0.3,
    },
    // The broadleaf middle layer, 4-10 m: hornbeam, oak and locust poles and saplings under the pines and the coppice.
    ...(
      [
        ['hornbeam_tree', ['pine', 'mixed'], 4.5, [0.5, 0.85]],
        ['oak_tree', ['pine'], 1.5, [0.35, 0.6]],
        ['locust_tree', ['pine', 'mixed', 'oakwood'], 1, [0.35, 0.65]],
        ['young_tree', WOODS, 2.5, [0.7, 1.2]],
      ] as const
    ).map(([asset, cover, density, scale]): ScatterRule => ({
      asset,
      cover: [...cover],
      canopy: canopyOf(cover[0]),
      density,
      minRoadDist: 3,
      maxRoadDist: UNDER,
      maxSlope: 0.8,
      scale: [scale[0], scale[1]],
      tilt: 5,
      lean: { deg: [2, 5], within: 12 },
      sink: 0.2,
    })),
    // The forest edge along the road: young broadleaf in the light of the verge, leafy to the ground and leaning out
    // over the road (the real crowns overhang 28 % of the wooded road; `treeCrownClear` keeps the low limbs off it).
    ...(
      [
        ['hornbeam_tree', 3.5, [0.38, 0.65]],
        ['locust_tree', 2, [0.3, 0.55]],
        ['young_tree', 2.5, [0.7, 1.1]],
      ] as const
    ).map(([asset, density, scale]): ScatterRule => ({
      asset,
      cover: WOODS,
      density,
      minRoadDist: 1.8,
      maxRoadDist: 12,
      maxSlope: 0.5,
      scale: [scale[0], scale[1]],
      tilt: 3,
      lean: { deg: [3, 6], within: 12 },
      sink: 0.2,
    })),
    // Undergrowth: thickets in merged clumps (thicket, hazel, bramble on one clump field), denser under the broadleaf;
    // the shrubs keep a few metres off the road (the verge belt below has its own).
    ...(
      [
        ['thicket_shrub', ['trees', 'oakwood'], 7, [0.8, 1.25]],
        ['thicket_shrub', ['pine', 'mixed'], 6, [0.8, 1.25]],
        ['hazelnut_tree', [...WOODS, 'trees'], 2, [0.8, 1.2]],
      ] as const
    ).map(([asset, cover, density, scale]): ScatterRule => ({
      asset,
      cover: [...cover],
      density,
      minRoadDist: 4,
      maxRoadDist: UNDER,
      maxSlope: 0.85,
      mask: THICKETS,
      scale: [scale[0], scale[1]],
      tilt: 3,
      sink: 0.15,
    })),
    {
      asset: 'bramble_shrub',
      cover: [...WOODS, 'trees', 'shrub'],
      density: 3,
      minRoadDist: 4,
      maxSlope: 0.8,
      mask: { ...THICKETS, threshold: -0.3 },
      scale: [0.8, 1.3],
      tilt: 3,
      sink: 0.1,
    },
    {
      asset: 'juniper',
      cover: ['trees', 'oakwood', 'shrub'],
      density: 2,
      minRoadDist: 4,
      maxSlope: 0.8,
      scale: [0.7, 1.2],
      tilt: 3,
      sink: 0.1,
    },
    // The gaps in the woods (the canopy model sees nothing under 3 m there: clearings, the logged slope round the big
    // hairpin): a logged slope regrows in rows along the contour (the owner's photos): young black
    // pines and bushes in planting lines with grass between, hazel / sapling clumps, the odd older pine left standing.
    {
      asset: 'black_pine',
      cover: WOODS,
      canopy: GAPS,
      density: 9,
      minRoadDist: 3,
      maxSlope: 0.8,
      contour: REGROWTH_ROWS,
      scale: [0.24, 0.45],
      tilt: 3,
      sink: 0.1,
    },
    {
      asset: 'scrub_bush',
      cover: WOODS,
      canopy: GAPS,
      density: 16,
      minRoadDist: 2.5,
      maxSlope: 0.85,
      contour: REGROWTH_ROWS,
      scale: [0.8, 1.4],
      sink: 0.15,
    },
    {
      asset: 'young_tree',
      cover: WOODS,
      canopy: GAPS,
      density: 3,
      minRoadDist: 4,
      maxSlope: 0.8,
      mask: { scale: 30, threshold: 0.1, group: 3 },
      scale: [0.8, 1.3],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'thicket_shrub',
      cover: WOODS,
      canopy: GAPS,
      density: 4,
      minRoadDist: 3,
      maxSlope: 0.85,
      mask: { scale: 30, threshold: 0.1, group: 3 },
      scale: [0.7, 1.1],
      sink: 0.15,
    },
    {
      asset: 'black_pine',
      cover: WOODS,
      canopy: GAPS,
      density: 0.4,
      minRoadDist: 5,
      maxSlope: 0.8,
      scale: [0.85, 1.15],
      tilt: 3,
      sink: 0.3,
    },
    // The road's verge belt (the owner's photos: bright green shrubs and young locust 2-6 m along the verges, the car
    // parks and the rails): thicket, bush and hazel in merged clumps on one clump field, young locust.
    ...(
      [
        ['bush', 7, 1.6, 20, [0.7, 1.3]],
        ['thicket_shrub', 5, 1.8, 22, [0.7, 1.15]],
        ['hazelnut_tree', 2.5, 2.5, 25, [0.75, 1.15]],
      ] as const
    ).map(([asset, density, min, max, scale]): ScatterRule => ({
      asset,
      cover: [...WOODS, ...DRY, 'trees', 'pasture'],
      density,
      minRoadDist: min,
      maxRoadDist: max,
      mask: VERGE_CLUMPS,
      scale: [scale[0], scale[1]],
      maxSlope: 0.35,
      lean: { deg: [2, 5], within: 10 },
      sink: 0.12,
    })),
    {
      asset: 'locust_tree',
      cover: [...DRY, 'pasture'],
      density: 1.2,
      minRoadDist: 4,
      maxRoadDist: 45,
      mask: { scale: 60, threshold: 0.05 },
      scale: [0.45, 0.8],
      tilt: 4,
      lean: { deg: [2, 5], within: 14 },
      sink: 0.2,
    },
    {
      asset: 'locust_tree',
      cover: WOODS,
      canopy: GAPS,
      density: 2,
      minRoadDist: 4,
      maxRoadDist: 45,
      mask: { scale: 60, threshold: 0.05 },
      scale: [0.45, 0.8],
      tilt: 4,
      lean: { deg: [2, 5], within: 14 },
      sink: 0.2,
    },
    // Dry south-facing scrub and meadows on the lower slopes (their trees: `realTrees`).
    {
      asset: 'scrub_bush',
      cover: ['shrub'],
      density: 20,
      minRoadDist: 2,
      scale: [0.8, 1.6],
      sink: 0.15,
    },
    // Black locust, the roadside and wasteland tree of the Skopje valley, loose among the oaks of the lower slopes (in the
    // open, the real trees: `realTrees`).
    {
      asset: 'locust_tree',
      cover: ['trees', 'oakwood'],
      canopy: canopyOf('oakwood'),
      density: 0.7,
      minRoadDist: 4,
      mask: { scale: 170, threshold: -0.05 },
      scale: [0.7, 1.15],
      tilt: 4,
      sink: 0.2,
    },
    {
      asset: 'rock_small',
      cover: [...WOODS, 'trees', 'bare', 'shrub', 'grass'],
      density: 1.5,
      minRoadDist: 1.4,
      scale: [0.6, 1.5],
      alignToGround: true,
      sink: 0.08,
    },
    {
      asset: 'rock_boulder',
      cover: [...WOODS, 'bare', 'shrub'],
      density: 0.3,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.5, 1.4],
      alignToGround: true,
      sink: 0.35,
    },
    // The forest floor under the crowns: stumps of the coppice cuts, fallen logs and trunks, dead branches and
    // root plates (CC0 Poly Haven models, `forest_*`), thinning out where the canopy opens.
    ...(
      [
        ['forest_stump', 1.6, [0.8, 1.3], false],
        ['forest_log', 0.7, [0.8, 1.2], true],
        ['forest_trunk', 0.25, [0.8, 1.1], true],
        ['forest_branches', 2.2, [0.8, 1.4], true],
        ['forest_roots', 0.6, [0.8, 1.2], true],
      ] as const
    ).map(([asset, density, scale, align]): ScatterRule => ({
      asset,
      cover: [...WOODS, 'trees'],
      canopy: { full: 0.6, min: 0.15 },
      density,
      minRoadDist: 3,
      // A 1.7 m root plate bridges a bump on steep ground: gentler ground only.
      maxSlope: asset === 'forest_roots' ? 0.2 : 0.5,
      scale: [scale[0], scale[1]],
      alignToGround: align,
      sink: 0.05,
    })),
    // Outcrops: the schist breaks through where the hillside steepens past ~25 deg (the elevation data; the bare faces
    // and their scree: `terrain.talus`): boulders in clusters, half buried, and loose stones below.
    {
      asset: 'rock_boulder',
      cover: [...WOODS, ...DRY, 'trees'],
      density: 6,
      minRoadDist: 4,
      minSlope: 0.095,
      mask: { scale: 35, threshold: -0.15 },
      scale: [0.8, 2.2],
      alignToGround: true,
      sink: 0.45,
    },
    {
      asset: 'rock_small',
      cover: [...WOODS, ...DRY, 'trees'],
      density: 12,
      minRoadDist: 2,
      minSlope: 0.075,
      scale: [0.6, 1.6],
      alignToGround: true,
      sink: 0.08,
    },
    ...GROUND_LAYER,
    // The suburb's garden trees: `realTrees`.
    {
      asset: 'fruit_tree',
      cover: ['orchard'],
      density: 0,
      rows: { spacing: 5, rowSpacing: 6, jitter: 0.5, keep: 0.9 },
      minRoadDist: 3,
      scale: [0.8, 1.1],
      tilt: 4,
      sink: 0.1,
    },
    // Detail: dry grass in the open (green in spring), green tufts in the woods.
    ...greenInSpring({
      asset: 'dry_grass',
      cover: DRY,
      density: 240,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.55,
      scale: [0.7, 1.4],
    }),
    {
      asset: 'grass_tuft',
      cover: [...WOODS, 'trees', 'orchard'],
      density: 110,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
    // Long seeding grass on the verges and banks (ref-07) and in stands on the open slopes.
    ...seedingGrass({
      cover: [...WOODS, 'trees', ...DRY],
      verge: 420,
      fallow: 180,
      fallowCover: ['grass', 'shrub', 'bare'],
    }),
  ],
  roadside: [
    // The Vidikovec wall (the owner's photos): a few rounded bushes in the grass strip in front of it, a fringe of bushes
    // right on its top edge and small trees behind them on the bank.
    {
      asset: 'bush',
      every: 7,
      side: 'left',
      offset: 0.7,
      depth: 0.6,
      from: VIDIKOVEC_WALL.from + 1,
      to: VIDIKOVEC_WALL.to - 1,
      scale: [0.55, 0.85],
    },
    {
      asset: 'bush',
      every: 1.6,
      count: 2,
      spread: 1.2,
      side: 'left',
      offset: VIDIKOVEC_WALL.offset + 1,
      depth: 0.5,
      from: VIDIKOVEC_WALL.from,
      to: VIDIKOVEC_WALL.to,
      scale: [0.6, 0.95],
    },
    {
      asset: 'young_tree',
      every: 3,
      side: 'left',
      offset: VIDIKOVEC_WALL.offset + 2.8,
      depth: 2.5,
      from: VIDIKOVEC_WALL.from + 1,
      to: VIDIKOVEC_WALL.to,
      scale: [0.5, 0.85],
    },
    {
      asset: 'hornbeam_tree',
      every: 8,
      side: 'left',
      offset: VIDIKOVEC_WALL.offset + 5.5,
      depth: 2,
      from: VIDIKOVEC_WALL.from + 3,
      to: VIDIKOVEC_WALL.to,
      scale: [0.5, 0.7],
    },
    // White / red chevrons on the outside of the hairpins.
    {
      asset: 'chevron_sign',
      every: 9,
      maxRadius: 22,
      side: 'outside',
      offset: 3,
      faceRoad: true,
    },
    {
      asset: 'marker_post',
      every: 50,
      side: 'both',
      offset: 1.4,
      from: START + 400,
      alongRoad: true,
    },
    // ... closer on the outside of the bends (white posts, red reflectors): every 16 m where the radius is under 80 m.
    {
      asset: 'marker_post',
      every: 16,
      maxRadius: 80,
      side: 'outside',
      offset: 1.4,
      from: START + 400,
      alongRoad: true,
    },
    // Lamps along Salvador Aljende street at the start (the run-up and the first stretch of the climb).
    {
      asset: 'street_lamp',
      every: 38,
      from: 0,
      to: START + 380,
      side: 'right',
      offset: 1.6,
      minRadius: 40,
      faceRoad: true,
    },
    // The suburban start street (the run-up and the first 700 m of the climb): single trees and the odd bush along the
    // verge, with gaps between them; the trees stand back from the road, the bushes at its edge.
    {
      asset: 'walnut_tree',
      every: 38,
      from: 0,
      to: START + 700,
      side: 'both',
      offset: 8,
      depth: 4,
      scale: [0.9, 1.4],
      skipJunctions: 6,
    },
    {
      asset: 'oak_tree',
      every: 44,
      from: 8,
      to: START + 700,
      side: 'both',
      offset: 9.5,
      depth: 4,
      scale: [0.8, 1.3],
      skipJunctions: 6,
    },
    {
      asset: 'locust_tree',
      every: 34,
      from: 4,
      to: START + 700,
      side: 'both',
      offset: 8.5,
      depth: 4,
      scale: [0.9, 1.3],
      skipJunctions: 6,
    },
    // (none on the retaining wall's terrace)
    ...[
      [0, WALL_RANGE[0] - 10],
      [WALL_RANGE[1] + 10, START + 700],
    ].map(([from, to]) => ({
      asset: 'bramble_shrub',
      every: 30,
      from,
      to,
      side: 'both' as const,
      offset: 3.5,
      depth: 2,
      scale: [0.8, 1.3] as [number, number],
      skipJunctions: 6,
    })),
    // Crowds: the start, the hairpins above it, the Vidikovec junction, the finish at Sredno Vodno.
    {
      asset: 'spectator',
      at: [START + 25, 1500, 2650, FINISH - 30, FINISH + 20],
      side: 'right',
      offset: 8,
      count: 10,
      spread: 16,
      depth: 3,
      faceRoad: true,
    },
    {
      asset: 'tape_post',
      at: [START + 25, 1500, 2650, FINISH - 30, FINISH + 20],
      side: 'right',
      offset: 5,
      count: 7,
      spread: 18,
    },
  ],
  // Marshals / onlookers behind the closed side-street mouths.
  streetDressing: { spectators: { perJunction: 4, reach: 500 } },
  railways: data.railways as RailwayDef[],
  // Rusted steel guard rails on the outside of the hairpins (the drop on the switchbacks) and along the drop of the
  // approach to the Vidikovec car park (the rail ends where the lot's retaining wall begins); a galvanised one on the left
  // after the first crossroad, where the verge falls away.
  barriers: [
    ...[
      ...hairpinRails(data.route, {
        maxRadius: 30,
        lead: 20,
        offset: RAIL_OFFSET,
      }),
      {
        kind: 'guardrail',
        side: 'right',
        offset: RAIL_OFFSET,
        from: VIDIKOVEC_RAIL.from,
        to: VIDIKOVEC_RAIL.to,
        skipJunctions: 4,
      } satisfies BarrierRule,
    ].map((rule) => ({ ...rule, rusty: true })),
    // A short galvanised rail between the road and the Vidikovec lot, uphill of its lower entrance, ending at the grass
    // island with the notice board (the owner's photos).
    {
      kind: 'guardrail',
      side: 'right',
      offset: RAIL_OFFSET,
      from: VIDIKOVEC_RAIL.lot[0],
      to: VIDIKOVEC_RAIL.lot[1],
      skipJunctions: 4,
      rusty: false,
    } satisfies BarrierRule,
    {
      kind: 'guardrail',
      side: 'left',
      offset: RAIL_OFFSET,
      from: 500,
      to: 640,
      skipJunctions: 4,
      rusty: false,
    } satisfies BarrierRule,
  ],
  // The 2000 m hairpin's rail (ending at 1994 m) curves round into the closed side road and runs up its edge to the sand
  // piles (ref-03).
  sideRoadRails: [
    {
      from: [2151.2, -69.2],
      to: [SIDE_ROAD_BLOCK.x, SIDE_ROAD_BLOCK.z],
      side: 'left',
      offset: RAIL_OFFSET,
      join: { along: 1994, side: 'left', offset: RAIL_OFFSET },
      rusty: true,
    },
  ],
  // Galvanised rails (ref-07 / ref-12) wherever the fill bank / the valley side drops more than 2 m within 3 m of the
  // verge (world/drop-rails.ts; the map's own rails above win).
  dropRails: { minDrop: 2, rusty: false, offset: RAIL_OFFSET },
  props,
  landmarks: [
    'vodno-sredno-vodno',
    'vodno-summit',
    'vodno-nerezi',
    'vodno-outposts',
    'vodno-car-parks',
    'vodno-restaurant',
    'vodno-gate',
    'vodno-start-blocks',
    'vodno-crossroad-hotel',
    'vodno-start-lot',
    'vodno-roadside-gazebo',
    'vodno-pulloff-gazebo',
    'vodno-trail-lot',
    // OSM's park furniture, gates and fences along the stage (data.json features), where no landmark above models them
    'vodno-osm-features',
  ],
  features: data.features as MapFeatures,
};
