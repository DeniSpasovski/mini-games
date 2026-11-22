/**
 * Bakes GPU-compressed copies (KTX2, Basis Universal) of the road asphalt sets next to their webp files in
 * src/games/rally/engine/asphalt/:
 *
 *   node scripts/textures/bake-ktx2.mjs [id ...]        (default: every set, both sizes)
 *
 * Per set and size: `<id>.<size>.color.ktx2` (UASTC + Zstandard, sRGB) and `<id>.<size>.nr.ktx2` (UASTC + Zstandard, linear:
 * normal xyz with the rough map's green in alpha, the packing engine/road-surface.ts did on the CPU at load).
 * Both carry mipmaps and are flipped (compressed textures never use flipY). The game loads them through
 * engine/ktx2.ts and falls back to the webp set when a file is missing. Rerun after scripts/asphalt/bake.mjs.
 *
 * The webp tiles are decoded in headless Chromium (canvas, as the game did) and encoded with the `ktx2-encoder`
 * package (MIT, the Basis Universal encoder as WebAssembly). Not a dependency of the repo: install it anywhere and
 * point `KTX2_ENCODER_MODULE=<path to ktx2-encoder/dist/node/index.js>` at it. Playwright as in scripts/asphalt/bake.mjs
 * (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../src/games/rally/engine/asphalt');

const encoderPath = process.env.KTX2_ENCODER_MODULE;
const { encodeToKTX2 } = await import(
  encoderPath ? pathToFileURL(path.resolve(encoderPath)).href : 'ktx2-encoder'
);
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;

/**
 * Colour: UASTC too. ETC1S was a quarter of the size but lost about a fifth of the asphalt grain (PSNR 31 dB against
 * 48 dB on road_tarmac); on the GPU both take the same memory.
 */
const COLOR = {
  isUASTC: true,
  uastcLDRQualityLevel: 2,
  needSupercompression: true,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
};
/** Normal + roughness: UASTC (keeps the fine normals ETC1S would band), Zstandard on top for the download. */
const NR = {
  isUASTC: true,
  uastcLDRQualityLevel: 2,
  needSupercompression: true,
  isPerceptual: false,
  isSetKTX2SRGBTransferFunc: false,
};

const sets = new Map();
for (const f of fs.readdirSync(dir)) {
  const m = /^(.+)\.(\d+)\.color\.webp$/.exec(f);
  if (m) sets.set(`${m[1]}.${m[2]}`, { id: m[1], size: Number(m[2]) });
}
const only = new Set(process.argv.slice(2));
const todo = [...sets.values()].filter((s) => !only.size || only.has(s.id));
if (!todo.length) throw new Error(`no asphalt sets match ${[...only]}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

/** Raw RGBA of a webp, top row first (canvas decode, like the game's own loader). */
async function rgba(file) {
  const src = `data:image/webp;base64,${fs.readFileSync(file).toString('base64')}`;
  const { width, height, b64 } = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000)
      s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { width: c.width, height: c.height, b64: btoa(s) };
  }, src);
  return { width, height, data: new Uint8Array(Buffer.from(b64, 'base64')) };
}

async function encode(img, options) {
  return encodeToKTX2(new Uint8Array(0), {
    ...options,
    isKTX2File: true,
    generateMipmap: true,
    isYFlip: true,
    imageDecoder: async () => img,
  });
}

let before = 0;
let after = 0;
for (const { id, size } of todo) {
  const t0 = Date.now();
  const base = path.join(dir, `${id}.${size}`);
  const color = await rgba(`${base}.color.webp`);
  const normal = await rgba(`${base}.normal.webp`);
  const rough = await rgba(`${base}.rough.webp`);
  const nr = new Uint8Array(normal.data);
  for (let i = 0; i < nr.length; i += 4) nr[i + 3] = rough.data[i + 1];
  const outColor = await encode(color, COLOR);
  const outNr = await encode({ ...normal, data: nr }, NR);
  fs.writeFileSync(`${base}.color.ktx2`, outColor);
  fs.writeFileSync(`${base}.nr.ktx2`, outNr);
  const webp = ['color', 'normal', 'rough'].reduce(
    (n, p) => n + fs.statSync(`${base}.${p}.webp`).size,
    0,
  );
  before += webp;
  after += outColor.length + outNr.length;
  console.log(
    `${id}.${size}: webp ${(webp / 1024).toFixed(0)} KB -> ktx2 ${((outColor.length + outNr.length) / 1024).toFixed(0)} KB (${Date.now() - t0} ms)`,
  );
}
console.log(
  `total: webp ${(before / 1048576).toFixed(1)} MB -> ktx2 ${(after / 1048576).toFixed(1)} MB`,
);
await browser.close();
