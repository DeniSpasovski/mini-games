import { AVAILABLE_MAPS, released } from '../release';
import { ajvatovciMap } from './ajvatovci/map';
import { jackieMap } from './jackie/map';
import { petralicaMap } from './petralica/map';
import { testMap } from './test/map';
import type { MapDef } from './shared/types';

/** Map registry - every map, test-only ones included. Add new maps here + their id to TEST_MAPS in release.ts (see .claude/skills/rally-maps). */
export const ALL_MAPS: MapDef[] = [
  testMap,
  ajvatovciMap,
  petralicaMap,
  jackieMap,
];

/** Maps this build offers: ALL_MAPS on the dev server, AVAILABLE_MAPS in the published build (release.ts). */
export const MAPS: MapDef[] = released(ALL_MAPS, AVAILABLE_MAPS);

/** Must be a released map (it's the fallback for hidden / unknown ids). */
export const DEFAULT_MAP = testMap.id;

/** An available map; hidden (test-only in the published build) or unknown ids fall back to the default. */
export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? testMap;
}
