/**
 * Bake the background ("street") cars: vehicles split out of the CC BY pack GLBs by street-pack-extract.py, simplified
 * with meshopt to two LODs, recoloured and packed into one TypeScript module.
 *
 *   python scripts/car-model/street-pack-extract.py sources/street-cars/<pack>.glb <dir>/<pack>.json [flags]
 *   node scripts/car-model/bake-street-cars.mjs <dir> [--sheet <out.json>] [--vans]
 *
 * <dir> holds the extractor outputs (p8.json, gp.json, p7.json); the model list is MODELS below. `--sheet` also writes
 * the baked LOD 0 meshes as JSON for a visual check (same format as the extractor's). `FLIP=id,id` turns models round.
 * Output: src/games/rally/assets/builders/street-cars.data.ts (do not edit by hand); `--vans` bakes only the pack 7 vans and
 * trucks into service-vehicles.data.ts (same layout, `SERVICE_VEHICLE_DATA`), leaving the cars file alone.
 *
 * Per vehicle: turned to face +X, origin on the ground under the middle. The body is split into a "paint" group
 * (recoloured per car at run time) and fixed-colour triangles; wheels get a tyre / rim colour by radius.
 * Layout of a LOD (base64): u16 vertex count, u16 paint vertex count, f32 min xyz + f32 size xyz, u16 xyz per vertex
 * (paint vertices first), u8 rgb per vertex, u32 index count + u16 indices (decoded to flat geometry at load).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = process.argv[2];
const VANS = process.argv.includes('--vans');
const sheetOut = process.argv.includes('--sheet')
  ? process.argv[process.argv.indexOf('--sheet') + 1]
  : null;

/** Triangles per part at [near, far]. */
const BUDGET = {
  body: [560, 170],
  extra: [90, 24],
  wheel: [48, 14],
  single: [900, 300],
};

/** id, flip (the nose points -X after the long-axis turn), pack file, vehicle index in the extractor's listing, kind of pack (colour rules). */
const CAR_MODELS = [
  { id: 'old_a', flip: true, pack: 'p8', idx: 0, kind: 'p8' },
  { id: 'old_b', pack: 'p8', idx: 1, kind: 'p8' },
  { id: 'old_c', pack: 'p8', idx: 2, kind: 'p8' },
  { id: 'old_d', flip: true, pack: 'p8', idx: 3, kind: 'p8' },
  { id: 'old_pickup', pack: 'p8', idx: 4, kind: 'p8' },
  { id: 'hatch', pack: 'gp', idx: 0, kind: 'gp' },
  { id: 'pickup', pack: 'gp', idx: 1, kind: 'gp' },
  { id: 'sport', flip: true, pack: 'gp', idx: 2, kind: 'gp' },
  { id: 'minivan', pack: 'gp', idx: 3, kind: 'gp' },
  { id: 'suv', flip: true, pack: 'gp', idx: 4, kind: 'gp' },
  { id: 'coupe', pack: 'gp', idx: 5, kind: 'gp' },
  { id: 'offroad', flip: true, pack: 'gp', idx: 6, kind: 'gp' },
  { id: 'compact', pack: 'gp', idx: 7, kind: 'gp' },
  { id: 'sedan', pack: 'gp', idx: 8, kind: 'gp' },
  { id: 'wagon', pack: 'gp', idx: 9, kind: 'gp' },
];
/** Pack 7 (Sprinter-style vans and trucks, unlettered ones only). */
const VAN_MODELS = [
  { id: 'van_low', pack: 'p7', idx: 18, kind: 'p7' },
  { id: 'van_high', pack: 'p7', idx: 19, kind: 'p7' },
  { id: 'minibus', pack: 'p7', idx: 20, kind: 'p7' },
  { id: 'box_truck', flip: true, pack: 'p7', idx: 6, kind: 'p7' },
  { id: 'flatbed', flip: true, pack: 'p7', idx: 12, kind: 'p7' },
];
const MODELS = VANS ? VAN_MODELS : CAR_MODELS;
const FLIP = (process.env.FLIP || '').split(',').filter(Boolean);

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function roleOf(node, kind) {
  if (/^(w\d|w\.|Wheel)/i.test(node) && !/Body_0$/.test(node)) return 'wheel';
  if (kind === 'p8' && /^e\d/.test(node)) return 'extra';
  if (kind === 'gp' && /Glass_0$/.test(node)) return 'glass';
  if (kind === 'gp' && /Optics_0$/.test(node)) return 'optics';
  return 'body';
}

/** Weld vertices with the same position and colour. */
function weld(m) {
  const map = new Map();
  const pos = [];
  const col = [];
  const remap = new Array(m.pos.length);
  m.pos.forEach((p, i) => {
    const k = `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)},${m.col[i].join(',')}`;
    let j = map.get(k);
    if (j === undefined) {
      j = pos.length;
      map.set(k, j);
      pos.push(p);
      col.push(m.col[i]);
    }
    remap[i] = j;
  });
  const idx = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = remap[m.idx[t]];
    const b = remap[m.idx[t + 1]];
    const c = remap[m.idx[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { pos, col, idx };
}

function simplify(w, tris) {
  if (w.idx.length / 3 <= tris) return w;
  const P = new Float32Array(w.pos.flat());
  const A = new Float32Array(
    w.col.flatMap((c) => [c[0] / 255, c[1] / 255, c[2] / 255]),
  );
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(w.idx),
    P,
    3,
    A,
    3,
    [0.35, 0.35, 0.35],
    null,
    tris * 3,
    0.25,
    [],
  );
  const keep = new Map();
  const pos = [];
  const col = [];
  const idx = [];
  for (const v of out) {
    let j = keep.get(v);
    if (j === undefined) {
      j = pos.length;
      keep.set(v, j);
      pos.push(w.pos[v]);
      col.push(w.col[v]);
    }
    idx.push(j);
  }
  return { pos, col, idx };
}

const bounds = (list) => {
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (const p of list)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  return { lo, hi };
};

/**
 * A round wheel built from the source wheel's size: dark tyre, a dark sidewall ring and a grey rim disc on the outer face
 * only (the axle is the thinnest bbox axis, the outer face looks away from the car). The pack wheels simplify to ugly
 * polygons, so they are only measured.
 */
function makeWheel(src, sides) {
  const { lo, hi } = bounds(src.pos);
  const size = hi.map((h, k) => h - lo[k]);
  const axis = size.indexOf(Math.min(...size));
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  const c = lo.map((l, k) => (l + hi[k]) / 2);
  const r = Math.max(size[u], size[v]) / 2;
  const half = size[axis] / 2;
  const out = Math.sign(c[axis]) || 1;
  const pos = [];
  const col = [];
  const idx = [];
  const point = (a, ang, rad, colour) => {
    const q = [0, 0, 0];
    q[axis] = c[axis] + a;
    q[u] = c[u] + Math.cos(ang) * rad;
    q[v] = c[v] + Math.sin(ang) * rad;
    pos.push(q);
    col.push(colour);
    return pos.length - 1;
  };
  const TYRE = [26, 26, 28];
  const SIDE = [44, 44, 48];
  const RIM = [150, 153, 158];
  // Triangles are wound so the normal points away from `ref` (a point inside the wheel, or the face direction).
  const tri = (a, b, d, dir) => {
    const e1 = pos[b].map((x, k) => x - pos[a][k]);
    const e2 = pos[d].map((x, k) => x - pos[a][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const ok = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0;
    idx.push(a, ok ? b : d, ok ? d : b);
  };
  const axisDir = [0, 0, 0];
  axisDir[axis] = out;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const radial = [0, 0, 0];
    radial[u] = Math.cos(mid);
    radial[v] = Math.sin(mid);
    // tread
    const t0 = point(-half, a0, r, TYRE);
    const t1 = point(-half, a1, r, TYRE);
    const t2 = point(half, a0, r, TYRE);
    const t3 = point(half, a1, r, TYRE);
    tri(t0, t1, t2, radial);
    tri(t1, t3, t2, radial);
    // outer face: sidewall ring + rim disc
    const o = out * half;
    const s0 = point(o, a0, r, SIDE);
    const s1 = point(o, a1, r, SIDE);
    const i0 = point(o, a0, r * 0.62, SIDE);
    const i1 = point(o, a1, r * 0.62, SIDE);
    tri(s0, s1, i0, axisDir);
    tri(s1, i1, i0, axisDir);
    const m = point(o, 0, 0, RIM);
    const r0 = point(o, a0, r * 0.62, RIM);
    const r1 = point(o, a1, r * 0.62, RIM);
    tri(m, r0, r1, axisDir);
  }
  return { pos, col, idx };
}

function bake(model, list) {
  const v = list[model.idx];
  const body = v.mesh.filter((m) => roleOf(m.node, model.kind) === 'body');
  const all = body.flatMap((m) => m.pos);
  const mean = [0, 1, 2].map(
    (k) => all.reduce((s, p) => s + p[k], 0) / all.length,
  );
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of all) {
    const x = p[0] - mean[0];
    const z = p[2] - mean[2];
    sxx += x * x;
    sxz += x * z;
    szz += z * z;
  }
  // Long axis -> +X.
  let a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  if (model.flip || FLIP.includes(model.id)) a += Math.PI;
  const rot = (p) => [
    p[0] * Math.cos(a) + p[2] * Math.sin(a),
    p[1],
    -p[0] * Math.sin(a) + p[2] * Math.cos(a),
  ];
  const parts = v.mesh.map((m) => ({
    role: roleOf(m.node, model.kind),
    w: weld({ ...m, pos: m.pos.map(rot) }),
  }));
  const { lo, hi } = bounds(parts.flatMap((p) => p.w.pos));
  const off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  for (const p of parts)
    p.w.pos = p.w.pos.map((q) => q.map((c, k) => c - off[k]));
  const length = hi[0] - lo[0];
  const width = hi[2] - lo[2];

  const lods = [0, 1].map((lod) => {
    const out = {
      paint: { pos: [], col: [], idx: [] },
      fixed: { pos: [], col: [], idx: [] },
    };
    const add = (group, w, isPaintTri) => {
      const g = out[group];
      const map = new Map();
      for (let t = 0; t < w.idx.length; t += 3) {
        if (isPaintTri && isPaintTri(t) !== (group === 'paint')) continue;
        for (let k = 0; k < 3; k++) {
          const i = w.idx[t + k];
          let j = map.get(i);
          if (j === undefined) {
            j = g.pos.length;
            map.set(i, j);
            g.pos.push(w.pos[i]);
            g.col.push(
              group === 'paint'
                ? [255, 255, 255]
                : model.kind === 'gp' && p0.role === 'body'
                  ? [30, 30, 32]
                  : w.col[i],
            );
          }
          g.idx.push(j);
        }
      }
    };
    let p0 = null;
    for (const p of parts) {
      p0 = p;
      const budget =
        model.kind === 'p7'
          ? BUDGET.single[lod]
          : BUDGET[
              p.role === 'glass' || p.role === 'optics' ? 'extra' : p.role
            ][lod];
      const w =
        p.role === 'wheel'
          ? makeWheel(p.w, lod ? 6 : 10)
          : simplify(p.w, budget);
      if (model.kind === 'gp') {
        if (p.role === 'glass') w.col = w.pos.map(() => [20, 28, 36]);
        if (p.role === 'optics')
          w.col = w.pos.map((q) => {
            const f = q[0] / (length / 2);
            return f > 0.55
              ? [245, 240, 214]
              : f < -0.55
                ? [170, 24, 28]
                : [30, 30, 32];
          });
      }
      if (p.role === 'body') {
        // Paint: the body's dominant non-dark colour (p8, p7), or everything above the sills (gp).
        let dom = null;
        if (model.kind !== 'gp') {
          const count = new Map();
          for (const c of w.col) {
            if (lum(c) < 45) continue;
            const k = c.join(',');
            count.set(k, (count.get(k) || 0) + 1);
          }
          dom = [...count.entries()]
            .sort((x, y) => y[1] - x[1])[0]?.[0]
            ?.split(',')
            .map(Number);
        }
        const isPaintVert = (i) =>
          model.kind === 'gp'
            ? w.pos[i][1] > 0.2
            : dom &&
              Math.hypot(
                w.col[i][0] - dom[0],
                w.col[i][1] - dom[1],
                w.col[i][2] - dom[2],
              ) < 40;
        const isPaintTri = (t) =>
          [0, 1, 2].filter((k) => isPaintVert(w.idx[t + k])).length >= 2;
        add('paint', w, isPaintTri);
        add('fixed', w, isPaintTri);
      } else add('fixed', w, null);
    }
    return out;
  });
  return { lods, length, width, height: hi[1] - lo[1] };
}

function pack(lod) {
  const { paint, fixed } = lod;
  const pos = [...paint.pos, ...fixed.pos];
  const col = [...paint.col, ...fixed.col];
  const idx = [...paint.idx, ...fixed.idx.map((i) => i + paint.pos.length)];
  const { lo, hi } = bounds(pos);
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  const head = Buffer.alloc(28);
  head.writeUInt16LE(pos.length, 0);
  head.writeUInt16LE(paint.pos.length, 2);
  lo.forEach((x, k) => head.writeFloatLE(x, 4 + k * 4));
  size.forEach((x, k) => head.writeFloatLE(x, 16 + k * 4));
  const pb = Buffer.alloc(pos.length * 6);
  pos.forEach((p, i) =>
    p.forEach((x, k) =>
      pb.writeUInt16LE(
        Math.round(((x - lo[k]) / size[k]) * 65535),
        i * 6 + k * 2,
      ),
    ),
  );
  const cb = Buffer.from(col.flat());
  const ib = Buffer.alloc(4 + idx.length * 2);
  ib.writeUInt32LE(idx.length, 0);
  idx.forEach((x, i) => ib.writeUInt16LE(x, 4 + i * 2));
  return {
    b64: Buffer.concat([head, pb, cb, ib]).toString('base64'),
    tris: idx.length / 3,
  };
}

const lists = {};
for (const f of new Set(MODELS.map((m) => m.pack)))
  lists[f] = JSON.parse(fs.readFileSync(path.join(dir, `${f}.json`), 'utf8'));

const rows = [];
const sheet = [];
for (const m of MODELS) {
  const b = bake(m, lists[m.pack]);
  const packed = b.lods.map(pack);
  rows.push({
    id: m.id,
    length: +b.length.toFixed(2),
    width: +b.width.toFixed(2),
    lods: packed.map((p) => p.b64),
  });
  console.log(
    m.id,
    `${b.length.toFixed(2)} x ${b.width.toFixed(2)} x ${b.height.toFixed(2)} m, tris`,
    packed.map((p) => p.tris).join(' / '),
  );
  if (sheetOut) {
    const L = b.lods[0];
    const pos = [...L.paint.pos, ...L.fixed.pos];
    sheet.push({
      name: m.id,
      bbox: [bounds(pos).lo, bounds(pos).hi],
      mesh: [
        {
          pos,
          col: [...L.paint.col.map(() => [200, 60, 50]), ...L.fixed.col],
          idx: [
            ...L.paint.idx,
            ...L.fixed.idx.map((i) => i + L.paint.pos.length),
          ],
        },
      ],
    });
  }
}
if (sheetOut) fs.writeFileSync(sheetOut, JSON.stringify(sheet));

const header = `// Generated by scripts/car-model/bake-street-cars.mjs from the CC BY packs credited in THIRD-PARTY.md. Do not edit.
`;
const ts = VANS
  ? `${header}import type { StreetCarData } from './street-cars.data';

/** Vans and trucks of pack 7 (Sprinter-style), same layout as the street cars. */
export const SERVICE_VEHICLE_DATA: StreetCarData[] = ${JSON.stringify(rows, null, 2)};
`
  : `${header}export interface StreetCarData {
  id: string;
  /** Length / width (m). */
  length: number;
  width: number;
  /** One packed mesh per LOD (layout: see the baker). */
  lods: string[];
}

export const STREET_CAR_DATA: StreetCarData[] = ${JSON.stringify(rows, null, 2)};
`;
const outFile = VANS
  ? 'src/games/rally/assets/builders/service-vehicles.data.ts'
  : 'src/games/rally/assets/builders/street-cars.data.ts';
fs.writeFileSync(outFile, ts);
console.log('wrote', outFile, (ts.length / 1024).toFixed(0), 'KB');
