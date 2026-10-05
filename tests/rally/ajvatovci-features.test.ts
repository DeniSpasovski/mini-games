import { describe, expect, test } from '@rstest/core';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { World } from '../../src/games/rally/world/world';

/**
 * Ajvatovci Hill round 2 (2026-10-04): the traced orchard, the canal bridge, power lines, A2 barriers,
 * village dressing.
 */
const world = new World(ajvatovciMap);

describe('ajvatovci', () => {
  test('the dense orchard south of the farmland road is orchard land cover (~60 ha)', () => {
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
        if (lc.coverAt(x, z) === 'orchard') cells++;
      }
    const ha = (cells * d.cell * d.cell) / 1e4;
    console.info(`[ajvatovci] orchard ${ha.toFixed(0)} ha`);
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
});
