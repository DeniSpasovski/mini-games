import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import { weatherEnv } from '../../src/games/rally/engine/environment';
import { layerTau } from '../../src/games/rally/engine/world-shading';
import { bestKey, runConditions } from '../../src/games/rally/game/stage';
import { STAGES } from '../../src/games/rally/maps';
import { stageTemps } from '../../src/games/rally/maps/shared/day-temperature';
import { carSurfaces } from '../../src/games/rally/physics/car-tyres';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import {
  TYRE_IDS,
  TYRES,
  tyreChoices,
  wetTyre,
} from '../../src/games/rally/physics/tyres';
import { puddleDepth, puddleField } from '../../src/games/rally/puddles';
import {
  WEATHER_LOOKS,
  WEATHERS,
  weatherLook,
  weatherParam,
  weatherTemps,
} from '../../src/games/rally/weather';

/** Weather (weather.ts, src/games/rally/DETAILS.md "Weather"): looks, temperatures, wet grip, puddles, fog layer. */
const fabia =
  ALL_CARS.find((c) => c.id === 'skoda_fabia')?.physics ?? ALL_CARS[0].physics;
const SURFACE_IDS = Object.keys(SURFACES) as SurfaceId[];

describe('weather picker', () => {
  test('a missing or unknown ?weather= is dry', () => {
    expect(weatherParam(null)).toBe('dry');
    expect(weatherParam('')).toBe('dry');
    expect(weatherParam('snowstorm')).toBe('dry');
    expect(weatherParam('rain_heavy')).toBe('rain_heavy');
  });

  test('dry keeps the map its own environment', () => {
    const def = STAGES[0].environment;
    expect(weatherEnv(def, WEATHER_LOOKS.dry)).toBe(def);
  });

  test('a run shows its weather, a dry one nothing', () => {
    expect(
      runConditions({ season: 'autumn', hour: 7, weather: 'rain_heavy' }, 15),
    ).toBe('Autumn · Early morning · Heavy rain');
    expect(
      runConditions({ season: 'autumn', hour: 7, weather: 'dry' }, 15),
    ).toBe('Autumn · Early morning');
  });

  test('each weather has its own split reference, dry keeps the old key', () => {
    expect(bestKey('vodno', 'peugeot_206')).toBe(
      'rally.best.vodno.peugeot_206',
    );
    expect(bestKey('vodno', 'peugeot_206', 'dry')).toBe(
      'rally.best.vodno.peugeot_206',
    );
    const keys = new Set(
      WEATHERS.map((w) => bestKey('vodno', 'peugeot_206', w)),
    );
    expect(keys.size).toBe(WEATHERS.length);
  });

  test('a stage retunes a weather field by field', () => {
    const vodno = STAGES.find((s) => s.id === 'vodno')!;
    const fog = weatherLook('fog', vodno.weather);
    expect(fog.fog!.top).toBe(110);
    expect(fog.fog!.damp).toBe(WEATHER_LOOKS.fog.fog!.damp);
    expect(weatherLook('rain_heavy', vodno.weather)).toBe(
      WEATHER_LOOKS.rain_heavy,
    );
  });
});

describe('weather temperatures', () => {
  test('dry changes nothing; rain is colder and the road sits at the air', () => {
    const t = { air: 20, road: 35 };
    expect(weatherTemps(t, WEATHER_LOOKS.dry)).toEqual(t);
    const rain = weatherTemps(t, WEATHER_LOOKS.rain_heavy);
    expect(rain.air).toBeLessThan(t.air);
    expect(rain.road).toBe(rain.air);
  });

  test('every stage is colder in heavy rain than dry', () => {
    for (const s of STAGES) {
      const dry = stageTemps(s, 13, 'summer');
      const wet = stageTemps(s, 13, 'summer', 0, 'rain_heavy');
      expect(wet.air).toBeLessThan(dry.air);
      expect(wet.road).toBeLessThan(dry.road);
    }
  });
});

describe('wet grip', () => {
  test('wet ground is never grippier than dry, on any tyre or surface', () => {
    for (const t of TYRE_IDS) {
      const dry = carSurfaces(fabia, t, 'front', 0);
      for (const wet of [0.6, 1]) {
        const w = carSurfaces(fabia, t, 'front', wet);
        for (const s of SURFACE_IDS) {
          expect(w[s].mu).toBeLessThanOrEqual(dry[s].mu);
          expect(w[s].slide).toBeLessThanOrEqual(dry[s].slide + 1e-9);
        }
      }
    }
  });

  test('on a soaked road Tarmac Wet grips best, the near-slicks worst of the tarmac tyres', () => {
    const mu = (t: (typeof TYRE_IDS)[number]) =>
      carSurfaces(fabia, t, 'front', 1).tarmac.mu;
    for (const t of TYRE_IDS)
      if (t !== 'tarmac_wet') expect(mu('tarmac_wet')).toBeGreaterThan(mu(t));
    expect(mu('tarmac')).toBeLessThan(mu('mixed'));
    // Dry, the soft slick still wins.
    expect(carSurfaces(fabia, 'tarmac', 'front', 0).tarmac.mu).toBeGreaterThan(
      carSurfaces(fabia, 'tarmac_wet', 'front', 0).tarmac.mu,
    );
  });

  test('no near-slicks in the rain; a tarmac stage recommends Tarmac Wet when wet', () => {
    const rain = tyreChoices(true);
    expect(rain).not.toContain('tarmac');
    expect(rain).not.toContain('tarmac_hard');
    expect(rain).toContain('tarmac_wet');
    expect(tyreChoices(false)).toEqual(TYRE_IDS);
    for (const t of rain) expect(TYRES[t].dryOnly).toBeFalsy();
    expect(wetTyre('tarmac', WEATHER_LOOKS.rain_heavy.wet)).toBe('tarmac_wet');
    expect(wetTyre('tarmac_hard', WEATHER_LOOKS.post_rain.wet)).toBe(
      'tarmac_wet',
    );
    expect(wetTyre('tarmac', 0)).toBe('tarmac');
    expect(wetTyre('mixed', 1)).toBe('mixed');
    expect(wetTyre('gravel_hard', 1)).toBe('gravel');
  });

  test('the wet tyre runs cool: its window is below the dry tarmac tyres', () => {
    expect(TYRES.tarmac_wet.temp.hi).toBeLessThan(TYRES.tarmac.temp.lo + 20);
    expect(TYRES.tarmac_wet.family).toBe('tarmac');
  });
});

describe('puddles', () => {
  test('none on dry ground, more the wetter it is', () => {
    let light = 0;
    let heavy = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 63) * 3.1 - 90;
      const z = Math.floor(i / 63) * 2.7 - 80;
      expect(puddleDepth(x, z, 0)).toBe(0);
      if (puddleDepth(x, z, 0.6) > 0) light++;
      if (puddleDepth(x, z, 1) > 0) heavy++;
    }
    expect(heavy).toBeGreaterThan(light);
    // A soaked road has puddles here and there, not a lake.
    expect(heavy / 4000).toBeGreaterThan(0.02);
    expect(heavy / 4000).toBeLessThan(0.3);
  });

  test('the field is seeded: the same water in the same place, negative coordinates too', () => {
    expect(puddleField(-1234.5, 987.25)).toBe(puddleField(-1234.5, 987.25));
    for (const [x, z] of [
      [-500.3, 12.1],
      [3021.7, -4410.2],
    ]) {
      const n = puddleField(x, z);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('fog layer', () => {
  const vodno = weatherLook(
    'fog',
    STAGES.find((s) => s.id === 'vodno')!.weather,
  ).fog!;
  const sigma = 3.9 / vodno.visibility;
  test('the start is in thick fog, the top of the climb above it in clear air', () => {
    // 200 m of view along the road at the start (0 m) and at the finish (+220 m).
    const start =
      1 - Math.exp(-layerTau(1.5, 1.5, 200, vodno.top, sigma, 0.05));
    const finish =
      1 - Math.exp(-layerTau(221.5, 221.5, 200, vodno.top, sigma, 0.05));
    expect(start).toBeGreaterThan(0.9);
    expect(finish).toBeLessThan(0.05);
  });
});
