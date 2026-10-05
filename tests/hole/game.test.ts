import { expect, test } from '@rstest/core';
import {
  dragToStick,
  followOrigin,
  stickToWorld,
} from '../../src/games/hole/game/stick';
import { memoryStorage } from '../../src/games/hole/game/storage';
import {
  SCORING_VERSION,
  loadScores,
  purgeStaleScores,
  recordScore,
  type ScoreEntry,
} from '../../src/games/hole/game/scores';

const entry = (score: number, level = 5, date = 1): ScoreEntry => ({
  score,
  level,
  eaten: 10,
  pct: 0.1,
  color: 'ocean',
  date,
});

test('joystick: dead zone, clamp, direction', () => {
  expect(dragToStick(3, 3)).toEqual({ x: 0, y: 0 });
  const full = dragToStick(0, -200);
  expect(full.x).toBeCloseTo(0);
  expect(full.y).toBeCloseTo(1);
  const half = dragToStick(38, 0); // (38-6)/64 = 0.5
  expect(half.x).toBeCloseTo(0.5);
  expect(
    Math.hypot(dragToStick(300, 300).x, dragToStick(300, 300).y),
  ).toBeCloseTo(1);
});

test('stick up = away from the camera (-Z), right = +X', () => {
  const up = stickToWorld(0, 1);
  expect(up.x).toBeCloseTo(0);
  expect(up.z).toBeCloseTo(-1);
  const right = stickToWorld(1, 0);
  expect(right.x).toBeCloseTo(1);
  expect(right.z).toBeCloseTo(0);
});

test('joystick origin follows a long drag', () => {
  const o = followOrigin(0, 0, 150, 0, 70);
  expect(o.x).toBeCloseTo(80);
  const same = followOrigin(0, 0, 30, 0, 70);
  expect(same.x).toBe(0);
});

test('top 10 per difficulty: insert, order, tie-break, cut-off', () => {
  const store = memoryStorage();
  for (let i = 1; i <= 12; i++)
    recordScore(store, 'city', 'hard', entry(i * 10, 5, i));
  const list = loadScores(store, 'city', 'hard');
  expect(list.length).toBe(10);
  expect(list[0].score).toBe(120);
  expect(list[9].score).toBe(30);
  // separate list per difficulty
  expect(loadScores(store, 'city', 'easy')).toEqual([]);
  const r = recordScore(store, 'city', 'hard', entry(50, 9, 99));
  expect(r.rank).toBe(8);
  // equal score: higher level first
  const tie = recordScore(store, 'city', 'hard', entry(50, 3, 100));
  expect(tie.list.findIndex((e) => e.level === 9)).toBeLessThan(
    tie.list.findIndex((e) => e.level === 3),
  );
  // too low: not in the top 10
  expect(recordScore(store, 'city', 'hard', entry(1)).rank).toBe(0);
});

test('high scores are erased when the scoring version changes', () => {
  const store = memoryStorage();
  // legacy list saved before versions existed
  store.setItem('hole.scores.city.hard', JSON.stringify([entry(999)]));
  expect(purgeStaleScores(store)).toBe(true);
  expect(loadScores(store, 'city', 'hard')).toEqual([]);
  // same version: scores survive
  recordScore(store, 'city', 'easy', entry(50));
  expect(purgeStaleScores(store)).toBe(false);
  expect(loadScores(store, 'city', 'easy').length).toBe(1);
  // a different stored version wipes every difficulty
  store.setItem('hole.scores.version', String(SCORING_VERSION - 1));
  recordScore(store, 'city', 'medium', entry(70));
  expect(purgeStaleScores(store)).toBe(true);
  for (const d of ['easy', 'medium', 'hard'])
    expect(loadScores(store, 'city', d)).toEqual([]);
  expect(store.getItem('hole.scores.version')).toBe(String(SCORING_VERSION));
});
