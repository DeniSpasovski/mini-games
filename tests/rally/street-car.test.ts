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
 * City-map street cars are the boxy rally cars (cars/shared/profile-body.ts): one draw call each and a small
 * triangle budget, since a city map parks hundreds of them.
 */
const tris = (b: ReturnType<typeof streetCar>) =>
  b.parts.reduce(
    (n, p) => n + p.geometry.getAttribute('position').count / 3,
    0,
  );

describe('street cars', () => {
  test.each([0, 1, 2, 3, 12])(
    'variant %i: one part, within budget',
    (variant) => {
      const near = streetCar({ seed: 1, variant, lod: 0 });
      const far = streetCar({ seed: 1, variant, lod: 1 });
      expect(near.parts.length).toBe(1);
      expect(tris(near)).toBeLessThan(500);
      expect(tris(far)).toBeLessThan(160);
    },
  );

  test('taxi and police car', () => {
    for (const b of [taxi, policeCar]) {
      expect(b({ seed: 1, variant: 0, lod: 0 }).parts.length).toBe(1);
      expect(tris(b({ seed: 1, variant: 0, lod: 0 }))).toBeLessThan(600);
    }
  });
});
