import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import { ASSET_CATALOG } from '../../src/games/rally/assets/catalog';
import { getAsset, getVariantSet } from '../../src/games/rally/assets/library';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * Variant sets (all variants of an asset in one geometry, picked per instance): each variant's triangles must be
 * exactly the ones `getAsset` builds for it, so a variant-set mesh draws the same thing as the per-variant meshes.
 */
describe('variant sets', () => {
  const sets = ASSET_CATALOG.filter((a) => a.category !== 'textures').flatMap(
    (a) => a.lods.map((_, lod) => [a.id, lod] as const),
  );

  test('several assets use them', () => {
    const used = sets.filter(([id, lod]) => getVariantSet(id, lod));
    expect(used.length).toBeGreaterThan(10);
  });

  test.each(sets)('%s lod %i: same triangles per variant', (id, lod) => {
    const set = getVariantSet(id, lod);
    if (!set) return;
    const meta = ASSET_CATALOG.find((a) => a.id === id)!;
    for (let v = 0; v < meta.variants; v++) {
      const expected = getAsset(id, v, lod).parts.reduce((n, p) => {
        const g = p.geometry;
        return n + (g.index ? g.index.count : g.getAttribute('position').count);
      }, 0);
      let got = 0;
      for (const p of set.parts) {
        const ids = p.geometry.getAttribute('variantId');
        for (let i = 0; i < ids.count; i++) if (ids.getX(i) === v) got++;
      }
      expect(got).toBe(expected);
    }
  });
});
