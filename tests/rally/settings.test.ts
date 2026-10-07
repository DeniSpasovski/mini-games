import { expect, test } from '@rstest/core';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
} from '../../src/games/rally/game/settings';

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
  expect(s.livery).toBe(DEFAULT_SETTINGS.livery);
  expect(s.carNumber).toBeLessThanOrEqual(99);
  expect(s.car).toBe('skoda-rally');
});

test('non-objects give defaults', () => {
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
});
