import { paramOneOf } from '../../shared/url-params';
import { isReleased, RELEASE_BUILD } from '../../shared/release';
import { WEATHERS_LIST } from './release';

/**
 * Weather of a run, picked on the stage screen beside Season and Time (`?weather=`). Dry is the default and every
 * stage's own. A weather lays a look over the map's environment (engine/environment.ts `weatherEnv`), wets the
 * surfaces (engine/world-shading.ts `setWet`) and the grip (physics/car-tyres.ts `WET`), sets the air and road
 * temperatures (`weatherTemps`) and, in rain, adds falling rain, spray, splashes, drops on the lens and rain audio
 * (game/rain.ts, game/rally-game.ts, engine/post-fx.ts, game/audio.ts). Fog is a layer with a top (an inversion:
 * valley fog that clears as the road climbs out of it). A stage can retune any of it (`StageDef.weather`).
 */
export const WEATHERS = [
  'dry',
  'overcast',
  'pre_rain',
  'rain_light',
  'rain_heavy',
  'post_rain',
  'fog',
] as const;
export type Weather = (typeof WEATHERS)[number];

/** Names in the stage screen's Weather dropdown. */
export const WEATHER_LABELS: Readonly<Record<Weather, string>> = {
  dry: 'Dry',
  overcast: 'Overcast',
  pre_rain: 'Before the rain',
  rain_light: 'Light rain',
  rain_heavy: 'Heavy rain',
  post_rain: 'After the rain',
  fog: 'Fog',
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
  /** How wet the surfaces and the grip are, 0..1 (darker porous ground, a water film on the road, less grip). */
  wet: number;
  /** Rain rate (mm/h; 0 = none falling): drop count, streak length, spray, splashes, rain audio. */
  rain: number;
  /** Foliage sway and dust drift (x the map's wind). */
  wind: number;
  /** Air temperature change (deg C) from the stage's dry `temps`. */
  air: number;
  /** Share of the road's sun heating (its gap to the air) left under this sky, 0..1. */
  sunHeat: number;
  /** Relative humidity (%) the air holds at least (rain, fog); 0 = only what the season's dew point gives (`relativeHumidity`). */
  humidity: number;
  /**
   * A fog layer (an inversion): its top in metres above the stage start, the visibility inside it (m) and how damp it
   * leaves the ground below its top (0..1, the look; the grip stays dry). Null = none.
   */
  fog: { top: number; visibility: number; damp: number } | null;
}

/**
 * Starting values to tune by driving. Rain rates: meteorology calls under ~2.5 mm/h light and over ~7.6 mm/h heavy;
 * visibility in heavy rain ~300-800 m. Temperatures: under cloud the road sits near the air (no sun gap); rain cools the
 * air 3-6 deg C. Fog: Skopje's autumn inversion has its top ~420-460 m (Vodno's start is at 349 m), inside it
 * 100-200 m visibility (see the rain + fog plan).
 */
export const WEATHER_LOOKS: Readonly<Record<Weather, WeatherLook>> = {
  dry: {
    clouds: null,
    deck: 0,
    sun: 1,
    visibility: null,
    wet: 0,
    rain: 0,
    wind: 1,
    air: 0,
    sunHeat: 1,
    humidity: 0,
    fog: null,
  },
  overcast: {
    clouds: 0.9,
    deck: 1.6,
    sun: 0.3,
    visibility: 6000,
    wet: 0,
    rain: 0,
    wind: 1.2,
    air: -3,
    sunHeat: 0.2,
    humidity: 0,
    fog: null,
  },
  pre_rain: {
    clouds: 1,
    deck: 1.05,
    sun: 0.18,
    visibility: 3500,
    wet: 0,
    rain: 0,
    wind: 2,
    air: 0,
    sunHeat: 0.3,
    humidity: 70,
    fog: null,
  },
  rain_light: {
    clouds: 1,
    deck: 1.2,
    sun: 0.2,
    visibility: 2000,
    wet: 0.7,
    rain: 2,
    wind: 1.6,
    air: -4,
    sunHeat: 0,
    humidity: 90,
    fog: null,
  },
  rain_heavy: {
    clouds: 1,
    deck: 0.9,
    sun: 0,
    visibility: 250,
    wet: 1,
    rain: 8,
    wind: 1.6,
    air: -5,
    sunHeat: 0,
    humidity: 97,
    fog: null,
  },
  post_rain: {
    clouds: 0.6,
    deck: 0,
    sun: 0.7,
    visibility: 4000,
    wet: 0.6,
    rain: 0,
    wind: 1.2,
    air: -2,
    sunHeat: 0.5,
    humidity: 85,
    fog: null,
  },
  fog: {
    clouds: null,
    deck: 0,
    sun: 1,
    visibility: null,
    wet: 0,
    rain: 0,
    wind: 0.3,
    air: -1,
    sunHeat: 0.3,
    humidity: 100,
    fog: { top: 300, visibility: 150, damp: 0.25 },
  },
};

/** True for the weathers with rain falling. */
export const isRaining = (w: Weather): boolean => WEATHER_LOOKS[w].rain > 0;

/** The weathers this build offers: all on the dev server and test builds, the released ones (`WEATHERS_LIST`) in the release build. */
export function offeredWeathers(release = RELEASE_BUILD): Weather[] {
  return release
    ? WEATHERS.filter((w) => isReleased(WEATHERS_LIST, w))
    : [...WEATHERS];
}

/** The weather a `?weather=` value names; dry when it is missing, unknown or not offered in this build. */
export function weatherParam(
  raw: string | null | undefined,
  release = RELEASE_BUILD,
): Weather {
  return paramOneOf(raw, offeredWeathers(release), 'dry');
}

/** A stage's retuning of a weather (`StageDef.weather`): any field, the fog merged field by field. */
export type WeatherTuning = Partial<Omit<WeatherLook, 'fog'>> & {
  fog?: Partial<NonNullable<WeatherLook['fog']>>;
};

/** A weather's look on a stage: the defaults with the stage's own numbers over them. */
export function weatherLook(
  w: Weather,
  stage?: Partial<Record<Weather, WeatherTuning>>,
): WeatherLook {
  const base = WEATHER_LOOKS[w];
  const own = stage?.[w];
  if (!own) return base;
  return {
    ...base,
    ...own,
    fog: base.fog && { ...base.fog, ...own.fog },
  };
}

/** Relative humidity (%) of air at `air` deg C with dew point `dew` (Magnus formula), 0..100. */
export function relativeHumidity(air: number, dew: number): number {
  const e = (t: number) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.min(100, (100 * e(dew)) / e(air));
}

/**
 * Air and road temperature under a weather, from the stage's dry ones: the air `look.air` warmer / colder, the road
 * keeps `sunHeat` of its sun gap (a wet road sits at the air). In fog the air is held at the dew point `dew`.
 */
export function weatherTemps(
  t: { air: number; road: number },
  look: WeatherLook,
  dew = Infinity,
): { air: number; road: number } {
  // Fog only forms once the air has cooled to its dew point: it holds the air there.
  const air = Math.min(t.air + look.air, look.humidity >= 100 ? dew : Infinity);
  return { air, road: air + Math.max(0, t.road - t.air) * look.sunHeat };
}
