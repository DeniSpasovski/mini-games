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
