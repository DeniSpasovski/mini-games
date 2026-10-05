import type { MapData, Placement } from './types';

/** A tiny map (no roads, huge island) for viewers and tests that only need some placed items. */
export function minimalMap(
  placements: Placement[],
  start = { x: 0, z: 0 },
): MapData {
  return {
    id: 'viewer',
    seed: 0,
    coast: new Array<number>(8).fill(5000),
    beachWidth: 0,
    rects: [],
    blocks: [],
    placements,
    start,
  };
}
