import { describe, expect, test } from '@rstest/core';
import { STAGES } from '../../src/games/rally/maps';
import {
  seasonAirTemp,
  seasonMonth,
  seasonSunHeat,
  stageClimate,
} from '../../src/games/rally/maps/shared/climate';
import {
  airAtHour,
  stageTemps,
  sunElevationAt,
} from '../../src/games/rally/maps/shared/day-temperature';
import { MONTH_NAMES } from '../../src/games/rally/maps/shared/climate';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import { trackTemp } from '../../src/games/rally/physics/tyre-temp';
import { TIMES_OF_DAY } from '../../src/games/rally/game/time-of-day';

const timed = STAGES.filter((s) => s.environment.timeOfDay !== undefined);
const at = (id: string) => TIMES_OF_DAY.find((t) => t.id === id)!.hour;

describe('air and road temperature through the day', () => {
  test("a stage's own hour keeps the air temperature it always had", () => {
    for (const s of timed) {
      const env = s.environment;
      expect(airAtHour(env, env.timeOfDay)).toBeCloseTo(seasonAirTemp(env), 9);
      const t = stageTemps(env, env.timeOfDay!, s.surfaces[0]);
      const old = trackTemp(stageClimate(env), SURFACES[s.surfaces[0]]);
      // The default look runs the same climate as before (sun height from `sunAt`).
      expect(t.road).toBeCloseTo(old, 6);
    }
  });

  test('no time of day, no change', () => {
    const env = { ...timed[0].environment, timeOfDay: undefined };
    expect(airAtHour(env, 3)).toBe(seasonAirTemp(env));
    expect(airAtHour(timed[0].environment, undefined)).toBe(
      seasonAirTemp(timed[0].environment),
    );
  });

  test('colder at night, warmest in the afternoon', () => {
    for (const s of timed) {
      const air = (id: string) => airAtHour(s.environment, at(id));
      expect(air('night')).toBeLessThan(air('early') + 0.01);
      expect(air('afternoon')).toBeGreaterThan(air('midday'));
      expect(air('afternoon')).toBeGreaterThan(air('night') + 8);
    }
  });

  test('the road is as cold as the air at night and hotter than it in the sun', () => {
    for (const s of timed) {
      const surface = s.surfaces[0];
      const night = stageTemps(s.environment, at('night'), surface);
      const noon = stageTemps(s.environment, at('midday'), surface);
      expect(night.road).toBeCloseTo(night.air, 9);
      expect(noon.road).toBeGreaterThan(noon.air + 5);
    }
  });
});

describe('air and road temperature by season', () => {
  test('a season moves the whole day: its own temperature at the stage hour, same swing', () => {
    for (const s of timed) {
      const env = s.environment;
      for (const season of ['spring', 'summer', 'autumn'] as const) {
        expect(airAtHour(env, env.timeOfDay, season)).toBeCloseTo(
          seasonAirTemp(env, season),
          9,
        );
        expect(
          airAtHour(env, at('night'), season) -
            airAtHour(env, at('afternoon'), season),
        ).toBeCloseTo(
          airAtHour(env, at('night')) - airAtHour(env, at('afternoon')),
          9,
        );
      }
      const spring = stageTemps(env, env.timeOfDay!, s.surfaces[0], 'spring');
      const summer = stageTemps(env, env.timeOfDay!, s.surfaces[0], 'summer');
      expect(spring.air).toBeLessThan(summer.air);
      expect(spring.road).toBeLessThan(summer.road);
    }
  });
});

describe('road heating by season (researched per map)', () => {
  const season3 = ['spring', 'summer', 'autumn'] as const;

  test('summer keeps the full sun heat; spring and autumn are lower, October lowest', () => {
    for (const s of STAGES) {
      const env = s.environment;
      expect(seasonSunHeat(env, 'summer')).toBe(24);
      for (const season of ['spring', 'autumn'] as const)
        expect(seasonSunHeat(env, season)).toBeLessThan(24);
      expect(seasonSunHeat(env, 'autumn')).toBeLessThanOrEqual(
        seasonSunHeat(env, 'spring'),
      );
    }
  });

  test("each map's months are real months, one per season", () => {
    for (const s of STAGES) {
      for (const season of season3) {
        const m = seasonMonth(s.environment, season);
        expect(Number.isInteger(m) && m >= 1 && m <= 12).toBe(true);
        expect(MONTH_NAMES[m - 1]).toBeTruthy();
      }
    }
    const jackie = STAGES.find((s) => s.id === 'jackie')!.environment;
    const ajvatovci = STAGES.find((s) => s.id === 'ajvatovci')!.environment;
    expect(MONTH_NAMES[seasonMonth(jackie, 'spring') - 1]).toBe('May');
    expect(MONTH_NAMES[seasonMonth(ajvatovci, 'spring') - 1]).toBe('April');
  });

  test('a clear summer noon heats tarmac ~20 deg C above the air, an October morning ~5', () => {
    // Measured: ~23 deg C at 41 N on a hot clear day (Solaimanian and Kennedy 1993); monthly daily-maximum surface minus
    // air at MnROAD (Minnesota) ~26 in July and ~9 in October.
    const ajv = STAGES.find((s) => s.id === 'ajvatovci')!.environment;
    const noon = stageTemps(ajv, at('midday'), 'tarmac', 'summer');
    expect(noon.road - noon.air).toBeGreaterThan(19);
    expect(noon.road - noon.air).toBeLessThan(25);
    const gal = STAGES.find((s) => s.id === 'galichica_west')!.environment;
    const morning = stageTemps(gal, 9, 'tarmac', 'autumn');
    expect(morning.road - morning.air).toBeGreaterThan(3);
    expect(morning.road - morning.air).toBeLessThan(8);
    const autumnNoon = stageTemps(gal, at('midday'), 'tarmac', 'autumn');
    expect(autumnNoon.road - autumnNoon.air).toBeLessThan(10);
  });
});
