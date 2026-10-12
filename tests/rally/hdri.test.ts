import { describe, expect, test } from '@rstest/core';
import { DataUtils } from 'three';
import { hdriTexture, prepareHdri } from '../../src/games/rally/engine/hdri';

/** A grey sky with a tiny, very bright sun at column `sx`. */
function sky(w: number, h: number, sx: number): Float32Array {
  const d = new Float32Array(w * h * 4).fill(0.5);
  d[(2 * w + sx) * 4] = d[(2 * w + sx) * 4 + 1] = d[(2 * w + sx) * 4 + 2] = 5e4;
  return d;
}

describe('HDRI lighting', () => {
  test('the sun is found and clamped out, the sky is kept', () => {
    const src = prepareHdri(64, 32, sky(64, 32, 16));
    expect(Math.max(...src.rgb)).toBeLessThan(2);
    expect(src.rgb[0]).toBe(0.5);
    // Column 16 of 64 = u 0.26: atan2(z, x) = (u - 0.5) * 2 pi.
    expect(src.sunAngle).toBeCloseTo((16.5 / 64 - 0.5) * Math.PI * 2, 6);
  });

  test('turning moves the sun to the requested angle', () => {
    const w = 64;
    const d = new Float32Array(w * 32 * 4).fill(0.1);
    d[(2 * w + 16) * 4] = 3; // a marker column, red only
    const src = prepareHdri(w, 32, d);
    const tex = hdriTexture(src, src.sunAngle + Math.PI / 2);
    const out = tex.image.data as Uint16Array;
    const red = (x: number) => DataUtils.fromHalfFloat(out[(2 * w + x) * 4]);
    // A quarter turn = a quarter of the width.
    // (clamped as the brightest pixel, still well above the 0.1 sky)
    expect(red(16 + 16)).toBeGreaterThan(0.5);
    expect(red(16)).toBeLessThan(0.2);
  });
});
