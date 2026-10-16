/**
 * Bake the parked trucks of the Ajvatovci yards: a tractor + trailer (Low Poly Truck) and a dump truck (Dump Truck),
 * both CC BY 4.0 (credits: THIRD-PARTY.md). The sources are not in the repository.
 *
 *   python scripts/car-model/street-pack-extract.py sources/trucks/low_poly_truck.glb <dir>/low.json --margin 1000
 *   python scripts/car-model/street-pack-extract.py sources/trucks/dump_truck.glb <dir>/dump.json --margin 1000
 *   node scripts/car-model/bake-trucks.mjs <dir>
 *
 * Output: src/games/rally/maps/ajvatovci/start-row/build/truck-models.data.ts (do not edit by hand).
 * Models face +X, origin on the ground under the middle of the vehicle's footprint (`length`). Per part a packed mesh
 * (layout: see `pack`); the wheels are not baked, their size and place are listed so the runtime draws its own tyres.
 * Parts: `cab` / `paint` are recoloured per vehicle (cab paint / body paint), `glass`, `detail` keeps its baked colours.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = process.argv[2];
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c) => Math.max(...c) - Math.min(...c);

/** A mesh as `{pos, col, idx}`; `merge` / `weld` / `simplify` work on these. */
const empty = () => ({ pos: [], col: [], idx: [] });

function merge(list) {
  const out = empty();
  for (const m of list) {
    const base = out.pos.length;
    out.pos.push(...m.pos);
    out.col.push(...m.col);
    out.idx.push(...m.idx.map((i) => i + base));
  }
  return out;
}

/** Keep the triangles for which `keep(centroid, colours, normal)` is true. */
function filterTris(m, keep) {
  const out = empty();
  const map = new Map();
  for (let t = 0; t < m.idx.length; t += 3) {
    const ids = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    const P = ids.map((i) => m.pos[i]);
    const C = ids.map((i) => m.col[i]);
    const c = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3);
    const e1 = P[1].map((x, k) => x - P[0][k]);
    const e2 = P[2].map((x, k) => x - P[0][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(...n) || 1;
    if (
      !keep(
        c,
        C,
        n.map((x) => x / len),
        P,
      )
    )
      continue;
    for (const i of ids) {
      let j = map.get(i);
      if (j === undefined) {
        j = out.pos.length;
        map.set(i, j);
        out.pos.push(m.pos[i]);
        out.col.push(m.col[i]);
      }
      out.idx.push(j);
    }
  }
  return out;
}

function weld(m) {
  const map = new Map();
  const out = empty();
  const remap = new Array(m.pos.length);
  m.pos.forEach((p, i) => {
    const k = `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)},${m.col[i].join(',')}`;
    let j = map.get(k);
    if (j === undefined) {
      j = out.pos.length;
      map.set(k, j);
      out.pos.push(p);
      out.col.push(m.col[i]);
    }
    remap[i] = j;
  });
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = remap[m.idx[t]];
    const b = remap[m.idx[t + 1]];
    const c = remap[m.idx[t + 2]];
    if (a !== b && b !== c && a !== c) out.idx.push(a, b, c);
  }
  return out;
}

function simplify(w, tris, options = []) {
  if (!w.idx.length || w.idx.length / 3 <= tris) return w;
  const P = new Float32Array(w.pos.flat());
  const A = new Float32Array(
    w.col.flatMap((c) => [c[0] / 255, c[1] / 255, c[2] / 255]),
  );
  const [res] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(w.idx),
    P,
    3,
    A,
    3,
    [0.35, 0.35, 0.35],
    null,
    tris * 3,
    0.05,
    options,
  );
  const keep = new Map();
  const out = empty();
  for (const v of res) {
    let j = keep.get(v);
    if (j === undefined) {
      j = out.pos.length;
      keep.set(v, j);
      out.pos.push(w.pos[v]);
      out.col.push(w.col[v]);
    }
    out.idx.push(j);
  }
  return out;
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

/** Layout of a pack (base64): u16 vertex count, u16 0, f32 min xyz + f32 size xyz, u16 xyz per vertex, u8 rgb per vertex, u32 index count + u16 indices. */
function pack(m) {
  if (!m.idx.length) return '';
  const { lo, hi } = bounds(m.pos);
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
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
  const cb = Buffer.from(m.col.flat());
  const ib = Buffer.alloc(4 + m.idx.length * 2);
  ib.writeUInt32LE(m.idx.length, 0);
  m.idx.forEach((x, i) => ib.writeUInt16LE(x, 4 + i * 2));
  return Buffer.concat([head, pb, cb, ib]).toString('base64');
}

const load = (name) => {
  const v = JSON.parse(
    fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'),
  )[0];
  return v.mesh;
};
const byNode = (mesh, re) => mesh.filter((m) => re.test(m.node));
/** Near-identical dark greys (a noisy texture) to one grey, so the simplifier can merge their faces. */
const snapGrey = (c) =>
  lum(c) < 100 && chroma(c) < 14
    ? c.map(() => Math.round(lum(c) / 16) * 16)
    : c;
const snapCoarse = (c) => c.map((x) => Math.round(x / 16) * 16);
/** The prims as one welded mesh, a colour per triangle (sampled at the middle of its UVs by the extractor). */
const asMesh = (list, snap = null) =>
  weld(
    merge(
      list.map((m) => {
        const out = empty();
        for (let t = 0; t < m.idx.length; t += 3)
          for (let k = 0; k < 3; k++) {
            out.pos.push(m.pos[m.idx[t + k]]);
            out.col.push(snap ? snap(m.tcol[t / 3]) : m.tcol[t / 3]);
            out.idx.push(t + k);
          }
        return out;
      }),
    ),
  );
/** Rounded to centimetres. */
const r2 = (x) => Math.round(x * 100) / 100;

/** The tyre of a wheel mesh: its middle, radius, width and the side its outer face looks to (-1 / +1 in z). */
function wheelSpec(pos, map) {
  const q = pos.map(map);
  const { lo, hi } = bounds(q);
  const size = hi.map((h, k) => h - lo[k]);
  const c = lo.map((l, k) => (l + hi[k]) / 2);
  return {
    x: r2(c[0]),
    y: r2(c[1]),
    z: r2(c[2]),
    r: r2(Math.max(size[0], size[1]) / 2),
    w: r2(size[2]),
  };
}

// ----- Tractor + trailer (Low Poly Truck) -----

const LOW = {
  /** Scale (cab width -> 2.6 m), the model's front / ground / middle. */
  s: 0.72,
  frontZ: 4.65,
  groundY: 0.349,
  midX: 8.35,
  /** The trailer's front end and the stretch of its length. */
  trailerZ: 1.22,
  stretch: 1.27,
  /** Cab / chassis cut (model z): in front of it the cab, behind it the frame. */
  cabCut: 0.6,
};

function bakeLow() {
  const mesh = load('low');
  const L = 17.5;
  const place = (p, stretched) => {
    const z = stretched
      ? LOW.trailerZ + (p[2] - LOW.trailerZ) * LOW.stretch
      : p[2];
    return [
      (z - LOW.frontZ) * LOW.s + L / 2,
      (p[1] - LOW.groundY) * LOW.s,
      -(p[0] - LOW.midX) * LOW.s,
    ];
  };
  const body = asMesh(byNode(mesh, /^Truck_Body_0$/));
  const tractor = { ...body, pos: body.pos.map((p) => place(p, false)) };
  const glass = asMesh(byNode(mesh, /^model_97/));
  const glassG = { ...glass, pos: glass.pos.map((p) => place(p, false)) };
  const trailerSrc = asMesh(byNode(mesh, /backside/));
  const trailer = {
    ...trailerSrc,
    pos: trailerSrc.pos.map((p) => place(p, true)),
  };
  const wheels = byNode(mesh, /_Tires_0$/).map((m) => {
    const trailerWheel =
      m.pos.reduce((a, p) => a + p[2], 0) / m.pos.length < -5;
    return {
      trailer: trailerWheel,
      ...wheelSpec(m.pos, (p) => place(p, trailerWheel)),
    };
  });
  return { tractor, glassG, trailer, wheels, L };
}

/** Paint = light neutral texels (the cab's white panels). */
const isLightPaint = (cols, min) => {
  const m = [0, 1, 2].map((k) => (cols[0][k] + cols[1][k] + cols[2][k]) / 3);
  return lum(m) >= min && chroma(m) < 28;
};

function split(m, isPaint) {
  return [
    filterTris(m, (c, C, n, P) => isPaint(C, c, P, n)),
    filterTris(m, (c, C, n, P) => !isPaint(C, c, P, n)),
  ];
}

/** The triangles of \`m\` for which \`hit(centroid, normal)\` holds, in one flat colour (rgb 0-255). */
function recolor(m, hit, rgb) {
  const out = empty();
  for (let t = 0; t < m.idx.length; t += 3) {
    const ids = [0, 1, 2].map((k) => m.idx[t + k]);
    const P = ids.map((i) => m.pos[i]);
    const c = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3);
    const e1 = P[1].map((x, k) => x - P[0][k]);
    const e2 = P[2].map((x, k) => x - P[0][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(...n) || 1;
    const flat = hit(
      c,
      n.map((x) => x / len),
    );
    for (const i of ids) {
      out.idx.push(out.pos.length);
      out.pos.push(m.pos[i]);
      out.col.push(flat ? rgb : m.col[i]);
    }
  }
  return weld(out);
}

const area = (P) => {
  const e1 = P[1].map((x, k) => x - P[0][k]);
  const e2 = P[2].map((x, k) => x - P[0][k]);
  return (
    0.5 *
    Math.hypot(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    )
  );
};
/** A stray warm brown texel (dirt) on a panel. */
const isDirtTexel = (c) =>
  c[0] > c[1] && c[1] > c[2] && chroma(c) > 15 && chroma(c) < 60;
/** Light panels, and the big dark triangles of the body's skin (UVs in an unused corner of the texture; real trim is small). */
const isBodyPaint = (C, c, P, min) =>
  isLightPaint(C, min) ||
  isDirtTexel(C[0]) ||
  (lum(C[0]) < min && area(P) > 0.05 && c[1] > 0.4);

/** An axis-aligned box as a mesh in one flat colour (rgb 0-255). */
function boxMesh(a, b, col) {
  const out = empty();
  const [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  for (const f of faces) {
    const base = out.pos.length;
    for (const i of f) {
      out.pos.push(v[i]);
      out.col.push(col);
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}

/** The lower front of the tractor cab: grille, head lamps, indicators, number plate (x = the front face). */
function frontDetails(x) {
  const dark = [28, 30, 33];
  const lamp = [238, 243, 246];
  const amber = [243, 154, 30];
  const list = [boxMesh([x, 1.3, -0.68], [x + 0.03, 1.78, 0.68], dark)];
  for (const y of [1.42, 1.54, 1.66])
    list.push(
      boxMesh([x + 0.03, y, -0.6], [x + 0.05, y + 0.04, 0.6], [70, 74, 80]),
    );
  for (const s of [1, -1]) {
    const z0 = s > 0 ? 0.86 : -1.22;
    list.push(boxMesh([x, 1.3, z0], [x + 0.05, 1.6, z0 + 0.36], lamp));
    const a0 = s > 0 ? 0.86 : -1.0;
    list.push(boxMesh([x, 1.65, a0], [x + 0.05, 1.78, a0 + 0.14], amber));
  }
  list.push(boxMesh([x, 0.62, -0.3], [x + 0.04, 0.82, 0.3], [235, 235, 220]));
  return merge(list);
}

const out = {};

{
  const low = bakeLow();
  const cabMask = (c) => c[0] > low.L / 2 - (LOW.frontZ - LOW.cabCut) * LOW.s;
  // Split by colour first and simplify each half with its border locked, so the paint edge stays where the texture has it.
  const [rp, rf] = split(weld(low.tractor), (C, c, P) =>
    isBodyPaint(C, c, P, 85),
  );
  const [tp, tf] = [
    simplify(weld(rp), 2400, ['LockBorder']),
    simplify(weld(rf), 2600, ['LockBorder']),
  ];
  const cabOnly = (m) =>
    filterTris(
      m,
      (c, _C, _n, P) =>
        cabMask(c) &&
        P.every((p) => cabMask([p[0] + 0.15])) &&
        !(c[1] < 0.75 && c[0] < low.L / 2 - 0.7),
    );
  const front = frontDetails(low.L / 2 - 0.1);
  const tractor = { paint: tp, fixed: merge([tf, front]) };
  // The trailer's texture is sampled at the corners of big panels (dark frame texels): paint = the box above the frame.
  const trp = filterTris(low.trailer, (c) => c[1] > 1.25);
  const trf = filterTris(low.trailer, (c) => c[1] <= 1.25);
  const trailer = {
    paint: simplify(weld(trp), 900),
    fixed: simplify(weld(trf), 1000),
  };
  const glass = low.glassG;
  out.tractor = {
    length: low.L,
    width: 2.6,
    cab: pack(tractor.paint),
    detail: pack(tractor.fixed),
    paint: '',
    glass: pack(glass),
    wheels: low.wheels.filter((w) => !w.trailer),
  };
  out.trailer = {
    length: low.L,
    width: 2.6,
    cab: '',
    detail: pack(trailer.fixed),
    paint: pack(trailer.paint),
    glass: '',
    wheels: low.wheels.filter((w) => w.trailer),
  };
  // The cab alone, for the rigid box truck.
  // Cut before simplifying: a simplified triangle can span the cut and leave a long sliver behind the cab.
  const cp = simplify(weld(cabOnly(weld(rp))), 2000, ['LockBorder']);
  const cf = merge([
    simplify(weld(cabOnly(weld(rf))), 2200, ['LockBorder']),
    front,
  ]);
  const shift = 4.6 - low.L / 2;
  const sh = (m) => ({
    ...m,
    pos: m.pos.map((p) => [p[0] + shift, p[1], p[2]]),
  });
  const cg = filterTris(glass, (c) => cabMask(c));
  out.cab = {
    length: 9.2,
    width: 2.6,
    cab: pack(sh(cp)),
    detail: pack(sh(cf)),
    paint: '',
    glass: pack(sh(cg)),
    wheels: low.wheels
      .filter((w) => !w.trailer && w.x > low.L / 2 - 2.5)
      .map((w) => ({ ...w, x: r2(w.x + shift) })),
    cabBack: r2(low.L / 2 - (LOW.frontZ - LOW.cabCut) * LOW.s + shift),
  };
}

// ----- Dump truck -----

{
  const mesh = load('dump');
  const S = 1.2;
  const midZ = (-2.987 + 2.829) / 2;
  const place = (p) => [(p[2] - midZ) * S, p[1] * S, -p[0] * S];
  const L = r2((2.829 + 2.987) * S);
  const wheels = [];
  const toGame = (m) => ({ ...m, pos: m.pos.map(place) });
  const base = asMesh(
    byNode(mesh, /dumb_truck_B_01|dump_truck_[DE]_01/),
    snapGrey,
  );
  // Wheels: components of the welded positions that are round and short in the axle direction (x).
  const keyOf = (p) => p.map((x) => Math.round(x * 500)).join(',');
  const parent = new Map();
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  for (let i = 0; i < base.pos.length; i++) {
    const k = keyOf(base.pos[i]);
    if (!parent.has(k)) parent.set(k, k);
  }
  for (let t = 0; t < base.idx.length; t += 3) {
    const ks = [0, 1, 2].map((q) => keyOf(base.pos[base.idx[t + q]]));
    for (let q = 1; q < 3; q++) parent.set(find(ks[q]), find(ks[0]));
  }
  const comps = new Map();
  base.pos.forEach((p, i) => {
    const root = find(keyOf(p));
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root).push(i);
  });
  const isWheel = new Set();
  for (const ids of comps.values()) {
    const { lo, hi } = bounds(ids.map((i) => base.pos[i]));
    const d = hi.map((h, k) => h - lo[k]);
    const big = Math.max(d[1], d[2]);
    if (
      big > 0.55 &&
      big < 1.0 &&
      Math.abs(d[1] - d[2]) < 0.2 * big &&
      d[0] < 0.8 * big &&
      lo[1] < 0.15
    ) {
      for (const i of ids) isWheel.add(i);
      const c = lo.map((l, k) => (l + hi[k]) / 2);
      const g = place(c);
      wheels.push({
        x: r2(g[0]),
        y: r2(g[1]),
        z: r2(g[2]),
        r: r2((big / 2) * S),
        w: r2(d[0] * S),
      });
    }
  }
  console.log('dump wheels', wheels.length, JSON.stringify(wheels));
  const noWheels = filterTris(base, (_c, _C) => true);
  // Drop the wheel triangles (all three vertices in a wheel component).
  const body = empty();
  const bmap = new Map();
  for (let t = 0; t < base.idx.length; t += 3) {
    const ids = [base.idx[t], base.idx[t + 1], base.idx[t + 2]];
    if (isWheel.has(ids[0])) continue;
    for (const i of ids) {
      let j = bmap.get(i);
      if (j === undefined) {
        j = body.pos.length;
        bmap.set(i, j);
        body.pos.push(base.pos[i]);
        body.col.push(base.col[i]);
      }
      body.idx.push(j);
    }
  }
  void noWheels;
  const g = toGame(body);
  // Cab = in front of the dumper's front (model z > 1.2).
  const cabZ = (1.2 - midZ) * S;
  const inCab = (c) => c[0] > cabZ && c[1] > 0.7;
  const cabAll = filterTris(g, (c) => inCab(c));
  const frame = filterTris(g, (c) => !inCab(c));
  // The grille panel and the lower front are trim: dark, not cab paint.
  const front = bounds(cabAll.pos).hi[0];
  const isGrille = (c, n) =>
    c[0] > front - 0.3 &&
    c[1] > 0.95 &&
    c[1] < 1.5 &&
    Math.abs(c[2]) < 0.9 &&
    n[0] > 0.5;
  const [cpAll, cfRaw] = split(
    weld(cabAll),
    (C, c, P, n) => !isGrille(c, n) && isBodyPaint(C, c, P, 45),
  );
  const cfAll = recolor(cfRaw, isGrille, [44, 46, 48]);
  const cp = simplify(cpAll, 4500, ['LockBorder']);
  const cf = simplify(cfAll, 3500, ['LockBorder']);
  const glass = toGame(asMesh(byNode(mesh, /lamp_glass/)));
  const dumper = toGame(asMesh(byNode(mesh, /dump_truck_A_01/), snapCoarse));
  const rear = bounds(frame.pos).lo[0];
  const deck = bounds(frame.pos).hi[1];
  out.dump = {
    length: L,
    width: 2.6,
    cab: pack(cp),
    detail: pack(merge([cf, simplify(weld(frame), 3400)])),
    paint: pack(simplify(dumper, 3800)),
    glass: pack(simplify(weld(glass), 120)),
    wheels,
    cabBack: r2(cabZ),
    rear: r2(rear),
    deck: r2(deck),
  };
}

const file =
  'src/games/rally/maps/ajvatovci/start-row/build/truck-models.data.ts';
const ts = `// Generated by scripts/car-model/bake-trucks.mjs from the CC BY models credited in THIRD-PARTY.md. Do not edit.
export interface TruckWheel {
  x: number;
  y: number;
  z: number;
  /** Radius and tyre width (m). */
  r: number;
  w: number;
  /** Wheel of the trailer (tractor + trailer model). */
  trailer?: boolean;
}

export interface TruckData {
  /** Footprint (m); the model's origin is under its middle. */
  length: number;
  width: number;
  /** Packed meshes (layout: see the baker). \`cab\`, \`paint\`: recoloured per vehicle. */
  cab: string;
  paint: string;
  glass: string;
  detail: string;
  wheels: TruckWheel[];
  /** Dump truck / cab only: x of the cab's back wall, the frame's rear end and its top (m). */
  cabBack?: number;
  rear?: number;
  deck?: number;
}

export const TRUCK_DATA: Record<'tractor' | 'trailer' | 'cab' | 'dump', TruckData> = ${JSON.stringify(out, null, 2)};
`;
if (process.env.SHEET) fs.writeFileSync(process.env.SHEET, JSON.stringify(out));
fs.writeFileSync(file, ts);
console.log('wrote', (ts.length / 1024).toFixed(0), 'KB');
