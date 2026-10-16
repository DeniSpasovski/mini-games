import { describe, expect, test } from '@rstest/core';
import { ajvatovciInfo } from '../../src/games/rally/maps/ajvatovci/info';
import { galichicaInfo } from '../../src/games/rally/maps/galichica/info';
import { jackieInfo } from '../../src/games/rally/maps/jackie/info';
import { petralicaInfo } from '../../src/games/rally/maps/petralica/info';
import {
  mapSeason,
  seasonAirTemp,
  stageClimate,
} from '../../src/games/rally/maps/shared/climate';
import type { EnvironmentDef } from '../../src/games/rally/maps/shared/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import { SEASONS, seasonParam } from '../../src/games/rally/season';
import { hexToLinear } from '../../src/games/rally/trees/math';
import {
  allSeasons,
  SEASONAL_SPECIES,
  seasonal,
  seasonOf,
  summerOf,
} from '../../src/games/rally/trees/seasons';
import {
  getSpecies,
  SPECIES,
  speciesHash,
} from '../../src/games/rally/trees/species';
import {
  cacheKey,
  generateVariant,
  variantSeed,
} from '../../src/games/rally/trees/variants';

const MAPS = [
  ['galichica', galichicaInfo.environment, 12],
  ['ajvatovci', ajvatovciInfo.environment, 27],
  ['jackie', jackieInfo.environment, 17],
  ['petralica', petralicaInfo.environment, 17],
  ['test', testMap.environment, 20],
] as const;

describe('seasons: air temperature', () => {
  test('the URL names a season or the map keeps its own', () => {
    expect(SEASONS).toEqual(['spring', 'summer', 'autumn']);
    expect(seasonParam('autumn', 'summer')).toBe('autumn');
    expect(seasonParam('winter', 'summer')).toBe('summer');
    expect(seasonParam(null, 'spring')).toBe('spring');
    expect(seasonParam('__proto__', 'spring')).toBe('spring');
  });

  test.each(MAPS)(
    '%s keeps its summer temperature and is cooler in spring and autumn',
    (_id, env, summer) => {
      expect(mapSeason(env)).toBe('summer');
      expect(seasonAirTemp(env)).toBe(summer);
      expect(stageClimate(env).air).toBe(summer);
      expect(seasonAirTemp(env, 'spring')).toBeLessThan(summer);
      expect(seasonAirTemp(env, 'autumn')).toBeLessThan(summer);
    },
  );

  test('the maps have their own temperatures', () => {
    const temps = MAPS.map(([, env]) =>
      SEASONS.map((s) => seasonAirTemp(env, s)),
    );
    expect(new Set(temps.map((t) => t.join())).size).toBe(MAPS.length);
  });

  test('a map with one temperature moves it with the season; ?air= wins', () => {
    const env = { airTemp: 20 } as EnvironmentDef;
    expect(seasonAirTemp(env, 'summer')).toBe(20);
    expect(seasonAirTemp(env, 'spring')).toBeLessThan(20);
    expect(seasonAirTemp({ ...env, season: 'autumn' }, 'autumn')).toBe(20);
    expect(
      seasonAirTemp({ ...env, season: 'autumn' }, 'summer'),
    ).toBeGreaterThan(20);
    const full = { ...env, sunElevation: 30, sunAzimuth: 0 } as EnvironmentDef;
    expect(stageClimate(full, 30, 3).air).toBe(3);
    expect(stageClimate(full, 30).air).toBe(seasonAirTemp(full));
  });
});

describe('seasons: tree leaves', () => {
  const lum = (hex: string) => {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  test('the table names real species with valid colours', () => {
    const names = new Set(SPECIES.map((s) => s.name));
    for (const n of SEASONAL_SPECIES) expect(names.has(n)).toBe(true);
    for (const def of SPECIES)
      for (const s of SEASONS)
        for (const c of seasonal(def, s).foliage.palette)
          expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('summer is the species itself; spring and autumn change only the colours', () => {
    const birch = getSpecies('Birch');
    expect(seasonal(birch, 'summer')).toBe(birch);
    const autumn = seasonal(birch, 'autumn');
    expect(autumn).not.toBe(birch);
    expect(seasonal(autumn, 'summer')).toBe(birch);
    expect(seasonal(autumn, 'autumn')).toBe(autumn);
    expect(seasonOf(autumn)).toBe('autumn');
    expect(summerOf(autumn)).toBe(birch);
    expect({ ...autumn, foliage: { ...autumn.foliage, palette: [] } }).toEqual({
      ...birch,
      foliage: { ...birch.foliage, palette: [] },
    });
  });

  test('a season grows the same trees under its own cache key', () => {
    const birch = getSpecies('Birch');
    const keys = SEASONS.map((s) => seasonal(birch, s)).map((d) =>
      cacheKey(d, variantSeed(d, 3)),
    );
    expect(new Set(keys).size).toBe(3);
    expect(
      new Set(SEASONS.map((s) => variantSeed(seasonal(birch, s), 3))).size,
    ).toBe(1);
    expect(speciesHash(seasonal(birch, 'autumn'))).not.toBe(speciesHash(birch));
    const [a, b] = ['summer', 'autumn'].map((s) =>
      generateVariant(seasonal(birch, s as 'summer' | 'autumn'), 0),
    );
    expect(b.info.height).toBe(a.info.height);
    expect(b.info.sphere).toEqual(a.info.sphere);
    expect(b.meshes.sprites.count).toBe(a.meshes.sprites.count);
    expect(b.info.foliageColor).not.toEqual(a.info.foliageColor);
  });

  test('a species with no colours for a season looks the same all year', () => {
    const juniper = getSpecies('Juniper');
    for (const s of SEASONS) expect(seasonal(juniper, s)).toBe(juniper);
    expect(allSeasons(juniper)).toEqual([juniper]);
    expect(allSeasons(getSpecies('Beech'))).toHaveLength(3);
  });

  test('spring is fresher than autumn, which turns the broadleaves warm', () => {
    const red = (hex: string) => hexToLinear(hex)[0] - hexToLinear(hex)[1];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const n of ['Beech', 'Birch', 'Hornbeam', 'Oak', 'Poplar']) {
      const def = getSpecies(n);
      const [sp, su, au] = SEASONS.map((s) => seasonal(def, s).foliage.palette);
      expect(mean(sp.map(lum))).toBeGreaterThan(mean(su.map(lum)));
      expect(mean(au.map(red))).toBeGreaterThan(mean(su.map(red)));
    }
  });
});
