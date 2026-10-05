import { getItem } from '../items/catalog';
import { CANAL_Y } from './spawn';
import { insideMap, type MapData } from './types';

/**
 * A random starting position for a run, inside the playable area and in a busy spot: at least
 * `WANT_SMALL` tier 1-3 items within `NEAR` metres (so the first seconds are never empty), no item
 * the level 1 hole cannot eat under it, and not on the canal. DOM-free; `rnd` is any 0..1 source
 * (`Math.random` in the game, a seeded RNG in the tests). Falls back to `map.start`.
 */
const NEAR = 22;
const WANT_SMALL = 18;
/** Animal Island: a level 1 hole eats tier 1 only, so a start also needs this many tier 1 items within `NEAR` m. */
const WANT_TIER1_ANIMAL = 40;
/** Keep this far from the edge of the playfield (m): the level 1 hole is 1.2 m wide, this leaves room. */
const MARGIN = 14;
/** Largest item size a level 1 hole can eat (m). */
const EDIBLE_L1 = 0.9;

export function pickStart(
  map: MapData,
  rnd: () => number,
  tries = 300,
): { x: number; z: number } {
  const extent = map.bounds
    ? { hx: map.bounds.hx, hz: map.bounds.hz }
    : (() => {
        const r = Math.max(...map.coast);
        return { hx: r, hz: r };
      })();
  const water = map.rects.filter((r) => r.y === CANAL_Y);
  const walk = map.walk;
  /** Animal Island: not in a river or pond, not on a hill or building. */
  const onLand = (x: number, z: number) =>
    !walk ||
    walk.data[
      Math.floor((z - walk.z0) / walk.cell) * walk.nx +
        Math.floor((x - walk.x0) / walk.cell)
    ] === 1;

  // spatial hash of the items that matter: every item (clearance) and the small ones (count)
  const CELL = 24;
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 1024) * 4096 + (cz + 1024);
  const sizes: number[] = [];
  const tiers: number[] = [];
  map.placements.forEach((p, i) => {
    const it = getItem(p.item);
    sizes.push(it.size);
    tiers.push(it.tier);
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    const b = cells.get(k);
    if (b) b.push(i);
    else cells.set(k, [i]);
  });

  let best = { x: map.start.x, z: map.start.z };
  let bestScore = -Infinity;
  for (let n = 0; n < tries; n++) {
    const x = (rnd() * 2 - 1) * (extent.hx - MARGIN);
    const z = (rnd() * 2 - 1) * (extent.hz - MARGIN);
    if (!insideMap(map, x, z, MARGIN)) continue;
    if (!onLand(x, z)) continue;
    if (
      water.some(
        (w) => x > w.x0 - 3 && x < w.x1 + 3 && z > w.z0 - 3 && z < w.z1 + 3,
      )
    )
      continue;
    let small = 0;
    let tier1 = 0;
    let blocked = false;
    const c0x = Math.floor((x - NEAR) / CELL);
    const c1x = Math.floor((x + NEAR) / CELL);
    const c0z = Math.floor((z - NEAR) / CELL);
    const c1z = Math.floor((z + NEAR) / CELL);
    for (let cx = c0x; cx <= c1x && !blocked; cx++)
      for (let cz = c0z; cz <= c1z && !blocked; cz++)
        for (const i of cells.get(key(cx, cz)) ?? []) {
          const p = map.placements[i];
          const d = Math.hypot(p.x - x, p.z - z);
          if (sizes[i] > EDIBLE_L1 && d - sizes[i] / 2 < 1.2) {
            blocked = true; // standing on something the first hole cannot eat
            break;
          }
          if (tiers[i] <= 3 && d <= NEAR) small++;
          if (tiers[i] <= 1 && d <= NEAR) tier1++;
        }
    if (blocked) continue;
    const need1 = map.id === 'animal' ? WANT_TIER1_ANIMAL : 0;
    if (small >= WANT_SMALL && tier1 >= need1) return { x, z };
    const score = small + (need1 ? 3 * tier1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}
