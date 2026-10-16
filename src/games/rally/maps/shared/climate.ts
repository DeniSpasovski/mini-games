import { NOON_ELEVATION, sunAt } from '../../engine/environment';
import { climateFor, type Climate } from '../../physics/tyre-temp';
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

/** Latitude (deg N) of the maps (North Macedonia, 41-42): sets how high the sun climbs in a season. */
const LATITUDE = 41.5;

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

/** Sun declination (deg) in the middle of a month (Cooper's formula, day of the year of the 15th). */
function declination(month: number): number {
  const day = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349][
    Math.min(12, Math.max(1, Math.round(month))) - 1
  ];
  return 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365);
}

/** Sine of the sun's height in `month` at the hour angle whose cosine is `cosH` (spherical astronomy). */
function sinSunHeight(month: number, cosH: number): number {
  const lat = (LATITUDE * Math.PI) / 180;
  const dec = (declination(month) * Math.PI) / 180;
  return Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * cosH;
}

/** Clear-sky sun on level ground (W/m2) for the sine of the sun's height (Haurwitz). */
function clearSkySun(sin: number): number {
  return sin <= 0.01 ? 0 : 1098 * sin * Math.exp(-0.057 / sin);
}

/**
 * Share (0..1) of the sun's heat a month brings at the drawn sun's `sunElevation`, against July (1): the drawn sun
 * path is one mid-summer day (`sunAt`), but in October the real sun stands about 30 deg lower at noon and sets earlier,
 * in April about 12 deg lower, so the road warms less above the air. The drawn height gives the hour angle
 * (sin height / `NOON_ELEVATION` = cos hour angle); the share is the ratio of the clear-sky sun on level ground
 * (Haurwitz) in the month to the one in July at that hour. Measured: a hot clear summer noon heats dark asphalt ~23 deg C
 * above the air at 41 N (Solaimanian and Kennedy, 1993), sunny days in a mild climate ~12 (Brisbane daytime means).
 */
export function seasonSunShare(month: number, sunElevation: number): number {
  const cosH = Math.min(1, Math.max(0, sunElevation / NOON_ELEVATION));
  const july = clearSkySun(sinSunHeight(DEFAULT_MONTHS.summer, cosH));
  return july > 0
    ? Math.min(1, clearSkySun(sinSunHeight(month, cosH)) / july)
    : 1;
}

/**
 * Tyre-temperature climate of a stage (physics/tyre-temp.ts): the air temperature (`air`, else the season's), the sun
 * height (`timeOfDay` or `sunElevation`; pass the game's effective one after `?tod=`), the clouds and the share of the
 * sun's heat of the season's month (`season`, default the map's own).
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
    seasonSunShare(seasonMonth(env, season), elevation),
  );
}
