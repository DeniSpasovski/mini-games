import { describe, expect, test } from '@rstest/core';
import { deRidge } from '../../src/games/rally/world/heightfield';

const N = NaN;

describe('height grid crest filter (deRidge)', () => {
  test('a one-cell crest is lowered to just above the land either side', () => {
    // across x: 18 | 21 | 15 (a metre-wide strip left between two carves)
    expect(deRidge(21, 18, 18, 15, 15, N, 20.5, 20.5, N)).toBeCloseTo(18.15, 5);
  });

  test('a two-cell crest is lowered on both samples (each sees its partner and the land beyond)', () => {
    // x: 17 18 | 21 21 | 15 15
    const a = deRidge(21, 17, 18, 21, 15, N, 21, 21, N);
    const b = deRidge(21, 18, 21, 15, 15, N, 21, 21, N);
    expect(a).toBeLessThan(18.5);
    expect(b).toBeLessThan(18.5);
  });

  test('steps, slopes, valleys and flat land are left alone', () => {
    // a sheer step (cut wall): low on one side, high on the other
    expect(deRidge(20, 15, 15, 20, 20, 20, 20, 20, 20)).toBe(20);
    // an even slope
    expect(deRidge(5, 3, 4, 6, 7, 5, 5, 5, 5)).toBe(5);
    // a ditch (one cell below both sides) is not a crest
    expect(deRidge(2, 3, 3, 3, 3, 2, 2, 2, 2)).toBe(2);
    expect(deRidge(4, 4, 4, 4, 4, 4, 4, 4, 4)).toBe(4);
  });

  test('without the samples two cells out (a chunk edge) only the one-cell test runs', () => {
    expect(deRidge(21, N, 18, 21, N, N, 21, 21, N)).toBe(21);
    expect(deRidge(21, N, 18, 18, N, N, 21, 21, N)).toBeCloseTo(18.15, 5);
  });
});
