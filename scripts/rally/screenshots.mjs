/**
 * Retakes the rally pictures listed in `scripts/rally/screenshots.json` (README / map screenshots, the start picture, the
 * stage select, the portal cover and the link preview). Every entry names the stage, car, season, time of day, where on
 * the road (`spawn`: `start` or metres = `?spawn=<m>` of the play URL) and the camera, so a picture can be retaken the
 * same way after the look changes. `src/games/rally/DETAILS.md` -> Screenshots lists them.
 *
 *   npm run dev:noreload                                  (dev server on http://localhost:3000)
 *   node scripts/rally/screenshots.mjs                    all pictures
 *   node scripts/rally/screenshots.mjs --only start-street,night-ajvatovci   some (ids from the json)
 *   node scripts/rally/screenshots.mjs --list             ids and files
 *
 * Options: `--base <url>` (dev server), `--out <dir>` (write the pictures there under their names instead of over the
 * repo's files, for a trial), `--quality high|medium|low`. Headless Chromium with the software GPU (a stage loads in
 * 1-2 minutes, a picture takes seconds); `PLAYWRIGHT_MODULE` / `CHROMIUM_PATH` as in scripts/asphalt/bake.mjs.
 * Entries with the same stage, car, season, time and weather share one page load. Each play picture is the game canvas
 * (no HUD) rendered at 1536x864 after the streaming has settled; the car is dropped on the road at `spawn` (free drive,
 * no clock) and the camera is the game's chase camera unless `cam` says otherwise:
 *   cam.at / cam.look   camera and target in the car frame, metres (right, up, forward)
 *   cam.atWorld         camera as world [x, z, metres above the ground] instead of `at`; the car is parked just behind it
 *                       so the stage streams its terrain and trees there
 *   cam.lookWorld       target as world [x, z] + `cam.lookUp` metres above the ground (the car frame `at` stays)
 *   cam.fov             vertical field of view (deg)
 * `kind`: `play` (default), `stage-select` (the stage screen of the menu, 1280x720), `thumbnail` (the portal cover:
 * thumbnail.jpg 1280x720 + thumbnail-640.jpg of a play view) and `og` (public/og-image.jpg from the portal page).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = opt('base', 'http://localhost:3000').replace(/\/$/, '');
const outDir = opt('out');
const quality = opt('quality', 'high');
const only = opt('only')?.split(',');
const entries = JSON.parse(
  readFileSync(
    opt('manifest', path.join(root, 'scripts/rally/screenshots.json')),
    'utf8',
  ),
).filter((e) => !only || only.includes(e.id));
if (args.includes('--list')) {
  for (const e of entries) console.log(`${e.id.padEnd(24)} ${e.file}`);
  process.exit(0);
}
const W = 1536;
const H = 864;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = (file) =>
  outDir
    ? path.join(
        outDir,
        file
          .replace(/^(src\/games\/rally\/|public\/)/, '')
          .replace(/maps\/|screenshots\//g, '')
          .replace(/\//g, '-'),
      )
    : path.join(root, file);
const save = (file, dataUrl) => {
  const out = target(file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  saved ${path.relative(root, out)}`);
};

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright'
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
  ],
});

const playUrl = (e) => {
  const p = new URLSearchParams({
    stage: e.stage,
    car: e.car ?? 'skoda_rally',
    mute: '1',
    quality,
  });
  if (e.livery != null) p.set('livery', e.livery);
  if (e.season) p.set('season', e.season);
  if (e.tod != null) p.set('tod', e.tod);
  if (e.weather) p.set('weather', e.weather);
  p.set('spawn', String(e.spawn));
  return `${base}/games/rally/?${p}`;
};
const groupKey = (e) =>
  [
    e.stage,
    e.car,
    e.livery,
    e.season,
    e.tod,
    e.weather,
    e.spawn === 'start' ? 'start' : 'road',
  ].join('|');

/** Plays a stage and takes every view of the group. */
async function playGroup(group) {
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (err) =>
    console.log('  pageerror', String(err).slice(0, 200)),
  );
  await page.goto(playUrl(group[0]), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('!!(window.__rally && __rally.loadMs > 0)', null, {
    timeout: 1500000,
    polling: 1000,
  });
  for (const e of group) {
    console.log(`${e.id}`);
    const data = await page.evaluate(async (view) => {
      const g = window.__rally;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (view.spawn !== 'start') {
        if (!g.freeDrive) {
          g.freeDrive = true;
          g.stage.freeDrive();
        }
        const s = g.world.roadSpawn(Number(view.spawn));
        g.vehicle.reset(s.position, s.heading);
        g.tyreMarks.breakStrips();
        g.rig.snap();
        for (let i = 0; i < 60; i++) {
          if (g.terrain.update(s.position, 300) || g.terrain.pending === 0)
            break;
          await wait(50);
        }
        g.streamer.updateNow(s.position);
      }
      if (view.cam?.atWorld) {
        // The stage streams (terrain detail, trees) round the car: park it just behind the camera, out of the view.
        const [x, z] = view.cam.atWorld;
        const to = view.cam.lookWorld ?? [x, z + 1];
        const len = Math.hypot(to[0] - x, to[1] - z) || 1;
        const bx = x - ((to[0] - x) / len) * 14;
        const bz = z - ((to[1] - z) / len) * 14;
        const car = g.world.roadSpawn(0);
        const p = car.position
          .clone()
          .set(bx, g.world.heightAt(bx, bz) + 1, bz);
        if (!g.freeDrive) {
          g.freeDrive = true;
          g.stage.freeDrive();
        }
        g.vehicle.reset(p, car.heading);
        g.tyreMarks.breakStrips();
        g.rig.snap();
        for (let i = 0; i < 80; i++) {
          if (g.terrain.update(p, 300) || g.terrain.pending === 0) break;
          await wait(50);
        }
        g.streamer.updateNow(p);
      }
      g.stop(); // the game's own frame loop would render nonstop on the software GPU: step the frames here
      const noRender = (fn) => {
        const r0 = g.renderer.render;
        const p0 = g.post && g.post.render;
        g.renderer.render = () => {};
        if (g.post) g.post.render = () => {};
        try {
          fn();
        } finally {
          g.renderer.render = r0;
          if (g.post) g.post.render = p0;
        }
      };
      const rig = g.rig;
      const cam = g.camera;
      if (!rig.__orig) {
        rig.__orig = rig.update.bind(rig);
        g.__fov0 = cam.fov;
      }
      rig.update = (dt, v, pos, fwd, up) => {
        rig.__orig(dt, v, pos, fwd, up);
        const c = view.cam;
        if (!c) return;
        const right = fwd.clone().cross(up).normalize();
        const at = (o) =>
          pos
            .clone()
            .addScaledVector(right, o[0])
            .addScaledVector(up, o[1])
            .addScaledVector(fwd, o[2]);
        if (c.atWorld)
          cam.position.set(
            c.atWorld[0],
            g.world.heightAt(c.atWorld[0], c.atWorld[1]) + c.atWorld[2],
            c.atWorld[1],
          );
        else if (c.at) cam.position.copy(at(c.at));
        cam.up.set(0, 1, 0);
        if (c.lookWorld)
          cam.lookAt(
            c.lookWorld[0],
            g.world.heightAt(c.lookWorld[0], c.lookWorld[1]) + (c.lookUp ?? 0),
            c.lookWorld[1],
          );
        else if (c.look) cam.lookAt(at(c.look));
        cam.fov = c.fov ?? g.__fov0;
        cam.updateProjectionMatrix();
      };
      if (!view.cam) {
        cam.fov = g.__fov0;
        cam.updateProjectionMatrix();
      }
      // Settle: streaming, tree workers and fades on cheap simulation frames, then real ones.
      for (let k = 0; k < 4; k++) {
        noRender(() => {
          for (let i = 0; i < 6; i++) g.frame(0.05);
        });
        await wait(700);
      }
      g.frame(0.05);
      await wait(1500);
      g.frame(0.05);
      await wait(500);
      g.frame(0);
      const out = { full: g.renderer.domElement.toDataURL('image/jpeg', 0.9) };
      if (view.kind === 'thumbnail') {
        // As src/shared/thumbnail.ts (F9): the 16:9 centre of the canvas at 1280 and 640 px.
        const crop = (w, q) => {
          const h = (w * 9) / 16;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(
            g.renderer.domElement,
            0,
            0,
            g.renderer.domElement.width,
            g.renderer.domElement.height,
            0,
            0,
            w,
            h,
          );
          return c.toDataURL('image/jpeg', q);
        };
        out.full = crop(1280, 0.82);
        out.small = crop(640, 0.85);
      }
      return out;
    }, e);
    save(e.file, data.full);
    if (data.small) save(e.file.replace('.jpg', '-640.jpg'), data.small);
  }
  await page.close();
}

/** The menu's stage screen (the first stage highlighted), 1280x720. */
async function stageSelect(e) {
  console.log(`${e.id}`);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.goto(`${base}/games/rally/?mute=1&quality=${quality}`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await page.click('.menu-btn[data-a="start"]', { timeout: 120000 });
  await page.waitForSelector('text=Select stage', { timeout: 60000 });
  await sleep(e.settle ?? 20000);
  const png = await page.screenshot({
    type: 'jpeg',
    quality: 90,
    timeout: 120000,
  });
  save(e.file, `data:image/jpeg;base64,${png.toString('base64')}`);
  await page.close();
}

const groups = new Map();
for (const e of entries.filter(
  (x) => (x.kind ?? 'play') === 'play' || x.kind === 'thumbnail',
)) {
  const k = groupKey(e);
  groups.set(k, [...(groups.get(k) ?? []), e]);
}
for (const group of groups.values()) await playGroup(group);
for (const e of entries.filter((x) => x.kind === 'stage-select'))
  await stageSelect(e);
for (const e of entries.filter((x) => x.kind === 'og')) {
  // The portal page as scripts/portal/og-image.mjs takes it (its Gravel Rally card shows thumbnail.jpg, so after the cover).
  console.log(`${e.id}`);
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(`${base}/?mute=1`, { waitUntil: 'load', timeout: 120000 });
  await sleep(4000);
  await page.evaluate(() => {
    document.querySelector('.portal-footer')?.remove();
    document
      .querySelectorAll('.tools-toggle')
      .forEach((t) => (t.style.visibility = 'hidden'));
    document.querySelectorAll('img').forEach((i) => (i.loading = 'eager'));
  });
  await sleep(1500);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 86 });
  save(e.file, `data:image/jpeg;base64,${jpg.toString('base64')}`);
  await page.close();
}
await browser.close();
