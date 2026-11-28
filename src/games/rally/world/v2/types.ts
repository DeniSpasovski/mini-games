/**
 * Road engine v2: the data a map hands in (`MapDef.network`). The graph comes from `scripts/realmap/network.py`
 * (OpenStreetMap ways chained into junction-to-junction edges, stable OSM ids); hand fixes are patch operations on it
 * (`patches.ts`), never code in the map file. Pure types (node tests import them).
 */

/** Per-segment OSM tags the engine reads (network.json `tagSets`). */
export interface TagSet {
  bridge?: boolean;
  tunnel?: boolean;
  layer?: number;
  lanes?: number;
  lanesFwd?: number;
  lanesBack?: number;
  /** Curb to curb (m). */
  width?: number;
  /** `width` is the city survey's measured roadbed (network_survey.py), not an OSM tag: trusted further. */
  widthSurveyed?: boolean;
  sidewalk?: string;
  /** Parking lane left / right of the way direction (1 = yes). */
  parking?: [number, number];
  surface?: string;
  maxspeed?: number;
  turnFwd?: string;
  turnBack?: string;
}

/** One edge of the graph: junction (or end) to junction, OSM way joints already chained away. */
export interface EdgeData {
  /** `<first OSM way id>.<piece>` (stable across re-imports). */
  id: string;
  /** OSM highway class. */
  kind: string;
  name?: string;
  ref?: string;
  oneway?: boolean;
  service?: string;
  /** Flat [x0, z0, x1, z1, ...] world m, through the OSM nodes. */
  pts: number[];
  /** OSM node ids of the two ends. */
  nodes: [number, number];
  /** Runs of tag sets: [first segment, tagSets index]. */
  tags: [number, number][];
  /** Template id (patch `setTemplate`; default: the region pack picks by kind). */
  template?: string;
  /** Surveyed curb-to-curb width (m, network_survey.py): scales the template's pavement (beats the OSM `width`). */
  surveyWidth?: number;
  /** Parkway mainline: surveyed width per station [m along, carriageway width m] (network_survey.py `centre`). */
  widths?: [number, number][];
}

export interface StageSpanData {
  kind: 'bridge' | 'under';
  from: number;
  to: number;
  layer?: number;
}

export interface NetworkData {
  meta: Record<string, unknown>;
  stage: {
    /** Catmull-Rom control points of the stage route (the baker's smoothing). */
    cps: [number, number][];
    /** OSM bridge / tunnel stretches of the route (m along). */
    spans: StageSpanData[];
    length: number;
    /** Surveyed carriageway width of the stage route (m, network_survey.py). */
    surveyWidth?: number;
    /** Surveyed width per station [m along, carriageway width m] (network_survey.py, smoothed over 200 m). */
    widths?: [number, number][];
    /** The widths apply in the stage's bores too (survey `centre.bores`: a hall laid out on the survey). */
    boreWidths?: boolean;
    /** The run-out past the route's end (network.py `extend_stage`): RoadDef.runout points + their length (m). */
    runout?: { pts: [number, number][]; length: number };
  };
  /**
   * Survey data (network_survey.py): spot heights [x, z, y] in world heights the profiles follow (`decks`: the tops of
   * bridge decks and overpasses, for the ways on them only); retaining wall lines
   * [x0, z0, x1, z1, ...] and the stage metres the wall survey covers (the parkway's cut / fill walls stand only where it
   * has one, `Network.surveyedWall`).
   */
  survey?: {
    heights: [number, number, number][];
    decks?: [number, number, number][];
    source?: string;
    walls?: number[][];
    wallsUntil?: number;
  };
  /** [osm id, x, z, flags (1 signals, 2 stop), m along the stage route or -1]. */
  nodes: [number, number, number, number, number][];
  tagSets: TagSet[];
  edges: EdgeData[];
}

/** A small city park (`NetworkDef.parks`). */
export interface NetPark {
  paths: number[][];
  pathWidth: number;
  fountains: { x: number; z: number; r: number }[];
}

/** Hand edits of the imported graph, by stable id (network-patches.json). */
export type NetworkPatch =
  | { op: 'moveNode'; node: number; to: [number, number]; note?: string }
  | { op: 'dropEdge'; edge: string; note?: string }
  | { op: 'addEdge'; edge: EdgeData; note?: string }
  | { op: 'setTemplate'; edge: string; template: string; note?: string }
  | {
      op: 'setLanes';
      edge: string;
      fwd: number;
      back?: number;
      note?: string;
    }
  | { op: 'pinHeight'; node: number; y: number; note?: string }
  | {
      op: 'setStructure';
      edge: string;
      /** m along the edge. */
      from: number;
      to: number;
      kind: 'bridge' | 'tunnel' | 'ground';
      note?: string;
    };

/** Region packs: which templates a map's OSM classes get (`templates.ts`). */
export type PackId = 'nyc' | 'mk-rural';

export interface NetworkDef {
  data: NetworkData;
  patches?: NetworkPatch[];
  pack: PackId;
  /**
   * Retaining wall look per stretch of the stage road (m along; the opposite carriageway by its stage station): the
   * wall material and what stands on top, over the template's `daylight` (drive videos: board-formed concrete in some
   * cuts, chain-link on top in the stone cuts).
   */
  wallStyles?: {
    from: number;
    to: number;
    wall?: 'stone' | 'concrete';
    fence?: 'railing' | 'chainlink' | 'none';
    /** A cut wall there stands at most this high over the road (m): the land above it is a bank. */
    maxHeight?: number;
    /** The outer barrier of that stretch (both carriageways) in place of the template's ('none': an open verge). */
    barrier?: 'jersey' | 'guard_rail' | 'none';
    /** The face and parapets of the carriageways' own decks in that stretch, over the template's `deck`. */
    deck?: 'stone' | 'concrete';
  }[];
  /**
   * Stretches of the stage road (m along) where a chain-link fence stands on the median barrier (drive videos: opposite
   * lane 1:05-1:20, west of the Queens Blvd tunnel).
   */
  medianFences?: { from: number; to: number }[];
  /**
   * Fences on the ground beside the stage road's outer (right) side, by stage station (drive videos): `chainlink` =
   * galvanised mesh behind the rail, `green` = a tall dark green mesh, `slatted` = dark teal privacy slats in a mesh on a
   * low concrete wall (the cemeteries). `offset` = from the pavement edge (m, default 2.2); none where the ground there
   * stands more than 2 m off the road or another road's foot reaches it.
   */
  roadFences?: {
    from: number;
    to: number;
    look: 'chainlink' | 'green' | 'slatted';
    offset?: number;
    height?: number;
  }[];
  /** Stretches of the stage road (m along) whose lane line is double solid white whatever the curve (`solidLaneRadius`). */
  solidLanes?: { from: number; to: number }[];
  /** The gores of the ramps leaving / joining the stage road hatched in white (paint between their edge lines). */
  goreHatch?: boolean;
  /** Groups of white bars across the stage road's lanes (m along: the first bar of each group; 5 bars, 4 m apart). */
  laneBars?: number[];
  /**
   * Pavement per stretch of the stage road (m along; both carriageways and the highway ramps there by stage station):
   * 'concrete' = pale cement-concrete slabs with sealed joints (drive videos: from the Queens Blvd tunnel portal on).
   */
  pavement?: { from: number; to: number; surface: 'concrete' }[];
  /**
   * Stretches of the stage road (m along) where an unrelated road beside its carriageways at their level is open to
   * them - a barrier between, no dividing wall (`Network.dividingWalls`; the lidar sees none there).
   */
  openBeside?: { from: number; to: number }[];
  /**
   * One tunnel's soffit per stretch of the stage road (m along; every bore there by its nearest stage station): the depth
   * of its ceiling girders (m), so the clearance under them is the one on its plates, and its headwalls. Elsewhere the
   * template's (TUNNEL_GIRDER_DEFAULT).
   */
  tunnels?: {
    from: number;
    to: number;
    girder: number;
    /** One straight headwall across all its bores at each end, on the stage road's portal line, in this material. */
    headwall?: 'stone' | 'concrete';
    /** Share of the sky light its roof takes off (default TUNNEL_SHADE): less in a hall lit from its open sides. */
    shade?: number;
  }[];
  /**
   * One street deck's look by its OSM way id, over the template's `deck` (drive videos): 'steel' = a painted plate-girder
   * bridge, steel girders under a slab, stone abutments ('concrete': `abutment`).
   */
  deckStyles?: {
    way: string;
    facing?: 'steel';
    abutment?: 'stone' | 'concrete';
    /**
     * The structure's edges, left / right of the way's line (m, USGS lidar): wider than the street there, a sidewalk on
     * the deck out to the parapet (a deck is never narrower than its street).
     */
    edges?: [number, number];
  }[];
  /**
   * Junction plazas from a survey (v1's `junction.json` / `junction-cores.json`, scripts/realmap/plaza_islands.py): one
   * paved surface over the area (NetField `plazaHeight`), its islands raised; the streets end on its rim, the ones inside
   * and their junctions are left out; the roads in the trench below (and their open cut) stay.
   */
  plazas?: {
    area: number[];
    islands?: { kind: string; pts: number[] }[];
    /** OSM zebra crossings over it (x, z polylines): NYC ladder bars painted across each, inside the area. */
    crosswalks?: number[][];
  }[];
  /**
   * City street space beside the stage road (scripts/realmap/street_space.py, NYC planimetric roadbed / sidewalk /
   * median): paved under every road, sidewalk and junction (NetField `underDrawn`), so no land shows between the street
   * ribbons where the survey has street; the raised medians stand a kerb high on it. Pieces: an outline and its holes.
   */
  streetSpace?: {
    road?: { area: number[]; holes?: number[][] }[];
    walk?: { area: number[]; holes?: number[][] }[];
    medians?: number[][];
  };
  /**
   * Small city parks (scripts/realmap/park_block.py): footpaths (x, z polylines, `pathWidth` m wide) paved on the
   * drawn land and fountains (a stone basin of radius `r`, a tiered centrepiece). The lawn is the map's landcover paint.
   */
  parks?: NetPark[];
  /**
   * Protected bike lanes (scripts/realmap/nyc_lanes.py, NYC DOT): [side, x0, z0, x1, z1, ...] on a street's centreline,
   * side 1 = the lane on the line's right, -1 = its left. Painted green on the roadway beside the line (v2/mesh.ts).
   */
  bikeLanes?: number[][];
  /** Painted medians (NYC planimetric 360010 outlines, x, z): a yellow outline + hatch on the paving under each. */
  paintedMedians?: number[][];
  /** Red bus lanes: [x0, z0, x1, z1, width] lane centrelines (m), painted on the paving under them. */
  busLanes?: number[][];
  /**
   * Bridges as one-off structures (NYC: every crossing is its own), by the OSM ids of the ways passing beneath: each
   * road crossing over one of them gets a deck `length` m long (along itself, centred on the crossing) in place of the
   * fitted one - room for the cut walls of the road below to end at the abutments (v1 `lengthenBridges`); one span
   * from abutment to abutment (no piers).
   */
  decks?: {
    under: string[];
    length: number;
    /** One structure under both carriageways: the median between the stage road's deck and the other one's is decked. */
    median?: boolean;
    /** Parapet type (default: the template's deck stone / concrete): 'jersey' = a concrete Jersey-shape parapet, the
     * roadside barrier carried over the deck. */
    parapet?: 'jersey';
    note?: string;
  }[];
}
