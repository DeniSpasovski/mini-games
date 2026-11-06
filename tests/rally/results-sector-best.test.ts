import { describe, expect, test } from '@rstest/core';
import {
  bestSectorTimes,
  type RunRecord,
} from '../../src/games/rally/game/stage';

const run = (car: string, time: number, splits?: number[]): RunRecord =>
  ({ time, splits, car, livery: 0 }) as RunRecord;

/** The results chips compare each sector with the fastest that sector among the other runs in the selected scope. */
describe('bestSectorTimes', () => {
  const me = run('audi_rs6', 128.93, [37.7, 69.32, 88.97]);
  const board = [
    me,
    run('subie', 139.94, [41.29, 76.85, 98.43]),
    run('audi_rs6', 142.8, [37.28, 77.16, 97.16]),
  ];

  test('fastest of each sector across the other runs, not the best run', () => {
    // S1 best is the slower overall Audi run (37.28), so my S1 (37.70) reads as slower.
    const best = bestSectorTimes(board, me, false);
    [37.28, 35.56, 20.0, 41.51].forEach((n, i) =>
      expect(best[i]).toBeCloseTo(n, 5),
    );
  });

  test('this car only', () => {
    const best = bestSectorTimes(board, me, true);
    [37.28, 39.88, 20.0, 45.64].forEach((n, i) =>
      expect(best[i]).toBeCloseTo(n, 5),
    );
  });

  test('runs without splits and a lone run give nothing', () => {
    expect(bestSectorTimes([me, run('x', 100)], me, false)).toEqual([]);
  });
});
