import { hash3, Rng } from '../../../shared/rng';
import {
  Terrain,
  type MapData,
  type MapSizeId,
  type MatchConfig,
} from '../sim/types';
import { checkSpawn } from './safety';
import { MAP_SIZES } from './sizes';
import { spawnCells } from './spawns';
import { QUARRY, type MapStyle } from './styles';

export interface GenerateParams {
  size: MapSizeId;
  seed: number;
  style?: MapStyle;
}

/** Repair attempts per spawn before giving up (the clearings make failures very rare, the test sweeps 1000 seeds). */
const MAX_REPAIRS = 24;

/** Cells to keep empty around a spawn: the spawn, 2 cells along each border it touches and the free cells next to them. */
function spawnZone(w: number, h: number, sx: number, sy: number): number[] {
  const out: number[] = [];
  const free = (x: number, y: number) =>
    x >= 1 &&
    y >= 1 &&
    x <= w - 2 &&
    y <= h - 2 &&
    !(x % 2 === 0 && y % 2 === 0);
  const add = (x: number, y: number) => {
    if (free(x, y)) out.push(y * w + x);
  };
  const rows: number[] = [];
  if (sy === 1) rows.push(1);
  if (sy === h - 2) rows.push(h - 2);
  for (const r of rows) {
    const inward = r === 1 ? 2 : h - 3;
    for (let x = sx - 2; x <= sx + 2; x++) {
      add(x, r);
      add(x, inward);
    }
  }
  const cols: number[] = [];
  if (sx === 1) cols.push(1);
  if (sx === w - 2) cols.push(w - 2);
  for (const c of cols) {
    const inward = c === 1 ? 2 : w - 3;
    for (let y = sy - 2; y <= sy + 2; y++) {
      add(c, y);
      add(inward, y);
    }
  }
  return out;
}

/** The (up to 4) cells that mirror `(x, y)` across both axes of the arena. */
function mirrors(w: number, h: number, x: number, y: number): number[] {
  const xs = x === w - 1 - x ? [x] : [x, w - 1 - x];
  const ys = y === h - 1 - y ? [y] : [y, h - 1 - y];
  const out: number[] = [];
  for (const yy of ys) for (const xx of xs) out.push(yy * w + xx);
  return out;
}

/**
 * Seeded arena (DETAILS.md "Maps"): hard border, pillars on every (even, even) cell, crates on ~`crateRatio` of the rest
 * decided for one quadrant and mirrored across both axes (every spawn sees the same arena), spawn zones kept clear, and
 * every spawn proven safe by `checkSpawn` (repairing by clearing the nearest crates, mirrored, when a check fails).
 * Same params = same map. The layout does not depend on the player count: unused spawns are cleared too.
 */
export function generateMap({
  size,
  seed,
  style = QUARRY,
}: GenerateParams): MapData {
  const { w, h } = MAP_SIZES[size];
  const rng = new Rng(hash3(seed, w, h, 0x4b4f));
  const terrain = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  const spawns = spawnCells(size);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        (x % 2 === 0 && y % 2 === 0)
      ) {
        terrain[i] = Terrain.Hard;
        variant[i] = rng.int(0, style.hardVariants - 1);
      }
    }
  }

  const keep = new Set<number>();
  for (const s of spawns)
    for (const i of spawnZone(w, h, s.x, s.y)) keep.add(i);

  // crates: decide for the top-left quadrant (incl. the middle row / column), mirror to the rest
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 1; y <= cy; y++) {
    for (let x = 1; x <= cx; x++) {
      if (terrain[y * w + x] === Terrain.Hard) continue;
      const crate = rng.chance(style.crateRatio);
      const v = rng.int(0, style.crateVariants - 1);
      for (const i of mirrors(w, h, x, y)) {
        if (crate && !keep.has(i)) {
          terrain[i] = Terrain.Crate;
          variant[i] = v;
        }
      }
    }
  }

  const map: MapData = { sizeId: size, w, h, seed, terrain, variant, spawns };

  for (let s = 0; s < spawns.length; s++) {
    for (let attempt = 0; attempt < MAX_REPAIRS; attempt++) {
      if (checkSpawn(map, s).ok) break;
      if (attempt === MAX_REPAIRS - 1)
        throw new Error(
          `kabooom map ${size}/${seed}: spawn ${s} could not be made safe`,
        );
      clearNearestCrate(map, spawns[s].x, spawns[s].y);
    }
  }
  return map;
}

/** Remove the crate closest to `(sx, sy)` (BFS through everything but hard blocks) and its mirror images. */
function clearNearestCrate(map: MapData, sx: number, sy: number): void {
  const { w, h, terrain } = map;
  const seen = new Uint8Array(w * h);
  const queue = [sy * w + sx];
  seen[queue[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i - x) / w;
    if (terrain[i] === Terrain.Crate) {
      for (const m of mirrors(w, h, x, y)) terrain[m] = Terrain.Empty;
      return;
    }
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
      if (seen[j] || terrain[j] === Terrain.Hard) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
}

/** Map factory for a match: round `r` is generated from `seed + r`. */
export const matchMapFactory =
  (config: Pick<MatchConfig, 'seed' | 'size'>) =>
  (round: number): MapData =>
    generateMap({ size: config.size, seed: config.seed + round });
