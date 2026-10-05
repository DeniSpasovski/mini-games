import { HOUSE_WALL_FRACTION } from '../assets/catalog';
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

/**
 * Instance for a building: unit footprint scaled to w x height x d, yawed so local +X runs
 * along the long side, standing on the LOWEST footprint corner (walls run down slopes).
 */
export function buildingInstance(
  b: BuildingDef,
  ground: TerrainSampler,
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
  const sink = 0.15;
  const walls = b.h + (hi - lo) + sink;
  const house = b.type === 'house';
  // Variants: style (0..3) + 4 for two floors of windows. Flat: 0/1 halls, 2/3 blocks.
  const two = b.floors >= 2 ? 4 : 0;
  const style = house
    ? (b.id * 7) % 4
    : b.w * b.d > 300
      ? b.id % 2
      : 2 + (b.id % 2);
  return {
    asset: house ? 'house_pitched' : 'building_flat',
    variant: style + two,
    x: b.x,
    y: lo - sink,
    z: b.z,
    // three.js yaw maps local +X to (cos t, -sin t); we want (cos angle, sin angle).
    rotY: -b.angle,
    scale: 1,
    sx: b.w,
    sy: house ? walls / HOUSE_WALL_FRACTION : walls,
    sz: b.d,
    tiltX: 0,
    tiltZ: 0,
  };
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
