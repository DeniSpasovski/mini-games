/**
 * Release flags: which cars / maps ship in the published build - the ONLY place to change this.
 *
 * Every car / map registered in `cars/index.ts` / `maps/index.ts` is listed here exactly once:
 * - `TEST_*`      work in progress - a NEW car / map goes here first. Dev server only (`npm run dev`
 *                 uses ALL_CARS / ALL_MAPS), marked TEST in the menus, tool pages and in-game HUD.
 * - `AVAILABLE_*` released - in the published build (`npm run build` / `npm run preview`).
 * Moving an id from TEST_* to AVAILABLE_* releases it, so small fixes can ship while a big new map or
 * car is still unfinished.
 *
 * Ids = `CarDef.id` / `MapDef.id`; tests/rally/release.test.ts checks every registered id is in
 * exactly one list. DOM-free (the registries are imported by the node tests).
 */

/** Cars in the published build. */
export const AVAILABLE_CARS: readonly string[] = [
  'skoda_rally',
  'zastava_101',
  'bimmer_m3',
];

/** Cars on the dev server only. */
export const TEST_CARS: readonly string[] = [];

/** Maps in the published build. */
export const AVAILABLE_MAPS: readonly string[] = [
  'test',
  'ajvatovci',
  'petralica',
];

/** Maps on the dev server only. */
export const TEST_MAPS: readonly string[] = ['jackie'];

/** true on the dev server (everything available), false in the published build. */
export const SHOW_TEST_CONTENT: boolean = import.meta.env.DEV;

/** Not released (in TEST_* or, by mistake, in no list) - shown with a TEST badge on the dev server. */
export const isTestCar = (id: string): boolean => !AVAILABLE_CARS.includes(id);
export const isTestMap = (id: string): boolean => !AVAILABLE_MAPS.includes(id);

/** The registry entries this build offers: the whole registry on the dev server, else AVAILABLE_* (registry order). */
export function released<T extends { id: string }>(
  all: readonly T[],
  available: readonly string[],
  showTest = SHOW_TEST_CONTENT,
): T[] {
  return showTest ? [...all] : all.filter((d) => available.includes(d.id));
}

/** Tooltip / note shown on test-only cars / maps (dev server only). */
export const TEST_NOTE = 'Test model - hidden in the published build';

/** Name for tool-page lists: "<name> · TEST" for test-only entries. */
export function listLabel(name: string, test: boolean): string {
  return test ? `${name} · TEST` : name;
}
