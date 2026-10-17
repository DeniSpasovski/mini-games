/**
 * Bakes the two CC BY person models (credits: THIRD-PARTY.md) into src/games/rally/engine/people-scan.data.ts.
 * The sources are not in the repository (sources/people/, git-ignored). Their own triangles and texture are kept; a second,
 * simplified mesh serves the mid range.
 *
 *   python scripts/people/extract.py sources/people/male_character_in_casual_clothing.glb <dir> male male
 *   python scripts/people/extract.py sources/people/female_character_with_casual_clothing.glb <dir> female female
 *   node scripts/people/bake-people.mjs <dir>
 *
 * Mid-range mesh: the same without uv, plus u8 colour[3] and u8 tint mask[6] per vertex (before the normals).
 * Packed mesh (little endian): u32 vertices, u32 triangles, f32 lo[3], f32 size[3], then u16 position[3] per vertex
 * (0..65535 across the box), u16 uv[2] (0..65535), i8 normal[3] (/127), u8 hair share, u16 index[3] per triangle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = process.argv[2];
const OUT = 'src/games/rally/engine/people-scan.data.ts';
const LOD1_TRIS = 2600;

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

/** The mid-range mesh: vertices welded by position (the uv seams go), colour + tint mask per vertex, simplified. */
function mid(m, tris) {
  const key = new Map();
  const at = [];
  const w = { pos: [], nor: [], col: [], mask: [], n: [] };
  for (let i = 0; i < m.pos.length; i++) {
    const k = m.pos[i].map((x) => Math.round(x * 2000)).join(',');
    let j = key.get(k);
    if (j === undefined) {
      j = w.pos.length;
      key.set(k, j);
      w.pos.push(m.pos[i]);
      w.nor.push([0, 0, 0]);
      w.col.push([0, 0, 0]);
      w.mask.push([0, 0, 0, 0, 0, 0]);
      w.n.push(0);
    }
    at[i] = j;
    for (let c = 0; c < 3; c++) {
      w.nor[j][c] += m.nor[i][c];
      w.col[j][c] += m.vcol[i][c];
    }
    for (let c = 0; c < 6; c++) w.mask[j][c] += m.vmask[i][c];
    w.n[j]++;
  }
  for (let j = 0; j < w.pos.length; j++)
    for (let c = 0; c < 6; c++) {
      if (c < 3) w.col[j][c] /= w.n[j];
      w.mask[j][c] /= w.n[j];
    }
  const idx = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = at[m.idx[t]];
    const b = at[m.idx[t + 1]];
    const c = at[m.idx[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const P = new Float32Array(w.pos.flat());
  const A = new Float32Array(
    w.col.flatMap((c, j) => [
      ...c.map((x) => x / 255),
      ...w.mask[j].map((x) => x / 255),
    ]),
  );
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(idx),
    P,
    3,
    A,
    9,
    [0.4, 0.4, 0.4, 0.8, 0.8, 0.8, 0.5, 0.5, 0.5],
    null,
    tris * 3,
    1,
    [],
  );
  const keep = new Map();
  const res = { pos: [], nor: [], col: [], mask: [], idx: [] };
  for (const v of out) {
    let j = keep.get(v);
    if (j === undefined) {
      j = res.pos.length;
      keep.set(v, j);
      res.pos.push(w.pos[v]);
      const l = Math.hypot(...w.nor[v]) || 1;
      res.nor.push(w.nor[v].map((x) => x / l));
      res.col.push(w.col[v]);
      res.mask.push(w.mask[v]);
    }
    res.idx.push(j);
  }
  return res;
}

function packMid(m) {
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (const p of m.pos)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  const n = m.pos.length;
  const nt = m.idx.length / 3;
  const buf = Buffer.alloc(32 + n * (6 + 3 + 6 + 3) + nt * 6);
  buf.writeUInt32LE(n, 0);
  buf.writeUInt32LE(nt, 4);
  let at = 8;
  for (const v of [...lo, ...size]) {
    buf.writeFloatLE(v, at);
    at += 4;
  }
  for (const p of m.pos)
    for (let k = 0; k < 3; k++) {
      buf.writeUInt16LE(Math.round(((p[k] - lo[k]) / size[k]) * 65535), at);
      at += 2;
    }
  for (const [list, cnt] of [
    [m.col, 3],
    [m.mask, 6],
  ])
    for (const c of list)
      for (let k = 0; k < cnt; k++)
        buf.writeUInt8(Math.round(Math.min(255, Math.max(0, c[k]))), at++);
  for (const nn of m.nor)
    for (let k = 0; k < 3; k++)
      buf.writeInt8(Math.round(Math.max(-1, Math.min(1, nn[k])) * 127), at++);
  for (const i of m.idx) {
    buf.writeUInt16LE(i, at);
    at += 2;
  }
  return buf.subarray(0, at).toString('base64');
}

function pack(m) {
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (const p of m.pos)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  const n = m.pos.length;
  const nt = m.idx.length / 3;
  const buf = Buffer.alloc(32 + n * 6 + n * 4 + n * 3 + n + nt * 6);
  let at = 0;
  buf.writeUInt32LE(n, at);
  buf.writeUInt32LE(nt, at + 4);
  at = 8;
  for (const v of lo) {
    buf.writeFloatLE(v, at);
    at += 4;
  }
  for (const v of size) {
    buf.writeFloatLE(v, at);
    at += 4;
  }
  for (const p of m.pos)
    for (let k = 0; k < 3; k++) {
      buf.writeUInt16LE(Math.round(((p[k] - lo[k]) / size[k]) * 65535), at);
      at += 2;
    }
  for (const u of m.uv)
    for (let k = 0; k < 2; k++) {
      buf.writeUInt16LE(Math.round(Math.min(1, Math.max(0, u[k])) * 65535), at);
      at += 2;
    }
  for (const nn of m.nor)
    for (let k = 0; k < 3; k++) {
      buf.writeInt8(Math.round(Math.max(-1, Math.min(1, nn[k])) * 127), at);
      at += 1;
    }
  for (const h of m.hair)
    buf.writeUInt8(Math.round(Math.min(255, Math.max(0, h))), at++);
  for (const i of m.idx) {
    buf.writeUInt16LE(i, at);
    at += 2;
  }
  return buf.subarray(0, at).toString('base64');
}

const uri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;

let ts = `// Generated by scripts/people/bake-people.mjs from the CC BY models credited in THIRD-PARTY.md. Do not edit.
/** One person: texture + tint masks (data URIs), mean linear luminance of the top / trousers / skin / hair / shoe texels, packed meshes [full, mid]. */
export interface PersonData {
  map: string;
  mask: string;
  mask2: string;
  /** Mean linear colour of the skin texels. */
  skinBase: [number, number, number];
  refs: [number, number, number, number, number];
  lods: [string, string];
}

export const PEOPLE_SCAN: Record<'male' | 'female', PersonData> = {
`;
for (const name of ['male', 'female']) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const full = {
    pos: m.pos,
    uv: m.uv,
    nor: m.nor,
    idx: m.idx,
    hair: m.vmask.map((v) => v[3]),
  };
  const low = mid(m, LOD1_TRIS);
  console.log(
    name,
    'full',
    full.idx.length / 3,
    'mid',
    low.idx.length / 3,
    'verts',
    low.pos.length,
  );
  ts += `  ${name}: {
    map: '${uri(`${name}.jpg`, 'image/jpeg')}',
    mask: '${uri(`${name}_mask.png`, 'image/png')}',
    mask2: '${uri(`${name}_mask2.png`, 'image/png')}',
    skinBase: [${m.skinBase.map((x) => x.toFixed(3)).join(', ')}],
    refs: [${m.refs.map((x) => x.toFixed(3)).join(', ')}],
    lods: [
      '${pack(full)}',
      '${packMid(low)}',
    ],
  },
`;
}
ts += '};\n';
fs.writeFileSync(OUT, ts);
console.log(OUT, (ts.length / 1e6).toFixed(2), 'MB');
