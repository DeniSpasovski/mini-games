import { afterEach, expect, rstest, test } from '@rstest/core';
import {
  cleanParams,
  eventName,
  seconds,
  track,
} from '../src/shared/analytics';

afterEach(() => {
  delete window.gtag;
});

test('track: no gtag (no consent / dev) = nothing sent, no error', () => {
  expect(() => track('rally', 'level_start')).not.toThrow();
});

test('track: sends a GA4 event with cleaned params once gtag exists', () => {
  const gtag = rstest.fn();
  window.gtag = gtag;
  track('hole', 'level_end', { game_score: 120, game_hole_seed: undefined });
  expect(gtag).toHaveBeenCalledWith('event', 'game_hole_level_end', {
    game_id: 'hole',
    game_score: 120,
  });
});

test('cleanParams: drops undefined / NaN, cuts long strings to 100 chars', () => {
  const p = cleanParams({ a: undefined, b: NaN, c: 'x'.repeat(150), d: false });
  expect(p).toEqual({ c: 'x'.repeat(100), d: false });
});

test('seconds: rounded to ms', () => {
  expect(seconds(83.123456)).toBe(83.123);
});

test('eventName: game_<game>_<event>, GA4-safe characters, max 40 chars', () => {
  expect(eventName('rally', 'level_start')).toBe('game_rally_level_start');
  expect(eventName('my-game', 'x')).toBe('game_my_game_x');
  expect(eventName('a'.repeat(50), 'end').length).toBe(40);
});
