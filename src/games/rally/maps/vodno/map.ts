import {
  buildingsFromData,
  hairpinRails,
  routePoints,
} from '../shared/real-map';
import type {
  BarrierRule,
  HeightmapDef,
  HorizonDef,
  LandcoverDef,
  MapDef,
  PathDef,
  PropPlacement,
  RailwayDef,
  ScatterRule,
} from '../shared/types';
import data from './data.json';
import horizon from './horizon.json';
import { vodnoInfo as info } from './info';
import { VODNO_FLATS } from './landmarks';
import { LOWER_NODE } from './landmarks/sites';
import { countryRoad, dropLotAisles, LAWNS, LOT_PADS } from './lots';
import { SKYLINE } from './skyline';
import { FINISH, START } from './stages';

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
 * The approach to the Vidikovec car park (m along the road): a guard rail on the drop at its right up to the lot's
 * wall.
 */
const VIDIKOVEC_RAIL = { from: 2600, to: 2796 };

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
 * Plantation conifers in bands from the road edge: a closed canopy at the verge, thinner across the slope where the
 * crowns are still drawn as sprites (the costly part of a tree; the road side within ~100 m is most of it), the full
 * forest behind (trees past 250 m are only impostors). [from, to, share of the density] (m).
 */
const PLANTATION_BANDS: [number, number | undefined, number][] = [
  [0, 40, 1.4],
  [40, 100, 0.8],
  [100, 245, 0.5],
  [245, undefined, 1],
];

function plantation(
  rule: Omit<ScatterRule, 'cover' | 'maxRoadDist'>,
): ScatterRule[] {
  return PLANTATION_BANDS.map(([from, to, share]) => ({
    ...rule,
    cover: ['pine'],
    density: rule.density * share,
    minRoadDist: Math.max(rule.minRoadDist ?? 0, from),
    maxRoadDist: to,
  }));
}

const props: PropPlacement[] = [
  // The cross faces the city: its arm runs north-west / south-east, square to the view from the stage.
  { asset: 'millennium_cross', x: CROSS.x, z: CROSS.z, rotY: -45 },
  { asset: 'antenna_mast', x: MAST.x, z: MAST.z },
];

export const vodnoMap: MapDef = {
  ...info,
  country: 'mk',
  buildings: buildingsFromData(data.buildings),
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
    flatAreas: VODNO_FLATS,
    pads: LOT_PADS,
    lawns: LAWNS,
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.78, 0.16, 0.06, 0],
      shrub: [0.55, 0.28, 0.17, 0],
      trees: [0.5, 0.45, 0.05, 0],
      // Pine plantation floor: needles and bare earth.
      pine: [0.3, 0.68, 0.02, 0],
      beech: [0.25, 0.73, 0.02, 0],
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
  paths: countryRoad(dropLotAisles(data.paths as PathDef[])),
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
  },
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
  cityStreets: { reach: 320, sidewalk: 1.4, lampEvery: 38 },
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
    surface: 'tarmac',
    // Clean city asphalt on the run-up street, then the worn mountain road with its white edge and centre lines.
    texture: 'road_city',
    sections: [
      { from: START, surface: 'tarmac', texture: 'road_tarmac_lines' },
    ],
    points: routePoints(data.route, (along) =>
      along < START + 500 ? 6.4 : 5.8,
    ),
  },
  // Nothing grows south of the ridge (the cross stands at z 796): no stage camera sees the far side of Vodno, 1.1 km and more from the
  // road, past the forest distance and behind the mountain.
  scatterBounds: { maxZ: 900 },
  scatter: [
    // The pine plantations that cover most of Vodno (planted from the 1950s): dense, dark conifers with some Austrian
    // black pine among them, oak and scrub below. The road runs through them: a closed canopy at the verge (the satellite
    // view of the start street has the forest right at its south edge).
    ...plantation({
      asset: 'plantation_pine',
      density: 7,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      scale: [0.8, 1.2],
      tilt: 2,
      sink: 0.3,
    }),
    // A few full pines at the verge, where the car passes close enough to see the needles.
    {
      asset: 'pine_tree',
      cover: ['pine'],
      density: 2.5,
      minRoadDist: 3.5,
      maxRoadDist: 40,
      maxSlope: 0.8,
      scale: [0.8, 1.2],
      tilt: 2,
      sink: 0.3,
    },
    ...plantation({
      asset: 'black_pine',
      density: 2.5,
      minRoadDist: 4,
      maxSlope: 0.8,
      scale: [0.75, 1.15],
      tilt: 2,
      sink: 0.3,
    }),
    {
      asset: 'oak_tree',
      cover: ['pine', 'trees'],
      density: 3,
      minRoadDist: 3.5,
      maxSlope: 0.75,
      mask: { scale: 150, threshold: 0.1 },
      scale: [0.65, 1.15],
      tilt: 4,
      sink: 0.25,
    },
    // Undergrowth: a thicket in the broadleaf woods, only the odd bush under the pines.
    {
      asset: 'thicket_shrub',
      cover: ['trees'],
      density: 6,
      minRoadDist: 2.2,
      maxSlope: 0.85,
      scale: [0.8, 1.25],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'thicket_shrub',
      cover: ['pine'],
      density: 1.5,
      minRoadDist: 2.2,
      maxSlope: 0.85,
      scale: [0.8, 1.25],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'bramble_shrub',
      cover: ['pine', 'trees', 'shrub'],
      density: 4,
      minRoadDist: 2,
      maxSlope: 0.8,
      scale: [0.8, 1.3],
      tilt: 3,
      sink: 0.1,
    },
    {
      asset: 'juniper',
      cover: ['trees', 'shrub'],
      density: 2,
      minRoadDist: 2.5,
      maxSlope: 0.8,
      scale: [0.7, 1.2],
      tilt: 3,
      sink: 0.1,
    },
    // Dry south-facing scrub and meadows on the lower slopes.
    {
      asset: 'scrub_bush',
      cover: ['shrub'],
      density: 20,
      minRoadDist: 2,
      scale: [0.8, 1.6],
      sink: 0.15,
    },
    {
      asset: 'oak_tree',
      cover: ['shrub', 'grass'],
      density: 0.6,
      minRoadDist: 4,
      mask: { scale: 200, threshold: 0 },
      scale: [0.55, 1],
      tilt: 5,
      sink: 0.2,
    },
    // Black locust, the roadside and wasteland tree of the Skopje valley, loose among the oaks of the lower slopes.
    {
      asset: 'locust_tree',
      cover: ['shrub', 'grass', 'trees'],
      density: 0.7,
      minRoadDist: 4,
      mask: { scale: 170, threshold: -0.05 },
      scale: [0.7, 1.15],
      tilt: 4,
      sink: 0.2,
    },
    {
      asset: 'rock_small',
      cover: ['pine', 'trees', 'bare', 'shrub', 'grass'],
      density: 1.5,
      minRoadDist: 1.4,
      scale: [0.6, 1.5],
      alignToGround: true,
      sink: 0.08,
    },
    {
      asset: 'rock_boulder',
      cover: ['pine', 'bare', 'shrub'],
      density: 0.3,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.5, 1.4],
      alignToGround: true,
      sink: 0.35,
    },
    // The suburb: garden trees between the houses.
    {
      asset: 'fruit_tree',
      cover: ['urban'],
      density: 2.5,
      minRoadDist: 3,
      minPathDist: 3,
      scale: [0.8, 1.3],
      tilt: 5,
      sink: 0.1,
    },
    {
      asset: 'locust_tree',
      cover: ['urban'],
      density: 1.2,
      minRoadDist: 4,
      minPathDist: 3,
      scale: [0.85, 1.25],
      tilt: 3,
      sink: 0.1,
    },
    {
      asset: 'cypress_tree',
      cover: ['urban'],
      density: 0.35,
      minRoadDist: 4,
      minPathDist: 3,
      scale: [0.8, 1.3],
      tilt: 1.5,
      sink: 0.1,
    },
    {
      asset: 'pale_tree',
      cover: ['urban'],
      density: 0.8,
      minRoadDist: 4,
      minPathDist: 3,
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.1,
    },
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
    // Detail: dry grass in the open, green tufts under the pines.
    {
      asset: 'dry_grass',
      cover: DRY,
      density: 240,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.55,
      scale: [0.7, 1.4],
    },
    {
      asset: 'grass_tuft',
      cover: ['pine', 'trees', 'orchard'],
      density: 110,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
  ],
  roadside: [
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
    // verge, with gaps between them; the garden trees stand behind them.
    {
      asset: 'walnut_tree',
      every: 38,
      from: 0,
      to: START + 700,
      side: 'both',
      offset: 5,
      depth: 3,
      scale: [0.9, 1.4],
      skipJunctions: 6,
    },
    {
      asset: 'oak_tree',
      every: 44,
      from: 8,
      to: START + 700,
      side: 'both',
      offset: 6,
      depth: 3,
      scale: [0.8, 1.3],
      skipJunctions: 6,
    },
    {
      asset: 'locust_tree',
      every: 34,
      from: 4,
      to: START + 700,
      side: 'both',
      offset: 5,
      depth: 3,
      scale: [0.9, 1.3],
      skipJunctions: 6,
    },
    {
      asset: 'bramble_shrub',
      every: 10,
      from: 0,
      to: START + 700,
      side: 'both',
      offset: 2.4,
      depth: 2,
      scale: [0.8, 1.3],
      skipJunctions: 6,
    },
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
  // approach to the Vidikovec car park (the rail ends where the lot's retaining wall begins).
  barriers: [
    ...hairpinRails(data.route, { maxRadius: 30, lead: 20 }),
    {
      kind: 'guardrail',
      side: 'right',
      offset: 0.9,
      from: VIDIKOVEC_RAIL.from,
      to: VIDIKOVEC_RAIL.to,
      skipJunctions: 4,
    } satisfies BarrierRule,
  ].map((rule) => ({ ...rule, rusty: true })),
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
  ],
};
