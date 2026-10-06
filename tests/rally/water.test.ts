import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { signedDistance } from '../../src/games/rally/world/lakes';
import { TerrainGenerator } from '../../src/games/rally/world/terrain-gen';
import { World } from '../../src/games/rally/world/world';

/** Canals / drains / rivers of real-world maps hold water: level across, never flowing uphill. */
describe.each(
  ALL_MAPS.filter((m) => m.paths?.some((p) => p.surface === 'water')).map(
    (m) => [m.id, m] as const,
  ),
)('water %s', (_id, map) => {
  const gen = new TerrainGenerator(map);
  const net = gen.channels!;
  const rq = newRoadQuery();
  const pq = newPathQuery();
  const cq = newPathQuery();
  const pt = { x: 0, z: 0 };

  test('water fills the channels between bed and banks', () => {
    const fails: string[] = [];
    net.paths.forEach((p, ci) => {
      const L = net.lengths[ci];
      // Shallower than a ditch (a 0.2 m brook): depth / freeboard limits scale with the channel, and roads cross it on a
      // culvert whose embankment reaches further over it.
      const s = Math.min(1, gen.channelDepth(ci) / 0.7);
      const skip = s < 1 ? 16 : 8;
      let wet = 0;
      let n = 0;
      let minDepth = Infinity;
      let minFreeboard = Infinity;
      let shallow = '';
      let low = '';
      for (let a = 0; a <= L; a += 2) {
        net.pointAt(ci, a, pt);
        // Skip road crossings (bridges / culverts hide the water).
        if (
          gen.road.query(pt.x, pt.z, rq).found &&
          rq.distance < rq.halfWidth + 12
        )
          continue;
        const sq = gen.paths?.query(pt.x, pt.z, pq);
        if (sq?.found && sq.distance < sq.halfWidth + skip) continue;
        n++;
        const w = gen.waterLevelAt(pt.x, pt.z);
        if (Number.isNaN(w)) continue;
        wet++;
        const depth = w - gen.height(pt.x, pt.z);
        if (depth < minDepth)
          [minDepth, shallow] = [
            depth,
            `${pt.x.toFixed(0)},${pt.z.toFixed(0)}`,
          ];
        // Bank top just outside the water on both sides is above the water.
        const hw = gen.channelWaterHalfWidth(ci) / 0.675;
        net.pointAt(ci, Math.min(L, a + 1), rqPt);
        const tl = Math.hypot(rqPt.x - pt.x, rqPt.z - pt.z) || 1;
        for (const s of [-1, 1]) {
          const x = pt.x + ((rqPt.z - pt.z) / tl) * hw * s;
          const z = pt.z - ((rqPt.x - pt.x) / tl) * hw * s;
          // Inside of a sharp bend the probe lands back in the channel: skip it.
          if (net.query(x, z, cq).distance < hw - 0.5) continue;
          // At a confluence the probe lands in the other channel (its water / bank slope): not this one's bank.
          const oq = net.query(x, z, cq, undefined, (qi) => qi !== ci);
          if (
            oq.found &&
            oq.distance < gen.channelWaterHalfWidth(oq.path) / 0.675
          )
            continue;
          const fb = gen.height(x, z) - w;
          if (fb < minFreeboard)
            [minFreeboard, low] = [fb, `${x.toFixed(0)},${z.toFixed(0)}`];
        }
      }
      console.info(
        `[${map.id}] ${p.kind} #${ci} ${L.toFixed(0)} m: water on ${((wet / n) * 100).toFixed(0)}% (depth >= ${minDepth.toFixed(2)} m at ${shallow}, banks >= ${minFreeboard.toFixed(2)} m above at ${low})`,
      );
      if (wet / n < 0.9 || minDepth < 0.3 * s || minFreeboard < 0.2 * s)
        fails.push(`${p.kind} #${ci}`);
    });
    expect(fails).toEqual([]);
  });

  test('water level never rises downstream', () => {
    net.paths.forEach((_, ci) => {
      const L = net.lengths[ci];
      const first = gen.channelWaterLevel(ci, 0);
      const last = gen.channelWaterLevel(ci, L);
      const dir = first >= last ? -1 : 1;
      let prev = first;
      for (let a = 1; a <= L; a += 1) {
        const w = gen.channelWaterLevel(ci, a);
        expect((w - prev) * dir).toBeGreaterThanOrEqual(-1e-3);
        prev = w;
      }
    });
  });
});

const rqPt = { x: 0, z: 0 };

/** Lakes / ponds / reservoirs: a flat water surface with a basin under it and a shore above it. */
describe.each(
  ALL_MAPS.filter((m) => m.lakes?.length).map((m) => [m.id, m] as const),
)('lakes %s', (_id, map) => {
  const gen = new TerrainGenerator(map);
  const lakes = gen.lakes!;

  test('every lake holds water up to its shore', () => {
    const fails: string[] = [];
    lakes.polys.forEach((p, li) => {
      const level = lakes.levels[li];
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k]);
        x1 = Math.max(x1, p[k]);
        z0 = Math.min(z0, p[k + 1]);
        z1 = Math.max(z1, p[k + 1]);
      }
      // Inside (2 m grid, > 3 m from the shore): open water, deeper inland.
      let wet = 0;
      let n = 0;
      let maxDepth = 0;
      for (let z = z0; z <= z1; z += 2)
        for (let x = x0; x <= x1; x += 2) {
          if (signedDistance(p, x, z) > -3) continue;
          n++;
          const w = gen.waterLevelAt(x, z);
          if (Number.isNaN(w)) continue;
          wet++;
          maxDepth = Math.max(maxDepth, w - gen.height(x, z));
        }
      // Shore ring 1.5 m outside: dry land above the water.
      let minRim = Infinity;
      const m = p.length / 2;
      for (let i = 0; i < m; i++) {
        const ax = p[i * 2];
        const az = p[i * 2 + 1];
        const bx = p[((i + 1) % m) * 2];
        const bz = p[((i + 1) % m) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        for (const side of [-1.5, 1.5]) {
          const x = (ax + bx) / 2 + ((bz - az) / L) * side;
          const z = (az + bz) / 2 - ((bx - ax) / L) * side;
          if (signedDistance(p, x, z) < 1) continue;
          minRim = Math.min(minRim, gen.height(x, z) - level);
        }
      }
      const def = map.lakes![li];
      console.info(
        `[${map.id}] ${def.kind} #${li} ${def.area ?? '?'} m²: level ${level.toFixed(1)} m, water on ${n ? ((wet / n) * 100).toFixed(0) : '-'}% (${n} pts), max depth ${maxDepth.toFixed(2)} m, shore >= ${minRim.toFixed(2)} m above`,
      );
      if ((n && wet / n < 0.95) || (n && maxDepth < 0.5) || minRim < 0.1)
        fails.push(`${def.kind} #${li}`);
    });
    expect(fails).toEqual([]);
  });

  test('a car in a lake is on mud and slowed by the water', () => {
    const world = new World(map);
    const p = lakes.polys[0];
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < p.length; k += 2) [cx, cz] = [cx + p[k], cz + p[k + 1]];
    [cx, cz] = [(cx * 2) / p.length, (cz * 2) / p.length];
    const pq = { x: cx, z: cz };
    expect(signedDistance(p, pq.x, pq.z)).toBeLessThan(0);
    expect(world.waterLevel(cx, cz)).toBeCloseTo(lakes.levels[0], 3);
    const splat = [0, 0, 0, 0];
    expect(world.gen.surfaceAt(cx, cz, splat)).toBe('mud');
  });
});
