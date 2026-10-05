import { describe, expect, test } from '@rstest/core';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { hilltopLandmark } from '../../src/games/rally/maps/ajvatovci/hilltop';
import {
  CHURCH,
  CHURCH_OSM,
  COURT,
  COURT_OSM,
  COURT_SIZE,
  HILLTOP_FLATS,
  TOWER,
  toLocal,
  toWorld,
} from '../../src/games/rally/maps/ajvatovci/hilltop/site';
import {
  benches,
  COURTYARD,
  DRIVE_WIDTH,
  driveDistance,
  drivePoints,
  FENCE,
  FLOWER_BEDS,
  FORECOURT,
  GATES,
  inPolygon,
  inCourtyard,
  TENT_HALF,
  TENTS,
  WALL,
  wallPieces,
} from '../../src/games/rally/maps/ajvatovci/hilltop/yard';
import {
  CHURCH_RECT,
  PORCH_RECT,
  TOWER_RECT,
} from '../../src/games/rally/maps/ajvatovci/hilltop/site';
import { Vector3 } from 'three';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * The hilltop landmark of Ajvatovci Hill (maps/ajvatovci/hilltop): the church, its bell tower and the
 * playground court. Layout + physics only (geometry needs the browser).
 */
describe('ajvatovci hilltop', () => {
  const world = new World(ajvatovciMap);

  test('site frames match the OSM outlines', () => {
    // The church body's south wall (local z = 3.1) runs along the OSM outline's notch edge (v = 1.1).
    const notch = toLocal(CHURCH, ...CHURCH_OSM[3]);
    expect(Math.abs(notch[1] - 3.0)).toBeLessThan(0.15);
    // The court frame's corners are the OSM corners.
    for (const [x, z] of COURT_OSM) {
      const [lx, lz] = toLocal(COURT, x, z);
      expect(Math.abs(Math.abs(lx) - COURT_SIZE.length / 2)).toBeLessThan(0.05);
      expect(Math.abs(Math.abs(lz) - COURT_SIZE.width / 2)).toBeLessThan(0.05);
    }
    const [wx, wz] = toWorld(TOWER, 0, 0);
    expect(Math.hypot(wx - 1494.25, wz + 513.3)).toBeLessThan(0.1);
  });

  test('the courtyard: no placeholder boxes, lawn + paved drive surfaces, no map viewer labels', () => {
    const placed = world.buildings.buildings.map((b) => b.id);
    // Church 1031, bell tower 1029, the hall 1034 and the houses round it.
    for (const id of [
      1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032, 1033, 1034,
    ])
      expect(placed, `building ${id}`).not.toContain(id);
    for (const b of world.buildings.buildings)
      expect(inCourtyard(b.x, b.z), `building ${b.id}`).toBe(false);
    expect(hilltopLandmark.surfaceAt!(1497, -524)).toBe('grass');
    const mid = drivePoints()[Math.floor(drivePoints().length / 2)];
    expect(hilltopLandmark.surfaceAt!(...mid)).toBe('tarmac');
    expect(hilltopLandmark.surfaceAt!(COURT.x, COURT.z)).toBe('tarmac');
    expect(hilltopLandmark.surfaceAt!(1470, -520)).toBeUndefined();
    const g = { height: 0, normal: new Vector3(), surface: SURFACES.rock };
    expect(world.sampleGround(...mid, g).surface).toBe(SURFACES.tarmac);
    for (const f of HILLTOP_FLATS) expect(f.label).toBe(false);
  });

  test('the gate: a barrier row across the road 15 m out, an asphalt apron, the gravel car park', () => {
    const end = world.road.at(world.road.length - 1);
    const barriers = [...world.scatter.fixedInstances()].filter(
      (i) =>
        i.asset === 'road_barrier' && Math.hypot(i.x - end.x, i.z - end.z) < 30,
    );
    // Only the row across the road: the parking aisle's junction row (on the apron) is gone.
    expect(barriers.length).toBe(4);
    const q = newRoadQuery();
    const g0 = GATES[0];
    for (const b of barriers) {
      // On the road, 10-20 m out from the gate.
      expect(world.road.query(b.x, b.z, q).found).toBe(true);
      expect(q.distance).toBeLessThan(q.halfWidth + 1.5);
      const d = Math.hypot(b.x - g0.x, b.z - g0.z);
      expect(d).toBeGreaterThan(10);
      expect(d).toBeLessThan(20);
    }
    // The row closes the whole road: 4 x 2.2 m across a <= 7.4 m road + verges, past the finish.
    expect(world.road.length - 11).toBeGreaterThan(world.stage.finish + 100);
    expect(
      [...world.scatter.fixedInstances()].filter(
        (i) => i.asset === 'spectator' && inPolygon(FORECOURT, i.x, i.z),
      ).length,
    ).toBe(0);
    const g = { height: 0, normal: new Vector3(), surface: SURFACES.rock };
    expect(world.sampleGround(end.x, end.z, g).surface).toBe(SURFACES.tarmac);
    expect(world.sampleGround(1522, -580, g).surface).toBe(SURFACES.gravel);
    // The stage road keeps its own surface up to the apron (only the traced car park is gravel).
    const p = world.road.at(world.road.length - 30);
    expect(world.sampleGround(p.x, p.z, g).surface).toBe(SURFACES.tarmac_gravel);
  });

  test('the wall: 0.3 m above the ground (the front fence base 0.9 m), closed but for the gates', () => {
    const pieces = wallPieces((x, z) => world.analytic.height(x, z));
    expect(pieces.length).toBeGreaterThan(80);
    let length = 0;
    for (const p of pieces) {
      length += p.length;
      // Level on the highest ground under the piece (stepped down the slope).
      const h = world.analytic.height(p.x, p.z);
      const above = p.front ? FENCE.base : WALL.height;
      expect(p.y1 - h).toBeGreaterThanOrEqual(above - 0.01);
    }
    const perimeter = COURTYARD.reduce((s, a, i) => {
      const b = COURTYARD[(i + 1) % COURTYARD.length];
      return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }, 0);
    const gates = GATES.reduce((s, g) => s + g.width, 0);
    expect(Math.abs(perimeter - gates - length)).toBeLessThan(0.5);
    expect(pieces.filter((p) => p.front).length).toBeGreaterThan(15);
    // The stage road ends at the car park gate: no wall piece across it.
    const end = world.road.at(world.road.length - 1);
    for (const p of pieces)
      expect(
        Math.hypot(p.x - end.x, p.z - end.z) - p.length / 2,
      ).toBeGreaterThan(2.4);
  });

  test('the lawn under the church + tower and the court terrace are level', () => {
    const level = (site: typeof CHURCH, xs: number[], zs: number[]) => {
      const hs = xs.flatMap((x) =>
        zs.map((z) => world.analytic.height(...toWorld(site, x, z))),
      );
      return Math.max(...hs) - Math.min(...hs);
    };
    expect(level(CHURCH, [-5.7, 0, 7.1], [-3.6, 0, 6.0])).toBeLessThan(0.05);
    expect(level(TOWER, [-2, 2], [-2, 2])).toBeLessThan(0.05);
    // The court's playing area (28 x 15 m lines); the slab's east corner dips onto the stage road's bank.
    expect(level(COURT, [-14, 0, 14], [-7.5, 0, 7.5])).toBeLessThan(0.05);
  });

  test('levelled discs and colliders stay off the stage road', () => {
    const q = newRoadQuery();
    for (const f of HILLTOP_FLATS) {
      // Sample the disc's blend rim: the road must be clear of it (the pads must not tilt the road).
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
        const x = f.x + Math.cos(a) * (f.radius + f.blend);
        const z = f.z + Math.sin(a) * (f.radius + f.blend);
        const r = world.road.query(x, z, q);
        if (r.found)
          expect(r.distance, `${f.name} rim`).toBeGreaterThan(r.halfWidth);
      }
    }
    for (const c of hilltopLandmark.colliders(world.analytic)) {
      const r = world.road.query(c.x, c.z, q);
      if (r.found)
        expect(r.distance - c.r, 'collider off the road').toBeGreaterThan(
          r.halfWidth + 1,
        );
    }
  });

  test('plants, marquees, benches and flower beds keep clear of the buildings and the drive', () => {
    const solid = (x: number, z: number, m: number) =>
      (
        [
          [CHURCH, CHURCH_RECT],
          [CHURCH, PORCH_RECT],
          [TOWER, TOWER_RECT],
        ] as const
      ).some(([site, r]) => {
        const [lx, lz] = toLocal(site, x, z);
        return lx > r[0] - m && lx < r[1] + m && lz > r[2] - m && lz < r[3] + m;
      });
    const instances = hilltopLandmark.instances(world.analytic);
    expect(instances.length).toBeGreaterThan(400);
    for (const p of instances) {
      expect(solid(p.x, p.z, -0.3), p.asset).toBe(false);
      if (inCourtyard(p.x, p.z))
        expect(driveDistance(p.x, p.z), p.asset).toBeGreaterThan(
          DRIVE_WIDTH / 2,
        );
      expect(Number.isFinite(p.y)).toBe(true);
    }
    const items: [string, number, number, number][] = [
      ...TENTS.map((t): [string, number, number, number] => [
        'tent',
        t.x,
        t.z,
        TENT_HALF * 1.42,
      ]),
      ...benches().map((b): [string, number, number, number] => [
        'bench',
        b.x,
        b.z,
        1,
      ]),
      ...FLOWER_BEDS.map(([x, z]): [string, number, number, number] => [
        'bed',
        x,
        z,
        0.8,
      ]),
    ];
    for (const [name, x, z, r] of items) {
      expect(inCourtyard(x, z, -r), `${name} in the courtyard`).toBe(true);
      expect(solid(x, z, r), `${name} off the church`).toBe(false);
      expect(driveDistance(x, z), `${name} off the drive`).toBeGreaterThan(
        DRIVE_WIDTH / 2 + r,
      );
    }
    // ...and the scatter keeps out of them.
    expect(hilltopLandmark.occupies(CHURCH.x, CHURCH.z, 0)).toBe(true);
    expect(hilltopLandmark.occupies(COURT.x, COURT.z, 0)).toBe(true);
  });
});
