import { SURFACES } from '../../physics/surfaces';
import { airAtRise, type Climate } from '../../physics/tyre-temp';
import { TIMES_OF_DAY, slotFor, type TimeOfDay } from '../../game/time-of-day';
import type { Season } from '../../season';
import { stageSeason } from './climate';
import {
  relativeHumidity,
  weatherLook,
  weatherTemps,
  type Weather,
} from '../../weather';
import type { StageInfo } from './types';

/** What the temperatures need of a stage. */
export type TempStage = Pick<
  StageInfo,
  'temps' | 'surfaces' | 'environment' | 'season' | 'slotHours'
> &
  Partial<Pick<StageInfo, 'weather'>>;

/**
 * The hour a time-of-day slot means on a stage: the stage's own slot keeps the stage's exact default hour, else the
 * stage's `slotHours` entry, else the slot's own hour (game/time-of-day.ts).
 */
export function slotHour(
  stage: Pick<StageInfo, 'environment' | 'slotHours'>,
  t: TimeOfDay,
): number {
  const own = stage.environment.timeOfDay;
  if (own !== undefined && slotFor(own).id === t.id) return own;
  return stage.slotHours?.[t.id] ?? t.hour;
}

/**
 * Air and road temperature (deg C) of a stage at `hour` in `season` (default: the one the stage opens in): the stage's predefined
 * `temps` at the slot hours (`slotHour`), blended in a straight line between the neighbouring slots for any other hour
 * (`?tod=`), round the clock. The road is the stage's first surface. The table holds at the stage start (its lowest
 * point); `rise` metres higher both fall with the height (`AIR_LAPSE`, the car does the same in `Vehicle.setClimate`).
 * `weather` (default dry) cools the air and takes the sun off the road (`weatherTemps`).
 */
export function stageTemps(
  stage: TempStage,
  hour: number | undefined,
  season: Season = stageSeason(stage),
  rise = 0,
  weather: Weather = 'dry',
): { air: number; road: number } {
  const own = stage.environment.timeOfDay;
  const table = stage.temps[season];
  const keys = TIMES_OF_DAY.map((t) => ({
    hour: slotHour(stage, t),
    at: table[t.id],
  })).sort((a, b) => a.hour - b.hour);
  let h = (hour ?? own ?? 12) % 24;
  if (h < 0) h += 24;
  const next = keys.find((k) => k.hour > h) ?? {
    hour: keys[0].hour + 24,
    at: keys[0].at,
  };
  const prev = [...keys].reverse().find((k) => k.hour <= h) ?? {
    hour: keys[keys.length - 1].hour - 24,
    at: keys[keys.length - 1].at,
  };
  const f = (h - prev.hour) / (next.hour - prev.hour);
  const mix = (i: 0 | 1) => prev.at[i] + (next.at[i] - prev.at[i]) * f;
  const dry = { air: mix(0), road: mix(1) };
  // Dry keeps the table as is (a road colder than the air at night would be lifted to it by `weatherTemps`).
  const t =
    weather === 'dry'
      ? dry
      : weatherTemps(
          dry,
          weatherLook(weather, stage.weather),
          DEW_POINT[season],
        );
  return { air: airAtRise(t.air, rise), road: airAtRise(t.road, rise) };
}

/**
 * Dew point (deg C) of the air in each season, the same all day (the humidity falls as the day warms): Skopje's monthly
 * means (January ~0 deg C at ~80 %, April ~12 deg C at ~63 %, July ~24 deg C at ~50 %, October ~13 deg C at ~73 %).
 */
export const DEW_POINT: Readonly<Record<Season, number>> = {
  spring: 5,
  summer: 13,
  autumn: 8,
};

/** Relative humidity (%) on a stage, as `stageTemps`: from the season's dew point, at least the weather's own. */
export function stageHumidity(
  stage: TempStage,
  hour: number | undefined,
  season: Season = stageSeason(stage),
  rise = 0,
  weather: Weather = 'dry',
): number {
  const t = stageTemps(stage, hour, season, rise, weather);
  return Math.max(
    weatherLook(weather, stage.weather).humidity,
    relativeHumidity(t.air, DEW_POINT[season]),
  );
}

/**
 * Tyre-temperature climate of a stage (physics/tyre-temp.ts) at `hour` (the game's effective one after `?tod=`; default
 * the stage's own) in `season`: the air (`air` overrides it, `?air=`) and how much the sun warms a fully sun-heated
 * surface above it - the road's gap to the air, scaled back from the stage's first surface to `heat` 1. Under `weather`.
 */
export function stageClimate(
  stage: TempStage,
  hour?: number,
  season?: Season,
  air?: number,
  weather: Weather = 'dry',
): Climate {
  const t = stageTemps(stage, hour, season, 0, weather);
  const heat = SURFACES[stage.surfaces[0] ?? 'tarmac'].heat;
  return {
    air: air ?? t.air,
    sun: heat > 0.05 ? Math.max(0, t.road - t.air) / heat : 0,
  };
}
