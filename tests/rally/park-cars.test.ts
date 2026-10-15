import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import { TEAM_COUNT } from '../../src/games/rally/assets/builders/teams';
import { ALL_CARS } from '../../src/games/rally/cars';
import { CARS_LIST } from '../../src/games/rally/release';
import { PARK_CAR_IDS, parkCarId } from '../../src/games/rally/world/park-cars';

/**
 * The service park's team cars: the released GLB cars, each with a cheap copy of its model
 * (public/models/cars/<id>_park.glb, scripts/car-model/park-lods.mjs) in three LODs.
 */
const DIR = 'public/models/cars';
const DROPPED = /^(interior|cage|lining|src:int:)/;

interface Gltf {
  nodes: { name: string; mesh?: number }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices: number;
      material: number;
    }[];
  }[];
  materials: { name: string }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
}

function readGlb(file: string): Gltf {
  const b = readFileSync(`${DIR}/${file}`);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
}

/** Triangles and bounding box ([lo, hi]) of the meshes of the nodes `take` accepts. */
function measure(
  g: Gltf,
  take: (node: string, material: string) => boolean,
): { tris: number; lo: number[]; hi: number[] } {
  const out = {
    tris: 0,
    lo: [Infinity, Infinity, Infinity],
    hi: [-Infinity, -Infinity, -Infinity],
  };
  for (const n of g.nodes) {
    if (n.mesh === undefined) continue;
    for (const p of g.meshes[n.mesh].primitives) {
      if (!take(n.name, g.materials?.[p.material]?.name ?? '')) continue;
      out.tris += g.accessors[p.indices].count / 3;
      const a = g.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) {
        out.lo[k] = Math.min(out.lo[k], a.min![k]);
        out.hi[k] = Math.max(out.hi[k], a.max![k]);
      }
    }
  }
  return out;
}

describe('service park cars', () => {
  test('released GLB cars with a livery atlas, each listed once', () => {
    expect(new Set(PARK_CAR_IDS).size).toBe(PARK_CAR_IDS.length);
    for (const id of PARK_CAR_IDS) {
      const def = ALL_CARS.find((c) => c.id === id);
      expect(def, id).toBeDefined();
      expect(def!.model.gltf?.atlas, id).toBeDefined();
      expect(CARS_LIST.find((c) => c.id === id)?.hideInProd, id).toBeFalsy();
    }
  });

  test('every team runs a park car', () => {
    for (let team = 0; team < 2 * TEAM_COUNT; team++)
      expect(PARK_CAR_IDS).toContain(parkCarId(team));
    expect(new Set([...Array(TEAM_COUNT).keys()].map(parkCarId)).size).toBe(
      PARK_CAR_IDS.length,
    );
  });

  describe.each(PARK_CAR_IDS)('%s', (id) => {
    test('has a park model', () => {
      expect(existsSync(`${DIR}/${id}_park.glb`)).toBe(true);
    });

    test('three LODs within their triangle budgets, the same size as the car', () => {
      const park = readGlb(`${id}_park.glb`);
      const full = measure(readGlb(`${id}.glb`), (_, m) => !DROPPED.test(m));
      const lods = [0, 1, 2].map((l) => measure(park, (n) => n === `lod${l}`));
      const rims = [0, 1, 2].map((l) => measure(park, (n) => n === `rim${l}`));
      for (const l of lods) expect(l.tris).toBeGreaterThan(300);
      expect(lods[0].tris).toBeLessThanOrEqual(8000);
      expect(lods[1].tris).toBeLessThanOrEqual(2600);
      expect(lods[2].tris).toBeLessThanOrEqual(1300);
      expect(rims[0].tris).toBeLessThanOrEqual(800);
      expect(rims[1].tris).toBeLessThanOrEqual(80);
      expect(rims[2].tris).toBeLessThanOrEqual(60);
      // Length and width as the full model (an antenna may drop out of the height); coarser LODs keep it within 20 cm.
      for (const k of [0, 2]) {
        expect(Math.abs(lods[0].lo[k] - full.lo[k])).toBeLessThan(0.05);
        expect(Math.abs(lods[0].hi[k] - full.hi[k])).toBeLessThan(0.05);
      }
      expect(Math.abs(lods[0].hi[1] - full.hi[1])).toBeLessThan(0.3);
      for (const l of [1, 2])
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(lods[l].lo[k] - lods[0].lo[k])).toBeLessThan(0.2);
          expect(Math.abs(lods[l].hi[k] - lods[0].hi[k])).toBeLessThan(0.2);
        }
    });
  });
});
