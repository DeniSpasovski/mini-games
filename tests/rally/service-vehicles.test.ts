import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import {
  foodTruck,
  pickup,
  serviceSemi,
  serviceTow,
  serviceTruck,
  serviceVan,
} from '../../src/games/rally/assets/builders/service';
import { SERVICE_VEHICLE_DATA } from '../../src/games/rally/assets/builders/service-vehicles.data';
import { serviceVehicleModel } from '../../src/games/rally/assets/builders/street-car-models';
import { TEAM_COUNT } from '../../src/games/rally/assets/builders/teams';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * The vans and trucks of pack 7 (baked by scripts/car-model/bake-street-cars.mjs --vans, with their own textures like the
 * street cars) and the service park / start-row vehicles built from them: faces +X, on the ground under the middle, three
 * LODs (the full model, ~2k triangles, ~1.5k at most far away).
 */
const tris = (b: ReturnType<typeof serviceVan>) =>
  b.parts.reduce(
    (n, p) => n + p.geometry.getAttribute('position').count / 3,
    0,
  );

describe('service vehicle models', () => {
  test.each(SERVICE_VEHICLE_DATA.map((d) => d.id))('%s', (id) => {
    for (const lod of [0, 1, 2]) {
      const m = serviceVehicleModel(id, lod);
      const g = m.geometry('#ffffff');
      const p = g.getAttribute('position');
      let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < p.count; i++) {
        minX = Math.min(minX, p.getX(i));
        maxX = Math.max(maxX, p.getX(i));
        minY = Math.min(minY, p.getY(i));
        maxY = Math.max(maxY, p.getY(i));
      }
      expect(Math.abs(maxX - minX - m.length)).toBeLessThan(0.25);
      expect(minY).toBeCloseTo(0, 1);
      expect(maxY).toBeGreaterThan(2);
      // The nose points along +X: the bonnet end is far lower than the roof.
      let nose = 0;
      for (let i = 0; i < p.count; i++)
        if (p.getX(i) > m.length * 0.4) nose = Math.max(nose, p.getY(i));
      expect(nose).toBeLessThan(maxY - 0.4);
      expect(p.count / 3).toBeLessThan([8000, 2200, 1600][lod]);
      expect(p.count / 3).toBeGreaterThan([4000, 1200, 500][lod]);
      // One mesh: every vertex has an uv inside the atlas, the paint comes in the colour attribute.
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
      expect(g.getAttribute('color').count).toBe(p.count);
    }
  });
});

describe('team vehicles of the service park', () => {
  test.each([
    ['service_truck', serviceTruck],
    ['service_van', serviceVan],
    ['pickup', pickup],
  ])('%s: the model plus its stripes, within budget', (_, build) => {
    for (let team = 0; team < TEAM_COUNT; team++) {
      const near = build({ seed: 1, variant: team, lod: 0 });
      const mid = build({ seed: 1, variant: team, lod: 1 });
      const far = build({ seed: 1, variant: team, lod: 2 });
      expect(near.parts.length).toBe(2);
      expect(tris(near)).toBeLessThan(8200);
      expect(tris(mid)).toBeLessThan(2400);
      expect(tris(far)).toBeLessThan(1700);
    }
  });

  test('service_semi: the baked lorry model, one stand-in box far away', () => {
    for (let team = 0; team < TEAM_COUNT; team++) {
      const near = serviceSemi({ seed: 1, variant: team, lod: 0 });
      const far = serviceSemi({ seed: 1, variant: team, lod: 1 });
      // The model's own triangles (welded, never simplified), a mesh per part and texture.
      expect(near.parts.length).toBeLessThanOrEqual(4);
      expect(tris(near)).toBeLessThan(17000);
      expect(far.parts.length).toBe(1);
      expect(tris(far)).toBeLessThan(100);
    }
  });

  test('service_tow: the roll-back tow truck in one colour, one stand-in box far away', () => {
    for (let variant = 0; variant < 4; variant++) {
      const near = serviceTow({ seed: 1, variant, lod: 0 });
      const far = serviceTow({ seed: 1, variant, lod: 1 });
      expect(near.parts.length).toBeLessThanOrEqual(8);
      expect(tris(near)).toBeLessThan(22000);
      expect(far.parts.length).toBe(1);
      expect(tris(far)).toBeLessThan(100);
    }
  });

  test('the catering van', () => {
    for (let variant = 0; variant < 3; variant++) {
      const near = foodTruck({ seed: 1, variant, lod: 0 });
      expect(near.parts.length).toBe(2);
      expect(tris(near)).toBeLessThan(6500);
      expect(foodTruck({ seed: 1, variant, lod: 2 }).parts.length).toBe(1);
    }
  });
});
