/**
 * Map data produced by map/generate.ts. Pure data + a few geometry helpers,
 * no three.js and no DOM, so the sim, the tests and the balance bot can use it.
 */
/** How a placement moves (Animal Island). Written by the generator, stepped by `sim/movers.ts`. */
export type MoveKind =
  | 'wander' // walk to a random spot inside the leash, idle, repeat
  | 'hop' // wander in jumps
  | 'crawl' // wander, very slowly
  | 'skitter' // short fast dashes
  | 'flutter' // wander in the air (bobs 0.3-1 m up)
  | 'swim' // wander inside water cells
  | 'trail' // loop between home and a second point (ant columns)
  | 'patrol' // loop between home and a second point, never stops long
  | 'roam' // giants: slow wander, long idles
  | 'drive' // City Island cars: follow the road graph (`MapData.roads`) in their right-hand lane, turn at crossings
  | 'stroll'; // City Island people: walk round the sidewalk ring of one block

export interface MoveSpec {
  kind: MoveKind;
  /** Home point (the leash circle is centred here). */
  hx: number;
  hz: number;
  /** The mover never leaves this radius (m) around home. */
  leash: number;
  /** Walking speed (m/s). */
  speed: number;
  /** Second end of a trail / patrol path. */
  tx?: number;
  tz?: number;
  /** Seconds to wait before the first move (spreads a column / herd out). */
  delay?: number;
  /** Flees from a hole that can eat it (default true; insects never flee). */
  flee?: boolean;
  /**
   * `drive`: (hx, hz) = road node the car comes from, (tx, tz) = node it drives to, `leash` = lane offset (m).
   * `stroll`: (hx, hz) = block centre, `leash` = ring half size (m), (tx, tz) = first corner to walk to,
   * `dir` = +1 clockwise on the map (x right, z down) or -1.
   */
  dir?: 1 | -1;
}

/** Road network of City Island: crossings and the asphalt arms between them (canal arms are not roads). */
export interface RoadNet {
  nodes: [number, number][];
  /** Pairs of node indices; every arm is straight, axis-aligned and `pitch` long. */
  edges: [number, number][];
}

export interface Placement {
  /** Catalog item id. */
  item: string;
  x: number;
  z: number;
  /** Yaw in radians. */
  rot: number;
  /** Geometry variant (0..variants-1). */
  variant: number;
  /** Index into the item's `paints`, or -1 for none. */
  paint: number;
  /** Set for items that move. */
  move?: MoveSpec;
}

/** Walk grid of a map (cells of `cell` m): what a mover may stand on. */
export interface WalkGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** 0 = blocked (sea, hill, building), 1 = land, 2 = water (river / pond). */
  data: Uint8Array;
}

/** Rivers, ponds, biomes and the compound of Animal Island (ground render + generator). */
export interface Terrain {
  /** River centre lines (x, z points) with a width in metres. */
  rivers: { pts: [number, number][]; width: number }[];
  ponds: { x: number; z: number; r: number }[];
  /** Biome of every `cell` m square (index into `BIOMES` of `map/animal/biomes.ts`), row-major. */
  biome: {
    x0: number;
    z0: number;
    cell: number;
    nx: number;
    nz: number;
    data: Uint8Array;
  };
  /** The fenced zoo + laboratory compound (axis-aligned, metres). */
  compound: { x0: number; z0: number; x1: number; z1: number };
}

/** Axis-aligned flat ground patch (roads, sidewalks, lots...). Drawn above the grass at height `y`. */
export interface GroundRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  color: number;
}

export type DistrictId =
  'core' | 'downtown' | 'commercial' | 'residential' | 'park' | 'edge';

export interface BlockInfo {
  i: number;
  j: number;
  cx: number;
  cz: number;
  district: DistrictId;
}

/** Rectangular playfield (a store floor) centred on the origin: x in [-hx, hx], z in [-hz, hz]. */
export interface RectBounds {
  hx: number;
  hz: number;
  /** Hole centre keeps this fraction of its diameter from the edge (default: sim COAST_INSET). Small = the hole may bulge over the walls so corner items stay reachable. */
  inset?: number;
  /** X of the entrance gap in the south wall. */
  door?: number;
}

/** A department of the toy store (a coloured floor area). */
export interface ZoneInfo {
  id: string;
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  color: number;
}

export interface MapData {
  id: string;
  seed: number;
  /** Island radius per angle (angle = index / length * 2π), metres. Ignored when `bounds` is set. */
  coast: number[];
  /** When set, the playfield is this rectangle instead of the island `coast`. */
  bounds?: RectBounds;
  /** Width of the sand band inside the coast (m). */
  beachWidth: number;
  rects: GroundRect[];
  blocks: BlockInfo[];
  /** Toy store departments (empty for City Island). */
  zones?: ZoneInfo[];
  placements: Placement[];
  start: { x: number; z: number };
  /** Movers' walk grid (Animal Island). */
  walk?: WalkGrid;
  /** Rivers, ponds, biomes (Animal Island). */
  terrain?: Terrain;
  /** Road crossings and arms (City Island): the lanes of the driving cars. */
  roads?: RoadNet;
}

/** Island radius at an angle (linear interpolation of the coast table). */
export function coastRadius(coast: readonly number[], theta: number): number {
  const n = coast.length;
  let t = theta / (Math.PI * 2);
  t -= Math.floor(t);
  const f = t * n;
  const i = Math.floor(f) % n;
  const k = f - Math.floor(f);
  return coast[i] * (1 - k) + coast[(i + 1) % n] * k;
}

/** True when (x, z) is on the island at least `inset` metres from the coast. */
export function insideIsland(
  coast: readonly number[],
  x: number,
  z: number,
  inset = 0,
): boolean {
  return Math.hypot(x, z) <= coastRadius(coast, Math.atan2(z, x)) - inset;
}

/** Pull a point back inside the island (radially) if it is outside `inset`. */
export function clampToIsland(
  coast: readonly number[],
  x: number,
  z: number,
  inset: number,
): { x: number; z: number } {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const max = Math.max(0, coastRadius(coast, theta) - inset);
  if (r <= max) return { x, z };
  const k = max / r;
  return { x: x * k, z: z * k };
}

/** True when (x, z) is on the map's playfield at least `inset` metres from its edge. */
export function insideMap(
  map: Pick<MapData, 'coast' | 'bounds'>,
  x: number,
  z: number,
  inset = 0,
): boolean {
  const b = map.bounds;
  if (b) return Math.abs(x) <= b.hx - inset && Math.abs(z) <= b.hz - inset;
  return insideIsland(map.coast, x, z, inset);
}

/**
 * Pull a point back onto the playfield (`inset` metres from the edge). `nx, nz`
 * is the outward unit normal of the edge that was hit, or 0, 0 when the point
 * was already inside; the sim drops the velocity along it so the hole slides.
 */
export function clampToMap(
  map: Pick<MapData, 'coast' | 'bounds'>,
  x: number,
  z: number,
  inset: number,
): { x: number; z: number; nx: number; nz: number } {
  const b = map.bounds;
  if (b) {
    const mx = Math.max(0, b.hx - inset);
    const mz = Math.max(0, b.hz - inset);
    const cx = Math.min(mx, Math.max(-mx, x));
    const cz = Math.min(mz, Math.max(-mz, z));
    return {
      x: cx,
      z: cz,
      nx: cx !== x ? Math.sign(x) : 0,
      nz: cz !== z ? Math.sign(z) : 0,
    };
  }
  const c = clampToIsland(map.coast, x, z, inset);
  if (c.x === x && c.z === z) return { ...c, nx: 0, nz: 0 };
  const len = Math.hypot(x, z) || 1;
  return { ...c, nx: x / len, nz: z / len };
}
