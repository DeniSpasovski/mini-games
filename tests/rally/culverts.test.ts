import { describe, expect, test } from '@rstest/core';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { flowOf, waterRows } from '../../src/games/rally/world/culvert-water';
import { TerrainGenerator } from '../../src/games/rally/world/terrain-gen';

// Culverts (world/culverts.ts) carve their gullies beside the road only: the road surface and its verge keep exactly
// the heights they had without them (a road change would need a stage times bump).
describe.each([vodnoMap])('culverts on $id', (map) => {
  const without = new TerrainGenerator({ ...map, culverts: undefined });
  const gen = new TerrainGenerator(map);

  test('the baked culverts are placed', () => {
    const sites = gen.culverts;
    console.log(
      `${map.id}: ${sites.length} / ${map.culverts!.culverts.length} culverts at`,
      sites.map((s) => `${Math.round(s.along)} m (${s.diameter} m)`).join(', '),
    );
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      const [inlet, outlet] = s.ends;
      // Below the road with cover, draining downstream, walls outside the verge.
      expect(inlet.invert + s.diameter).toBeLessThan(s.y - 0.4);
      expect(outlet.invert).toBeLessThanOrEqual(inlet.invert);
      for (const e of s.ends)
        expect(e.u).toBeGreaterThan(
          gen.road.at(s.along).halfWidth + map.road.shoulder + 1,
        );
    }
  });

  test('the road and its verge do not move', () => {
    const { road } = without;
    let worst = 0;
    for (let d = 0; d <= road.length; d += 0.5) {
      const s = road.at(d);
      for (const lat of [-1, -0.5, 0, 0.5, 1]) {
        const off = lat * (s.halfWidth + map.road.shoulder);
        const x = s.x - s.tz * off;
        const z = s.z + s.tx * off;
        worst = Math.max(
          worst,
          Math.abs(without.surfaceHeight(x, z) - gen.surfaceHeight(x, z)),
        );
      }
    }
    expect(worst).toBe(0);
  });
});

// Storm water in the culverts (world/culvert-water.ts): the ribbon follows the pipe and the gully and runs only in rain.
describe('culvert water', () => {
  const gen = new TerrainGenerator(vodnoMap);

  test('every end has a water ribbon from inside the pipe out along the gully', () => {
    for (const s of gen.culverts)
      for (const e of s.ends) {
        const rows = waterRows(s, e);
        expect(rows[0].t).toBeLessThan(0);
        for (let i = 1; i < rows.length; i++)
          expect(rows[i].t).toBeGreaterThan(rows[i - 1].t);
        for (const r of rows) {
          expect(r.half).toBeGreaterThan(0);
          expect(r.depth).toBeGreaterThanOrEqual(0);
          // The water stays inside the pipe and below the headwall top.
          if (r.t <= 0.25) expect(r.level).toBeLessThan(s.diameter / 2);
        }
      }
  });

  test('the culverts run in rain, a little after it and not when dry', () => {
    expect(flowOf(0, 0)).toBe(0);
    expect(flowOf(0.6, 0)).toBeGreaterThan(0);
    expect(flowOf(0.6, 0)).toBeLessThan(flowOf(0.7, 2));
    expect(flowOf(0.7, 2)).toBeLessThan(flowOf(1, 8));
    expect(flowOf(1, 8)).toBe(1);
  });
});
