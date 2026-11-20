import {
  crew,
  driver,
  marshal,
  mechanic,
  photographer,
  spectator,
  visitor,
} from './builders/people';
import type { AssetBuilder } from './types';

/** The assets with detailed levels built in the worker (people-worker.ts, people-pool.ts). */
export const PEOPLE_BUILDERS: Record<string, AssetBuilder> = {
  spectator,
  mechanic,
  crew,
  driver,
  marshal,
  photographer,
  visitor,
};
