import { describe, expect, test } from '@rstest/core';
import { STAGES } from '../../src/games/rally/maps';
import {
  seasonAirTemp,
  stageClimate,
} from '../../src/games/rally/maps/shared/climate';
import {
  airAtHour,
  stageTemps,
} from '../../src/games/rally/maps/shared/day-temperature';
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
    const env = STAGES.find(
      (s) => s.environment.timeOfDay === undefined,
    )!.environment;
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
