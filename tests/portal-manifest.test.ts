import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@rstest/core';
import {
  gamePagesFromManifests,
  isGameListed,
  resolveGamePage,
  type GameManifest,
} from '../src/portal/manifest';

const root = path.resolve(__dirname, '..');
const gamesDir = path.join(root, 'src/games');

const gameIds = fs
  .readdirSync(gamesDir, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      fs.existsSync(path.join(gamesDir, d.name, 'game.json')),
  )
  .map((d) => d.name);

const readManifest = (id: string) =>
  JSON.parse(
    fs.readFileSync(path.join(gamesDir, id, 'game.json'), 'utf8'),
  ) as GameManifest;

test('resolveGamePage: the play page is the game root', () => {
  const page = {
    id: 'play',
    entry: 'pages/play.ts',
    title: 'T',
    label: 'Play',
  };
  expect(resolveGamePage('hole', page)).toEqual({
    ...page,
    gameId: 'hole',
    entryName: 'games/hole/index',
    href: 'games/hole/',
  });
});

test('resolveGamePage: tool pages get their own html file', () => {
  const page = {
    id: 'map-viewer',
    entry: 'pages/map-viewer.ts',
    title: 'T',
    label: 'Map viewer',
    dev: true,
    hideInProd: true,
  };
  const r = resolveGamePage('rally', page);
  expect(r.entryName).toBe('games/rally/map-viewer');
  expect(r.href).toBe('games/rally/map-viewer.html');
  expect(r.dev).toBe(true);
  expect(r.hideInProd).toBe(true);
});

test('gamePagesFromManifests: flattens all games in order', () => {
  const mk = (id: string, pages: string[]): GameManifest => ({
    id,
    title: id,
    description: '',
    pages: pages.map((p) => ({ id: p, entry: `${p}.ts`, title: p, label: p })),
  });
  const out = gamePagesFromManifests([
    mk('a', ['play', 'x']),
    mk('b', ['play']),
  ]);
  expect(out.map((p) => p.entryName)).toEqual([
    'games/a/index',
    'games/a/x',
    'games/b/index',
  ]);
  expect(gamePagesFromManifests([])).toEqual([]);
});

test('isGameListed: hideInProd games are only unlisted in the release build', () => {
  const base: GameManifest = {
    id: 'a',
    title: 'a',
    description: '',
    pages: [],
  };
  expect(isGameListed(base, true)).toBe(true);
  expect(isGameListed({ ...base, hideInProd: true }, true)).toBe(false);
  expect(isGameListed({ ...base, hideInProd: true }, false)).toBe(true);
});

test('every game folder is discovered', () => {
  expect(gameIds.length).toBeGreaterThan(0);
});

for (const id of gameIds) {
  test(`game.json (${id}) is valid and its files exist`, () => {
    const m = readManifest(id);
    expect(m.id).toBe(id);
    expect(m.title).toBeTruthy();
    expect(m.description).toBeTruthy();
    if (m.version) expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);

    const ids = m.pages.map((p) => p.id);
    expect(ids).toContain('play');
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of m.pages) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.title).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(fs.existsSync(path.join(gamesDir, id, p.entry))).toBe(true);
    }
    // Play is the main page; it must not be a hidden dev tool.
    const play = m.pages.find((p) => p.id === 'play')!;
    expect(play.dev).toBeFalsy();
    expect(play.hideInProd).toBeFalsy();
  });

  // An unlisted game (hideInProd) gets its thumbnail (F9 on the dev server) when it is released.
  test(`game (${id}) has a portal thumbnail`, () => {
    if (readManifest(id).hideInProd) return;
    const has = ['jpg', 'png'].some((e) =>
      fs.existsSync(path.join(gamesDir, id, `thumbnail.${e}`)),
    );
    expect(has).toBe(true);
  });
}

test('page entry names and hrefs are unique across games', () => {
  const pages = gamePagesFromManifests(gameIds.map(readManifest));
  expect(new Set(pages.map((p) => p.entryName)).size).toBe(pages.length);
  expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
});

test('PWA manifest: required fields and icon files exist', () => {
  const pub = path.join(root, 'public');
  const wm = JSON.parse(
    fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'),
  );
  expect(wm.name).toBeTruthy();
  expect(wm.short_name).toBeTruthy();
  expect(wm.start_url).toBe('./');
  expect(wm.display).toBe('standalone');
  for (const icon of wm.icons) {
    expect(fs.existsSync(path.join(pub, icon.src))).toBe(true);
  }
  expect(
    wm.icons.some((i: { purpose: string }) => i.purpose === 'maskable'),
  ).toBe(true);
});
