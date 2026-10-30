import { expect, test } from '@rstest/core';
import { runConditions } from '../../src/games/rally/game/stage';

test('runs saved before season / time of day show summer and the stage hour', () => {
  expect(runConditions({}, 15.8)).toBe('Summer · Afternoon');
  expect(runConditions({}, undefined)).toBe('Summer');
});

test('a run in rain shows its weather; dry (and runs saved before the picker) show none', () => {
  expect(
    runConditions({ season: 'autumn', hour: 7, weather: 'rain_heavy' }, 15.8),
  ).toBe('Autumn · Early morning · Heavy rain');
  expect(runConditions({ weather: 'dry' }, undefined)).toBe('Summer');
});

test('a run shows its own season and hour', () => {
  expect(runConditions({ season: 'autumn', hour: 7 }, 15.8)).toBe(
    'Autumn · Early morning',
  );
});
