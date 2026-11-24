import { describe, expect, test } from '@rstest/core';
import {
  daylight,
  luminance,
  meteredExposure,
  mieFromTurbidity,
  sampleSkyView,
} from '../../src/games/rally/engine/atmosphere';

const HAZY = { mie: mieFromTurbidity(4), altitude: 600, albedo: 0.15 };
const CLEAR = { mie: mieFromTurbidity(2), altitude: 600, albedo: 0.15 };
const sinD = (deg: number) => Math.sin((deg * Math.PI) / 180);

describe('light=v2 atmosphere', () => {
  const noon = daylight(58, HAZY);
  const morning = daylight(20, HAZY);
  const low = daylight(5, HAZY);

  test('noon light on flat ground is white (daylight balance) and the sun ~4.5', () => {
    const total = [0, 1, 2].map((c) => noon.sun[c] * sinD(58) + noon.sky[c]);
    const l = luminance(total);
    for (const c of total) expect(Math.abs(c / l - 1)).toBeLessThan(0.08);
    expect(luminance(noon.sun)).toBeGreaterThan(3.5);
    expect(luminance(noon.sun)).toBeLessThan(5);
  });

  test('a low sun is dimmer and redder; the sky blue', () => {
    expect(luminance(low.sun)).toBeLessThan(luminance(noon.sun) * 0.6);
    expect(low.sun[2] / low.sun[0]).toBeLessThan(0.3);
    expect(noon.sun[2] / noon.sun[0]).toBeGreaterThan(0.75);
    expect(noon.sky[2]).toBeGreaterThan(noon.sky[0]);
  });

  test('the sky carries a larger share of the light as the sun sinks, and in hazy air', () => {
    const share = (d: typeof noon, el: number) =>
      luminance(d.sky) / (luminance(d.sun) * sinD(el) + luminance(d.sky));
    expect(share(noon, 58)).toBeGreaterThan(0.1);
    expect(share(noon, 58)).toBeLessThan(0.3);
    expect(share(morning, 20)).toBeGreaterThan(share(noon, 58));
    expect(share(low, 5)).toBeGreaterThan(0.5);
    expect(share(noon, 58)).toBeGreaterThan(share(daylight(58, CLEAR), 58));
  });

  test('the horizon is brighter than the zenith, and the haze fit matches the horizon', () => {
    const zen = sampleSkyView(noon.lut, Math.PI / 2 - 0.01, Math.PI / 2);
    const hor = sampleSkyView(noon.lut, Math.PI / 180, Math.PI / 2);
    expect(luminance(hor)).toBeGreaterThan(luminance(zen));
    const { a, b, d } = noon.horizon;
    for (const az of [0, Math.PI / 2, Math.PI]) {
      const s = sampleSkyView(noon.lut, Math.PI / 180, az);
      const c = Math.cos(az);
      const fit = [0, 1, 2].map(
        (k) => a[k] + b[k] * c + d[k] * Math.max(c, 0) ** 12,
      );
      expect(Math.abs(luminance(fit) / luminance(s) - 1)).toBeLessThan(0.15);
    }
  });

  test('far land turns blue: blue is dimmed most', () => {
    expect(noon.extinction[2]).toBeGreaterThan(noon.extinction[1]);
    expect(noon.extinction[1]).toBeGreaterThan(noon.extinction[0]);
  });
});

describe('light=v2 exposure meter', () => {
  test('noon exposes like the default look; a dimmer light opens up only part way', () => {
    expect(meteredExposure(0.95, 4.3, 4.3, 4.3, 0.6)).toBeCloseTo(0.95, 6);
    // a hazier map's dimmer noon still lands on the default look's sunlit brightness
    expect(meteredExposure(1, 4.3, 3.9, 3.9, 0.6) * 3.9).toBeCloseTo(4.3, 6);
    const evening = meteredExposure(1, 4.3, 4.3, 1.2, 0.6);
    expect(evening).toBeGreaterThan(1);
    expect(evening * 1.2).toBeLessThan(4.3);
  });
});
