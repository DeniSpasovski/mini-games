import { describe, expect, test } from '@rstest/core';
import { shiftStreets } from '../../src/games/rally/maps/shared/street-shift';
import type { PathDef } from '../../src/games/rally/maps/shared/types';

const street = (pts: number[], extra: Partial<PathDef> = {}): PathDef => ({
  kind: 'residential',
  width: 8,
  surface: 'tarmac',
  pts,
  ...extra,
});

describe('shiftStreets', () => {
  // a street along +X; left of travel is -Z (left = (tz, -tx))
  const long = () => street([0, 0, 50, 0, 100, 0, 150, 0, 200, 0]);

  test('the middle moves by the shift to the left of the direction, the ends stay on their node fade', () => {
    const { paths, moved } = shiftStreets(
      [long()],
      [{ k: [0, 0, 200, 0], s: 1.5 }],
    );
    expect(moved).toBe(1);
    // left of +X travel is -Z in this world (+Z south): left = (tz, -tx) = (0, -1)
    expect(paths[0].pts[5]).toBeCloseTo(-1.5, 1);
    expect(paths[0].pts[7]).toBeCloseTo(-1.5, 1);
    // x is not changed on a straight street
    expect(paths[0].pts[4]).toBeCloseTo(100, 1);
  });

  test('ways meeting at a free node move together: no gap opens at the joint', () => {
    const a = street([0, 0, 100, 0]);
    const b = street([100, 0, 200, 0]);
    const { paths } = shiftStreets(
      [a, b],
      [
        { k: [0, 0, 100, 0], s: 1 },
        { k: [100, 0, 200, 0], s: 3 },
      ],
    );
    const endA = paths[0].pts.slice(-2);
    const startB = paths[1].pts.slice(0, 2);
    expect(Math.hypot(endA[0] - startB[0], endA[1] - startB[1])).toBeLessThan(
      0.01,
    );
    // the node took the mean of the two shifts
    expect(startB[1]).toBeCloseTo(-2, 1);
  });

  test('a node that touches a way that is not shifted stays where it is', () => {
    const a = street([0, 0, 100, 0, 200, 0]);
    const deck = street([200, 0, 240, 0], { bridge: true, layer: 1 });
    const { paths } = shiftStreets([a, deck], [{ k: [0, 0, 200, 0], s: 2 }]);
    expect(paths[0].pts[5]).toBeCloseTo(0, 5); // pinned end
    expect(paths[0].pts[1]).toBeCloseTo(-2 * 0 + paths[0].pts[1], 5);
    expect(paths[0].pts[3]).toBeCloseTo(-2, 1); // the middle still moves
    expect(paths[1]).toEqual(deck);
  });

  test('matched by end positions: a street that is not in the list is returned as it is', () => {
    const list = [long()];
    const r = shiftStreets(list, [{ k: [5, 5, 6, 6], s: 2 }]);
    expect(r.moved).toBe(0);
    expect(r.paths).toBe(list);
  });
});
