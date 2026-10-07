import { defineConfig, type EnvironmentConfig } from '@rsbuild/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { meshoptGlb } from './scripts/car-model/glb-meshopt.mjs';
import { resolveGamePage, type GameManifest } from './src/portal/manifest';

/**
 * One Rsbuild environment per game + one for the portal, so every game builds
 * into its own self-contained folder (html, js, css, images, models, icons):
 *
 * - `src/portal/index.ts`            -> dist/index.html (environment "portal")
 * - `src/games/<id>/game.json`       -> every `pages[].entry` becomes
 *                                       dist/games/<id>/<page>.html (environment "<id>")
 *
 * Nothing is shared between the folders (each game has its own copy of three.js),
 * so one game can be rebuilt + uploaded without touching the others:
 * `npm run build -- --environment rally` only rewrites dist/games/rally/.
 *
 * Adding a game = drop a folder with a game.json into src/games. No edits here.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const gamesDir = path.resolve(root, 'src/games');

function readManifests(): GameManifest[] {
  if (!fs.existsSync(gamesDir)) return [];
  return fs
    .readdirSync(gamesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(gamesDir, d.name, 'game.json'))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')) as GameManifest);
}

const manifests = readManifests();

/**
 * Optional imported car models (public/models/cars/*.glb|gltf). Listed at build
 * time so the game only requests files that exist. The dev server restarts by
 * itself when a model is added / removed (dev.watchFiles below).
 */
const carModelDir = path.resolve(root, 'public/models/cars');
const carModelFiles = fs.existsSync(carModelDir)
  ? fs.readdirSync(carModelDir).filter((f) => /.(glb|gltf)$/i.test(f))
  : [];

/**
 * Game-only files that live in the root public/ folder: copied into that game's
 * folder only (dist/games/<id>/<to>), never into the portal or other games.
 * Car GLBs are meshopt-compressed on the way (dev server too; scripts/car-model/glb-meshopt.mjs):
 * about half the download, git keeps the plain files the model scripts and tests read.
 */
type CopyTransform = (input: Buffer, file: string) => Buffer | Promise<Buffer>;
const gamePublicFiles: Record<
  string,
  { from: string; to: string; transform?: CopyTransform }[]
> = {
  rally: [
    {
      from: 'public/models',
      to: 'models',
      transform: (input, file) =>
        file.endsWith('.glb') ? meshoptGlb(input) : input,
    },
  ],
};

const NO_ZOOM_VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/**
 * Per-game meta overrides, by page (entry name inside the game folder: "index" = play page).
 * Rally on a phone / iPad: on-screen pedals, so no double-tap / pinch zoom.
 * Hole: fixed viewport on the play page only, own theme colour on every page.
 */
const gameMeta: Record<string, (page: string) => Record<string, string>> = {
  rally: (page) => (page === 'index' ? { viewport: NO_ZOOM_VIEWPORT } : {}),
  // Only the play page locks zoom; the item / map viewer and balance pages are tools that need pinch zoom.
  hole: (page) => ({
    ...(page === 'index' ? { viewport: NO_ZOOM_VIEWPORT } : {}),
    'theme-color': '#7cc66a',
  }),
};

// Every page can be added to the iPad / phone home screen as a full-screen app.
// A `meta` function / object replaces Rsbuild's defaults, so charset + viewport are repeated here:
// without <meta charset> hosts guess Windows-1252 and "‹" / "▶" show up as "â€¹" / "â-¶".
const baseMeta = {
  charset: { charset: 'UTF-8' },
  viewport: 'width=device-width, initial-scale=1.0',
  'apple-mobile-web-app-capable': 'yes',
  'mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-title': 'Mini Games',
  'apple-mobile-web-app-status-bar-style': 'black-translucent',
  'theme-color': '#111418',
};

const appleTouchIcon = {
  tag: 'link',
  attrs: { rel: 'apple-touch-icon', href: 'icons/apple-touch-icon.png' },
};

const portalEnvironment: EnvironmentConfig = {
  source: { entry: { index: './src/portal/index.ts' } },
  output: {
    distPath: { root: 'dist' },
    // Rebuilding the portal must not wipe the game folders.
    cleanDistPath: { keep: [/[\\/]dist[\\/]games[\\/]/] },
    copy: [
      { from: 'public/icons', to: 'icons' },
      { from: 'public/manifest.webmanifest' },
      // Service worker at the root so its scope covers the games too (src/shared/offline.ts).
      { from: 'public/sw.js' },
    ],
  },
  html: {
    title: 'Mini Game Portal',
    meta: baseMeta,
    // PWA manifest + iOS home-screen icon. Rsbuild turns these into page-relative
    // URLs (assetPrefix 'auto'), so they work from any sub-folder.
    tags: [
      { tag: 'link', attrs: { rel: 'manifest', href: 'manifest.webmanifest' } },
      appleTouchIcon,
    ],
  },
};

function gameEnvironment(m: GameManifest): EnvironmentConfig {
  const entry: Record<string, string> = {};
  const titles: Record<string, string> = {};
  for (const p of m.pages) {
    // Entry names are relative to the game folder: "index" (play) or the page id.
    const name = resolveGamePage(m.id, p).entryName.slice(
      `games/${m.id}/`.length,
    );
    entry[name] = `./src/games/${m.id}/${p.entry}`;
    titles[name] = p.title;
  }
  return {
    source: { entry },
    output: {
      distPath: { root: `dist/games/${m.id}` },
      copy: [
        { from: 'public/icons/apple-touch-icon.png', to: 'icons' },
        ...(gamePublicFiles[m.id] ?? []),
      ],
    },
    html: {
      title: ({ entryName }) => titles[entryName] ?? m.title,
      meta: ({ entryName }) => ({
        ...baseMeta,
        ...gameMeta[m.id]?.(entryName),
      }),
      tags: [
        // The installed home-screen app is the whole portal: game pages link the
        // portal's manifest (two folders up, like the "All games" button). A game
        // hosted on its own just gets a harmless 404 for it.
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: '../../manifest.webmanifest' },
          publicPath: false,
        },
        appleTouchIcon,
      ],
    },
  };
}

/**
 * `npm run dev:noreload` (`--env-mode noreload`): the dev server without HMR / live reload, so a page being debugged,
 * benchmarked or baking stage cards is never reloaded by file edits (other sessions, tools writing into src/).
 * Reload by hand to pick up changes.
 */
export default defineConfig(({ envMode }) => ({
  environments: {
    portal: portalEnvironment,
    ...Object.fromEntries(manifests.map((m) => [m.id, gameEnvironment(m)])),
  },
  source: {
    // Domain lock (allowed hosts in src/site.config.ts) runs before every page,
    // then the cookie banner / Google Analytics loader (src/shared/consent.ts).
    preEntry: ['./src/shared/host-guard.ts', './src/shared/consent-boot.ts'],
    define: {
      __CAR_MODEL_FILES__: JSON.stringify(carModelFiles),
      // `npm run build:test` (`--env-mode test`): the published build also offers the TEST cars / maps (release.ts).
      __TEST_BUILD__: JSON.stringify(envMode === 'test'),
    },
  },
  output: {
    // Relative asset URLs so the build works from any sub-folder
    // (e.g. https://example.com/games/), not only the domain root.
    // In-app links are relative too - never hard-code a leading "/".
    assetPrefix: 'auto',
  },
  dev: {
    hmr: envMode !== 'noreload',
    liveReload: envMode !== 'noreload',
    // Page-relative URLs in dev too: every environment emits unhashed names like
    // static/js/index.js / three.js, so root "/static/..." URLs would clash between games.
    assetPrefix: 'auto',
    // The car model list above is baked in at startup - restart when it changes.
    watchFiles: {
      paths: carModelDir,
      events: ['add', 'unlink'],
      type: 'restart',
    },
  },
  html: {
    // Emitted next to each environment's pages (dist/favicon.png, dist/games/<id>/favicon.png).
    favicon: './public/favicon.png',
  },
  performance: {
    // three.js in its own long-cached chunk (one copy per game folder).
    chunkSplit: {
      strategy: 'split-by-experience',
      forceSplitting: { three: /node_modules[\\/]three[\\/]/ },
    },
  },
  server: {
    // public/ is still served by the dev server, but not copied as a whole on build:
    // each environment copies only the files it uses (output.copy above).
    publicDir: { name: 'public', copyOnBuild: false },
    // Dev-only helper: POST a JPEG data URL to save a game's portal thumbnail.
    // Used by the in-game "F9" capture (see src/shared/thumbnail.ts).
    setup: ({ action, server }) => {
      if (action !== 'dev') return;
      server.middlewares.use('/__dev/thumbnail', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://x');
        const game = (url.searchParams.get('game') ?? '').replace(
          /[^a-z0-9_-]/gi,
          '',
        );
        if (!game || !fs.existsSync(path.join(gamesDir, game))) {
          res.statusCode = 400;
          res.end('unknown game');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const out = path.join(gamesDir, game, 'thumbnail.jpg');
          fs.writeFileSync(out, Buffer.from(b64, 'base64'));
          res.end(`saved ${path.relative(root, out)}`);
        });
      });
      // Dev-only helper: save a rally map's baked stage card (stage-select view) into
      // src/games/rally/maps/<map>/preview/ (see src/games/rally/tools/stage-card-bake.ts).
      server.middlewares.use('/__dev/stage-card', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const map = (url.searchParams.get('map') ?? '').replace(
          /[^a-z0-9_-]/gi,
          '',
        );
        const mapDir = path.join(gamesDir, 'rally', 'maps', map);
        if (req.method !== 'POST' || !map || !fs.existsSync(mapDir)) {
          res.statusCode = 400;
          res.end('unknown map');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            json: string;
            jpeg: string;
          };
          const dir = path.join(mapDir, 'preview');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'stage-card.json'), body.json);
          fs.writeFileSync(
            path.join(dir, 'stage-card.jpg'),
            Buffer.from(
              body.jpeg.replace(/^data:image\/\w+;base64,/, ''),
              'base64',
            ),
          );
          res.end(`saved ${path.relative(root, dir)}`);
        });
      });
    },
  },
}));
