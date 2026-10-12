#!/usr/bin/env node
/**
 * Rim + tyre STLs (3D-print parts) -> one game wheel GLB with two meshes, `rim` and `tyre`.
 *
 *   node scripts/car-model/wheel-stl-to-glb.mjs <rim.stl> <tyre.stl> <out.glb> [--rim 7000] [--tyre 7000] [--keep]
 *
 * `--keep` skips step 2 (the strip rules are measured on the Printables print parts): for a game-ready
 * rim exported from a GLB (cars/skoda-rally/: `skoda-rally-rim-fl.stl`, axis = STL z, outer face at z max).
 * `--barrel <r>` = the rim's bead-seat radius in STL units: the game (cars/shared/stl-wheel.ts) scales the rim so
 * that 0.62 of the unit radius lands on the tyre's bead, so the radial unit is barrel / 0.62 instead of the tyre
 * radius (the Printables rim happens to have its barrel at 0.62 of its tyre radius; others do not).
 * `--flange <r>` = add a rim lip on the outer face up to unit radius r (> 0.62), for a rim that ends at its bead seat
 * (cars/lancer-evo-6/): the game tyre's sidewall flares out from the bead, so without a lip a groove shows between them.
 *
 * Written for print wheel / tyre parts whose axis is STL z with the spoke face at z max. Steps:
 *   1. load + weld both parts, centre them on the axis; the tyre slides onto the rim barrel with its
 *      outer face flush with the rim lip (the barrel is exactly one tyre width long)
 *   2. strip what is hidden or only there for printing: the rim's mounting tube + centre cone and
 *      the recessed plate between the spokes (so the game's brake disc + caliper show through), the
 *      barrel outside (inside the tyre) and the tyre bore (on the barrel)
 *   3. simplify each part (meshoptimizer) and write creased normals
 *   4. write the GLB in UNIT wheel space: x = axle (outer face +x, tyre centre at 0, 1 = tyre width),
 *      y / z radial (1 = tyre outer radius). The game scales it by (width, radius, radius) per car
 *      (cars/shared/stl-wheel.ts), so normals are stored for that non-uniform scale.
 */
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const [rimPath, tyrePath, outPath, ...rest] = process.argv.slice(2);
if (!rimPath || !tyrePath || !outPath) {
  console.error(
    'usage: wheel-stl-to-glb.mjs <rim.stl> <tyre.stl> <out.glb> [--rim N] [--tyre N]',
  );
  process.exit(1);
}
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : def;
};
const CREASE_DEG = 38;
const KEEP_ALL = rest.includes('--keep');
const BARREL = opt('barrel', 0);
const FLANGE = opt('flange', 0);

// --- 1. load ----------------------------------------------------------------------------------
const rim = loadStl(rimPath);
const tyre = loadStl(tyrePath);
const rimB = bounds(rim);
const tyreB = bounds(tyre);
const centre = (b, k) => (b.min[k] + b.max[k]) / 2;
// Axis through the bbox centre (both parts are round); STL units throughout steps 1-2.
for (const [soup, b] of [
  [rim, rimB],
  [tyre, tyreB],
]) {
  const cx = centre(b, 0);
  const cy = centre(b, 1);
  for (let v = 0; v < soup.length; v += 3) {
    soup[v] -= cx;
    soup[v + 1] -= cy;
  }
}
const face = rimB.max[2]; // rim lip = tyre outer face
const tyreW = tyreB.max[2] - tyreB.min[2];
const tyreShift = face - tyreB.max[2];
for (let v = 2; v < tyre.length; v += 3) tyre[v] += tyreShift;
const tyreR = maxRadius(tyre);
const zMid = face - tyreW / 2;
console.log(
  `tyre: radius ${tyreR.toFixed(3)} width ${tyreW.toFixed(3)} (STL units), rim lip z ${face.toFixed(3)}`,
);

// --- 2. strip hidden / print-only parts -----------------------------------------------------------
// Measured from cross-sections of the Fabia rim (STL units, r from the axis, z towards the face):
// barrel r 8.3..10.34 (z 1.2..13.25), spoke faces z 12.5..13.25, recessed plate between the
// spokes at z ~11.5 (r < 7), mounting tube r 5.4..6.9 / centre cone behind it (z < 11), hub ring
// round the r 1.7 bore at z 10..12.5, thin fins r 6.9..8.3 behind each spoke.
const rimKeep = (c, n) => {
  const r = Math.hypot(c[0], c[1]);
  const z = c[2] - (face - 13.25);
  if (r < 3.6 && z < 9.8) return false; // tube bore behind the hub ring
  if (r >= 3.6 && r < 6.97 && z < 11) return false; // tube + centre cone (the fins behind the spokes stay: they hold the barrel wall)
  if (n[2] > 0.7 && r > 4.4 && r < 7.3 && z > 11 && z < 12.2) return false; // plate between spokes
  if (r > 10.2 && Math.abs(n[2]) < 0.3 && z < 12.9) return false; // barrel outside (in the tyre)
  return true;
};
const tyreKeep = (c, n) => {
  const r = Math.hypot(c[0], c[1]);
  const radial = (n[0] * c[0] + n[1] * c[1]) / (r || 1);
  return !(r < tyreR * 0.77 && radial < -0.7); // bore, sits on the barrel
};

await MeshoptSimplifier.ready;
const parts = {
  rim: buildPart('rim', rim, KEEP_ALL ? () => true : rimKeep, opt('rim', 7000)),
  tyre: buildPart(
    'tyre',
    tyre,
    KEEP_ALL ? () => true : tyreKeep,
    opt('tyre', 7000),
    // the game ignores this mesh (tyres come from tyre-mesh.ts): a small target is a stub, let it get coarse
    opt('tyre', 7000) < 2000 ? 1 : 0.02,
  ),
};
if (FLANGE > 0.62) parts.rim = addFlange(parts.rim, FLANGE);
writeGlb(outPath, parts);
console.log(
  `wrote ${outPath} (${(fs.statSync(outPath).size / 1e3).toFixed(0)} kB)`,
);

// --- helpers ------------------------------------------------------------------------------------

/** A lathed rim lip (unit wheel space) on the outer face: from under the bead seat (0.62) up to `top`, rolled inwards. */
function addFlange(part, top, segments = 96) {
  const d = top - 0.62;
  // [x, r] from the hidden root to the rolled edge (it tucks under the tyre sidewall).
  const prof = [
    [0.47, 0.6],
    [0.497, 0.618],
    [0.5, 0.62 + 0.55 * d],
    [0.494, 0.62 + 0.9 * d],
    [0.478, top],
    [0.46, top - 0.15 * d],
  ];
  // Profile normals (outward = away from the rim's inside), averaged over the two neighbouring segments.
  const segN = prof.slice(1).map(([x, r], i) => {
    const [dx, dr] = [x - prof[i][0], r - prof[i][1]];
    const l = Math.hypot(dx, dr);
    return [dr / l, -dx / l];
  });
  const nrm = prof.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]);
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  });
  const pos = [...part.position];
  const nor = [...part.normal];
  const idx = [...part.index];
  const base = pos.length / 3;
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2;
    const [c, si] = [Math.cos(t), Math.sin(t)];
    prof.forEach(([x, r], i) => {
      pos.push(x, r * c, r * si);
      nor.push(nrm[i][0], nrm[i][1] * c, nrm[i][1] * si);
    });
  }
  const n = prof.length;
  for (let s = 0; s < segments; s++)
    for (let i = 0; i < n - 1; i++) {
      const a = base + s * n + i;
      const b = a + n;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  console.log(
    `rim: + flange to r ${top} (${segments * (n - 1) * 2} triangles)`,
  );
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    index: pos.length / 3 < 65536 ? new Uint16Array(idx) : new Uint32Array(idx),
  };
}

function buildPart(name, soup, keep, targetTris, maxError = 0.02) {
  const { positions, indices } = weld(soup, 1e-4);
  const P = (i, k) => positions[i * 3 + k];
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const cen = [0, 1, 2].map((k) => (P(a, k) + P(b, k) + P(c, k)) / 3);
    if (keep(cen, faceNormal(positions, a, b, c))) kept.push(a, b, c);
  }
  const [simple, err] = MeshoptSimplifier.simplify(
    Uint32Array.from(kept),
    positions,
    3,
    Math.min(kept.length, targetTris * 3),
    maxError,
    maxError > 0.02 ? [] : ['LockBorder'],
  );
  console.log(
    `${name}: ${indices.length / 3} -> ${kept.length / 3} kept -> ${simple.length / 3} triangles (error ${err.toFixed(4)})`,
  );

  // Unit wheel space: x = (z - zMid) / tyreW, y = y / tyreR, z = -x / tyreR (right-handed).
  const radialUnit = BARREL > 0 ? BARREL / 0.62 : tyreR;
  const toUnit = (p) => [
    (p[2] - zMid) / tyreW,
    p[1] / radialUnit,
    -p[0] / radialUnit,
  ];
  // Normals for that non-uniform map: n' ~ (tyreW nz, tyreR ny, -tyreR nx).
  const unitNormal = (n) => {
    const v = [tyreW * n[2], radialUnit * n[1], -radialUnit * n[0]];
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
  };

  // Creased normals (in STL space, angles are not distorted there).
  const nTri = simple.length / 3;
  const fn = [];
  const area = [];
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = [simple[t * 3], simple[t * 3 + 1], simple[t * 3 + 2]];
    const e1 = [0, 1, 2].map((k) => P(b, k) - P(a, k));
    const e2 = [0, 1, 2].map((k) => P(c, k) - P(a, k));
    const n = cross(e1, e2);
    const l = Math.hypot(...n) || 1;
    area.push(l / 2);
    fn.push(n.map((x) => x / l));
  }
  const incident = new Map();
  for (let t = 0; t < nTri; t++)
    for (let k = 0; k < 3; k++) {
      const v = simple[t * 3 + k];
      if (!incident.has(v)) incident.set(v, []);
      incident.get(v).push(t);
    }
  const cosCrease = Math.cos((CREASE_DEG * Math.PI) / 180);
  const outPos = [];
  const outNrm = [];
  const outIdx = [];
  const vertKey = new Map();
  for (let t = 0; t < nTri; t++)
    for (let k = 0; k < 3; k++) {
      const v = simple[t * 3 + k];
      const n = [0, 0, 0];
      for (const u of incident.get(v)) {
        if (dot(fn[u], fn[t]) < cosCrease) continue;
        for (let j = 0; j < 3; j++) n[j] += fn[u][j] * area[u];
      }
      const l = Math.hypot(...n) || 1;
      const nu = unitNormal(n.map((x) => x / l));
      const key = `${v}|${nu.map((x) => Math.round(x * 64)).join(',')}`;
      let i = vertKey.get(key);
      if (i === undefined) {
        i = outPos.length / 3;
        vertKey.set(key, i);
        outPos.push(...toUnit([P(v, 0), P(v, 1), P(v, 2)]));
        outNrm.push(...nu);
      }
      outIdx.push(i);
    }
  console.log(`${name}: ${outPos.length / 3} vertices`);
  return {
    position: new Float32Array(outPos),
    normal: new Float32Array(outNrm),
    index:
      outPos.length / 3 < 65536
        ? new Uint16Array(outIdx)
        : new Uint32Array(outIdx),
  };
}

function loadStl(file) {
  const stl = fs.readFileSync(file);
  const n = stl.readUInt32LE(80);
  if (stl.length !== 84 + n * 50)
    throw new Error(`${file}: only binary STL is supported`);
  const soup = new Float32Array(n * 9);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 9; k++)
      soup[i * 9 + k] = stl.readFloatLE(84 + i * 50 + 12 + k * 4);
  return soup;
}

function bounds(soup) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < soup.length; v += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], soup[v + k]);
      max[k] = Math.max(max[k], soup[v + k]);
    }
  return { min, max };
}

function maxRadius(soup) {
  let r = 0;
  for (let v = 0; v < soup.length; v += 3)
    r = Math.max(r, Math.hypot(soup[v], soup[v + 1]));
  return r;
}

function faceNormal(pos, a, b, c) {
  const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
  const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
  const n = cross(e1, e2);
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function weld(pos, q) {
  const map = new Map();
  const idx = new Uint32Array(pos.length / 3);
  const out = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${Math.round(pos[i * 3] / q)},${Math.round(pos[i * 3 + 1] / q)},${Math.round(pos[i * 3 + 2] / q)}`;
    let v = map.get(key);
    if (v === undefined) {
      v = out.length / 3;
      map.set(key, v);
      out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    idx[i] = v;
  }
  return { positions: new Float32Array(out), indices: idx };
}

/** GLB with one node + mesh per part (named), POSITION / NORMAL / indices. */
function writeGlb(file, meshes) {
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
    const comps = { SCALAR: 1, VEC3: 3 }[type];
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
  const gltfMeshes = [];
  const nodes = [];
  for (const [name, m] of Object.entries(meshes)) {
    const position = add(m.position, 'VEC3', 5126, 34962, true);
    const normal = add(m.normal, 'VEC3', 5126, 34962);
    const indices = add(
      m.index,
      'SCALAR',
      m.index instanceof Uint16Array ? 5123 : 5125,
      34963,
    );
    gltfMeshes.push({
      name,
      primitives: [
        { attributes: { POSITION: position, NORMAL: normal }, indices },
      ],
    });
    nodes.push({ name, mesh: gltfMeshes.length - 1 });
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'wheel-stl-to-glb.mjs' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(js.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, js, bh, bin]));
}
