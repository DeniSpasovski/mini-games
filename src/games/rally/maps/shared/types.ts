import type { TimeOfDayId } from '../../game/time-of-day';
import type { GearingId } from '../../physics/types';
import type { SurfaceId } from '../../physics/surfaces';
import type { TyreId } from '../../physics/tyres';
import type { Season } from '../../season';

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

/** The scanned asphalt under the `road_tarmac` texture (Ajvatovci, Galichica, Petralica). */
export const ASPHALT_04_SOURCE: SourceLink = {
  label: 'Asphalt 04 (Poly Haven)',
  url: 'https://polyhaven.com/a/asphalt_04',
  note: 'road asphalt - by Sergej Majboroda and Jenelle van Heerden, CC0',
};

export interface PlazaIsland {
  kind: 'island' | 'painted' | 'sidewalk';
  pts: number[];
}

/**
 * A MAP is the world (terrain, roads, land cover, scatter, buildings, environment); the stages that run on it are
 * `stages` (StageDef: route direction, start / finish / splits, closures, event props, tyre). Players only see stages
 * (menus, times, URLs); the map viewer shows a map with one of its stages (a stage picker). The world never depends on
 * the stage.
 */
/** Countries a map can be in: their hand flags, and more later (spectator flags: world/fan-variants.ts). */
export type Country = 'mk' | 'us';

export interface MapDef {
  id: string;
  name: string;
  /** Where the map is: North Macedonia or the USA. Fans only wave this country's flag. */
  country: Country;
  /** The stages on this map (menu order). A stage id is never renamed once released: times are stored by it. */
  stages: StageDef[];
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
  /** Tall buildings far outside the baked area (a city's skyline), drawn with the backdrop: world/horizon.ts. */
  skyline?: SkylineBuilding[];
  road: RoadDef;
  /** Procedural vegetation / rocks per terrain chunk. */
  scatter: ScatterRule[];
  /**
   * Narrows the area the scatter (trees, bushes, rocks) is generated in, inside `bounds` (any side left out keeps the bounds'): for
   * land no camera can see - the far side of a ridge - where it only costs generation time, memory and canopy-shadow work.
   */
  scatterBounds?: Partial<MapDef['bounds']>;
  /**
   * Trees (not the drive-through bushes) stand at least `dist` m from the stage road's edge between `from` and `to` m along it (a verge of open ground: a road
   * through a suburb, a forest road with the trees set back), easing in and out over `fade` m (default 30) at the ends.
   */
  treeSetback?: { from: number; to: number; dist: number; fade?: number }[];
  /** Props placed along the road (posts, signs, bales, crowds...). */
  roadside: RoadsideRule[];
  /** Continuous barriers along the road (Jersey wall, guard rail): one swept mesh, not separate props. */
  barriers?: BarrierRule[];
  /** City dressing (parked cars, spectators, police / fire vehicles) placed from the road network: world/street-dressing.ts. */
  streetDressing?: StreetDressing;
  /** Power line supports [x, z] and line polylines (flat x, z lists), baked from OSM: towers / poles + cables (world/power-lines.ts). */
  pylons?: [number, number][];
  powerLines?: number[][];
  /** Cable cars (gondola lines): pylons, two ropes and static cabins between the stations (world/aerialway.ts). */
  aerialways?: AerialwayDef[];
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
  /**
   * Unpaved side roads (baked `dirt` paths: tracks, forest roads) are ribbon meshes with the gravel road texture, like
   * the paved ones - a road is an object, not only paint on the terrain (they are carved and splat-painted either way).
   */
  trackRibbons?: boolean;
  /**
   * Per OSM kind: smoothing window (m) and grade limit of the other roads' height lines, over the defaults
   * (`PATH_PROFILE` in world/terrain-gen.ts) - e.g. longer windows for tracks over lumpy karst.
   */
  pathProfiles?: Record<string, [number, number]>;
  /** Hand-placed props along the map's road (`along` on the road as drawn, whatever stage runs on it). */
  props: PropPlacement[];
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
  | 'stages'
  | 'seed'
  | 'bounds'
  | 'previewRelief'
  | 'environment'
  | 'credits'
  | 'sources'
  | 'geo'
  | 'stageNumber'
> & {
  /** The map road's control points [x, z] (menu route outline and length; a reverse stage reads them backwards). */
  route: number[][];
  /** Surfaces along the road, in order (menu tags): `RoadDef.surface` then each `sections[].surface`. */
  surfaces: SurfaceId[];
};

/**
 * What the menus know about a stage: the stage plus the bits of its map they show (maps/index.ts `stageInfo`).
 * `route` is the map road's outline in the stage's direction.
 */
export type StageInfo = StageDef &
  Pick<
    MapInfo,
    'bounds' | 'previewRelief' | 'environment' | 'credits' | 'geo' | 'surfaces'
  > & {
    /** Map id (the world this stage runs on). */
    map: string;
    mapName: string;
    route: number[][];
    /** The map's sources, then the stage's own. */
    sources: SourceLink[];
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
  /** Frontage points next to the stage road, flat [x0, z0, x1, z1, ...] (at least two, west to east). Not needed with `level`. */
  frontage?: number[];
  /**
   * The pad's own level instead of following the road along `frontage`: a number = a fixed level (m, before `lift`) for a lot
   * with no stage road beside it; `{ at, lift }` = a terrace (a house on a hillside), the land's height at `at` plus `lift`
   * (default 0.1).
   */
  level?: number | { at: [number, number]; lift?: number };
  /** Metres above the road's centre line at the frontage (sidewalk height), default 0.1. */
  lift?: number;
  /** Surface inside the outline (physics + ground texture), default the land's own. */
  surface?: SurfaceId;
  /**
   * A sloped pad (a ramp between two levelled terraces): instead of `lift` the level is the road's height at the frontage plus
   * `lift[0]` at `from`, `lift[1]` at `to` (world x, z), eased between them along that line and held beyond its ends.
   */
  ramp?: {
    from: [number, number];
    to: [number, number];
    lift: [number, number];
  };
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
  /** Far rivers (`scripts/realmap/rivers.py`): drawn as a flat ribbon on the backdrop, over the finest grid. */
  rivers?: {
    name: string;
    /** Flat [x, z, width, ...] (world metres), ordered along the river. */
    pts: number[];
  }[];
}

/** A big building on the skyline: an extruded footprint with a banded facade (one wall / glass band per floor). */
export interface SkylineBuilding {
  name?: string;
  /** Footprint, flat [x0, z0, x1, z1, ...] (world metres, either winding). */
  footprint: number[];
  /** Height above the lowest ground of the footprint (m). */
  height: number;
  /** Floors, for the facade bands (default: one per 3.2 m). */
  floors?: number;
  /** Colours: the wall band (spandrel), the glass band, the roof. */
  wall?: string;
  glass?: string;
  roof?: string;
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
    /**
     * The crop standing on a parcel per season, by palette entry (null / missing = nothing standing: meadow, ploughed,
     * stubble). Scatter rules with `crop` grow only there (world/terrain-gen.ts `cropAt`).
     */
    crops?: Partial<Record<Season, (string | null)[]>>;
  };
  /**
   * Hand-drawn parcels painted over the baked raster (cells whose centre is inside `poly`, world x, z pairs): land the
   * open data gets wrong (vineyards mapped as orchard or missing). Each becomes a zone of its own with `angle`.
   */
  paint?: { cover: string; angle?: number; poly: number[] }[];
}

/** Standing water: closed polygon (world x/z, not repeating the first point). */
export interface LakeDef {
  /** OSM water=* (lake, pond, reservoir, basin, ...). */
  kind: string;
  name?: string;
  /** Area (m²). */
  area?: number;
  /** Flat [x0, z0, x1, z1, ...]. */
  pts: number[];
  /**
   * Fixed water level (m above sea level, bake config `lakes.levels`), e.g. a big lake clipped at the map's edge. Missing:
   * the median land height along the shore.
   */
  level?: number;
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
  /**
   * This way ends inside another way (a lane merging into a road): its ribbon is sunk a few cm under the other ways' ribbons where
   * they overlap, so its end is covered by the road it joins instead of poking out of the road's edge.
   */
  joinsUnder?: boolean;
  /**
   * A way merging into another at a shallow angle: its width narrows to a point over this many metres towards its END, so it
   * runs into the other road's edge like a lane merge instead of ending in a square cut (`PathNetwork.halfWidthAt`).
   */
  mergeTaper?: number;
  /**
   * Set by world/junctions.ts `connectPaths`: this end widens to the stage road's width (`width`) over its last metres,
   * where the real road runs straight on and only the stage road turns (the straight road reads as the one that
   * continues), or where the way carries on from the stage road's start / finish.
   */
  widenEnd?: {
    atEnd: boolean;
    width: number;
    /** The real road running straight on where the stage road turns off: drawn over the stage road through the junction. */
    over?: boolean;
  };
  /** No kerbs / sidewalks / lamps / crosswalks on this street (a country road inside the city-street reach, MapDef.cityStreets). */
  bare?: boolean;
  junction?: boolean;
  /** OSM bridge=yes: an elevated deck (not carved into the terrain, drawn as a bridge mesh). */
  bridge?: boolean;
  /** OSM layer (1 = over the ground level roads, 2 = over layer 1...). Decks are lifted to clear lower layers. */
  layer?: number;
  oneway?: boolean;
  lanes?: number;
  /** Road name (motorways / main roads). */
  name?: string;
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
   * Lawns: closed polygons (flat [x0, z0, x1, z1, ...], world metres) where the terrain itself is painted lush green grass
   * (pure grass in the splat, wet in the grass moisture tint), with a metre of feather outside. For levelled gardens and
   * park strips: paint the ground instead of laying a green decal over a terrain that pokes through it.
   */
  lawns?: number[][];
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
  | 'road_tarmac_kerbed'
  /** Junction corners of `road_tarmac` side roads (laid in world space; not a stage road texture). */
  | 'road_tarmac_junction'
  | 'road_tarmac_plain_junction'
  | 'road_tarmac_lines'
  | 'road_tarmac_plain'
  /** Vodno's road along kerbed city streets (no edge grit). */
  | 'road_tarmac_plain_kerbed'
  | 'road_parkway'
  | 'road_street'
  | 'road_street4'
  | 'road_city';

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
   * Cuts deeper than `minHeight` (m: the land beside the road is that much higher than the road) become sheer:
   * the road stays level out to `offset` m beyond the verge, then a stone retaining wall (cut-wall-mesh.ts) holds
   * the land back. Shallower cuts keep the gentle embankment.
   */
  cutWalls?: {
    minHeight: number;
    offset: number;
    /** Only the stage road, between these distances along it (m); missing = the whole road and the highway carriageways. */
    range?: [number, number];
    /**
     * A real wall: the cut is held tighter (a narrow coping on top of the face, `cutShape` in world/terrain-gen.ts) and
     * the wall stops a car (colliders, world/cut-wall-colliders.ts).
     */
    solid?: boolean;
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
  /** Paint laid on the stage road over its texture: lane lines and arrows (world/road-markings.ts). */
  markings?: RoadMarking[];
}

/**
 * One piece of road paint. Across the road it sits `offset` m in from the road's `edge` (the left is the left of the
 * direction of travel), so it keeps its lane when the road widens; along it runs `from` to `to` (a line) or is
 * centred at `at` (an arrow), in metres along the stage road.
 */
export type RoadMarking =
  | {
      kind: 'line';
      from: number;
      to: number;
      edge: 'left' | 'right';
      offset: number;
      /** Paint width (m, default 0.12). */
      width?: number;
      /** [dash, gap] in metres; missing = a solid line. */
      dash?: [number, number];
    }
  | {
      kind: 'arrow';
      /** 'left' = the turn-left-only arrow, 'straight' = the ahead arrow. */
      arrow: 'left' | 'straight';
      at: number;
      edge: 'left' | 'right';
      offset: number;
    };

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

/** Start / finish / splits of a stage, measured along the stage road (its own direction, see StageDef.reverse). */
export interface StageTiming {
  /** Distance along the road of the start line (m). */
  start: number;
  /** Distance before the road end of the finish line (m). */
  finishFromEnd: number;
  /** Number of split times between start and finish. */
  splits: number;
}

/** Side-road mouths closed with a row of barriers across the side road (a rally stage is a closed road). */
export interface ClosureRule {
  asset: string;
  /** Length of one barrier (m); a row of ceil(width / length) is placed. */
  length: number;
  /** Distance from the stage road edge to the barrier row (m), default 4. */
  setback?: number;
  /** Skip side roads narrower than this (footpaths), default 2.5 m. */
  minWidth?: number;
  /**
   * Only mouths between the start and the finish, +/- this margin (m along the stage road). Missing = every mouth on
   * the map's road (a map with one stage over the whole road).
   */
  stageMargin?: number;
}

/** `[air, road]` in °C. */
export type AirRoad = readonly [air: number, road: number];

/**
 * Predefined temperatures of a stage by season and time of day (`TIMES_OF_DAY` slot; the stage's own slot is at the
 * stage's own hour, `environment.timeOfDay`): the air and the road, the road being the stage's first surface (what the
 * stage screen shows). Other hours (`?tod=`) blend the neighbouring slots (maps/shared/day-temperature.ts); the tyres'
 * sun heat is the road's gap to the air, scaled to each surface's `heat`.
 */
export type StageTemps = Record<Season, Record<TimeOfDayId, AirRoad>>;

/**
 * A STAGE: the rally event on a map's road (see MapDef). Runs along the map's road, or against it (`reverse`): every
 * distance of the stage (`timing`, `props`, the `spawn=` URL) is measured along the stage road in its own direction.
 */
export interface StageDef {
  /** Stage id: menus, times (`rally.times.<id>`), URLs. Never renamed once released. */
  id: string;
  name: string;
  /** Edition year printed in the start / finish gantry header next to the stage name. */
  year: number;
  /** Air and road temperature for every season and time of day (`StageTemps`): the stage screen and the tyres use it. */
  temps: StageTemps;
  /**
   * Hour a time-of-day slot means on this stage where it differs from game/time-of-day.ts (Vodno's early morning is
   * 08:00). The stage's own slot always sits at its own `timeOfDay`; the temperatures follow these hours.
   */
  slotHours?: Partial<Record<TimeOfDayId, number>>;
  /**
   * Season the stage opens in (default: the map's, `EnvironmentDef.season`): stages on one map can differ. The ground
   * and the leaves of the others come from the map's `groundTints` and `trees/seasons.ts`.
   */
  season?: Season;
  description: string;
  /** Recommended tyre for the stage's surfaces: pre-selected on the car screen, the player may pick another. */
  tyre: TyreId;
  /**
   * Recommended gearing (physics/gearing.ts) for cars that can change it - e.g. `long` on a fast stage. Missing =
   * `medium`. Pre-selected on the setup screen like the tyre.
   */
  gearing?: GearingId;
  /** Driven against the map road's direction: distances count from the road's end. */
  reverse?: boolean;
  timing: StageTiming;
  /** Real-world maps: where another road / track meets the stage road, close its mouth (world/world.ts closures). */
  closures?: ClosureRule;
  /** Fan groups (tape, spectators, flags) on the inside of tight corners along the stage: world/corner-fans.ts. */
  cornerFans?: CornerFansRule;
  /** Event props (closure rows, hay bales, tape) along the stage road. */
  props?: PropPlacement[];
  /** Service park beside the start: team bays, crowd, start control (world/service-park.ts). */
  servicePark?: ServicePark;
  /** Links only this stage uses (its route): listed with the map's sources on the About screen. */
  sources?: SourceLink[];
}

/**
 * A level lot for a service park, in world metres. `u` runs along `heading` (rad, x towards z), `v` across it; the
 * lot's origin is its west corner on the public edge (v = 0, where the tape and the crowd are). The map levels the
 * same rectangle with a `terrain.pads` entry (`servicePad`, maps/shared/service-lot.ts).
 */
export interface ServiceLot {
  /** Centre. */
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  /** Parc fermé lots (`ServicePark.ferme`): at most this many cars here (default: as many as fit). */
  bays?: number;
  /**
   * A paddock lot: team cars wanted here (a works bay holds two, the others one); bays are drawn from the east end until
   * they add up to it. Without it as many bays as fit.
   */
  cars?: number;
  /** A parc fermé on a street: its pieces may stand on the road surface of other roads (buildings and water still block). */
  paved?: boolean;
  /**
   * A parc fermé parked along the street (nose to tail on the side of the public edge, no ground sheets) instead of
   * nose-in. Set the lot over the street: `width` = its carriageway, public edge on the kerb facing the stage.
   */
  parallel?: boolean;
  /**
   * Tractor-trailer team trucks (`service_semi`) parked across the lot behind the bays (one row of bays, then 6 m of aisle
   * and the 17 m trucks, noses to the back edge), each in the colours of the nearest bay's team. The lot's width needs
   * about 36 m, its length 11 m per truck.
   */
  semis?: number;
  /**
   * A recovery tow truck (`service_tow`, 7 m) with a marshal stands at the lot's far end (u = length), beside the
   * cars, nose to +u; the bays start 9.5 m short of that end. A parc fermé lot: make it 9.5 m longer than its cars need.
   */
  tow?: boolean;
  /** Where dirt links cross the verge to the road (`linkPad`): u along the lot (m); tape, crowd and press keep clear of them. */
  links?: number[];
  /**
   * A lean lot: each car has just this many mechanics [min, max] round it (no crew, drivers, guests or aisle visitors).
   * Default: the full crew of a team bay.
   */
  mechanics?: [number, number];
  /** Spectators along this lot's public edge (default: `ServicePark.crowd` scaled to the lot's length). */
  crowd?: number;
  /** Press photographers along the public edge (default: one per 30 m, at least 2). */
  press?: number;
  /**
   * Drawn only within this many metres of the camera, whatever the asset's own range: a lot far from the start, seen
   * once the player drives back (free drive), costs nothing until then.
   */
  showWithin?: number;
}

/** A rally service park (paddock) at a stage start: team bays on the lots, a crowd on the public edge. */
export interface ServicePark {
  /** Lots, filled in order until `bays` bays fit. */
  lots: ServiceLot[];
  /** Team bays wanted (>= 10, a parc fermé: the cars); each holds a team car, its truck or van, tents, props and 6-12 people. */
  bays: number;
  /**
   * A parc fermé instead of a paddock: just the cars, parked side by side with their noses to the public edge on
   * ground sheets, a few people and the tape. Small lots beside the road (`ServiceLot.bays` cars each).
   */
  ferme?: boolean;
  /** Space between neighbouring bays of a row (m, default 5; a parc fermé 0.6). */
  gap?: number;
  /** Spectators along 84 m of public edge (default 30); visitors in the aisles scale with the lot length. */
  crowd?: number;
  /** Timekeeper tent, control boards, marshals and a rescue ambulance beside the start line. */
  startControl?: boolean;
  /** Default: hash of the stage id. */
  seed?: number;
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
    /** Rows along the field strips (`landcover.fields.angle`) instead of the zone's angle; turned to face along them. */
    fields?: boolean;
    /** Turn each instance to face along its row (zone angle; e.g. vineyard row segments). */
    face?: boolean;
  };
  /** Only in these seasons (the map's season; e.g. per-season looks of the same plant). */
  season?: Season[];
  /** Only on field parcels growing this crop in the map's season (`landcover.fields.crops`). */
  crop?: string;
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
  /** Guard rail only: weathered, rusted brown steel instead of galvanised. */
  rusty?: boolean;
}

/** Street detail along the other roads near the stage road. */
export interface CityStreets {
  /** Streets within this distance of the stage road get kerbs, sidewalks, crosswalks and lamps (m). */
  reach: number;
  /** Sidewalk width (m). */
  sidewalk?: number;
  /** Lamp spacing along the streets (m, 0 = none). */
  lampEvery?: number;
  /** One asphalt for every city street (default: city asphalt, centre lines by width; world/road-mesh.ts pathTexture). */
  asphalt?: RoadTexture;
}

/**
 * City dressing derived from the road network (`paths`, bridge decks, junctions), deterministic from the map seed.
 * Everything stays out of buildings and off other roads.
 */
export interface StreetDressing {
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
  /** Spectators per group [min, max] (default [2, 5]). */
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
   * Season of the map's own look, the one `groundTint` is for (default summer); a stage opens in it unless its
   * `StageDef.season` says otherwise. The season picks the leaf colours (trees/seasons.ts), the ground (`groundTints`)
   * and the stage's `temps`. Try others with `?season=spring|summer|autumn`.
   */
  season?: Season;
  /**
   * Month (1 = January ... 12) the stage is driven in per season, shown on the stage screen (default April / July /
   * October, `DEFAULT_MONTHS`). The stages' `temps` are researched for that month.
   */
  months?: Partial<Record<Season, number>>;
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
  /** Mie haze around the sun (default 0.004). */
  mieCoefficient?: number;
  /** Brightness of the visible sky dome (default 1; lower = a deeper blue that does not burn out to white). */
  skyBrightness?: number;
  /** FogExp2 colour: a colour, or 'sky' = the hue of the sky just above the horizon (read from the env map). */
  fogColor: string;
  /** With `fogColor: 'sky'`: the fog's linear luminance (default 0.62, about that of a light grey fog). */
  fogBrightness?: number;
  /** FogExp2 density. */
  fogDensity: number;
  exposure: number;
  /**
   * Recolour the terrain grass (keeps the texture's light/dark detail), e.g. golden dry
   * summer grass: { grass: '#c9b47a', amount: 0.85 }. `crop` = colour of ripe crop
   * parcels (see `LandcoverDef.fields.palette`), default wheat gold. `moisture` = strength of the wet / dry grass
   * variation (greener hollows and banks, straw ridges and slopes; world/ground-moisture.ts), default 1, 0 = off.
   */
  groundTint?: GroundTint;
  /**
   * The ground in other seasons (spring, autumn), ahead of `groundTint` (the map's look in its own season): fresh green
   * grass and young crops in spring, dry olive and stubble in autumn. `mapInSeason` (maps/shared/season-map.ts) puts
   * the season's tint into `groundTint`, so every consumer reads one field.
   */
  groundTints?: Partial<Record<Season, GroundTint>>;
  /**
   * Colour grade after tone mapping (engine/grade.ts); missing = none (the plain tone-mapped image). Off at night and
   * in the studio; `?grade=off` turns it off for comparisons.
   */
  grade?: ColorGrade;
  /**
   * Evening golden hour (`isGoldenHour`, 17:00 till night): these settings replace the day ones (sky, fog, exposure,
   * grade ...), e.g. a warmer grade and a pink / purple sky.
   */
  goldenHour?: Partial<Omit<EnvironmentDef, 'goldenHour'>>;
  /** Grade changes for other seasons, merged field by field over `grade` (`mapInSeason` puts the result in `grade`). */
  grades?: Partial<Record<Season, ColorGrade>>;
}

/** A colour grade (`EnvironmentDef.grade`); every field defaults to "no change". */
export interface ColorGrade {
  /** White balance: + warmer (more red, less blue), - cooler; about -1..1 (default 0). */
  warmth?: number;
  /** White balance: + magenta, - green; about -1..1 (default 0). */
  tint?: number;
  /** Contrast around mid grey (default 1). */
  contrast?: number;
  /** Saturation (default 1). */
  saturation?: number;
  /** Extra saturation for dull colours, less for strong ones, 0..1 (default 0). */
  vibrance?: number;
  /** Shadows / highlights lean towards this colour by `amount` (0..1, default none). */
  shadowTint?: { color: string; amount: number };
  highlightTint?: { color: string; amount: number };
  /** Corner darkening, 0..1 (default 0). */
  vignette?: number;
}

/** Recolour of the terrain grass and crop parcels (`EnvironmentDef.groundTint`). */
export interface GroundTint {
  grass: string;
  amount?: number;
  crop?: string;
  moisture?: number;
  /** Meadow colour patches: deeper green and yellow-green drifts, 0..1 (default 0). */
  variety?: number;
  /** Leaf litter under the tree crowns, 0..1 (default by season: spring 0.3, summer 0.45, autumn 1). */
  litter?: number;
}

/**
 * A gondola line: the polyline of the ropes (flat x, z, lower station first) with pylons placed along it. The ropes
 * hang from the pylon heads (taller where the slope asks for it), two cabin rows hang from them, static.
 */
export interface AerialwayDef {
  name: string;
  /** Line of the cable car, flat [x, z, x, z, ...], lower station -> upper station. */
  line: number[];
  /** Distance between pylons (m, default 125). */
  pylonEvery?: number;
  /**
   * The line's interior vertices ARE the pylons (a surveyed line: OSM draws the rope with a node at each tower): spans
   * longer than `maxSpan` get extra pylons, `pylonEvery` is then only the spacing of those.
   */
  pylonsAtVertices?: boolean;
  /** Longest span with `pylonsAtVertices` before extra pylons are added (m, default 400). */
  maxSpan?: number;
  /** Cabin speed on the ropes (m/s, default 5): the cabins run round the loop, up one rope and down the other. */
  speed?: number;
  /** Rope height over the ground at the two stations (m, default 7). */
  stationHeight?: number;
  /** Distance between cabins on one rope (m, default 117). */
  cabinEvery?: number;
  /** Least rope clearance over the ground mid-span (m, default 8). */
  clearance?: number;
}
