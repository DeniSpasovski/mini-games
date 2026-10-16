import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import {
  getAssetMeta,
  SPECTATOR_FLAG_FROM,
  SPECTATOR_SEATED_COUNT,
  SPECTATOR_SEATED_FROM,
} from '../../src/games/rally/assets/catalog';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { TEAM_COUNT } from '../../src/games/rally/assets/builders/teams';
import {
  lotContains,
  lotWorld,
} from '../../src/games/rally/maps/shared/service-lot';
import { isTreeType } from '../../src/games/rally/trees/species';
import { newPathQuery } from '../../src/games/rally/world/real-data';
import { newRoadQuery } from '../../src/games/rally/world/road';
import { SERVICE_PARK_ASSETS } from '../../src/games/rally/world/service-park';
import { World } from '../../src/games/rally/world/world';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import type { GroundSample } from '../../src/games/rally/physics/types';

const PEOPLE = new Set([
  'spectator',
  'mechanic',
  'crew',
  'driver',
  'marshal',
  'photographer',
  'visitor',
]);

describe('service park (Ajvatovci start)', () => {
  const world = new World(ajvatovciMap);
  const park = world.servicePark!;
  const def = world.stageDef.servicePark!;

  test('the stage has a park with at least ten team bays', () => {
    expect(park).toBeDefined();
    expect(def.bays).toBeGreaterThanOrEqual(10);
    expect(park.bays).toBeGreaterThanOrEqual(10);
    expect(park.instances.filter((i) => i.asset === 'team_car').length).toBe(
      park.instances.filter((i) => i.asset === 'ground_sheet').length -
        // Works bays hold two cars on two sheets; every car stands on one.
        0,
    );
  });

  test('only park assets, all in the catalog; the streamer list is complete', () => {
    for (const i of park.instances) {
      expect(SERVICE_PARK_ASSETS).toContain(i.asset);
      expect(getAssetMeta(i.asset).variants).toBeGreaterThan(i.variant);
      for (const n of [i.x, i.y, i.z, i.rotY])
        expect(Number.isFinite(n)).toBe(true);
    }
    for (const id of SERVICE_PARK_ASSETS)
      expect(getAssetMeta(id)).toBeDefined();
  });

  test('the field lot faces the factory road, the team semis stand in a yard behind it', () => {
    const [field, yard] = [def.lots[1], def.lots[2]];
    const semis = park.instances.filter((i) => i.asset === 'service_semi');
    expect(semis.length).toBe(yard.semis);
    const cars = park.instances.filter(
      (i) => i.asset === 'team_car' && lotContains(field, i.x, i.z, 0.5),
    );
    expect(cars.length).toBeGreaterThan(2);
    // The semis are inside the yard (a truck yard has no bays, tape or crowd) and further from the road than every car.
    for (const s of semis) {
      expect(lotContains(yard, s.x, s.z)).toBe(true);
      for (const c of cars) expect(s.x).toBeLessThan(c.x - 12);
    }
    expect(
      park.instances.filter(
        (i) => i.asset !== 'service_semi' && lotContains(yard, i.x, i.z, 0.5),
      ),
    ).toEqual([]);
    // Close to the road: the public edge is within 14 m of a path's edge.
    const pq = newPathQuery();
    const [ex, ez] = lotWorld(field, field.length / 2, -2);
    const hit = world.gen.paths?.query(ex, ez, pq);
    expect(hit?.found).toBe(true);
    expect(pq.distance - pq.halfWidth).toBeLessThan(14);
  });

  test('deterministic: the same stage gives the same park', () => {
    const again = new World(ajvatovciMap).servicePark!;
    expect(again.instances).toEqual(park.instances);
  });

  test('every bay piece is on the lot, on level ground', () => {
    const q = newRoadQuery();
    // Everything but the tape, crowd and the start control beside the road (inside 10 m of its centre line).
    const bayAssets = park.instances.filter((i) => {
      world.stageRoad.query(i.x, i.z, q);
      return (
        !['tape_post', 'spectator', 'photographer'].includes(i.asset) &&
        !(q.found && q.distance < 10)
      );
    });
    expect(bayAssets.length).toBeGreaterThan(100);
    const off = bayAssets
      .filter((i) => !def.lots.some((l) => lotContains(l, i.x, i.z, 0.5)))
      .map(
        (i) => `${i.asset}#${i.variant} ${i.x.toFixed(1)},${i.z.toFixed(1)}`,
      );
    expect(off).toEqual([]);
    // A car's four corners: within 0.35 m of each other (the pad follows the road's grade only along the line).
    for (const i of park.instances.filter((p) => p.asset === 'team_car')) {
      const c = Math.cos(i.rotY);
      const s = -Math.sin(i.rotY);
      const hs = [
        [2.3, 0.96],
        [2.3, -0.96],
        [-2.3, 0.96],
        [-2.3, -0.96],
      ].map(([u, v]) =>
        world.analytic.height(i.x + c * u - s * v, i.z + s * u + c * v),
      );
      expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.35);
    }
  });

  test('nobody stands on the stage road or its shoulder', () => {
    const q = newRoadQuery();
    for (const i of park.instances) {
      world.stageRoad.query(i.x, i.z, q);
      if (!q.found) continue;
      if (PEOPLE.has(i.asset))
        expect(q.distance).toBeGreaterThan(q.halfWidth + 1.5);
      else expect(q.distance).toBeGreaterThan(q.halfWidth + 1);
    }
  });

  test('vehicles and tents do not overlap each other', () => {
    interface Box {
      id: string;
      x: number;
      z: number;
      hx: number;
      hz: number;
      c: number;
      s: number;
    }
    const boxes: Box[] = [];
    for (const i of park.instances) {
      const col = getAssetMeta(i.asset).colliders?.find(
        (k) => k.kind === 'box' && !k.x && !k.z,
      );
      if (!col || PEOPLE.has(i.asset)) continue;
      if (
        ![
          'service_truck',
          'service_semi',
          'service_van',
          'pickup',
          'team_car',
          'car_trailer',
          'food_truck',
          'fuel_trailer',
          'ambulance',
        ].includes(i.asset)
      )
        continue;
      boxes.push({
        id: `${i.asset}@${i.x.toFixed(0)},${i.z.toFixed(0)}`,
        x: i.x,
        z: i.z,
        hx: col.hx!,
        hz: col.hz!,
        c: Math.cos(i.rotY),
        s: Math.sin(i.rotY),
      });
    }
    expect(boxes.length).toBeGreaterThan(20);
    // Separating axis test on the two boxes' own axes (local X = (c, -s), local Z = (s, c)).
    const overlap = (a: Box, b: Box): boolean => {
      for (const ax of [
        [a.c, -a.s],
        [a.s, a.c],
        [b.c, -b.s],
        [b.s, b.c],
      ]) {
        const proj = (o: Box): number =>
          o.hx * Math.abs(ax[0] * o.c - ax[1] * o.s) +
          o.hz * Math.abs(ax[0] * o.s + ax[1] * o.c);
        const d = Math.abs((b.x - a.x) * ax[0] + (b.z - a.z) * ax[1]);
        if (d > proj(a) + proj(b) - 0.05) return false;
      }
      return true;
    };
    const hits: string[] = [];
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++)
        if (overlap(boxes[a], boxes[b]))
          hits.push(`${boxes[a].id} x ${boxes[b].id}`);
    expect(hits).toEqual([]);
  });

  test('every lot is a gravel yard and nothing grows on it', () => {
    const out: GroundSample = {
      height: 0,
      normal: new Vector3(),
      surface: SURFACES.tarmac,
    };
    const cs = world.scatter.chunkSize;
    for (const lot of def.lots) {
      world.sampleGround(lot.x, lot.z, out);
      expect(out.surface.id).toBe('gravel');
      for (const [dx, dz] of [
        [0, 0],
        [30, 5],
        [-30, -5],
      ]) {
        const chunk = world.scatter.chunk(
          Math.floor((lot.x + dx) / cs),
          Math.floor((lot.z + dz) / cs),
        );
        const trees = chunk.instances.filter(
          (i) =>
            (isTreeType(i.asset) ||
              getAssetMeta(i.asset).category === 'vegetation') &&
            lotContains(lot, i.x, i.z, 1),
        );
        expect(trees).toEqual([]);
      }
    }
  });

  test('teams have room: bays keep apart, both bay lots hold teams', () => {
    for (const lot of def.lots.filter((l) => l.bays !== 0))
      expect(
        park.bayCentres.filter((b) => lotContains(lot, b.x, b.z)).length,
      ).toBeGreaterThanOrEqual(3);
    // Neighbouring bays are at least 5 m apart (the narrowest bay is 9.5 m wide, so centres >= 14.5 m in a row).
    for (const a of park.bayCentres)
      for (const b of park.bayCentres)
        if (a !== b && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) < 30)
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(13);
  });

  test('plenty of people: a crowd, visitors and at least six round every bay', () => {
    const people = park.instances.filter((i) => PEOPLE.has(i.asset));
    expect(people.length).toBeGreaterThan(250);
    for (const b of park.bayCentres) {
      const near = people.filter(
        (p) => p.asset !== 'spectator' && Math.hypot(p.x - b.x, p.z - b.z) < 11,
      );
      expect(near.length).toBeGreaterThanOrEqual(6);
    }
    // Nobody stands inside another person.
    for (let a = 0; a < people.length; a++)
      for (let c = a + 1; c < people.length; c++)
        expect(
          Math.hypot(people[a].x - people[c].x, people[a].z - people[c].z),
        ).toBeGreaterThan(0.25);
  });

  test('the crowd mixes the people kit: photographers, seated fans, only the map flag, many visitor looks', () => {
    const of = (asset: string) =>
      park.instances.filter((i) => i.asset === asset);
    expect(of('photographer').length).toBeGreaterThanOrEqual(3);
    const fans = of('spectator').map((i) => i.variant);
    expect(
      fans.some(
        (v) =>
          v >= SPECTATOR_SEATED_FROM &&
          v < SPECTATOR_SEATED_FROM + SPECTATOR_SEATED_COUNT,
      ),
    ).toBe(true);
    // Ajvatovci is North Macedonian: flag fans wave its flag (first 6), never the American one (next 6).
    expect(
      fans.some((v) => v >= SPECTATOR_FLAG_FROM && v < SPECTATOR_FLAG_FROM + 6),
    ).toBe(true);
    expect(fans.some((v) => v >= SPECTATOR_FLAG_FROM + 6)).toBe(false);
    const personas = new Set(
      of('visitor').map((i) => Math.floor(i.variant / 4)),
    );
    expect(personas.size).toBeGreaterThanOrEqual(8);
  });

  test('a raised car has its rear wheels lying beside it', () => {
    const raised = park.instances.filter(
      (i) => i.asset === 'team_car' && i.variant >= TEAM_COUNT,
    );
    expect(raised.length).toBeGreaterThan(2);
    for (const c of raised)
      expect(
        park.instances.some(
          (i) =>
            i.asset === 'tyre_stack' && Math.hypot(i.x - c.x, i.z - c.z) < 3.2,
        ),
      ).toBe(true);
  });

  test('start control: boards, tent and marshals beside the line, a rescue ambulance beyond it', () => {
    const near = (asset: string) =>
      park.instances.filter((i) => {
        if (i.asset !== asset) return false;
        world.stageRoad.query(i.x, i.z, q);
        return q.found && Math.abs(q.along - world.stage.start) < 40;
      });
    const q = newRoadQuery();
    expect(near('control_board').length).toBe(2);
    expect(near('marshal').length).toBeGreaterThanOrEqual(3);
    expect(near('ambulance').length).toBe(1);
  });
});
