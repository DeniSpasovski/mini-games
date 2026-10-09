import type { Rng } from '../../../shared/rng';
import { powerUpTotal } from './rules';
import { Terrain, type MapData } from './types';

/** The two power-ups. Each can be taken `MAX_POWER_LEVEL` times: more dynamites at once, longer blast. */
export const PowerUp = { Dynamites: 0, Sticks: 1 } as const;
export type PowerUpKind = (typeof PowerUp)[keyof typeof PowerUp];

/** A crate whose pickup is "close to a player": this many steps from the spawn at least / at most (through any non-hard cell). */
export const CLOSE_MIN_STEPS = 3;
export const CLOSE_MAX_STEPS = 9;

/** Steps from `(sx, sy)` to every cell, walking through anything but hard blocks (crates count as walkable: they will break). */
function stepsThroughCrates(map: MapData, sx: number, sy: number): Int16Array {
  const { w, h, terrain } = map;
  const dist = new Int16Array(w * h).fill(-1);
  const queue = [sy * w + sx];
  dist[queue[0]] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] >= 0 || terrain[j] === Terrain.Hard) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/**
 * Which crate hides which power-up this round: `powerUpTotal` of them (kinds at random; maxing both kinds
 * takes more than one player's share, so the rest has to be won from the others' crates). One of them is in a crate close to each player's spawn (picked
 * at random among the nearest few), the rest in random crates. Returns a per-cell array: the kind, or -1 for no item.
 */
export function assignPowerUps(
  map: MapData,
  players: number,
  rng: Rng,
): Int8Array {
  const { w, h, terrain } = map;
  const hidden = new Int8Array(w * h).fill(-1);
  const crates: number[] = [];
  for (let i = 0; i < terrain.length; i++)
    if (terrain[i] === Terrain.Crate) crates.push(i);
  const taken = new Set<number>();
  const kind = (): PowerUpKind => rng.pick([PowerUp.Dynamites, PowerUp.Sticks]);
  let placed = 0;

  // one near every player
  for (let p = 0; p < players && p < map.spawns.length; p++) {
    const s = map.spawns[p];
    const dist = stepsThroughCrates(map, s.x, s.y);
    const near = crates
      .filter((c) => !taken.has(c) && dist[c] >= 0)
      .sort((a, b) => dist[a] - dist[b] || a - b);
    const inRange = near.filter(
      (c) => dist[c] >= CLOSE_MIN_STEPS && dist[c] <= CLOSE_MAX_STEPS,
    );
    const pool = (inRange.length ? inRange : near).slice(0, 3);
    if (pool.length === 0) continue;
    const c = rng.pick(pool);
    taken.add(c);
    hidden[c] = kind();
    placed++;
  }

  // the rest anywhere
  const rest = crates.filter((c) => !taken.has(c));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const total = powerUpTotal(players, crates.length);
  for (const c of rest.slice(0, Math.max(0, total - placed)))
    hidden[c] = kind();
  return hidden;
}
