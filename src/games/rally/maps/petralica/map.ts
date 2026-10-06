import {
  buildingsFromData,
  bridgeChannelCrossings,
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
} from '../shared/types';
import data from './data.json';
import horizon from './horizon.json';
import { petralicaInfo as info } from './info';

/**
 * "Petralica" - real-world mountain stage in Rankovce municipality, north-east North Macedonia: Ginovci village
 * -> across the E-871 -> straight valley road up to Petralica -> narrow switchback track
 * through oak woods and pasture up to Vila Ristovski. ~9.6 km, 478 m -> 1040 m above sea level.
 *
 * Terrain, land cover, roads, houses and the route are baked from open data by
 * `python scripts/realmap/bake.py scripts/realmap/petralica.json` into ./data.json
 * (elevation: Copernicus GLO-30; land cover: ESA WorldCover 2021 + OSM; roads: OSM, plus two
 * parts OSM doesn't have, traced from the route screenshot - see ./DETAILS.md).
 * Edit THIS file for gameplay / look; re-bake only to change the source data.
 * World (0, 0) = 42.2055 N, 22.185 E; +X east, +Z south. Task list: ./TODO.md.
 */

/** Start of the village (m along) and of the hill track above it. */
const VILLAGE = 4300;
const CLIMB = 5350;
/** Where the asphalt ends and the gravel begins (m along): above Petralica, around half way. */
const GRAVEL = 4800;

/** Road width by distance along the route (m): valley road, Petralica, hill track. */
function widthAt(along: number): number {
  if (along < VILLAGE) return 5.6;
  if (along < CLIMB) return 5;
  return 4.4;
}

/** Covers where dry grass grows (detail layer). */
const DRY = ['grass', 'shrub', 'bare', 'urban', 'industrial'];

export const petralicaMap: MapDef = {
  ...info,
  // Box houses (the newer bake's building kinds would switch them to mesh buildings).
  buildings: buildingsFromData({ ...data.buildings, kinds: undefined }),
  // Fenced hazelnut farm + yard, tall trees along the road through the hedge (maps/petralica/properties/).
  landmarks: ['petralica-properties'],
  // Far land around the map (terrain + land cover) as a backdrop: scripts/realmap/horizon.py.
  horizon: horizon as HorizonDef,
  terrain: {
    baseHeight: 0,
    // Shift so the start (478 m above sea level) sits near y = 0.
    heightmap: { ...(data.heightmap as HeightmapDef), offset: 478 },
    // Real elevation is ~30 m resolution: add the small undulations it can't see.
    layers: [
      { scale: 80, amplitude: 0.9, octaves: 2 },
      { scale: 18, amplitude: 0.22, octaves: 2 },
    ],
    edgeRise: 0,
    flatAreas: [],
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.86, 0.1, 0.04, 0],
      shrub: [0.7, 0.2, 0.1, 0],
      pine: [0.5, 0.5, 0, 0],
      trees: [0.55, 0.43, 0.02, 0],
      orchard: [0.6, 0.4, 0, 0],
      // Mown grass between the hazelnut rows.
      hazelnut: [0.85, 0.15, 0, 0],
      urban: [0.6, 0.28, 0, 0.12],
      industrial: [0.25, 0.25, 0, 0.5],
      bare: [0.08, 0.5, 0.12, 0.3],
      water: [0.5, 0.5, 0, 0],
      vineyard: [0.3, 0.7, 0, 0],
      cemetery: [0.7, 0.2, 0, 0.1],
    },
    // Small strips across the valley floor: ploughed, stubble and fallow.
    fields: {
      covers: ['crop'],
      angle: 0.25,
      width: [16, 34],
      length: [70, 160],
      palette: [
        [0.1, 0.9, 0, 0],
        [0.2, 0.8, 0, 0],
        [0.85, 0.15, 0, 0],
        [1, 0, 0, 0],
        [0.6, 0.4, 0, 0],
      ],
    },
  },
  // Roads over the river get a short bridge deck (OSM has no bridge way at most crossings; the brook is a culvert).
  paths: bridgeChannelCrossings(data.paths as PathDef[]),
  // OSM bridge decks (the E-871 viaducts, road bridges over streams): modern concrete, not old stone.
  bridgeStyle: 'concrete',
  lakes: data.lakes as LakeDef[],
  road: {
    width: 5,
    shoulder: 0.9,
    ditch: 0.3,
    crown: 0.04,
    smoothing: 60,
    // Steep hill track. Two traced parts (~6.1 km and the last 300 m) cut across switchbacks the
    // screenshot doesn't show, so the terrain under them climbs at 20-30%: a lower limit digs the
    // road into a trench there (16% = 23 m deep at the finish). Lower it when the real line is known.
    maxGrade: 0.22,
    // Asphalt valley road (Ginovci -> Petralica) that turns to gravel on the climb.
    surface: 'tarmac',
    texture: 'road_tarmac',
    sections: [{ from: GRAVEL, surface: 'gravel', texture: 'road' }],
    points: routePoints(data.route, widthAt),
    // Bridge over the E-871 (OSM bridge=yes, ~1.1 km): the motorway dips under it (TerrainGen.dipUnderBridges).
    // OSM's 34 m deck sits off-centre over the motorway: its cut reached the north abutment, so it is lengthened.
    spans: lengthenBridges(routeSpans(data.routeSpans), 44),
  },
  scatter: [
    // Oak / beech woods on the slopes, with darker pine clumps mixed in.
    {
      asset: 'oak_tree',
      cover: ['trees'],
      density: 11,
      minRoadDist: 3.5,
      maxSlope: 0.7,
      scale: [0.7, 1.25],
      tilt: 4,
      sink: 0.25,
    },
    {
      asset: 'pine_tree',
      cover: ['trees', 'pine'],
      density: 9,
      minRoadDist: 4,
      maxSlope: 0.6,
      mask: { scale: 260, threshold: 0.28 },
      scale: [0.6, 1],
      tilt: 3,
      sink: 0.3,
    },
    {
      asset: 'scrub_bush',
      cover: ['trees'],
      density: 5,
      minRoadDist: 2,
      scale: [0.8, 1.5],
      sink: 0.15,
    },
    // Lane edges (Street View, S3): patchy belts of autumn thicket and young trees close to the road, an odd tall
    // pale-barked plane / ash among them, more saplings in the woods.
    {
      asset: 'thicket_shrub',
      cover: ['grass', 'shrub', 'trees', 'crop'],
      density: 22,
      minRoadDist: 2.2,
      maxRoadDist: 10,
      maxSlope: 0.8,
      mask: { scale: 120, threshold: 0.3 },
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'young_tree',
      cover: ['grass', 'shrub', 'trees'],
      density: 8,
      minRoadDist: 3,
      maxRoadDist: 14,
      maxSlope: 0.7,
      mask: { scale: 120, threshold: 0.35 },
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.2,
    },
    {
      asset: 'young_tree',
      cover: ['trees'],
      density: 3,
      minRoadDist: 3,
      maxSlope: 0.7,
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.2,
    },
    {
      asset: 'pale_tree',
      cover: ['grass', 'shrub', 'trees', 'water'],
      density: 1.5,
      minRoadDist: 3.5,
      maxRoadDist: 18,
      maxSlope: 0.6,
      mask: { scale: 200, threshold: 0.55 },
      scale: [0.85, 1.15],
      tilt: 2,
      sink: 0.25,
    },
    // Valley-floor poplars by the river.
    {
      asset: 'poplar_tree',
      cover: ['water'],
      density: 4,
      minRoadDist: 3.5,
      scale: [0.8, 1.15],
      tilt: 2,
      sink: 0.2,
    },
    // Orchards: planted rows along the long side of each parcel.
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
    // Hazelnut plantation above the hamlet (bake config manualCover): bushes in tight rows.
    {
      asset: 'hazelnut_tree',
      cover: ['hazelnut'],
      density: 0,
      rows: { spacing: 4.5, rowSpacing: 5.5, jitter: 0.4, keep: 0.95 },
      minRoadDist: 3,
      scale: [0.75, 1.1],
      tilt: 3,
      sink: 0.1,
    },
    // Village gardens.
    {
      asset: 'fruit_tree',
      cover: ['urban'],
      density: 3,
      minRoadDist: 3,
      minPathDist: 3,
      scale: [0.8, 1.3],
      tilt: 5,
      sink: 0.1,
    },
    // Open pasture: scattered scrub, lone oaks and rocks. The valley's tree patches are scrub too (bake
    // landcover.plainTreesAs): mostly bushes and autumn thicket, a tall oak / plane every 25-40 m.
    {
      asset: 'scrub_bush',
      cover: ['shrub'],
      density: 24,
      minRoadDist: 2,
      scale: [0.8, 1.7],
      sink: 0.15,
    },
    {
      asset: 'thicket_shrub',
      cover: ['shrub'],
      density: 6,
      minRoadDist: 2.2,
      maxSlope: 0.8,
      scale: [0.75, 1.15],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'oak_tree',
      cover: ['shrub'],
      density: 0.6,
      minRoadDist: 4,
      maxSlope: 0.7,
      scale: [0.8, 1.2],
      tilt: 4,
      sink: 0.25,
    },
    {
      asset: 'pale_tree',
      cover: ['shrub'],
      density: 0.6,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.85, 1.15],
      tilt: 2,
      sink: 0.25,
    },
    {
      asset: 'scrub_bush',
      cover: ['grass'],
      density: 4,
      minRoadDist: 2,
      mask: { scale: 140, threshold: -0.1 },
      scale: [0.7, 1.6],
      sink: 0.15,
    },
    {
      asset: 'oak_tree',
      cover: ['grass', 'shrub'],
      density: 0.5,
      minRoadDist: 4,
      mask: { scale: 200, threshold: 0 },
      scale: [0.55, 1],
      tilt: 5,
      sink: 0.2,
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
      cover: ['grass', 'shrub', 'bare', 'trees'],
      density: 1.6,
      minRoadDist: 1.4,
      scale: [0.6, 1.5],
      alignToGround: true,
      sink: 0.08,
    },
    {
      asset: 'rock_boulder',
      cover: ['shrub', 'grass', 'bare'],
      density: 0.1,
      minRoadDist: 4,
      maxSlope: 0.5,
      scale: [0.5, 1.3],
      alignToGround: true,
      sink: 0.35,
    },
    // Detail: dry grass on the open slopes, greener tufts under trees and in gardens.
    {
      asset: 'dry_grass',
      cover: DRY,
      density: 280,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.4],
    },
    {
      asset: 'dry_grass',
      cover: ['crop'],
      density: 45,
      detail: true,
      minRoadDist: 1,
      scale: [0.6, 1.1],
    },
    {
      asset: 'grass_tuft',
      cover: ['orchard', 'trees', 'pine', 'water'],
      density: 150,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
  ],
  roadside: [
    {
      asset: 'chevron_sign',
      every: 9,
      maxRadius: 26,
      side: 'outside',
      offset: 3,
      faceRoad: true,
    },
    {
      asset: 'hay_bale',
      every: 12,
      maxRadius: 20,
      side: 'outside',
      offset: 2,
      count: 2,
      spread: 3,
    },
    // Crowds: Ginovci, the E-871 crossing, Petralica and two bends on the climb.
    {
      asset: 'spectator',
      at: [330, 1160, 5150, 6900, 8850],
      side: 'outside',
      offset: 8,
      count: 10,
      spread: 16,
      depth: 3,
      faceRoad: true,
    },
    {
      asset: 'tape_post',
      at: [330, 1160, 5150, 6900, 8850],
      side: 'outside',
      offset: 5,
      count: 7,
      spread: 18,
    },
  ],
  // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
  // Small fan groups (tape, spectators, flags) inside the tight corners.
  cornerFans: {},
  junctionBarriers: { asset: 'road_barrier', length: 2.2, setback: 4 },
  // Steel guard rails over the E-871 bridge (1097-1141 m), a few metres past each end over the embankments.
  barriers: [
    { kind: 'guardrail', side: 'both', offset: 0.9, from: 1085, to: 1147 },
  ],
  // Start / finish gantries, lines and split boards come from `stage` (world/stage-signs.ts).
  props: [
    // White hatchback in the yard of house 665 (stage-road side, parallel to the house).
    { asset: 'street_car', variant: 12, x: -338.5, z: 2440.5, rotY: 50 },
  ],
};
