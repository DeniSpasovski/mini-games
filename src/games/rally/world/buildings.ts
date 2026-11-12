import { HOUSE_WALL_FRACTION } from '../assets/catalog';
import { doorSlot } from '../engine/house-walls';
import type { BuildingDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import type { ScatterInstance } from './scatter';

/**
 * Buildings from real footprints (MapDef.buildings): placement as scaled unit-footprint
 * instances of `house_pitched` / `building_flat`, and a spatial index so scatter keeps
 * out of them and the map viewer can name the building under the cursor.
 */

const CELL = 32;

/** Footprint-local coordinates (u along the long side, v along the short side). */
function local(b: BuildingDef, x: number, z: number): [number, number] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const dx = x - b.x;
  const dz = z - b.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}

/** Distance from (x, z) to the footprint (0 inside). */
export function footprintDistance(
  b: BuildingDef,
  x: number,
  z: number,
): number {
  const [u, v] = local(b, x, z);
  return Math.hypot(
    Math.max(Math.abs(u) - b.w / 2, 0),
    Math.max(Math.abs(v) - b.d / 2, 0),
  );
}

export class BuildingIndex {
  private grid = new Map<number, BuildingDef[]>();

  constructor(readonly buildings: BuildingDef[]) {
    for (const b of buildings) {
      const r = Math.hypot(b.w, b.d) / 2 + 2;
      for (
        let cz = Math.floor((b.z - r) / CELL);
        cz <= Math.floor((b.z + r) / CELL);
        cz++
      )
        for (
          let cx = Math.floor((b.x - r) / CELL);
          cx <= Math.floor((b.x + r) / CELL);
          cx++
        ) {
          const k = (cx + 32768) * 65536 + (cz + 32768);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(b);
        }
    }
  }

  /** Inside a footprint grown by `margin` (m, at most 2). */
  contains(x: number, z: number, margin = 0): boolean {
    const l = this.grid.get(key(x, z));
    if (!l) return false;
    for (const b of l) if (footprintDistance(b, x, z) <= margin) return true;
    return false;
  }

  /** Building whose footprint is nearest to (x, z) within maxDist. */
  nearest(x: number, z: number, maxDist = 20): BuildingDef | undefined {
    let best: BuildingDef | undefined;
    let bd = maxDist;
    for (
      let cz = Math.floor((z - maxDist) / CELL);
      cz <= Math.floor((z + maxDist) / CELL);
      cz++
    )
      for (
        let cx = Math.floor((x - maxDist) / CELL);
        cx <= Math.floor((x + maxDist) / CELL);
        cx++
      )
        for (const b of this.grid.get((cx + 32768) * 65536 + (cz + 32768)) ??
          []) {
          const d = footprintDistance(b, x, z);
          if (d <= bd) [best, bd] = [b, d];
        }
    return best;
  }

  byId(id: number): BuildingDef | undefined {
    return this.buildings.find((b) => b.id === id);
  }
}

function key(x: number, z: number): number {
  return (
    (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768)
  );
}

/** How far a box building goes into the ground under its lowest corner (m). */
export const BUILDING_SINK = 0.15;

/**
 * Where the front door stands: the middle window column (`doorSlot`) of the long wall at local +Z, or of the opposite
 * one when the box is turned half a turn (`flip`). World x, z on the wall and the ground height there.
 */
function doorSpot(
  b: BuildingDef,
  ground: TerrainSampler,
  flip: boolean,
): { x: number; y: number; z: number } {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const side = flip ? -1 : 1;
  const u = doorSlot(b.w).u * b.w * side;
  const v = (b.d / 2) * side;
  const x = b.x + u * c - v * s;
  const z = b.z + u * s + v * c;
  return { x, y: ground.height(x, z), z };
}

/**
 * Which long wall gets the front door (true = the box turned half a turn): on a slope the one where the door stands
 * on the lower ground (most of the wall above it), on flat ground the one that faces `road`, the nearest road point.
 */
function doorFlip(
  b: BuildingDef,
  ground: TerrainSampler,
  road?: { x: number; z: number },
): boolean {
  const front = doorSpot(b, ground, false).y;
  const back = doorSpot(b, ground, true).y;
  if (Math.abs(front - back) > 0.3) return back < front;
  if (!road) return false;
  // Local +Z of the footprint is (-sin angle, cos angle).
  return (
    -(road.x - b.x) * Math.sin(b.angle) + (road.z - b.z) * Math.cos(b.angle) < 0
  );
}

/**
 * Instance for a building: unit footprint scaled to w x height x d, yawed so local +X runs
 * along the long side, standing on the LOWEST footprint corner (walls run down slopes). `road` = the nearest road
 * point, for the wall the door goes on (`doorFlip`).
 */
export function buildingInstance(
  b: BuildingDef,
  ground: TerrainSampler,
  stone = false,
  road?: { x: number; z: number },
): ScatterInstance {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, 0],
  ]) {
    const x = b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2;
    const z = b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2;
    const h = ground.height(x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const sink = BUILDING_SINK;
  const walls = b.h + (hi - lo) + sink;
  const house = b.type === 'house';
  // Houses: variant = style 0-2 render, 3 clay brick (+ 4 for two floors); rubble stone is its own asset (0 hip, 1 gable,
  // + 2 for two floors). Flat: 0/1 halls, 2/3 blocks (+ 4 for two floors).
  const two = b.floors >= 2 ? 4 : 0;
  const base = (b.id * 7) % 4;
  // Mountain villages: lime-plastered rubble stone, more of it the higher up the hill (the old houses): about a
  // quarter at the bottom, nine in ten from 75 m above it.
  const roll = ((b.id * 2654435761) >>> 0) / 4294967296;
  const stoneShare = Math.min(0.9, Math.max(0.25, 0.25 + lo * 0.0087));
  const rubble = house && stone && roll < stoneShare;
  const style = house
    ? rubble
      ? b.id % 2
      : base
    : b.w * b.d > 300
      ? b.id % 2
      : 2 + (b.id % 2);
  // The front (door, a hall's roller door) is on local +Z: turned half a turn when it belongs on the other long wall.
  const flip = doorFlip(b, ground, road);
  return {
    asset: rubble ? 'house_stone' : house ? 'house_pitched' : 'building_flat',
    variant: style + (rubble && two ? 2 : two),
    x: b.x,
    y: lo - sink,
    z: b.z,
    // three.js yaw maps local +X to (cos t, -sin t); we want (cos angle, sin angle).
    rotY: -b.angle + (flip ? Math.PI : 0),
    scale: 1,
    sx: b.w,
    sy: house ? walls / HOUSE_WALL_FRACTION : walls,
    sz: b.d,
    tiltX: 0,
    tiltZ: 0,
  };
}

/** Unfinished brick (grey window frames, a grey door frame)? Halls: undefined, they have neither windows nor a door. */
function brickOf(body: ScatterInstance): boolean | undefined {
  if (body.asset === 'building_flat')
    return body.variant % 4 < 2 ? undefined : body.variant % 4 === 2;
  return body.asset === 'house_pitched' && body.variant % 4 === 3;
}

/**
 * The windows of a box building (`house_windows`): the same box as `body` (a `buildingInstance`) up to its wall top.
 * Variant: one / two floors (+ 2), grey frames on unfinished brick (+ 1). Halls have none.
 */
export function buildingWindows(
  b: BuildingDef,
  body: ScatterInstance,
): ScatterInstance | undefined {
  const brick = brickOf(body);
  if (brick === undefined) return undefined;
  return {
    ...body,
    asset: 'house_windows',
    variant: (b.floors >= 2 ? 2 : 0) + (brick ? 1 : 0),
    sy: b.type === 'house' ? body.sy! * HOUSE_WALL_FRACTION : body.sy,
  };
}

/**
 * The front door of a box building (`house_door`, real size): on the wall `buildingInstance` picked, its step on the
 * ground there - on a slope across the wall the door climbs with the ground instead of ending up half buried.
 * Variant: 0 house, 1 unfinished brick house, 2 rendered block, 3 brick block. Halls have their roller door: none.
 */
export function buildingDoor(
  b: BuildingDef,
  ground: TerrainSampler,
  body: ScatterInstance,
): ScatterInstance | undefined {
  const house = b.type === 'house';
  const brick = brickOf(body);
  if (brick === undefined) return undefined;
  const spot = doorSpot(b, ground, body.rotY !== -b.angle);
  return {
    asset: 'house_door',
    variant: (house ? 0 : 2) + (brick ? 1 : 0),
    x: spot.x,
    // (Never under the foot of the walls: the ground model can dip between the corners.)
    y: Math.max(spot.y, body.y + BUILDING_SINK),
    z: spot.z,
    rotY: body.rotY,
    scale: 1,
    tiltX: 0,
    tiltZ: 0,
  };
}

/** Everything drawn for a box building: the box, its windows and its front door. */
export function buildingInstances(
  b: BuildingDef,
  ground: TerrainSampler,
  stone = false,
  road?: { x: number; z: number },
): ScatterInstance[] {
  const body = buildingInstance(b, ground, stone, road);
  const out = [body];
  const windows = buildingWindows(b, body);
  if (windows) out.push(windows);
  const door = buildingDoor(b, ground, body);
  if (door) out.push(door);
  return out;
}

/** Box collider of a footprint (oriented rectangle, wall height; stands on the lowest corner). */
export function buildingCollider(
  b: BuildingDef,
  ground: TerrainSampler,
): StaticCollider {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, 0],
  ]) {
    const h = ground.height(
      b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2,
      b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2,
    );
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const hx = b.w / 2;
  const hz = b.d / 2;
  return {
    kind: 'box',
    x: b.x,
    z: b.z,
    y: lo - 0.15,
    h: b.h + (hi - lo) + 0.15,
    hx,
    hz,
    // three.js yaw maps local +X to (cos t, -sin t); the footprint runs along (cos angle, sin angle).
    rot: -b.angle,
    r: Math.hypot(hx, hz),
  };
}
