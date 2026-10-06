import { AVAILABLE_MAPS, released } from '../release';
import { ajvatovciInfo } from './ajvatovci/info';
import { jackieInfo } from './jackie/info';
import { petralicaInfo } from './petralica/info';
import { testMap } from './test/map';
import type { MapDef, MapInfo } from './shared/types';

/** The light `MapInfo` of a full map (small maps whose whole definition is always loaded). */
export function infoOf(map: MapDef): MapInfo {
  return {
    ...map,
    route: map.road.points.map((p) =>
      Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z],
    ),
    surfaces: [
      map.road.surface,
      ...(map.road.sections ?? []).map((s) => s.surface),
    ],
  };
}

interface MapEntry {
  info: MapInfo;
  load: () => Promise<MapDef>;
}

/**
 * Map registry - every map, test-only ones included. A map = its `MapInfo` (eager, small) + a loader for the full
 * `MapDef` (a dynamic import: the baked data of a real map is its own chunk, fetched when the map is picked).
 * Add new maps here + their id to TEST_MAPS in release.ts (see .claude/skills/rally-maps).
 */
const ENTRIES: MapEntry[] = [
  { info: infoOf(testMap), load: async () => testMap },
  {
    info: ajvatovciInfo,
    load: async () => (await import('./ajvatovci/map')).ajvatovciMap,
  },
  {
    info: petralicaInfo,
    load: async () => (await import('./petralica/map')).petralicaMap,
  },
  {
    info: jackieInfo,
    load: async () => (await import('./jackie/map')).jackieMap,
  },
];

/** Every map's info, test-only ones included. */
export const ALL_MAPS: MapInfo[] = ENTRIES.map((e) => e.info);

/** Maps this build offers: ALL_MAPS on the dev server, AVAILABLE_MAPS in the published build (release.ts). */
export const MAPS: MapInfo[] = released(ALL_MAPS, AVAILABLE_MAPS);

/** Must be a released map (it's the fallback for hidden / unknown ids). */
export const DEFAULT_MAP = testMap.id;

/** An available map's info; hidden (test-only in the published build) or unknown ids fall back to the default. */
export function getMap(id: string): MapInfo {
  return MAPS.find((m) => m.id === id) ?? ALL_MAPS[0];
}

const loading = new Map<string, Promise<MapDef>>();

/**
 * The full definition of an available map (same fallback as `getMap`), loaded on first use and cached. Everything that
 * builds a world (`new World(def)`) awaits this; menus only need `getMap`.
 */
export function loadMap(id: string): Promise<MapDef> {
  const info = getMap(id);
  let p = loading.get(info.id);
  if (!p) {
    p = ENTRIES.find((e) => e.info.id === info.id)!.load();
    loading.set(info.id, p);
  }
  return p;
}
