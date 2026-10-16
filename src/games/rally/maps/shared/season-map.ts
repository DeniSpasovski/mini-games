import { type Season } from '../../season';
import { mapSeason } from './climate';
import type { EnvironmentDef, GroundTint } from './types';

/** The ground tint of a map in `season`: its `groundTints` entry, else the map's own `groundTint`. */
export function groundTintFor(
  env: EnvironmentDef,
  season: Season,
): GroundTint | undefined {
  return env.groundTints?.[season] ?? env.groundTint;
}

/**
 * A map (or stage info) as it looks in `season`: a copy whose environment names that `season` and carries its ground
 * tint as `groundTint` (terrain, horizon and sky read that one field); the same object when it already is. The world
 * is built from this, so one world is one season (menu views and card bakes use it the same way).
 */
export function mapInSeason<T extends { environment: EnvironmentDef }>(
  map: T,
  season: Season,
): T {
  const env = map.environment;
  const tint = groundTintFor(env, season);
  if (tint === env.groundTint && mapSeason(env) === season) return map;
  return { ...map, environment: { ...env, season, groundTint: tint } };
}
