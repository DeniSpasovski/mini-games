import { describe, expect, test } from '@rstest/core';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Other roads of real-world maps (motorway, village streets, tracks) are real roads:
 * flat across, smooth along (not the bumpy elevation model) and free of grass.
 */
describe.each(
  ALL_MAPS.filter((m) => m.paths?.length).map((m) => [m.id, m] as const),
)('side roads %s', (_id, map) => {
  const world = new World(map);
  const gen = world.gen;
  const net = gen.paths!;
  const pq = newPathQuery();
  const rq = newRoadQuery();
  const pt = { x: 0, z: 0 };
  // Dense city street grids (hundreds of crossings, bridge approach ramps) step by a few tens of cm
  // where roads cross at slightly different heights: looser limits than a village / mountain map
  // (a map with many roads in its free-drive background, e.g. ajvatovci, keeps the strict ones).
  const city = !!map.cityStreets;
  const maxAcross = city ? 0.35 : 0.1;
  const maxBump = city ? 0.8 : 0.3;

  /** Short ground ways between bridge decks (interchange approach stubs): tied to the deck ends, not free roads. */
  const stub = (pi: number): boolean => {
    if (net.lengths[pi] > 60) return false;
    const end = { x: 0, z: 0 };
    return [0, net.lengths[pi]].some((a) => {
      net.pointAt(pi, a, end);
      const q = net.query(
        end.x,
        end.z,
        pq,
        undefined,
        (qi) => !!net.paths[qi].bridge,
      );
      return q.found && q.distance <= q.halfWidth + 3;
    });
  };

  /**
   * Inside the flat verge of a mainline carriageway (2 m beyond its edge): the carriageway wins there, a street the
   * data draws over that edge (the service road at the rim of a sunken parkway) is not flat across it.
   */
  const inVerge = (x: number, z: number): boolean => {
    const q = net.query(x, z, pq, 'tarmac', (qi) => gen.isCarriageway(qi));
    return q.found && q.distance - q.halfWidth <= 2.5;
  };

  /** Calls fn at every `step` m of each road, away from the stage road and other roads' crossings. */
  function along(step: number, fn: (pi: number, a: number) => void) {
    net.paths.forEach((p, pi) => {
      // Bridge decks are not ground: the terrain under them is something else. Railways have a ballast hump
      // (railways.test.ts).
      if (p.width < 3 || p.bridge || p.kind === 'rail' || stub(pi)) return;
      for (let a = 0; a <= net.lengths[pi]; a += step) {
        net.pointAt(pi, a, pt);
        if (net.query(pt.x, pt.z, pq).path !== pi) continue;
        if (
          gen.road.query(pt.x, pt.z, rq).found &&
          rq.distance < rq.halfWidth + 30
        )
          continue;
        if (!gen.isCarriageway(pi) && inVerge(pt.x, pt.z)) continue;
        fn(pi, a);
      }
    });
  }

  test('flat across', () => {
    let worst = 0;
    let at = '';
    const t0 = { x: 0, z: 0 };
    const t1 = { x: 0, z: 0 };
    along(5, (pi, a) => {
      const hw = net.paths[pi].width / 2 - 0.3;
      // On a junction plaza / area the street is its surface (no ribbon of its own): crossfall is allowed there.
      if (gen.plazas.inside(pt.x, pt.z, 2)) return;
      const c = gen.height(pt.x, pt.z);
      // Probe both sides, perpendicular to the road (straight parts: in tight corners the
      // inside edge belongs to another point along the road and may be a little higher).
      net.pointAt(pi, a - 6, t0);
      net.pointAt(pi, a + 6, t1);
      const ux = pt.x - t0.x;
      const uz = pt.z - t0.z;
      const vx = t1.x - pt.x;
      const vz = t1.z - pt.z;
      const cos =
        (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
      if (cos < Math.cos((20 * Math.PI) / 180)) return;
      const tl = Math.hypot(t1.x - t0.x, t1.z - t0.z) || 1;
      const nx = -(t1.z - t0.z) / tl;
      const nz = (t1.x - t0.x) / tl;
      for (const side of [-1, 1]) {
        const x = pt.x + nx * hw * side;
        const z = pt.z + nz * hw * side;
        // (another road there, or another pass of this one: a driveway that loops back beside / over itself)
        if (
          net.query(x, z, pq).path !== pi ||
          pq.distance > hw + 0.1 ||
          Math.abs(pq.along - a) > 10
        )
          continue;
        if (!gen.isCarriageway(pi) && inVerge(x, z)) continue;
        const d = Math.abs(gen.height(x, z) - c);
        if (d > worst) {
          worst = d;
          at = `${net.paths[pi].kind} @${a.toFixed(0)} m (${pt.x.toFixed(0)}, ${pt.z.toFixed(0)})`;
        }
      }
    });
    console.info(
      `[${map.id}] side roads: max height change across ${worst.toFixed(3)} m at ${at}`,
    );
    expect(worst).toBeLessThan(maxAcross);
  });

  test('smooth along (no elevation-model bumps)', () => {
    const d2: number[] = [];
    let worst = 0;
    let at = '';
    net.paths.forEach((p, pi) => {
      if (p.width < 3 || p.bridge || stub(pi)) return;
      let h1 = NaN;
      let h2 = NaN;
      for (let a = 0; a <= net.lengths[pi]; a += 1) {
        net.pointAt(pi, a, pt);
        // (not where another pass of the same way runs over / beside it)
        const own =
          net.query(pt.x, pt.z, pq).path === pi && Math.abs(pq.along - a) <= 10;
        const near =
          (gen.road.query(pt.x, pt.z, rq).found &&
            rq.distance < rq.halfWidth + 30) ||
          (!gen.isCarriageway(pi) && inVerge(pt.x, pt.z));
        if (!own || near) {
          h1 = h2 = NaN;
          continue;
        }
        const h = gen.height(pt.x, pt.z);
        if (!isNaN(h2)) {
          const v = Math.abs(h - 2 * h1 + h2);
          d2.push(v);
          if (v > worst) {
            worst = v;
            at = `${p.kind} @${a} m (${pt.x.toFixed(0)}, ${pt.z.toFixed(0)})`;
          }
        }
        h2 = h1;
        h1 = h;
      }
    });
    d2.sort((a, b) => a - b);
    const p99 = d2[Math.floor(d2.length * 0.99)];
    console.info(
      `[${map.id}] side roads: 1 m curvature p99 ${p99.toFixed(3)} m, max ${d2[d2.length - 1].toFixed(3)} m at ${at}`,
    );
    expect(p99).toBeLessThan(0.02);
    expect(d2[d2.length - 1]).toBeLessThan(maxBump);
  });

  test('no grass on side roads', () => {
    let onRoad = 0;
    let checked = 0;
    const cs = world.scatter.chunkSize;
    const seen = new Set<string>();
    along(150, () => {
      const cx = Math.floor(pt.x / cs);
      const cz = Math.floor(pt.z / cs);
      const k = `${cx},${cz}`;
      if (seen.has(k)) return;
      seen.add(k);
      // Detail layer = grass cards (solid scatter already keeps 1.5 m off; barriers are meant to be on).
      for (const inst of world.scatter.detail(cx, cz)) {
        checked++;
        const q = net.query(inst.x, inst.z, pq);
        if (q.found && q.distance < q.halfWidth) onRoad++;
      }
    });
    console.info(
      `[${map.id}] side roads: ${checked} scatter instances checked, ${onRoad} on a road`,
    );
    expect(checked).toBeGreaterThan(0);
    expect(onRoad).toBe(0);
  });
});
