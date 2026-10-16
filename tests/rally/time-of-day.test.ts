import { describe, expect, test } from '@rstest/core';
import { sunAt } from '../../src/games/rally/engine/environment';
import { isNightHour } from '../../src/games/rally/engine/night';
import {
  formatHour,
  slotFor,
  TIMES_OF_DAY,
} from '../../src/games/rally/game/time-of-day';
import { STAGES } from '../../src/games/rally/maps';

describe('times of day', () => {
  test('five slots in clock order, night last', () => {
    expect(TIMES_OF_DAY.map((t) => t.id)).toEqual([
      'early',
      'midday',
      'afternoon',
      'evening',
      'night',
    ]);
    const hours = TIMES_OF_DAY.slice(0, -1).map((t) => t.hour);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
  });

  test('only the night slot is dark; the others keep the sun above the horizon', () => {
    for (const t of TIMES_OF_DAY) {
      expect(isNightHour(t.hour)).toBe(t.id === 'night');
      if (t.id !== 'night') expect(sunAt(t.hour).elevation).toBeGreaterThan(5);
    }
  });

  test('evening is the low sun, mid day the high one', () => {
    const el = (id: string) =>
      sunAt(TIMES_OF_DAY.find((t) => t.id === id)!.hour).elevation;
    expect(el('midday')).toBeGreaterThan(el('afternoon'));
    expect(el('afternoon')).toBeGreaterThan(el('early'));
    expect(el('early')).toBeGreaterThan(el('evening'));
  });

  test('an hour is labelled by the closest slot, round the clock', () => {
    expect(slotFor(8).id).toBe('early');
    expect(slotFor(9).id).toBe('early');
    expect(slotFor(16.5).id).toBe('afternoon');
    expect(slotFor(19).id).toBe('evening');
    expect(slotFor(22).id).toBe('night');
    expect(slotFor(23.5).id).toBe('night');
    expect(slotFor(4).id).toBe('night');
    expect(slotFor(25).id).toBe('night');
  });

  test('hours print as 24 h clock times', () => {
    expect(formatHour(7)).toBe('07:00');
    expect(formatHour(15.5)).toBe('15:30');
    expect(formatHour(24)).toBe('00:00');
  });

  test('every stage has a description for the stage screen', () => {
    for (const s of STAGES) expect(s.description.length).toBeGreaterThan(60);
  });
});
