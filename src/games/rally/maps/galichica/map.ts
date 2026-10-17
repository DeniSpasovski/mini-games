import {
  buildingsFromData,
  hairpinRails,
  routePoints,
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
import { galichicaInfo as info } from './info';
import { galichicaLotPads } from './service-park';

/**
 * "Galichica" - the pass road over Galichica mountain (national park, North Macedonia) between Lake Ohrid (west, 693 m)
 * and Lake Prespa (east, ~850 m), over the Livada pass (~1 570 m). One world, three stages (./stages.ts): the west
 * climb, the east climb and the whole crossing from Prespa to Ohrid, all on this one road.
 *
 * Baked from open data by `python scripts/realmap/bake.py scripts/realmap/galichica.json` (terrain, land cover with
 * altitude belts, the pass road and the roads round the stage ends, both lakes) and
 * `python scripts/realmap/horizon.py scripts/realmap/galichica.json` (the whole Ohrid - Prespa basin as a backdrop).
 * The road runs west -> east: park entrance above Lake Ohrid -> Magaro parking at the pass -> Prespa shore.
 * Edit THIS file for the look; re-bake only to change the source data. World (0, 0) = 40.955 N, 20.845 E;
 * +X east, +Z south. Task list: ./TODO.md.
 */

/** Height of the park entrance (west start, on the hillside above Lake Ohrid): y = 0 there. */
const BASE_HEIGHT = 882;

/** Covers where dry grass grows (detail layer). */
const DRY = ['grass', 'shrub', 'bare', 'pasture', 'urban'];

export const galichicaMap: MapDef = {
  ...info,
  country: 'mk',
  buildings: buildingsFromData({ ...data.buildings, kinds: undefined }),
  horizon: horizon as HorizonDef,
  terrain: {
    baseHeight: 0,
    heightmap: { ...(data.heightmap as HeightmapDef), offset: BASE_HEIGHT },
    // ~30 m elevation data: add the small undulations it can't see (karst lumps on the top).
    layers: [
      { scale: 70, amplitude: 1.1, octaves: 2 },
      { scale: 16, amplitude: 0.25, octaves: 2 },
    ],
    edgeRise: 0,
    // Limestone: steep cut slopes show bare rock.
    rockSlope: [0.6, 1.0],
    flatAreas: [],
    // The parc fermé lay-bys behind the Ohrid and Prespa starts (./service-park.ts).
    pads: galichicaLotPads(),
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.82, 0.12, 0.06, 0],
      // Karst pasture: thin golden grass over pale limestone.
      pasture: [0.62, 0.1, 0.28, 0],
      shrub: [0.62, 0.22, 0.16, 0],
      trees: [0.5, 0.45, 0.05, 0],
      // Beech forest floor: brown leaf litter.
      beech: [0.25, 0.73, 0.02, 0],
      pine: [0.45, 0.55, 0, 0],
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
  paths: data.paths as PathDef[],
  // Side roads here are dirt / forest tracks: drawn as gravel ribbons (objects), not only paint.
  trackRibbons: true,
  // Tracks over lumpy karst and steep woods: a longer height window than the default track (25 m) keeps them smooth.
  pathProfiles: { track: [45, 0.18], unclassified: [70, 0.12] },
  lakes: data.lakes as LakeDef[],
  road: {
    width: 5.6,
    shoulder: 0.8,
    ditch: 0.3,
    crown: 0.04,
    smoothing: 50,
    // The real pass road is graded (~5 % average, short 10-11 % ramps); the ~30 m elevation data on 40 % slopes asks
    // for 16 %+ in places (an OSM line a few metres off on a steep slope reads metres of height): cap it, the road is
    // cut / filled into the mountainside like the built one.
    maxGrade: 0.11,
    surface: 'tarmac',
    texture: 'road_tarmac',
    points: routePoints(data.route, () => 5.6),
  },
  scatter: [
    // Low slopes (Ohrid / Prespa sides, < 1 150 m): a closed canopy of bright-green hornbeam / oak coppice over
    // hazel and juniper, black pine only in its plantations, flowering broom on the road cuttings.
    {
      asset: 'hornbeam_tree',
      cover: ['trees'],
      density: 13,
      minRoadDist: 3,
      maxSlope: 0.8,
      scale: [0.7, 1.2],
      tilt: 5,
      sink: 0.2,
    },
    {
      asset: 'oak_tree',
      cover: ['trees'],
      density: 4,
      minRoadDist: 3.5,
      maxSlope: 0.75,
      scale: [0.65, 1.15],
      tilt: 4,
      sink: 0.25,
    },
    {
      asset: 'hazelnut_tree',
      cover: ['trees'],
      density: 10,
      minRoadDist: 2.2,
      maxSlope: 0.85,
      scale: [0.8, 1.25],
      tilt: 3,
      sink: 0.15,
    },
    {
      asset: 'black_pine',
      cover: ['pine'],
      density: 6,
      minRoadDist: 4,
      maxSlope: 0.7,
      mask: { scale: 300, threshold: 0.35 },
      scale: [0.75, 1.15],
      tilt: 2,
      sink: 0.3,
    },
    {
      asset: 'juniper',
      cover: ['trees', 'shrub'],
      density: 2.5,
      minRoadDist: 2.5,
      maxSlope: 0.8,
      scale: [0.7, 1.2],
      tilt: 3,
      sink: 0.1,
    },
    {
      asset: 'broom_shrub',
      cover: ['trees', 'beech', 'shrub', 'grass'],
      density: 14,
      minRoadDist: 1.8,
      maxRoadDist: 8,
      maxSlope: 0.9,
      scale: [0.7, 1.2],
      tilt: 4,
      sink: 0.1,
    },
    // Mid slopes (1 150 - 1 750 m): beech forest with hornbeam, fresh-green hazel undergrowth.
    {
      asset: 'beech_tree',
      cover: ['beech'],
      density: 12,
      minRoadDist: 3.5,
      maxSlope: 0.8,
      scale: [0.75, 1.2],
      tilt: 3,
      sink: 0.3,
    },
    {
      asset: 'hornbeam_tree',
      cover: ['beech'],
      density: 4,
      minRoadDist: 3,
      maxSlope: 0.8,
      scale: [0.75, 1.2],
      tilt: 4,
      sink: 0.2,
    },
    {
      asset: 'hazelnut_tree',
      cover: ['beech'],
      density: 4,
      minRoadDist: 2,
      scale: [0.7, 1.2],
      sink: 0.1,
    },
    // Top (karst pasture above ~1 450 m): no trees, dwarf juniper mats, limestone blocks.
    {
      asset: 'scrub_bush',
      cover: ['pasture'],
      density: 6,
      minRoadDist: 2,
      maxSlope: 0.5,
      mask: { scale: 120, threshold: -0.15 },
      scale: [0.6, 1.2],
      sink: 0.15,
    },
    {
      asset: 'rock_boulder',
      cover: ['pasture', 'bare'],
      density: 0.4,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.5, 1.4],
      alignToGround: true,
      sink: 0.35,
    },
    {
      asset: 'rock_small',
      cover: ['pasture', 'bare', 'shrub', 'grass'],
      density: 2,
      minRoadDist: 1.4,
      scale: [0.6, 1.5],
      alignToGround: true,
      sink: 0.08,
    },
    // Open scrub and meadows lower down.
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
      density: 0.5,
      minRoadDist: 4,
      mask: { scale: 200, threshold: 0 },
      scale: [0.55, 1],
      tilt: 5,
      sink: 0.2,
    },
    // Prespa plain: apple orchards in rows, garden trees in the villages, reeds and willows at the shore.
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
      asset: 'willow_tree',
      cover: ['crop', 'grass', 'orchard'],
      channelDist: [0, 6],
      density: 4,
      minRoadDist: 3,
      scale: [0.8, 1.2],
      tilt: 3,
      sink: 0.2,
    },
    // Detail: dry golden grass on the open slopes, green tufts under the trees.
    {
      asset: 'dry_grass',
      cover: DRY,
      density: 260,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.55,
      scale: [0.7, 1.4],
    },
    {
      asset: 'grass_tuft',
      cover: ['trees', 'beech', 'pine', 'orchard', 'crop'],
      density: 120,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    },
  ],
  roadside: [
    // White / red chevrons on the outside of the hairpins (real Macedonian mountain roads have them).
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
    },
  ],
  // Steel guard rails on the outside of the hairpins (the drop on the switchbacks), as on the real road.
  barriers: hairpinRails(data.route, { maxRadius: 30, lead: 20 }),
  props: [],
};
