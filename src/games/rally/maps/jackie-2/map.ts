import { forestEdge } from '../shared/forest-edge';
import { buildingsFromData } from '../shared/real-map';
import type {
  HeightmapDef,
  HorizonDef,
  LakeDef,
  LandcoverDef,
  MapDef,
} from '../shared/types';
import type { NetworkData, NetworkPatch } from '../../world/v2/types';
import data from './data.json';
import horizon from './horizon.json';
import network from './network.json';
// The Kew Gardens junction core: v1's survey plaza (NYC Planimetric roadbed + islands, scripts/realmap/plaza_islands.py)
import kewGardens from '../jackie/junction.json';
// Queens Blvd x the Jackie's lane start (R7080): v1's survey area of that junction (same script, --area)
import laneStart from '../jackie/junction-lane-start.json';
// Queens Blvd SE of Kew Gardens (bus lane, medians, kerbed islands): this map's own survey area (same script)
import qbEast from './junction-qb-east.json';
// The fountain park east of Kew Gardens: lawn, footpaths, fountain (scripts/realmap/park_block.py: NYC planimetrics + OSM)
import parkKew from './park-kew.json';
// Protected bike lanes and painted medians (scripts/realmap/nyc_lanes.py: NYC DOT Bike Routes, NYC planimetrics)
import markings from './markings.json';
import patches from './network-patches.json';
import { jackie2Info as info } from './info';

/**
 * "The Jackie 2" - the Jackie Robinson Parkway on the v2 road engine (src/games/rally/world/v2/). Everything about the
 * roads comes from `network.json` (the OpenStreetMap graph, `python scripts/realmap/network.py
 * scripts/realmap/jackie-2.json`) + `network-patches.json` (hand edits by stable id) + the `nyc` template pack: lanes,
 * kerbs, sidewalks, junctions, decks, the Queens Blvd tunnel, retaining walls, paint, barriers and lamps are derived.
 * This file is gameplay and look only. World (0, 0) = 40.698 N, -73.863 E; +X east, +Z south.
 */

/** The stage starts ~33 m above sea level: y = 0 there. */
const START_HEIGHT = 32.9;
/** Covers where mown grass grows (detail layer). */
const LAWN = ['grass', 'shrub', 'bare', 'cemetery'];

export const jackie2Map: MapDef = {
  ...info,
  network: {
    data: network as unknown as NetworkData,
    patches: patches as NetworkPatch[],
    pack: 'nyc',
    // retaining wall look per stretch (drive videos, our lane): stone + picket railing by default (the 1930s parkway,
    // Kew Gardens); chain-link on the stone cuts through the cemeteries (2:05-2:25); board-formed concrete walls with
    // trees at the rim below Union Tpke (4:55-5:00); a concrete wall + chain-link past the first arch (1:41-1:43);
    wallStyles: [
      // poured concrete cut walls with chain-link on top past the arch (video 1:40-1:44)
      { from: 1950, to: 2100, wall: 'concrete', fence: 'chainlink' },
      { from: 2300, to: 2950, fence: 'chainlink' },
      // the parkway's deck over Metropolitan Ave: concrete parapets and end walls on both carriageways (video 4:42-4:44)
      { from: 6240, to: 6345, deck: 'concrete', wall: 'concrete' },
      // board-formed concrete to the Union Tpke overpass, tan / grey ashlar with railings on both rims past it (4:57-5:08)
      { from: 6580, to: 6790, wall: 'concrete', fence: 'none', maxHeight: 2.6 },
      // concrete barriers on the outer side: past the start bend (a grass verge before it, 0:16) to past the second arch
      // (0:18-0:27), and from the ashlar cut before the Queens Blvd tunnel through the Kew Gardens interchange (5:22-5:50)
      { from: 0, to: 50, barrier: 'none' },
      { from: 50, to: 280, barrier: 'jersey' },
      // the decks over Vermont Pl: a concrete Jersey parapet on the outer edge of both carriageways, the guard rail
      // ending against it (video 1:11-1:13, opposite lane 6:38-6:42)
      { from: 1228, to: 1290, barrier: 'jersey' },
      { from: 7200, to: 7800, barrier: 'jersey' },
      // tall tan / grey ashlar on both sides out of the Queens Blvd tunnel to the interchange (5:33-5:36)
      { from: 7300, to: 7470, wall: 'stone', fence: 'railing' },
    ],
    // pale cement-concrete pavement with sealed joints east of the Queens Blvd tunnel (drive video 5:30-5:49, opposite
    // lane 0:36-0:38); asphalt through the tunnel and at both portals (opposite lane 0:41-0:44 and 0:55-0:59)
    pavement: [{ from: 7474, to: 8000, surface: 'concrete' }],
    // the Queens Blvd tunnel's built-up steel girders: 12'-8" / 12'-10" under them on its plates (lidar deck top less
    // the floor less the slab)
    tunnels: [{ from: 7280, to: 7460, girder: 1.1, headwall: 'stone' }],
    deckStyles: [
      // Myrtle Ave over the parkway: a painted plate-girder bridge on masonry abutments (drive video 3:34-3:36)
      { way: '126080187', facing: 'steel' },
      // Union Tpke over the parkway: dark steel girders under the slab, mesh fence, poured concrete abutments (video
      // our 4:55-4:56, opposite 1:33-1:35)
      { way: '126077113', facing: 'steel', abutment: 'concrete' },
    ],
    // Queens Blvd x Union Tpke over the Queens Blvd tunnel (the end zone): one paved plaza from the survey, the OSM
    // carriageways end on its rim (one source per junction)
    plazas: [
      { area: kewGardens.area, islands: kewGardens.islands },
      { area: laneStart.area, islands: laneStart.islands },
      {
        area: qbEast.area,
        islands: qbEast.islands,
        crosswalks: qbEast.crosswalks,
      },
    ],
    parks: [parkKew],
    bikeLanes: markings.lanes,
    paintedMedians: markings.painted,
    // One-off bridges (by the OSM ways beneath; each deck also covers the skewed footprint of the road below, walls
    // included): v1's 36 m minimum span, so the cut walls of the road below end under the decks at the abutments; the
    // videos show the roadside Jersey barrier carried over both as a concrete parapet
    decks: [
      // both carriageways over the cemetery road Memory Road / Highland Way II (~2 760 m, a 6 m cut): one structure,
      // the median between the decks decked too (drive video 2:10-2:11: the median barrier runs on over it)
      {
        under: ['1362347043', '1126549028'],
        length: 36,
        median: true,
        parapet: 'jersey',
      },
      // both carriageways over Forest Park Drive at ~40 degrees (OSM bridge 3 549-3 586 m; drive video 3:22-3:23)
      { under: ['5700267'], length: 36, parapet: 'jersey' },
    ],
  },
  buildings: buildingsFromData(data.buildings),
  horizon: horizon as HorizonDef,
  terrain: {
    baseHeight: 0,
    heightmap: { ...(data.heightmap as HeightmapDef), offset: START_HEIGHT },
    layers: [{ scale: 22, amplitude: 0.12, octaves: 2 }],
    edgeRise: 0,
    rockSlope: [0.85, 1.25],
    flatAreas: [],
    lotYards: true,
  },
  landcover: {
    ...(data.landcover as Omit<LandcoverDef, 'splat' | 'fields'>),
    // Pine-needle carpet on the floor of the pine stands (world/ground-moisture.ts).
    needles: { pine: 1 },
    // the fountain park's lawn (the raster has it as bare / urban cells)
    paint: parkKew.lawn.map((poly) => ({ cover: 'grass', poly })),
    // [grass, dirt, rock, gravel]
    splat: {
      grass: [0.92, 0.06, 0.02, 0],
      shrub: [0.7, 0.25, 0.05, 0],
      pine: [0.6, 0.4, 0, 0],
      trees: [0.78, 0.2, 0.02, 0],
      orchard: [0.8, 0.2, 0, 0],
      urban: [0.4, 0.1, 0.32, 0.18],
      industrial: [0.05, 0.05, 0.4, 0.5],
      bare: [0.2, 0.5, 0.1, 0.2],
      water: [0.5, 0.5, 0, 0],
      vineyard: [0.3, 0.7, 0, 0],
      cemetery: [0.88, 0.1, 0.02, 0],
      crop: [0.9, 0.1, 0, 0],
      paved: [0.12, 0.08, 0.5, 0.3],
      open: [0.92, 0.06, 0.02, 0],
    },
  },
  lakes: data.lakes as LakeDef[],
  // The stage road: the route's control points; its height line, width, banking, structures come from the network.
  road: {
    points: network.stage.cps.map(([x, z]) => [x, z] as [number, number]),
    // the run-out past the route's end (its own piece: the route's samples - the Queens Blvd tunnel - stay put)
    runout: network.stage.runout?.pts.map(
      ([x, z]) => [x, z] as [number, number],
    ),
    // the narrower pavement half (lanes + median shoulder) x 2: timing, autopilot, the off-stage line
    width: 7.6,
    shoulder: 0,
    ditch: 0,
    crown: 0,
    smoothing: 120,
    maxGrade: 0.07,
    gradeSmoothing: 50,
    surface: 'tarmac',
    texture: 'road_parkway',
  },
  scatter: [
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
    // Industrial yards: pallet stacks, drums, crates, IBC tanks and a parked stacker (SimReady props), in clusters.
    {
      asset: 'pallet_stack',
      cover: ['industrial'],
      density: 1.6,
      minRoadDist: 4,
      minPathDist: 3,
      mask: { scale: 30, threshold: 0.0 },
      scale: [1, 1],
    },
    {
      asset: 'drum',
      cover: ['industrial'],
      density: 1.2,
      minRoadDist: 4,
      minPathDist: 3,
      mask: { scale: 30, threshold: 0.05 },
      scale: [1, 1],
    },
    {
      asset: 'crate',
      cover: ['industrial'],
      density: 0.35,
      minRoadDist: 4,
      minPathDist: 3,
      mask: { scale: 30, threshold: 0.1 },
      scale: [1, 1],
    },
    {
      asset: 'ibc_tank',
      cover: ['industrial'],
      density: 0.2,
      minRoadDist: 4,
      minPathDist: 3,
      mask: { scale: 30, threshold: 0.1 },
      scale: [1, 1],
    },
    {
      asset: 'forklift',
      cover: ['industrial'],
      density: 0.06,
      minRoadDist: 4,
      minPathDist: 3,
      mask: { scale: 30, threshold: 0.1 },
      scale: [1, 1],
    },
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
    // Where the road cuts a wood: shrub belt and young trees along the verge (maps/shared/forest-edge.ts).
    ...forestEdge({
      woods: ['trees', 'pine'],
      young: ['birch_tree', 'oak_tree'],
      open: ['shrub'],
    }),
  ],
  roadside: [
    // Chevron boards on the outside of the tight bends (drive videos: yellow on black, behind the barriers; rows of them in
    // the cemetery curves 2 600-2 900 m, the same bends that get the double lane line, `solidLaneRadius`).
    {
      asset: 'chevron_sign',
      every: 16,
      maxRadius: 130,
      side: 'outside',
      offset: 2.5,
      faceRoad: true,
    },
    // Tall twin-arm masts on the median barrier past the Queens Blvd tunnel (drive video 5:37-5:49).
    {
      asset: 'twin_lamp',
      every: 46,
      side: 'left',
      offset: 0.45,
      from: 7340,
      to: 7800,
      faceRoad: true,
    },
    // Crowds at the start, the splits and the finish (behind the barriers).
    {
      asset: 'spectator',
      at: [150, 180, 210, 1600, 3050, 4450, 5900, 7440, 7460],
      side: 'both',
      offset: 3.6,
      count: 6,
      spread: 12,
      faceRoad: true,
    },
  ],
  props: [],
  // Overhead signs: road names only, no shields; steel truss beams on lattice legs (drive videos 5:10, 5:41-5:46).
  overheadSigns: {
    lattice: true,
    signs: [
      // Metropolitan Ave advance board (drive video 4:05): a right cantilever ~30 m before the NYAR rail bridge (OSM, 5 445 m).
      {
        along: 5410,
        span: 'cantilever',
        boards: [
          {
            tab: 'EXIT 6',
            lines: ['Metropolitan Ave', 'Queens Blvd'],
            small: '1/2 MILE',
          },
        ],
      },
      // The guide gantry in Kew Gardens (drive video 5:10): over the lane-start junction at Queens Blvd, where v1 has it.
      {
        along: 7094,
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
      // The second guide gantry, out of the Queens Blvd tunnel before the finish (v1's place).
      {
        along: 7433,
        boards: [
          { tab: 'EXITS 8 E-W', lines: ['Grand Central Pkwy'], arrow: 'down' },
          { tab: 'EXIT 7', lines: ['Van Wyck Expwy', 'Bronx'], arrow: 'right' },
        ],
      },
      // The split past the finish (drive video 5:41, ~160 m past the Queens Blvd tunnel exit): over the run-out.
      {
        along: 7655,
        boards: [
          {
            tab: 'EXIT 8 E',
            lines: ['Grand Central Pkwy', 'Eastern Long Island'],
            arrow: 'down',
          },
          {
            tab: 'EXIT 7',
            lines: ['Van Wyck Expwy', 'Bronx'],
            arrow: 'right',
          },
        ],
      },
    ],
  },
  country: 'us',
};
