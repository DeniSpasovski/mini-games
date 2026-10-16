import { describe, expect, test } from '@rstest/core';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import {
  FINISH,
  ROAD_LENGTH,
  START,
} from '../../src/games/rally/maps/vodno/stages';
import {
  carParksLandmark,
  VODNO_FLATS,
} from '../../src/games/rally/maps/vodno/landmarks';
import {
  lotShape,
  onLot,
  SREDNO,
  stairsAnchor,
  SREDNO_BUS,
  VIDIKOVEC,
} from '../../src/games/rally/maps/vodno/landmarks/car-parks';
import {
  gardenPolygon,
  GAZEBO_BUILDING,
  parkColliders,
  parkPieces,
  parkPlants,
  stoneRoad,
} from '../../src/games/rally/maps/vodno/landmarks/lot-park';
import { LOT_ROADS } from '../../src/games/rally/maps/vodno/landmarks/lot-road';
import { LOT_PADS } from '../../src/games/rally/maps/vodno/lots';
import { SKYLINE } from '../../src/games/rally/maps/vodno/skyline';
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
import {
  geoToWorld,
  newPathQuery,
} from '../../src/games/rally/world/real-data';
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
    'vodno-car-parks',
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

describe('vodno car parks', () => {
  const lots = {
    vidikovec: VIDIKOVEC,
    sredno: SREDNO,
    'sredno small': SREDNO_BUS,
  };

  test('the baked road line under the lots is the game road', () => {
    // Re-sample ./landmarks/lot-road.ts when the road changes: the lots keep their distance from it.
    const q = newRoadQuery();
    for (const line of LOT_ROADS)
      for (let i = 0; i < line.length; i += 2) {
        const r = world.road.query(line[i], line[i + 1], q);
        expect(
          r.found && r.distance < 0.4,
          `(${line[i]}, ${line[i + 1]})`,
        ).toBe(true);
      }
  });

  test('the stage road has priority: no lot edge on it, every edge off its shoulder', () => {
    const q = newRoadQuery();
    for (const [name, lot] of Object.entries(lots)) {
      const { left, right } = lotShape(lot);
      for (const p of [...left, ...right]) {
        const [x, z] = toWorld(lot.site, p[0], p[1]);
        const r = world.road.query(x, z, q);
        if (r.found)
          expect(
            r.distance - r.halfWidth,
            `${name} (${x}, ${z})`,
          ).toBeGreaterThan(0.5);
      }
    }
  });

  test('the slab and its levelled pad are one outline: a point inside the slab is inside the pad polygon', () => {
    for (const [name, lot] of Object.entries(lots)) {
      const { centre } = lotShape(lot);
      const mid = centre[centre.length >> 1];
      const [x, z] = toWorld(lot.site, mid[0], mid[1]);
      expect(onLot(lot, x, z), name).toBe(true);
    }
    expect(LOT_PADS.map((p) => p.name)).toEqual([
      'vidikovec_lot',
      'vidikovec_garden_2',
      'vidikovec_garden_1',
      'vidikovec_garden_ramp',
      'sredno_lot',
      'sredno_bus_lot',
    ]);
  });

  test('the two Sredno lots are straight bands: parallel long sides, west ends on one line, east ends cut by the road', () => {
    const big = lotShape(SREDNO);
    const low = lotShape(SREDNO_BUS);
    // Same frame, so the far ends (local x) must agree.
    expect(
      Math.abs(
        big.centre[big.centre.length - 1][0] -
          low.centre[low.centre.length - 1][0],
      ),
    ).toBeLessThan(0.3);
    for (const s of [big, low]) {
      const from = Math.floor(s.left.length * 0.4);
      const to = Math.floor(s.left.length * 0.95);
      for (const edge of [s.left, s.right]) {
        const z0 = edge[from][1];
        for (let i = from; i < to; i++)
          expect(Math.abs(edge[i][1] - z0)).toBeLessThan(0.05);
      }
    }
    // The road leaves the east ends narrower than the bands.
    for (const s of [big, low])
      expect(s.hl[0] * 2).toBeLessThan(s.hl[s.hl.length >> 1] * 2 - 4);
    // The lower lot lies south of the top one with land between.
    expect(low.left[low.left.length >> 1][1]).toBeLessThan(
      big.left[big.left.length >> 1][1] - 5,
    );
  });
});

describe('vodno car park surroundings', () => {
  const q = newRoadQuery();

  test('nothing stands on or beside the stage road: every piece and tree is clear of its edge', () => {
    for (const lot of [SREDNO, VIDIKOVEC]) {
      const spots = [
        ...parkPieces(lot).map((p) => [p.x, p.z] as const),
        ...parkPlants(lot).map((p) => [p.x, p.z] as const),
      ];
      expect(spots.length).toBeGreaterThan(10);
      for (const [lx, lz] of spots) {
        const [x, z] = toWorld(lot.site, lx, lz);
        const r = world.road.query(x, z, q);
        if (r.found)
          expect(r.distance - r.halfWidth, `(${x}, ${z})`).toBeGreaterThan(1.2);
      }
    }
  });

  test('pieces that stand on the asphalt are on the slab, the park ones are off it', () => {
    for (const p of parkPieces(VIDIKOVEC)) {
      const [x, z] = toWorld(VIDIKOVEC.site, p.x, p.z);
      expect(onLot(VIDIKOVEC, x, z), `${p.kind} (${x}, ${z})`).toBe(!!p.onSlab);
    }
    for (const p of parkPieces(SREDNO)) {
      const [x, z] = toWorld(SREDNO.site, p.x, p.z);
      expect(onLot(SREDNO, x, z), `${p.kind} (${x}, ${z})`).toBe(false);
    }
  });

  test('the two watch towers stand in the far-left corner of the Sredno lot, against its asphalt', () => {
    const { left, right, centre } = lotShape(SREDNO);
    const n = centre.length;
    const towers = parkPieces(SREDNO).filter((p) => p.kind === 'tower');
    expect(towers.length).toBe(2);
    const a = left[n - 1];
    const b = right[n - 1];
    /** Distance from (x, z) to the lot's far end (the cap across the strip). */
    const toEnd = (x: number, z: number): number => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)),
      );
      return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    };
    const end = centre[n - 1];
    const prev = centre[n - 4];
    const tl = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
    const tx = (end[0] - prev[0]) / tl;
    const tz = (end[1] - prev[1]) / tl;
    for (const t of towers) {
      expect(toEnd(t.x, t.z), 'touches the asphalt').toBeLessThan(3.5);
      // Offset from the lot's axis: negative = the left of the way up the lot (the hillside corner).
      const lateral = (t.x - end[0]) * -tz + (t.z - end[1]) * tx;
      expect(lateral, 'in the left half').toBeLessThan(0);
    }
    // The pavilions sit back from the lot.
    for (const p of parkPieces(SREDNO).filter((q) => q.kind === 'pavilion'))
      expect(toEnd(p.x, p.z)).toBeGreaterThan(4);
  });

  test('the stone road runs from the park entrance to the lower cable car station', () => {
    const line = stoneRoad();
    expect(line.length).toBeGreaterThan(40);
    // It starts where the entrance path between the towers ends (past the far end of the top lot), and ends at the station.
    const [sx, sz] = toLocal(SREDNO.site, LOWER_STATION.x, LOWER_STATION.z);
    const last = line[line.length - 1];
    expect(Math.hypot(last[0] - sx, last[1] - sz)).toBeLessThan(8);
    expect(line[0][0]).toBeGreaterThan(70);
    // Every step is about 2 m, no jumps.
    for (let i = 1; i < line.length; i++)
      expect(
        Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]),
      ).toBeLessThan(2.1);
  });

  test('stairs go down from the mid parking through its wall to the garden, inside the garden span', () => {
    const a = stairsAnchor(VIDIKOVEC)!;
    expect(a).toBeTruthy();
    // (the slab's edge point itself may fall either side of its outline: take one 40 cm in)
    const [wx, wz] = toWorld(
      VIDIKOVEC.site,
      a.p[0] - a.n[0] * 0.4,
      a.p[1] - a.n[1] * 0.4,
    );
    expect(onLot(VIDIKOVEC, wx, wz)).toBe(true);
    // The garden's first terrace lies straight out from the stairs: its outline contains the point 3 m out.
    const out = toWorld(
      VIDIKOVEC.site,
      a.p[0] + a.n[0] * 3,
      a.p[1] + a.n[1] * 3,
    );
    const poly = gardenPolygon(0).map(([x, z]) =>
      toWorld(VIDIKOVEC.site, x, z),
    );
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[j];
      if (
        az > out[1] !== bz > out[1] &&
        out[0] < ((bx - ax) * (out[1] - az)) / (bz - az) + ax
      )
        inside = !inside;
    }
    expect(inside).toBe(true);
  });

  test('the garden terraces and the park strip are painted lush grass terrain, not decals', () => {
    const lawns = vodnoMap.terrain.lawns!;
    expect(lawns.length).toBe(4);
    const out = new Float32Array(4);
    for (const poly of lawns) {
      // The polygon's vertex mean (a thin strip: inside enough for the feather).
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < poly.length; i += 2) {
        cx += poly[i];
        cz += poly[i + 1];
      }
      cx /= poly.length / 2;
      cz /= poly.length / 2;
      world.gen.splat(cx, cz, 0, Infinity, 0, out);
      expect(out[0], 'pure grass').toBeGreaterThan(0.97);
      expect(out[1] + out[2] + out[3]).toBeLessThan(0.03);
    }
  });

  test('a car can hit the lamps, towers and containers', () => {
    const kinds = (lot: typeof SREDNO) => parkColliders(lot, () => 0).length;
    expect(kinds(SREDNO)).toBeGreaterThan(10);
    expect(kinds(VIDIKOVEC)).toBeGreaterThan(8);
  });

  test('the gazebo stands where OSM has a building: the landmark replaces it', () => {
    const b = (world.map.buildings ?? []).find(
      (o) => Math.hypot(o.x - GAZEBO_BUILDING.x, o.z - GAZEBO_BUILDING.z) < 1.5,
    );
    expect(b).toBeTruthy();
    expect(carParksLandmark.replaces(b!)).toBe(true);
  });

  test('the approach to the Vidikovec has a rusty guard rail on its drop and white edge lines', () => {
    const rails = (map.barriers ?? []).filter((b) => b.kind === 'guardrail');
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((b) => b.rusty)).toBe(true);
    expect(
      rails.some((b) => b.side === 'right' && b.from === 2600 && b.to === 2796),
    ).toBe(true);
    const lines = map.road.sections?.filter(
      (s) => s.texture === 'road_tarmac_lines',
    );
    expect(lines?.length).toBe(1);
  });

  test('the service road that merges above the finish ends level with the summit road', () => {
    const net = world.gen.paths!;
    const near = (x: number, z: number) =>
      net.paths.findIndex((p) =>
        p.pts.some(
          (_, k) =>
            k % 2 === 0 && Math.hypot(p.pts[k] - x, p.pts[k + 1] - z) < 1,
        ),
      );
    const si = near(435.3, -535.1);
    expect(si).toBeGreaterThanOrEqual(0);
    const L = net.lengths[si];
    const e = { x: 0, z: 0 };
    net.pointAt(si, L, e);
    const pq = newPathQuery();
    net.query(e.x, e.z, pq, undefined, (i) => i !== si);
    expect(pq.found).toBe(true);
    expect(
      Math.abs(
        world.gen.pathHeight(si, L) - world.gen.pathHeight(pq.path, pq.along),
      ),
    ).toBeLessThan(0.05);
  });
});

describe('vodno skyline', () => {
  const area = (pts: number[]): number => {
    let a = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
    }
    return Math.abs(a / 2);
  };
  const centre = (pts: number[]): [number, number] => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < pts.length; i += 2) {
      x += pts[i];
      z += pts[i + 1];
    }
    return [(x * 2) / pts.length, (z * 2) / pts.length];
  };

  test('every building is a real footprint beyond the baked box, with a height and floors', () => {
    const b = map.bounds;
    for (const s of SKYLINE) {
      expect(s.footprint.length, s.name).toBeGreaterThanOrEqual(8);
      expect(area(s.footprint), s.name).toBeGreaterThan(300);
      expect(s.height, s.name).toBeGreaterThan(5);
      const [x, z] = centre(s.footprint);
      const outside = x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
      expect(outside, `${s.name} stands outside the baked box`).toBe(true);
    }
  });

  test('the towers stand where Wikipedia puts them: Cevahir Sky City and the MRT tower', () => {
    const at = (name: string, lat: number, lon: number, tol: number) => {
      const s = SKYLINE.find((b) => b.name === name)!;
      const [x, z] = centre(s.footprint);
      const q = geoToWorld(map.geo!, lat, lon);
      expect(Math.hypot(x - q.x, z - q.z), name).toBeLessThan(tol);
    };
    at('Cevahir tower B', 41.97972, 21.46611, 160);
    at('MRT tower', 41.9972, 21.4447, 60);
    const heights = SKYLINE.filter((b) => b.name?.startsWith('Cevahir tower'));
    expect(heights.length).toBe(4);
    for (const t of heights) expect(t.floors).toBe(42);
    const mrt = SKYLINE.find((b) => b.name === 'MRT tower')!;
    expect(mrt.height).toBe(70);
    expect(mrt.floors).toBe(25);
  });
});
