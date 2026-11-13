import { describe, expect, test } from '@rstest/core';
import { type BufferGeometry, type Mesh, MeshStandardMaterial } from 'three';
import { trailLotLandmark } from '../../src/games/rally/maps/vodno/landmarks';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { rockCutMeshJob } from '../../src/games/rally/world/rock-cut-mesh';
import { World } from '../../src/games/rally/world/world';

describe('Vodno rock cuts', () => {
  const world = new World(vodnoMap);
  const q = newRoadQuery();

  test('faces stand beside the road, never on it', () => {
    const job = rockCutMeshJob(world, () => new MeshStandardMaterial());
    let r = job.next();
    while (!r.done) r = job.next();
    const meshes = (r.value?.children ?? []) as Mesh[];
    expect(meshes.length).toBeGreaterThan(0);
    const edge = vodnoMap.road.shoulder;
    for (const m of meshes) {
      const p = (m.geometry as BufferGeometry).attributes.position;
      for (let i = 0; i < p.count; i++) {
        world.road.query(p.getX(i), p.getZ(i), q);
        if (q.found)
          expect(Math.abs(q.distance) - q.halfWidth).toBeGreaterThan(edge);
      }
    }
  });

  test('the carve is a steep face only where the land stands high above the road', () => {
    // On the road and with a shallow bank there is no cut.
    expect(world.gen.rockCutWeightAt(0, 0, 1, 1000)).toBe(0);
    const p = world.road.at(2050);
    const lat = (l: number) => [p.x + p.tz * l, p.z - p.tx * l] as const;
    const rise = (l: number) => {
      const [x, z] = lat(l);
      return world.gen.naturalHeight(x, z) - p.y;
    };
    // The higher side at 1110 m: a real face, steeper than 1 m per m somewhere on it.
    const s = rise(10) > rise(-10) ? 1 : -1;
    let steep = 0;
    for (let l = p.halfWidth; l < p.halfWidth + 10; l += 0.5) {
      const [x0, z0] = lat(l * s);
      const [x1, z1] = lat((l + 0.5) * s);
      steep = Math.max(
        steep,
        (world.gen.height(x1, z1) - world.gen.height(x0, z0)) / 0.5,
      );
    }
    expect(steep).toBeGreaterThan(1);
  });

  test('rock faces only on the stretches the references show (each one has its face), a low stone wall at Vidikovec', () => {
    const job = rockCutMeshJob(world, () => new MeshStandardMaterial());
    let r = job.next();
    while (!r.done) r = job.next();
    const stretches = vodnoMap.road.rockCuts!.stretches!;
    const seen = new Set<number>();
    const walls = vodnoMap.road.rockCuts!.walls!;
    for (const m of (r.value?.children ?? []) as Mesh[]) {
      const p = (m.geometry as BufferGeometry).attributes.position;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < p.count; i++) {
        world.road.query(p.getX(i), p.getZ(i), q);
        if (m.name === 'rock-cut') {
          const k = stretches.findIndex(
            (st) => q.along > st.from - 15 && q.along < st.to + 15,
          );
          expect(k, `face at ${q.along.toFixed(0)} m`).toBeGreaterThanOrEqual(
            0,
          );
          seen.add(k);
        } else {
          expect(
            walls.some((w) => q.along > w.from - 5 && q.along < w.to + 5),
            `wall at ${q.along.toFixed(0)} m`,
          ).toBe(true);
          lo = Math.min(lo, p.getY(i) - world.road.at(q.along).y);
          hi = Math.max(hi, p.getY(i) - world.road.at(q.along).y);
        }
      }
      // The wall is about its height above the road, not a cliff.
      if (m.name === 'rock-cut-wall')
        expect(hi - Math.max(lo, 0)).toBeLessThan(
          Math.max(...walls.map((w) => w.height)) + 1,
        );
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(stretches.map((_, k) => k));
  });

  test('the trail lot colliders stay off the stage road', () => {
    for (const c of trailLotLandmark.colliders(world.analytic)) {
      world.road.query(c.x, c.z, q);
      if (q.found)
        expect(Math.abs(q.distance) - q.halfWidth).toBeGreaterThan(1);
    }
  });
});
