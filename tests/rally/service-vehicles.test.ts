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
import {
  serviceVehicleModel,
  streetCarIndex,
  streetCarModel,
} from '../../src/games/rally/assets/builders/street-car-models';
import { TEAM_COUNT } from '../../src/games/rally/assets/builders/teams';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * The vans and trucks of pack 7 (baked by scripts/car-model/bake-street-cars.mjs --vans) and the service park /
 * start-row vehicles built from them: faces +X, on the ground under the middle, a small triangle budget.
 */
const tris = (b: ReturnType<typeof serviceVan>) =>
  b.parts.reduce(
    (n, p) => n + p.geometry.getAttribute('position').count / 3,
    0,
  );

describe('service vehicle models', () => {
  test.each(SERVICE_VEHICLE_DATA.map((d) => d.id))('%s', (id) => {
    for (const lod of [0, 1]) {
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
      expect(p.count / 3).toBeLessThan(lod ? 600 : 1300);
      // The split is the whole model: a paint part (white) and the rest.
      const { paint, fixed } = m.parts(1);
      expect(paint.getAttribute('position').count).toBeGreaterThan(30);
      expect(fixed.getAttribute('position').count).toBeGreaterThan(30);
      expect(
        paint.getAttribute('position').count +
          fixed.getAttribute('position').count,
      ).toBe(p.count);
    }
  });

  test('parts scale about the ground point', () => {
    const m = streetCarModel(streetCarIndex('pickup'), 0);
    const one = m.parts(1).fixed.getAttribute('position');
    const big = m.parts(1.1).fixed.getAttribute('position');
    expect(big.getY(0)).toBeCloseTo(one.getY(0) * 1.1, 4);
    expect(big.getX(0)).toBeCloseTo(one.getX(0) * 1.1, 4);
  });
});

describe('team vehicles of the service park', () => {
  test.each([
    ['service_truck', serviceTruck],
    ['service_van', serviceVan],
    ['pickup', pickup],
  ])('%s: one draw call per team, within budget', (_, build) => {
    for (let team = 0; team < TEAM_COUNT; team++) {
      const near = build({ seed: 1, variant: team, lod: 0 });
      const far = build({ seed: 1, variant: team, lod: 1 });
      expect(near.parts.length).toBe(1);
      expect(tris(near)).toBeLessThan(1700);
      expect(tris(far)).toBeLessThan(900);
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
      expect(near.parts.length).toBe(1);
      expect(tris(near)).toBeLessThan(1400);
    }
  });
});
