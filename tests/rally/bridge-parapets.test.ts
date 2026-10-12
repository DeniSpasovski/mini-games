import { describe, expect, test } from '@rstest/core';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { barrierPoint } from '../../src/games/rally/world/barriers';
import { World } from '../../src/games/rally/world/world';

describe('bridge parapets', () => {
  test('Jackie: parapet colliders on a stage-road bridge stand on the deck', () => {
    const world = new World(jackieMap);
    const ctx = { road: world.road, net: world.gen.paths };
    let checked = 0;
    for (const r of world.barrierRuns) {
      if (r.path !== undefined) continue;
      for (let a = r.from; a <= r.to; a += 2) {
        if (!world.road.bridgeAt(a)) continue;
        const p = barrierPoint(ctx, world.analytic, r, a);
        expect(Math.abs(p.y - world.road.at(a).y)).toBeLessThan(0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
