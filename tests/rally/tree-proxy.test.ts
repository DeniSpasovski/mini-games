import { describe, expect, test } from '@rstest/core';
import type { SpriteData } from '../../src/games/rally/trees/mesh';
import { crownProxy, quadSprites } from '../../src/games/rally/trees/proxy';

/** Two sprites as fans of an outline (offsets -0.5..0.5, uv = cell origin + offset * cell size). */
function sprites(): SpriteData {
  const outline = [
    [-0.3, -0.4],
    [0.35, -0.3],
    [0.4, 0.2],
    [0, 0.45],
    [-0.35, 0.1],
  ];
  const centres = [
    [0, 4, 0],
    [1.5, 6, -0.5],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const spr: number[] = [];
  const rank: number[] = [];
  const index: number[] = [];
  const ends: number[] = [];
  centres.forEach((c, j) => {
    const base = pos.length / 3;
    for (const [x, y] of outline) {
      pos.push(...c);
      nrm.push(0, 1, 0);
      uv.push(0.25 * j + (x + 0.5) * 0.25, 0.5 + (y + 0.5) * 0.25);
      col.push(1, 1, 1);
      wind.push(2, 0.1 * j, 0.5, 0.8);
      spr.push(x, y, 1.2, 0.3 * j);
      rank.push(j / 2);
    }
    for (let k = 1; k + 1 < outline.length; k++)
      index.push(base, base + k, base + k + 1);
    ends.push(index.length);
  });
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uv),
    color: new Float32Array(col),
    wind: new Float32Array(wind),
    sprite: new Float32Array(spr),
    rank: new Float32Array(rank),
    index: new Uint32Array(index),
    ends: new Uint32Array(ends),
    count: centres.length,
  };
}

describe('tree proxies', () => {
  test('quad sprites: 4 corners round each outline, its uv mapped linearly', () => {
    const s = sprites();
    const { geometry, ends } = quadSprites(s);
    expect(geometry.getAttribute('position').count).toBe(8);
    expect([...ends]).toEqual([6, 12]);
    const spr = geometry.getAttribute('treeSprite');
    const uv = geometry.getAttribute('uv');
    for (let q = 0; q < 8; q++) {
      const j = q >> 2;
      // Offsets are the outline's box; the uv follows the same linear map as the outline's.
      expect([-0.35, 0.4]).toContain(Number(spr.getX(q).toFixed(5)));
      expect([-0.4, 0.45]).toContain(Number(spr.getY(q).toFixed(5)));
      expect(uv.getX(q)).toBeCloseTo(0.25 * j + (spr.getX(q) + 0.5) * 0.25, 5);
      expect(uv.getY(q)).toBeCloseTo(0.5 + (spr.getY(q) + 0.5) * 0.25, 5);
      // Per-sprite data carried over.
      expect(spr.getZ(q)).toBeCloseTo(1.2, 5);
      expect(geometry.getAttribute('treeRank').getX(q)).toBeCloseTo(j / 2, 5);
    }
  });

  test('crown proxy: a closed lathe round the sprites, inside their reach', () => {
    const g = crownProxy(sprites())!;
    const pos = g.getAttribute('position');
    let maxR = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    // Reach: centre distance + 0.35 x size (1.2) for the outer sprite.
    expect(maxR).toBeLessThanOrEqual(Math.hypot(1.5, 0.5) + 0.42 + 1e-6);
    expect(maxR).toBeGreaterThan(0);
    expect(minY).toBeCloseTo(4 - 0.42, 5);
    expect(maxY).toBeCloseTo(6 + 0.42, 5);
    // Closed: the bottom and top rings sit on the axis.
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) === minY || pos.getY(i) === maxY)
        expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeLessThan(1e-6);
  });

  test('no sprites, no proxy', () => {
    const s = sprites();
    expect(crownProxy({ ...s, count: 0 })).toBeNull();
  });
});
