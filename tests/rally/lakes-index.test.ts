import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import type { LakeDef } from '../../src/games/rally/maps/shared/types';
import {
  LAKE_REACH,
  LAKE_SHELF,
  Lakes,
  newLakeQuery,
  signedDistance,
} from '../../src/games/rally/world/lakes';

/**
 * `Lakes.query` looks only at the outline edges near the point (a grid over each outline): the same lake and the same
 * signed distance as the plain loop over every edge wherever the shore is within LAKE_REACH, and, further inside a lake,
 * -LAKE_REACH (every user of `sd` stops at LAKE_SHELF).
 */
const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** The old query: every edge of every outline. */
function reference(lakes: Lakes, x: number, z: number) {
  let lake = -1;
  let sd = Infinity;
  lakes.polys.forEach((p, i) => {
    const d = signedDistance(p, x, z);
    if (d < sd && d < LAKE_REACH) {
      sd = d;
      lake = i;
    }
  });
  return { lake, sd };
}

function check(lakes: Lakes, n: number, seed: number, area: number[]) {
  const r = rnd(seed);
  const q = newLakeQuery();
  let near = 0;
  let deep = 0;
  for (let k = 0; k < n; k++) {
    const x = area[0] + r() * (area[2] - area[0]);
    const z = area[1] + r() * (area[3] - area[1]);
    const found = lakes.query(x, z, q);
    const want = reference(lakes, x, z);
    expect(found).toBe(want.lake >= 0);
    if (!found) continue;
    expect(q.lake).toBe(want.lake);
    if (want.sd > -LAKE_REACH) {
      near++;
      expect(q.sd).toBe(want.sd);
    } else {
      deep++;
      expect(q.sd).toBeLessThanOrEqual(-LAKE_SHELF);
    }
  }
  return { near, deep };
}

describe('Lakes.query', () => {
  test('a wobbly lake: exact near the shore, full depth inside', () => {
    const r = rnd(3);
    const pts: number[] = [];
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      const rad = 300 + 60 * Math.sin(a * 7) + r() * 12;
      pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const lakes = new Lakes([{ pts } as LakeDef]);
    const { near, deep } = check(lakes, 8000, 5, [-420, -420, 420, 420]);
    expect(near).toBeGreaterThan(300);
    expect(deep).toBeGreaterThan(300);
  });

  test('overlapping lakes: the exact value of each decides, deep inside too', () => {
    const ring = (cx: number, cz: number, rad: number) => {
      const out: number[] = [];
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        out.push(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad);
      }
      return { pts: out } as LakeDef;
    };
    const lakes = new Lakes([
      ring(0, 0, 200),
      ring(60, 20, 150),
      ring(-300, 0, 90),
    ]);
    const q = newLakeQuery();
    const r = rnd(9);
    for (let k = 0; k < 4000; k++) {
      const x = -420 + r() * 700;
      const z = -260 + r() * 520;
      const found = lakes.query(x, z, q);
      const want = reference(lakes, x, z);
      expect(found).toBe(want.lake >= 0);
      if (found) {
        expect(q.lake).toBe(want.lake);
        // Exact; or full depth (-LAKE_REACH) where only one lake's box holds the point and it is far inside.
        if (q.sd !== want.sd) {
          expect(q.sd).toBe(-LAKE_REACH);
          expect(want.sd).toBeLessThan(-LAKE_REACH);
        }
      }
    }
  });

  test.each(
    ALL_MAPS.filter((m) => m.lakes?.length).map((m) => [m.id, m] as const),
  )(
    'the real lakes of %s: points round the shore and over the water',
    (_id, map) => {
      const lakes = new Lakes(map.lakes!);
      const r = rnd(21);
      const q = newLakeQuery();
      let near = 0;
      for (let k = 0; k < 6000; k++) {
        const p = lakes.polys[Math.floor(r() * lakes.polys.length)];
        const v = Math.floor(r() * (p.length / 2));
        // A vertex of an outline, pushed out or in by up to 40 m.
        const x = p[v * 2] + (r() - 0.5) * 80;
        const z = p[v * 2 + 1] + (r() - 0.5) * 80;
        const found = lakes.query(x, z, q);
        const want = reference(lakes, x, z);
        expect(found).toBe(want.lake >= 0);
        if (!found) continue;
        expect(q.lake).toBe(want.lake);
        if (want.sd > -LAKE_REACH) {
          near++;
          expect(q.sd).toBe(want.sd);
        } else expect(q.sd).toBeLessThanOrEqual(-LAKE_SHELF);
      }
      expect(near).toBeGreaterThan(100);
    },
  );
});
