import { paramOneOf } from '../../shared/url-params';

/**
 * Season of a stage (visual: tree leaf colours, trees/seasons.ts; and the base air temperature,
 * maps/shared/climate.ts). `EnvironmentDef.season` sets a map's, `?season=spring|summer|autumn` tries the others.
 */
export const SEASONS = ['spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

/** The season of a map without `EnvironmentDef.season`: the leaf colours and temperatures it always had. */
export const DEFAULT_SEASON: Season = 'summer';

/** The season a `?season=` value names; `fallback` (the map's) when it is missing or unknown. */
export function seasonParam(
  raw: string | null | undefined,
  fallback: Season,
): Season {
  return paramOneOf(raw, SEASONS, fallback);
}
