import { crossCells } from '../sim/blast';
import { BASE_SPEED, MIN_FUSE_S, START_RANGE } from '../sim/rules';
import { Terrain, type MapData } from '../sim/types';

/** Seconds a human needs to react after dropping the first TNT; the escape must fit in `MIN_FUSE_S - REACTION_S`. */
export const REACTION_S = 0.5;
/** How many steps from the spawn the "first TNT hits a crate" search looks. */
const NEAR_STEPS = 4;

const N4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** BFS steps from `(x, y)` over empty cells; -1 = unreachable. The start cell counts as 0 even if a TNT stands on it. */
export function stepsFrom(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): Int16Array {
  const dist = new Int16Array(w * h).fill(-1);
  const queue = [y * w + x];
  dist[queue[0]] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const cx = i % w;
    const cy = (i - cx) / w;
    for (const [dx, dy] of N4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] >= 0 || terrain[j] !== Terrain.Empty) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/**
 * Seconds to reach a cell outside the blast after dropping a TNT of `range` on `(x, y)` at base speed (Infinity = trapped).
 * `from` = the cell the player stands on when dropping it (a hiding spot is only useful if it is reachable from there).
 */
export function escapeSeconds(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  range = START_RANGE,
): number {
  const burning = new Set(crossCells(terrain, w, h, x, y, range));
  const dist = stepsFrom(terrain, w, h, x, y);
  let best = Infinity;
  for (let i = 0; i < dist.length; i++)
    if (dist[i] > 0 && !burning.has(i)) best = Math.min(best, dist[i]);
  return best / BASE_SPEED;
}

export interface SpawnCheck {
  /** A TNT dropped on the spawn can be outrun (a safe cell is reachable within the fuse, with reaction time). */
  escapes: boolean;
  /** Within a few steps there is a cell where a TNT hits a crate and still can be outrun. */
  hitsCrate: boolean;
  ok: boolean;
}

/** The two spawn-safety rules of DETAILS.md "Spawn safety" for spawn `index` of `map`. */
export function checkSpawn(
  map: MapData,
  index: number,
  terrain: Uint8Array = map.terrain,
): SpawnCheck {
  const { w, h } = map;
  const s = map.spawns[index];
  const limit = MIN_FUSE_S - REACTION_S;
  const escapes = escapeSeconds(terrain, w, h, s.x, s.y) <= limit;

  let hitsCrate = false;
  const near = stepsFrom(terrain, w, h, s.x, s.y);
  for (let i = 0; i < near.length && !hitsCrate; i++) {
    if (near[i] < 0 || near[i] > NEAR_STEPS) continue;
    const cx = i % w;
    const cy = (i - cx) / w;
    const cross = crossCells(terrain, w, h, cx, cy, START_RANGE);
    if (
      cross.some((c) => terrain[c] === Terrain.Crate) &&
      escapeSeconds(terrain, w, h, cx, cy) <= limit
    )
      hitsCrate = true;
  }
  return { escapes, hitsCrate, ok: escapes && hitsCrate };
}

/** `checkSpawn` for every spawn; the generator guarantees `ok` for all of them. */
export function checkAllSpawns(map: MapData): SpawnCheck[] {
  return map.spawns.map((_, i) => checkSpawn(map, i));
}
