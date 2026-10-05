import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { ALL_MAPS } from '../../src/games/rally/maps';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';
import { roadSurfaceAt } from '../../src/games/rally/maps/shared/types';
import type { StaticCollider } from '../../src/games/rally/physics/types';

describe.each(ALL_MAPS.map((m) => [m.id, m] as const))('map %s', (_id, map) => {
  const t0 = performance.now();
  const world = new World(map);
  const buildMs = performance.now() - t0;

  test('road is a sensible length', () => {
    console.info(
      `[${map.id}] road ${world.road.length.toFixed(0)} m, world init ${buildMs.toFixed(0)} ms`,
    );
    expect(world.road.length).toBeGreaterThan(300);
    expect(world.stage.finish).toBeGreaterThan(world.stage.start);
  });

  test('road grade stays drivable', () => {
    const s = world.road.samples;
    let max = 0;
    let at = 0;
    for (let i = 5; i < s.length; i += 5) {
      const g = Math.abs(s[i].y - s[i - 5].y) / 5;
      if (g > max) [max, at] = [g, s[i].dist];
    }
    console.info(
      `[${map.id}] max road grade ${(max * 100).toFixed(1)}% at ${at.toFixed(0)} m`,
    );
    // Crest jumps (dy) are allowed to be steep briefly.
    expect(max).toBeLessThan(0.3);
  });

  test('road spline has no loops or kinks', () => {
    // Samples are 1 m apart along the curve; a small loop between badly spaced control
    // points shows up as samples bunched together (along-distance without movement).
    const s = world.road.samples;
    let worst = 1;
    let at = 0;
    for (let i = 1; i < s.length; i++) {
      const step = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
      const ratio = step / (s[i].dist - s[i - 1].dist);
      if (Math.abs(1 - ratio) > Math.abs(1 - worst))
        [worst, at] = [ratio, s[i].dist];
    }
    if (Math.abs(1 - worst) > 0.3)
      console.info(
        `[${map.id}] spline kink at ${at.toFixed(0)} m (step ratio ${worst.toFixed(2)})`,
      );
    expect(Math.abs(1 - worst)).toBeLessThan(0.3);
  });

  test('heightfield matches the generator at grid points', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -33],
      [-200, 150],
      [63, 64],
    ]) {
      expect(world.heightAt(x, z)).toBeCloseTo(world.gen.height(x, z), 4);
    }
  });

  test('road surface is flat across its width and gravel', () => {
    const s = { height: 0, normal: new Vector3(), surface: null as never };
    for (let along = 20; along < world.road.length - 20; along += 37) {
      const c = world.road.at(along);
      const lx = c.tz * (c.halfWidth - 0.5);
      const lz = -c.tx * (c.halfWidth - 0.5);
      const hc = world.heightAt(c.x, c.z);
      const hl = world.heightAt(c.x + lx, c.z + lz);
      const hr = world.heightAt(c.x - lx, c.z - lz);
      expect(Math.abs(hc - hl)).toBeLessThan(0.15);
      expect(Math.abs(hc - hr)).toBeLessThan(0.15);
      world.sampleGround(c.x, c.z, s);
      expect((s.surface as { id: string }).id).toBe(
        roadSurfaceAt(map.road, c.dist).surface,
      );
    }
  });

  test('no solid scatter on the road', () => {
    const out: StaticCollider[] = [];
    const q = newRoadQuery();
    // The stage up to 100 m past the finish; beyond that the run-out may be closed on purpose
    // (ajvatovci: a barrier row across the road before the monastery gate).
    for (let along = 0; along < world.stage.finish + 100; along += 10) {
      const c = world.road.at(along);
      const n = world.queryColliders(c.x, c.z, 12, out);
      for (let i = 0; i < n; i++) {
        const col = out[i];
        // Parapets of an overpass crossing above the road are solid up there, not on the road.
        world.road.query(col.x, col.z, q);
        if (q.found && col.y > q.height + 2.5) continue;
        if (col.kind === 'box') {
          // Buildings: every point of the footprint outline must be off the road.
          const [hx, hz] = [col.hx ?? 0, col.hz ?? 0];
          const [cs, sn] = [Math.cos(col.rot ?? 0), Math.sin(col.rot ?? 0)];
          for (let t = 0; t < 1; t += 0.05)
            for (const [lx, lz] of [
              [-hx + 2 * hx * t, -hz],
              [-hx + 2 * hx * t, hz],
              [-hx, -hz + 2 * hz * t],
              [hx, -hz + 2 * hz * t],
            ]) {
              world.road.query(
                col.x + lx * cs + lz * sn,
                col.z - lx * sn + lz * cs,
                q,
              );
              if (q.found)
                expect(q.distance).toBeGreaterThan(q.halfWidth - 0.05);
            }
          continue;
        }
        world.road.query(col.x, col.z, q);
        // Arches span the road on purpose; their posts sit outside the edge.
        if (q.found)
          expect(q.distance - col.r).toBeGreaterThan(q.halfWidth - 0.05);
      }
    }
  });

  test('car settles on the road at the start and can drive', () => {
    const v = new Vehicle(
      ALL_CARS.find((c) => c.id === 'skoda_rally')!.physics,
      world,
    );
    const spawn = world.roadSpawn();
    v.reset(spawn.position, spawn.heading);
    for (let i = 0; i < PHYSICS_HZ * 2; i++) v.step(1 / PHYSICS_HZ);
    expect(v.wheels.every((w) => w.contact)).toBe(true);
    expect(v.velocity.length()).toBeLessThan(0.5);
    v.controls.throttle = 0.6;
    const t1 = performance.now();
    for (let i = 0; i < PHYSICS_HZ * 3; i++) v.step(1 / PHYSICS_HZ);
    const ms = (performance.now() - t1) / (PHYSICS_HZ * 3);
    console.info(
      `[${map.id}] physics step on world: ${(ms * 1000).toFixed(0)} µs`,
    );
    expect(v.position.distanceTo(spawn.position)).toBeGreaterThan(10);
    expect(v.up.y).toBeGreaterThan(0.9);
  });

  test('print control point distances (for placing roadside props)', () => {
    const q = newRoadQuery();
    const rows = map.road.points.map((p, i) => {
      const [x, z] = Array.isArray(p) ? p : [p.x, p.z];
      world.road.query(x, z, q);
      return `#${i} (${x},${z}) along=${q.along.toFixed(0)} y=${q.height.toFixed(1)}`;
    });
    console.info(`[${map.id}] control points\n${rows.join('\n')}`);
  });
});
