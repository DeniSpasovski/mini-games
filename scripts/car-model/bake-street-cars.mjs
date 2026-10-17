/**
 * Bake the background ("street") cars: vehicles split out of the CC BY pack GLBs by street-pack-extract.py, with their own
 * triangles and textures, packed into one TypeScript module. The sources are not in the repository.
 *
 *   python scripts/car-model/street-pack-extract.py sources/street-cars/<pack>.glb <dir>/<pack>.json --images <dir>/<pack> [flags]
 *       (p8 and p7 with no flags, gp with `--seeds Body_0`)
 *   python scripts/car-model/bake-street-textures.py <dir>
 *   node scripts/car-model/bake-street-cars.mjs <dir> [--vans]
 *   npx prettier --write src/games/rally/assets/builders/*.data.ts
 *
 * <dir> holds the extractor outputs (p8.json, gp.json, p7.json, their images) and the atlas files; the model list is MODELS
 * below. `FLIP=id,id` turns models round. Output (src/games/rally/assets/builders/, do not edit by hand): street-cars.data.ts
 * (the cars; `--vans` bakes the pack 7 vans and trucks into service-vehicles.data.ts instead, same layout) and the atlas
 * street-car-atlas.jpg + street-car-mask.png (copied from <dir>; the bundler serves them as files). The uv of every model
 * point into the atlas: bake both lists again after each atlas change.
 *
 * Per vehicle: turned to face +X, origin on the ground under the middle. LOD 0 is the model as it is (vertices welded,
 * nothing simplified); the far LODs are meshopt reductions of the body, glass and lamps (each on its own, borders kept)
 * with plain round wheels (flat swatches) built from the source wheel's size. Every part is one mesh with its uv moved
 * into the shared atlas (bake-street-textures.py); the paint is the atlas's tint mask. p8 cars have a flat palette: their
 * paint triangles point at the atlas's white `paint` cell, the glass of the gp cars at its dark `glass` cell.
 * Layout of a LOD (base64): u16 vertex count, u16 0, f32 min xyz + f32 size xyz, u16 xyz per vertex, u16 uv per vertex
 * (0..1 of the atlas), u32 index count + u16 indices (decoded to flat geometry at load).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = process.argv[2];
const VANS = process.argv.includes('--vans');

/** Per LOD: triangles of the body, the glass, the lamps (LOD 0 keeps everything) and the sides of a round wheel (0 = the model's own). */
const BUDGET = [
  { body: Infinity, glass: Infinity, optics: Infinity, wheel: 0, error: 0 },
  { body: 1500, glass: 140, optics: 140, wheel: 14, error: 0.02 },
  { body: 500, glass: 40, optics: 40, wheel: 8, error: 0.05 },
];
/** Weight of the uv in the simplifier's error: the palette cars' cells are 0.005 apart, the gp textures span 0.2. */
const UV_WEIGHT = { p8: 800, p7: 800, gp: 6 };

/** id, flip (the nose points -X after the long-axis turn), pack file, vehicle index in the extractor's listing, kind of pack. */
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
/** Pack 7 (Sprinter-style vans and trucks, unlettered ones only), palette models like pack 8. */
const VAN_MODELS = [
  { id: 'van_low', pack: 'p7', idx: 18, kind: 'p7' },
  { id: 'van_high', pack: 'p7', idx: 19, kind: 'p7' },
  { id: 'minibus', pack: 'p7', idx: 20, kind: 'p7' },
  { id: 'box_truck', flip: true, pack: 'p7', idx: 6, kind: 'p7' },
  { id: 'flatbed', flip: true, pack: 'p7', idx: 12, kind: 'p7' },
];
const MODELS = VANS ? VAN_MODELS : CAR_MODELS;
/** The pack 8 palette's window colour. */
const PALETTE_WINDOW = [142, 142, 142];
const FLIP = (process.env.FLIP || '').split(',').filter(Boolean);

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'atlas.json'), 'utf8'));

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function roleOf(node) {
  if (/^(w\d|w\.|Wheel)/i.test(node) && !/Body_0$/.test(node)) return 'wheel';
  if (/Glass_0$/.test(node)) return 'glass';
  if (/Optics_0$/.test(node)) return 'optics';
  return 'body';
}

/** Where a source uv goes in the atlas (`cell`: a swatch the palette cars' paint and window triangles point at). */
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

/** A mesh `{pos, uv, idx}` from triangle corners, vertices with the same position and uv welded. */
function weld(corners) {
  const out = { pos: [], uv: [], idx: [] };
  const map = new Map();
  const at = (c) => {
    const key = `${c.pos.map((x) => x.toFixed(4))}|${c.uv.map((x) => x.toFixed(5))}`;
    let j = map.get(key);
    if (j === undefined) {
      j = out.pos.length;
      map.set(key, j);
      out.pos.push(c.pos);
      out.uv.push(c.uv);
    }
    return j;
  };
  for (let t = 0; t < corners.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => at(corners[t + k]));
    if (a !== b && b !== c && a !== c) out.idx.push(a, b, c);
  }
  return out;
}

const merge = (list) => {
  const out = { pos: [], uv: [], idx: [] };
  for (const m of list) {
    const base = out.pos.length;
    out.pos.push(...m.pos);
    out.uv.push(...m.uv);
    out.idx.push(...m.idx.map((i) => i + base));
  }
  return out;
};

function simplify(m, tris, error, uvWeight) {
  if (m.idx.length / 3 <= tris) return m;
  const P = new Float32Array(m.pos.flat());
  const A = new Float32Array(m.uv.flat());
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(m.idx),
    P,
    3,
    A,
    2,
    [uvWeight, uvWeight],
    null,
    tris * 3,
    error,
    ['LockBorder'],
  );
  const keep = new Map();
  const res = { pos: [], uv: [], idx: [] };
  for (const v of out) {
    let j = keep.get(v);
    if (j === undefined) {
      j = res.pos.length;
      keep.set(v, j);
      res.pos.push(m.pos[v]);
      res.uv.push(m.uv[v]);
    }
    res.idx.push(j);
  }
  return res;
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
 * Drop the triangles of `main` that no outside view can see (seats, dashboard, the insides of doors): the windows are
 * opaque in the game, so they hide the cabin. A software z-buffer renders `all` (every part, front faces only, as the
 * renderer draws them) from VIEWS directions (the upper hemisphere and a little below the horizon) and keeps the triangles
 * of `main` that win a pixel, or whose middle is not covered.
 */
const VIEWS = 220;
const RES = 420;
function visibleTriangles(main, others) {
  const tris = [];
  const add = (m, mine) => {
    for (let t = 0; t < m.idx.length; t += 3)
      tris.push({
        p: [0, 1, 2].map((k) => m.pos[m.idx[t + k]]),
        mine,
        t: t / 3,
      });
  };
  add(main, true);
  for (const m of others) add(m, false);
  const { lo, hi } = bounds(tris.flatMap((t) => t.p));
  const mid = lo.map((l, k) => (l + hi[k]) / 2);
  const span = Math.hypot(...hi.map((h, k) => h - lo[k])) / 2 + 0.01;
  const keep = new Uint8Array(main.idx.length / 3);
  const depth = new Float32Array(RES * RES);
  const ids = new Int32Array(RES * RES);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < VIEWS; i++) {
    // Elevation from -10 deg to 90 deg.
    const y =
      Math.sin((-10 * Math.PI) / 180) +
      ((i + 0.5) / VIEWS) * (1 - Math.sin((-10 * Math.PI) / 180));
    const rr = Math.sqrt(1 - y * y);
    const d = [Math.cos(i * golden) * rr, y, Math.sin(i * golden) * rr];
    // Orthographic basis (u, v) of the image plane; d points to the viewer.
    const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [
      d[1] * ref[2] - d[2] * ref[1],
      d[2] * ref[0] - d[0] * ref[2],
      d[0] * ref[1] - d[1] * ref[0],
    ];
    const ul = Math.hypot(...u);
    u.forEach((_, k) => (u[k] /= ul));
    const v = [
      d[1] * u[2] - d[2] * u[1],
      d[2] * u[0] - d[0] * u[2],
      d[0] * u[1] - d[1] * u[0],
    ];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    depth.fill(-1e9);
    ids.fill(-1);
    const proj = tris.map((tr) =>
      tr.p.map((q) => {
        const r = [q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]];
        return [
          ((dot(r, u) / span) * 0.5 + 0.5) * RES,
          ((dot(r, v) / span) * 0.5 + 0.5) * RES,
          dot(r, d),
        ];
      }),
    );
    proj.forEach((q, id) => {
      // Back faces are culled: the screen-space winding of a front face is counter-clockwise in (u, v) looking down -d.
      const area =
        (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) -
        (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (area <= 0) return;
      const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])));
      const x1 = Math.min(
        RES - 1,
        Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])),
      );
      const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])));
      const y1 = Math.min(
        RES - 1,
        Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])),
      );
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const X = px + 0.5;
          const Y = py + 0.5;
          const w0 =
            ((q[1][0] - X) * (q[2][1] - Y) - (q[2][0] - X) * (q[1][1] - Y)) /
            area;
          const w1 =
            ((q[2][0] - X) * (q[0][1] - Y) - (q[0][0] - X) * (q[2][1] - Y)) /
            area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2];
          const at = py * RES + px;
          if (z > depth[at]) {
            depth[at] = z;
            ids[at] = id;
          }
        }
    });
    for (let at = 0; at < ids.length; at++) {
      const id = ids[at];
      if (id >= 0 && tris[id].mine) keep[tris[id].t] = 1;
    }
    // Triangles smaller than a pixel: visible when nothing in front covers their middle.
    proj.forEach((q, id) => {
      if (!tris[id].mine || keep[tris[id].t]) return;
      const px = Math.floor((q[0][0] + q[1][0] + q[2][0]) / 3);
      const py = Math.floor((q[0][1] + q[1][1] + q[2][1]) / 3);
      if (px < 0 || py < 0 || px >= RES || py >= RES) return;
      const z = (q[0][2] + q[1][2] + q[2][2]) / 3;
      const area =
        (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) -
        (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (area > 0 && area < 1.5 && z >= depth[py * RES + px] - 0.01)
        keep[tris[id].t] = 1;
    });
  }
  return keep;
}

/** `m` without the triangles `keep` leaves out (unused vertices dropped). */
function onlyTriangles(m, keep) {
  const out = { pos: [], uv: [], idx: [] };
  const map = new Map();
  for (let t = 0; t < keep.length; t++) {
    if (!keep[t]) continue;
    for (let k = 0; k < 3; k++) {
      const i = m.idx[t * 3 + k];
      let j = map.get(i);
      if (j === undefined) {
        j = out.pos.length;
        map.set(i, j);
        out.pos.push(m.pos[i]);
        out.uv.push(m.uv[i]);
      }
      out.idx.push(j);
    }
  }
  return out;
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
  // Palette models: the paint cell for the body colour, the glass swatch for the windows (a light grey cell in pack 8's palette).
  const near = (c, ref, d) =>
    Math.hypot(c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]) < d;
  const cellOf = (m, t) => {
    if (model.kind === 'gp' || m.role === 'wheel') return null;
    if (near(m.tcol[t], dom, 30)) return 'paint';
    return model.kind === 'p8' && near(m.tcol[t], PALETTE_WINDOW, 6)
      ? 'glass'
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

function pack(m) {
  const { lo, hi } = bounds(m.pos);
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  if (m.pos.length > 65535) throw new Error('too many vertices');
  const head = Buffer.alloc(28);
  head.writeUInt16LE(m.pos.length, 0);
  lo.forEach((x, k) => head.writeFloatLE(x, 4 + k * 4));
  size.forEach((x, k) => head.writeFloatLE(x, 16 + k * 4));
  const pb = Buffer.alloc(m.pos.length * 6);
  m.pos.forEach((p, i) =>
    p.forEach((x, k) =>
      pb.writeUInt16LE(
        Math.round(((x - lo[k]) / size[k]) * 65535),
        i * 6 + k * 2,
      ),
    ),
  );
  const ub = Buffer.alloc(m.uv.length * 4);
  m.uv.forEach((q, i) =>
    q.forEach((x, k) =>
      ub.writeUInt16LE(Math.round(clamp01(x) * 65535), i * 4 + k * 2),
    ),
  );
  const ib = Buffer.alloc(4 + m.idx.length * 2);
  ib.writeUInt32LE(m.idx.length, 0);
  m.idx.forEach((x, i) => ib.writeUInt16LE(x, 4 + i * 2));
  return Buffer.concat([head, pb, ub, ib]).toString('base64');
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
