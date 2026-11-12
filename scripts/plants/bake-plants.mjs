/**
 * Bakes the rally grass / weed / reed card atlases (src/games/rally/engine/plants/*.webp + plant-atlas.data.ts) from
 * CC0 Poly Haven plant scans and CC BY Sketchfab models (the reeds sheet).
 *
 *   node scripts/plants/bake-plants.mjs sources/rally/plants [--sheets reeds,weeds]
 *
 * `--sheets` bakes only those sheets (and needs only their models); the others keep their atlases and data.
 *
 * The source folder holds one folder per Poly Haven model (the 1k glTF download: <id>.gltf + .bin + textures/, plus the
 * model's 1k alpha png and, where there is one, its dry colour map): grass_medium_01, grass_medium_02, nettle_plant,
 * dandelion_01, celandine_01, weed_plant_02; and the two glb files of `GLB_MODELS`. A Poly Haven model missing there is
 * read from the sibling `polyhaven/<id>/` folder (`<id>_1k.gltf`, as downloaded): fern_02 (the ferns sheet). scripts/plants/layout.ts says which clump stands where in each cell
 * (seeded); headless Chromium (Playwright, three.js) renders every cell from the side, albedo only, alpha-tested at 2x
 * and averaged down to soft coverage; scripts/plants/pack.py packs the sheets, bleeds colour under the transparent
 * texels, makes the spring sheet and measures the means the blade strips and the vines take.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHEETS, layoutCell, layoutHash } from './layout.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const flag = args.indexOf('--sheets');
const only = flag >= 0 ? args.splice(flag, 2)[1].split(',') : null;
const src = path.resolve(args[0] ?? 'sources/rally/plants');
const BAKE = SHEETS.filter((s) => !only || only.includes(s.id));
const needed = new Set(
  BAKE.flatMap((s) => s.cells.flatMap((c) => c.groups.map((g) => g.model))),
);
/** Camera pitch (rad): the cells are seen a little from above, as from a car seat. */
const PITCH = 0.12;

/**
 * The glb models (CC BY 4.0, Nicholas-3D on Sketchfab) and their pieces: a node and its meshes (`node`) or the first
 * mesh with a material (`material`); every piece is stood on y = 0 and scaled to 1 m tall.
 */
const GLB_MODELS = {
  reed_pack: {
    file: 'reed-plants-pack-nicholas3d.glb',
    pieces: Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [
        `Reed_${n}_${n}`,
        { node: `Reed_${n}_${n}` },
      ]),
    ),
  },
  cattails: {
    file: 'ground-cover-foliage-showcase-nicholas3d.glb',
    pieces: { cattail: { material: 'Material_3_Mat' } },
  },
};

const MODELS = {};
for (const [id, m] of Object.entries(GLB_MODELS)) {
  if (!needed.has(id)) continue;
  const glb = path.join(src, m.file);
  if (!fs.existsSync(glb)) throw new Error(`missing ${glb}`);
  MODELS[id] = { glb, pieces: m.pieces };
}
for (const id of [
  'grass_medium_01',
  'grass_medium_02',
  'nettle_plant',
  'dandelion_01',
  'celandine_01',
  'weed_plant_02',
  'fern_02',
]) {
  if (!needed.has(id)) continue;
  const own = path.join(src, id);
  const dir = fs.existsSync(own) ? own : path.join(src, '..', 'polyhaven', id);
  const t = (name) => path.join(dir, 'textures', `${id}_${name}`);
  const need = (p) => {
    if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
    return p;
  };
  const gltf = path.join(dir, `${id}.gltf`);
  MODELS[id] = {
    gltf: need(fs.existsSync(gltf) ? gltf : path.join(dir, `${id}_1k.gltf`)),
    diff: need(t('diff_1k.jpg')),
    alpha: need(t('alpha_1k.png')),
    arm: need(t('arm_1k.jpg')),
    dry: fs.existsSync(t('dry_diff_1k.png')) ? t('dry_diff_1k.png') : null,
  };
}

// Serve the repo (three) and the sources to the page.
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // (`/@up/`: the sources folder above, for the polyhaven/ models)
  const file = url.startsWith('/@src/')
    ? path.join(src, url.slice(6))
    : url.startsWith('/@up/')
      ? path.join(src, '..', url.slice(5))
      : path.join(root, url);
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}`;
const web = (p) => {
  if (!p) return null;
  const rel = path.relative(src, p);
  return rel.startsWith('..')
    ? `${base}/@up/${path.relative(path.dirname(src), p).split(path.sep).join('/')}`
    : `${base}/@src/${rel.split(path.sep).join('/')}`;
};

// Playwright as in scripts/asphalt/bake.mjs: PLAYWRIGHT_MODULE / CHROMIUM_PATH when it is not installed as `playwright`;
// PLANTS_PROFILE = a Chromium profile folder to run in (kept between runs).
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright'
);
const launchOpts = { executablePath: process.env.CHROMIUM_PATH || undefined };
const browser = process.env.PLANTS_PROFILE
  ? await chromium.launchPersistentContext(
      process.env.PLANTS_PROFILE,
      launchOpts,
    )
  : await chromium.launch(launchOpts);
const page = await browser.newPage();
page.on('console', (m) => console.log('page:', m.text()));
await page.goto(`${base}/scripts/plants/render.html`);
await page.waitForFunction(() => window.ready === true);

const models = Object.fromEntries(
  Object.entries(MODELS).map(([id, m]) => [
    id,
    m.glb
      ? { glb: web(m.glb), pieces: m.pieces }
      : {
          gltf: web(m.gltf),
          diff: web(m.diff),
          alpha: web(m.alpha),
          arm: web(m.arm),
          dry: web(m.dry),
        },
  ]),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plants-'));
const manifest = { hash: layoutHash(), sheets: [] };
for (const s of BAKE) {
  const cw = s.w / s.cols;
  const ch = s.h / s.rows;
  const cells = s.cells.map((c) => ({
    placements: layoutCell(c, s.window),
    window: s.window,
    w: cw,
    h: ch,
  }));
  const used = Object.fromEntries(
    [...new Set(cells.flatMap((c) => c.placements.map((p) => p.model)))].map(
      (id) => [id, models[id]],
    ),
  );
  const out = await page.evaluate((job) => window.bake(job), {
    models: used,
    cells,
    pitch: PITCH,
  });
  const files = out.map((b64, i) => {
    const f = path.join(tmp, `${s.id}-${i}.rgba`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  });
  manifest.sheets.push({ ...s, cellW: cw, cellH: ch, files });
  console.log(`${s.id}: ${cells.length} cells rendered`);
}
await browser.close();
server.close();
const mf = path.join(tmp, 'manifest.json');
fs.writeFileSync(mf, JSON.stringify(manifest));
execFileSync(
  process.env.PYTHON ?? 'python3',
  [path.join(here, 'pack.py'), mf, root],
  {
    stdio: 'inherit',
  },
);
fs.rmSync(tmp, { recursive: true });
// The repo's formatting, so a bake with nothing changed leaves no diff.
execFileSync(
  'npx',
  ['prettier', '--write', 'src/games/rally/engine/plants/plant-atlas.data.ts'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
