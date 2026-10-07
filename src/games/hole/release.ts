/**
 * Release flags of Hole Island: which maps ship in the published build - the ONLY place to change this
 * (same idea as `src/games/rally/release.ts`).
 *
 * - `TEST_MAPS`      work in progress: dev server and test builds only (`npm run dev`, `npm run build:test`),
 *                    marked TEST on the menu card.
 * - `AVAILABLE_MAPS` released: in the release build (`npm run build`).
 *
 * Ids = `MapDef.id`; tests/hole/release.test.ts checks every registered map is in exactly one list. DOM-free.
 */

/** Maps in the published build. */
export const AVAILABLE_MAPS: readonly string[] = ['city', 'toy', 'animal'];

/** Maps on the dev server and in test builds only. */
export const TEST_MAPS: readonly string[] = ['construction'];

/** true on the dev server and in a test build: every map; false in the release build. */
export const SHOW_TEST_CONTENT: boolean = import.meta.env.DEV || __TEST_BUILD__;

/** Not released (in TEST_MAPS or, by mistake, in no list). */
export const isTestMap = (id: string): boolean => !AVAILABLE_MAPS.includes(id);
