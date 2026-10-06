import { expect, test } from '@rstest/core';
import {
  CLEAR_BONUS_PER_SECOND,
  DIFFICULTIES,
  difficultiesFor,
  difficultyById,
  LEVEL_TIERS,
  GROWTH_LEVELS,
  ITEM_LEVELS,
  MAX_LEVEL,
  TIER_COUNT,
  canEat,
  cumulativeXp,
  holeDiameter,
  levelForSize,
  maxEdibleSize,
  pointsForTier,
  tierForSize,
  tierMaxSize,
  xpToNext,
} from '../../src/games/hole/sim/progression';

test('15 hole levels on size tiers 1, 4, 8, 10, 12, 14, 16, 18, 19..25', () => {
  expect(ITEM_LEVELS).toBe(15);
  expect(MAX_LEVEL).toBe(25);
  expect(GROWTH_LEVELS).toBe(10);
  expect([...LEVEL_TIERS]).toEqual([
    1, 4, 8, 10, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25,
  ]);
});

test('hole diameter grows from 1.2 m to 48 m and is wider than what it eats', () => {
  expect(holeDiameter(1)).toBeCloseTo(1.2, 5);
  expect(holeDiameter(ITEM_LEVELS)).toBeCloseTo(48, 5);
  for (let l = 2; l <= ITEM_LEVELS; l++)
    expect(holeDiameter(l)).toBeGreaterThan(holeDiameter(l - 1));
  for (let l = 1; l <= ITEM_LEVELS; l++)
    expect(maxEdibleSize(l) / holeDiameter(l)).toBeCloseTo(0.75, 5);
});

test('points follow the 25 size tiers: 1..20, then 25/30/35/40/50', () => {
  for (let t = 1; t <= 20; t++) expect(pointsForTier(t)).toBe(t);
  expect([21, 22, 23, 24, 25].map(pointsForTier)).toEqual([25, 30, 35, 40, 50]);
  expect(tierMaxSize(1)).toBeCloseTo(0.9, 5);
  expect(tierMaxSize(TIER_COUNT)).toBeCloseTo(36, 5);
});

test('xp curve', () => {
  expect(xpToNext(1)).toBe(8);
  expect(xpToNext(ITEM_LEVELS - 1)).toBe(1840);
  expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
  expect(cumulativeXp(ITEM_LEVELS)).toBe(8555);
});

test('eat rule, tiers and levels', () => {
  expect(tierForSize(0.5)).toBe(1);
  expect(tierForSize(tierMaxSize(7))).toBe(7);
  expect(tierForSize(tierMaxSize(7) + 0.01)).toBe(8);
  expect(tierForSize(100)).toBe(Infinity);
  // level 2 eats up to tier 4, level 3 up to tier 8
  expect(levelForSize(0.5)).toBe(1);
  expect(levelForSize(tierMaxSize(4))).toBe(2);
  expect(levelForSize(tierMaxSize(4) + 0.01)).toBe(3);
  expect(levelForSize(tierMaxSize(25))).toBe(ITEM_LEVELS);
  expect(levelForSize(100)).toBe(Infinity);
  expect(canEat(1, 0.9)).toBe(true);
  expect(canEat(1, 0.95)).toBe(false);
});

test('difficulty times and clear bonus', () => {
  expect(DIFFICULTIES.map((d) => [d.id, d.seconds])).toEqual([
    ['easy', 480],
    ['medium', 240],
    ['hard', 120],
  ]);
  // the toy store has its own limits; maps without an override keep City Island's
  expect(difficultiesFor('toy').map((d) => [d.id, d.seconds])).toEqual([
    ['easy', 600],
    ['medium', 300],
    ['hard', 150],
  ]);
  expect(difficultiesFor('animal')).toBe(DIFFICULTIES);
  expect(difficultyById('hard', 'toy').seconds).toBe(150);
  expect(difficultyById('nope', 'toy').id).toBe('medium');
  expect(CLEAR_BONUS_PER_SECOND).toBe(10);
});

test('levels 16..25 only grow the hole: x1.075 per level to ~99 m, nothing new to eat', () => {
  expect(holeDiameter(15)).toBeCloseTo(48, 5);
  for (let l = 16; l <= MAX_LEVEL; l++) {
    expect(holeDiameter(l) / holeDiameter(l - 1)).toBeCloseTo(1.075, 5);
    expect(maxEdibleSize(l)).toBeGreaterThan(36);
    expect(canEat(l, 36)).toBe(true);
  }
  expect(holeDiameter(MAX_LEVEL)).toBeCloseTo(48 * Math.pow(1.075, 10), 5);
  expect(holeDiameter(MAX_LEVEL)).toBeGreaterThan(98);
  expect(holeDiameter(MAX_LEVEL)).toBeLessThan(100);
  // growth levels ask for 800 + 80 per level; level 25 is the cap
  expect(xpToNext(15)).toBe(800);
  expect(xpToNext(24)).toBe(800 + 80 * 9);
  expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
  expect(cumulativeXp(MAX_LEVEL)).toBe(8555 + 10 * 800 + 80 * 45);
});
