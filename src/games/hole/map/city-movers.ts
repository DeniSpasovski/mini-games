import { Rng } from '../../../shared/rng';
import {
  coastRadius,
  insideIsland,
  type BlockInfo,
  type Placement,
} from './types';

/**
 * City Island movement (DOM-free, deterministic): which people walk and how. Cars are given their
 * `drive` spec by the generator where they are placed (`vehicleOn`); people are handled here, after
 * the map is complete, with their own Rng so the layout (and the exact point total) never changes.
 *
 *   sidewalk ring of a block -> `stroll` once round the block, in a seeded direction
 *   park block               -> `wander` inside a small circle that stays in the park
 *   beach                    -> `wander` inside a small circle that stays on the island
 *   plazas and lots          -> stand still (buildings and furniture are in the way)
 */

/** Right-hand lane offset from the road centre line (m): clear of the curb lane (parked cars at 4 m). */
export const LANE = 1.9;
/** Corner of the sidewalk ring, in walking order for `dir` = +1 (clockwise on the map, x right, z down). */
export const RING_CORNERS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

const SIDEWALK_MIN = 17.2;
const SIDEWALK_MAX = 19.8;
const PARK_HALF = 16.3;
const WANDER_MAX = 6;

/** Largest wander circle (m, up to `WANDER_MAX`) around (x, z) that stays on the island, 0 when none fits. */
function beachLeash(
  coast: readonly number[],
  x: number,
  z: number,
  inset: number,
): number {
  for (let r = WANDER_MAX; r >= 1.5; r -= 0.5) {
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const a = (k / 8) * Math.PI * 2;
      ok = insideIsland(coast, x + Math.cos(a) * r, z + Math.sin(a) * r, inset);
    }
    if (ok) return r;
  }
  return 0;
}

/** Give every pedestrian that has room to walk a `move` spec. Mutates the placements. */
export function animatePeople(
  placements: Placement[],
  blocks: readonly BlockInfo[],
  coast: readonly number[],
  beachWidth: number,
  seed: number,
): void {
  const rng = new Rng(seed * 4813 + 101);
  const live = blocks.filter((b) => b.district !== 'edge');
  for (const p of placements) {
    if (p.item !== 'pedestrian' || p.move) continue;
    const speed = rng.range(1.1, 1.7);
    const b = live.find(
      (q) => Math.abs(p.x - q.cx) <= 20 && Math.abs(p.z - q.cz) <= 20,
    );
    if (b) {
      const dx = p.x - b.cx;
      const dz = p.z - b.cz;
      const m = Math.max(Math.abs(dx), Math.abs(dz));
      if (m >= SIDEWALK_MIN && m <= SIDEWALK_MAX) {
        const dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
        // the side the pedestrian stands on decides the first corner of the walk
        const side =
          Math.abs(dz) >= Math.abs(dx) ? (dz < 0 ? 0 : 2) : dx > 0 ? 1 : 3;
        const idx = (side + (dir === 1 ? 0 : 3)) % 4;
        const [sx, sz] = RING_CORNERS[idx];
        p.move = {
          kind: 'stroll',
          hx: b.cx,
          hz: b.cz,
          leash: m,
          speed,
          tx: b.cx + sx * m,
          tz: b.cz + sz * m,
          dir,
          delay: rng.range(0, 3),
          flee: false,
        };
        continue;
      }
      if (b.district === 'park' && m < PARK_HALF - 1.5) {
        const leash = Math.min(WANDER_MAX, PARK_HALF - m);
        p.move = { kind: 'wander', hx: p.x, hz: p.z, leash, speed };
      }
      continue;
    }
    // beach: the sand band along the coast
    const ang = Math.atan2(p.z, p.x);
    if (Math.hypot(p.x, p.z) >= coastRadius(coast, ang) - beachWidth) {
      const leash = beachLeash(coast, p.x, p.z, 1);
      if (leash > 0)
        p.move = { kind: 'wander', hx: p.x, hz: p.z, leash, speed };
    }
  }
}
