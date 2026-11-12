import { buildingsFromData, routePoints, routeSpans } from '../shared/real-map';
import type {
  DitchDef,
  HeightmapDef,
  HorizonDef,
  LandcoverDef,
  MapDef,
  PathDef,
  ScatterRule,
} from '../shared/types';
import data from './data.json';
import horizon from './horizon.json';
import { ajvatovciInfo as info } from './info';
import { HILLTOP_FLATS } from './hilltop';
import { STATION_FLAT } from './station';
import { fieldLinkPads, fieldLotPad, startLotPad } from './service-park';
import { startRowPads } from './start-row';
import { forestEdge } from '../shared/forest-edge';
import { seedingGrass } from '../shared/seasonal-grass';

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

/** Road width by distance along the route (m): industrial street (to the start row's last kerb, round the first
 * corner), field road, village, hill. */
function widthAt(along: number): number {
  if (along < 556) return 7;
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

/**
 * Grass detail by season: fresh spring grass in spring and summer; in autumn the olive meadow grass and a good share of
 * dry stalks (October on the plain: green low down, straw on top).
 */
const seasonalGrass = (r: ScatterRule): ScatterRule[] => [
  { ...r, season: ['spring', 'summer'] },
  { ...r, asset: 'grass_tuft', density: r.density * 0.65, season: ['autumn'] },
  { ...r, asset: 'dry_grass', density: r.density * 0.35, season: ['autumn'] },
];

/**
 * The drains and the canal are field ditches (`terrain.ditches`): a V about 7 m across and 1.7 m deep, a trickle in its
 * bed, the reed bed drawn as one volume over it (world/reed-bed.ts). The mown strip and the maintenance track run on the
 * ditch's right (looking along it; at the stage bridge the side away from the start), the dredged spoil and brush heaps
 * beyond them; the other bank is weeds, saplings and bramble down to the field.
 */
const DITCHES: DitchDef = {
  kinds: ['drain', 'ditch'],
  topWidth: 7,
  bedWidth: 1,
  depth: 1.7,
  water: 0,
  track: 1,
  mown: 3,
  trackWidth: 2.6,
  reedBed: { height: [0.15, 0.45], cover: 0.86, reach: 700 },
};

/**
 * What grows in and along the ditches by season (ref photos of the bridge canal: July thicket, November). Distances are
 * from the drain's mapped edge (2.5 m out from its line; the ditch lip is 1 m beyond it, its bed 2 m inside it).
 *
 * - The reed bed itself is the volume; reed cards stand along its edges and through its top for the silhouette and the
 *   plumes (`ditchTop`: the tops level, 0.8-1.4 m above the bank): green in summer, the November stand in autumn (olive
 *   below, straw above, beige plumes), last year's bleached stems over the new shoots in spring. A few cattails.
 * - The weedy bank (the left): broadleaf saplings and shrubs 1-2 m (ash / elm, box elder), bramble tangles, nettles,
 *   rust-red dead docks and knotweed in autumn, dry brush, rank grass.
 * - The track side (the right): a mown strip and the track (painted on the ground), short grass, the row of spoil heaps
 *   and dead brush beyond the track.
 */
const canalGrowth = (): ScatterRule[] => {
  const reedEdge = {
    channelDist: [-0.6, 1.0] as [number, number],
    detail: true,
    minRoadDist: 1.5,
    inChannel: true,
    minPathDist: 0.3,
    ditchTop: { top: [0.7, 1.3] as [number, number], height: 2.4 },
    // (replaced by `ditchTop` on a ditch)
    scale: [0.9, 1.1] as [number, number],
  };
  const reedTop = { ...reedEdge, channelDist: [-2.4, 1.0] as [number, number] };
  const wild = {
    channelDist: [0.4, 6] as [number, number],
    channelSide: -1 as const,
    detail: true,
    minRoadDist: 1,
    minPathDist: 0.3,
    scale: [0.8, 1.3] as [number, number],
  };
  const lip = {
    channelDist: [0.4, 1.6] as [number, number],
    channelSide: 1 as const,
    detail: true,
    minRoadDist: 1,
    minPathDist: 0.3,
    scale: [0.8, 1.2] as [number, number],
  };
  const sapling = {
    channelDist: [0.2, 3] as [number, number],
    channelSide: -1 as const,
    minRoadDist: 2.5,
    minPathDist: 0.8,
    mask: { scale: 26, threshold: -0.1 },
    sink: 0.05,
  };
  // Beyond the mown strip (3 m) and the track (2.6 m): e = 1 + 5.6 m on.
  const heaps = {
    channelDist: [7.0, 9.8] as [number, number],
    channelSide: 1 as const,
    minRoadDist: 4,
    minPathDist: 1,
    mask: { scale: 35, threshold: -0.2 },
  };
  return [
    // The reed bed's edges and top.
    { ...reedEdge, asset: 'reeds', density: 900, season: ['summer'] },
    { ...reedTop, asset: 'reeds', density: 900, season: ['summer'] },
    { ...reedEdge, asset: 'reeds_dry', density: 900, season: ['autumn'] },
    { ...reedTop, asset: 'reeds_dry', density: 900, season: ['autumn'] },
    {
      ...reedEdge,
      asset: 'reeds_old',
      density: 600,
      season: ['spring'],
      ditchTop: { top: [0.3, 0.9], height: 1.75 },
    },
    {
      ...reedEdge,
      asset: 'reeds_young',
      density: 500,
      season: ['spring'],
      ditchTop: { top: [-0.2, 0.3], height: 1.1 },
    },
    // Cattails (Typha) by the water, their spikes up in the bed's top.
    {
      ...reedTop,
      asset: 'cattails',
      density: 60,
      season: ['summer'],
      ditchTop: { top: [0.3, 0.8], height: 1.7 },
    },
    {
      ...reedTop,
      asset: 'cattails_dry',
      density: 60,
      season: ['autumn'],
      ditchTop: { top: [0.3, 0.8], height: 1.7 },
    },
    // The weedy bank: nettles and docks (green in spring / summer), rust-red dead docks and knotweed in autumn.
    { ...wild, asset: 'tall_weeds', density: 90, season: ['spring', 'summer'] },
    {
      ...wild,
      asset: 'rust_weeds',
      density: 520,
      season: ['autumn'],
      channelDist: [-1.2, 2.2],
      inChannel: true,
      mask: { scale: 9, threshold: -0.25 },
    },
    { ...wild, asset: 'tall_weeds', density: 40, season: ['autumn'] },
    // Rank grass over the rest of the bank (fresh in spring, straw in summer, both in autumn).
    { ...wild, asset: 'spring_grass', density: 700, season: ['spring'] },
    { ...wild, asset: 'dry_grass', density: 650, season: ['summer'] },
    { ...wild, asset: 'dry_grass', density: 300, season: ['autumn'] },
    { ...wild, asset: 'grass_tuft', density: 350, season: ['autumn'] },
    // The track side: weeds only on the lip, short grass on the mown strip.
    { ...lip, asset: 'tall_weeds', density: 60 },
    { ...lip, asset: 'rust_weeds', density: 120, season: ['autumn'] },
    {
      ...lip,
      asset: 'grass_tuft',
      density: 260,
      channelDist: [1.2, 4] as [number, number],
      scale: [0.6, 0.9] as [number, number],
    },
    // Broadleaf saplings and shrubs (ash / elm, box elder) 1-2 m on the weedy bank and out of the reed bed's edge, and
    // the dark bramble tangles between them.
    { ...sapling, asset: 'young_tree', density: 20, scale: [0.32, 0.5] },
    { ...sapling, asset: 'bush', density: 28, scale: [1.1, 1.6] },
    { ...sapling, asset: 'thicket_shrub', density: 12, scale: [0.8, 1.2] },
    {
      ...sapling,
      asset: 'bramble_shrub',
      density: 34,
      scale: [0.9, 1.3],
      mask: { scale: 14, threshold: 0.1 },
    },
    // Dry brush: cut branches and stems thrown on the bank.
    {
      ...wild,
      detail: false,
      asset: 'forest_branches',
      density: 5,
      scale: [0.9, 1.3],
      channelDist: [1, 5],
    },
    // The dredged spoil and brush heaps in a row beyond the track.
    { ...heaps, asset: 'spoil_heap', density: 80, scale: [0.9, 1.25] },
    { ...heaps, asset: 'forest_branches', density: 30, scale: [1.1, 1.6] },
  ];
};

export const ajvatovciMap: MapDef = {
  ...info,
  country: 'mk',
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
    // + the service park's gravel yards: beside the start and in the field NW of it (./service-park.ts).
    pads: [...startRowPads(), startLotPad(), fieldLotPad(), ...fieldLinkPads()],
    ditches: DITCHES,
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // Pine-needle carpet on the floor of the pine stands (world/ground-moisture.ts).
    needles: { pine: 1 },
    // The big parcel north-east of the industrial zone was traced as an orchard (the zone at 0.828 rad): it is a vineyard.
    zones: data.landcover.zones.map((z) =>
      z.cover === 'orchard' && 'angle' in z && z.angle === 0.828
        ? { ...z, cover: 'vineyard' }
        : z,
    ),
    // Two small vineyards north of the big curve that the open data misses (traced from satellite images).
    paint: [
      {
        cover: 'vineyard',
        angle: 0.656,
        poly: [-584, -482, -535, -546, -486, -508, -524, -441],
      },
      {
        cover: 'vineyard',
        angle: Math.PI / 2,
        poly: [-430, -480, -310, -482, -321, -377, -437, -373],
      },
    ],
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
    // Long strips running NNE like the real parcels: meadow / fodder (green), ploughed and wheat (weight left unused =
    // the season's crop tint: green in spring, golden in summer, stubble in autumn).
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
        [0, 0.04, 0, 0],
        [0.75, 0, 0, 0],
        [0.1, 0.9, 0, 0],
        [0, 0.04, 0, 0],
        [0, 0.04, 0, 0],
        [0, 0.04, 0, 0],
        [0, 0.04, 0, 0],
        [0, 0.04, 0, 0],
        [0, 0.04, 0, 0],
      ],
      // What stands on each palette entry (index as above): winter wheat, green in April, ripe in July and cut by
      // October (stubble). No corn here (that's the Palanka side).
      crops: {
        spring: [
          null,
          null,
          null,
          null,
          null,
          null,
          'green_wheat',
          null,
          null,
          'green_wheat',
          'green_wheat',
          'green_wheat',
          'green_wheat',
          'green_wheat',
          'green_wheat',
        ],
        summer: [
          null,
          null,
          null,
          null,
          null,
          null,
          'wheat',
          null,
          null,
          'wheat',
          'wheat',
          'wheat',
          'wheat',
          'wheat',
          'wheat',
        ],
      },
    },
  },
  paths: [
    // The baker leaves the rest of a way the stage follows for a stretch ("branch") unjoined (`junction: false`);
    // the one leaving the bend at (1688, -268) is joined to the stage road (bales still block the way straight on).
    ...(data.paths as PathDef[]).map((p) =>
      p.junction === false &&
      Math.hypot(p.pts[0] - 1687.6, p.pts[1] + 268.3) < 1
        ? { ...p, junction: true }
        : p,
    ),
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
    // Kerbed start street to the canal bridge: no edge grit; the open road after it.
    texture: 'road_tarmac_kerbed',
    sections: [
      {
        from: data.routeSpans[0].to,
        surface: 'tarmac_gravel',
        texture: 'road_tarmac',
      },
    ],
    points: routePoints(data.route, widthAt),
    // The Aracinovo canal bridge (OSM bridge=yes): a deck over the lowered channel, abutments + parapets.
    spans: routeSpans(data.routeSpans),
  },
  scatter: [
    // The planted pine stands on the hills (the hilltop's above the church): young full cones, needled to the foot.
    {
      asset: 'plantation_pine',
      cover: ['pine'],
      density: 12,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.5, 0.8],
      tilt: 2,
      sink: 0.3,
    },
    {
      asset: 'pine_tree',
      cover: ['pine'],
      density: 4,
      minRoadDist: 4,
      maxSlope: 0.6,
      scale: [0.55, 0.95],
      tilt: 3,
      sink: 0.3,
    },
    // A few older umbrella-crowned Austrian black pines among them.
    {
      asset: 'black_pine',
      cover: ['pine'],
      density: 1.5,
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
    // The ditches grow over in every season (the bridge canal: a reed bed, saplings, bramble and dead weeds).
    ...canalGrowth(),
    // Tall dry weeds on the field margins.
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
    ...seasonalGrass({
      asset: 'spring_grass',
      cover: WILD,
      density: 280,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.4],
    }),
    {
      asset: 'dry_grass',
      cover: WILD,
      density: 22,
      detail: true,
      minRoadDist: 1,
      maxSlope: 0.5,
      scale: [0.7, 1.3],
    },
    // Tall golden seeding grass on the verges and the fallow (ref-11): summer and autumn.
    ...seedingGrass({
      cover: [...WILD, 'orchard', 'trees', 'water'],
      verge: 450,
      fallow: 260,
      fallowCover: ['grass', 'shrub', 'bare'],
    }),
    ...seasonalGrass({
      asset: 'spring_grass',
      cover: ['crop'],
      density: 45,
      detail: true,
      minRoadDist: 1,
      scale: [0.6, 1.1],
    }),
    ...seasonalGrass({
      asset: 'spring_grass',
      cover: ['orchard', 'trees', 'water', 'urban'],
      density: 160,
      detail: true,
      minRoadDist: 1,
      scale: [0.7, 1.3],
    }),
    // Vineyards: 6 m row segments 2.4 m apart along each parcel's rows, the look of the map's season.
    ...(
      [
        ['vine_row_spring', 'spring'],
        ['vine_row', 'summer'],
        ['vine_row_autumn', 'autumn'],
      ] as const
    ).map(([asset, season]) => ({
      asset,
      cover: ['vineyard'],
      density: 0,
      rows: { spacing: 6, rowSpacing: 2.4, jitter: 0, keep: 1, face: true },
      season: [season],
      minRoadDist: 3,
      minPathDist: 1.5,
      scale: [0.97, 1.03] as [number, number],
    })),
    ...seasonalGrass({
      asset: 'spring_grass',
      cover: ['vineyard'],
      density: 90,
      detail: true,
      minRoadDist: 1,
      scale: [0.6, 1.1],
    }),
    // Field crops (landcover.fields.crops): wheat. 1 m card patches along the road edge, 3 x 2 m blocks (one instance
    // each) further into the fields.
    ...(['wheat', 'green_wheat'] as const).flatMap((crop) => [
      {
        asset: crop,
        cover: ['crop'],
        crop,
        density: crop === 'wheat' ? 1600 : 2000,
        detail: true,
        minRoadDist: 2.5,
        maxRoadDist: 6,
        scale: [0.85, 1.1] as [number, number],
      },
      {
        asset: `${crop}_block`,
        cover: ['crop'],
        crop,
        density: 0,
        detail: true,
        rows: { spacing: 3, rowSpacing: 2, jitter: 0.1, keep: 1, fields: true },
        minRoadDist: 5,
        scale: [0.92, 1.08] as [number, number],
      },
    ]),
    // Where the road cuts a wood: shrub belt and young trees along the verge (maps/shared/forest-edge.ts).
    ...forestEdge({
      woods: ['pine', 'trees'],
      young: ['oak_tree'],
      open: ['shrub'],
    }),
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
      // Small square bales, stacked, as at the local rallies (round bales on the other maps).
      asset: 'hay_bale_square',
      every: 12,
      maxRadius: 22,
      side: 'outside',
      offset: 2,
      count: 2,
      spread: 3,
      faceRoad: true,
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
  // The canal bridge: low concrete kerbs; a chipped yellow pipe railing on the right, on the left only two posts and
  // one pipe are left of it.
  barriers: [
    { kind: 'kerb', side: 'right', offset: 0.45, onBridge: true, rail: 'pipe' },
    {
      kind: 'kerb',
      side: 'left',
      offset: 0.45,
      onBridge: true,
      rail: 'pipe_broken',
    },
  ],
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
  // The canal bridge on the stage is a small slab over the ditch: the reedy banks slope up to it, no wing walls.
  stageSpanSlab: true,
  // Marshals / onlookers behind the closed junction mouths.
  // Benches, dustbins and utility cabinets along the village street.
  streetDressing: {
    spectators: { perJunction: 4, reach: 400 },
    village: [{ from: 2400, to: 3640 }],
  },
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
    // The bale of the corner rule (roadside above) that stands in the mouth of the side road joined in `paths`:
    // the rule drops solids on a road, so it is placed by hand to keep the way straight on blocked.
    { asset: 'hay_bale_square', along: 3703.5, lateral: -4.6, variant: 0 },
  ],
};
