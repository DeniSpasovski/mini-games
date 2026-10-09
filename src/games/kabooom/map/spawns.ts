import type { CellPos, MapSizeId } from '../sim/types';
import { MAP_SIZES } from './sizes';

/** Spawn order: opposite corners first (2 players), then the other corners, then the middles of the long edges, then the short ones. */
const ORDER = ['tl', 'br', 'tr', 'bl', 'tm', 'bm', 'lm', 'rm'] as const;

/**
 * The `maxPlayers` spawn cells of a size, in assignment order (player `i` starts on `[i]`). All spawns sit on odd/odd or
 * odd/edge cells that are never pillars, symmetric under the 4-fold mirror of the arena.
 */
export function spawnCells(size: MapSizeId): CellPos[] {
  const { w, h, maxPlayers } = MAP_SIZES[size];
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const at: Record<(typeof ORDER)[number], CellPos> = {
    tl: { x: 1, y: 1 },
    br: { x: w - 2, y: h - 2 },
    tr: { x: w - 2, y: 1 },
    bl: { x: 1, y: h - 2 },
    tm: { x: cx, y: 1 },
    bm: { x: cx, y: h - 2 },
    lm: { x: 1, y: cy },
    rm: { x: w - 2, y: cy },
  };
  return ORDER.slice(0, maxPlayers).map((k) => at[k]);
}
