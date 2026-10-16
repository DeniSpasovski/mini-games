/**
 * Service-park LODs of the rally cars: the real car model, a lot cheaper (world/park-car-mesh.ts draws it).
 *
 *   node scripts/car-model/park-lods.mjs [car_id ...]          (default: every car in PARK_CARS)
 *
 * public/models/cars/<car>.glb (+ <car>_wheel.glb)  ->  public/models/cars/<car>_park.glb with
 *   lod0 / lod1 / lod2   the body, three simplifications, each a mesh of two primitives:
 *                          `paint`  the body shell with atlas UVs (the livery is painted onto it at runtime),
 *                          `parts`  everything else (trim, glass, lamps, chrome ...) in vertex colours (COLOR_0, the
 *                                   colours of cars/shared/part-materials.ts), no UVs;
 *   rim0 / rim1 / rim2   the car's wheel-GLB rim, simplified (unit wheel space, like the wheel GLB).
 * Dropped: the cockpit (interior, cage, source seats): a parked car's glass is opaque dark. Tyres are built at runtime
 * (lathe, few segments).
 *
 * Simplification = meshoptimizer on ONE mesh (paint shell + parts) welded by POSITION only (the source has a vertex
 * per normal / UV variant, and every seam would block a collapse; trim meeting paint share their edge vertices, so
 * nothing cracks), then the attributes are put back on the surviving vertices:
 *   - each source triangle is labelled with its atlas chart (read from its UVs: box-projected charts, `atlas` block
 *     of the car's model.source.json; three equal UVs = pinned to that texel, wheel arches / flat patches) or with its
 *     part colour; a new triangle takes the label most of its corners' source triangles had, paint UVs are
 *     re-projected (a chart that faces away from the triangle is swapped for the facing one);
 *   - normals: the source normal at that position closest to the new face's (smooth stays smooth, creases stay).
 * The build compresses the file like the other car GLBs (glb-meshopt.mjs).
 *
 * A new released car: add it to PARK_CARS (and assets/builders/park-cars.ts), run this, commit the `_park.glb`
 * (tests/rally/park-lods.test.ts checks every listed car has one).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const DIR = path.join(root, 'public/models/cars');

/** Released cars with a GLB (keep in sync with assets/builders/park-cars.ts). */
export const PARK_CARS = [
  'skoda_rally',
  'bimmer_m3',
  'bimmer_gt2',
  'fiesta',
  'citroen_c4',
  'lancer_evo_6',
  'ford_gt3',
  'merc_190',
  'audi_rs6',
  'peugeot_206',
];

/** Triangle targets per LOD: the whole body (paint shell + parts, simplified as one surface) and one rim. */
export const LODS = [
  { tris: 7500, rim: 700 },
  { tris: 2300, rim: 0 },
  { tris: 1100, rim: 0 },
];

/** Material name -> vertex colour of the `parts` group (part-materials.ts). */
const PART_COLORS = {
  trim: '#141516',
  gloss: '#08090a',
  wingblue: '#0c2a6e',
  winggreen: '#2eaa4a',
  mesh: '#2c2f33',
  carbon: '#1c1d20',
  glass: '#0a0d10',
  ventglass: '#0a0d10',
  headlight: '#d5dbe0',
  twinlamp: '#d5dbe0',
  coilover: '#f0c020',
  mirror: '#8d97a1',
  lens: '#d5dae0',
  lenscover: '#6f7f90',
  chrome: '#b9bec5',
  amber: '#ff9a1a',
  headlight22: '#d5dbe0',
  tail22: '#b01018',
  corner22: '#d89a30',
  indic22: '#e08a14',
  lampcup: '#c8303a',
  lampbulb: '#ffc8b8',
  tail: '#a8141c',
  tailc: '#c81a22',
  tailc4: '#c81a22',
  tailled: '#d01418',
  seal: '#1a0a0c',
  flagblue: '#1d3a9e',
  flagwhite: '#f1f1f1',
  flagred: '#d3202c',
  lamphousing: '#3a3b3e',
  headled: '#fff4d6',
  reverselamp: '#e4e6e8',
  redcover: '#b3151c',
  brakecover: '#b3151c',
  reflector: '#a30f17',
  recess: '#101112',
  satin: '#b4b8be',
  brakestrip: '#a30f17',
  lampred: '#b01018',
  lampclear: '#d9dde0',
  'src:shell': '#0b0b0c',
  'src:lamp': '#d9dde0',
  'src:tail': '#b81820',
};
/** Not drawn: the cockpit (the glass is opaque dark). */
const DROPPED = /^(interior|cage|lining|src:int:)/;
const GLASS = /^(glass|ventglass)/;
const CREASE = Math.cos((40 * Math.PI) / 180);

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function colorOf(name) {
  const base = name.replace(/:2s$/, '');
  if (GLASS.test(base)) return PART_COLORS.glass;
  if (PART_COLORS[base]) return PART_COLORS[base];
  const src = /^src:([a-z]+)/.exec(base);
  if (src && PART_COLORS[`src:${src[1]}`]) return PART_COLORS[`src:${src[1]}`];
  console.warn(`  unknown part "${name}": dark grey`);
  return '#2a2c30';
}

// --- GLB in / out ------------------------------------------------------------------------------

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAY = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

function readGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const start = 20 + jsonLen + 8;
  const bin = buf.subarray(start, start + buf.readUInt32LE(20 + jsonLen));
  return { json, bin };
}

function accessor({ json, bin }, index) {
  const a = json.accessors[index];
  const v = json.bufferViews[a.bufferView];
  const T = ARRAY[a.componentType];
  const n = COMPONENTS[a.type];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const copy = new Uint8Array(
    bin.subarray(off, off + a.count * n * T.BYTES_PER_ELEMENT),
  );
  return new T(copy.buffer);
}

/** Every primitive of a GLB: { name (material, else mesh), pos, nrm, uv, idx }. Nodes must have no transform. */
function primitives(glb) {
  const out = [];
  for (const node of glb.json.nodes) {
    if (node.mesh === undefined) continue;
    if (node.translation || node.rotation || node.scale || node.matrix)
      throw new Error(`node ${node.name} has a transform`);
    const mesh = glb.json.meshes[node.mesh];
    for (const p of mesh.primitives) {
      const name = glb.json.materials?.[p.material]?.name ?? mesh.name;
      const pos = accessor(glb, p.attributes.POSITION);
      const nrm =
        p.attributes.NORMAL === undefined
          ? null
          : accessor(glb, p.attributes.NORMAL);
      const uv =
        p.attributes.TEXCOORD_0 === undefined
          ? null
          : accessor(glb, p.attributes.TEXCOORD_0);
      const idx =
        p.indices === undefined
          ? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i)
          : Uint32Array.from(accessor(glb, p.indices));
      out.push({ name, pos, nrm, uv, idx });
    }
  }
  return out;
}

// --- welded meshes -----------------------------------------------------------------------------

const posKey = (p, v) =>
  `${Math.round(p[v * 3] * 1e5)},${Math.round(p[v * 3 + 1] * 1e5)},${Math.round(p[v * 3 + 2] * 1e5)}`;

/**
 * Source triangles welded by position. `label(prim, tri)` names a triangle (its chart, its colour); per position the
 * labels of its triangles and its distinct source normals are kept for the attribute lookup after simplifying.
 */
class Welded {
  constructor() {
    this.ids = new Map();
    this.pos = [];
    this.idx = [];
    this.labels = []; // per triangle
    this.vertLabels = []; // per position: Map label -> count
    this.vertNormals = []; // per position: [[nx, ny, nz], ...]
  }
  vertex(prim, v) {
    const k = posKey(prim.pos, v);
    let id = this.ids.get(k);
    if (id === undefined) {
      id = this.pos.length / 3;
      this.ids.set(k, id);
      this.pos.push(prim.pos[v * 3], prim.pos[v * 3 + 1], prim.pos[v * 3 + 2]);
      this.vertLabels.push(new Map());
      this.vertNormals.push([]);
    }
    if (prim.nrm) {
      const n = [prim.nrm[v * 3], prim.nrm[v * 3 + 1], prim.nrm[v * 3 + 2]];
      const list = this.vertNormals[id];
      if (!list.some((m) => m[0] * n[0] + m[1] * n[1] + m[2] * n[2] > 0.999))
        list.push(n);
    }
    return id;
  }
  add(prim, label) {
    for (let t = 0; t < prim.idx.length; t += 3) {
      const l = typeof label === 'function' ? label(prim, t) : label;
      const ids = [0, 1, 2].map((k) => this.vertex(prim, prim.idx[t + k]));
      if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
      this.idx.push(...ids);
      this.labels.push(l);
      for (const id of ids) {
        const m = this.vertLabels[id];
        m.set(l, (m.get(l) ?? 0) + 1);
      }
    }
  }
  get tris() {
    return this.idx.length / 3;
  }
}

const simp = MeshoptSimplifier;

/** Source triangle centroids in a hash grid, to name a new triangle after the source surface nearest its centre. */
class LabelGrid {
  constructor(w, cell = 0.12) {
    this.cell = cell;
    this.cells = new Map();
    for (let t = 0; t < w.idx.length; t += 3) {
      const c = [0, 1, 2].map(
        (k) =>
          (w.pos[w.idx[t] * 3 + k] +
            w.pos[w.idx[t + 1] * 3 + k] +
            w.pos[w.idx[t + 2] * 3 + k]) /
          3,
      );
      const key = this.key(c[0], c[1], c[2]);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push([
        c,
        w.labels[t / 3],
        faceNormal(w, [w.idx[t], w.idx[t + 1], w.idx[t + 2]]),
      ]);
    }
  }
  key(x, y, z) {
    const c = this.cell;
    return `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;
  }
  /** The label of the source triangle nearest `p` that faces the way `n` does (else the nearest of any facing). */
  nearest(p, n) {
    return this.search(p, n, 0.3) ?? this.search(p, n, -2);
  }
  search(p, n, minDot) {
    const c = this.cell;
    const [ix, iy, iz] = p.map((v) => Math.floor(v / c));
    let best;
    let bestD = Infinity;
    for (let ring = 0; ring < 8 && best === undefined; ring++)
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring)
              continue;
            for (const [q, label, m] of this.cells.get(
              `${ix + dx},${iy + dy},${iz + dz}`,
            ) ?? []) {
              if (m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < minDot) continue;
              const d =
                (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
              if (d < bestD) [best, bestD] = [label, d];
            }
          }
    return best;
  }
}

/**
 * Simplify to ~`target` triangles -> list of triangles { ids: [a, b, c] (positions of `w`), label }. The label of a
 * new triangle = that of the source triangle nearest its centre.
 */
function simplify(w, target, lockBorder, prune = false) {
  const positions = Float32Array.from(w.pos);
  const indices = Uint32Array.from(w.idx);
  let out = indices;
  let error = 0;
  // Halve per call: one big step can stall on a complex mesh where the same steps in a row get there.
  const flags = [
    ...(lockBorder ? ['LockBorder'] : []),
    ...(prune ? ['Prune'] : []),
  ];
  for (let pass = 0; pass < 12 && out.length / 3 > target * 1.03; pass++) {
    const want = Math.max(target, Math.floor(out.length / 3 / 2));
    const [next, e] = simp.simplify(out, positions, 3, want * 3, 0.5, flags);
    error = Math.max(error, e);
    if (next.length >= out.length * 0.98) break;
    out = next;
  }
  const grid = new LabelGrid(w);
  const tris = [];
  for (let t = 0; t < out.length; t += 3) {
    const ids = [out[t], out[t + 1], out[t + 2]];
    const c = [0, 1, 2].map(
      (k) =>
        (positions[ids[0] * 3 + k] +
          positions[ids[1] * 3 + k] +
          positions[ids[2] * 3 + k]) /
        3,
    );
    tris.push({ ids, label: grid.nearest(c, faceNormal(w, ids)) });
  }
  return { tris, error: error * simp.getScale(positions, 3) };
}

/** Output mesh with attributes: pos / nrm / uv? / col?; vertices are shared per (position, label, normal). */
class Out {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.keys = new Map();
  }
  /** `attrs(p, n)` = { uv?, col? } for a vertex at position p with normal n. */
  tri(w, t, attrs) {
    const [a, b, c] = t.ids.map((id) => [
      w.pos[id * 3],
      w.pos[id * 3 + 1],
      w.pos[id * 3 + 2],
    ]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const fl = Math.hypot(...f);
    if (fl < 1e-12) return;
    const fn = f.map((x) => x / fl);
    const corner = [a, b, c].map((p, k) => {
      const id = t.ids[k];
      // The source normal here closest to the face normal: smooth where the source was smooth, sharp at creases.
      let n = fn;
      let d = CREASE;
      for (const m of w.vertNormals[id]) {
        const dot = m[0] * fn[0] + m[1] * fn[1] + m[2] * fn[2];
        if (dot > d) [n, d] = [m, dot];
      }
      const at = attrs(p, t.label);
      const key = `${id}|${t.label}|${n.map((x) => Math.round(x * 40)).join(',')}`;
      let o = this.keys.get(key);
      if (o === undefined) {
        o = this.pos.length / 3;
        this.keys.set(key, o);
        this.pos.push(...p);
        this.nrm.push(...n);
        if (at.uv) this.uv.push(...at.uv);
        if (at.col) this.col.push(...at.col, 255);
      }
      return o;
    });
    this.idx.push(...corner);
  }
  merge(o) {
    const base = this.pos.length / 3;
    this.pos.push(...o.pos);
    this.nrm.push(...o.nrm);
    this.uv.push(...o.uv);
    this.col.push(...o.col);
    for (const i of o.idx) this.idx.push(base + i);
  }
}

/**
 * A stand-in rim in unit wheel space (axis X, outer face +X, barrel 0.62): barrel, a dished face and a hub cap.
 * `seg` segments round.
 */
function rimProxy(o, seg) {
  const R = 0.62;
  const ring = (x, r, k) => [
    x,
    Math.cos((k / seg) * Math.PI * 2) * r,
    Math.sin((k / seg) * Math.PI * 2) * r,
  ];
  const quad = (a, b, c, d, n) => {
    const base = o.pos.length / 3;
    for (const p of [a, b, c, d]) {
      o.pos.push(...p);
      o.nrm.push(...n(p));
    }
    o.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a, b, c, n) => {
    const base = o.pos.length / 3;
    for (const p of [a, b, c]) {
      o.pos.push(...p);
      o.nrm.push(...n(p));
    }
    o.idx.push(base, base + 1, base + 2);
  };
  const radial = (p) => {
    const l = Math.hypot(p[1], p[2]) || 1;
    return [0, -p[1] / l, -p[2] / l]; // the barrel is seen from inside
  };
  for (let k = 0; k < seg; k++) {
    // Barrel (faces inward) from the back to the lip.
    quad(
      ring(-0.45, R, k),
      ring(0.5, R, k),
      ring(0.5, R, k + 1),
      ring(-0.45, R, k + 1),
      radial,
    );
    // Dished face: a cone from the lip's ring to the hub.
    tri(
      ring(0.3, R * 0.96, k),
      ring(0.3, R * 0.96, k + 1),
      ring(0.36, R * 0.22, k),
      () => [1, 0, 0],
    );
    tri(
      ring(0.36, R * 0.22, k),
      ring(0.3, R * 0.96, k + 1),
      ring(0.36, R * 0.22, k + 1),
      () => [1, 0, 0],
    );
  }
  // Wind the face outwards: the triangles above face -X for this ring order, so flip them.
  for (let i = 0; i < o.idx.length; i += 3)
    if (isFaceBack(o, i))
      [o.idx[i + 1], o.idx[i + 2]] = [o.idx[i + 2], o.idx[i + 1]];
}

/** True when the triangle at idx[i] winds against its stored normals. */
function isFaceBack(o, i) {
  const [a, b, c] = [0, 1, 2].map((k) => o.idx[i + k] * 3);
  const e1 = [0, 1, 2].map((j) => o.pos[b + j] - o.pos[a + j]);
  const e2 = [0, 1, 2].map((j) => o.pos[c + j] - o.pos[a + j]);
  const f = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  return f[0] * o.nrm[a] + f[1] * o.nrm[a + 1] + f[2] * o.nrm[a + 2] < 0;
}

// --- atlas charts ------------------------------------------------------------------------------

/** Chart rectangles (m) and the projection of a model-space point onto a chart (stl-to-glb.mjs chartUv). */
function atlasOf(A) {
  const b = A.bounds;
  const size = {
    left: [b.z[1] - b.z[0], b.y[1] - b.y[0]],
    right: [b.z[1] - b.z[0], b.y[1] - b.y[0]],
    top: [b.z[1] - b.z[0], b.x[1] - b.x[0]],
    bottom: [b.z[1] - b.z[0], b.x[1] - b.x[0]],
    front: [b.x[1] - b.x[0], b.y[1] - b.y[0]],
    rear: [b.x[1] - b.x[0], b.y[1] - b.y[0]],
  };
  const realBottom = A.charts.bottom[0] + size.bottom[0] <= A.width + 1e-6;
  const project = (chart, [x, y, z]) => {
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
      default:
        return realBottom ? [cx + b.z[1] - z, cy + x - b.x[0]] : [cx, cy];
    }
  };
  /** Chart of a UV (m): the chart whose rectangle holds it, else null. */
  const chartAt = (u, v) => {
    for (const name of Object.keys(size)) {
      if (name === 'bottom' && !realBottom) continue;
      const [cx, cy] = A.charts[name];
      if (
        u >= cx - 1e-4 &&
        u <= cx + size[name][0] + 1e-4 &&
        v >= cy - 1e-4 &&
        v <= cy + size[name][1] + 1e-4
      )
        return name;
    }
    return null;
  };
  return { project, chartAt };
}

/** A body triangle's label: its chart, or `pin:u,v` when all three corners share a texel (arches, flat patches). */
function chartLabel(atlas, A) {
  return (prim, t) => {
    const uv = [0, 1, 2].map((k) => {
      const v = prim.idx[t + k];
      return [prim.uv[v * 2] * A.width, prim.uv[v * 2 + 1] * A.height];
    });
    const same = (a, b) =>
      Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
    if (same(uv[0], uv[1]) && same(uv[1], uv[2]))
      return `pin:${uv[0][0].toFixed(4)},${uv[0][1].toFixed(4)}`;
    const cu = (uv[0][0] + uv[1][0] + uv[2][0]) / 3;
    const cv = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
    return (
      atlas.chartAt(cu, cv) ??
      `pin:${uv[0][0].toFixed(4)},${uv[0][1].toFixed(4)}`
    );
  };
}

const CHART_AXIS = {
  left: [1, 0, 0],
  right: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  rear: [0, 0, -1],
};

function faceNormal(w, ids) {
  const [a, b, c] = ids.map((id) => [
    w.pos[id * 3],
    w.pos[id * 3 + 1],
    w.pos[id * 3 + 2],
  ]);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const f = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(...f) || 1;
  return f.map((x) => x / l);
}

/** A big simplified triangle may sit across charts: if its chart faces away from it, take the facing one. */
function facingChart(label, n) {
  const axis = CHART_AXIS[label];
  if (!axis || axis[0] * n[0] + axis[1] * n[1] + axis[2] * n[2] > 0.4)
    return label;
  let best = label;
  let bestD = -2;
  for (const [name, a] of Object.entries(CHART_AXIS)) {
    const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
    if (d > bestD) [best, bestD] = [name, d];
  }
  return best;
}

// --- GLB writer --------------------------------------------------------------------------------

class Builder {
  constructor() {
    this.views = [];
    this.accessors = [];
    this.chunks = [];
    this.len = 0;
  }
  push(typed, type, componentType, target, normalized = false) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    this.chunks.push(bytes, Buffer.alloc(pad));
    this.views.push({
      buffer: 0,
      byteOffset: this.len,
      byteLength: bytes.length,
      target,
    });
    this.len += bytes.length + pad;
    const n = COMPONENTS[type];
    const a = {
      bufferView: this.views.length - 1,
      componentType,
      count: typed.length / n,
      type,
    };
    if (normalized) a.normalized = true;
    if (type === 'VEC3' && componentType === 5126) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < typed.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], typed[i + k]);
          max[k] = Math.max(max[k], typed[i + k]);
        }
      a.min = min;
      a.max = max;
    }
    this.accessors.push(a);
    return this.accessors.length - 1;
  }
  primitive(mesh, material) {
    const attributes = {
      POSITION: this.push(Float32Array.from(mesh.pos), 'VEC3', 5126, 34962),
      NORMAL: this.push(Float32Array.from(mesh.nrm), 'VEC3', 5126, 34962),
    };
    if (mesh.uv.length)
      attributes.TEXCOORD_0 = this.push(
        Float32Array.from(mesh.uv),
        'VEC2',
        5126,
        34962,
      );
    if (mesh.col.length)
      attributes.COLOR_0 = this.push(
        Uint8Array.from(mesh.col),
        'VEC4',
        5121,
        34962,
        true,
      );
    const big = mesh.pos.length / 3 > 65535;
    const indices = this.push(
      big ? Uint32Array.from(mesh.idx) : Uint16Array.from(mesh.idx),
      'SCALAR',
      big ? 5125 : 5123,
      34963,
    );
    return { attributes, indices, material, mode: 4 };
  }
}

const align4 = (n) => (n + 3) & ~3;

function writeGlb(json, chunks) {
  const js = Buffer.from(JSON.stringify(json));
  const jsPad = Buffer.concat([
    js,
    Buffer.alloc(align4(js.length) - js.length, 0x20),
  ]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsPad.length + 8 + bin.length, 8);
  const chunkHead = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([
    head,
    chunkHead(jsPad.length, 0x4e4f534a),
    jsPad,
    chunkHead(bin.length, 0x004e4942),
    bin,
  ]);
}

// --- one car -----------------------------------------------------------------------------------

async function bakeCar(id) {
  const source = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        'src/games/rally/cars',
        id.replace(/_/g, '-'),
        'model.source.json',
      ),
      'utf8',
    ),
  );
  const A = source.atlas;
  const atlas = atlasOf(A);
  const prims = primitives(readGlb(path.join(DIR, `${id}.glb`)));

  // Everything welded by position: `body` triangles labelled by chart, the other parts by colour.
  const all = new Welded();
  const dropped = new Set();
  let paintTris = 0;
  const chartOf = chartLabel(atlas, A);
  for (const p of prims) {
    if (DROPPED.test(p.name)) {
      dropped.add(p.name);
      continue;
    }
    if (p.name.replace(/:2s$/, '') === 'body') {
      all.add(p, chartOf);
      paintTris += p.idx.length / 3;
    } else all.add(p, `col:${colorOf(p.name)}`);
  }
  const full = { paint: paintTris, parts: all.tris - paintTris };

  const wheel = readGlb(path.join(DIR, `${id}_wheel.glb`));
  const rimPrim = primitives(wheel).find((p) => p.name === 'rim');
  if (!rimPrim) throw new Error(`${id}_wheel.glb has no rim`);
  const rim = new Welded();
  rim.add(rimPrim, 'rim');

  const b = new Builder();
  const meshes = [];
  const nodes = [];
  const stats = [];
  const uvOf = (p, label) => {
    const [u, v] = label.startsWith('pin:')
      ? label.slice(4).split(',').map(Number)
      : atlas.project(label, p);
    return { uv: [u / A.width, v / A.height] };
  };
  for (let l = 0; l < LODS.length; l++) {
    const body = simplify(all, LODS[l].tris, false);
    const shell = new Out();
    const rest = new Out();
    for (const tri of body.tris) {
      if (tri.label.startsWith('col:')) {
        const rgb = hexRgb(tri.label.slice(4));
        rest.tri(all, tri, () => ({ col: rgb }));
      } else
        shell.tri(
          all,
          { ...tri, label: facingChart(tri.label, faceNormal(all, tri.ids)) },
          uvOf,
        );
    }
    meshes.push({
      name: `lod${l}`,
      primitives: [b.primitive(shell, 0), b.primitive(rest, 1)],
    });
    nodes.push({ name: `lod${l}`, mesh: meshes.length - 1 });
    stats.push({
      lod: l,
      paint: shell.idx.length / 3,
      parts: rest.idx.length / 3,
      err: +(body.error * 100).toFixed(1),
    });
  }
  for (let l = 0; l < LODS.length; l++) {
    // LOD 0: the wheel GLB's own rim, simplified; the far LODs: a dished disc in a barrel (spokes are lost on a
    // thin shell anyway: it would not go below ~600 triangles).
    const o = new Out();
    if (l === 0) {
      const r = simplify(rim, LODS[l].rim, false);
      for (const tri of r.tris) o.tri(rim, tri, () => ({}));
    } else rimProxy(o, l === 1 ? 16 : 10);
    meshes.push({ name: `rim${l}`, primitives: [b.primitive(o, 2)] });
    nodes.push({ name: `rim${l}`, mesh: meshes.length - 1 });
    stats[l].rim = o.idx.length / 3;
  }
  const json = {
    asset: {
      version: '2.0',
      generator: 'scripts/car-model/park-lods.mjs',
      extras: { park: { car: id, full, lods: stats } },
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [
      {
        name: 'paint',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.45,
        },
      },
      {
        name: 'parts',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.6,
        },
      },
      {
        name: 'rim',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.2,
          roughnessFactor: 0.45,
        },
      },
    ],
    accessors: b.accessors,
    bufferViews: b.views,
    buffers: [{ byteLength: b.len }],
  };
  const out = path.join(DIR, `${id}_park.glb`);
  const glb = writeGlb(json, b.chunks);
  fs.writeFileSync(out, glb);
  console.log(
    `${id}: source paint ${full.paint} parts ${full.parts} (dropped: ${[...dropped].join(', ') || '-'})`,
  );
  for (const s of stats)
    console.log(
      `  lod${s.lod}: paint ${s.paint} parts ${s.parts} (err ${s.err} units) rim ${s.rim}`,
    );
  console.log(
    `  -> ${path.relative(root, out)} ${(glb.length / 1024).toFixed(0)} KB`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await simp.ready;
  simp.useExperimentalFeatures = true; // the Prune flag
  const cars = process.argv.slice(2).length ? process.argv.slice(2) : PARK_CARS;
  for (const id of cars) await bakeCar(id);
}
