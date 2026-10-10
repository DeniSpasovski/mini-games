import type { GearingId } from '../../physics/types';
import type { SurfaceId } from '../../physics/surfaces';
import type { TyreId } from '../../physics/tyres';

/**
 * Map format. A map is pure data: the world (heightfield, road, scatter) is
 * generated deterministically from it, so editing a map = editing this object.
 * See .claude/skills/rally-maps/SKILL.md for the editing workflow.
 *
 * World axes: +X east, +Z SOUTH (north = -Z), +Y up. Units: metres.
 * (three.js is right-handed: with +Z north a real-world map would be mirrored.)
 */
/** An external resource used by a map or car: data set, model, reference. */
export interface SourceLink {
  label: string;
  url?: string;
  /** What it was used for / licence. */
  note?: string;
}

export interface PlazaIsland {
  kind: 'island' | 'painted' | 'sidewalk';
  pts: number[];
}

export interface MapDef {
  id: string;
  name: string;
  /** Edition year printed in the start / finish gantry header next to the map name. */
  year: number;
  description: string;
  /** Recommended tyre for the stage's surfaces: pre-selected on the car screen, the player may pick another. */
  tyre: TyreId;
  /**
   * Recommended gearing (physics/gearing.ts) for cars that can change it - e.g. `long` on a fast stage. Missing =
   * `medium`. Pre-selected on the setup screen like the tyre.
   */
  gearing?: GearingId;
  seed: number;
  /** Area that is rendered / streamed. Terrain outside rises to form a horizon. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * Stage-select view (baked stage card, tools/stage-card.ts): vertical exaggeration of the card's relief, e.g. 1.8
   * for a flat city map so its terrain still reads from the air. Default 1. Changing it needs no re-bake.
   */
  previewRelief?: number;
  terrain: TerrainDef;
  /** Far land around a real map (terrain + land cover, no roads / buildings), drawn as a backdrop: world/horizon.ts. */
  horizon?: HorizonDef;
  road: RoadDef;
  stage: StageDef;
  /** Procedural vegetation / rocks per terrain chunk. */
  scatter: ScatterRule[];
  /** Props placed along the road (posts, signs, bales, crowds...). */
  roadside: RoadsideRule[];
  /** Fan groups (tape, spectators, flags) on the inside of tight corners along the whole stage: world/corner-fans.ts. */
  cornerFans?: CornerFansRule;
  /** Continuous barriers along the road (Jersey wall, guard rail): one swept mesh, not separate props. */
  barriers?: BarrierRule[];
  /** City dressing (parked cars, spectators, police / fire vehicles) placed from the road network: world/street-dressing.ts. */
  streetDressing?: StreetDressing;
  /** Power line supports [x, z] and line polylines (flat x, z lists), baked from OSM: towers / poles + cables (world/power-lines.ts). */
  pylons?: [number, number][];
  powerLines?: number[][];
  /**
   * Railway tracks baked from OSM (`railway=rail`): a ballast bed carved into the terrain, sleepers + rails, and
   * catenary masts / wires on the electrified ones (world/railways.ts). Road decks crossing them clear the wires.
   */
  railways?: RailwayDef[];
  /** City streets: city asphalt on the other roads (centre lines on the wide ones), kerbs, sidewalks, crosswalks and lamps near the stage road (world/street-detail-mesh.ts). */
  cityStreets?: CityStreets;
  /** Barriers along the OTHER carriageways (paths of the given OSM kinds): the same wall / rail as the stage road. */
  pathBarriers?: PathBarrierRule;
  /**
   * Roads that run in the divided highway's cut beside its carriageways, parallel to the stage road (OSM maps them
   * as ordinary streets: the sunken inner Union Turnpike lanes beside the Jackie). They are treated as carriageways:
   * stage-road level, walls beyond them, path barriers, lane markings, no sidewalks. `reach` = max lateral distance
   * of the road's centre from the stage road (m).
   */
  parkwayLanes?: { kinds: string[]; names?: string[]; reach: number };
  /**
   * Look of the other roads' bridge decks (OSM bridge=yes, world/bridge-mesh.ts): `stone` (default) = old parkway
   * bridges - solid stone parapets with pilasters, a stone arch on street bridges, stone abutments; `concrete` =
   * modern overpass - concrete edge beam with an open steel railing, beam soffit, concrete abutments.
   */
  bridgeStyle?: 'stone' | 'concrete';
  /**
   * `concrete` decks only: follow the road's width taper at their ends (the railing turns a corner where the bridge
   * meets a wider / narrower way). Default false: the deck keeps one width, railings run parallel end to end.
   */
  bridgeCorners?: boolean;
  /** Overhead guide signs on steel gantries (highway maps): exit signs from the ramps + hand-placed boards (world/overhead-signs.ts). */
  overheadSigns?: OverheadSignDef;
  /**
   * Pave and hatch the strip between the stage road and a ramp (`*_link`) that leaves / joins it at a shallow angle
   * (the gore area of a highway exit). City maps with a divided highway.
   */
  goreAreas?: boolean;
  /** Gore wedges also where a ramp leaves / joins a `motorway` carriageway of the road network, on ramps east of this x (the Jackie interchange). */
  gorePathsFromX?: number;
  /**
   * Junction plazas: outlines (`[x0, z0, x1, z1, ...]`, world m) of big city intersections on top of a portal slab
   * (`RoadSpan` kind `under`). Inside one the junction is a single plain asphalt surface at the slab top: no street
   * ribbons / decks / parapets crossing each other (world/plazas.ts). Keep it off the open trench beyond the span.
   */
  junctionPlazas?: number[][];
  /**
   * Junction areas: outlines of the whole street space around a big junction (the slab top and ~40 m of each arm, from
   * open street-surface data). Plazas whose surface is a height field (slab top on the slab, street heights where the
   * streets leave, smooth between); they never cover the open cut of the highway (world/plazas.ts).
   */
  junctionAreas?: number[][];
  /**
   * Junction areas that keep the street ribbons (the road texture with its painted lines) over their paving: no generated
   * lane markings there, the streets look like the ones leading to them. Same form as `junctionAreas`.
   */
  ribbonAreas?: number[][];
  /**
   * Islands on the junction plazas (world polygons `[x0, z0, x1, z1, ...]`): `island` = a raised kerbed traffic island /
   * median, `sidewalk` = a raised paved strip, `painted` = a flat painted median (world/plazas.ts, plaza-mesh.ts).
   */
  plazaIslands?: PlazaIsland[];
  /**
   * Zebra crosswalks on and around the junction plazas (centre lines along the pedestrian path, `[x0, z0, x1, z1, ...]`,
   * world m). When set, the plazas get no automatic crosswalk per street mouth (street-detail.ts).
   */
  plazaCrosswalks?: number[][];
  /** Traffic signal poles on the junction areas (`[x0, z0, x1, z1, ...]`, world m): the mast arm turns over the nearest street. */
  plazaSignals?: number[];
  /** Street trees on the junction areas' sidewalks (`[x, z, trunk diameter in inches, ...]`, world m). */
  plazaTrees?: number[];
  /** Street trees of a city map: flat [x, z, trunk diameter (inch), ...] (NYC Street Tree Census), placed off roads / buildings / plazas. */
  streetTrees?: number[];
  /** Hand-placed props. */
  props: PropPlacement[];
  /**
   * Real-world maps: where another road / track meets the stage road (the baked side roads
   * are extended up to it), close its mouth with a row of barriers across the side road.
   */
  junctionBarriers?: {
    asset: string;
    /** Length of one barrier (m); a row of ceil(width / length) is placed. */
    length: number;
    /** Distance from the stage road edge to the barrier row (m), default 4. */
    setback?: number;
    /** Skip side roads narrower than this (footpaths), default 2.5 m. */
    minWidth?: number;
  };
  environment: EnvironmentDef;
  /** Data attributions shown in the pause menu and map viewer (required for OSM / CC BY data). */
  credits?: string[];
  /** External resources used (links shown on the main menu About screen); keep in sync with the map DETAILS.md. */
  sources?: SourceLink[];
  /** Real-world maps: projection origin (WGS84) of world (0, 0). Shown in the map viewer. */
  geo?: { lat: number; lon: number };
  /** Land cover raster (real-world maps). Scatter rules can be limited to covers (`ScatterRule.cover`). */
  landcover?: LandcoverDef;
  /** Other roads, tracks and canals (not the stage road): ribbons, splat paint, canal carving. */
  paths?: PathDef[];
  /**
   * Surveyed heights on the streets [x, z, y] (world m, y after the heightmap offset): each ground street's profile is
   * corrected to the ones on its carriageway before it is smoothed (spots standing above the land, on decks, are not used).
   */
  streetHeights?: [number, number, number][];
  /**
   * Surveyed retaining walls (polylines `[x0, z0, x1, z1, ...]`, world m): the terrain steps at each line - the land
   * held at its top on the high side, at its foot on the other - and a wall stands on it (world/retaining-walls.ts).
   */
  retainingWalls?: number[][];
  /**
   * Measured bridge structures: a survey outline (`[x0, z0, x1, z1, ...]`, world m) and the spot elevations on it ([x, z, y],
   * y after the heightmap offset). Every deck inside lies on the plane through those spots - one surface for the street
   * and its ramps (`maps/shared/deck-fit.ts` `decksInOutline` turns the streets inside into decks).
   */
  deckStructures?: { outline: number[]; heights: [number, number, number][] }[];
  /** Lakes / ponds / reservoirs (OSM natural=water): carved basin + flat water surface. */
  lakes?: LakeDef[];
  /** Placeholder buildings from real footprints (house_pitched / building_flat assets). */
  buildings?: BuildingDef[];
  /** Stage number used in building references: "stage <n> - building <id> - lat, lon". */
  stageNumber?: number;
  /**
   * Hand-modelled landmark groups (ids in `world/landmarks.ts`): lots with detailed buildings, yards,
   * fences and parked vehicles that replace the placeholder buildings under them.
   */
  landmarks?: string[];
}

/**
 * The light part of a `MapDef`, always loaded: what the menus, stage select and URL defaults need. The full `MapDef`
 * (baked terrain, buildings, roads) is loaded on demand by `loadMap` (maps/index.ts), so every extra map costs
 * nothing until it is picked.
 */
export type MapInfo = Pick<
  MapDef,
  | 'id'
  | 'name'
  | 'year'
  | 'description'
  | 'tyre'
  | 'gearing'
  | 'seed'
  | 'bounds'
  | 'previewRelief'
  | 'stage'
  | 'environment'
  | 'credits'
  | 'sources'
  | 'geo'
  | 'stageNumber'
> & {
  /** Stage road control points [x, z] (menu route outline and length). */
  route: number[][];
  /** Surfaces along the road, in order (menu tags): `RoadDef.surface` then each `sections[].surface`. */
  surfaces: SurfaceId[];
};

/**
 * A graded pad (a lot / yard): the terrain is levelled inside `polygon` and blends back to the land
 * over `blend` m. The level follows the stage road's height at the frontage points (piecewise linear
 * along the street) and is level across it, so a lot sits flush with the sidewalk in front of it.
 */
export interface PadDef {
  name?: string;
  /** Closed outline, flat [x0, z0, x1, z1, ...] (the first point is not repeated). */
  polygon: number[];
  /** Max blend distance back to the land (m); steeper cuts / fills get less. */
  blend: number;
  /** Frontage points next to the stage road, flat [x0, z0, x1, z1, ...] (at least two, west to east). */
  frontage: number[];
  /** Metres above the road's centre line at the frontage (sidewalk height), default 0.1. */
  lift?: number;
}

/** A building placed from a real footprint (oriented rectangle). */
export interface BuildingDef {
  /** Stable number (ordered along the route when first baked): "stage 1 - building 12 - lat, lon". */
  id: number;
  /** Footprint centre (m). */
  x: number;
  z: number;
  /** Long side (m). */
  w: number;
  /** Short side (m). */
  d: number;
  /** Direction of the long side in the x-z plane (rad, from +X towards +Z). */
  angle: number;
  /** Wall height (m) - eaves for sloped roofs. */
  h: number;
  floors: number;
  type: 'house' | 'flat';
  /** Footprint source, e.g. osm / ms (Microsoft ML footprints). */
  source: string;
  /** Distance along the stage road of the nearest road point (m). */
  along: number;
  /**
   * Mesh buildings (real-world maps with OSM heights): building class. When set the building is drawn by
   * world/building-mesh.ts (extruded footprint, facade texture, roof) instead of a box instance.
   */
  kind?:
    | 'house'
    | 'row'
    | 'apartment'
    | 'commercial'
    | 'industrial'
    | 'garage'
    | 'church'
    | 'tomb';
  roof?: 'flat' | 'gable';
  /** Real footprint outline, flat [dx, dz, ...] relative to (x, z) in world axes (absent = the box w x d). */
  poly?: number[];
}

/** int16 height grid, row-major from (originX, originZ), +X per column, +Z per row. */
export interface HeightGridDef {
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** base64 little-endian int16; height = base + value * step. */
  data: string;
}

/**
 * Real elevation. Grids are listed fine -> coarse; the first grid containing a
 * point wins (blended near its edge). Noise layers are added on top as detail.
 */
/** `scripts/realmap/horizon.py` output (the map folder's horizon.json). */
export interface HorizonDef {
  grids: {
    originX: number;
    originZ: number;
    cell: number;
    cols: number;
    rows: number;
    /** Absolute metres = base + value * step (int16 LE, base64); the map's heightmap offset is subtracted. */
    base: number;
    step: number;
    heights: string;
    /** Per cell 4 x 4 bit shares (uint16 LE, base64): trees, crops, built / bare, water; grass = the rest. */
    cover: string;
  }[];
}

export interface HeightmapDef {
  base: number;
  step: number;
  grids: HeightGridDef[];
  /** Subtracted from all heights so the playable area sits near y = 0. */
  offset?: number;
}

export interface LandcoverZone {
  /** Cover class name (e.g. grass, crop, orchard, pine, urban). */
  cover: string;
  /** Row direction (rad, from +X towards +Z) for `rows` scatter (orchards). */
  angle?: number;
}

export interface LandcoverDef {
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** base64 run-length encoded zone ids: (zone byte, LEB128 run length)*. */
  rle: string;
  zones: LandcoverZone[];
  /** Base splat weights [grass, dirt, rock, gravel] per cover class. */
  splat: Record<string, [number, number, number, number]>;
  /**
   * Covers drawn as a procedural patchwork of field parcels (strips along `angle`),
   * each parcel picking one of `palette` (splat weights). Weight an entry leaves unused
   * (sum < 1) is ripe crop: [0, 0, 0, 0] = a wheat field (drives like grass).
   */
  fields?: {
    covers: string[];
    angle: number;
    width: [number, number];
    length: [number, number];
    palette: [number, number, number, number][];
  };
}

/** Standing water: closed polygon (world x/z, not repeating the first point). */
export interface LakeDef {
  /** OSM water=* (lake, pond, reservoir, basin, ...). */
  kind: string;
  name?: string;
  /** Area (m²). */
  area?: number;
  /** Water surface (m above sea level, from the DEM inside the outline); default: the median shore height. */
  level?: number;
  /** Flat [x0, z0, x1, z1, ...]. */
  pts: number[];
}

export interface PathDef {
  kind: string;
  width: number;
  /** tarmac -> ribbon mesh + tarmac physics, dirt -> splat paint, water -> carved channel. */
  surface: 'tarmac' | 'dirt' | 'water';
  /** Flat [x0, z0, x1, z1, ...]. */
  pts: number[];
  /** false = passes over / under the stage road (bridge, not connected): never joined to it or barriered. */
  /** A road in the divided highway's cut beside its carriageways (set by world/parkway-lanes.ts, MapDef.parkwayLanes). */
  parkwayLane?: boolean;
  junction?: boolean;
  /** OSM bridge=yes: an elevated deck (not carved into the terrain, drawn as a bridge mesh). */
  bridge?: boolean;
  /** OSM layer (1 = over the ground level roads, 2 = over layer 1...). Decks are lifted to clear lower layers. */
  layer?: number;
  oneway?: boolean;
  lanes?: number;
  /** Road name (motorways / main roads). */
  name?: string;
  /**
   * Street model of a city map (`scripts/realmap/streets.py`, Jackie END BOX): measured from the NYC planimetric roadbed +
   * centreline data. `lanes` stays the baked value; `width` = `curbWidth` for streets and ramps.
   */
  /** Curb to curb width (m) measured from the roadbed outline (else the centreline data's street width). */
  curbWidth?: number;
  /** Travel lanes with (`fwd`) / against (`back`) the path direction, parking / bike lanes left / right of it, shoulder m per side. */
  layout?: {
    fwd: number;
    back: number;
    parkL: number;
    parkR: number;
    bikeL: number;
    bikeR: number;
    shoulder: number;
  };
  /** Sidewalk width left / right of the path direction (m, 0 = none). */
  sidewalk?: [number, number];
  /** Tree lawn (grass strip) between the kerb and the sidewalk, left / right (m; absent = none). */
  lawn?: [number, number];
  /** Pavement material (OSM `surface`). */
  pave?: 'asphalt' | 'concrete';
  /** Paint: centre line, stop bar at the start / end of the path, `turn:lanes` strings (forward / backward). */
  marks?: {
    centre: 'double_yellow' | 'none';
    stop: [number, number];
    turn?: string;
    turnBack?: string;
  };
  /** Posted speed (mph). */
  speed?: number;
}

/** One railway track (one OSM way: a single track). */
export interface RailwayDef {
  /** Centre line, flat [x0, z0, x1, z1, ...]. */
  pts: number[];
  /** Overhead contact line (OSM electrified): catenary masts + wires. */
  electrified?: boolean;
  /** OSM service (siding / spur / yard); absent = a running line. */
  service?: string;
}

/** One green board of an overhead sign (generic text: road names, no shields / logos). */
export interface SignBoardDef {
  /** Small tab above the board ("EXIT 7"). */
  tab?: string;
  lines: string[];
  /** Smaller last line ("1/4 MILE"). */
  small?: string;
  arrow?: 'down' | 'right' | 'left';
}

export interface OverheadSignDef {
  /** "EXIT n" + the street name for every one-way ramp leaving the stage road (130 m ahead of the gore). */
  exits?: boolean;
  /** Number of the first exit (default 1). */
  firstExit?: number;
  /**
   * Guide signs at the splits of the other carriageways / ramps (an interchange beyond the stage road): a portal gantry
   * `ahead` m (default 110) before every split east of `minX`, one board per direction naming the motorway it leads to.
   */
  splits?: { minX?: number; ahead?: number };
  /** Hand-placed gantries: distance along, boards left to right, cantilever (right side) or portal (both sides, default). */
  signs?: {
    along: number;
    boards: SignBoardDef[];
    span?: 'cantilever' | 'portal';
  }[];
}

/** See `RoadDef.trenchFills`. */
export interface TrenchFill {
  from: number;
  to: number;
  halfWidth: number;
  depth: [number, number];
}

/** A stretch of the stage road on a bridge (over a street / rail) or under a structure, by distance along (m). */
export interface RoadSpan {
  kind: 'bridge' | 'under';
  from: number;
  to: number;
  layer?: number;
  /**
   * `under` only: skewed slab ends following the street on top - metres along the road per metre lateral (+ = left) of
   * the headwall line at the start / end. The slab is only shortened: the end line passes through the corner it keeps.
   */
  skew?: [number, number];
  /** `bridge` only: deck surface above the street beneath (m), instead of `RoadDef.bridgeClearance`. */
  clearance?: number;
  /**
   * `bridge` only: length of the fill ramp from each abutment down to the lowered ground (m; default 14, at most 30 %
   * of the span). Short where the real abutment is a wall standing right behind the street's sidewalk.
   */
  ramp?: number;
  /**
   * `bridge` only: the ground under the whole deck is lowered to clear it (a wide street, its medians and ramps
   * beneath), not only beside the streets that pass under.
   */
  open?: boolean;
}

export interface NoiseLayer {
  /** Feature size (m). */
  scale: number;
  /** Height amplitude (m). */
  amplitude: number;
  octaves: number;
  /** Ridged noise (sharp crests) instead of smooth fbm. */
  ridged?: boolean;
}

export interface FlatArea {
  x: number;
  z: number;
  radius: number;
  /** Blend distance outside the radius (m). */
  blend: number;
  /** Optional fixed height; default = terrain height at the centre. */
  height?: number;
  /** Surface inside the radius (physics + texture), default grass. */
  surface?: SurfaceId;
  /** Name shown in the map viewer / used by `?spawn=<name>`. */
  name?: string;
  /** false: no map viewer label (a levelled spot under a landmark, still spawnable by name). */
  label?: boolean;
}

export interface TerrainDef {
  baseHeight: number;
  /** Real elevation data; `layers` then add small-scale detail on top. */
  heightmap?: HeightmapDef;
  layers: NoiseLayer[];
  /** Metres the terrain rises per 100 m outside `bounds` (horizon hills). */
  edgeRise: number;
  /** Slope (1 - normal.y) range where bare rock replaces the ground cover: [start, full]. Default [0.22, 0.38]. */
  rockSlope?: [number, number];
  flatAreas: FlatArea[];
  /** Graded lots / yards (real-world maps with landmarks), applied after the flat areas. */
  pads?: PadDef[];
  /**
   * Built-up land cover read lot by lot (city maps): paved round each building (walks, patios, driveways), green in the
   * yards a few metres out (TerrainGenerator.yardSplat, from the building footprints).
   */
  lotYards?: boolean;
}

/**
 * Road control point. [x, z] or an object with per-point overrides.
 * The road is a centripetal Catmull-Rom spline through these points.
 */
export type RoadPoint =
  | [number, number]
  | {
      x: number;
      z: number;
      /** Height offset added on top of the smoothed terrain-following height (crests, dips, jumps). */
      dy?: number;
      /** Road width override at this point. */
      width?: number;
    };

export type RoadTexture =
  | 'road'
  | 'road_tarmac'
  | 'road_parkway'
  | 'road_street'
  | 'road_street4'
  | 'road_city'
  | 'asphalt_street'
  | 'asphalt_highway';

export interface RoadDef {
  points: RoadPoint[];
  /** Default road width (m). */
  width: number;
  /** Loose gravel verge each side (m). */
  shoulder: number;
  /** Ditch depth just outside the verge (m). */
  ditch: number;
  /** Centre crown height (m). */
  crown: number;
  /** Window (m) used to smooth the terrain-following road height. */
  smoothing: number;
  /** Max longitudinal grade (0.12 = 12%). The terrain is cut / filled to match. Jumps (dy) are added after. */
  maxGrade?: number;
  /** Window (m) that rounds the grade changes `maxGrade` leaves (default 12). Longer = gentler crests at speed. */
  gradeSmoothing?: number;
  surface: SurfaceId;
  /** Road texture: 'road' (gravel, default), 'road_tarmac' (worn asphalt with loose gravel) or 'road_parkway' (clean asphalt, painted lane lines). */
  texture?: RoadTexture;
  /**
   * Real-world maps: stretches on bridges (`kind: 'bridge'`, baked from OSM bridge=yes) - the road is a deck
   * over lowered ground (a street runs beneath), no embankment, parapets - and `'under'` stretches (under a
   * structure: nothing is changed, informational / used for props).
   */
  spans?: RoadSpan[];
  /**
   * Surveyed road-surface heights [x, z, y] (world m, y after the heightmap offset) where the elevation model misses
   * the road (a bare-earth DEM drops bridge decks): the terrain-following height is corrected to them before the
   * smoothing - interpolated between points up to 200 m apart, faded out over 60 m past a lone one. Points off the
   * carriageway are ignored.
   */
  heights?: [number, number, number][];
  /** Height of a bridge deck's surface above the street beneath it (m, default 7.5). */
  bridgeClearance?: number;
  /**
   * Cuts deeper than `minHeight` (m: the land beside the road is that much higher than the road) become sheer:
   * the road stays level out to `offset` m beyond the verge, then a stone retaining wall (cut-wall-mesh.ts) holds
   * the land back. Shallower cuts keep the gentle embankment.
   */
  cutWalls?: {
    minHeight: number;
    offset: number;
    /**
     * From this distance along the stage road on, the walls are plain concrete with a chain-link fence on top (the
     * newer stretch of a parkway) instead of coursed stone with a picket railing.
     */
    concreteFrom?: number;
  };
  /**
   * Where the elevation data has a void beside a sunken stretch (lidar under a wide structure reads the trench
   * floor or lower everywhere): the land within `halfWidth` m of the road between `from` and `to` m along is raised
   * (never lowered) to the road height + `depth` (linear from `depth[0]` at `from` to `depth[1]` at `to`), fading
   * out 25 m beyond - the street grid at the rim of the trench. The cut walls then hold the trench open.
   */
  trenchFills?: TrenchFill[];
  /**
   * Surface changes along the stage (e.g. asphalt valley road turning to gravel on the climb): each
   * entry applies from `from` metres along the road until the next one. `surface` / `texture` above
   * are used before the first entry.
   */
  sections?: {
    from: number;
    surface: SurfaceId;
    texture?: RoadTexture;
  }[];
}

/** Road surface / texture at a distance along the stage road (see RoadDef.sections). */
export function roadSurfaceAt(
  road: RoadDef,
  along: number,
): { surface: SurfaceId; texture: RoadTexture } {
  let surface = road.surface;
  let texture = road.texture ?? 'road';
  for (const s of road.sections ?? []) {
    if (along < s.from) break;
    surface = s.surface;
    texture = s.texture ?? texture;
  }
  return { surface, texture };
}

export interface StageDef {
  /** Distance along the road of the start line (m). */
  start: number;
  /** Distance before the road end of the finish line (m). */
  finishFromEnd: number;
  /** Number of split times between start and finish. */
  splits: number;
}

export interface ScatterRule {
  asset: string;
  /** Instances per 1000 m² before masking. */
  density: number;
  /** Detail layer: dense small things only generated close to the camera. */
  detail?: boolean;
  /** Min / max distance from the road EDGE (m). */
  minRoadDist?: number;
  maxRoadDist?: number;
  /** Max terrain slope (1 - normal.y), e.g. 0.3. */
  maxSlope?: number;
  /** Clustered placement: keep where noise(x/scale) > threshold (-1..1). */
  mask?: { scale: number; threshold: number; invert?: boolean };
  scale: [number, number];
  /** Random tilt (deg). */
  tilt?: number;
  /** Align to terrain normal (rocks) instead of upright (trees). */
  alignToGround?: boolean;
  /** Sink into the ground (m), hides bases on slopes. */
  sink?: number;
  /** Only on these land cover classes (maps with `landcover`). */
  cover?: string[];
  /** Planted rows (orchards): lattice aligned to the zone's `angle`; `density` is ignored. */
  rows?: {
    spacing: number;
    rowSpacing: number;
    jitter?: number;
    keep?: number;
  };
  /** Keep away from `paths` (other roads / canals) edges (m). Default 1.5 for solid assets, 0.4 otherwise. */
  minPathDist?: number;
  /** Only this far from the EDGE of a canal / drain / river [min, max] (m, max <= 10): willows, reeds. */
  channelDist?: [number, number];
}

/** A continuous roadside barrier (world/barriers.ts + barrier-mesh.ts). */
export interface BarrierRule {
  kind: 'jersey' | 'guardrail';
  side: 'left' | 'right' | 'both';
  /** Distance from the road edge to the barrier centre line (m). */
  offset: number;
  /** Only between these distances along the road (m). */
  from?: number;
  to?: number;
  /** true = only on stage-road bridge spans, false = only off them. */
  onBridge?: boolean;
  /** Break the barrier where a side road / ramp joins on the same side, within this distance along (m, + half its width). */
  skipJunctions?: number;
}

/** Street detail along the other roads near the stage road. */
export interface CityStreets {
  /** Streets within this distance of the stage road get kerbs, sidewalks, crosswalks and lamps (m). */
  reach: number;
  /** Sidewalk width (m). */
  sidewalk?: number;
  /** Lamp spacing along the streets (m, 0 = none). */
  lampEvery?: number;
}

/**
 * City dressing derived from the road network (`paths`, bridge decks, junctions), deterministic from the map seed.
 * Everything stays out of buildings and off other roads.
 */
export interface StreetDressing {
  /**
   * Marker posts and bend chevrons along the ramps (`*_link` paths) whose middle lies east of `fromX` (the Jackie
   * interchange): a post every `postEvery` m on the right-hand edge, a chevron board every `chevronEvery` m on the outside
   * of every bend tighter than `maxRadius` m.
   */
  rampMarkers?: {
    fromX: number;
    postEvery: number;
    chevronEvery: number;
    maxRadius: number;
  };
  /** Parked cars along the kerbs of streets near the stage road. */
  parked?: {
    /** OSM kinds of the streets. */
    kinds: string[];
    /** Only streets (points) within this distance of the stage road (m). */
    reach: number;
    /** Share of the parking slots that hold a car (0..1). */
    fill: number;
    /** Share of those cars that are taxis. */
    taxiShare?: number;
  };
  /** Crowds. */
  spectators?: {
    /** Spectators per overpass deck (both sides, around where it crosses the stage road). */
    perDeck?: number;
    /** Spectators behind each closed junction mouth. */
    perJunction?: number;
    /** Only decks / junctions within this distance of the stage road (m). */
    reach: number;
  };
  /**
   * Emergency vehicles at the closed junction mouths ("everyone is at the party"): a police car first, behind it
   * an ambulance and / or a fire truck (wide junctions), each with its own share (0..1).
   */
  emergency?: {
    /** Share of junctions with a police car behind the barrier. */
    police: number;
    /** Share of the wider junctions (>= 6 m) with a fire truck. */
    fire: number;
    /** Share of junctions (>= 5 m) with an ambulance. */
    ambulance?: number;
  };
}

/**
 * Barriers along divided-highway carriageways that are `paths` (the opposite carriageway of a parkway):
 * a Jersey wall on the median side (another carriageway / the stage road within reach), a guard rail on
 * the outer side, broken where another road joins (ramp mouths, merges) or lies under the barrier.
 */
export interface PathBarrierRule {
  /** OSM kinds, e.g. ['motorway']. */
  kinds: string[];
  /** Skip narrower paths (single-lane ramps, m). */
  minWidth?: number;
  /** Barrier on the side facing another carriageway. */
  median: { kind: 'jersey' | 'guardrail'; offset: number };
  /** Barrier on the other side. */
  outer: { kind: 'jersey' | 'guardrail'; offset: number };
  /** How far across the median another carriageway may be to count as the median side (m). */
  medianReach?: number;
  /**
   * More kinds that get the same barriers, only on paths whose middle lies east of `minX` (a later import, the Jackie
   * interchange: the ramps further west keep their approved look).
   */
  extra?: { kinds: string[]; minX: number; minWidth?: number };
}

export interface RoadsideRule {
  asset: string;
  /** Repeat spacing along the road (m). */
  every?: number;
  /** Only where the road turns tighter than this radius (m). */
  maxRadius?: number;
  /** Skip where the road turns tighter than this radius (m), e.g. solid lamps off hairpins. */
  minRadius?: number;
  /** Explicit positions along the road (m). */
  at?: number[];
  side: 'left' | 'right' | 'both' | 'outside' | 'inside';
  /** Distance from the road edge (m). */
  offset: number;
  /** Instances per placement (crowds, bale stacks). */
  count?: number;
  /** Spread of a group along the road (m). */
  spread?: number;
  /** Extra random lateral spread for groups (m). */
  depth?: number;
  /** Rotate to face the road (signs / spectators). */
  faceRoad?: boolean;
  scale?: [number, number];
  /** Skip this rule before/after these distances along the road. */
  from?: number;
  to?: number;
  /** Skip where a side road / ramp joins the stage road on the same side, within this distance along (m, + half its width). */
  skipJunctions?: number;
  /** true = only on stage-road bridge spans (RoadDef.spans), false = only off them. */
  onBridge?: boolean;
}

export interface CornerFansRule {
  /** Window length along the road (m, default 70): at most one group each, at the window's tightest point. */
  every?: number;
  /** Only corners tighter than this radius (m, default 60). */
  maxRadius?: number;
  /** Share of the windows that get a group if they hold a corner (0..1, default 0.5). */
  chance?: number;
  /** Spectators per group [min, max] (default [3, 8]). */
  fans?: [number, number];
  /** Share of the groups with 1-3 flags (default 0.6). */
  flagChance?: number;
  /** Tape line distance from the road edge (m, default 3.5); the fans stand 1.5-5.5 m behind it. */
  tapeOffset?: number;
  /** Stretch of road with groups (m along; default 150 m after the start to 150 m before the end). */
  from?: number;
  to?: number;
}

export interface PropPlacement {
  asset: string;
  /** Either world x/z ... */
  x?: number;
  z?: number;
  /** ... or a distance along the road + lateral offset (+ = left). */
  along?: number;
  lateral?: number;
  /** Yaw (deg). For road-relative props, relative to road direction. */
  rotY?: number;
  scale?: number;
  /** Optional variant/seed. */
  variant?: number;
}

export interface EnvironmentDef {
  /** Sun angles (deg; azimuth from +Z = south towards +X = east). Used when `timeOfDay` is not set. */
  sunElevation: number;
  sunAzimuth: number;
  /**
   * Time of day in hours (6 = sunrise in the east, 12 = noon in the south, 18 = sunset in the west): sets the sun
   * angles (`engine/environment.ts` `sunAt`) and, through them, its colour. Try others with `?tod=<hours>`.
   */
  timeOfDay?: number;
  /**
   * Air temperature (°C, default 20): with the sun height and clouds it sets the track temperature and how the tyres
   * warm up (physics/tyre-temp.ts, `stageClimate`). Try others with `?air=<°C>`.
   */
  airTemp?: number;
  /** Override the sun colour / intensity (default: warmer and dimmer the lower the sun). */
  sunColor?: string;
  sunIntensity?: number;
  /** Hemisphere fill: sky colour (cool, the shadows) and intensity; its ground colour is a warm bounce of `groundTint`. */
  fillSky?: string;
  fillIntensity?: number;
  /** Image-based light from the sky + ground env map (default 0.3). */
  envIntensity?: number;
  /** Tone mapping (default 'aces'); `?tonemap=aces|agx|neutral` overrides it for comparisons. */
  toneMapping?: 'aces' | 'agx' | 'neutral';
  /** Sky clouds: coverage / density 0..1 (default 0.4 / 0.4) and drift speed multiplier (default 1). */
  cloudCoverage?: number;
  cloudDensity?: number;
  cloudSpeed?: number;
  /** How dark the drifting cloud shadows on the ground get, 0..1 (default 0.5, 0 = none). */
  cloudShadow?: number;
  /** How dark the baked far tree shadows on the ground get (world/canopy-shadows.ts), 0..1 (default 0.6). */
  canopyShadow?: number;
  /** Foliage wind sway multiplier (default 1, 0 = still). */
  wind?: number;
  /**
   * Fog thins with height above the camera (valleys hazier, hill tops clearer): falloff per metre (default 0.004,
   * 0 = flat `FogExp2`). `fogSunGlow` = how much the fog warms towards the sun (x sun colour, default 0.45).
   */
  fogFalloff?: number;
  fogSunGlow?: number;
  turbidity: number;
  rayleigh: number;
  fogColor: string;
  /** FogExp2 density. */
  fogDensity: number;
  exposure: number;
  /**
   * Recolour the terrain grass (keeps the texture's light/dark detail), e.g. golden dry
   * summer grass: { grass: '#c9b47a', amount: 0.85 }. `crop` = colour of ripe crop
   * parcels (see `LandcoverDef.fields.palette`), default wheat gold. `moisture` = strength of the wet / dry grass
   * variation (greener hollows and banks, straw ridges and slopes; world/ground-moisture.ts), default 1, 0 = off.
   */
  groundTint?: {
    grass: string;
    amount?: number;
    crop?: string;
    moisture?: number;
  };
}
