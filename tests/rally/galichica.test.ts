import { describe, expect, test } from '@rstest/core';
import { galichicaMap } from '../../src/games/rally/maps/galichica/map';
import { geoToWorld } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { World } from '../../src/games/rally/world/world';

/**
 * Galichica: one map, three stages on one road (maps/galichica/stages.ts). The stage ends sit at the owner's points,
 * each stage runs its own way, and the world is the same whichever stage is driven.
 */
const map = galichicaMap;
const stage = (id: string) => map.stages.find((s) => s.id === id)!;
const worlds = Object.fromEntries(
  map.stages.map((s) => [s.id, new World(map, s)]),
);

/** The owner's stage end points (Google Maps route links): park entrance, Magaro parking, Prespa. */
const ENDS = {
  park: { lat: 40.9440267, lon: 20.789616 },
  magaro: { lat: 40.9537817, lon: 20.8289773 },
  prespa: { lat: 40.9612712, lon: 20.8976721 },
};

function distTo(w: World, along: number, p: { lat: number; lon: number }) {
  const s = w.stageRoad.at(along);
  const q = geoToWorld(map.geo!, p.lat, p.lon);
  return Math.hypot(s.x - q.x, s.z - q.z);
}

describe('galichica stages', () => {
  test('starts and finishes at the owner points (within 60 m)', () => {
    const w = worlds.galichica_west;
    expect(distTo(w, w.stage.start, ENDS.park)).toBeLessThan(60);
    expect(distTo(w, w.stage.finish, ENDS.magaro)).toBeLessThan(60);
    const e = worlds.galichica_east;
    expect(distTo(e, e.stage.start, ENDS.prespa)).toBeLessThan(60);
    expect(distTo(e, e.stage.finish, ENDS.magaro)).toBeLessThan(60);
    const x = worlds.prespa_ohrid;
    expect(distTo(x, x.stage.start, ENDS.prespa)).toBeLessThan(60);
    expect(distTo(x, x.stage.finish, ENDS.park)).toBeLessThan(60);
  });

  test('every stage has a run-up before the start and >= 100 m of road after the finish', () => {
    for (const w of Object.values(worlds)) {
      expect(w.stage.start).toBeGreaterThanOrEqual(30);
      expect(w.stageRoad.length - w.stage.finish).toBeGreaterThanOrEqual(100);
    }
  });

  test('the climbs climb, the crossing goes over the pass and back down', () => {
    const up = (w: World) =>
      w.stageRoad.at(w.stage.finish).y - w.stageRoad.at(w.stage.start).y;
    expect(up(worlds.galichica_west)).toBeGreaterThan(500);
    expect(up(worlds.galichica_east)).toBeGreaterThan(500);
    const x = worlds.prespa_ohrid;
    let top = -Infinity;
    for (let d = x.stage.start; d < x.stage.finish; d += 50)
      top = Math.max(top, x.stageRoad.at(d).y);
    expect(top - x.stageRoad.at(x.stage.start).y).toBeGreaterThan(600);
    expect(Math.abs(up(x))).toBeLessThan(100);
    expect(stage('galichica_east').reverse).toBe(true);
  });

  test('the world is the same for every stage (only the event layer differs)', () => {
    const [a, b, c] = Object.values(worlds);
    for (const [x, z] of [
      [0, 0],
      [-3000, 800],
      [2500, -400],
      [-1347, 133],
    ]) {
      const h = a.gen.height(x, z);
      expect(b.gen.height(x, z)).toBe(h);
      expect(c.gen.height(x, z)).toBe(h);
    }
    expect(b.road.samples.length).toBe(a.road.samples.length);
    expect(a.road.at(5000)).toEqual(c.road.at(5000));
  });

  test('a reverse stage road is the same line driven the other way', () => {
    const w = worlds.prespa_ohrid;
    const L = w.road.length;
    const q = newRoadQuery();
    for (const d of [500, 7000, 15000]) {
      const s = w.stageRoad.at(d);
      const f = w.road.at(L - d);
      expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeLessThan(0.01);
      expect(s.tx).toBeCloseTo(-f.tx, 5);
      w.stageRoad.query(s.x + s.tz * 2, s.z - s.tx * 2, q);
      expect(q.lateral).toBeCloseTo(2, 1);
      expect(q.along).toBeCloseTo(d, 0);
    }
  });

  test('closures only along each stage', () => {
    const west = worlds.galichica_west.junctionInstances().length;
    const all = worlds.prespa_ohrid.junctionInstances().length;
    expect(all).toBeGreaterThanOrEqual(west);
  });
});
