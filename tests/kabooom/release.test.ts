import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@rstest/core';
import { isGameListed, type GameManifest } from '../../src/portal/manifest';

const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../src/games/kabooom/game.json'),
    'utf8',
  ),
) as GameManifest;

test('kabooom: unlisted on the portal (but still built) while in development', () => {
  expect(manifest.hideInProd).toBe(true);
  expect(isGameListed(manifest, true)).toBe(false);
  // dev server and `npm run build:test` still get it
  expect(isGameListed(manifest, false)).toBe(true);
});
