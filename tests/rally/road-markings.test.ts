import { describe, expect, test } from '@rstest/core';
import {
  ARROW,
  dashes,
  roadPaint,
  type PaintRoad,
} from '../../src/games/rally/world/road-markings';

/** A straight road along +X, 8 m wide. */
const road: PaintRoad = {
  at: (along) => ({ x: along, z: 0, tx: 1, tz: 0, halfWidth: 4 }),
};
const flat = () => 0;

describe('road paint', () => {
  test('a dashed line is cut into dashes with gaps between them', () => {
    expect(dashes(0, 10)).toEqual([[0, 10]]);
    expect(dashes(0, 10, [2, 3])).toEqual([
      [0, 2],
      [5, 7],
    ]);
    // The last dash is cut at the end of the line.
    expect(dashes(0, 6, [2, 3])).toEqual([
      [0, 2],
      [5, 6],
    ]);
  });

  test('a line keeps its distance from the road edge: both edges when the road is wider', () => {
    const wide: PaintRoad = {
      at: (along) => ({
        x: along,
        z: 0,
        tx: 1,
        tz: 0,
        halfWidth: 4 + along / 10,
      }),
    };
    for (const [r, edge, sign] of [
      [road, 'left', 1],
      [wide, 'left', 1],
      [wide, 'right', -1],
    ] as const) {
      const { lines } = roadPaint(
        r,
        [{ kind: 'line', from: 0, to: 10, edge, offset: 2, width: 0.2 }],
        flat,
      );
      // The road's left is -z at tx = 1 (left = (tz, -tx)); every vertex pair is 0.2 m apart across the road.
      for (let i = 0; i < lines.pos.length; i += 6) {
        const x = lines.pos[i];
        const half = r.at(x).halfWidth;
        const mid = (lines.pos[i + 2] + lines.pos[i + 5]) / 2;
        expect(mid, `${edge} at ${x}`).toBeCloseTo(-sign * (half - 2), 5);
        expect(Math.abs(lines.pos[i + 2] - lines.pos[i + 5])).toBeCloseTo(
          0.2,
          5,
        );
      }
    }
  });

  test('paint lies just above the ground and follows its height', () => {
    const { lines } = roadPaint(
      road,
      [{ kind: 'line', from: 0, to: 10, edge: 'left', offset: 1 }],
      (x) => x * 0.1,
    );
    for (let i = 0; i < lines.pos.length; i += 3) {
      const lift = lines.pos[i + 1] - lines.pos[i] * 0.1;
      expect(lift).toBeGreaterThan(0.02);
      expect(lift).toBeLessThan(0.06);
    }
  });

  test('an arrow is one quad of the arrow size, centred on `at`, in its own layer', () => {
    const { left, straight, lines } = roadPaint(
      road,
      [
        { kind: 'arrow', arrow: 'left', at: 50, edge: 'left', offset: 1.5 },
        { kind: 'arrow', arrow: 'straight', at: 60, edge: 'left', offset: 1.5 },
      ],
      flat,
    );
    expect(lines.idx.length).toBe(0);
    for (const [p, at] of [
      [left, 50],
      [straight, 60],
    ] as const) {
      expect(p.idx.length).toBe(6);
      const xs = [0, 3, 6, 9].map((i) => p.pos[i]);
      expect(Math.min(...xs)).toBeCloseTo(at - ARROW.length / 2, 5);
      expect(Math.max(...xs)).toBeCloseTo(at + ARROW.length / 2, 5);
      const zs = [2, 5, 8, 11].map((i) => p.pos[i]);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(ARROW.width, 5);
    }
  });

  test('a stripe runs straight between its two end points, its width square to it; yellow in its own layer', () => {
    const { lines, yellow } = roadPaint(
      road,
      [
        // from 1 m in at 10 m to 3 m in at 14 m, from the left edge (z = 4 on this road's left)
        {
          kind: 'stripe',
          from: 10,
          to: 14,
          edge: 'left',
          offset: [1, 3],
          width: 0.2,
        },
        {
          kind: 'stripe',
          from: 20,
          to: 22,
          edge: 'right',
          offset: [0.5, 0.5],
          yellow: true,
        },
      ],
      flat,
    );
    expect(yellow.idx.length).toBeGreaterThan(0);
    // centre line of the white stripe: midway between each row's two points
    const mids: [number, number][] = [];
    for (let i = 0; i < lines.pos.length; i += 6)
      mids.push([
        (lines.pos[i] + lines.pos[i + 3]) / 2,
        (lines.pos[i + 2] + lines.pos[i + 5]) / 2,
      ]);
    expect(mids[0][0]).toBeCloseTo(10, 5);
    expect(mids[0][1]).toBeCloseTo(-3, 5);
    expect(mids[mids.length - 1][0]).toBeCloseTo(14, 5);
    expect(mids[mids.length - 1][1]).toBeCloseTo(-1, 5);
    // every row 0.2 m wide
    for (let i = 0; i < lines.pos.length; i += 6)
      expect(
        Math.hypot(
          lines.pos[i] - lines.pos[i + 3],
          lines.pos[i + 2] - lines.pos[i + 5],
        ),
      ).toBeCloseTo(0.2, 5);
  });
});
