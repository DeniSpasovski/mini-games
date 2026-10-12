import { Terrain, type MapData, type MapSizeId } from '../sim/types';
import { MAP_SIZES } from './sizes';

/**
 * Placeholder arena: hard border + pillars on every (even, even) cell, no crates, no spawns. Renders the slab before the
 * real generator (`generate.ts`, WP2) exists and stays useful as a test fixture.
 */
export function blankMap(sizeId: MapSizeId, seed = 1): MapData {
  const { w, h } = MAP_SIZES[sizeId];
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) terrain[y * w + x] = Terrain.Hard;
    }
  }
  return {
    sizeId,
    w,
    h,
    seed,
    terrain,
    variant: new Uint8Array(w * h),
    spawns: [],
  };
}
