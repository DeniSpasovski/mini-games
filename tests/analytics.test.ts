import { afterEach, expect, rstest, test } from '@rstest/core';
import { cleanParams, seconds, track } from '../src/shared/analytics';

afterEach(() => {
  delete window.gtag;
});

test('track: no gtag (no consent / dev) = nothing sent, no error', () => {
  expect(() => track('level_start', { game: 'rally' })).not.toThrow();
});

test('track: sends a GA4 event with cleaned params once gtag exists', () => {
  const gtag = rstest.fn();
  window.gtag = gtag;
  track('level_end', { game: 'hole', score: 120, seed: undefined });
  expect(gtag).toHaveBeenCalledWith('event', 'level_end', {
    game: 'hole',
    score: 120,
  });
});

test('cleanParams: drops undefined / NaN, cuts long strings to 100 chars', () => {
  const p = cleanParams({ a: undefined, b: NaN, c: 'x'.repeat(150), d: false });
  expect(p).toEqual({ c: 'x'.repeat(100), d: false });
});

test('seconds: rounded to ms', () => {
  expect(seconds(83.123456)).toBe(83.123);
});
