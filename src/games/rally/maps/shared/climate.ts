import { sunAt } from '../../engine/environment';
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

/**
 * Tyre-temperature climate of a stage (physics/tyre-temp.ts): the air temperature (`air`, else the map's for `season`),
 * the sun height (`timeOfDay` or `sunElevation`; pass the game's effective one after `?tod=`) and the clouds.
 */
export function stageClimate(
  env: EnvironmentDef,
  sunElevation?: number,
  air?: number,
  season?: Season,
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
  );
}
