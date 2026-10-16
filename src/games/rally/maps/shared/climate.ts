import { DEFAULT_SEASON, type Season } from '../../season';
import type { EnvironmentDef } from './types';

/** Season of a map as authored (`?season=` is applied by the game). */
export function mapSeason(env: EnvironmentDef): Season {
  return env.season ?? DEFAULT_SEASON;
}

/** Month (1-12) a season is driven in unless `EnvironmentDef.months` says otherwise. */
export const DEFAULT_MONTHS: Readonly<Record<Season, number>> = {
  spring: 4,
  summer: 7,
  autumn: 10,
};
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Month (1-12) a map is driven in `season` (default the map's own). */
export function seasonMonth(
  env: EnvironmentDef,
  season: Season = mapSeason(env),
): number {
  return env.months?.[season] ?? DEFAULT_MONTHS[season];
}
