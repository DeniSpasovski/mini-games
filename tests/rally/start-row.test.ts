import { describe, expect, test } from '@rstest/core';
import { Vector2, Vector3 } from 'three';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import {
  NORTH_FENCE,
  ORIGIN,
  roadLine,
  roadZ,
  toWorld,
} from '../../src/games/rally/maps/ajvatovci/start-row/frame';
import {
  getLayout,
  getYards,
  inside,
  MILEKS_CORNERS,
  PLOTS,
  SITE,
} from '../../src/games/rally/maps/ajvatovci/start-row/layout';
import { sx } from '../../src/games/rally/maps/ajvatovci/start-row/trace';
import { fenceRuns } from '../../src/games/rally/maps/ajvatovci/start-row/streetwork';
import type { GroundSample } from '../../src/games/rally/physics/types';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * The start row: hand-modelled lots along the industrial street (maps/ajvatovci/start-row).
 * The layout is pure data, so most of this runs in node without a GL context.
 */
const v = (c: [number, number]) => new Vector2(c[0], c[1]);
const buildings = () =>
  PLOTS.flatMap((p) => [
    p.corners.map(v),
    ...(p.annex ? [p.annex.corners.map(v)] : []),
    ...(p.more ?? []).map((m) => m.corners.map(v)),
  ]);

describe('start row layout', () => {
  const yards = getYards();

  test('every lot has a yard that contains its building', () => {
    expect(yards.length).toBe(PLOTS.length);
    for (const y of yards) {
      for (const corner of y.plot.corners)
        expect(
          // The building may touch its lot's boundary: look a decimetre inside.
          inside(
            v(corner).lerp(
              y.plot.corners
                .map(v)
                .reduce((s, p) => s.add(p), new Vector2())
                .divideScalar(y.plot.corners.length),
              0.02,
            ),
            y.polygon,
          ),
          `${y.plot.name}: building corner in its yard`,
        ).toBe(true);
    }
  });

  test('no yard contains another lot building', () => {
    for (const y of yards)
      for (const other of PLOTS) {
        if (other === y.plot) continue;
        for (const corner of other.corners)
          expect(
            inside(v(corner), y.polygon),
            `${y.plot.name} yard holds a corner of ${other.name}`,
          ).toBe(false);
      }
  });

  test('parked vehicles stand in a yard and never inside a main building', () => {
    const layout = getLayout();
    const all = Object.values(layout.vehicles).flat();
    expect(all.length).toBeGreaterThan(40);
    // Annex sheds are left out: south 5's front shed is a hall a truck is parked nose-in to.
    const solids = PLOTS.map((p) => p.corners.map(v));
    for (const p of all) {
      const at = new Vector2(p.x, p.z);
      expect(
        yards.some((y) => inside(at, y.polygon)),
        `vehicle at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is in a yard`,
      ).toBe(true);
      expect(
        solids.some((b) => inside(at, b)),
        `vehicle at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is not inside a building`,
      ).toBe(false);
    }
  });

  test('the construction site is its own lot, reached by the lane, with its machinery inside', () => {
    const site = yards.find((y) => y.plot.style === 'site')!;
    expect(site.plot.paving).toBe('gravel');
    // The lane between north 1 and north 2: a point ~20 m in from the street fence is in the site, not north 1.
    const [x0, x1] = site.plot.yard.street!;
    const x = (x0 + x1) / 2;
    const z = roadZ(x, NORTH_FENCE) - 20;
    expect(inside(new Vector2(x, z), site.polygon)).toBe(true);
    const north1 = yards.find((y) => y.plot.name === 'north 1')!;
    expect(inside(new Vector2(x, z), north1.polygon)).toBe(false);
    for (const at of [SITE.excavator.at, SITE.pile.at])
      expect(inside(v(at), site.polygon)).toBe(true);
  });

  test('the Mileks building stands behind the street fence', () => {
    for (const [x, z] of MILEKS_CORNERS)
      expect(z).toBeLessThan(roadZ(x, NORTH_FENCE));
  });

  test('neighbours share one fence: no two fence runs run on top of each other', () => {
    // Sample every fence run; no sample may lie within 0.8 m of a different lot's run.
    const lots = fenceRuns().filter((r) => r.kind === 'lot');
    const dist = (p: Vector2, line: Vector2[]) => {
      let best = Infinity;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const ab = b.clone().sub(a);
        const t = Math.max(
          0,
          Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)),
        );
        best = Math.min(best, p.distanceTo(a.clone().addScaledVector(ab, t)));
      }
      return best;
    };
    let doubles = 0;
    lots.forEach((run, i) => {
      for (let k = 1; k < run.line.length; k++)
        for (const f of [0.25, 0.5, 0.75]) {
          const p = run.line[k - 1].clone().lerp(run.line[k], f);
          if (lots.some((o, j) => j !== i && dist(p, o.line) < 0.8)) doubles++;
        }
    });
    expect(doubles).toBe(0);
  });
});

describe('start row in the world', () => {
  const world = new World(ajvatovciMap);
  const landmark = world.landmarks[0];

  test('the map registers the landmark', () => {
    expect(landmark?.id).toBe('ajvatovci-start-row');
  });

  test('every yard is level across the street', () => {
    const gen = world.gen;
    const line = roadLine(0);
    for (const y of getYards()) {
      // A point in the yard 2 m behind its frontage and the point 10 m further back, perpendicular
      // to the street: the pad is level across it (a few cm for lots skewed to the street).
      if (!y.plot.yard.street) continue;
      const [x0, x1] = y.plot.yard.street;
      const x = (x0 + x1) / 2;
      const i = line.findIndex((p) => p.x >= x);
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const dir = b.clone().sub(a).normalize();
      const north = y.plot.side === 'north' ? 1 : -1;
      const n = new Vector2(dir.y, -dir.x).multiplyScalar(north);
      const centre = line[i];
      const near = centre.clone().addScaledVector(n, 9);
      const far = centre.clone().addScaledVector(n, 19);
      if (!inside(near, y.polygon) || !inside(far, y.polygon)) continue;
      const h = (p: Vector2) => {
        const [wx, wz] = toWorld([p.x, p.y]);
        return gen.height(wx, wz);
      };
      expect(
        Math.abs(h(near) - h(far)),
        `${y.plot.name} level across the street`,
      ).toBeLessThan(0.12);
    }
  });

  test('pads sit near the road height in front of them', () => {
    const q = newRoadQuery();
    for (const y of getYards()) {
      // (The villa at the east end stands where the road turns north: the nearest road is another leg.)
      if (y.plot.name === 'north 10' || y.plot.noPad) continue;
      // The building corner nearest the street.
      const near = [...y.plot.corners].sort(
        (a, b) =>
          Math.abs(roadZ(a[0], 0) - a[1]) - Math.abs(roadZ(b[0], 0) - b[1]),
      )[0];
      const [wx, wz] = toWorld(near);
      world.road.query(wx, wz, q);
      if (!q.found) continue;
      expect(
        Math.abs(world.gen.height(wx, wz) - q.height),
        `${y.plot.name} pad vs road height`,
      ).toBeLessThan(0.8);
    }
  });

  test('placeholder buildings under the lots are hidden, the rest stay', () => {
    const all = ajvatovciMap.buildings!.length;
    const kept = world.buildings.buildings;
    expect(kept.length).toBeLessThan(all);
    expect(kept.length).toBeGreaterThan(all - 90);
    // None of the remaining ones is inside a lot building.
    const solids = buildings().map((b) => b.map((p) => v(toWorld([p.x, p.y]))));
    for (const b of kept)
      expect(
        solids.some((s) => inside(new Vector2(b.x, b.z), s)),
        `placeholder ${b.id} left inside a lot building`,
      ).toBe(false);
  });

  test('building colliders exist and, like the fences and poles, stay off the road', () => {
    const colliders = landmark.colliders(world.analytic);
    const tall = colliders.filter((c) => c.kind === 'box' && c.h >= 2.5);
    // Every building (the fences are lower; so is the foundation slab).
    const high = PLOTS.flatMap((p) => [
      p.height,
      ...(p.annex ? [p.annex.height] : []),
      ...(p.more ?? []).map((m) => m.height),
    ]).filter((h) => h > 2.4);
    // (the construction site's excavator adds one more box)
    expect(tall.length).toBeGreaterThanOrEqual(high.length);
    expect(tall.length).toBeLessThanOrEqual(high.length + 2);
    // The fences are barriers: hundreds of thin boxes, plus the poles.
    expect(colliders.filter((c) => c.h < 2.5).length).toBeGreaterThan(80);
    const q = newRoadQuery();
    for (const c of colliders) {
      const cos = Math.cos(c.rot ?? 0);
      const sin = Math.sin(c.rot ?? 0);
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const lx = sx * (c.hx ?? 0);
        const lz = sz * (c.hz ?? 0);
        // three.js yaw: local +X maps to (cos t, -sin t).
        const x = c.x + lx * cos + lz * sin;
        const z = c.z - lx * sin + lz * cos;
        world.road.query(x, z, q);
        if (q.found)
          expect(
            q.distance,
            'collider corner clear of the road edge',
          ).toBeGreaterThan(q.halfWidth + 1);
      }
    }
  });

  test('the kerb and the sidewalk are physical: the wheels feel them', () => {
    const ground = (x: number, z: number): number => {
      const g: GroundSample = {
        height: 0,
        normal: new Vector3(),
        surface: undefined as never,
      };
      return world.sampleGround(x, z, g).height;
    };
    const line = roadLine(0);
    const at = (siteX: number, lateral: number) => {
      const i = line.findIndex((p) => p.x >= siteX);
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const dir = b.clone().sub(a).normalize();
      const n = new Vector2(dir.y, -dir.x); // north
      const p = line[i].clone().addScaledVector(n, lateral);
      return ground(p.x + ORIGIN.x, p.y + ORIGIN.z);
    };
    // A stretch of kerb between two gates (image column 200 is in the middle of south 1's frontage).
    const x = sx(200);
    const road = at(x, 0);
    expect(at(x, 3.7) - road, 'north kerb').toBeGreaterThan(0.14);
    expect(at(x, 4.8) - road, 'north sidewalk').toBeGreaterThan(0.1);
    expect(at(x, 4.8) - road, 'north sidewalk').toBeLessThan(0.22);
    expect(at(x, -3.7) - road, 'south kerb').toBeGreaterThan(0.14);
    expect(Math.abs(at(x, 2) - road), 'the road itself').toBeLessThan(0.1);
    // In a gate the apron is nearly flush with the road.
    const gate = getLayout().northGates[2];
    const gx = (gate[0] + gate[1]) / 2;
    expect(at(gx, 4.8) - at(gx, 0), 'driveway apron').toBeLessThan(0.1);
  });

  test('trees and bushes are off the road and outside the buildings', () => {
    const instances = landmark.instances(world.analytic);
    expect(instances.length).toBeGreaterThan(40);
    const q = newRoadQuery();
    const solids = buildings().map((b) => b.map((p) => v(toWorld([p.x, p.y]))));
    for (const i of instances) {
      world.road.query(i.x, i.z, q);
      if (q.found)
        expect(q.distance, `${i.asset} clear of the road`).toBeGreaterThan(
          q.halfWidth + 1,
        );
      expect(
        solids.some((s) => inside(new Vector2(i.x, i.z), s)),
        `${i.asset} inside a building`,
      ).toBe(false);
    }
  });
});
