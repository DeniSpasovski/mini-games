import { describe, expect, test } from '@rstest/core';
import { gradeColor, resolveGrade } from '../../src/games/rally/engine/grade';
import {
  gradeFor,
  mapInSeason,
} from '../../src/games/rally/maps/shared/season-map';
import { galichicaInfo } from '../../src/games/rally/maps/galichica/info';
import type { EnvironmentDef } from '../../src/games/rally/maps/shared/types';

const SAMPLES: [number, number, number][] = [
  [0, 0, 0],
  [0.18, 0.18, 0.18],
  [0.9, 0.2, 0.05],
  [0.1, 0.5, 0.8],
  [1, 1, 1],
];

describe('colour grade', () => {
  test('no grade leaves every colour unchanged', () => {
    for (const g of [undefined, null, {}]) {
      const r = resolveGrade(g);
      expect(r.on).toBe(false);
      for (const c of SAMPLES) expect(gradeColor(c, r)).toEqual(c);
    }
  });

  test('a grade at its neutral values is (almost) no change', () => {
    const r = resolveGrade({ contrast: 1, saturation: 1, vibrance: 0 });
    expect(r.on).toBe(true);
    for (const c of SAMPLES) {
      const out = gradeColor(c, r);
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(c[i], 5);
    }
  });

  test('white balance keeps luminance, warmth warms', () => {
    const r = resolveGrade({ warmth: 0.5 });
    const [R, G, B] = r.balance;
    expect(0.2126 * R + 0.7152 * G + 0.0722 * B).toBeCloseTo(1, 6);
    expect(R).toBeGreaterThan(B);
  });

  test('contrast pivots on mid grey, vignette darkens corners only', () => {
    const r = resolveGrade({ contrast: 1.2, vignette: 0.3 });
    const grey = gradeColor([0.18, 0.18, 0.18], r)[0];
    expect(Math.abs(grey - 0.18)).toBeLessThan(0.01);
    expect(gradeColor([0.6, 0.6, 0.6], r)[0]).toBeGreaterThan(0.6);
    expect(gradeColor([0.6, 0.6, 0.6], r, [0, 0])[0]).toBeLessThan(
      gradeColor([0.6, 0.6, 0.6], r)[0],
    );
  });

  test('season grades merge field by field over the map grade', () => {
    const env = {
      ...galichicaInfo.environment,
      grade: { contrast: 1.1, saturation: 1.05 },
      grades: { autumn: { saturation: 1.2, warmth: 0.2 } },
    } as EnvironmentDef;
    expect(gradeFor(env, 'summer')).toEqual({
      contrast: 1.1,
      saturation: 1.05,
    });
    expect(gradeFor(env, 'autumn')).toEqual({
      contrast: 1.1,
      saturation: 1.2,
      warmth: 0.2,
    });
    const autumn = mapInSeason({ environment: env }, 'autumn');
    expect(autumn.environment.grade).toEqual(gradeFor(env, 'autumn'));
  });
});
