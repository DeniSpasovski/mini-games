/**
 * The one release switch. `hideInProd: true` (a game or tool page in `game.json`, a car / map in the game's
 * `release.ts`) = not in the release build (`npm run build`); the dev server and `npm run build:test` show it.
 */

/** The published build: not the dev server, not `npm run build:test`. */
export const RELEASE_BUILD: boolean = import.meta.env.PROD && !__TEST_BUILD__;

/** One row of a game's `release.ts` list (`id` = the car / map id). */
export interface ReleaseEntry {
  id: string;
  hideInProd?: boolean;
}

/** In the list and not `hideInProd`. An id missing from the list counts as hidden. */
export const isReleased = (
  entries: readonly ReleaseEntry[],
  id: string,
): boolean => entries.some((e) => e.id === id && !e.hideInProd);

/** The registry entries this build offers: all of them unless `release`, then the released ones (registry order). */
export function released<T extends { id: string }>(
  all: readonly T[],
  entries: readonly ReleaseEntry[],
  release = RELEASE_BUILD,
): T[] {
  return release ? all.filter((d) => isReleased(entries, d.id)) : [...all];
}
