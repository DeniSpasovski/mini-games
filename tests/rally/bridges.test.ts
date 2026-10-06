import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';
import type { GroundSample } from '../../src/games/rally/physics/types';

/**
 * Bridges of real-world maps: the stage road on a bridge span is a deck over lowered ground
 * (physics drives on the deck), and other roads' decks (OSM bridge=yes) clear the stage road.
 */
describe.each(
  ALL_MAPS.filter(
    (m) => m.road.spans?.length || m.paths?.some((p) => p.bridge),
  ).map((m) => [m.id, m] as const),
)('bridges %s', (_id, map) => {
  const world = new World(map);
  const gs: GroundSample = {
    height: 0,
    normal: new Vector3(),
    surface: null as never,
  };

  test('stage-road spans: drive on the deck, ground beneath is clear', () => {
    const lines: string[] = [];
    for (const sp of world.road.bridges) {
      // The fill ramps down to the lowered ground over this length from each abutment.
      const ramp = Math.min(14, (sp.to - sp.from) * 0.3);
      let worstStep = 0;
      let minClear = Infinity;
      for (let a = sp.from - 6; a <= sp.to + 6; a += 1) {
        const c = world.road.at(a);
        world.sampleGround(c.x, c.z, gs);
        // Ground sampled at the road centre is the deck, within the crown of the road.
        expect(Math.abs(gs.height - c.y)).toBeLessThan(0.1);
        expect(gs.normal.y).toBeGreaterThan(0.9);
        const c1 = world.road.at(a + 1);
        world.sampleGround(c1.x, c1.z, gs);
        const h1 = gs.height;
        world.sampleGround(c.x, c.z, gs);
        worstStep = Math.max(worstStep, Math.abs(h1 - gs.height));
        if (a >= sp.from + ramp && a <= sp.to - ramp)
          minClear = Math.min(minClear, c.y - world.gen.height(c.x, c.z));
      }
      lines.push(
        `${sp.from}-${sp.to} m: max deck step ${worstStep.toFixed(2)} m / m, min clearance ${minClear.toFixed(1)} m`,
      );
      // No jump when driving onto the deck: grade stays a road grade.
      expect(worstStep).toBeLessThan(0.3);
      // Free height under the deck where a street / channel passes beneath (a bridge over nothing sits on solid ground).
      const net = world.gen.paths;
      const rq = newRoadQuery();
      const pt = { x: 0, z: 0 };
      if (net)
        net.paths.forEach((p, pi) => {
          if (p.bridge || p.surface !== 'tarmac') return;
          if (['motorway', 'motorway_link', 'trunk'].includes(p.kind)) return;
          for (let a = 0; a <= net.lengths[pi]; a += 1) {
            net.pointAt(pi, a, pt);
            world.road.queryRange(pt.x, pt.z, sp.from, sp.to, rq);
            if (rq.distance > rq.halfWidth * 0.5) continue;
            expect(rq.height - world.gen.height(pt.x, pt.z)).toBeGreaterThan(
              4.5,
            );
          }
        });
    }
    console.info(`[${map.id}] bridge spans:\n  ${lines.join('\n  ')}`);
  });

  test('decks of other roads clear the stage road', () => {
    const net = world.gen.paths;
    const rq = newRoadQuery();
    let checked = 0;
    let worst = Infinity;
    let at = '';
    for (const pi of world.gen.deckPaths()) {
      const p = net!.paths[pi];
      const pt = { x: 0, z: 0 };
      for (let a = 0; a <= net!.lengths[pi]; a += 2) {
        net!.pointAt(pi, a, pt);
        world.road.query(pt.x, pt.z, rq);
        if (!rq.found || rq.distance > rq.halfWidth + 1) continue;
        // Skip the parallel carriageway (it rides on the stage deck at the same level).
        const s = world.road.samples[rq.index];
        const e = { x: 0, z: 0 };
        net!.pointAt(pi, Math.min(net!.lengths[pi], a + 3), e);
        const l = Math.hypot(e.x - pt.x, e.z - pt.z) || 1;
        if (Math.abs(((e.x - pt.x) * s.tx + (e.z - pt.z) * s.tz) / l) > 0.7)
          continue;
        checked++;
        const clear = world.gen.pathHeight(pi, a) - rq.height;
        if (clear < worst) {
          worst = clear;
          at = `${p.name ?? p.kind} deck over stage ${rq.along.toFixed(0)} m`;
        }
      }
    }
    console.info(
      `[${map.id}] deck crossings checked ${checked}, min clearance over the stage road ${worst.toFixed(1)} m (${at})`,
    );
    if (checked) expect(worst).toBeGreaterThan(4.5);
  });
});
