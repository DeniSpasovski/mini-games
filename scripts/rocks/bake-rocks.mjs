/**
 * Bakes the scanned roadside rocks (Poly Haven "Rock Moss Set 01", CC0, Kless Gyzen) into
 * src/games/rally/assets/builders/rock-models.data.ts and their shared textures into
 * src/games/rally/engine/props/rocks.{color,normal}.webp.
 *
 *   node scripts/rocks/bake-rocks.mjs sources/rally/rocks
 *
 * The source folder holds the 1k glTF download (rock_moss_set_01_1k.gltf + .bin + textures/). Each of the six stones is
 * simplified (meshoptimizer) to the triangle budgets in `LODS`, centred, its lowest 8 % sunk below y = 0, and scaled to
 * a unit footprint (largest horizontal half-extent 1); the builder (assets/builders/rocks.ts) scales it per asset. The
 * last (far) level is simplified from the one before, or vertex-clustered where the simplifier stops short (open
 * scans keep their borders).
 *
 * Packed mesh (little endian, base64): u16 vertex count, u16 0, then per vertex i16 x3 position (/ 16384, unit
 * footprint), i8 x3 normal, u16 x2 uv (/ 65535), then u16 indices.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const src = path.resolve(process.argv[2] ?? 'sources/rally/rocks');
/** Triangle budget per level of detail. */
const LODS = [700, 120, 40];
const SINK = 0.08;

await MeshoptSimplifier.ready;
const g = JSON.parse(
  fs.readFileSync(path.join(src, 'rock_moss_set_01_1k.gltf'), 'utf8'),
);
const bin = fs.readFileSync(path.join(src, g.buffers[0].uri));
const SIZE = { 5126: 4, 5123: 2, 5125: 4 };
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3 };
function acc(i) {
  const a = g.accessors[i];
  const v = g.bufferViews[a.bufferView];
  const n = COMP[a.type];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? n * SIZE[a.componentType];
  const T =
    a.componentType === 5126
      ? Float32Array
      : a.componentType === 5125
        ? Uint32Array
        : Uint16Array;
  const out = new T(a.count * n);
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++) {
      const o = off + k * stride + c * SIZE[a.componentType];
      out[k * n + c] =
        a.componentType === 5126
          ? bin.readFloatLE(o)
          : a.componentType === 5125
            ? bin.readUInt32LE(o)
            : bin.readUInt16LE(o);
    }
  return out;
}

function pack(pos, nor, uv, idx) {
  // Keep only the vertices the indices use.
  const map = new Map();
  const vi = [];
  const ni = new Uint16Array(idx.length);
  idx.forEach((v, k) => {
    if (!map.has(v)) {
      map.set(v, vi.length);
      vi.push(v);
    }
    ni[k] = map.get(v);
  });
  const n = vi.length;
  const buf = Buffer.alloc(4 + n * (6 + 3 + 4) + ni.length * 2);
  let o = 0;
  buf.writeUInt16LE(n, o);
  o += 4;
  for (const v of vi) {
    for (let c = 0; c < 3; c++) {
      buf.writeInt16LE(Math.round(pos[v * 3 + c] * 16384), o);
      o += 2;
    }
    for (let c = 0; c < 3; c++)
      buf.writeInt8(Math.round(nor[v * 3 + c] * 127), o++);
    for (let c = 0; c < 2; c++) {
      buf.writeUInt16LE(
        Math.round(Math.min(1, Math.max(0, uv[v * 2 + c])) * 65535),
        o,
      );
      o += 2;
    }
  }
  for (const i of ni) {
    buf.writeUInt16LE(i, o);
    o += 2;
  }
  return { b64: buf.toString('base64'), tris: ni.length / 3 };
}

/**
 * Vertex clustering on a `res`^3 grid over the mesh's box: corners move to their cell's first vertex but keep their own
 * normal and uv (so seams stay clean); collapsed and repeated triangles drop out.
 */
function cluster(pos, nor, uv, idx, res) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < pos.length / 3; v++)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], pos[v * 3 + c]);
      hi[c] = Math.max(hi[c], pos[v * 3 + c]);
    }
  const cell = new Map();
  const rep = new Uint32Array(pos.length / 3);
  for (let v = 0; v < rep.length; v++) {
    const k = [0, 1, 2]
      .map((c) =>
        Math.min(
          res - 1,
          Math.floor(((pos[v * 3 + c] - lo[c]) / (hi[c] - lo[c] || 1)) * res),
        ),
      )
      .join(',');
    if (!cell.has(k)) cell.set(k, v);
    rep[v] = cell.get(k);
  }
  const [P, N, U, I] = [[], [], [], []];
  const corners = new Map();
  const seen = new Set();
  const corner = (v) => {
    const k = `${rep[v]}:${v}`;
    if (!corners.has(k)) {
      corners.set(k, P.length / 3);
      P.push(...pos.subarray(rep[v] * 3, rep[v] * 3 + 3));
      N.push(...nor.subarray(v * 3, v * 3 + 3));
      U.push(...uv.subarray(v * 2, v * 2 + 2));
    }
    return corners.get(k);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (rep[a] === rep[b] || rep[b] === rep[c] || rep[a] === rep[c]) continue;
    const key = [rep[a], rep[b], rep[c]].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    I.push(corner(a), corner(b), corner(c));
  }
  return [
    Float32Array.from(P),
    Float32Array.from(N),
    Float32Array.from(U),
    Uint32Array.from(I),
  ];
}

/** The far level from the level before it: simplified, or clustered where the simplifier stops short. */
function farLod(prev, unit, nor, uv, tris) {
  let [out] = MeshoptSimplifier.simplify(prev, unit, 3, tris * 3, 0.05, []);
  for (const err of [0.2, 1])
    if (out.length > tris * 3 * 1.3)
      [out] = MeshoptSimplifier.simplify(prev, unit, 3, tris * 3, err, []);
  let mesh = [unit, nor, uv, out];
  for (let res = 12; mesh[3].length > tris * 3 * 1.5 && res >= 2; res--)
    mesh = cluster(unit, nor, uv, prev, res);
  return mesh;
}

const rocks = [];
for (const node of g.nodes) {
  if (node.mesh === undefined) continue;
  const prim = g.meshes[node.mesh].primitives[0];
  const pos = acc(prim.attributes.POSITION);
  const nor = acc(prim.attributes.NORMAL);
  const uv = acc(prim.attributes.TEXCOORD_0);
  const idx = Uint32Array.from(acc(prim.indices));
  // Centre on the footprint, sink the base, scale to a unit footprint.
  let [x0, y0, z0, x1, y1, z1] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (let k = 0; k < pos.length; k += 3) {
    x0 = Math.min(x0, pos[k]);
    x1 = Math.max(x1, pos[k]);
    y0 = Math.min(y0, pos[k + 1]);
    y1 = Math.max(y1, pos[k + 1]);
    z0 = Math.min(z0, pos[k + 2]);
    z1 = Math.max(z1, pos[k + 2]);
  }
  const s = (1 / Math.max(x1 - x0, z1 - z0)) * 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const base = y0 + (y1 - y0) * SINK;
  const unit = new Float32Array(pos.length);
  for (let k = 0; k < pos.length; k += 3) {
    unit[k] = (pos[k] - cx) * s;
    unit[k + 1] = (pos[k + 1] - base) * s;
    unit[k + 2] = (pos[k + 2] - cz) * s;
  }
  let prev;
  const lods = LODS.map((tris, k) => {
    if (k === LODS.length - 1 && prev)
      return pack(...farLod(prev, unit, nor, uv, tris));
    let [out] = MeshoptSimplifier.simplify(idx, unit, 3, tris * 3, 0.05, []);
    for (const err of [0.2, 1])
      if (out.length > tris * 3 * 1.3)
        [out] = MeshoptSimplifier.simplify(idx, unit, 3, tris * 3, err, []);
    prev = out;
    return pack(unit, nor, uv, out);
  });
  rocks.push({ name: node.name, height: (y1 - base) * s, lods });
  console.log(
    node.name,
    'height',
    ((y1 - base) * s).toFixed(2),
    lods.map((l) => l.tris).join(' / '),
    'tris',
  );
}

const ts = `// Generated by scripts/rocks/bake-rocks.mjs from Poly Haven "Rock Moss Set 01" (CC0). Do not edit.
export interface RockModelData {
  /** Height above the ground at a unit footprint (largest horizontal half-extent 1). */
  height: number;
  /** Packed mesh per level of detail (layout: see the baker). */
  lods: string[];
}

export const ROCK_MODELS: RockModelData[] = [
${rocks.map((r) => `  { height: ${r.height.toFixed(3)}, lods: [${r.lods.map((l) => `'${l.b64}'`).join(', ')}] },`).join('\n')}
];
`;
fs.writeFileSync(
  path.join(root, 'src/games/rally/assets/builders/rock-models.data.ts'),
  ts,
);

// Textures: the set's 1k colour and normal maps as WebP (Pillow via python, kept simple).
const require = createRequire(import.meta.url);
const { execFileSync } = require('node:child_process');
const out = path.join(root, 'src/games/rally/engine/props');
for (const [part, name] of [
  ['diff', 'color'],
  ['nor_gl', 'normal'],
]) {
  execFileSync('python3', [
    '-I',
    '-c',
    `import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], quality=86, method=6)`,
    path.join(src, `textures/rock_moss_set_01_${part}_1k.jpg`),
    path.join(out, `rocks.${name}.webp`),
  ]);
}
console.log('wrote', rocks.length, 'rocks');
