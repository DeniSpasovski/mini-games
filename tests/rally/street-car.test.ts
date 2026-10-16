import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import {
  policeCar,
  streetCar,
  taxi,
} from '../../src/games/rally/assets/builders/vehicles';

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
  test.each([0, 4, 5, 9, 13, 15])(
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

  test('taxi and police car: the model plus its add-ons', () => {
    for (const b of [taxi, policeCar]) {
      const near = b({ seed: 1, variant: 0, lod: 0 });
      expect(near.parts.length).toBe(2);
      expect(tris(near)).toBeLessThan(9500);
    }
    expect(taxi({ seed: 1, variant: 0, lod: 2 }).parts.length).toBe(1);
  });
});
