/**
 * Bake the background ("street") cars: vehicles split out of the CC BY pack GLBs by street-pack-extract.py, with their own
 * triangles and textures, packed into one TypeScript module. The sources are not in the repository.
 *
 *   python scripts/car-model/street-pack-extract.py sources/street-cars/<pack>.glb <dir>/<pack>.json --images <dir>/<pack> [flags]
 *       (p7 with no flags, gp with `--seeds Body_0`)
 *   python scripts/car-model/bake-street-textures.py <dir>
 *   node scripts/car-model/bake-street-cars.mjs <dir> [--vans]
 *   npx prettier --write src/games/rally/assets/builders/*.data.ts
 *
 * <dir> holds the extractor outputs (gp.json, p7.json, their images) and the atlas files; the model list is MODELS
 * below. `FLIP=id,id` turns models round. Output (src/games/rally/assets/builders/, do not edit by hand): street-cars.data.ts
 * (the cars; `--vans` bakes the pack 7 vans and trucks into service-vehicles.data.ts instead, same layout) and the atlas
 * street-car-atlas.jpg + street-car-mask.png (copied from <dir>; the bundler serves them as files). The uv of every model
 * point into the atlas: bake both lists again after each atlas change.
 *
 * Per vehicle: turned to face +X, origin on the ground under the middle. LOD 0 is the model as it is (vertices welded,
 * nothing simplified); the far LODs are meshopt reductions of the body, glass and lamps (each on its own, borders kept)
 * with plain round wheels (flat swatches) built from the source wheel's size. Every part is one mesh with its uv moved
 * into the shared atlas (bake-street-textures.py); the paint is the atlas's tint mask. pack 7 has a flat palette: its
 * paint triangles point at the atlas's white `paint` cell, the glass of the gp cars at its dark `glass` cell.
 * Layout of a LOD (base64): u16 vertex count, u16 0, f32 min xyz + f32 size xyz, u16 xyz per vertex, u16 uv per vertex
 * (0..1 of the atlas), u32 index count + u16 indices (decoded to flat geometry at load).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  bounds,
  clamp01,
  merge,
  onlyTriangles,
  pack,
  simplify,
  visibleTriangles,
  weld,
} from './street-bake-lib.mjs';

const dir = process.argv[2];
const VANS = process.argv.includes('--vans');

/** Per LOD: triangles of the body, the glass, the lamps (LOD 0 keeps everything) and the sides of a round wheel (0 = the model's own). */
const BUDGET = [
  { body: Infinity, glass: Infinity, optics: Infinity, wheel: 0, error: 0 },
  { body: 1500, glass: 140, optics: 140, wheel: 14, error: 0.02 },
  { body: 500, glass: 40, optics: 40, wheel: 8, error: 0.05 },
];
/** Weight of the uv in the simplifier's error: the palette vans' cells are 0.005 apart, the gp textures span 0.2. */
const UV_WEIGHT = { p7: 800, gp: 6 };

/** id, flip (the nose points -X after the long-axis turn), pack file, vehicle index in the extractor's listing, kind of pack. */
const CAR_MODELS = [
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
/** Pack 7 (Sprinter-style vans and trucks, unlettered ones only): palette models, flat colour cells. */
const VAN_MODELS = [
  { id: 'van_low', pack: 'p7', idx: 18, kind: 'p7' },
  { id: 'van_high', pack: 'p7', idx: 19, kind: 'p7' },
  { id: 'minibus', pack: 'p7', idx: 20, kind: 'p7' },
  { id: 'box_truck', flip: true, pack: 'p7', idx: 6, kind: 'p7' },
  { id: 'flatbed', flip: true, pack: 'p7', idx: 12, kind: 'p7' },
];
const MODELS = VANS ? VAN_MODELS : CAR_MODELS;
const FLIP = (process.env.FLIP || '').split(',').filter(Boolean);

const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'atlas.json'), 'utf8'));

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function roleOf(node) {
  if (/^(w\d|w\.|Wheel)/i.test(node) && !/Body_0$/.test(node)) return 'wheel';
  if (/Glass_0$/.test(node)) return 'glass';
  if (/Optics_0$/.test(node)) return 'optics';
  return 'body';
}

/** Where a source uv goes in the atlas (`cell`: a swatch the palette vans' paint triangles point at). */
function mapUv(model, m, uv, cell) {
  if (model.kind === 'gp') {
    if (m.img < 0) return atlas.cells.glass;
    const [u0, v0, u1, v1] = atlas.tiles[`gp:${m.img}`];
    return [u0 + clamp01(uv[0]) * (u1 - u0), v0 + clamp01(uv[1]) * (v1 - v0)];
  }
  if (cell) return atlas.cells[cell];
  const [u0, v0, u1, v1] = atlas.tiles[`${model.pack}:0`];
  return [u0 + clamp01(uv[0]) * (u1 - u0), v0 + clamp01(uv[1]) * (v1 - v0)];
}

/** The palette models' paint: the most common non-dark colour of the body prim's triangles. */
function dominantColour(body) {
  const count = new Map();
  for (const c of body.tcol) {
    if (lum(c) < 45) continue;
    const k = c.join(',');
    count.set(k, (count.get(k) || 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0].split(',').map(Number) : null;
}

/**
 * A round wheel from the size of a source wheel: a tyre with a dark sidewall ring and a rim disc on the outer face only
 * (the axle is the thinnest bbox axis, the outer face looks away from the car), uv at the atlas's flat swatches.
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
  const m = { pos: [], uv: [], idx: [] };
  const point = (a, ang, rad, cell) => {
    const q = [0, 0, 0];
    q[axis] = c[axis] + a;
    q[u] = c[u] + Math.cos(ang) * rad;
    q[v] = c[v] + Math.sin(ang) * rad;
    m.pos.push(q);
    m.uv.push(atlas.cells[cell]);
    return m.pos.length - 1;
  };
  // Wound so the normal points away from `dir`'s origin side.
  const tri = (a, b, d, dir) => {
    const e1 = m.pos[b].map((x, k) => x - m.pos[a][k]);
    const e2 = m.pos[d].map((x, k) => x - m.pos[a][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const ok = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0;
    m.idx.push(a, ok ? b : d, ok ? d : b);
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
    const t0 = point(-half, a0, r, 'tyre');
    const t1 = point(-half, a1, r, 'tyre');
    const t2 = point(half, a0, r, 'tyre');
    const t3 = point(half, a1, r, 'tyre');
    tri(t0, t1, t2, radial);
    tri(t1, t3, t2, radial);
    const o = out * half;
    const s0 = point(o, a0, r, 'side');
    const s1 = point(o, a1, r, 'side');
    const i0 = point(o, a0, r * 0.62, 'side');
    const i1 = point(o, a1, r * 0.62, 'side');
    tri(s0, s1, i0, axisDir);
    tri(s1, i1, i0, axisDir);
    const mm = point(o, 0, 0, 'rim');
    const r0 = point(o, a0, r * 0.62, 'rim');
    const r1 = point(o, a1, r * 0.62, 'rim');
    tri(mm, r0, r1, axisDir);
  }
  return m;
}

function bake(model, list) {
  const v = list[model.idx];
  const prims = v.mesh.map((m) => ({ ...m, role: roleOf(m.node) }));
  const all = prims.filter((p) => p.role === 'body').flatMap((m) => m.pos);
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
  const turned = prims.map((p) => p.pos.map(rot));
  const { lo, hi } = bounds(turned.flat());
  const off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const dom = model.kind !== 'gp' ? dominantColour(prims[0]) : null;
  // Palette models: the paint cell for the body colour.
  const cellOf = (m, t) => {
    if (model.kind === 'gp' || m.role === 'wheel') return null;
    const c = m.tcol[t];
    return Math.hypot(c[0] - dom[0], c[1] - dom[1], c[2] - dom[2]) < 30
      ? 'paint'
      : null;
  };

  const parts = prims.map((m, pi) => {
    const pos = turned[pi].map((q) => q.map((c, k) => c - off[k]));
    const corners = [];
    for (let t = 0; t < m.idx.length / 3; t++) {
      const cell = cellOf(m, t);
      for (let k = 0; k < 3; k++) {
        const i = m.idx[t * 3 + k];
        corners.push({ pos: pos[i], uv: mapUv(model, m, m.uv[i], cell) });
      }
    }
    return { role: m.role, mesh: weld(corners) };
  });

  const of = (role) =>
    merge(parts.filter((p) => p.role === role).map((p) => p.mesh));
  const whole = merge(
    parts.filter((p) => p.role === 'body').map((p) => p.mesh),
  );
  const keep = visibleTriangles(
    whole,
    parts.filter((p) => p.role !== 'body').map((p) => p.mesh),
  );
  const main = onlyTriangles(whole, keep);
  console.log(
    ' ',
    model.id,
    'body',
    whole.idx.length / 3,
    '->',
    main.idx.length / 3,
    'tris',
  );
  const wheels = parts.filter((p) => p.role === 'wheel').map((p) => p.mesh);
  const lods = BUDGET.map((b, lod) =>
    merge([
      lod ? simplify(main, b.body, b.error, UV_WEIGHT[model.kind]) : main,
      ...['glass', 'optics'].map((role) => {
        const m = of(role);
        return lod ? simplify(m, b[role], b.error, UV_WEIGHT[model.kind]) : m;
      }),
      ...wheels.map((w) => (b.wheel ? makeWheel(w, b.wheel) : w)),
    ]),
  );

  // Shape numbers the taxi and police car's add-ons use: roof height and middle, half width at the doors.
  const body = main.pos;
  const height = Math.max(...body.map((p) => p[1]));
  const roof = body.filter((p) => p[1] > height - 0.05);
  const side = body
    .filter((p) => p[1] > 0.5 && p[1] < 0.95 && Math.abs(p[0]) < 0.9)
    .map((p) => Math.abs(p[2]))
    .sort((x, y) => x - y);
  return {
    lods,
    length: hi[0] - lo[0],
    width: hi[2] - lo[2],
    height,
    roofX: roof.reduce((s, p) => s + p[0], 0) / roof.length,
    sideZ: side.length
      ? side[Math.floor(side.length / 2)]
      : (hi[2] - lo[2]) / 2,
  };
}

const lists = {};
for (const f of new Set(MODELS.map((m) => m.pack)))
  lists[f] = JSON.parse(fs.readFileSync(path.join(dir, `${f}.json`), 'utf8'));

const r2 = (x) => Math.round(x * 100) / 100;
const rows = [];
for (const m of MODELS) {
  const b = bake(m, lists[m.pack]);
  rows.push({
    id: m.id,
    length: r2(b.length),
    width: r2(b.width),
    height: r2(b.height),
    roofX: r2(b.roofX),
    sideZ: r2(b.sideZ),
    lods: b.lods.map(pack),
  });
  console.log(
    m.id,
    `${b.length.toFixed(2)} x ${b.width.toFixed(2)} x ${b.height.toFixed(2)} m, tris`,
    b.lods.map((l) => l.idx.length / 3).join(' / '),
    'verts',
    b.lods.map((l) => l.pos.length).join(' / '),
  );
}

const header =
  '// Generated by scripts/car-model/bake-street-cars.mjs from the CC BY packs credited in THIRD-PARTY.md. Do not edit.';
const list = JSON.stringify(rows, null, 2);
const ts = VANS
  ? `${header}
import type { StreetCarData } from './street-cars.data';

/** Vans and trucks of pack 7 (Sprinter-style), same layout as the street cars. */
export const SERVICE_VEHICLE_DATA: StreetCarData[] = ${list};
`
  : `${header}
export interface StreetCarData {
  id: string;
  /** Length / width / height (m). */
  length: number;
  width: number;
  height: number;
  /** Middle of the roof along the car and half width at the doors (m): where the taxi and police add-ons go. */
  roofX: number;
  sideZ: number;
  /** One packed mesh per LOD, nearest first (layout: see the baker). */
  lods: string[];
}

export const STREET_CAR_DATA: StreetCarData[] = ${list};
`;
const out = 'src/games/rally/assets/builders';
const file = VANS ? 'service-vehicles.data.ts' : 'street-cars.data.ts';
fs.writeFileSync(`${out}/${file}`, ts);
fs.copyFileSync(path.join(dir, 'atlas.jpg'), `${out}/street-car-atlas.jpg`);
fs.copyFileSync(path.join(dir, 'mask.png'), `${out}/street-car-mask.png`);
console.log('wrote', file, (ts.length / 1024).toFixed(0), 'KB');
