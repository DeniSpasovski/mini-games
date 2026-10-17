import { describe, expect, test } from '@rstest/core';
import type { SpriteData } from '../../src/games/rally/trees/mesh';
import { crownProxy, quadSprites } from '../../src/games/rally/trees/proxy';
import {
  packSprite,
  unpackCorner,
  unpackHeading,
} from '../../src/games/rally/trees/sprite-attr';

/**
 * Two sprites as fans of an outline (offsets -0.5..0.5, uv = cell origin + offset * cell size): the first grows along a
 * heading (a broadleaf spray), the second is a round image without one.
 */
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
  const heading: number[] = [];
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
      spr.push(x, y, 1.2, 0);
      heading.push(...(j === 0 ? [0.6, -0.8, 0] : [0, 2, 0]));
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
    heading: new Float32Array(heading),
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
      const [cx, cy] = unpackCorner(spr.getX(q));
      expect([-0.35, 0.4]).toContain(Number(cx.toFixed(3)));
      expect([-0.4, 0.45]).toContain(Number(cy.toFixed(3)));
      expect(uv.getX(q)).toBeCloseTo(0.25 * j + (cx + 0.5) * 0.25, 3);
      expect(uv.getY(q)).toBeCloseTo(0.5 + (cy + 0.5) * 0.25, 3);
      // Per-sprite data carried over: size, rank, heading (none for the round image).
      expect(spr.getZ(q)).toBeCloseTo(1.2, 5);
      expect(geometry.getAttribute('treeRank').getX(q)).toBeCloseTo(j / 2, 5);
      const h = unpackHeading(spr.getX(q), spr.getY(q), spr.getW(q));
      if (j === 0) {
        expect(h![0]).toBeCloseTo(0.6, 5);
        expect(h![1]).toBeCloseTo(-0.8, 5);
        expect(h![2]).toBeCloseTo(0, 5);
      } else expect(h).toBeNull();
    }
  });

  test('a packed sprite vertex keeps its corner, size and heading (either side of the horizon)', () => {
    const out = new Float32Array(4);
    for (const h of [
      [0.36, 0.48, -0.8],
      [-0.6, -0.8, 0],
      [0, 1, 0],
    ] as [number, number, number][]) {
      packSprite(-0.31, 0.5, 2.5, h, out, 0);
      const [cx, cy] = unpackCorner(out[0]);
      expect(cx).toBeCloseTo(-0.31, 3);
      expect(cy).toBeCloseTo(0.5, 3);
      expect(out[2]).toBe(2.5);
      const back = unpackHeading(out[0], out[1], out[3])!;
      h.forEach((c, i) => expect(back[i]).toBeCloseTo(c, 5));
    }
    // The largest packed value stays an exact float (the shader unpacks it with mod / floor).
    packSprite(0.5, 0.5, 1, [0, -1, 0], out, 0);
    expect(Number.isInteger(out[0]) && out[0] < 2 ** 24).toBe(true);
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
