import { ajvatovciMap } from './ajvatovci/map';
import { galichicaMap } from './galichica/map';
import { jackieMap } from './jackie/map';
import { petralicaMap } from './petralica/map';
import { testMap } from './test/map';
import { vodnoMap } from './vodno/map';
import type { MapDef, StageDef } from './shared/types';

/**
 * Every full `MapDef`, loaded eagerly - for tests and tools that need all the baked data at once. The game imports
 * `loadMap` from ./index.ts instead, which fetches one map's data on demand.
 */
export const ALL_MAPS: MapDef[] = [
  testMap,
  ajvatovciMap,
  petralicaMap,
  jackieMap,
  galichicaMap,
  vodnoMap,
];

/** Every stage of every map with its full map (tests: `new World(map, stage)` per stage). */
export const ALL_STAGE_DEFS: { map: MapDef; stage: StageDef }[] =
  ALL_MAPS.flatMap((map) => map.stages.map((stage) => ({ map, stage })));
