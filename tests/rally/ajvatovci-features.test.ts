import { describe, expect, test } from '@rstest/core';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { fitOf } from '../../src/games/rally/maps/ajvatovci/farms';
import { FARMS } from '../../src/games/rally/maps/ajvatovci/farms/models';
import {
  ORCHARD_POLY,
  VILLAGE_FIX,
} from '../../src/games/rally/maps/ajvatovci/village';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Ajvatovci Hill round 2 (2026-10-04): the traced vineyard (was an orchard), the canal bridge, power lines, A2 barriers,
 * village dressing.
 */
const world = new World(ajvatovciMap);

describe('ajvatovci', () => {
  test('the big vineyard south of the farmland road (mapped as an orchard) + two small plots are vineyard (~60 ha)', () => {
    const lc = world.gen.landcover!;
    const d = lc.def;
    // Only the stage area (the land cover extent before the Ilinden / Marino background was added).
    const [x0, x1, z0, z1] = [-1950, 2150, -1100, 850];
    let cells = 0;
    for (let j = 0; j < d.rows; j++)
      for (let i = 0; i < d.cols; i++) {
        const x = d.originX + (i + 0.5) * d.cell;
        const z = d.originZ + (j + 0.5) * d.cell;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        if (lc.coverAt(x, z) === 'vineyard') cells++;
      }
    const ha = (cells * d.cell * d.cell) / 1e4;
    console.info(`[ajvatovci] vineyard ${ha.toFixed(0)} ha`);
    expect(ha).toBeGreaterThan(50);
    expect(ha).toBeLessThan(90);
  });

  test('the canal bridge is a deck span with abutments data (stage road span)', () => {
    expect(world.road.bridges.length).toBe(1);
    const sp = world.road.bridges[0];
    expect(sp.to - sp.from).toBeGreaterThan(8);
  });

  test('power lines: towers + spans, cables between neighbours', () => {
    expect(world.power).toBeTruthy();
    expect(world.power!.supports.length).toBeGreaterThan(40);
    expect(world.power!.spans.length).toBeGreaterThan(40);
    for (const s of world.power!.spans) {
      const d = Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z);
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(900);
    }
  });

  test('the side road at the bend by 3704 m joins the stage road and both corner bales stay', () => {
    const j = world.gen.junctions.find((q) => Math.abs(q.along - 3704) < 5);
    expect(j).toBeTruthy();
    const bales = [...world.scatter.fixedInstances()].filter(
      (i) =>
        i.asset === 'hay_bale_square' && Math.hypot(i.x - j!.x, i.z - j!.z) < 8,
    );
    expect(bales.length).toBe(2);
  });

  test('A2 carriageways have barriers, village dressing exists', () => {
    const runs = world.barrierRuns.filter((r) => r.path !== undefined);
    console.info(`[ajvatovci] A2 barrier runs: ${runs.length}`);
    expect(runs.length).toBeGreaterThan(2);
    const counts: Record<string, number> = {};
    for (const i of world.scatter.fixedInstances())
      counts[i.asset] = (counts[i.asset] ?? 0) + 1;
    console.info(`[ajvatovci] fixed instances: ${JSON.stringify(counts)}`);
    expect(counts.power_pylon).toBeGreaterThan(20);
    expect(counts.village_sign).toBe(2);
    expect(counts.street_lamp).toBeGreaterThan(20);
  });

  test('village fixes: pools / empty yards dropped, missing roadside buildings added clear of the road', () => {
    const ids = new Set(ajvatovciMap.buildings!.map((b) => b.id));
    for (const id of VILLAGE_FIX.drop)
      expect(ids.has(id), `${id} dropped`).toBe(false);
    for (const id of [...VILLAGE_FIX.move, ...VILLAGE_FIX.added])
      expect(ids.has(id), `${id} present`).toBe(true);
    const rq = newRoadQuery();
    for (const b of ajvatovciMap.buildings!.filter((b) =>
      VILLAGE_FIX.added.includes(b.id),
    )) {
      // Every corner stays off the stage road (village barns stand right at its edge).
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const x = b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2;
        const z = b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2;
        world.road.query(x, z, rq);
        expect(
          rq.found && rq.distance < rq.halfWidth + 0.5,
          `${b.id} on the road`,
        ).toBe(false);
      }
    }
  });

  test('village trees stand where the canopy model has them; greenhouses and pools are placed', () => {
    expect(ajvatovciMap.realTrees!.trees.length / 3).toBeGreaterThan(400);
    const props = ajvatovciMap.props.map((p) => p.asset);
    expect(
      props.filter((a) => a === 'greenhouse_tunnel').length,
    ).toBeGreaterThan(4);
    expect(props.filter((a) => a === 'swimming_pool').length).toBeGreaterThan(
      2,
    );
  });

  test('the added buildings are drawn as their own models (village farms landmark), each on its terrace', () => {
    expect(ajvatovciMap.landmarks).toContain('ajvatovci-village-farms');
    const farms = world.landmarks.find(
      (l) => l.id === 'ajvatovci-village-farms',
    )!;
    for (const id of VILLAGE_FIX.added)
      expect(
        farms.replaces({ id } as (typeof ajvatovciMap.buildings)[number]),
        `${id} has a model`,
      ).toBe(true);
    expect(farms.colliders(world.analytic).length).toBe(
      VILLAGE_FIX.added.length,
    );
    // Each stands on its terrace: never buried, the plinth down to the ground all round and never tall.
    for (const { b } of FARMS) {
      const { base, foot } = fitOf(b, world.analytic);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const hs = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(
        ([u, v]) =>
          world.analytic.height(
            b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2,
            b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2,
          ) - base,
      );
      for (const h of hs) {
        expect(h, `${b.id} buried`).toBeLessThan(0.2);
        expect(h, `${b.id} plinth`).toBeGreaterThan(foot);
        expect(h, `${b.id} tall plinth`).toBeGreaterThan(-1);
      }
    }
  });

  test('the young orchard, the vineyard beside it and the village gardens have their own cover', () => {
    const lc = world.gen.landcover!;
    const [x0, z0, x1, z1, x2, z2, x3, z3] = ORCHARD_POLY;
    expect(lc.coverAt((x0 + x1 + x2 + x3) / 4, (z0 + z1 + z2 + z3) / 4)).toBe(
      'young_orchard',
    );
    expect(lc.coverAt(1710, -216)).toBe('vineyard');
    // The gardens are only the village's own cut of the one baked built-up zone.
    const village = ajvatovciMap.buildings.filter(
      (b) => b.x > 300 && b.x < 1700 && b.z > -400 && b.z < 40,
    );
    const covers = new Set(village.map((b) => lc.coverAt(b.x, b.z)));
    expect(covers.has('garden')).toBe(true);
    expect(lc.coverAt(5000, 5000)).not.toBe('garden');
  });
});
