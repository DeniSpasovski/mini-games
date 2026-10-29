import { paramOneOf } from '../../shared/url-params';

/**
 * Weather of a run, picked on the stage screen beside Season and Time (`?weather=`). Dry is the default and every
 * stage's own; the others lay a look over the map's environment (engine/environment.ts `weatherEnv`), wet the
 * surfaces (engine/world-shading.ts `setWet`) and, in rain, add falling rain, tyre spray and rain audio
 * (game/rain.ts, game/rally-game.ts, game/audio.ts). Grip is not changed yet.
 */
export const WEATHERS = [
  'dry',
  'overcast',
  'rain_light',
  'rain_heavy',
  'post_rain',
] as const;
export type Weather = (typeof WEATHERS)[number];

/** Names in the stage screen's Weather dropdown. */
export const WEATHER_LABELS: Readonly<Record<Weather, string>> = {
  dry: 'Dry',
  overcast: 'Overcast',
  rain_light: 'Light rain',
  rain_heavy: 'Heavy rain',
  post_rain: 'After the rain',
};

/** What a weather does to the world (dry = all zero / one). */
export interface WeatherLook {
  /** Sky cloud cover 0..1 (null = the map's own). */
  clouds: number | null;
  /** A solid cloud deck: its grey overhead (linear; 0 = none, the sky's own clouds), `Environment` sky shader. */
  deck: number;
  /** Direct sun left under the clouds (x the map's sun). */
  sun: number;
  /** Visibility (m) in the air (null = the map's own haze). */
  visibility: number | null;
  /** How wet the surfaces are, 0..1 (darker porous ground, a water film on the road). */
  wet: number;
  /** Rain rate (mm/h; 0 = none falling): drop count, streak length, spray, rain audio. */
  rain: number;
}

/**
 * Starting values to tune by driving. Rain rates: meteorology calls under ~2.5 mm/h light and over ~7.6 mm/h heavy;
 * visibility in heavy rain ~300-800 m. Overcast and after the rain keep some sun through thin or breaking cloud.
 */
export const WEATHER_LOOKS: Readonly<Record<Weather, WeatherLook>> = {
  dry: { clouds: null, deck: 0, sun: 1, visibility: null, wet: 0, rain: 0 },
  overcast: {
    clouds: 0.9,
    deck: 1.6,
    sun: 0.3,
    visibility: 6000,
    wet: 0,
    rain: 0,
  },
  rain_light: {
    clouds: 1,
    deck: 1.2,
    sun: 0.12,
    visibility: 2000,
    wet: 0.7,
    rain: 2,
  },
  rain_heavy: {
    clouds: 1,
    deck: 0.9,
    sun: 0.06,
    visibility: 600,
    wet: 1,
    rain: 8,
  },
  post_rain: {
    clouds: 0.6,
    deck: 0,
    sun: 0.7,
    visibility: 4000,
    wet: 0.6,
    rain: 0,
  },
};

/** The weather a `?weather=` value names; dry when it is missing or unknown. */
export function weatherParam(raw: string | null | undefined): Weather {
  return paramOneOf(raw, WEATHERS, 'dry');
}
