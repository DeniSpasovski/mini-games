import { describe, expect, test } from '@rstest/core';
import type { PathDef } from '../../src/games/rally/maps/shared/types';
import { mergePaint } from '../../src/games/rally/world/merge-paint';

const way = (kind: string, pts: number[], width = 7): PathDef => ({
  kind,
  width,
  surface: 'tarmac',
  oneway: true,
  pts,
});

describe('merge paint (splits and merges of carriageways / ramps)', () => {
  // A carriageway running east (+x) through a node at x = 100; a ramp leaves it there to the right of travel
  // (right of +x travel = +z... left = (tz, -tx) = (0, -1), so right = +z) at a shallow angle.
  const a = way('motorway', [0, 0, 100, 0]);
  const b = way('motorway', [100, 0, 300, 0]);
  const ramp = way('motorway_link', [100, 0, 160, 6, 220, 30], 5);
  const all = [a, b, ramp];

  test('the through road paints on across the node, dotted on the ramp side', () => {
    const [, endA] = mergePaint(all, a);
    expect(endA.through).toBe(true);
    const [startB] = mergePaint(all, b);
    expect(startB.through).toBe(true);
    // the ramp leaves to the right of travel (+z)
    expect(startB.dotted?.side).toBe(-1);
    expect(startB.dotted!.length).toBeGreaterThan(20);
  });

  test('the ramp stops its paint where its ribbon overlaps the through road', () => {
    const [start] = mergePaint(all, ramp);
    expect(start.through).toBe(false);
    expect(start.trim).toBeGreaterThan(20);
    expect(start.trim).toBeLessThan(80);
  });

  test('a way ending square on a through road stops short of its edge; a plain joint and streets are left alone', () => {
    const c = way('motorway', [100, 0, 100, 80]);
    // c + its continuation north are the through road, `a` meets it from the side
    const [, e] = mergePaint([a, c, way('motorway', [100, 0, 100, -80])], a);
    expect(e.through).toBe(false);
    expect(e.trim).toBeGreaterThan(3);
    expect(e.trim).toBeLessThan(10);
    expect(mergePaint([a, b], a)[1]).toEqual({ through: false, trim: 0 });
    expect(
      mergePaint(
        [way('residential', [0, 0, 50, 0])],
        way('residential', [0, 0, 50, 0]),
      ),
    ).toEqual([
      { through: false, trim: 0 },
      { through: false, trim: 0 },
    ]);
  });
});
