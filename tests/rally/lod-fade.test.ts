import { expect, test } from '@rstest/core';
import {
  FADE_IN,
  FADE_OUT,
  FADE_SOLID,
  fadeCopies,
  fadeValue,
  LOD_FADE_TIME,
  newFadeState,
  nextFade,
  START_AT_COMMIT,
} from '../../src/games/rally/world/lod-fade';

/** The streamer's level fades (world/lod-fade.ts; trees/Lod.md "Transition"). */

const T = LOD_FADE_TIME;

test('an instance new to the stream takes its level at once', () => {
  const s = newFadeState();
  nextFade(s, 1, 10, 0);
  expect(fadeCopies(s)).toEqual([[1, FADE_SOLID]]);
});

test('a change of level fades over a fixed time, both copies drawn', () => {
  const s = newFadeState();
  nextFade(s, 0, 1, 0);
  nextFade(s, 1, 2, 5);
  expect(s.start).toBe(START_AT_COMMIT);
  expect(fadeCopies(s)).toEqual([
    [1, FADE_IN],
    [0, FADE_OUT],
  ]);
  s.start = 5; // the commit
  expect(fadeValue(s, 5 + T / 2)).toBeCloseTo(0.5);
  // Done by the next rebuild: one solid copy.
  nextFade(s, 1, 3, 5 + T * 2);
  expect(fadeCopies(s)).toEqual([[1, FADE_SOLID]]);
});

test('the fade does not depend on distance: an instance that keeps its level keeps fading in time', () => {
  const s = newFadeState();
  nextFade(s, 0, 1, 0);
  nextFade(s, 1, 2, 1);
  s.start = 1;
  nextFade(s, 1, 3, 1 + T * 0.4);
  expect(fadeCopies(s).length).toBe(2);
  expect(fadeValue(s, 1 + T)).toBe(1);
});

test('going back during a fade reverses it from the current value', () => {
  const s = newFadeState();
  nextFade(s, 0, 1, 0);
  nextFade(s, 1, 2, 10);
  s.start = 10;
  const now = 10 + T * 0.25; // 0 -> 1 at 0.25
  nextFade(s, 0, 3, now);
  expect(s.lod).toBe(0);
  expect(s.from).toBe(1);
  // 1 -> 0 continues at 0.75: the pixels already on level 1 stay there.
  expect(fadeValue(s, now)).toBeCloseTo(0.75);
});

test('a third level waits for the running fade', () => {
  const s = newFadeState();
  nextFade(s, 0, 1, 0);
  nextFade(s, 1, 2, 10);
  s.start = 10;
  nextFade(s, 2, 3, 10 + T * 0.5);
  expect([s.lod, s.from]).toEqual([1, 0]);
  nextFade(s, 2, 4, 10 + T * 2);
  expect([s.lod, s.from]).toEqual([2, 1]);
});

test('leaving the last level fades out, then nothing is drawn', () => {
  const s = newFadeState();
  nextFade(s, 1, 1, 0);
  nextFade(s, -1, 2, 1);
  expect(fadeCopies(s)).toEqual([[1, FADE_OUT]]);
  s.start = 1;
  nextFade(s, -1, 3, 1 + T * 2);
  expect(fadeCopies(s)).toEqual([]);
  // ... and comes back fading in.
  nextFade(s, 1, 4, 5);
  expect(fadeCopies(s)).toEqual([[1, FADE_IN]]);
});

test('an instance the last rebuild did not see takes its level at once (no fade from a stale level)', () => {
  const s = newFadeState();
  nextFade(s, 0, 1, 0);
  nextFade(s, 1, 5, 9);
  expect(fadeCopies(s)).toEqual([[1, FADE_SOLID]]);
});
