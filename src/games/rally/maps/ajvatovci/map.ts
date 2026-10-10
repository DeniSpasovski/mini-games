import { buildingsFromData, routePoints, routeSpans } from '../shared/real-map';
import type {
  HeightmapDef,
  HorizonDef,
  LandcoverDef,
  MapDef,
  PathDef,
} from '../shared/types';
import data from './data.json';
import horizon from './horizon.json';
import { ajvatovciInfo as info } from './info';
import { HILLTOP_FLATS } from './hilltop';
import { STATION_FLAT } from './station';
import { startRowPads } from './start-row';

/**
 * "Ajvatovci Hill" - first real-world stage: Ilinden industrial zone (by the A2 motorway)
 * -> over the Aracinovo canal -> flat farmland road -> through Ajvatovci village -> up the
 * switchbacks to the pine-covered hill above the village. ~4.5 km, narrow old tarmac with
 * a film of loose gravel.
 *
 * Terrain, land cover, roads and the route are baked from open data by
 * `python scripts/realmap/bake.py scripts/realmap/ajvatovci.json` into ./data.json
 * (elevation: AWS Terrain Tiles; land cover: ESA WorldCover 2021 + OSM; roads: OSM).
 * Edit THIS file for gameplay / look; re-bake only to change the source data.
 * World (0, 0) = 42.004 N, 21.596 E; +X east, +Z south. Task list: ./TODO.md.
 * The baked area reaches well past the stage (Ilinden town, Marino, the A2) so free drive has
 * real roads and buildings to explore (bounds below).
 */

/** Road width by distance along the route (m): industrial street, field road, village, hill. */
function widthAt(along: number): number {
  if (along < 540) return 7;
  if (along < 2350) return 5.6;
  if (along < 3680) return 6;
  return 5.2;
}

/** Uncultivated covers: meadow grass detail layer. */
const WILD = [
  'grass',
  'shrub',
  'pine',
  'bare',
  'cemetery',
  'industrial',
  'urban',
];

export const ajvatovciMap: MapDef = {
  ...info,
  // Plain instanced boxes (house / flat): the baked `kind` (mesh buildings with facades) is left out so
  // the ~6 500 buildings of the Ilinden / Marino background stay cheap and the stage keeps its look.
  buildings: buildingsFromData({ ...data.buildings, kinds: undefined }),
  // 125 pylons / poles + 6 power lines from OSM: lattice towers on the long spans, wooden poles on the short ones.
  pylons: data.pylons as [number, number][],
  powerLines: data.powerLines as number[][],
  // The Tabanovci - Gevgelija main line (electrified) through Ilinden station + sidings, the freight line north.
  railways: data.railways,
  // The industrial street at the start: hand-modelled lots replace the placeholder boxes there.
  // The hilltop: the church of St. Peter and St. Paul + bell tower at the finish, the playground court.
  // Ilinden railway station west of the start: building, platforms, crossing.
  landmarks: ['ajvatovci-start-row', 'ajvatovci-hilltop', 'ajvatovci-station'],
  // Far land around the map (terrain + land cover) as a backdrop: scripts/realmap/horizon.py.
  horizon: horizon as HorizonDef,
  terrain: {
    baseHeight: 0,
    // Shift so the start (232 m above sea level) sits near y = 0.
    heightmap: { ...(data.heightmap as HeightmapDef), offset: 232 },
    // Real elevation is ~30 m resolution: add the small undulations it can't see.
    layers: [
      { scale: 70, amplitude: 0.7, octaves: 2 },
      { scale: 16, amplitude: 0.18, octaves: 2 },
    ],
    edgeRise: 0,
    // Level lawn round the hilltop church and the court's terrace (the 30 m DEM slopes ~20 % there).
    flatAreas: [...HILLTOP_FLATS, STATION_FLAT],
    // Level yards for the start row's lots (levelled to the sidewalk in front of each).
    pads: startRowPads(),
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.98, 0.02, 0, 0],
      shrub: [0.86, 0.1, 0.04, 0],
      pine: [0.65, 0.35, 0, 0],
      trees: [0.75, 0.25, 0, 0],
      orchard: [0.85, 0.15, 0, 0],
      urban: [0.68, 0.2, 0, 0.12],
      industrial: [0.3, 0.2, 0, 0.5],
      bare: [0.1, 0.55, 0, 0.35],
      water: [0.75, 0.25, 0, 0],
      vineyard: [0.5, 0.5, 0, 0],
      cemetery: [0.8, 0.12, 0, 0.08],
    },
    // Long strips running NNE like the real parcels. Spring: mostly green (young wheat,
    // meadow), a few freshly ploughed and a few golden wheat parcels (weight left
    // unused = ripe crop).
    fields: {
      covers: ['crop'],
      angle: -1.2,
      width: [22, 45],
      length: [140, 260],
      palette: [
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [0.94, 0.06, 0, 0],
        [0.94, 0.06, 0, 0],
        [0.8, 0.2, 0, 0],
        [0.75, 0, 0, 0],
        [0.1, 0.9, 0, 0],
        [0.3, 0.7, 0, 0],
        [0, 0.04, 0, 0],
      ],
    },
  },
  paths: [
    ...(data.paths as PathDef[]),
    // The road behind the start line: links the stage road to the A2 slip-road junction (the baked route starts at the line).
    {
      kind: 'tertiary',
      width: 7,
      surface: 'tarmac',
      junction: false,
      pts: [-1582, 414, -1560, 419, -1537, 425.5, -1513, 432.2, -1501.8, 436.3],
    },
  ],
  road: {
    width: 6,
    shoulder: 1.1,
    ditch: 0.3,
    crown: 0.04,
    smoothing: 60,
    maxGrade: 0.13,
    surface: 'tarmac_gravel',
    texture: 'road_tarmac',
    points: routePoints(data.route, widthAt),
    // The Aracinovo canal bridge (OSM bridge=yes): a deck over the lowered channel, abutments + parapets.
    spans: routeSpans(data.routeSpans),
  },
  scatter: [
    // Black pine plantations on the hills.
    {
      asset: 'pine_tree',
      cover: ['pine'],
      density: 9,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.55, 0.95],
      tilt: 3,
      sink: 0.3,
    },
    // The umbrella-crowned Austrian black pines of the plantations.
    {
      asset: 'black_pine',
      cover: ['pine'],
      density: 7,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.6, 1],
      tilt: 3,
      sink: 0.3,
    },
    {
      asset: 'oak_tree',
      cover: ['trees'],
      density: 7,
      minRoadDist: 3.5,
      scale: [0.7, 1.15],
      tilt: 4,
      sink: 0.2,
    },
    {
      asset: 'poplar_tree',
      cover: ['trees', 'water'],
      density: 3,
      minRoadDist: 3.5,
      scale: [0.8, 1.15],
      tilt: 2,
      sink: 0.2,
    },
    // Orchards: planted rows along the parcel's long side.
    {
      asset: 'fruit_tree',
      cover: ['orchard'],
      density: 0,
      rows: { spacing: 4.5, rowSpacing: 5.5, jitter: 0.4, keep: 0.94 },
      minRoadDist: 3,
      scale: [0.8, 1.1],
      tilt: 4,
      sink: 0.1,
    },
    // Big walnut / mulberry yard trees among the village gardens.
    {
      asset: 'walnut_tree',
      cover: ['urban'],
      density: 0.45,
      minRoadDist: 5,
      minPathDist: 3.5,
      scale: [0.8, 1.2],
      tilt: 2,
      sink: 0.15,
    },
    // Willows and reeds along the canal and the drains.
    {
      asset: 'willow_tree',
      channelDist: [1.8, 8],
      density: 4,
      minRoadDist: 6,
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.2,
    },
    {
      asset: 'reeds',
      channelDist: [0.3, 5],
      density: 90,
      detail: true,
      minRoadDist: 1.5,
      minPathDist: 0.3,
      scale: [0.8, 1.3],
    },
    // Tall dry weeds / thistles on the field margins.
    {
      asset: 'tall_weeds',
      cover: ['crop', 'grass'],
      density: 11,
      detail: true,
      mask: { scale: 60, threshold: 0.12 },
      minRoadDist: 0.8,
      scale: [0.8, 1.3],
    },
    // Village gardens.
    {
      asset: 'fruit_tree',
      cover: ['urban'],
      density: 2.5,
      minRoadDist: 3,
      minPathDist: 3,
      scale: [0.8, 1.25],
      tilt: 5,
      sink: 0.1,
    },
    {
      asset: 'poplar_tree',
      cover: ['urban', 'industrial'],
      density: 0.25,
      minRoadDist: 4,
      minPathDist: 3,
      scale: [0.8, 1.1],
      sink: 0.2,
    },
    // Hillside scrub: juniper / blackthorn bushes and lone oaks.
    {
      asset: 'juniper',
      cover: ['shrub'],
      density: 4,
      minRoadDist: 2.5,
      scale: [0.8, 1.4],
      sink: 0.1,
    },
    {
      asset: 'scrub_bush',
      cover: ['shrub'],
      density: 26,
      minRoadDist: 2,
      scale: [0.8, 1.7],
      sink: 0.15,
    },
    {
      asset: 'oak_tree',
      cover: ['shrub'],
      density: 1.1,
      minRoadDist: 4,
      scale: [0.5, 0.9],
      tilt: 5,
      sink: 0.2,
    },
    {
      asset: 'scrub_bush',
      cover: ['grass', 'pine', 'cemetery'],
      density: 2.2,
      minRoadDist: 2,
      mask: { scale: 120, threshold: -0.2 },
      scale: [0.7, 1.5],
      sink: 0.15,
    },
    {
      asset: 'scrub_bush',
      cover: ['crop', 'orchard', 'urban'],
      density: 0.5,
      minRoadDist: 2.5,
      minPathDist: 2,
      scale: [0.7, 1.3],
      sink: 0.15,
    },
    {
      asset: 'rock_small',
      cover: ['grass', 'shrub', 'bare'],
      density: 1.4,
      minRoadDist: 1.4,
      scale: [0.6, 1.4],
      alignToGround: true,
      sink: 0.08,
    },
    {
      asset: 'rock_boulder',
      cover: ['shrub', 'grass'],
      density: 0.06,
      minRoadDist: 4,
      maxSlope: 0.5,
      scale: [0.5, 1.2],
      alignToGround: true,
      sink: 0.35,
    },
    // Detail: fresh spring grass everywhere, a few of last year's dry stalks in the wild.
    {
      asset: 'spring_grass',
      cover: WILD,
      density: 280,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.4],
    },
    {
      asset: 'dry_grass',
      cover: WILD,
      density: 22,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.3],
    },
    {
      asset: 'spring_grass',
      cover: ['crop'],
      density: 45,
      detail: true,
      minRoadDist: 1,
      scale: [0.6, 1.1],
    },
    {
      asset: 'spring_grass',
      cover: ['orchard', 'trees', 'water', 'urban'],
      density: 160,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
  ],
  roadside: [
    // Lamps along the hill road (as on the street-view photos).
    {
      asset: 'street_lamp',
      every: 34,
      from: 3700,
      to: 4440,
      side: 'right',
      offset: 1.6,
      minRadius: 45,
      faceRoad: true,
    },
    // Lamps along the village street.
    {
      asset: 'street_lamp',
      every: 42,
      from: 2400,
      to: 3640,
      side: 'left',
      offset: 1.8,
      minRadius: 40,
      faceRoad: true,
    },
    {
      asset: 'chevron_sign',
      every: 9,
      maxRadius: 28,
      side: 'outside',
      offset: 3,
      faceRoad: true,
    },
    {
      asset: 'hay_bale',
      every: 12,
      maxRadius: 22,
      side: 'outside',
      offset: 2,
      count: 2,
      spread: 3,
    },
    // Crowds: canal bridge corner, the junction onto the Ajvatovci road, village, hairpin.
    {
      asset: 'spectator',
      at: [575, 1055, 3010, 4020, 4230],
      side: 'outside',
      offset: 8,
      count: 10,
      spread: 16,
      depth: 3,
      faceRoad: true,
    },
    {
      asset: 'tape_post',
      at: [575, 1055, 3010, 4020, 4230],
      side: 'outside',
      offset: 5,
      count: 7,
      spread: 18,
    },
  ],
  // Concrete parapets on the canal bridge deck.
  barriers: [{ kind: 'jersey', side: 'both', offset: 0.45, onBridge: true }],
  // The A2 motorway at the start: its carriageways get a Jersey median wall and an outer guard rail.
  pathBarriers: {
    kinds: ['motorway'],
    minWidth: 5.5,
    median: { kind: 'jersey', offset: 0.45 },
    outer: { kind: 'guardrail', offset: 0.55 },
    medianReach: 60,
  },
  // The A2 overpasses and the small street bridges are modern concrete bridges with steel railings (not stone).
  bridgeStyle: 'concrete',
  // Marshals / onlookers behind the closed junction mouths.
  streetDressing: { spectators: { perJunction: 4, reach: 400 } },
  // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
  cornerFans: {},
  junctionBarriers: { asset: 'road_barrier', length: 2.2, setback: 4 },
  // Start / finish gantries, lines and split boards come from `stage` (world/stage-signs.ts).
  // Village name boards where the road enters / leaves Ajvatovci (facing the driver coming in).
  props: [
    { asset: 'village_sign', along: 2335, lateral: 5.2, rotY: 180 },
    { asset: 'village_sign', along: 3690, lateral: -5.2 },
    // Barrier row across the road 11 m before its end (15 m out from the monastery gate), facing the
    // driver: a car that overshoots the finish has to stop before it - or hit it (solid, 2.2 m each).
    ...[-3.3, -1.1, 1.1, 3.3].map((lateral) => ({
      asset: 'road_barrier',
      along: -11,
      lateral,
      rotY: 180,
    })),
  ],
};
