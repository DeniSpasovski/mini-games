/**
 * Release list: which cars / stages ship in the published build - the ONLY place to change this.
 *
 * Every car / stage registered in `cars/index.ts` / `maps/index.ts` (each map's `stages`) is listed here exactly once.
 * `hideInProd: true` = work in progress - a NEW car / stage goes here first. A map ships when one of its stages does. Dev server and test builds only (`npm run dev`,
 * `npm run build:test`), marked TEST in the menus, tool pages and in-game HUD. Removing the flag releases it, so
 * small fixes can ship while a big new stage or car is still unfinished. Same flag as `game.json` (`src/shared/release.ts`).
 *
 * Ids = `CarDef.id` / `StageDef.id` (every old map id is its stage's id); tests/rally/release.test.ts checks every
 * registered id is listed once. DOM-free
 * (the registries are imported by the node tests).
 */
import { isReleased, type ReleaseEntry } from '../../shared/release';

export { released } from '../../shared/release';

export const CARS_LIST: readonly ReleaseEntry[] = [
  { id: 'skoda_rally' },
  { id: 'zastava_101' },
  { id: 'bimmer_m3' },
  { id: 'bimmer_gt2' },
  { id: 'fiesta' },
  { id: 'subie_22b', hideInProd: true },
  { id: 'citroen_c4' },
  { id: 'lancer_evo_6' },
  { id: 'ford_gt3' },
  { id: 'merc_190' },
];

export const STAGES_LIST: readonly ReleaseEntry[] = [
  { id: 'test' },
  { id: 'ajvatovci' },
  { id: 'petralica' },
  { id: 'jackie' },
  { id: 'galichica_west', hideInProd: true },
  { id: 'galichica_east', hideInProd: true },
  { id: 'prespa_ohrid', hideInProd: true },
];

/** Not released (`hideInProd`, or by mistake not listed) - shown with a TEST badge on the dev server. */
export const isTestCar = (id: string): boolean => !isReleased(CARS_LIST, id);
export const isTestStage = (id: string): boolean =>
  !isReleased(STAGES_LIST, id);
/** A map is a test map while none of its stages is released. */
export const isTestMap = (stageIds: readonly string[]): boolean =>
  !stageIds.some((id) => isReleased(STAGES_LIST, id));

/** Tooltip / note shown on test-only cars / stages (dev server only). */
export const TEST_NOTE = 'Test content - hidden in the release build';

/** Name for tool-page lists: "<name> · TEST" for test-only entries. */
export function listLabel(name: string, test: boolean): string {
  return test ? `${name} · TEST` : name;
}
