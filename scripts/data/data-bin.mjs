// Moves the packed meshes of baked `*.data.ts` files out of the script into `<name>.data.bin` next to it.
// usage: node scripts/data/data-bin.mjs <file.data.ts> [...]   (every baker that writes packed meshes runs it last)
//
// In:  the baker's output, each mesh a base64 string literal ('...', 64+ characters).
// Out: the same file with each literal replaced by `B(offset, length)` (a Uint8Array view, src/shared/data-bin.ts)
//      and the bytes in `<name>.data.bin`. Data URIs (textures) and short strings stay as they are.
// A file without such literals (already converted) is left alone.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SHARED = path.join(ROOT, 'src/shared/data-bin');
const LITERAL = /'([A-Za-z0-9+/]{64,}={0,2})'/g;

export function dataBin(file) {
  const src = readFileSync(file, 'utf8');
  const chunks = [];
  let size = 0;
  const body = src.replace(LITERAL, (_, b64) => {
    const bytes = Buffer.from(b64, 'base64');
    // 4-byte aligned, so a decoder may lay typed arrays straight over a view.
    const pad = (4 - (size % 4)) % 4;
    if (pad) chunks.push(Buffer.alloc(pad));
    size += pad;
    const at = size;
    chunks.push(bytes);
    size += bytes.length;
    return `B(${at}, ${bytes.length})`;
  });
  if (!chunks.length) return null;
  const bin = file.replace(/\.ts$/, '.bin');
  let rel = path.relative(path.dirname(file), SHARED).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  const head =
    `import { loadBin } from '${rel}';\n` +
    `const B = await loadBin(new URL('./${path.basename(bin)}', import.meta.url));\n`;
  // After the leading comment and import lines.
  const lines = body.split('\n');
  let at = 0;
  while (at < lines.length && /^(\/\/|import\b)/.test(lines[at])) at++;
  lines.splice(at, 0, head.trimEnd());
  writeFileSync(file, lines.join('\n'));
  writeFileSync(bin, Buffer.concat(chunks));
  return { bin, size, meshes: chunks.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) {
    const r = dataBin(file);
    console.log(
      r
        ? `${file}: ${r.meshes} blobs -> ${path.basename(r.bin)} (${(r.size / 1e6).toFixed(2)} MB)`
        : `${file}: nothing to move`,
    );
  }
}
