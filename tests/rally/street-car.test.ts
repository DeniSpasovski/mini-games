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
 * City-map street cars are the simplified pack models (assets/builders/street-car-models.ts): one draw call each and a
 * small triangle budget, since a city map parks hundreds of them.
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
      const far = streetCar({ seed: 1, variant, lod: 1 });
      expect(near.parts.length).toBe(1);
      expect(tris(near)).toBeLessThan(1100);
      expect(tris(far)).toBeLessThan(600);
    },
  );

  test('taxi and police car', () => {
    for (const b of [taxi, policeCar]) {
      expect(b({ seed: 1, variant: 0, lod: 0 }).parts.length).toBe(1);
      expect(tris(b({ seed: 1, variant: 0, lod: 0 }))).toBeLessThan(1300);
    }
  });
});
