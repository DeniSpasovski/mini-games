import { describe, expect, test } from '@rstest/core';
import { STAGES } from '../../src/games/rally/maps';
import {
  MONTH_NAMES,
  seasonMonth,
  stageSeason,
} from '../../src/games/rally/maps/shared/climate';
import {
  slotHour,
  stageClimate,
  stageTemps,
} from '../../src/games/rally/maps/shared/day-temperature';
import { TIMES_OF_DAY, slotFor } from '../../src/games/rally/game/time-of-day';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import { AIR_LAPSE, trackTemp } from '../../src/games/rally/physics/tyre-temp';
import { SEASONS } from '../../src/games/rally/season';

const timed = STAGES.filter((s) => s.environment.timeOfDay !== undefined);

describe('air and road temperature of a stage (predefined)', () => {
  test('every season and time of day gives exactly the stage table at the slot hour', () => {
    for (const s of timed)
      for (const season of SEASONS)
        for (const slot of TIMES_OF_DAY) {
          const hour = slotHour(s, slot);
          const t = stageTemps(s, hour, season);
          expect([t.air, t.road]).toEqual([...s.temps[season][slot.id]]);
        }
  });

  test("the stage's own slot sits at its own hour (the default look)", () => {
    for (const s of timed) {
      const own = s.environment.timeOfDay!;
      const slot = slotFor(own);
      expect(slotHour(s, slot)).toBe(own);
      const t = stageTemps(s, undefined);
      expect([t.air, t.road]).toEqual([...s.temps[stageSeason(s)][slot.id]]);
    }
  });

  test("a stage's slotHours move a slot, the own slot stays at its own hour", () => {
    const vodno = STAGES.find((s) => s.id === 'vodno')!;
    const [early, midday, afternoon] = ['early', 'midday', 'afternoon'].map(
      (id) => TIMES_OF_DAY.find((t) => t.id === id)!,
    );
    expect(slotHour(vodno, early)).toBe(8);
    // Vodno opens at 10:00, its own slot: mid day.
    expect(slotHour(vodno, midday)).toBe(10);
    expect(slotHour(vodno, afternoon)).toBe(afternoon.hour);
    // The table cell sits at the moved hour.
    const t = stageTemps(vodno, 8, 'summer');
    expect([t.air, t.road]).toEqual([...vodno.temps.summer.early]);
    // A stage without slotHours uses the game's hours.
    const jackie = STAGES.find((s) => s.id === 'jackie')!;
    expect(slotHour(jackie, TIMES_OF_DAY[1])).toBe(TIMES_OF_DAY[1].hour);
  });

  test('the table holds at the stage start, higher up the air and the road fall 6.5 K per km', () => {
    for (const s of timed)
      for (const season of SEASONS) {
        const start = stageTemps(s, undefined, season);
        const top = stageTemps(s, undefined, season, 530);
        expect(start.air - top.air).toBeCloseTo(AIR_LAPSE * 530, 9);
        expect(start.road - top.road).toBeCloseTo(AIR_LAPSE * 530, 9);
      }
  });

  test('other hours blend the neighbouring slots, round the clock', () => {
    const s = STAGES.find((x) => x.id === 'ajvatovci')!;
    const day = s.temps.summer;
    // 13:45 is half way between mid day (12:00) and the afternoon (15:30).
    const mid = stageTemps(s, 13.75, 'summer');
    expect(mid.air).toBeCloseTo((day.midday[0] + day.afternoon[0]) / 2, 9);
    expect(mid.road).toBeCloseTo((day.midday[1] + day.afternoon[1]) / 2, 9);
    // 13:00 -> 24 -> 01:00: evening to night wraps past midnight.
    const late = stageTemps(s, 21.25, 'summer');
    const evening = stageTemps(s, 17.5, 'summer');
    const night = stageTemps(s, 1, 'summer');
    expect(late.air).toBeLessThan(evening.air);
    expect(late.air).toBeGreaterThan(night.air);
    // Hours are on a 24 h clock.
    expect(stageTemps(s, 25.75, 'summer').air).toBeCloseTo(
      stageTemps(s, 1.75, 'summer').air,
      9,
    );
  });

  test('the road is as cold as the air at night and hotter than it in the sun', () => {
    for (const s of timed) {
      for (const season of SEASONS) {
        const night = stageTemps(
          s,
          TIMES_OF_DAY.find((t) => t.id === 'night')!.hour,
          season,
        );
        const noon = stageTemps(s, 12, season);
        expect(night.road).toBe(night.air);
        expect(noon.road).toBeGreaterThan(noon.air + 4);
      }
    }
  });

  test('colder at night than in the afternoon, a season moves the whole day', () => {
    for (const s of timed) {
      for (const season of SEASONS) {
        const t = s.temps[season];
        expect(t.night[0]).toBeLessThan(t.afternoon[0] - 6);
        expect(t.early[0]).toBeLessThanOrEqual(t.afternoon[0]);
      }
      expect(s.temps.spring.midday[0]).toBeLessThan(s.temps.summer.midday[0]);
      expect(s.temps.autumn.midday[0]).toBeLessThan(s.temps.summer.midday[0]);
    }
  });

  test('the sun heat is the road gap scaled to the surface; ?air= keeps it', () => {
    for (const s of timed) {
      const surface = SURFACES[s.surfaces[0] ?? 'tarmac'];
      for (const hour of [7.5, 12, 15.5]) {
        const t = stageTemps(s, hour, 'summer');
        const c = stageClimate(s, hour, 'summer');
        expect(c.air).toBe(t.air);
        // The first surface's track temperature is the table's road.
        expect(trackTemp(c, surface)).toBeCloseTo(t.road, 9);
        expect(stageClimate(s, hour, 'summer', 3).sun).toBe(c.sun);
      }
    }
  });
});

describe('months', () => {
  test("each map's months are real months, one per season", () => {
    for (const s of STAGES) {
      for (const season of SEASONS) {
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
});

describe('road heating by season (researched)', () => {
  test('a clear summer noon heats the road 10-25 deg C above the air (gravel less than tarmac), the lower autumn sun less', () => {
    // Measured: ~23 deg C at 41 N on a hot clear day (Solaimanian and Kennedy 1993); monthly daily-maximum surface minus
    // air at MnROAD (Minnesota) ~26 in July and ~9 in October.
    for (const s of timed) {
      const gap = (season: 'spring' | 'summer' | 'autumn') => {
        const t = stageTemps(s, 12, season);
        return t.road - t.air;
      };
      expect(gap('summer')).toBeGreaterThanOrEqual(10);
      expect(gap('summer')).toBeLessThan(25);
      expect(gap('autumn')).toBeLessThan(gap('summer'));
      expect(gap('autumn')).toBeLessThan(16);
    }
  });
});
