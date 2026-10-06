import { ajvatovciMap } from './ajvatovci/map';
import { jackieMap } from './jackie/map';
import { petralicaMap } from './petralica/map';
import { testMap } from './test/map';
import type { MapDef } from './shared/types';

/**
 * Every full `MapDef`, loaded eagerly - for tests and tools that need all the baked data at once. The game imports
 * `loadMap` from ./index.ts instead, which fetches one map's data on demand.
 */
export const ALL_MAPS: MapDef[] = [
  testMap,
  ajvatovciMap,
  petralicaMap,
  jackieMap,
];
