import { STAGES_LIST, released } from '../release';
import { ajvatovciInfo } from './ajvatovci/info';
import { galichicaInfo } from './galichica/info';
import { jackieInfo } from './jackie/info';
import { petralicaInfo } from './petralica/info';
import { testMap } from './test/map';
import { vodnoInfo } from './vodno/info';
import type { MapDef, MapInfo, StageDef, StageInfo } from './shared/types';

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

/** What the menus know about one stage of a map (the stage + the bits of its map they show). */
export function stageInfo(map: MapInfo, stage: StageDef): StageInfo {
  return {
    ...stage,
    map: map.id,
    mapName: map.name,
    bounds: map.bounds,
    previewRelief: map.previewRelief,
    environment: map.environment,
    credits: map.credits,
    geo: map.geo,
    surfaces: stage.reverse ? [...map.surfaces].reverse() : map.surfaces,
    route: stage.reverse ? [...map.route].reverse() : map.route,
    sources: [...(map.sources ?? []), ...(stage.sources ?? [])],
  };
}

interface MapEntry {
  info: MapInfo;
  load: () => Promise<MapDef>;
}

/**
 * Map registry - every map, test-only ones included. A map = its `MapInfo` (eager, small, with its stages) + a loader
 * for the full `MapDef` (a dynamic import: the baked data of a real map is its own chunk, fetched when one of its
 * stages is picked). Players pick STAGES; a map is the world they run on. Add a new map here and a `hideInProd` row
 * per stage to STAGES_LIST in release.ts (see .claude/skills/rally-maps).
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
  {
    info: galichicaInfo,
    load: async () => (await import('./galichica/map')).galichicaMap,
  },
  {
    info: vodnoInfo,
    load: async () => (await import('./vodno/map')).vodnoMap,
  },
];

/** Every map's info, test-only ones included. */
export const ALL_MAPS: MapInfo[] = ENTRIES.map((e) => e.info);

/** Every stage of every map (menu order = map order, then the map's stage order), test-only ones included. */
export const ALL_STAGES: StageInfo[] = ALL_MAPS.flatMap((m) =>
  m.stages.map((s) => stageInfo(m, s)),
);

/** Stages this build offers: ALL_STAGES on the dev server, those without `hideInProd` in the published build (release.ts). */
export const STAGES: StageInfo[] = released(ALL_STAGES, STAGES_LIST);

/** Maps with at least one stage this build offers (map viewer). */
export const MAPS: MapInfo[] = ALL_MAPS.filter((m) =>
  STAGES.some((s) => s.map === m.id),
);

/** Must be a released stage (it's the fallback for hidden / unknown ids). */
export const DEFAULT_STAGE = 'test';

/**
 * An available stage's info; hidden (test-only in the published build) or unknown ids fall back to the default. A
 * map id resolves to the map's first available stage (old `?map=<id>` links: every old map id is also its stage's id).
 */
export function getStage(id: string): StageInfo {
  return (
    STAGES.find((s) => s.id === id) ??
    STAGES.find((s) => s.map === id) ??
    STAGES.find((s) => s.id === DEFAULT_STAGE) ??
    ALL_STAGES[0]
  );
}

/** An available map's info (unknown / hidden: the default stage's map). A stage id resolves to its map. */
export function getMapInfo(id: string): MapInfo {
  return (
    MAPS.find((m) => m.id === id) ??
    ALL_MAPS.find((m) => m.id === getStage(id).map)!
  );
}

/** The stages of a map this build offers. */
export function stagesOf(mapId: string): StageInfo[] {
  return STAGES.filter((s) => s.map === mapId);
}

const loading = new Map<string, Promise<MapDef>>();

/**
 * The full definition of an available map (`getMapInfo` fallback), loaded on first use and cached per MAP: every stage
 * of a map shares it. Everything that builds a world awaits this (or `loadStage`); menus only need `getStage`.
 */
export function loadMap(id: string): Promise<MapDef> {
  const info = getMapInfo(id);
  let p = loading.get(info.id);
  if (!p) {
    p = ENTRIES.find((e) => e.info.id === info.id)!.load();
    loading.set(info.id, p);
  }
  return p;
}

/** A stage (`getStage` fallback) with its full map: `new World(map, stage)`. */
export async function loadStage(
  id: string,
): Promise<{ map: MapDef; stage: StageDef }> {
  const info = getStage(id);
  const map = await loadMap(info.map);
  return { map, stage: map.stages.find((s) => s.id === info.id)! };
}

/**
 * Game links from before maps had several stages say `map=<id>`: the same parameters with `stage=<id>` in its place
 * (every other parameter kept in order), or null when there is nothing to rewrite. An old map id is its stage's id
 * (`ajvatovci` -> `ajvatovci`); a map with several stages opens its first one (`galichica` -> `galichica_west`). A link
 * with both keeps its `stage` and drops `map`.
 */
export function stageLinkParams(
  params: URLSearchParams,
): URLSearchParams | null {
  const old = params.get('map');
  if (old === null) return null;
  const out = new URLSearchParams();
  for (const [k, v] of params) {
    if (k !== 'map') out.append(k, v);
    else if (!params.has('stage')) out.append('stage', getStage(old).id);
  }
  return out;
}
