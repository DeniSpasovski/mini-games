import { resolve } from 'node:path';
import { expect, test } from '@rstest/core';
// @ts-expect-error plain .mjs script, no types
import * as ci from '../scripts/ci-affected.mjs';

const count = (changed: string[] | null) =>
  Object.values(ci.affectedTests(changed) as Record<string, string[]>).flat()
    .length;

test('ci-affected: configs run every integration test, src/shared only through the import closure', () => {
  const every = count(null);
  expect(count(['package.json'])).toBe(every);
  expect(count(['src/shared/not-imported.css'])).toBe(0);
  expect(count(['src/shared/rng.ts'])).toBeGreaterThan(0);
  expect(count(['src/shared/rng.ts'])).toBeLessThanOrEqual(every);
});

test('ci-affected: worker files (`new URL(..., import.meta.url)`) join the closure', () => {
  const files = [...ci.closure(resolve('src/games/rally/trees/load.ts'))];
  expect(files.some((f) => /trees[\\/]worker\.ts$/.test(f))).toBe(true);
});

const rally = (changed: string[]) =>
  (ci.affectedTests(changed).rally as string[]).map((f) =>
    f.replace('integration-tests/rally/', ''),
  );
const DRIVES = /^(car-matrix|stage-|tyres|gearing|replay)/;

test('ci-affected: rally drives skip scenery, run for physics, cars and map roads', () => {
  const scenery = [
    'src/games/rally/world/scatter.ts',
    'src/games/rally/trees/species.ts',
    'src/games/rally/world/road-mesh.ts',
    'src/games/rally/maps/vodno/landmarks/summit.ts',
    'src/games/rally/cars/pezetka/README.md',
  ];
  expect(rally(scenery).filter((f) => DRIVES.test(f))).toEqual([]);
  expect(ci.rallyCars(scenery)).toEqual({
    cars: [],
    hillCars: [],
    hillMaps: [],
  });

  const physics = ['src/games/rally/physics/tire.ts'];
  expect(rally(physics)).toContain('car-matrix.test.ts');
  expect(rally(physics)).toContain('stage-vodno.test.ts');
  expect(ci.rallyCars(physics)).toEqual({
    cars: 'all',
    hillCars: 'all',
    hillMaps: 'all',
  });

  // A car: the per-car drives (not tyres.test, the Fabia only), that car on every map's hills.
  const pezetka = ['src/games/rally/cars/pezetka/pezetka.ts'];
  expect(rally(pezetka)).toContain('car-matrix.test.ts');
  expect(rally(pezetka)).toContain('stage-petralica.test.ts');
  expect(rally(pezetka)).not.toContain('tyres.test.ts');
  expect(ci.rallyCars(pezetka)).toEqual({
    cars: ['pezetka'],
    hillCars: ['pezetka'],
    hillMaps: [],
  });

  // A map road: only the drives on that map, its hills with the representative cars.
  const vodno = ['src/games/rally/maps/vodno/map.ts'];
  expect(rally(vodno).filter((f) => DRIVES.test(f))).toEqual([
    'replay.test.ts',
    'stage-vodno.test.ts',
  ]);
  expect(ci.rallyCars(['src/games/rally/maps/petralica/route.json'])).toEqual({
    cars: [],
    hillCars: [],
    hillMaps: ['petralica'],
  });

  // Shared road / terrain code: every map's hills with the representative cars.
  const terrain = ['src/games/rally/world/terrain-gen.ts'];
  expect(rally(terrain)).toContain('stage-jackie.test.ts');
  expect(ci.rallyCars(terrain).hillMaps).toBe('all');
  expect(ci.rallyCars(null)).toEqual({
    cars: 'all',
    hillCars: 'all',
    hillMaps: 'all',
  });
});

test('ci-affected: smoke runs only the changed games', () => {
  expect(ci.smokeGames(null)).toEqual(['rally', 'hole', 'kaboom']);
  expect(ci.smokeGames(['README.md', 'src/games/hole/README.md'])).toEqual([]);
  expect(ci.smokeGames(['src/games/hole/game/hole.css'])).toEqual(['hole']);
  expect(ci.smokeGames(['src/portal/portal.ts'])).toEqual([]);
  expect(ci.smokeGames(['rsbuild.config.ts'])).toEqual([
    'rally',
    'hole',
    'kaboom',
  ]);
});
