/**
 * Release list: which cars / maps ship in the published build - the ONLY place to change this.
 *
 * Every car / map registered in `cars/index.ts` / `maps/index.ts` is listed here exactly once. `hideInProd: true` =
 * work in progress - a NEW car / map goes here first. Dev server and test builds only (`npm run dev`,
 * `npm run build:test`), marked TEST in the menus, tool pages and in-game HUD. Removing the flag releases it, so
 * small fixes can ship while a big new map or car is still unfinished. Same flag as `game.json` (`src/shared/release.ts`).
 *
 * Ids = `CarDef.id` / `MapDef.id`; tests/rally/release.test.ts checks every registered id is listed once. DOM-free
 * (the registries are imported by the node tests).
 */
import { isReleased, type ReleaseEntry } from '../../shared/release';

export { released } from '../../shared/release';

export const CARS_LIST: readonly ReleaseEntry[] = [
  { id: 'skoda_rally' },
  { id: 'zastava_101' },
  { id: 'bimmer_m3' },
  { id: 'bimmer_gt2', hideInProd: true },
  { id: 'fiesta', hideInProd: true },
  { id: 'subie_22b', hideInProd: true },
  { id: 'citroen_c4', hideInProd: true },
  { id: 'lancer_evo_6', hideInProd: true },
];

export const MAPS_LIST: readonly ReleaseEntry[] = [
  { id: 'test' },
  { id: 'ajvatovci' },
  { id: 'petralica' },
  { id: 'jackie' },
];

/** Not released (`hideInProd`, or by mistake not listed) - shown with a TEST badge on the dev server. */
export const isTestCar = (id: string): boolean => !isReleased(CARS_LIST, id);
export const isTestMap = (id: string): boolean => !isReleased(MAPS_LIST, id);

/** Tooltip / note shown on test-only cars / maps (dev server only). */
export const TEST_NOTE = 'Test content - hidden in the release build';

/** Name for tool-page lists: "<name> · TEST" for test-only entries. */
export function listLabel(name: string, test: boolean): string {
  return test ? `${name} · TEST` : name;
}
