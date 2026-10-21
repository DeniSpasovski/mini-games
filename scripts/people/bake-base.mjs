/**
 * Bakes the two clean base bodies (CC BY, credits: THIRD-PARTY.md) into src/games/rally/engine/people-base.data.ts.
 * The sources are not in the repository (sources/people/, git-ignored). The bodies are simplified where nothing is
 * seen (feet go under the shoes) and kept where it matters (the face); a second, welded mesh serves the mid range.
 *
 *   python3 scripts/people/extract-base.py sources/people/base/male_base_mesh_low_poly.glb <dir> male 1.80
 *   python3 scripts/people/extract-base.py sources/people/base/female_base_mesh_low_poly.glb <dir> female 1.72
 *   python3 scripts/people/skin-map.py <dir> male   (and female; paints the face onto the skin map)
 *   node scripts/people/bake-base.mjs <dir>
 *
 * Packed mesh (little endian): u32 vertices, u32 triangles, f32 lo[3], f32 size[3], u16 position[3] per vertex
 * (0..65535 across the box), u16 uv[2] (full mesh only), i8 normal[3] (/127), u16 index[3] per triangle.
 * The pelvis centre sits at z = 0 (the rig of people-body.ts is measured in this frame).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = process.argv[2];
const OUT = 'src/games/rally/engine/people-base.data.ts';

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

/** Where the regions are cut (m) and how many triangles each keeps. */
const MODELS = {
  male: {
    hipY: 0.9,
    neckY: 1.54,
    // Wrist joint and the forearm direction it is cut across.
    wrist: [0.52, 0.935, 0.21],
    elbow: [0.465, 1.065, 0.115],
    feetY: 0.07,
    head: 3600,
    body: 5600,
    hand: 650,
    mid: 2500,
  },
  female: {
    hipY: 0.87,
    neckY: 1.47,
    wrist: [0.465, 0.9, 0.18],
    elbow: [0.415, 1.02, 0.1],
    feetY: 0.07,
    head: 3600,
    body: 5200,
    hand: 550,
    mid: 2500,
  },
};

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Pelvis centre z of a mesh: the middle of its depth at hip height. */
function pelvisZ(m, y) {
  let lo = 1e9;
  let hi = -1e9;
  for (let t = 0; t < m.idx.length; t += 3) {
    const ps = [0, 1, 2].map((k) => m.pos[m.idx[t + k]]);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const ya = ps[a][1] - y;
      const yb = ps[b][1] - y;
      if (ya * yb >= 0) continue;
      const f = ya / (ya - yb);
      const x = ps[a][0] + (ps[b][0] - ps[a][0]) * f;
      const z = ps[a][2] + (ps[b][2] - ps[a][2]) * f;
      if (Math.abs(x) > 0.25) continue;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return (lo + hi) / 2;
}

/** Simplifies the triangles of `idx` (indices into the shared vertex arrays) to `tris`, keeping the region border. */
function simplify(pos, uv, idx, tris) {
  if (idx.length / 3 <= tris) return idx;
  const P = new Float32Array(pos.flat());
  const A = new Float32Array(uv.flat());
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(idx),
    P,
    3,
    A,
    2,
    [0.35, 0.35],
    null,
    tris * 3,
    1,
    ['LockBorder'],
  );
  return Array.from(out);
}

/** Drops unused vertices. */
function compact(m, idx) {
  const keep = new Map();
  const r = { pos: [], nor: [], uv: [], idx: [] };
  for (const v of idx) {
    let j = keep.get(v);
    if (j === undefined) {
      j = r.pos.length;
      keep.set(v, j);
      r.pos.push(m.pos[v]);
      r.nor.push(m.nor[v]);
      if (m.uv) r.uv.push(m.uv[v]);
    }
    r.idx.push(j);
  }
  return r;
}

/** The mid-range mesh: vertices welded by position (the uv seams go), simplified. */
function mid(m, tris) {
  const key = new Map();
  const at = [];
  const w = { pos: [], nor: [], n: [] };
  for (let i = 0; i < m.pos.length; i++) {
    const k = m.pos[i].map((x) => Math.round(x * 2000)).join(',');
    let j = key.get(k);
    if (j === undefined) {
      j = w.pos.length;
      key.set(k, j);
      w.pos.push(m.pos[i]);
      w.nor.push([0, 0, 0]);
      w.n.push(0);
    }
    at[i] = j;
    for (let c = 0; c < 3; c++) w.nor[j][c] += m.nor[i][c];
    w.n[j]++;
  }
  const idx = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = at[m.idx[t]];
    const b = at[m.idx[t + 1]];
    const c = at[m.idx[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const P = new Float32Array(w.pos.flat());
  const [out] = MeshoptSimplifier.simplify(
    new Uint32Array(idx),
    P,
    3,
    tris * 3,
    1,
    [],
  );
  const r = compact(
    {
      pos: w.pos,
      nor: w.nor.map((n) => {
        const l = Math.hypot(...n) || 1;
        return n.map((x) => x / l);
      }),
    },
    Array.from(out),
  );
  return r;
}

function pack(m, withUv) {
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
  const buf = Buffer.alloc(32 + n * (6 + 4 + 3) + nt * 6);
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
  if (withUv)
    for (const u of m.uv)
      for (let k = 0; k < 2; k++) {
        buf.writeUInt16LE(
          Math.round(Math.min(1, Math.max(0, u[k])) * 65535),
          at,
        );
        at += 2;
      }
  for (const nn of m.nor)
    for (let k = 0; k < 3; k++)
      buf.writeInt8(Math.round(Math.max(-1, Math.min(1, nn[k])) * 127), at++);
  for (const i of m.idx) {
    buf.writeUInt16LE(i, at);
    at += 2;
  }
  return buf.subarray(0, at).toString('base64');
}

const uri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;

let ts = `// Generated by scripts/people/bake-base.mjs from the CC BY base bodies credited in THIRD-PARTY.md. Do not edit.
/** One body: skin map + eye / lip mask (data URIs), mean linear colour of the skin map, packed meshes [full, mid]. */
export interface BodyData {
  map: string;
  mask: string;
  skinBase: [number, number, number];
  lods: [string, string];
}

export const PEOPLE_BASE: Record<'male' | 'female', BodyData> = {
`;
const debug = {};
for (const name of ['male', 'female']) {
  const cfg = MODELS[name];
  const m = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const dz = -pelvisZ(m, cfg.hipY);
  for (const p of m.pos) p[2] += dz;
  const regionOf = (t) => {
    const c = [0, 1, 2].map(
      (k) =>
        (m.pos[m.idx[t]][k] + m.pos[m.idx[t + 1]][k] + m.pos[m.idx[t + 2]][k]) /
        3,
    );
    if (c[1] < cfg.feetY) return 'feet';
    if (c[1] > cfg.neckY) return 'head';
    // Beyond the wrist plane (perpendicular to the forearm) and away from the torso: a hand.
    const d = [0, 1, 2].map((k) => cfg.wrist[k] - cfg.elbow[k]);
    const side = Math.abs(c[0]);
    const rel = [side - cfg.wrist[0], c[1] - cfg.wrist[1], c[2] - cfg.wrist[2]];
    if (side > 0.3 && rel[0] * d[0] + rel[1] * d[1] + rel[2] * d[2] > 0)
      return 'hand';
    return 'body';
  };
  const groups = { head: [], hand: [], body: [] };
  for (let t = 0; t < m.idx.length; t += 3) {
    const r = regionOf(t);
    if (r !== 'feet') groups[r].push(m.idx[t], m.idx[t + 1], m.idx[t + 2]);
  }
  const idx = [
    ...simplify(m.pos, m.uv, groups.head, cfg.head),
    ...simplify(m.pos, m.uv, groups.hand, cfg.hand * 2),
    ...simplify(m.pos, m.uv, groups.body, cfg.body),
  ];
  const full = compact(m, idx);
  const low = mid(full, cfg.mid);
  console.log(
    name,
    'source',
    m.idx.length / 3,
    'head',
    groups.head.length / 3,
    'hand',
    groups.hand.length / 3,
    'body',
    groups.body.length / 3,
    '-> full',
    full.idx.length / 3,
    full.pos.length,
    'verts; mid',
    low.idx.length / 3,
    low.pos.length,
    'verts',
  );
  debug[name] = { full, mid: low };
  const skinBase = JSON.parse(
    fs.readFileSync(path.join(dir, `${name}.skin.json`), 'utf8'),
  );
  ts += `  ${name}: {
    map: '${uri(`${name}.jpg`, 'image/jpeg')}',
    mask: '${uri(`${name}_mask.png`, 'image/png')}',
    skinBase: [${skinBase.map((x) => x.toFixed(3)).join(', ')}],
    lods: [
      '${pack(full, true)}',
      '${pack(low, false)}',
    ],
  },
`;
}
ts += '};\n';
fs.writeFileSync(OUT, ts);
fs.writeFileSync(path.join(dir, 'baked.json'), JSON.stringify(debug));
console.log(OUT, (ts.length / 1e6).toFixed(2), 'MB');
