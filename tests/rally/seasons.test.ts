import { describe, expect, test } from '@rstest/core';
import { STAGES } from '../../src/games/rally/maps';
import { ajvatovciInfo } from '../../src/games/rally/maps/ajvatovci/info';
import { galichicaInfo } from '../../src/games/rally/maps/galichica/info';
import { jackieInfo } from '../../src/games/rally/maps/jackie/info';
import { petralicaInfo } from '../../src/games/rally/maps/petralica/info';
import { mapSeason } from '../../src/games/rally/maps/shared/climate';
import {
  stageClimate,
  stageTemps,
} from '../../src/games/rally/maps/shared/day-temperature';
import {
  groundTintFor,
  mapInSeason,
} from '../../src/games/rally/maps/shared/season-map';
import { testMap } from '../../src/games/rally/maps/test/map';
import { TIMES_OF_DAY } from '../../src/games/rally/game/time-of-day';
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

describe('seasons: every stage and map has all three', () => {
  // A new stage needs its temperatures, a new map its ground, before it merges.
  test.each(STAGES.map((s) => [s.id, s] as const))(
    '%s: air and road for each season and time of day',
    (_id, stage) => {
      for (const season of SEASONS)
        for (const slot of TIMES_OF_DAY) {
          const [air, road] = stage.temps[season][slot.id];
          expect(air, `${season} ${slot.id} air`).toBeTypeOf('number');
          expect(road, `${season} ${slot.id} road`).toBeTypeOf('number');
          // The road is never colder than the air (night: the same).
          expect(road).toBeGreaterThanOrEqual(air);
        }
    },
  );

  test.each(
    [...new Map(STAGES.map((s) => [s.map, s])).values()].map(
      (s) => [s.map, s.environment] as const,
    ),
  )('%s: ground for each season', (_id, env) => {
    const own = mapSeason(env);
    for (const season of SEASONS)
      if (season !== own)
        expect(env.groundTints?.[season], `${season} ground`).toBeTruthy();
  });
});

describe('seasons: ground', () => {
  test.each(MAPS)(
    '%s has a ground tint of its own for each season',
    (_id, env) => {
      const own = mapSeason(env);
      const others = SEASONS.filter((s) => s !== own).map((s) =>
        groundTintFor(env, s),
      );
      expect(others.every(Boolean)).toBe(true);
      // The test map has no tint in its own season: the ground texture as drawn.
      const tints = env.groundTint ? [env.groundTint, ...others] : others;
      expect(new Set(tints.map((t) => t!.grass)).size).toBe(tints.length);
      // The map's own season keeps the tint it always had.
      expect(groundTintFor(env, mapSeason(env))).toBe(env.groundTint);
    },
  );

  test('a map in a season is a copy that names it and carries its tint', () => {
    const map = { environment: testMap.environment, other: 1 };
    expect(mapInSeason(map, 'summer')).toBe(map);
    const spring = mapInSeason(map, 'spring');
    expect(spring).not.toBe(map);
    expect(spring.other).toBe(1);
    expect(mapSeason(spring.environment)).toBe('spring');
    expect(spring.environment.groundTint).toBe(
      testMap.environment.groundTints!.spring,
    );
    expect(mapInSeason(spring, 'spring')).toBe(spring);
    expect(map.environment.groundTint).not.toBe(spring.environment.groundTint);
  });

  test('a map without season tints keeps its ground', () => {
    const env = { groundTint: { grass: '#123456' } } as EnvironmentDef;
    expect(groundTintFor(env, 'autumn')).toBe(env.groundTint);
    expect(groundTintFor({} as EnvironmentDef, 'spring')).toBeUndefined();
  });
});

describe('seasons: air temperature', () => {
  test('the URL names a season or the map keeps its own', () => {
    expect(SEASONS).toEqual(['spring', 'summer', 'autumn']);
    expect(seasonParam('autumn', 'summer')).toBe('autumn');
    expect(seasonParam('winter', 'summer')).toBe('summer');
    expect(seasonParam(null, 'spring')).toBe('spring');
    expect(seasonParam('__proto__', 'spring')).toBe('spring');
  });

  // The air at each stage's own hour in summer, as before the seasons (`?air=` and the old authored numbers).
  const SUMMER_AIR: Record<string, number> = {
    test: 20,
    ajvatovci: 27,
    petralica: 17,
    jackie: 17,
    galichica_west: 12,
    galichica_east: 12,
    prespa_ohrid: 12,
  };
  test.each(Object.entries(SUMMER_AIR))(
    '%s keeps its summer air at its own hour and is cooler in spring and autumn',
    (id, summer) => {
      const stage = STAGES.find((s) => s.id === id)!;
      const own = stage.environment.timeOfDay;
      expect(mapSeason(stage.environment)).toBe('summer');
      expect(stageTemps(stage, own).air).toBe(summer);
      expect(stageClimate(stage, own).air).toBe(summer);
      expect(stageTemps(stage, own, 'spring').air).toBeLessThan(summer);
      expect(stageTemps(stage, own, 'autumn').air).toBeLessThan(summer);
    },
  );

  test('the stages have their own temperatures; ?air= wins', () => {
    // One stage per map: the three Galichica stages share one table.
    const temps = [...new Map(STAGES.map((s) => [s.map, s])).values()].map(
      (s) => JSON.stringify(s.temps),
    );
    expect(new Set(temps).size).toBe(temps.length);
    const stage = STAGES.find((s) => s.id === 'ajvatovci')!;
    expect(stageClimate(stage, 12, 'summer', 3).air).toBe(3);
    // The sun heat does not follow the overridden air.
    expect(stageClimate(stage, 12, 'summer', 3).sun).toBe(
      stageClimate(stage, 12, 'summer').sun,
    );
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
