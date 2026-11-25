import { describe, expect, test } from '@rstest/core';
import { jackieInfo } from '../../src/games/rally/maps/jackie/info';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { keepClearOfRoute } from '../../src/games/rally/maps/shared/route-clearance';
import type { PathDef } from '../../src/games/rally/maps/shared/types';

/** Streets beside the stage road keep off its shoulder (maps/shared/route-clearance.ts). */
const kinds = new Set(['residential', 'service']);
const opts = { kinds, halfRoad: 3.7, gap: 0.9, step: 20 };
const street = (pts: number[], extra: Partial<PathDef> = {}): PathDef => ({
  kind: 'residential',
  width: 6,
  surface: 'tarmac',
  pts,
  ...extra,
});

describe('keepClearOfRoute', () => {
  // The stage road bends away from a straight chord: along +X at z = 0, then bending towards +z (the street's side).
  const route = [
    [0, 0],
    [100, 0],
    [180, 20],
    [240, 60],
  ];

  test('a chord that cuts into the verge is resampled and pushed off; its ends stay', () => {
    // a straight chord at z = 12: 12 m beside the road at the start, in its verge where the road bends towards it
    const list = [street([0, 12, 240, 12])];
    const { paths, moved } = keepClearOfRoute(list, route, opts);
    expect(moved).toBe(1);
    const p = paths[0];
    expect(p.pts.length).toBeGreaterThan(list[0].pts.length);
    expect(p.pts.slice(0, 2)).toEqual([0, 12]);
    expect(p.pts.slice(-2)).toEqual([240, 12]);
  });

  test('a street already clear, a far one, other kinds and decks are left alone', () => {
    const clear = street([0, 20, 100, 20]);
    const far = street([0, 300, 200, 300]);
    const ramp = street([0, 4, 100, 4], { kind: 'motorway_link' });
    const deck = street([0, 4, 100, 4], { bridge: true });
    const { paths, moved } = keepClearOfRoute(
      [clear, far, ramp, deck],
      route,
      opts,
    );
    expect(moved).toBe(0);
    expect(paths).toEqual([clear, far, ramp, deck]);
  });

  test('Jackie: streets along the parkway keep their edge off its shoulder (away from their ends)', () => {
    const r = jackieInfo.route;
    const near = (x: number, z: number) => {
      let best = Infinity;
      let tx = 1;
      let tz = 0;
      for (let i = 0; i + 1 < r.length; i++) {
        const ex = r[i + 1][0] - r[i][0];
        const ez = r[i + 1][1] - r[i][1];
        const l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(
          0,
          Math.min(1, ((x - r[i][0]) * ex + (z - r[i][1]) * ez) / l2),
        );
        const d = Math.hypot(r[i][0] + ex * t - x, r[i][1] + ez * t - z);
        if (d < best) {
          best = d;
          const l = Math.sqrt(l2);
          tx = ex / l;
          tz = ez / l;
        }
      }
      return { d: best, tx, tz };
    };
    const streets = new Set([
      'residential',
      'service',
      'tertiary',
      'secondary',
      'unclassified',
      'living_street',
    ]);
    let along = 0;
    let worst = Infinity;
    for (const p of jackieMap.paths!) {
      if (p.surface !== 'tarmac' || p.bridge || !streets.has(p.kind)) continue;
      let len = 0;
      for (let k = 0; k + 3 < p.pts.length; k += 2)
        len += Math.hypot(p.pts[k + 2] - p.pts[k], p.pts[k + 3] - p.pts[k + 1]);
      let at = 0;
      for (let k = 0; k + 3 < p.pts.length; k += 2) {
        const ex = p.pts[k + 2] - p.pts[k];
        const ez = p.pts[k + 3] - p.pts[k + 1];
        const l = Math.hypot(ex, ez) || 1;
        for (let t = 0; t < l; t += 5) {
          const x = p.pts[k] + (ex / l) * t;
          const z = p.pts[k + 1] + (ez / l) * t;
          const here = at + t;
          if (here < 12 || here > len - 12) continue;
          const h = near(x, z);
          if (Math.abs(h.tx * (ex / l) + h.tz * (ez / l)) < 0.85) continue;
          // (a street across the road, a ramp lane merging in, is not "beside" it: only ones within the verge zone)
          if (h.d > opts.halfRoad + opts.gap + p.width / 2 + 3) continue;
          along++;
          worst = Math.min(worst, h.d - p.width / 2);
        }
        at += l;
      }
    }
    expect(along).toBeGreaterThan(5);
    // the route here is the menu's simplified outline (0.8 m tolerance): a little slack
    expect(worst).toBeGreaterThan(opts.halfRoad + opts.gap - 1.2);
  });
});
