import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import {
  ASSET_CATALOG,
  SPECTATOR_FLAG_COUNT,
  SPECTATOR_SEATED_COUNT,
  SPECTATOR_VARIANTS,
} from '../../src/games/rally/assets/catalog';
import { buildAsset, variantSeed } from '../../src/games/rally/assets/library';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * The people kit (assets/builders/people.ts): every role x variant builds a base body (+ what it wears, + a hand
 * flag), stands on the ground whatever its pose, is a plausible height and stays inside the triangle budget of its LOD.
 */
const ROLES = [
  'spectator',
  'mechanic',
  'crew',
  'driver',
  'marshal',
  'photographer',
  'visitor',
] as const;

const build = (id: string, variant: number, lod: number) =>
  buildAsset(id, variantSeed(id, variant), variant, lod);

/** [triangles, lowest y, highest y] of an asset's parts. */
function measure(id: string, variant: number, lod: number) {
  const a = build(id, variant, lod);
  let tris = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of a.parts) {
    const pos = p.geometry.getAttribute('position');
    tris += (p.geometry.index?.count ?? pos.count) / 3;
    for (let i = 0; i < pos.count; i++) {
      lo = Math.min(lo, pos.getY(i));
      hi = Math.max(hi, pos.getY(i));
    }
  }
  return { parts: a.parts.length, tris, lo, hi };
}

describe('people', () => {
  test('the spectator catalog count matches the builder', () => {
    expect(SPECTATOR_VARIANTS).toBe(6 * 4);
    expect(ASSET_CATALOG.find((a) => a.id === 'spectator')!.variants).toBe(
      SPECTATOR_VARIANTS + SPECTATOR_SEATED_COUNT + SPECTATOR_FLAG_COUNT,
    );
  });

  describe.each(ROLES)('%s', (id) => {
    const meta = ASSET_CATALOG.find((a) => a.id === id)!;
    const variants = Array.from({ length: meta.variants }, (_, v) => v);

    test('every variant: the body, what it wears and a flag part when waving one, feet on the ground, 0.8-2.4 m tall (arms up), within budget', () => {
      for (const v of variants) {
        const near = measure(id, v, 0);
        // The base body, the worn / held parts (one mesh) and a hand flag (its own mesh, waved by the people_flag material).
        expect(near.parts).toBeLessThanOrEqual(3);
        expect(near.parts).toBeGreaterThanOrEqual(1);
        expect(near.lo).toBeGreaterThan(-0.005);
        expect(near.lo).toBeLessThan(0.02);
        expect(near.hi).toBeGreaterThan(0.8);
        expect(near.hi).toBeLessThan(2.4);
        expect(near.tris).toBeLessThan(24000);
        expect(measure(id, v, 1).tris).toBeLessThan(9500);
        expect(measure(id, v, 2).tris).toBeLessThan(260);
        expect(measure(id, v, 3).tris).toBeLessThan(40);
      }
    });

    test('variants differ', () => {
      const keys = new Set(
        variants.map((v) => {
          const a = build(id, v, 0);
          // Counts and the sum of every coordinate: two outfits (or two heads of hair) never agree on both.
          const sum = a.parts.reduce((t, p) => {
            const pos = p.geometry.getAttribute('position').array;
            let x = 0;
            for (let i = 0; i < pos.length; i++) x += pos[i];
            return t + x;
          }, 0);
          return `${a.parts.map((p) => p.geometry.getAttribute('position').count).join(',')}:${sum.toFixed(3)}`;
        }),
      );
      expect(keys.size).toBeGreaterThan(meta.variants / 3);
    });
  });
});
