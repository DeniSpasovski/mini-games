import { beforeAll, describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import {
  BALLAST_H,
  MESSENGER_Y,
  RAIL_KIND,
} from '../../src/games/rally/world/railways';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';
import { stationLandmark } from '../../src/games/rally/maps/ajvatovci/station';
import {
  houseEdge,
  ISLAND_X,
  islandEdges,
  MAIN_TRACK,
  STATION,
  STATION_TRACK,
  stationLevels,
  toWorld,
  trackZ,
} from '../../src/games/rally/maps/ajvatovci/station/site';

/** Railways of Ajvatovci (MapDef.railways): the bed, the decks over the line, the catenary masts. */
describe('railways (ajvatovci)', () => {
  let world: World;
  beforeAll(() => {
    world = new World(ajvatovciMap);
  });

  test('every baked track is a rail path of the network, none joined to the stage road', () => {
    const rails = world.gen.railPaths();
    expect(rails.length).toBe(ajvatovciMap.railways!.length);
    for (const pi of rails)
      expect(world.gen.paths!.paths[pi].junction).toBe(false);
    expect(world.gen.junctions.every((j) => j.kind !== RAIL_KIND)).toBe(true);
  });

  test('the ballast bed is carved: crest on the track centre, formation at its toe', () => {
    const net = world.gen.paths!;
    const p = { x: 0, z: 0 };
    let n = 0;
    for (const pi of world.gen.railPaths()) {
      const L = net.lengths[pi];
      for (let a = 20; a < L - 20; a += 97) {
        net.pointAt(pi, a, p);
        // Away from decks and crossings only.
        if (!Number.isNaN(world.gen.otherDeckAt(p.x, p.z, 6))) continue;
        const pq = net.query(p.x, p.z, newPathQuery(), 'tarmac');
        if (pq.found && pq.distance < pq.halfWidth + 6) continue;
        const y = world.gen.pathHeight(pi, a);
        expect(
          Math.abs(world.gen.height(p.x, p.z) - y - BALLAST_H),
        ).toBeLessThan(0.12);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  test('road decks over the line clear the catenary', () => {
    const net = world.gen.paths!;
    const rails = new Set(world.gen.railPaths());
    const p = { x: 0, z: 0 };
    const q = newPathQuery();
    let crossings = 0;
    for (const pi of world.gen.deckPaths()) {
      const L = net.lengths[pi];
      for (let a = 0; a <= L; a += 1) {
        net.pointAt(pi, a, p);
        net.query(p.x, p.z, q, undefined, (i) => rails.has(i));
        if (!q.found || q.distance > 0.5) continue;
        const clear =
          world.gen.pathHeight(pi, a) - world.gen.pathHeight(q.path, q.along);
        // Deck surface - girders (1.5 m) must stay over the messenger wire.
        expect(clear - 1.5).toBeGreaterThan(MESSENGER_Y - 1.2);
        crossings++;
        a += 10;
      }
    }
    // The street bridge west of the station (OSM way 238296532), the one in the canal plain (414), the A2, ...
    expect(crossings).toBeGreaterThanOrEqual(5);
  });

  test('catenary masts stand off the roads, the tracks and the stage road', () => {
    const masts = world.catenary;
    expect(masts.length).toBeGreaterThan(100);
    const net = world.gen.paths!;
    const pq = newPathQuery();
    const rq = newRoadQuery();
    for (const m of masts) {
      net.query(m.x, m.z, pq);
      expect(pq.found && pq.distance < pq.halfWidth).toBe(false);
      world.road.query(m.x, m.z, rq);
      expect(rq.found && rq.distance < rq.halfWidth + 2).toBe(false);
    }
  });

  test('no placeholder building stands on a track', () => {
    const net = world.gen.paths!;
    const rails = new Set(world.gen.railPaths());
    const q = newPathQuery();
    for (const b of world.buildings.buildings) {
      net.query(b.x, b.z, q, undefined, (i) => rails.has(i));
      expect(q.found && q.distance < q.halfWidth).toBe(false);
    }
  });

  test('Ilinden station: platforms clear of the tracks, at platform height, building in place of its box', () => {
    // Edges 1.65 m from the track centres, an island platform ~5.7 m wide.
    for (let x = ISLAND_X[0]; x <= ISLAND_X[1]; x += 5) {
      const [a, b] = islandEdges(x);
      expect(b - a).toBeGreaterThan(4.5);
      expect(a - trackZ(STATION_TRACK, x)).toBeCloseTo(1.65, 2);
      expect(trackZ(MAIN_TRACK, x) - b).toBeCloseTo(1.65, 2);
    }
    expect(houseEdge(0)).toBeGreaterThan(8.2);
    const lv = stationLevels(world.analytic);
    const [rx, rz] = toWorld(STATION, 0, trackZ(STATION_TRACK, 0));
    const rail = world.analytic.height(rx, rz);
    expect(lv.floor - rail).toBeGreaterThan(0.4);
    expect(lv.floor - rail).toBeLessThan(0.7);
    // The forecourt is at most a few steps below the floor.
    const [fx, fz] = toWorld(STATION, 0, -10);
    expect(lv.floor - world.analytic.height(fx, fz)).toBeLessThan(1.6);
    // The OSM station box is replaced, and nothing of the station stands on the stage road.
    expect(
      (ajvatovciMap.buildings ?? []).some((b) => stationLandmark.replaces(b)),
    ).toBe(true);
    const rq = newRoadQuery();
    for (const c of stationLandmark.colliders(world.analytic)) {
      world.road.query(c.x, c.z, rq);
      expect(rq.found && rq.distance < rq.halfWidth + 3).toBe(false);
    }
    // The car stands on the island platform top.
    const [ix, iz] = toWorld(
      STATION,
      8,
      (islandEdges(8)[0] + islandEdges(8)[1]) / 2,
    );
    const out = { height: 0, normal: new Vector3(), surface: SURFACES.grass };
    expect(world.sampleGround(ix, iz, out).height).toBeCloseTo(lv.island, 1);
  });
});
