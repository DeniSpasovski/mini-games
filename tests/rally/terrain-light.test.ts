import { describe, expect, test } from '@rstest/core';
import { DataUtils } from 'three';
import {
  shadowLine,
  skyVisibility,
  sunAt,
  TerrainLight,
} from '../../src/games/rally/world/terrain-light';

/** A 200 m ridge running north-south at x = 0 on a flat plain (heights in m, x / z in m). */
const ridge = (x: number) => 200 * Math.exp(-((x / 150) ** 2));

describe('terrain light', () => {
  const n = 201;
  const cell = 8;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) h[j * n + i] = ridge((i - 100) * cell);
  // A low sun in the east (+x): 10 degrees up.
  const tan = Math.tan((10 * Math.PI) / 180);
  const sunOn = (x: number, y: number, tanEl = tan) => {
    const [line, width] = shadowLine(
      h,
      n,
      n,
      100 + x / cell,
      100,
      1,
      0,
      tanEl,
      cell,
    );
    return sunAt(y, line, width);
  };

  test('the ridge shades the plain on its far side, not the near one', () => {
    // 300 m west of the ridge, looking east past it: in its shadow.
    expect(sunOn(-300, 0)).toBe(0);
    // 300 m east: nothing between it and the sun.
    expect(sunOn(300, 0)).toBe(1);
    // A high sun clears the ridge.
    expect(sunOn(-300, 0, 2)).toBe(1);
  });

  test('what stands high enough over a shaded spot is in the sun', () => {
    // The shadow line 300 m west of a 200 m ridge at a 10 degree sun: about 200 - 300 * tan(10) = 147 m up.
    expect(sunOn(-300, 120)).toBe(0);
    expect(sunOn(-300, 170)).toBe(1);
  });

  test('the foot of the ridge sees less sky than its crest or the open plain', () => {
    const foot = skyVisibility(h, n, n, 100 - 150 / cell, 100, cell);
    const crest = skyVisibility(h, n, n, 100, 100, cell);
    const plain = skyVisibility(h, n, n, 0, 100, cell);
    expect(crest).toBeGreaterThan(0.99);
    expect(foot).toBeLessThan(0.9);
    expect(plain).toBeGreaterThan(foot);
  });

  test('bakes in small slices to a half-float texture', () => {
    const tl = new TerrainLight(
      (x) => ridge(x),
      { minX: -400, maxX: 400, minZ: -200, maxZ: 200 },
      { x: Math.cos(0.17), y: Math.sin(0.17), z: 0 },
    );
    let slices = 0;
    while (!tl.step(0.5)) slices++;
    expect(slices).toBeGreaterThan(0);
    expect(tl.done).toBe(true);
    const img = tl.texture!.image as { width: number; data: Uint16Array };
    const sun = (x: number) => {
      const k = Math.round((x + 400) / 8) * 4;
      const line = DataUtils.fromHalfFloat(img.data[k]) + tl.map.baseY;
      return sunAt(ridge(x), line, DataUtils.fromHalfFloat(img.data[k + 2]));
    };
    expect(sun(-300)).toBe(0);
    expect(sun(300)).toBe(1);
    expect(tl.step(1)).toBe(false);
  });
});
