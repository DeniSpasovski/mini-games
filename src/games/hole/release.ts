/**
 * Release list of Hole Island: which maps ship in the published build - the ONLY place to change this
 * (same idea as `src/games/rally/release.ts`).
 *
 * Every registered map is listed once. `hideInProd: true` = work in progress: dev server and test builds only
 * (`npm run dev`, `npm run build:test`). Same flag as `game.json` (`src/shared/release.ts`).
 *
 * Ids = `MapDef.id`; tests/hole/release.test.ts checks every registered map is listed once. DOM-free.
 */
import { isReleased, type ReleaseEntry } from '../../shared/release';

export { released } from '../../shared/release';

export const MAPS_LIST: readonly ReleaseEntry[] = [
  { id: 'city' },
  { id: 'toy' },
  { id: 'animal' },
  { id: 'construction' },
];

/** Not released (`hideInProd`, or by mistake not listed). */
export const isTestMap = (id: string): boolean => !isReleased(MAPS_LIST, id);
