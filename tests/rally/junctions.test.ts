import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import {
  junctionFillets,
  type Junction,
} from '../../src/games/rally/world/junctions';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

describe.each(
  ALL_MAPS.filter((m) => m.paths?.length).map((m) => [m.id, m] as const),
)('junctions %s', (_id, map) => {
  const world = new World(map);
  const q = newRoadQuery();

  test('side roads reach the stage road', () => {
    const js = world.gen.junctions;
    console.info(
      `[${map.id}] ${js.length} junctions (${js.filter((j) => j.surface === 'tarmac').length} paved)`,
    );
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) {
      world.road.query(j.x, j.z, q);
      expect(q.found).toBe(true);
      // The junction point is on the stage road edge (ray steps are 1 m).
      expect(q.distance).toBeLessThanOrEqual(q.halfWidth);
      expect(q.distance).toBeGreaterThan(q.halfWidth - 1.5);
    }
  });

  test('extended side road ends are covered by the stage road', () => {
    // Path ends that touch the road now (none did before: the baker leaves a gap).
    let touching = 0;
    for (const p of world.gen.paths!.paths) {
      if (p.junction === false) continue;
      for (const k of [0, p.pts.length - 2]) {
        world.road.query(p.pts[k], p.pts[k + 1], q);
        if (q.found && q.distance <= q.halfWidth) touching++;
      }
    }
    expect(touching).toBeGreaterThanOrEqual(world.gen.junctions.length);
  });

  test('barriers close the mouths and stay off the road', () => {
    const bars = world.junctionInstances();
    if (!map.junctionBarriers) return;
    console.info(`[${map.id}] ${bars.length} junction barriers`);
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      world.road.query(b.x, b.z, q);
      if (q.found)
        expect(q.distance).toBeGreaterThan(
          q.halfWidth + map.road.shoulder + 1.5,
        );
    }
  });
});

/** Rounded corners at a junction mouth (`junctionFillets`): on the field side of both edges, tangent-ish at A / B. */
describe('junction fillets', () => {
  // Stage road along +X (its edge is z = 0), a 5 m side road leaving it towards +Z at x = 0.
  const square: Junction = {
    x: 0,
    z: 0,
    dx: 0,
    dz: 1,
    width: 5,
    surface: 'tarmac',
    kind: 'residential',
    along: 0,
    side: 1,
  };

  test('square junction: two corners at the side road edges, arcs from the stage edge to the side edge', () => {
    const f = junctionFillets(square, 1, 0, undefined, 6);
    expect(f.length).toBe(2);
    for (const { c, arc } of f) {
      expect(Math.abs(Math.abs(c[0]) - 2.5)).toBeLessThan(1e-9);
      expect(Math.abs(c[1])).toBeLessThan(1e-9);
      const a = arc[0];
      const b = arc[arc.length - 1];
      // A on the stage edge, 6 m further out; B on the side road edge, 6 m up it.
      expect(Math.abs(a[1])).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(a[0]) - 8.5)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(b[0]) - 2.5)).toBeLessThan(1e-9);
      expect(Math.abs(b[1] - 6)).toBeLessThan(1e-9);
      // The whole arc is on the field side: off the stage road (z >= 0) and outside the side road (|x| >= 2.5).
      for (const [x, z] of arc) {
        expect(z).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(x)).toBeGreaterThanOrEqual(2.5 - 1e-9);
      }
    }
  });

  test('angled junction: corners still on the stage edge; a near-parallel side gets none', () => {
    const a = Math.PI / 4;
    const angled = { ...square, dx: Math.cos(a), dz: Math.sin(a) };
    const f = junctionFillets(angled, 1, 0);
    expect(f.length).toBe(2);
    for (const { c } of f) expect(Math.abs(c[1])).toBeLessThan(1e-9);
    const shallow = { ...square, dx: Math.cos(0.2), dz: Math.sin(0.2) };
    expect(junctionFillets(shallow, 1, 0).length).toBe(0);
  });
});
