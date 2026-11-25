/**
 * Top-down (orthographic, north-up) pictures of a rally map from the map viewer, on the same grid as
 * `scripts/realmap/satellite.py`, for the satellite check (`scripts/realmap/overlay.py`). Dev server running.
 *
 *   node scripts/realmap/topdown.mjs --map vodno --every 300 --size 400 --mpp 0.5
 *   node scripts/realmap/topdown.mjs --map vodno --box -500 500 -400 400 --mpp 1
 *
 * `--every` = one square of `--size` m centred on the stage road every N m (default; `--from` / `--to` m along limit it,
 * `--tag` names the run's tiles<tag>.json so several can run at once), `--box` = one box (x0 x1 z0 z1).
 * `--season`, `--tod` (hours, default 12) and `--stage` pass through to the viewer. Writes
 * sources/maps/<map>/topdown/<x0>_<x1>_<z0>_<z1>-<mpp>.png (git-ignored) and a tiles.json listing them.
 * Headless Chromium on SwiftShader when there is no GPU: a 200 m box takes ~2-4 min.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const map = opt('map', 'vodno');
const stage = opt('stage', '');
const season = opt('season', '');
const tod = opt('tod', '12');
const mpp = Number(opt('mpp', '1'));
const size = Number(opt('size', '200'));
const every = Number(opt('every', '250'));
const from = Number(opt('from', '0'));
const to = Number(opt('to', '1e9'));
const base = opt('base', 'http://localhost:3000');
const bi = args.indexOf('--box');
const box = bi < 0 ? null : args.slice(bi + 1, bi + 5).map(Number);

const outDir = join('sources', 'maps', map, 'topdown');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
  ],
});
const page = await browser.newPage({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
const q = new URLSearchParams({
  map,
  far: '1',
  labels: '0',
  clean: '1',
  tod,
  mute: '1',
  quality: 'high',
});
if (stage) q.set('stage', stage);
if (season) q.set('season', season);
const t0 = Date.now();
await page.goto(`${base}/games/rally/map-viewer.html?${q}`, {
  waitUntil: 'load',
  timeout: 120000,
});
await page.waitForFunction(
  '!!(window.__mapViewer && window.__mapViewer.topDownShot)',
  null,
  {
    timeout: 900000,
    polling: 1000,
  },
);
console.log(`viewer loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
// The page's own loop would keep rendering the perspective view: stop it. Trees keep their crowns out to a few
// hundred metres: an impostor (upright billboard) is edge-on from straight above.
await page.evaluate(
  (lod) => {
    window.__mapViewer.shell.paused = true;
    window.__mapViewer.trees.setOptions({ lodScale: lod });
    window.__mapViewer.trees.setFarSprites(0.35, 0.35);
  },
  Number(opt('lod', '4')),
);

let boxes;
if (box) boxes = [{ along: null, box }];
else {
  boxes = await page.evaluate(
    ({ every, size, from, to }) => {
      const road = window.__mapViewer.world.stageRoad;
      const out = [];
      for (let a = from; a <= Math.min(to, road.length); a += every) {
        const p = road.at(a);
        const h = size / 2;
        out.push({
          along: a,
          box: [p.x - h, p.x + h, p.z - h, p.z + h].map((v) => Math.round(v)),
        });
      }
      return out;
    },
    { every, size, from, to },
  );
}

const tiles = [];
for (const { along, box: b } of boxes) {
  const [x0, x1, z0, z1] = b;
  const w = Math.round((x1 - x0) / mpp);
  const h = Math.round((z1 - z0) / mpp);
  const ts = Date.now();
  const url = await page.evaluate(
    (a) => window.__mapViewer.topDownShot(...a),
    [x0, x1, z0, z1, w, h],
  );
  const file = join(outDir, `${x0}_${x1}_${z0}_${z1}-${mpp}.png`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  tiles.push({ along, box: b, mpp, file });
  console.log(
    `${file} (along ${along ?? '-'} m) ${((Date.now() - ts) / 1000).toFixed(0)} s`,
  );
  writeFileSync(
    join(outDir, `tiles${opt('tag', '')}.json`),
    JSON.stringify(tiles, null, 1),
  );
}
await browser.close();
