import { sunAt } from '../../engine/environment';
import { climateFor, SUN_HEAT, type Climate } from '../../physics/tyre-temp';
import { DEFAULT_SEASON, type Season } from '../../season';
import type { EnvironmentDef } from './types';

/** How much cooler (°C) a season is than summer, for a map that gives `airTemp` only (`EnvironmentDef.airTemps` wins). */
export const SEASON_AIR_OFFSET: Readonly<Record<Season, number>> = {
  spring: -6,
  summer: 0,
  autumn: -5,
};

/** Season of a map as authored (`?season=` is applied by the game). */
export function mapSeason(env: EnvironmentDef): Season {
  return env.season ?? DEFAULT_SEASON;
}

/** Air temperature (°C) of a map in `season`: its `airTemps` entry, else `airTemp` moved from the map's season to this one. */
export function seasonAirTemp(
  env: EnvironmentDef,
  season: Season = mapSeason(env),
): number {
  return (
    env.airTemps?.[season] ??
    (env.airTemp ?? 20) +
      SEASON_AIR_OFFSET[season] -
      SEASON_AIR_OFFSET[mapSeason(env)]
  );
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

/**
 * How much the sun warms a dark, fully sun-heated road above the air (°C, clear noon sun) in `season`: the map's
 * `sunHeats` entry, else the summer figure (`SUN_HEAT`).
 */
export function seasonSunHeat(
  env: EnvironmentDef,
  season: Season = mapSeason(env),
): number {
  return env.sunHeats?.[season] ?? SUN_HEAT;
}

/**
 * Tyre-temperature climate of a stage (physics/tyre-temp.ts): the air temperature (`air`, else the season's), the sun
 * height (`timeOfDay` or `sunElevation`; pass the game's effective one after `?tod=`), the clouds and the sun heat of
 * the season (`season`, default the map's own).
 */
export function stageClimate(
  env: EnvironmentDef,
  sunElevation?: number,
  air?: number,
  season: Season = mapSeason(env),
): Climate {
  const elevation =
    sunElevation ??
    (env.timeOfDay !== undefined
      ? sunAt(env.timeOfDay).elevation
      : env.sunElevation);
  return climateFor(
    air ?? seasonAirTemp(env, season),
    elevation,
    env.cloudCoverage ?? 0.4,
    seasonSunHeat(env, season),
  );
}
