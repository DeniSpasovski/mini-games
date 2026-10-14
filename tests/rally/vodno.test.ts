import { describe, expect, test } from '@rstest/core';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import {
  FINISH,
  ROAD_LENGTH,
  START,
} from '../../src/games/rally/maps/vodno/stages';
import { VODNO_FLATS } from '../../src/games/rally/maps/vodno/landmarks';
import {
  LODGE,
  LODGE_OUTLINE,
  LOWER_NODE,
  LOWER_STATION,
  NEREZI_CHURCH,
  PLATFORM,
  SREDNO_CHURCH,
  STATION_LENGTH,
  STATION_WIDTH,
  toLocal,
  toWorld,
  UPPER_NODE,
  UPPER_STATION,
  type Site,
} from '../../src/games/rally/maps/vodno/landmarks/sites';
import {
  aerialwayLayout,
  cabinPose,
} from '../../src/games/rally/world/aerialway';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { geoToWorld } from '../../src/games/rally/world/real-data';
import { World } from '../../src/games/rally/world/world';

/**
 * Vodno Hillclimb: one stage, the owner's route from the Vodno neighbourhood to Sredno Vodno, with a run-up before the
 * start and a run-out after the finish. Landmarks (the Millennium Cross, the antenna mast, the cable car) stand where
 * OpenStreetMap has them.
 */
const map = vodnoMap;
const world = new World(map, map.stages[0]);

/** The owner's route end points (Google Maps route link). */
const ENDS = {
  start: { lat: 41.9808131, lon: 21.4219566 },
  finish: { lat: 41.9752441, lon: 21.4096439 },
};

function distTo(along: number, p: { lat: number; lon: number }) {
  const s = world.stageRoad.at(along);
  const q = geoToWorld(map.geo!, p.lat, p.lon);
  return Math.hypot(s.x - q.x, s.z - q.z);
}

describe('vodno stage', () => {
  test('the hard-coded stage ends sit on the game road and at the owner points', () => {
    expect(Math.abs(world.road.length - ROAD_LENGTH)).toBeLessThan(15);
    expect(world.stage.start).toBe(START);
    expect(world.stage.finish).toBeCloseTo(FINISH, 0);
    expect(distTo(world.stage.start, ENDS.start)).toBeLessThan(30);
    // The finish line is on the road at Sredno Vodno, a few metres from the restaurant the owner's route ends at.
    expect(distTo(world.stage.finish, ENDS.finish)).toBeLessThan(60);
  });

  test('a run-up before the start and a run-out after the finish', () => {
    expect(world.stage.start).toBeGreaterThanOrEqual(30);
    expect(world.stageRoad.length - world.stage.finish).toBeGreaterThanOrEqual(
      100,
    );
  });

  test('a climb of about 220 m over about 4 km', () => {
    const up =
      world.stageRoad.at(world.stage.finish).y -
      world.stageRoad.at(world.stage.start).y;
    const len = world.stage.finish - world.stage.start;
    expect(len).toBeGreaterThan(3900);
    expect(len).toBeLessThan(4200);
    expect(up).toBeGreaterThan(180);
    expect(up).toBeLessThan(260);
  });

  test('the hairpins get guard rails on the outside', () => {
    const rails = map.barriers ?? [];
    expect(rails.length).toBeGreaterThanOrEqual(2);
    expect(rails.every((r) => r.kind === 'guardrail')).toBe(true);
  });

  test('the landmarks stand on the ridge: cross, mast, cable car', () => {
    const ids = map.props.map((p) => p.asset);
    expect(ids).toContain('millennium_cross');
    expect(ids).toContain('antenna_mast');
    const cross = map.props.find((p) => p.asset === 'millennium_cross')!;
    const y = world.analytic.height(cross.x!, cross.z!);
    // Krstovar 1 066 m, y = 0 at the start (349 m): the DEM reads ~15 m low.
    expect(y + 349).toBeGreaterThan(1020);
    expect(y + 349).toBeLessThan(1090);
    expect(world.aerialways.length).toBe(1);
  });
});

describe('cable car layout', () => {
  const lay = world.aerialways[0];

  test('pylons between two stations, ropes clear of the ground', () => {
    expect(lay.supports[0].station).toBe(true);
    expect(lay.supports[lay.supports.length - 1].station).toBe(true);
    expect(lay.supports.length).toBeGreaterThanOrEqual(10);
    for (const rope of lay.ropes)
      for (let i = 0; i < rope.length; i += 3) {
        const clearance =
          rope[i + 1] - world.analytic.height(rope[i], rope[i + 2]);
        expect(clearance).toBeGreaterThan(4);
      }
  });

  test('cabins hang from both ropes', () => {
    expect(lay.cabins.length).toBeGreaterThanOrEqual(14);
    for (const c of lay.cabins)
      expect(c.y).toBeGreaterThan(world.analytic.height(c.x, c.z) + 3);
  });

  test('the pylons stand on the surveyed line: the three tagged towers, spans of 400 m at most', () => {
    // OSM aerialway=pylon nodes 1830721335, 12656159453, 13655015268.
    for (const [x, z] of [
      [226.8, -284.3],
      [333.6, -403.3],
      [29.1, -64.0],
    ])
      expect(
        Math.min(...lay.supports.map((p) => Math.hypot(p.x - x, p.z - z))),
      ).toBeLessThan(3);
    for (let i = 1; i < lay.supports.length; i++) {
      const a = lay.supports[i - 1];
      const b = lay.supports[i];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(402);
    }
  });

  test('the cabins run round the loop: up one rope, down the other, no jumps', () => {
    const { length, count, spacing, speed } = lay.loop;
    expect(count).toBeGreaterThanOrEqual(12);
    expect(speed).toBeCloseTo(5, 5);
    // Start of the loop = the bottom station, half way round = the top station.
    const bottom = cabinPose(lay, 0);
    const top = cabinPose(lay, length / 2);
    expect(
      Math.hypot(bottom.x - LOWER_NODE.x, bottom.z - LOWER_NODE.z),
    ).toBeLessThan(3);
    expect(Math.hypot(top.x - UPPER_NODE.x, top.z - UPPER_NODE.z)).toBeLessThan(
      3,
    );
    // Smooth along each rope (a metre of loop is a metre of rope); round a station the cabin crosses to the other rope,
    // inside the station building (the two ropes hang 4.2 m apart).
    let prev = cabinPose(lay, 0);
    for (let u = 1; u <= length; u += 1) {
      const c = cabinPose(lay, u);
      const atStation = Math.abs(u - length / 2) < 1.5 || u > length - 1.5;
      if (!atStation)
        expect(
          Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z),
        ).toBeLessThan(2.6);
      prev = c;
    }
    const wrap = cabinPose(lay, length + 40);
    const same = cabinPose(lay, 40);
    expect(Math.hypot(wrap.x - same.x, wrap.z - same.z)).toBeLessThan(1e-6);
    // The cabins are spread evenly, half of them going up.
    let up = 0;
    for (let i = 0; i < count; i++) if (i * spacing < length / 2) up++;
    expect(Math.abs(up - count / 2)).toBeLessThanOrEqual(1);
    // The up rope is the left one, the down rope the right one (they hang on opposite sides of the line).
    const a = cabinPose(lay, 400);
    const b = cabinPose(lay, length - 400);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3);
  });

  test('flat ground: pylons are plain 20 m towers, the rope sags between them', () => {
    const flat = aerialwayLayout(
      { name: 't', line: [0, 0, 500, 0], pylonEvery: 125 },
      () => 0,
    );
    expect(flat.supports.length).toBe(5);
    for (const s of flat.supports.slice(1, -1)) expect(s.scale).toBe(1);
    const mid = flat.ropes[0].filter((_, i) => i % 3 === 1);
    expect(Math.min(...mid)).toBeLessThan(flat.supports[1].head);
  });
});

describe('vodno landmarks (churches, platform, stations, towers)', () => {
  const ids = [
    'vodno-sredno-vodno',
    'vodno-summit',
    'vodno-nerezi',
    'vodno-outposts',
  ];

  test('registered on the map and in the world', () => {
    expect(map.landmarks).toEqual(ids);
    expect(world.landmarks.map((l) => l.id)).toEqual(ids);
    for (const f of VODNO_FLATS) expect(f.label).toBe(false);
  });

  test('sites sit on the OSM points', () => {
    // The ropes' end nodes: the lower station's up-line end wall is 1 m past its node, the upper station holds its node.
    const lower = toLocal(LOWER_STATION, LOWER_NODE.x, LOWER_NODE.z);
    expect(Math.abs(lower[0] - (STATION_LENGTH / 2 - 1))).toBeLessThan(0.2);
    expect(Math.abs(lower[1])).toBeLessThan(0.2);
    const upper = toLocal(UPPER_STATION, UPPER_NODE.x, UPPER_NODE.z);
    expect(Math.abs(upper[0])).toBeLessThan(STATION_LENGTH / 2);
    expect(Math.abs(upper[1])).toBeLessThan(STATION_WIDTH / 2);
    // The cross stands in the middle of its platform.
    const cross = map.props.find((p) => p.asset === 'millennium_cross')!;
    expect(
      Math.hypot(cross.x! - PLATFORM.x, cross.z! - PLATFORM.z),
    ).toBeLessThan(2);
    // The lodge outline fits inside its levelled pad.
    for (const [x, z] of LODGE_OUTLINE)
      expect(Math.hypot(x, z)).toBeLessThan(12);
  });

  test('the placeholder boxes under them are gone, the neighbours stay', () => {
    const placed = world.buildings.buildings;
    const near = (x: number, z: number, r: number) =>
      placed.filter((b) => Math.hypot(b.x - x, b.z - z) < r);
    for (const [site, r] of [
      [SREDNO_CHURCH, 5],
      [PLATFORM, 9],
      [LODGE, 6],
      [NEREZI_CHURCH, 6],
    ] as const)
      expect(near(site.x, site.z, r).length, `${site.x}`).toBe(0);
    const total = (map.buildings ?? []).length;
    // A handful of boxes (the church, the platform, the lodge, the shelters, the station box), not a district.
    expect(total - placed.length).toBeGreaterThan(5);
    expect(total - placed.length).toBeLessThan(40);
  });

  test('the levelled pads under the structures are level', () => {
    const level = (site: Site, pts: [number, number][]) => {
      const hs = pts.map(([x, z]) =>
        world.analytic.height(...toWorld(site, x, z)),
      );
      return Math.max(...hs) - Math.min(...hs);
    };
    const box = (
      x0: number,
      x1: number,
      z0: number,
      z1: number,
    ): [number, number][] => [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
      [(x0 + x1) / 2, (z0 + z1) / 2],
    ];
    // [name, site, points, tolerance (m)]: a road beside the upper station cuts into its pad.
    const cases: [string, Site, [number, number][], number][] = [
      ['sredno church', SREDNO_CHURCH, box(-12.5, 5, -6, 6), 0.1],
      ['upper station', UPPER_STATION, box(-7, 7, -2.5, 2.5), 1.2],
      ['lower station', LOWER_STATION, box(-7, 7, -2.5, 2.5), 0.1],
      ['platform', PLATFORM, box(-12, 12, -12, 12), 0.1],
      ['nerezi', NEREZI_CHURCH, box(-8, 7.7, -4.8, 4.8), 0.1],
    ];
    for (const [name, site, pts, tol] of cases)
      expect(level(site, pts), name).toBeLessThan(tol);
  });

  test('levelled pads and colliders stay off the stage road', () => {
    const q = newRoadQuery();
    for (const f of VODNO_FLATS)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
        const r = world.road.query(
          f.x + Math.cos(a) * (f.radius + f.blend),
          f.z + Math.sin(a) * (f.radius + f.blend),
          q,
        );
        if (r.found)
          expect(r.distance, `${f.name} rim`).toBeGreaterThan(r.halfWidth);
      }
    for (const l of world.landmarks)
      for (const c of l.colliders(world.analytic)) {
        const r = world.road.query(c.x, c.z, q);
        if (r.found)
          expect(r.distance - c.r, `${l.id} collider`).toBeGreaterThan(
            r.halfWidth + 1,
          );
      }
  });

  test('scatter stays off them and the plants are finite', () => {
    for (const l of world.landmarks) {
      expect(l.occupies(PLATFORM.x, PLATFORM.z, 0)).toBe(
        l.id === 'vodno-summit',
      );
      for (const p of l.instances(world.analytic)) {
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.x)).toBe(true);
      }
    }
  });
});
