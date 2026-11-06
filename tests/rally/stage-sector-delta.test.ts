import { describe, expect, test } from '@rstest/core';
import { StageTimer } from '../../src/games/rally/game/stage';
import { testMap } from '../../src/games/rally/maps/test/map';
import { World } from '../../src/games/rally/world/world';

/** The HUD bar, split chips and split message all colour from StageTimer.sectorDelta. */
describe('sector delta', () => {
  test('faster overall but a slower second sector reads as slower', () => {
    const timer = new StageTimer(new World(testMap), 'test.sectordelta');
    // Best: S1 24.59, S2 25.94 (splits at 24.59 and 50.53), finish at 100.
    timer.reference = { total: 100, splits: [24.59, 50.53] };
    // This run: S1 19.32 (-5.27 overall), S2 29.26 (+3.32 sector, -1.95 overall).
    timer.splitTimes = [19.32, 48.58];
    expect(timer.sectorDelta(0)).toBeCloseTo(-5.27, 5);
    expect(timer.sectorDelta(1)).toBeCloseTo(3.32, 5);
    expect(timer.sectorDelta(2)).toBeUndefined();
  });

  test('no reference, no delta', () => {
    const timer = new StageTimer(new World(testMap), 'test.sectordelta2');
    timer.reference = null;
    timer.splitTimes = [10];
    expect(timer.sectorDelta(0)).toBeUndefined();
  });
});

describe('sector delta, reference with fewer sectors', () => {
  test('a sector the reference does not have has no delta', () => {
    const timer = new StageTimer(new World(testMap), 'test.sectordelta3');
    // A best stored before the stage got a second split: one split + finish.
    timer.reference = { total: 100, splits: [40] };
    timer.splitTimes = [38, 70, 95];
    expect(timer.sectorDelta(0)).toBeCloseTo(-2, 5);
    expect(timer.sectorDelta(1)).toBeCloseTo(-28, 5);
    expect(timer.sectorDelta(2)).toBeUndefined();
    expect(timer.sectorDeltas()).toHaveLength(3);
  });
});
