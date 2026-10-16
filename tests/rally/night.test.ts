import { describe, expect, test } from '@rstest/core';
import {
  isNightHour,
  moonAt,
  NIGHT_FROM,
  NIGHT_UNTIL,
} from '../../src/games/rally/engine/night';
import { sunAt } from '../../src/games/rally/engine/environment';

describe('night hours', () => {
  test('the day keeps the sun, the small hours switch to the moon', () => {
    for (const h of [5, 6, 8, 12, 16.5, 18, 19])
      expect(isNightHour(h)).toBe(false);
    for (const h of [20, 22, 0, 1, 3, 4.5, 24, 25])
      expect(isNightHour(h)).toBe(true);
  });

  test('night starts after the sun clamp (golden hour stays a day look)', () => {
    expect(NIGHT_FROM).toBeGreaterThan(18);
    expect(NIGHT_UNTIL).toBeLessThan(6);
  });

  test('the moon stays above the horizon all night and moves east to west', () => {
    let last = Infinity;
    for (const h of [20, 22, 0, 2, 4]) {
      const m = moonAt(h);
      expect(m.elevation).toBeGreaterThanOrEqual(8);
      expect(m.elevation).toBeLessThanOrEqual(42);
      // Azimuth (from +Z towards +X): east is 90, falling to the west (270 = -90).
      const az = m.azimuth > 180 ? m.azimuth - 360 : m.azimuth;
      expect(az).toBeLessThan(last);
      last = az;
    }
  });

  test('sunAt is unchanged for daylight hours', () => {
    expect(sunAt(12).elevation).toBeCloseTo(58, 5);
    expect(sunAt(6).elevation).toBe(2);
  });
});
