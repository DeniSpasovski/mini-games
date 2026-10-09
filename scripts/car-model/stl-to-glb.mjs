#!/usr/bin/env node
/**
 * STL -> game-ready GLB for a rally car body.
 *
 *   node scripts/car-model/stl-to-glb.mjs <car>/model.source.json <input.stl> [--preview out.png]
 *
 * Steps (all driven by the JSON config next to the car):
 *   1. load binary STL, weld vertices
 *   2. re-orient + scale into game model space (+X left, +Y up, +Z forward, y = 0 ground,
 *      z = 0 centre of mass), then apply `offset`
 *   3. cut out the wheels (the game draws its own physics-driven wheels there)
 *   4. simplify to `targetTriangles` (meshoptimizer; `parts.maxTriangles` caps single parts first)
 *   5. creased normals + projection UVs: every triangle goes to the left / right / top /
 *      front / rear / bottom chart by its facing, charts are laid out in metres in one
 *      atlas (`atlas` block) that the car's livery painter draws at runtime
 *   6. write a GLB (POSITION, NORMAL, TEXCOORD_0, indices), one primitive per material
 * `--preview` also writes a normal-shaded picture of the atlas: the reference for painting.
 *
 * Parts (`parts` block, optional): the input STL was labelled by segment-stl.py - each
 * triangle's attribute bytes hold an index into `parts.materials` (0 = painted body).
 * Vertices are not shared between parts, so part borders are mesh borders: the simplifier
 * keeps them exactly (LockBorder) and no colour can bleed across. Every part becomes its
 * own primitive with a material named after it (the game maps names to materials, see
 * cars/shared/part-materials.ts); materials listed in `parts.drop` are removed instead (exact cut-outs
 * such as modelled wheels clipped by a `region` circle). Part UVs are box-projected in metres, except `parts.wrap`
 * materials: fitted to 0..1 over the part, v from the top down - 'corner' (lamps): u from the
 * car's centre outwards round the corner; 'side' (side windows): u from the rear end
 * forwards. Body UVs are the livery atlas.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const [configPath, stlPath, ...rest] = process.argv.slice(2);
if (!configPath || !stlPath) {
  console.error(
    'usage: stl-to-glb.mjs <model.source.json> <input.stl> [--preview out.png]',
  );
  process.exit(1);
}
const previewPath = rest[0] === '--preview' ? rest[1] : null;
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// --- 1. load + weld ------------------------------------------------------------------------
const stl = fs.readFileSync(stlPath);
const triCount = stl.readUInt32LE(80);
if (stl.length !== 84 + triCount * 50)
  throw new Error('only binary STL is supported');
const soup = new Float32Array(triCount * 9);
const MATERIALS = cfg.parts?.materials ?? ['livery'];
const triPart = new Uint16Array(triCount);
for (let i = 0; i < triCount; i++) {
  for (let k = 0; k < 9; k++)
    soup[i * 9 + k] = stl.readFloatLE(84 + i * 50 + 12 + k * 4);
  if (cfg.parts) triPart[i] = stl.readUInt16LE(84 + i * 50 + 48);
  if (triPart[i] >= MATERIALS.length)
    throw new Error(
      `triangle ${i}: part ${triPart[i]} is not in parts.materials - run segment-stl.py first`,
    );
}

// --- 2. orient + scale ------------------------------------------------------------------------
const axis = cfg.axes.map((a) => ({
  sign: a.startsWith('-') ? -1 : 1,
  i: 'xyz'.indexOf(a.at(-1)),
}));
for (let v = 0; v < soup.length; v += 3) {
  const src = [soup[v], soup[v + 1], soup[v + 2]];
  for (let k = 0; k < 3; k++)
    soup[v + k] = src[axis[k].i] * axis[k].sign * cfg.scale;
}
let minY = Infinity;
for (let v = 1; v < soup.length; v += 3) minY = Math.min(minY, soup[v]);
const off = [...cfg.offset];
if (cfg.groundAtMin) off[1] -= minY;
for (let v = 0; v < soup.length; v += 3)
  for (let k = 0; k < 3; k++) soup[v + k] += off[k];

const {
  positions,
  indices: welded,
  part: vertPart,
} = weld(soup, 1e-5, triPart);
console.log(`loaded ${triCount} triangles, ${positions.length / 3} vertices`);

// --- 3. wheel cut-outs ----------------------------------------------------------------------
const W = cfg.wheels;
const DROP = new Set(cfg.parts?.drop ?? []);
const kept = [];
for (let t = 0; t < welded.length; t += 3) {
  const c = [0, 1, 2].map(
    (k) => (P(welded[t], k) + P(welded[t + 1], k) + P(welded[t + 2], k)) / 3,
  );
  const inWheel =
    Math.abs(c[0]) > W.minAbsX &&
    W.centres.some(([z, y]) => Math.hypot(c[2] - z, c[1] - y) < W.radius);
  // parts.drop: materials segment-stl.py labelled only to be removed (e.g. a `region` circle round a
  // modelled wheel - an exact clip, where the radius cut above leaves saw teeth on big lip triangles).
  const dropped = DROP.has(MATERIALS[vertPart[welded[t]]]);
  if (!inWheel && !dropped) kept.push(welded[t], welded[t + 1], welded[t + 2]);
}
console.log(
  `wheels cut / dropped parts: ${(welded.length - kept.length) / 3} triangles removed`,
);
function P(i, k) {
  return positions[i * 3 + k];
}

// --- 4. simplify ----------------------------------------------------------------------------
await MeshoptSimplifier.ready;
// parts.maxTriangles: { material: cap } pre-decimates one part on its own (parts share no vertices,
// so it cannot tear a border) - a dense modelled interior otherwise eats half the global budget.
for (const [name, cap] of Object.entries(cfg.parts?.maxTriangles ?? {})) {
  const m = MATERIALS.indexOf(name);
  const own = [];
  const rest = [];
  for (let t = 0; t < kept.length; t += 3)
    (vertPart[kept[t]] === m ? own : rest).push(
      kept[t],
      kept[t + 1],
      kept[t + 2],
    );
  if (own.length <= cap * 3) continue;
  const [small] = MeshoptSimplifier.simplify(
    Uint32Array.from(own),
    positions,
    3,
    cap * 3,
    0.05,
    ['LockBorder'],
  );
  console.log(
    `${name}: pre-simplified ${own.length / 3} -> ${small.length / 3} triangles`,
  );
  kept.length = 0;
  for (const i of rest) kept.push(i);
  for (const i of small) kept.push(i);
}
const target = Math.min(kept.length, cfg.targetTriangles * 3);
const [simple, err] = MeshoptSimplifier.simplify(
  Uint32Array.from(kept),
  positions,
  3,
  target,
  0.01,
  ['LockBorder'],
);
console.log(
  `simplified to ${simple.length / 3} triangles (error ${err.toFixed(5)})`,
);

// parts.flatten: { material: { axis?: 'z' } } - one smooth cover instead of the source's domes: per side (sign of x)
// a quadratic depth surface (along `axis`, default z) is fitted through the part's BORDER vertices and every interior
// vertex is moved onto it; the border stays, so the part stays sealed to the body (cars/bimmer-m3: the print model
// domed the headlight glass over each bowl by up to 1 cm, which bent the twin-lamp art behind it).
// `tiltDeg`: stand the cover more upright by that angle about the part's mid-height (upper half forward, lower half
// back along `axis`), for a lamp face that leans back so far it reads as aimed at the sky. The shift ramps in over
// `tiltRamp` (default 0.025 m) from the border, so the cover rolls into the fixed outline instead of folding (a hard fold
// showed as stretched light slivers along the lamp's bottom edge).
for (const [name, opt] of Object.entries(cfg.parts?.flatten ?? {})) {
  if (name.startsWith('$')) continue;
  const part = MATERIALS.indexOf(name);
  if (part < 0) throw new Error(`parts.flatten: unknown material ${name}`);
  const ax = 'xyz'.indexOf(opt.axis ?? 'z');
  const [a1, a2] = [0, 1, 2].filter((k) => k !== ax);
  for (const side of [1, -1]) {
    const edges = new Map();
    const verts = new Set();
    for (let t = 0; t < simple.length / 3; t++) {
      const tri = [simple[t * 3], simple[t * 3 + 1], simple[t * 3 + 2]];
      if (vertPart[tri[0]] !== part) continue;
      if (Math.sign(tri.reduce((s, v) => s + P(v, 0), 0)) !== side) continue;
      for (let k = 0; k < 3; k++) {
        const [p, q] = [tri[k], tri[(k + 1) % 3]].sort((m, n) => m - n);
        const key = `${p},${q}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
        verts.add(tri[k]);
      }
    }
    const border = new Set();
    for (const [key, n] of edges)
      if (n === 1) for (const v of key.split(',')) border.add(Number(v));
    if (border.size < 6) continue;
    // Least squares d = c0 + c1 a + c2 b + c3 a^2 + c4 ab + c5 b^2 over the border (normal equations).
    const row = (v) => {
      const a = P(v, a1);
      const b = P(v, a2);
      return [1, a, b, a * a, a * b, b * b];
    };
    const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
    for (const v of border) {
      const r = row(v);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) M[i][j] += r[i] * r[j];
        M[i][6] += r[i] * P(v, ax);
      }
    }
    for (let i = 0; i < 6; i++) {
      let piv = i;
      for (let k = i + 1; k < 6; k++)
        if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      [M[i], M[piv]] = [M[piv], M[i]];
      for (let k = 0; k < 6; k++) {
        if (k === i) continue;
        const f = M[k][i] / M[i][i];
        for (let j = i; j < 7; j++) M[k][j] -= f * M[i][j];
      }
    }
    const c = M.map((r, i) => r[6] / r[i]);
    const tilt = Math.tan(((opt.tiltDeg ?? 0) * Math.PI) / 180);
    const ramp = opt.tiltRamp ?? 0.025;
    let top = -Infinity;
    let bottom = Infinity;
    for (const v of border) {
      top = Math.max(top, P(v, 1));
      bottom = Math.min(bottom, P(v, 1));
    }
    const mid = (top + bottom) / 2;
    const borderList = [...border];
    /** Distance to the outline in the a1 / a2 plane (the view the cover is seen in). */
    const toBorder = (v) => {
      let best = Infinity;
      for (const b of borderList)
        best = Math.min(
          best,
          Math.hypot(P(v, a1) - P(b, a1), P(v, a2) - P(b, a2)),
        );
      return best;
    };
    let moved = 0;
    let most = 0;
    for (const v of verts) {
      if (border.has(v)) continue;
      const w = tilt ? Math.min(1, toBorder(v) / ramp) : 0;
      const d =
        row(v).reduce((s, r, i) => s + r * c[i], 0) +
        tilt * (P(v, 1) - mid) * w;
      most = Math.max(most, Math.abs(d - P(v, ax)));
      positions[v * 3 + ax] = d;
      moved++;
    }
    console.log(
      `${name}: flattened ${moved} vertices (side ${side > 0 ? 'left' : 'right'}, ${border.size} border, max move ${(most * 1000).toFixed(1)} mm)`,
    );
  }
}

// --- 5. creased normals + chart UVs ----------------------------------------------------------
const nTri = simple.length / 3;
const fn = new Float32Array(nTri * 3);
const area = new Float32Array(nTri);
for (let t = 0; t < nTri; t++) {
  const [a, b, c] = [simple[t * 3], simple[t * 3 + 1], simple[t * 3 + 2]];
  const e1 = [0, 1, 2].map((k) => P(b, k) - P(a, k));
  const e2 = [0, 1, 2].map((k) => P(c, k) - P(a, k));
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(...n) || 1;
  area[t] = l / 2;
  for (let k = 0; k < 3; k++) fn[t * 3 + k] = n[k] / l;
}
const incident = new Map();
for (let t = 0; t < nTri; t++)
  for (let k = 0; k < 3; k++) {
    const v = simple[t * 3 + k];
    if (!incident.has(v)) incident.set(v, []);
    incident.get(v).push(t);
  }
const cosCrease = Math.cos((cfg.creaseDeg * Math.PI) / 180);
const A = cfg.atlas;
/** Wheel-arch triangles (inside `wheels.arch.faceRadius` of a hub, or `radius` and facing along the car) -> matte black texel. */
const isArch = (t) => {
  const arch = W.arch;
  if (!arch) return false;
  const c = [0, 1, 2].map(
    (k) =>
      (P(simple[t * 3], k) +
        P(simple[t * 3 + 1], k) +
        P(simple[t * 3 + 2], k)) /
      3,
  );
  if (Math.abs(c[0]) < arch.minAbsX) return false;
  return W.centres.some(([z, y]) => {
    const d = Math.hypot(c[2] - z, c[1] - y);
    if (d < arch.faceRadius) return true;
    if (d >= arch.radius || Math.abs(fn[t * 3]) >= arch.maxNormalX)
      return false;
    // Only surfaces facing the hub (the arch wall), not fender tops above the wheel.
    const facing =
      (fn[t * 3 + 1] * (c[1] - y) + fn[t * 3 + 2] * (c[2] - z)) / (d || 1);
    return facing < -0.25;
  });
};
/**
 * `atlas.chartBoxes`: [{ chart, x, y, z, minNy? }] model-space boxes (x mirrored: |x|) that
 * override the facing rule for body triangles whose centre is inside:
 * - `chart: 'top'`: every triangle facing up at all (normal y > minNy, default 0) -> top chart.
 *   For crease walls inside a painted top-chart shape (a bonnet band) that would land on a
 *   side chart, whose texels there belong to the opposite side's body: unpainted lines.
 * - `chart: 'rear'` / `'front'`: up-facing triangles (normal y > minNy) -> the end chart, for a low ledge that
 *   would otherwise take the top chart's colour at its z / x instead of the rows' colour at its height (a bumper
 *   lip among red rows turned blue). With `any: true`, every triangle in the box (recess walls inside a bumper,
 *   whose sideways faces would land on the side charts' red flank).
 * - `chart: 'side'`: triangles facing along the car (front / rear) -> the side chart of their
 *   own side. For wheel-arch flares: on the end charts the front and rear arches share texels
 *   with each other (and the bumper corners), so they could not take the paint around them.
 *   With `maxNy`, also any triangle whose normal y is in (`minNy`, `maxNy`) - `minNy` defaults to
 *   -maxNy (steep shoulders the facing rule put on the top chart, where a painted edge above
 *   them turned into tall slivers; maxNy 1.01 + minNy -0.2 = horizontal ledges at a side's height).
 */
const CHART_BOXES = A.chartBoxes ?? [];
const boxChart = (t) => {
  if (!CHART_BOXES.length) return null;
  const c = [0, 1, 2].map(
    (k) =>
      (P(simple[t * 3], k) +
        P(simple[t * 3 + 1], k) +
        P(simple[t * 3 + 2], k)) /
      3,
  );
  const ax = Math.abs(c[0]);
  const [nx, ny, nz] = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]];
  for (const b of CHART_BOXES) {
    if (ax < b.x[0] || ax > b.x[1] || c[1] < b.y[0] || c[1] > b.y[1]) continue;
    if (c[2] < b.z[0] || c[2] > b.z[1]) continue;
    if (b.chart === 'top' && ny > (b.minNy ?? 0)) return 'top';
    if (
      (b.chart === 'rear' || b.chart === 'front') &&
      (b.any || ny > (b.minNy ?? 0))
    )
      return b.chart;
    if (
      b.chart === 'side' &&
      ((Math.abs(nz) > Math.abs(nx) && Math.abs(nz) > Math.abs(ny)) ||
        (b.maxNy !== undefined && ny < b.maxNy && ny > (b.minNy ?? -b.maxNy)))
    )
      return c[0] > 0 ? 'left' : 'right';
  }
  return null;
};
const chartOf = (t) => {
  if (isArch(t)) return 'matte';
  const boxed = boxChart(t);
  if (boxed) return boxed;
  const [x, y, z] = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]];
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? 'left' : 'right';
  if (ay >= az) return y > 0 ? 'top' : 'bottom';
  return z > 0 ? 'front' : 'rear';
};
/** One output primitive per material; [0] is the painted body (atlas UVs). */
const prims = MATERIALS.map((name) => ({
  name,
  pos: [],
  nrm: [],
  uv: [],
  idx: [],
  keys: new Map(),
}));
// parts.wrap: { material: 'corner' | 'side' } (or a list = all 'corner').
const wrapCfg = cfg.parts?.wrap ?? {};
const WRAP = Array.isArray(wrapCfg)
  ? Object.fromEntries(wrapCfg.map((n) => [n, 'corner']))
  : wrapCfg;
/** Part UVs in metres: box projection; wrap parts: u round the car's corner, or along the side. */
const partUv = (name, [x, y, z], t) => {
  if (WRAP[name] === 'corner') return [Math.abs(x) - Math.abs(z), y];
  if (WRAP[name] === 'side') return [z, y];
  const ax = Math.abs(fn[t * 3]);
  const ay = Math.abs(fn[t * 3 + 1]);
  const az = Math.abs(fn[t * 3 + 2]);
  if (ax >= ay && ax >= az) return [z, y];
  if (ay >= az) return [x, z];
  return [x, y];
};
const triCentre = (t) =>
  [0, 1, 2].map(
    (k) =>
      (P(simple[t * 3], k) +
        P(simple[t * 3 + 1], k) +
        P(simple[t * 3 + 2], k)) /
      3,
  );
const boxHas = (b, c) =>
  Math.abs(c[0]) >= b.x[0] &&
  Math.abs(c[0]) <= b.x[1] &&
  c[1] >= b.y[0] &&
  c[1] <= b.y[1] &&
  c[2] >= b.z[0] &&
  c[2] <= b.z[1];
/**
 * `at` of the first box holding triangle t's centre (|x|), x mirrored to t's side. `minNy` / `maxNx`: only faces whose normal y
 * is above / whose outward normal x (mirrored) is below it.
 */
const boxAt = (boxes, t) => {
  if (!boxes.length) return null;
  const c = triCentre(t);
  const b = boxes.find(
    (f) =>
      boxHas(f, c) &&
      fn[t * 3 + 1] > (f.minNy ?? -2) &&
      Math.sign(c[0]) * fn[t * 3] < (f.maxNx ?? 2),
  );
  return b ? [Math.sign(c[0]) * b.at[0], b.at[1], b.at[2]] : null;
};
/**
 * `atlas.flatBoxes`: [{ x, y, z, minNy?, maxNx?, at: [x, y, z] }] body triangles in the box take the side chart's paint at the
 * point `at`: one flat colour, e.g. the inside of a fender slot instead of whatever blocks the charts have there.
 * `atlas.backBoxes`: [{ x, y, z, at }] body triangles in the box also get a reversed copy (normals flipped, flat paint at
 * `at`), so a recess seen from inside is not culled away (the ground showed through a fender slot's back faces).
 */
const FLAT_BOXES = A.flatBoxes ?? [];
const BACK_BOXES = A.backBoxes ?? [];
for (let t = 0; t < nTri; t++) {
  const part = vertPart[simple[t * 3]];
  const out = prims[part];
  const flat = part === 0 ? boxAt(FLAT_BOXES, t) : null;
  const chart = flat
    ? flat[0] > 0
      ? 'left'
      : 'right'
    : part === 0
      ? chartOf(t)
      : `p${part}`;
  for (let k = 0; k < 3; k++) {
    const v = simple[t * 3 + k];
    const n = [0, 0, 0];
    for (const f of incident.get(v)) {
      const d =
        fn[f * 3] * fn[t * 3] +
        fn[f * 3 + 1] * fn[t * 3 + 1] +
        fn[f * 3 + 2] * fn[t * 3 + 2];
      if (d < cosCrease) continue;
      for (let j = 0; j < 3; j++) n[j] += fn[f * 3 + j] * area[f];
    }
    const l = Math.hypot(...n) || 1;
    const nn = n.map((c) => c / l);
    const p = [P(v, 0), P(v, 1), P(v, 2)];
    const uv =
      part === 0
        ? chartUv(chart, flat ?? p).map((c, i) => c / (i ? A.height : A.width))
        : partUv(out.name, p, t);
    // Box-projected parts split vertices where the projection axis changes.
    const uvKey =
      part === 0
        ? `${chart}${flat ? ':flat' : ''}`
        : uv.map((c) => Math.round(c * 2000)).join(',');
    const key = `${v}|${uvKey}|${nn.map((c) => Math.round(c * 50)).join(',')}`;
    let o = out.keys.get(key);
    if (o === undefined) {
      o = out.pos.length / 3;
      out.keys.set(key, o);
      out.pos.push(...p);
      out.nrm.push(...nn);
      out.uv.push(...uv);
    }
    out.idx.push(o);
  }
  const back = part === 0 ? boxAt(BACK_BOXES, t) : null;
  if (back) {
    const [i0, i1, i2] = [0, 1, 2].map((k) => simple[t * 3 + k]);
    const uv = chartUv(back[0] > 0 ? 'left' : 'right', back).map(
      (c, i) => c / (i ? A.height : A.width),
    );
    const ids = [i0, i2, i1].map((v) => {
      const o = out.pos.length / 3;
      out.pos.push(P(v, 0), P(v, 1), P(v, 2));
      out.nrm.push(-fn[t * 3], -fn[t * 3 + 1], -fn[t * 3 + 2]);
      out.uv.push(...uv);
      return o;
    });
    out.idx.push(...ids);
  }
}
// Wrap parts: fit the UVs to 0..1 over the part, v from the top down, so a texture covers the
// part exactly. 'corner' (lamps): u from the car's centre outwards round the corner;
// 'side' (side windows): u from the rear end forwards.
for (const p of prims) {
  if (!WRAP[p.name] || !p.uv.length) continue;
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < p.uv.length; i++) {
    lo[i % 2] = Math.min(lo[i % 2], p.uv[i]);
    hi[i % 2] = Math.max(hi[i % 2], p.uv[i]);
  }
  for (let i = 0; i < p.uv.length; i += 2) {
    p.uv[i] = (p.uv[i] - lo[0]) / (hi[0] - lo[0]);
    p.uv[i + 1] = (hi[1] - p.uv[i + 1]) / (hi[1] - lo[1]);
  }
  console.log(
    `${p.name}: wrap UVs fitted, ${(hi[0] - lo[0]).toFixed(3)} x ${(hi[1] - lo[1]).toFixed(3)} m`,
  );
}
// parts.fills: [{ material, poly: [[x, y, z], ...] }] - flat fan patches (model space) added to a material's primitive,
// facing the side with +y: closes a gap in the source mesh, e.g. glass that stops short of where the wipers lie on it
// (cars/bimmer-m3: the windscreen plane continued under the wipers). UVs: box projection like any part.
for (const f of cfg.parts?.fills ?? []) {
  const out = prims[MATERIALS.indexOf(f.material)];
  if (!out) throw new Error(`parts.fills: unknown material ${f.material}`);
  const [p0, p1, p2] = f.poly;
  const e1 = p1.map((c, i) => c - p0[i]);
  const e2 = p2.map((c, i) => c - p0[i]);
  let nn = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const nl = Math.hypot(...nn) || 1;
  nn = nn.map((c) => c / nl);
  const flip = nn[1] < 0;
  if (flip) nn = nn.map((c) => -c);
  const base = out.pos.length / 3;
  for (const p of f.poly) {
    out.pos.push(...p);
    out.nrm.push(...nn);
    out.uv.push(p[0], p[2]);
  }
  for (let i = 1; i < f.poly.length - 1; i++)
    out.idx.push(
      ...(flip
        ? [base, base + i + 1, base + i]
        : [base, base + i, base + i + 1]),
    );
  console.log(`fill added to ${f.material}: ${f.poly.length - 2} triangles`);
}
// parts.solids: [{ material, frame?: { origin: [x, y, z], tilt }, poly: [[u, v], ...], w: [w0, w1], bevel? }] - small
// convex prisms (grille bars, badge shapes, back plates) built in code and added to a material's primitive. `poly` is
// convex and counter-clockwise seen from outside, in the frame's (u, v) plane: u = +x, v = up the plane, w = out of it
// (frame: origin + tilt in degrees, the plane leaning back at the top; no frame = u/v/w are x/y/z). The prism runs from
// w0 to w1; `bevel` insets the front face by that much (a chamfer round the front edge); `chart` ('left' | 'right' | ...)
// gives a solid in the body material that chart's livery atlas UVs (`at`: [x, y, z] = every vertex takes the paint at
// that point: a flat colour). No back cap (never seen).
for (const sd of cfg.parts?.solids ?? []) {
  const out = prims[MATERIALS.indexOf(sd.material)];
  if (!out) throw new Error(`parts.solids: unknown material ${sd.material}`);
  const [ox, oy, oz] = sd.frame?.origin ?? [0, 0, 0];
  const th = ((sd.frame?.tilt ?? 0) * Math.PI) / 180;
  const [c, sn] = [Math.cos(th), Math.sin(th)];
  const to = ([u, v, w]) => [ox + u, oy + v * c + w * sn, oz - v * sn + w * c];
  const poly = sd.poly;
  const n = poly.length;
  const [w0, w1] = sd.w;
  const b = sd.bevel ?? 0;
  // Inset polygon: each edge moved inwards by b, neighbours intersected (convex, so no self crossings).
  const lines = poly.map(([u0, v0], i) => {
    const [u1, v1] = poly[(i + 1) % n];
    const l = Math.hypot(u1 - u0, v1 - v0);
    const nu = (v1 - v0) / l; // outward normal of a CCW edge
    const nv = -(u1 - u0) / l;
    return { nu, nv, d: nu * u0 + nv * v0 - b };
  });
  const inset = lines.map((a, i) => {
    const k = lines[(i + n - 1) % n];
    const det = k.nu * a.nv - k.nv * a.nu;
    return [(k.d * a.nv - k.nv * a.d) / det, (k.nu * a.d - k.d * a.nu) / det];
  });
  let tris = 0;
  const tri = (a, bb, cc) => {
    const A = to(a);
    const B = to(bb);
    const C = to(cc);
    const e1 = B.map((q, i) => q - A[i]);
    const e2 = C.map((q, i) => q - A[i]);
    let nn = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const nl = Math.hypot(...nn) || 1;
    nn = nn.map((q) => q / nl);
    const base = out.pos.length / 3;
    for (const p of [A, B, C]) {
      out.pos.push(...p);
      out.nrm.push(...nn);
      out.uv.push(
        ...(sd.chart
          ? chartUv(sd.chart, sd.at ?? p).map(
              (c, i) => c / (i ? cfg.atlas.height : cfg.atlas.width),
            )
          : [p[0], p[1] + p[2]]),
      );
    }
    out.idx.push(base, base + 1, base + 2);
    tris++;
  };
  const wf = w1 - b;
  const quad = (p0, p1, p2, p3) => {
    tri(p0, p1, p2);
    tri(p0, p2, p3);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [a, bb] = [poly[i], poly[j]];
    quad([...a, w0], [...bb, w0], [...bb, wf], [...a, wf]);
    if (b > 0) {
      const [ia, ib] = [inset[i], inset[j]];
      quad([...a, wf], [...bb, wf], [...ib, w1], [...ia, w1]);
    }
  }
  const front = b > 0 ? inset : poly;
  for (let i = 1; i < n - 1; i++)
    tri(
      [...front[0], b > 0 ? w1 : wf],
      [...front[i], b > 0 ? w1 : wf],
      [...front[i + 1], b > 0 ? w1 : wf],
    );
  console.log(`solid added to ${sd.material}: ${tris} triangles`);
}
// parts.shells: [{ from, cover, wall, offset, centre? }] - a thin open sheet (a modelled lamp that is one surface) gets
// depth: a copy of it `offset` metres outwards (away from `centre`, default the car's middle) goes into the `cover`
// material (a see-through lens over the sheet) and a strip joins the two along every free edge (`wall` material: the
// housing's rim), so it reads as a lens set into a bezel, not a texture on the body.
for (const sh of cfg.parts?.shells ?? []) {
  const src = prims[MATERIALS.indexOf(sh.from)];
  const cover = prims[MATERIALS.indexOf(sh.cover)];
  const wall = prims[MATERIALS.indexOf(sh.wall)];
  if (!src || !cover || !wall)
    throw new Error('parts.shells: unknown material');
  const centre = sh.centre ?? [0, 0.9, -0.2];
  const nv = src.pos.length / 3;
  const key = (i) =>
    [0, 1, 2].map((k) => Math.round(src.pos[i * 3 + k] * 1e4)).join(',');
  // Smoothed normal per welded position, turned away from the centre.
  const acc = new Map();
  for (let i = 0; i < nv; i++) {
    const a = acc.get(key(i)) ?? [0, 0, 0];
    for (let k = 0; k < 3; k++) a[k] += src.nrm[i * 3 + k];
    acc.set(key(i), a);
  }
  const off = [];
  for (let i = 0; i < nv; i++) {
    const a = acc.get(key(i));
    const l = Math.hypot(...a) || 1;
    let n = a.map((c) => c / l);
    const away = [0, 1, 2].reduce(
      (t, k) => t + n[k] * (src.pos[i * 3 + k] - centre[k]),
      0,
    );
    if (away < 0) n = n.map((c) => -c);
    off.push(...[0, 1, 2].map((k) => src.pos[i * 3 + k] + n[k] * sh.offset));
  }
  const cBase = cover.pos.length / 3;
  for (let i = 0; i < nv; i++) {
    cover.pos.push(off[i * 3], off[i * 3 + 1], off[i * 3 + 2]);
    cover.nrm.push(src.nrm[i * 3], src.nrm[i * 3 + 1], src.nrm[i * 3 + 2]);
    cover.uv.push(0, 0);
  }
  for (const i of src.idx) cover.idx.push(cBase + i);
  // Free edges: used by one triangle (positions welded).
  const edges = new Map();
  for (let t = 0; t < src.idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const [a, b] = [src.idx[t + e], src.idx[t + ((e + 1) % 3)]];
      const [ka, kb] = [key(a), key(b)];
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = edges.get(id) ?? { a, b, n: 0 };
      rec.n++;
      edges.set(id, rec);
    }
  let strips = 0;
  for (const { a, b, n } of edges.values()) {
    if (n !== 1) continue;
    const P = (i, shifted) =>
      [0, 1, 2].map((k) => (shifted ? off : src.pos)[i * 3 + k]);
    const [A0, B0, A1, B1] = [P(a, 0), P(b, 0), P(a, 1), P(b, 1)];
    const e1 = B0.map((q, i) => q - A0[i]);
    const e2 = A1.map((q, i) => q - A0[i]);
    let nn = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const nl = Math.hypot(...nn) || 1;
    nn = nn.map((q) => q / nl);
    const base = wall.pos.length / 3;
    for (const p of [A0, B0, B1, A1]) {
      wall.pos.push(...p);
      wall.nrm.push(...nn);
      wall.uv.push(0, 0);
    }
    wall.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    wall.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    strips++;
  }
  console.log(
    `shell ${sh.from}: cover ${src.idx.length / 3} triangles, ${strips} rim strips`,
  );
}
const { pos: outPos, nrm: outNrm, uv: outUv, idx: outIdx } = prims[0];
// Optional wheel-well liner: the cut-out leaves the arch open (see-through behind the
// wheel). A dark cup (inner wall + upper arc) closes it; its UVs sit on the atlas' matte texel
// (bottom chart origin, `matteRect`). `liner.floorY` also closes the inner wall's lower wedge.
if (W.liner) {
  const L = W.liner;
  // The atlas' matte texel (bottom chart origin: the car's `matteRect` patch, painted black + rough) - NOT the bottom
  // chart's centre, which the livery paints like the underside (glossy, reflects the sky).
  const [bu, bv] = chartUv('matte', [0, 0, 0]);
  const addTri = (a, b, c, want) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    for (const q of flip ? [a, c, b] : [a, b, c]) {
      outIdx.push(outPos.length / 3);
      outPos.push(...q);
      outNrm.push(...want);
      outUv.push(bu / A.width, bv / A.height);
    }
  };
  // Outermost body surface (|x| on side `sgn`) at a (y, z) point, from the body / part triangles before the liner.
  const skinTris = [];
  for (const p of prims)
    for (let k = 0; k < p.idx.length; k += 3) {
      const t = [0, 1, 2].map((j) =>
        p.pos.slice(p.idx[k + j] * 3, p.idx[k + j] * 3 + 3),
      );
      if (Math.max(...t.map((q) => Math.abs(q[0]))) > L.outerX - 0.1)
        skinTris.push(t);
    }
  const skinX = (sgn, y, z) => {
    let best = null;
    for (const [a, b, c] of skinTris) {
      if (a[0] * sgn < 0) continue;
      const d = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((y - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (z - a[2])) / d;
      const v = ((b[1] - a[1]) * (z - a[2]) - (y - a[1]) * (b[2] - a[2])) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const x = (a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0])) * sgn;
      if (best === null || x > best) best = x;
    }
    return best;
  };
  const n = 16;
  const a0 = -L.below;
  const a1 = Math.PI + L.below;
  for (const [zc, yc] of W.centres)
    for (const sgn of [1, -1]) {
      const x0 = sgn * W.minAbsX;
      // The cup's rim follows the skin: where the body is narrower than `outerX` at the cup radius (arch top, the
      // bumper behind a rear arch) the rim stops 3 mm inside it, else the black cup end shows through the paint.
      // Sampled per half segment, smallest of the neighbours (as the rings below).
      const rimHalf = [];
      for (let j = 0; j <= 2 * n; j++) {
        const a = a0 + ((a1 - a0) * j) / (2 * n);
        const x = skinX(
          sgn,
          yc + Math.sin(a) * L.radius,
          zc + Math.cos(a) * L.radius,
        );
        rimHalf.push(x === null ? L.outerX : Math.min(L.outerX, x - 0.003));
      }
      const rimX = [];
      for (let i = 0; i <= n; i++)
        rimX.push(
          sgn *
            Math.min(
              rimHalf[2 * i],
              rimHalf[Math.max(0, 2 * i - 1)],
              rimHalf[Math.min(2 * n, 2 * i + 1)],
            ),
        );
      const at = (i, x) => {
        const a = a0 + ((a1 - a0) * i) / n;
        return [x, yc + Math.sin(a) * L.radius, zc + Math.cos(a) * L.radius];
      };
      // The body's cut edge sits further out than the cup's rim (`outerX`): between the skin and the cup is an open
      // slit into the hollow body, seen at a grazing angle behind the wheel. `liner.lip` closes it with flat rings at the
      // rim's x and 3 / 6 cm deeper (grazing rays cross the first ring further out), each from `radius` out to 4 mm
      // inside the skin (raycast along x), at most 6 / 12 / 18 cm wide. Sampled per half segment, a ring vertex = the
      // smallest of its neighbours: a straight ring edge between samples must not cut through a narrower bumper.
      const rings = [];
      for (let k = 0; L.lip && k < 3; k++) {
        const rx = L.outerX - 0.03 * k;
        const reach = (a) => {
          let r = L.radius;
          for (
            let s = L.radius + 0.005;
            s <= L.radius + 0.06 * (k + 1);
            s += 0.005
          ) {
            const x = skinX(sgn, yc + Math.sin(a) * s, zc + Math.cos(a) * s);
            if (x === null || x < rx + 0.004) break;
            r = s;
          }
          return r;
        };
        const half = [];
        for (let j = 0; j <= 2 * n; j++)
          half.push(reach(a0 + ((a1 - a0) * j) / (2 * n)));
        const R = [];
        for (let i = 0; i <= n; i++)
          R.push(
            Math.min(
              half[2 * i],
              half[Math.max(0, 2 * i - 1)],
              half[Math.min(2 * n, 2 * i + 1)],
            ),
          );
        rings.push({ x: sgn * rx, R });
      }
      const ringAt = (i, x, r) => {
        const a = a0 + ((a1 - a0) * i) / n;
        return [x, yc + Math.sin(a) * r, zc + Math.cos(a) * r];
      };
      for (let i = 0; i < n; i++) {
        const am = a0 + ((a1 - a0) * (i + 0.5)) / n;
        const inward = [0, -Math.sin(am), -Math.cos(am)];
        addTri(at(i, x0), at(i, rimX[i]), at(i + 1, rimX[i + 1]), inward);
        addTri(at(i, x0), at(i + 1, rimX[i + 1]), at(i + 1, x0), inward);
        addTri([x0, yc, zc], at(i, x0), at(i + 1, x0), [sgn, 0, 0]);
        for (const { x, R } of rings)
          if (R[i] > L.radius || R[i + 1] > L.radius) {
            addTri(
              ringAt(i, x, L.radius),
              ringAt(i, x, R[i]),
              ringAt(i + 1, x, R[i + 1]),
              [sgn, 0, 0],
            );
            addTri(
              ringAt(i, x, L.radius),
              ringAt(i + 1, x, R[i + 1]),
              ringAt(i + 1, x, L.radius),
              [sgn, 0, 0],
            );
          }
      }
      // `liner.floorY`: close the inner wall's lower wedge too (the sector below the cup's end angles), its rim clamped
      // to the floor line - without it you look through the well into the hollow body from underneath.
      if (L.floorY !== undefined) {
        const w = 12;
        const b0 = a1;
        const b1 = a0 + 2 * Math.PI;
        const low = (i) => {
          const a = b0 + ((b1 - b0) * i) / w;
          return [
            x0,
            Math.max(L.floorY, yc + Math.sin(a) * L.radius),
            zc + Math.cos(a) * L.radius,
          ];
        };
        for (let i = 0; i < w; i++)
          addTri([x0, yc, zc], low(i), low(i + 1), [sgn, 0, 0]);
      }
    }
  console.log('wheel-well liner added');
}
const used = prims.filter((p) => p.idx.length);
console.log(
  'output: ' +
    used.map((p) => `${p.name} ${p.idx.length / 3}`).join(', ') +
    ` = ${used.reduce((a, p) => a + p.idx.length, 0) / 3} triangles`,
);

/** Atlas position (metres) of model-space point p in a chart. Mirrored in cars/shared/atlas-painter.ts. */
function chartUv(chart, [x, y, z]) {
  const b = A.bounds;
  if (chart === 'matte') return [...A.charts.bottom];
  const [cx, cy] = A.charts[chart];
  switch (chart) {
    case 'left':
      return [cx + b.z[1] - z, cy + b.y[1] - y];
    case 'right':
      return [cx + z - b.z[0], cy + b.y[1] - y];
    case 'top':
      return [cx + b.z[1] - z, cy + x - b.x[0]];
    case 'front':
      return [cx + x - b.x[0], cy + b.y[1] - y];
    case 'rear':
      return [cx + b.x[1] - x, cy + b.y[1] - y];
    case 'bottom':
      // A real underside chart (laid out like the top one) when the atlas has room for it;
      // older atlases only reserve a texel for the underside.
      return cx + b.z[1] - b.z[0] <= A.width + 1e-6
        ? [cx + b.z[1] - z, cy + x - b.x[0]]
        : [cx, cy];
    default:
      return [cx, cy];
  }
}

// --- 6. GLB ------------------------------------------------------------------------------------
writeGlb(
  cfg.output,
  used.map((p) => ({
    name: p.name,
    position: new Float32Array(p.pos),
    normal: new Float32Array(p.nrm),
    uv: new Float32Array(p.uv),
    index:
      p.pos.length / 3 < 65536
        ? new Uint16Array(p.idx)
        : new Uint32Array(p.idx),
  })),
);
console.log(
  `wrote ${cfg.output} (${(fs.statSync(cfg.output).size / 1e6).toFixed(2)} MB)`,
);

if (previewPath) {
  writePreview(previewPath);
  console.log(`wrote ${previewPath}`);
}

// --- helpers -------------------------------------------------------------------------------------

/** Weld equal positions; vertices of different parts (per-triangle `triPart`) stay separate. */
function weld(pos, q, triPart) {
  const map = new Map();
  const idx = new Uint32Array(pos.length / 3);
  const out = [];
  const part = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const g = triPart[Math.floor(i / 3)];
    const key = `${g}|${Math.round(pos[i * 3] / q)},${Math.round(pos[i * 3 + 1] / q)},${Math.round(pos[i * 3 + 2] / q)}`;
    let v = map.get(key);
    if (v === undefined) {
      v = out.length / 3;
      map.set(key, v);
      out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      part.push(g);
    }
    idx[i] = v;
  }
  return {
    positions: new Float32Array(out),
    indices: idx,
    part: Uint16Array.from(part),
  };
}

function writeGlb(file, parts) {
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const add = (arr, type, componentType, target, minmax) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, Buffer.alloc(pad));
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      target,
    });
    offset += bytes.length + pad;
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const acc = {
      bufferView: views.length - 1,
      componentType,
      count: arr.length / comps,
      type,
    };
    if (minmax) {
      acc.min = [Infinity, Infinity, Infinity];
      acc.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i++) {
        acc.min[i % 3] = Math.min(acc.min[i % 3], arr[i]);
        acc.max[i % 3] = Math.max(acc.max[i % 3], arr[i]);
      }
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const primitives = parts.map((a, material) => ({
    attributes: {
      POSITION: add(a.position, 'VEC3', 5126, 34962, true),
      NORMAL: add(a.normal, 'VEC3', 5126, 34962),
      TEXCOORD_0: add(a.uv, 'VEC2', 5126, 34962),
    },
    indices: add(
      a.index,
      'SCALAR',
      a.index instanceof Uint16Array ? 5123 : 5125,
      34963,
    ),
    material,
  }));
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'scripts/car-model/stl-to-glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'body', mesh: 0 }],
    meshes: [{ name: 'body', primitives }],
    // Placeholder materials: the game replaces them by name (livery / trim / glass ...).
    materials: parts.map((a) => ({
      name: a.name,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        roughnessFactor: 0.5,
      },
    })),
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([
    jsonBuf,
    Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunkHead = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.concat([
      header,
      chunkHead(jsonBuf.length, 0x4e4f534a),
      jsonBuf,
      chunkHead(bin.length, 0x004e4942),
      bin,
    ]),
  );
}

/** Normal-shaded atlas (outermost surface wins per chart) with a 10 cm grid. */
function writePreview(file) {
  const k = A.pxPerMetre;
  const w = Math.ceil(A.width * k);
  const h = Math.ceil(A.height * k);
  const img = Buffer.alloc(w * h * 3, 40);
  const depth = new Float32Array(w * h).fill(-Infinity);
  const depthOf = { left: 0, right: 0, top: 1, bottom: 1, front: 2, rear: 2 };
  const dirOf = { left: 1, right: -1, top: 1, bottom: -1, front: 1, rear: -1 };
  for (let t = 0; t < outIdx.length / 3; t++) {
    const vs = [0, 1, 2].map((j) => outIdx[t * 3 + j]);
    const pts = vs.map((v) => [
      outUv[v * 2] * A.width * k,
      outUv[v * 2 + 1] * A.height * k,
    ]);
    const n = [0, 1, 2].map((j) => outNrm[vs[0] * 3 + j]);
    const chart = (() => {
      const ax = Math.abs(n[0]);
      const ay = Math.abs(n[1]);
      const az = Math.abs(n[2]);
      if (ax >= ay && ax >= az) return n[0] > 0 ? 'left' : 'right';
      if (ay >= az) return n[1] > 0 ? 'top' : 'bottom';
      return n[2] > 0 ? 'front' : 'rear';
    })();
    const shade = Math.round(
      70 +
        170 * Math.max(0, 0.45 * n[0] + 0.75 * n[1] + 0.48 * n[2] * 0.6 + 0.3),
    );
    const dz = vs.map((v) => outPos[v * 3 + depthOf[chart]] * dirOf[chart]);
    const [a, b, c] = pts;
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const l1 =
          ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
        const l2 =
          ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
        const z = l1 * dz[0] + l2 * dz[1] + l3 * dz[2];
        const i = y * w + x;
        if (z <= depth[i]) continue;
        depth[i] = z;
        img[i * 3] = img[i * 3 + 1] = img[i * 3 + 2] = Math.min(255, shade);
      }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x % (k / 10) < 1 || y % (k / 10) < 1) {
        const i = (y * w + x) * 3;
        const major = x % k < 1 || y % k < 1;
        img[i] = Math.min(255, img[i] + (major ? 120 : 30));
      }
  writePng(file, w, h, img);
}

function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
