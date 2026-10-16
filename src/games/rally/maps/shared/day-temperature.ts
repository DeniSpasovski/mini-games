import { sunAt } from '../../engine/environment';
import { isNightHour, NIGHT_SUN_ELEVATION } from '../../engine/night';
import { SURFACES, type SurfaceId } from '../../physics/surfaces';
import { trackTemp } from '../../physics/tyre-temp';
import type { Season } from '../../season';
import { seasonAirTemp, stageClimate } from './climate';
import type { EnvironmentDef } from './types';

/** Half the air temperature swing over a day (deg C): coldest about 03:00, warmest about 15:00. */
const DAY_SWING = 6;
const swing = (hour: number): number =>
  DAY_SWING * Math.cos(((hour - 15) / 24) * 2 * Math.PI);

/**
 * Air temperature (deg C) at `hour` on a map in `season` (default: the map's): its `seasonAirTemp` at its own
 * `timeOfDay` (so the default look keeps the numbers it always had), warmer in the afternoon, cooler at night. No hour or
 * no `timeOfDay`: the plain `seasonAirTemp`.
 */
export function airAtHour(
  env: EnvironmentDef,
  hour: number | undefined,
  season?: Season,
): number {
  const base = seasonAirTemp(env, season);
  if (hour === undefined || env.timeOfDay === undefined) return base;
  return base + swing(hour) - swing(env.timeOfDay);
}

/** Sun height (deg) at an hour as the game draws it: `sunAt`, below the horizon at night. */
export function sunElevationAt(hour: number): number {
  return isNightHour(hour) ? NIGHT_SUN_ELEVATION : sunAt(hour).elevation;
}

/**
 * Air and road temperature (deg C) of a stage at `hour` - what the stage screen shows and the tyres run with
 * (`RallyGame` uses `airAtHour` + `stageClimate` the same way). `surface` = the road surface to report.
 */
export function stageTemps(
  env: EnvironmentDef,
  hour: number,
  surface: SurfaceId,
  season?: Season,
): { air: number; road: number } {
  const air = airAtHour(env, hour, season);
  const climate = stageClimate(env, sunElevationAt(hour), air, season);
  return { air, road: trackTemp(climate, SURFACES[surface]) };
}
