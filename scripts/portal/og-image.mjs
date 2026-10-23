/**
 * Retakes `public/og-image.jpg`, the portal's 1200x630 link preview (Open Graph, rsbuild.config.ts): a screenshot of the
 * home page from headless Chrome, without the footer and the Tools toggles. Run with the dev server up:
 *
 *   npm run dev            (or dev:noreload)
 *   node scripts/portal/og-image.mjs [http://localhost:3000/] [path/to/chrome]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3000/';
const chrome =
  process.argv[3] ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'google-chrome');
const out = path.resolve(import.meta.dirname, '../../public/og-image.jpg');
const port = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'og-'))}`,
  '--hide-scrollbars',
  'about:blank',
]);
try {
  let tabs;
  for (let i = 0; i < 50 && !tabs; i++) {
    try {
      tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  const ws = new WebSocket(
    tabs.find((t) => t.type === 'page').webSocketDebuggerUrl,
  );
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 630,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', {
    url: `${url}${url.includes('?') ? '&' : '?'}mute=1`,
  });
  await sleep(4000);
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.portal-footer')?.remove();
      document.querySelectorAll('.tools-toggle').forEach((e) => (e.style.visibility = 'hidden'));
      document.querySelectorAll('img').forEach((i) => (i.loading = 'eager'));`,
  });
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 86,
  });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`saved ${path.relative(process.cwd(), out)}`);
  ws.close();
} finally {
  proc.kill();
}
