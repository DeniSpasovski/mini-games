import { expect, test } from '@rstest/core';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
} from '../../src/games/rally/game/settings';
import { loadBest, loadTimes } from '../../src/games/rally/game/stage';

test('invalid fields fall back to defaults, valid ones are kept', () => {
  const s = sanitizeSettings({
    camera: 'sky',
    objectDistance: 'huge',
    automatic: 'yes',
    volume: NaN,
    livery: -2,
    carNumber: 500,
    car: 'skoda-rally',
  });
  expect(s.camera).toBe(DEFAULT_SETTINGS.camera);
  expect(s.objectDistance).toBe(DEFAULT_SETTINGS.objectDistance);
  expect(s.automatic).toBe(DEFAULT_SETTINGS.automatic);
  expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  expect(sanitizeSettings({ musicVolume: 'loud' }).musicVolume).toBe(
    DEFAULT_SETTINGS.musicVolume,
  );
  expect(sanitizeSettings({ musicVolume: 0 }).musicVolume).toBe(0);
  expect(s.livery).toBe(DEFAULT_SETTINGS.livery);
  expect(s.carNumber).toBeLessThanOrEqual(99);
  expect(s.car).toBe('skoda-rally');
});

test('non-objects give defaults', () => {
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
});

test('corrupt saved times and best runs never throw', () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  store.set('rally.times.m', '{"a":1}');
  expect(loadTimes('m', [])).toEqual([]);
  store.set(
    'rally.times.m',
    '[null, 3, {"time":"x"}, {"time":5,"car":"c","date":1}]',
  );
  expect(loadTimes('m', [])).toHaveLength(1);
  store.set('rally.best.m.c', '{"total":"x"}');
  expect(loadBest('rally.best.m.c')).toBeNull();
  store.set('rally.best.m.c', 'null');
  expect(loadBest('rally.best.m.c')).toBeNull();
});
