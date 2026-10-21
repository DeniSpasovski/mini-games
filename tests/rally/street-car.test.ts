import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import { STREET_CAR_COUNT } from '../../src/games/rally/assets/builders/street-car-models';
import {
  ambulance,
  fireTruck,
  fireTruckMk,
  policeCar,
  STREET_CAR_FIXED,
  STREET_CAR_MIX,
  streetCar,
  taxi,
} from '../../src/games/rally/assets/builders/vehicles';
import { getAssetMeta } from '../../src/games/rally/assets/catalog';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * City-map street cars are the pack models with their own triangles (assets/builders/street-car-models.ts): a full model
 * up close, ~2k triangles at LOD 1 and ~1k far away, since a city map parks hundreds of them.
 */
const tris = (b: ReturnType<typeof streetCar>) =>
  b.parts.reduce(
    (n, p) => n + p.geometry.getAttribute('position').count / 3,
    0,
  );

describe('street cars', () => {
  test.each([0, 3, 5, 9, 10, 11, 12])(
    'variant %i: one part, within budget',
    (variant) => {
      const near = streetCar({ seed: 1, variant, lod: 0 });
      const mid = streetCar({ seed: 1, variant, lod: 1 });
      const far = streetCar({ seed: 1, variant, lod: 2 });
      expect(near.parts.length).toBe(1);
      expect(tris(near)).toBeLessThan(9000);
      expect(tris(near)).toBeGreaterThan(3000);
      expect(tris(mid)).toBeLessThan(2500);
      expect(tris(far)).toBeLessThan(1500);
    },
  );

  test('variants: the models, then the cars a map places (white hatch, dark sedan, white minivan)', () => {
    expect(STREET_CAR_COUNT).toBe(10);
    expect(STREET_CAR_FIXED).toBe(10);
    expect(getAssetMeta('street_car').variants).toBe(STREET_CAR_COUNT + 3);
    expect(Math.max(...STREET_CAR_MIX)).toBeLessThan(STREET_CAR_COUNT);
    expect(Math.min(...STREET_CAR_MIX)).toBeGreaterThanOrEqual(0);
  });

  test('ambulance: a pack model plus its stripes and lettering', () => {
    const near = ambulance({ seed: 1, variant: 0, lod: 0 });
    expect(near.parts.length).toBe(2);
    expect(tris(near)).toBeLessThan(8500);
    expect(tris(ambulance({ seed: 1, variant: 0, lod: 1 }))).toBeLessThan(2400);
    const far = ambulance({ seed: 1, variant: 0, lod: 2 });
    expect(far.parts.length).toBe(1);
    expect(tris(far)).toBeLessThan(1700);
  });

  test('fire engines: their own models, one part, a few thousand triangles at LOD 1', () => {
    for (const [b, id, near] of [
      [fireTruck, 'fire_truck', 25000],
      [fireTruckMk, 'fire_truck_mk', 13000],
    ] as const) {
      const lod0 = b({ seed: 1, variant: 0, lod: 0 });
      expect(lod0.parts.length, id).toBe(1);
      expect(lod0.parts[0].geometry.getAttribute('uv'), id).toBeDefined();
      expect(lod0.parts[0].geometry.getAttribute('color'), id).toBeUndefined();
      expect(tris(lod0), id).toBeLessThan(near);
      expect(tris(lod0), id).toBeGreaterThan(8000);
      expect(tris(b({ seed: 1, variant: 0, lod: 1 })), id).toBeLessThan(4600);
      expect(tris(b({ seed: 1, variant: 0, lod: 2 })), id).toBeLessThan(3700);
    }
  });

  test('fire engines face +X, stand on the ground and have their real size', () => {
    for (const [b, id, length] of [
      [fireTruck, 'fire_truck', 9],
      [fireTruckMk, 'fire_truck_mk', 8],
    ] as const) {
      const g = b({ seed: 1, variant: 0, lod: 1 }).parts[0].geometry;
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y, id).toBeCloseTo(0, 1);
      expect(box.max.x - box.min.x, id).toBeCloseTo(length, 0);
      expect(box.max.z - box.min.z, id).toBeLessThan(3);
      expect(box.max.y, id).toBeLessThan(3.5);
      // The cab (low, nose) is at +X, the ladder and the bodywork behind: the highest points sit behind the middle.
      const pos = g.getAttribute('position');
      let topX = 0;
      let top = 0;
      for (let i = 0; i < pos.count; i++)
        if (pos.getY(i) > top) {
          top = pos.getY(i);
          topX = pos.getX(i);
        }
      expect(topX, id).toBeLessThan(2);
    }
  });

  test('taxi and police car: the model plus its add-ons', () => {
    for (const b of [taxi, policeCar]) {
      const near = b({ seed: 1, variant: 0, lod: 0 });
      expect(near.parts.length).toBe(2);
      expect(tris(near)).toBeLessThan(9500);
    }
    expect(taxi({ seed: 1, variant: 0, lod: 2 }).parts.length).toBe(1);
  });
});
