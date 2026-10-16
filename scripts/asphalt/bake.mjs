/**
 * Bakes the road asphalt tiles (colour, normal, roughness as WebP) into src/games/rally/engine/asphalt/.
 *
 *   node scripts/asphalt/bake.mjs [id ...]        (default: every id, both sizes)
 *
 * The tiles are drawn by `gen.js` in headless Chromium (it needs a 2D canvas). Needs Playwright:
 * `PLAYWRIGHT_MODULE=<path to playwright/index.mjs>` if it is not importable as `playwright`,
 * `CHROMIUM_PATH=<chrome binary>` if Playwright's own browser is not installed. The output is committed (the game
 * and the build never run this); rerun it after changing gen.js or a preset, and keep `ROAD_SURFACE_LEN` in
 * engine/road-surface.ts equal to the presets' `len`.
 *
 * Files: <id>.<size>.{color,normal,rough}.webp. 1024 is the High tier, 512 is Medium and Low.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../src/games/rally/engine/asphalt');
const SIZES = [1024, 512];

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright'
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ path: path.join(here, 'gen.js') });
const ids =
  process.argv.length > 2
    ? process.argv.slice(2)
    : await page.evaluate(() => window.asphaltIds);
fs.mkdirSync(out, { recursive: true });
for (const id of ids)
  for (const size of SIZES) {
    const t0 = Date.now();
    const tile = await page.evaluate(
      ([i, s]) => window.asphaltTile(i, s),
      [id, size],
    );
    for (const part of ['color', 'normal', 'rough']) {
      const file = path.join(out, `${id}.${size}.${part}.webp`);
      fs.writeFileSync(file, Buffer.from(tile[part], 'base64'));
    }
    const kb = ['color', 'normal', 'rough']
      .map((p) =>
        Math.round(
          fs.statSync(path.join(out, `${id}.${size}.${p}.webp`)).size / 1024,
        ),
      )
      .join(' + ');
    console.log(`${id} ${size}: ${kb} KB (${Date.now() - t0} ms)`);
  }
await browser.close();
