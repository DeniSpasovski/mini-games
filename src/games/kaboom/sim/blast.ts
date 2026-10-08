import { CHAIN_DELAY_S, FLAME_S } from './rules';
import type { SimState, Tnt } from './state';
import { Terrain } from './types';

/** Arm directions: +x, -x, +y, -y (the order of `tntExploded.arms`). */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Where explosion events go (the sim's pooled event writer; tests use a plain collector). */
export interface BlastSink {
  blockBroken(x: number, y: number): void;
  tntExploded(t: Tnt, arms: readonly [number, number, number, number]): void;
}

const arms: [number, number, number, number] = [0, 0, 0, 0];

function setFlame(s: SimState, i: number, owner: number): void {
  s.flame[i] = FLAME_S;
  s.flameOwner[i] = owner;
}

/**
 * Detonate `t`: a cross of flames. An arm stops before a hard block, at (and breaks) the first crate, and at the first
 * TNT it reaches, which it sets off `CHAIN_DELAY_S` later (so a chain spreads over frames). Frees the owner's TNT slot.
 */
export function explode(s: SimState, t: Tnt, sink: BlastSink): void {
  const { w, h } = s;
  t.active = false;
  s.tntAt[t.y * w + t.x] = -1;
  const owner = s.players[t.owner];
  if (owner) owner.tntLeft++;
  setFlame(s, t.y * w + t.x, t.owner);

  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    let len = 0;
    for (let k = 1; k <= t.range; k++) {
      const cx = t.x + dx * k;
      const cy = t.y + dy * k;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      const i = cy * w + cx;
      const terrain = s.terrain[i];
      if (terrain === Terrain.Hard) break;
      setFlame(s, i, t.owner);
      len = k;
      if (terrain === Terrain.Crate) {
        s.terrain[i] = Terrain.Empty;
        sink.blockBroken(cx, cy);
        break;
      }
      const j = s.tntAt[i];
      if (j >= 0) {
        const other = s.tnts[j];
        if (other.active && other.fuse > CHAIN_DELAY_S) {
          other.fuse = CHAIN_DELAY_S;
          other.depth = t.depth + 1;
        }
        break;
      }
    }
    arms[d] = len;
  }
  sink.tntExploded(t, arms);
}

/**
 * Cells a TNT of `range` at `(x, y)` burns on `terrain` with no other TNT around: its own cell, then each arm until a
 * hard block (not burnt) or the first crate (burnt, arm stops). Allocates: for map generation and tests, not the tick.
 */
export function crossCells(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  range: number,
): number[] {
  const out = [y * w + x];
  for (const [dx, dy] of DIRS) {
    for (let k = 1; k <= range; k++) {
      const cx = x + dx * k;
      const cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      const i = cy * w + cx;
      if (terrain[i] === Terrain.Hard) break;
      out.push(i);
      if (terrain[i] === Terrain.Crate) break;
    }
  }
  return out;
}
