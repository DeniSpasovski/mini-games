/**
 * meshopt compression (EXT_meshopt_compression) of a car GLB, applied when the build copies
 * public/models/cars/ into the rally folder (rsbuild.config.ts). The files in git stay plain, so every script /
 * test that reads them is unchanged; the game decodes with three's MeshoptDecoder (cars/shared/car-gltf.ts).
 *
 *   node scripts/car-model/glb-meshopt.mjs <in.glb>... [--out <dir>]   (sizes + round-trip check)
 *
 * Same structure out as in (meshes, materials, float accessors, vertex and triangle order). Indices are lossless
 * (a triangle's corners may be rotated, same winding); POSITION / NORMAL / TEXCOORD_0 go through the exponent
 * filter with `BITS` mantissa bits, every other view is lossless. Each file is decoded again and checked against
 * `MAX_ERROR` (units of our converters: metres / unit wheel space, unit normals, UV) - the build fails
 * rather than ship a car that moved. A file it can't handle (textures, external or several buffers, interleaved
 * views, already compressed) is returned unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const EXT = 'EXT_meshopt_compression';
/** Mantissa bits kept per attribute: ~0.01 mm on a 4 m car, < 0.1 px on a 4096 px livery atlas. */
const BITS = { POSITION: 18, NORMAL: 14, TEXCOORD_0: 20 };
/** Allowed change after decoding: 0.05 mm, a 0.03 deg normal, 1 / 25 px on a 4096 px atlas. */
export const MAX_ERROR = { POSITION: 5e-5, NORMAL: 5e-4, TEXCOORD_0: 1e-5 };
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const align4 = (n) => (n + 3) & ~3;

function readGlb(buf) {
  if (buf.length < 28 || buf.readUInt32LE(0) !== 0x46546c67) return null; // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const bin =
    binStart + 8 <= buf.length
      ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart))
      : null;
  return { json, bin };
}

function writeGlb(json, bin) {
  const js = Buffer.from(JSON.stringify(json));
  const pad = (b, fill) =>
    Buffer.concat([b, Buffer.alloc(align4(b.length) - b.length, fill)]);
  const jsPad = pad(js, 0x20);
  const binPad = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsPad.length + 8 + binPad.length, 8);
  const chunk = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([
    head,
    chunk(jsPad.length, 0x4e4f534a), // JSON
    jsPad,
    chunk(binPad.length, 0x004e4942), // BIN
    binPad,
  ]);
}

/** How each bufferView is encoded: { mode, size, count, semantic? } or null (copied as is). */
function plan(json) {
  const role = new Map(); // accessor -> 'INDICES' | attribute semantic
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives) {
      for (const [k, a] of Object.entries(p.attributes)) role.set(a, k);
      if (p.indices !== undefined)
        role.set(p.indices, (p.mode ?? 4) === 4 ? 'TRIANGLES' : 'INDICES');
    }
  const users = new Map();
  json.accessors.forEach((a, i) => {
    if (a.bufferView === undefined) return;
    users.set(a.bufferView, [...(users.get(a.bufferView) ?? []), i]);
  });
  return json.bufferViews.map((v, vi) => {
    const list = users.get(vi);
    if (!list || list.length !== 1 || v.byteStride !== undefined) return null;
    const a = json.accessors[list[0]];
    const r = role.get(list[0]);
    if (!r || a.sparse || (a.byteOffset ?? 0) !== 0) return null;
    const size = SIZE[a.componentType] * COMPONENTS[a.type];
    if (!size || a.count * size !== v.byteLength) return null;
    if (r === 'TRIANGLES' || r === 'INDICES') {
      if (a.componentType !== 5123 && a.componentType !== 5125) return null;
      const tri = r === 'TRIANGLES' && a.count % 3 === 0;
      return { mode: tri ? 'TRIANGLES' : 'INDICES', size, count: a.count };
    }
    // Vertex codec: element size a multiple of 4, at most 256 bytes.
    if (size % 4 !== 0 || size > 256) return null;
    const filtered = a.componentType === 5126 && BITS[r] ? r : undefined;
    return { mode: 'ATTRIBUTES', size, count: a.count, semantic: filtered };
  });
}

/** GLB bytes -> compressed GLB bytes (or the input, if it can't be compressed or isn't smaller). */
export async function meshoptGlb(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const glb = readGlb(buf);
  if (!glb?.bin) return buf;
  const { json, bin } = glb;
  if (
    json.extensionsUsed?.length ||
    json.extensionsRequired?.length ||
    json.buffers?.length !== 1 ||
    json.buffers[0].uri !== undefined ||
    json.images?.length
  )
    return buf;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const plans = plan(json);
  const parts = []; // the new BIN chunk = buffer 0 (compressed data + views copied as is)
  let binLen = 0;
  let fallbackLen = 0; // buffer 1: decoded size only, no data (the decoder fills it)
  const put = (bytes) => {
    const off = binLen;
    parts.push(bytes, Buffer.alloc(align4(bytes.length) - bytes.length));
    binLen = align4(off + bytes.length);
    return off;
  };
  const views = json.bufferViews.map((v, vi) => {
    const start = v.byteOffset ?? 0;
    const src = bin.subarray(start, start + v.byteLength);
    const p = plans[vi];
    if (!p) return { ...v, buffer: 0, byteOffset: put(src) };
    let data = new Uint8Array(src);
    if (p.semantic) {
      const floats = new Float32Array(data.buffer, 0, p.count * (p.size / 4));
      data = MeshoptEncoder.encodeFilterExp(
        floats,
        p.count,
        p.size,
        BITS[p.semantic],
      );
    }
    const enc = MeshoptEncoder.encodeGltfBuffer(data, p.count, p.size, p.mode);
    const ext = {
      buffer: 0,
      byteOffset: put(Buffer.from(enc.buffer, enc.byteOffset, enc.byteLength)),
      byteLength: enc.byteLength,
      byteStride: p.size,
      mode: p.mode,
      count: p.count,
      ...(p.semantic && { filter: 'EXPONENTIAL' }),
    };
    const view = {
      ...v,
      buffer: 1,
      byteOffset: fallbackLen,
      extensions: { ...v.extensions, [EXT]: ext },
    };
    fallbackLen = align4(fallbackLen + v.byteLength);
    return view;
  });
  if (!fallbackLen) return buf;
  const out = writeGlb(
    {
      ...json,
      extensionsUsed: [EXT],
      extensionsRequired: [EXT],
      buffers: [
        { byteLength: binLen },
        { byteLength: fallbackLen, extensions: { [EXT]: { fallback: true } } },
      ],
      bufferViews: views,
    },
    Buffer.concat(parts),
  );
  if (out.length >= buf.length) return buf;
  verify(json, bin, plans, readGlb(out));
  return out;
}

/** Decode every compressed view and compare with the original; throws if anything moved more than allowed. */
function verify(json, bin, plans, out) {
  out.json.bufferViews.forEach((v, vi) => {
    const e = v.extensions?.[EXT];
    if (!e) return;
    const o = json.bufferViews[vi];
    const want = new Uint8Array(
      bin.subarray(o.byteOffset ?? 0, (o.byteOffset ?? 0) + o.byteLength),
    );
    const got = new Uint8Array(e.count * e.byteStride);
    const src = out.bin.subarray(e.byteOffset, e.byteOffset + e.byteLength);
    MeshoptDecoder.decodeGltfBuffer(
      got,
      e.count,
      e.byteStride,
      src,
      e.mode,
      e.filter,
    );
    const fail = (what) => {
      throw new Error(`glb-meshopt: view ${vi} ${what}`);
    };
    if (e.mode === 'TRIANGLES') {
      // The index codec may rotate a triangle's corners (same winding).
      const Arr = e.byteStride === 2 ? Uint16Array : Uint32Array;
      const A = new Arr(want.buffer);
      const B = new Arr(got.buffer);
      for (let t = 0; t < A.length; t += 3) {
        const same = [0, 1, 2].some(
          (r) =>
            B[t + r] === A[t] &&
            B[t + ((r + 1) % 3)] === A[t + 1] &&
            B[t + ((r + 2) % 3)] === A[t + 2],
        );
        if (!same) fail(`triangle ${t / 3} changed`);
      }
    } else if (e.filter) {
      const A = new Float32Array(want.buffer);
      const B = new Float32Array(got.buffer);
      const max = MAX_ERROR[plans[vi].semantic];
      for (let i = 0; i < A.length; i++)
        if (!(Math.abs(A[i] - B[i]) <= max))
          fail(`${plans[vi].semantic} moved ${Math.abs(A[i] - B[i])}`);
    } else if (Buffer.compare(Buffer.from(got), Buffer.from(want)) !== 0) {
      fail('does not round-trip');
    }
  });
}

// CLI: sizes + round-trip check (meshoptGlb throws on a failed check), optional output folder.
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  const args = process.argv.slice(2);
  const o = args.indexOf('--out');
  const outDir = o >= 0 ? args.splice(o, 2)[1] : null;
  for (const f of args) {
    const src = fs.readFileSync(f);
    const out = await meshoptGlb(src);
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    const pct = Math.round((100 * out.length) / src.length);
    console.log(
      `${path.basename(f)}: ${kb(src.length)} -> ${kb(out.length)} (${pct} %)`,
    );
    if (outDir) fs.writeFileSync(path.join(outDir, path.basename(f)), out);
  }
}
