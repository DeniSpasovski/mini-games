import { expect, test } from '@rstest/core';
import {
  DEFAULT_SETTINGS,
  loadSettings,
} from '../../src/games/hole/game/settings';
import { memoryStorage } from '../../src/games/hole/game/storage';

function load(json: string) {
  const store = memoryStorage();
  store.setItem('hole.settings', json);
  return loadSettings(store);
}

test('invalid fields fall back to defaults, valid ones are kept', () => {
  const s = load(
    JSON.stringify({
      difficulty: 'nightmare',
      quality: 7,
      volume: 'loud',
      seed: 1.5,
      color: 'lava',
      map: '',
    }),
  );
  expect(s.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
  expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
  expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  expect(s.seed).toBe(DEFAULT_SETTINGS.seed);
  expect(s.map).toBe(DEFAULT_SETTINGS.map);
  expect(s.color).toBe('lava');
});

test('valid values pass, volume is clamped', () => {
  const s = load(
    JSON.stringify({ difficulty: 'hard', quality: 'low', volume: 3 }),
  );
  expect(s).toMatchObject({ difficulty: 'hard', quality: 'low', volume: 1 });
});

test('garbage JSON or non-objects give defaults', () => {
  expect(load('not json')).toEqual(DEFAULT_SETTINGS);
  expect(load('null')).toEqual(DEFAULT_SETTINGS);
  expect(load('[1,2]')).toEqual(DEFAULT_SETTINGS);
});
