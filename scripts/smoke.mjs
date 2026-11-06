// Browser smoke test: loads each game's play and tool pages in headless Chrome (a rally stage driven a few seconds on
// autopilot, the viewers, Hole Island, Kaboom) and fails on any console error, uncaught exception, WebGL error or failed
// same-origin request.
//   npm run test:smoke                              -> against a running dev server on http://localhost:3000
//   npm run test:smoke -- --base http://localhost:3040 --stage jackie --car bimmer_m3
//   npm run test:smoke -- --dist dist               -> serves a build (`npm run build:test`) on a free port
// Options: --gpu native|swiftshader (default: swiftshader on CI, the real GPU locally), --drive <s> (autopilot seconds),
// --games rally,hole,kaboom (default: all; CI passes the `smoke` output of scripts/ci-affected.mjs).
// By default every run uses a fresh temp profile, so it is also a cold-cache load (no HTTP / shader / IndexedDB cache).
// --profile <dir> (or SMOKE_PROFILE=<dir>) reuses a profile folder instead (created if missing, never deleted; disk cache off).
// CHROME=<path> picks the browser; otherwise the usual Chrome / Chromium install paths are tried.
import { execSync, spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((a) => {
      const [key, ...value] = a.trim().split(/\s+/);
      return [key, value.join(' ') || undefined];
    }),
);
const STAGE = args.stage ?? 'ajvatovci';
const CAR = args.car ?? 'skoda_rally';
const GPU = args.gpu ?? (process.env.CI ? 'swiftshader' : 'native');
const DRIVE_S = Number(args.drive ?? 6);
const PAGE_TIMEOUT_S = GPU === 'swiftshader' ? 600 : 240; // the software GPU loads a map in minutes
const PROFILE = args.profile ?? process.env.SMOKE_PROFILE;
const GAMES = (args.games ?? 'rally,hole,kaboom').split(',').filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const paths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const p of paths) if (existsSync(p)) return p;
  for (const name of [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ]) {
    try {
      return execSync(`command -v ${name}`, { encoding: 'utf8' }).trim();
    } catch {
      // not on PATH
    }
  }
  throw new Error('Chrome not found - set CHROME=<path>');
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Serves a build folder on a free port; resolves to its base URL. */
function serveDist(dir) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let file = join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  });
  cleanups.push(() => server.close());
  return new Promise((r) =>
    server.listen(0, 'localhost', () =>
      r(`http://localhost:${server.address().port}`),
    ),
  );
}

/** Cleanups for Ctrl+C / kill: Chrome, and the build server when this script started one. */
const cleanups = [];
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    for (const f of cleanups) f();
    process.exit(130);
  });

async function launchChrome() {
  const profile = PROFILE
    ? resolve(PROFILE)
    : mkdtempSync(join(tmpdir(), 'smoke-'));
  if (PROFILE) mkdirSync(profile, { recursive: true });
  const port = 9200 + Math.floor(Math.random() * 700);
  const gpu =
    GPU === 'swiftshader'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--ignore-gpu-blocklist', '--enable-gpu'];
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1280,720',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      ...(PROFILE ? ['--disk-cache-size=1'] : []),
      ...gpu,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const close = () => {
    chrome.kill();
    if (PROFILE) return; // a reused profile stays
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // Chrome may still hold the profile
    }
  };
  process.on('exit', close);
  cleanups.push(close);
  let ws;
  for (let i = 0; i < 120 && !ws; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // not up yet
    }
  }
  if (!ws) throw new Error('Chrome did not start');
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    for (const l of listeners) l(m);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails)
      throw new Error(
        r.result.exceptionDetails.exception?.description ?? 'eval failed',
      );
    return r.result?.result?.value;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close };
}

const GL_TEXT = /WebGL|GL_INVALID|GL ERROR|shader/i;
// Driver performance hints and missing optional extensions (SwiftShader) are not errors.
const IGNORE = /GL Driver Message \([^)]*Performance|extension not supported/i;
const text = (s, n = 400) => String(s ?? '').slice(0, n);

/** Collects the page's errors; same-origin requests only (analytics etc. may be blocked offline). */
function watchErrors(c, origin) {
  const errors = [];
  const requests = new Map();
  c.on((m) => {
    const p = m.params;
    if (m.method === 'Runtime.consoleAPICalled') {
      const msg = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (IGNORE.test(msg)) return;
      if (
        p.type === 'error' ||
        p.type === 'assert' ||
        (p.type === 'warning' && GL_TEXT.test(msg))
      )
        errors.push(`console.${p.type}: ${text(msg)}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      errors.push(`exception: ${text(d.exception?.description ?? d.text)}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = p.entry;
      if (e.source === 'network' || IGNORE.test(e.text)) return; // network: reported below with the URL
      if (
        e.level === 'error' ||
        (e.level === 'warning' && GL_TEXT.test(e.text))
      )
        errors.push(`${e.source} ${e.level}: ${text(e.text)}`);
    } else if (m.method === 'Network.requestWillBeSent') {
      requests.set(p.requestId, p.request.url);
    } else if (m.method === 'Network.responseReceived') {
      if (p.response.status >= 400 && p.response.url.startsWith(origin))
        errors.push(`HTTP ${p.response.status}: ${p.response.url}`);
    } else if (m.method === 'Network.loadingFailed') {
      const url = requests.get(p.requestId) ?? '';
      if (
        !p.canceled &&
        p.errorText !== 'net::ERR_ABORTED' &&
        url.startsWith(origin)
      )
        errors.push(`request failed (${p.errorText}): ${url}`);
    }
  });
  return errors;
}

/** Polls `expression` until truthy; a value `{ error }` (a failed load the page reported) ends the wait at once. */
async function waitFor(c, expression) {
  for (let i = 0; i < PAGE_TIMEOUT_S * 4; i++) {
    await sleep(250);
    try {
      const v = await c.evaluate(expression);
      if (v?.error) return v.error;
      if (v) return true;
    } catch {
      // page still loading
    }
  }
  return false;
}

// Pages without a debug hook: the first canvas with a WebGL2 context (three.js creates WebGL2).
const glError = (renderer) =>
  renderer
    ? `(() => { const gl = ${renderer}?.getContext(); return gl ? gl.getError() : 0; })()`
    : `(() => { for (const cv of document.querySelectorAll('canvas')) { const gl = cv.getContext('webgl2'); if (gl) return gl.getError(); } return 0; })()`;
// Pages without a debug hook are ready once the document has loaded and shows a canvas.
const CANVAS_READY =
  "document.readyState === 'complete' && !!document.querySelector('canvas')";

const ALL_PAGES = [
  {
    game: 'rally',
    name: `stage ${STAGE}`,
    path: `games/rally/?stage=${STAGE}&car=${CAR}&mute=1&spawn=start`,
    ready: '!!(window.__rally && __rally.loadMs > 0)',
    run: `__rally.onAction('autopilot')`,
    settleS: DRIVE_S,
    renderer: '__rally.renderer',
  },
  {
    game: 'rally',
    name: `map viewer ${STAGE}`,
    path: `games/rally/map-viewer.html?map=${STAGE}&mute=1`,
    ready: '!!window.__mapViewer',
    settleS: 3,
    renderer: '__mapViewer.shell.renderer',
  },
  {
    game: 'rally',
    name: `car viewer ${CAR}`,
    path: `games/rally/car-viewer.html?car=${CAR}&mute=1`,
    // a failed model load comes back as { error }: no waiting out the timeout
    ready:
      '(async () => { const m = window.__carViewer?.model; if (!m) return false; try { await m.ready; } catch (e) { return { error: `car model: ${e?.stack ?? e}` }; } return true; })()',
    settleS: 3,
    renderer: '__carViewer.shell.renderer',
  },
  {
    game: 'rally',
    name: 'asset debugger',
    path: 'games/rally/asset-debug.html?mute=1',
    ready: CANVAS_READY,
    settleS: 3,
  },
  {
    game: 'hole',
    name: 'hole play',
    path: 'games/hole/?mute=1',
    ready: '!!window.__hole',
    run: '__hole.advance(2)',
    settleS: 2,
    renderer: '__hole.game.renderer',
  },
  {
    game: 'hole',
    name: 'hole item viewer',
    path: 'games/hole/item-viewer.html?mute=1',
    ready: '!!window.__itemViewer',
    settleS: 2,
    renderer: '__itemViewer.shell.renderer',
  },
  {
    game: 'hole',
    name: 'hole map viewer',
    path: 'games/hole/map-viewer.html?mute=1',
    ready: '!!window.__mapViewer?.map',
    settleS: 2,
    renderer: '__mapViewer.shell.renderer',
  },
  {
    game: 'kaboom',
    name: 'kaboom play',
    path: 'games/kaboom/?mute=1',
    ready: '!!window.__kaboom',
    run: '__kaboom.advance(2)',
    settleS: 2,
    renderer: '__kaboom.game.renderer',
  },
  {
    game: 'kaboom',
    name: 'kaboom map viewer',
    path: 'games/kaboom/map-viewer.html?mute=1',
    ready: CANVAS_READY,
    settleS: 2,
  },
  {
    game: 'kaboom',
    name: 'kaboom crew viewer',
    path: 'games/kaboom/crew-viewer.html?mute=1',
    ready: '!!window.__crew',
    settleS: 2,
  },
];
const PAGES = ALL_PAGES.filter((p) => GAMES.includes(p.game));

const base = (
  args.dist
    ? await serveDist(args.dist)
    : (args.base ?? 'http://localhost:3000')
).replace(/\/$/, '');
try {
  await fetch(base);
} catch {
  console.error(
    `smoke: nothing answers on ${base} - start the dev server or pass --base / --dist`,
  );
  process.exit(1);
}

const c = await launchChrome();
await c.send('Runtime.enable');
await c.send('Log.enable');
await c.send('Network.enable');
const origin = new URL(base).origin;
let failed = 0;
for (const page of PAGES) {
  await c.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  const errors = watchErrors(c, origin);
  const t0 = Date.now();
  await c.send('Page.navigate', { url: `${base}/${page.path}` });
  const ready = await waitFor(c, page.ready);
  if (!ready) errors.push(`not ready after ${PAGE_TIMEOUT_S} s`);
  else if (ready !== true) errors.push(ready);
  else {
    if (page.run)
      await c.evaluate(page.run).catch((e) => errors.push(`run: ${e.message}`));
    await sleep(page.settleS * 1000);
    const gl = await c.evaluate(glError(page.renderer)).catch(() => 0);
    if (gl) errors.push(`gl.getError() = 0x${gl.toString(16)}`);
  }
  const unique = [...new Set(errors)];
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${unique.length ? 'FAIL' : 'ok  '} ${page.name} (${s} s)`);
  for (const e of unique) console.log(`     ${e}`);
  if (unique.length) failed++;
}
c.close();
console.log(
  failed
    ? `smoke: ${failed} of ${PAGES.length} pages failed`
    : `smoke: ${PAGES.length} pages clean`,
);
process.exit(failed ? 1 : 0);
