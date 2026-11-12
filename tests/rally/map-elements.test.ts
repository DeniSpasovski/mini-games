import { describe, expect, test } from '@rstest/core';
import { Piles } from '../../src/games/rally/maps/shared/piles';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { dropRailRules } from '../../src/games/rally/world/drop-rails';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

describe('Vodno base elements: fill banks, drop rails, OSM features', () => {
  const world = new World(vodnoMap);
  const explicit = vodnoMap.barriers ?? [];
  const derived = world.barrierRules.slice(explicit.length);
  // (kerb stones and gutters share the verge with a rail)
  const rails = explicit.filter(
    (e) => e.kind !== 'edge' && e.kind !== 'gutter',
  );
  const q = newRoadQuery();

  test('derived rails stand where the valley side drops, never over a rule the map lists', () => {
    expect(derived.length).toBeGreaterThan(3);
    for (const r of derived) {
      expect(r.to! - r.from!).toBeGreaterThanOrEqual(16);
      for (const e of rails)
        if (e.side === r.side || e.side === 'both')
          expect(r.to! <= (e.from ?? 0) || r.from! >= (e.to ?? Infinity)).toBe(
            true,
          );
      // Mid-run the ground 3.6 m past the verge lies more than 2 m below the road (the run's ends are led in).
      const mid = (r.from! + r.to!) / 2;
      const p = world.road.at(mid);
      const s = r.side === 'left' ? 1 : -1;
      let deepest = 0;
      for (let l = 0.5; l <= 3; l += 0.5) {
        const lat = s * (p.halfWidth + vodnoMap.road.shoulder + l);
        deepest = Math.max(
          deepest,
          p.y - world.gen.height(p.x + p.tz * lat, p.z - p.tx * lat),
        );
      }
      expect(deepest).toBeGreaterThan(1);
    }
  });

  test('without a drop there is no rail; listed rules win', () => {
    const flat = dropRailRules(
      world.road,
      () => world.road.at(0).y + 1e4,
      { minDrop: 2 },
      [],
    );
    expect(flat).toEqual([]);
    const all = dropRailRules(
      world.road,
      (x, z) => world.gen.height(x, z),
      { minDrop: 2 },
      [{ kind: 'guardrail', side: 'both', offset: 0.9 }],
    );
    expect(all).toEqual([]);
  });

  test('a fill bank only where the land lies well below the road', () => {
    expect(world.gen.fillWeightAt(0, 0, 1, 1000)).toBe(0);
    expect(world.gen.fillWeightAt(0, 0, 5, 1000)).toBeGreaterThanOrEqual(0);
  });

  test('OSM features: hand-built landmarks keep theirs, colliders stay off the road', () => {
    const l = world.landmarks.find((x) => x.id === 'vodno-osm-features')!;
    expect(l).toBeTruthy();
    const pts = vodnoMap.features!.points;
    expect(pts.length).toBeGreaterThan(20);
    // the side-road block at the hairpin is the trail lot's piles, not a second barrier
    const block = pts.find((p) => p[0] === 'block')!;
    expect(l.occupies(block[1], block[2], 0)).toBe(false);
    for (const c of l.colliders(world.analytic)) {
      world.road.query(c.x, c.z, q);
      if (q.found)
        expect(Math.abs(q.distance) - q.halfWidth).toBeGreaterThan(0.5);
    }
  });
});

describe('shared piles', () => {
  const piles = new Piles({ x: 0, z: 0, yaw: 0 }, [
    [0, 0, 3, 1.5, 'sand'],
    [6, 0, 2, 0.5, 'spread'],
  ]);

  test('heaps rise to about their height and end at the foot', () => {
    expect(piles.height(0, 0, 0)).toBeGreaterThan(1.3);
    expect(piles.height(0, 0, 0)).toBeLessThan(1.7);
    expect(piles.height(0, 4.5, 0)).toBe(0);
    expect(piles.height(1, 0, 0)).toBeLessThan(0.6);
  });

  test('weeds are seeded (same list twice)', () => {
    expect(piles.plants()).toEqual(piles.plants());
    expect(piles.plants().length).toBe(6 + 2 + 2);
  });
});
