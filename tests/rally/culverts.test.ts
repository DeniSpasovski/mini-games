import { describe, expect, test } from '@rstest/core';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
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
