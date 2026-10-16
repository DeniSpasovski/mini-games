/**
 * Bake the parked trucks of the Ajvatovci yards: a tractor + trailer (Low Poly Truck) and a dump truck (Dump Truck),
 * both CC BY 4.0 (credits: THIRD-PARTY.md). The sources are not in the repository. The models' own triangles are kept
 * as they are (welded, nothing simplified) and so are their textures (re-encoded by bake-truck-textures.py).
 *
 *   python scripts/car-model/street-pack-extract.py sources/trucks/low_poly_truck.glb <dir>/low.json --margin 1000 --images <dir>/low
 *   python scripts/car-model/street-pack-extract.py sources/trucks/dump_truck.glb <dir>/dump.json --margin 1000 --images <dir>/dump
 *   python scripts/car-model/bake-truck-textures.py <dir>
 *   node scripts/car-model/bake-trucks.mjs <dir>
 *
 * Output: src/games/rally/maps/ajvatovci/start-row/build/truck-models.data.ts (do not edit by hand).
 * Models face +X, origin on the ground under the middle of the vehicle's footprint (`length`). Per model a list of parts,
 * each a packed mesh (layout: see `pack`) with a role: `cab` / `paint` take the vehicle's cab / body paint where the
 * texture's tint mask says so, `glass` is the glass material, `detail` keeps the texture as it is. Tyres are baked
 * in place, rigid (never stretched with the trailer); `tyre` holds one of each side as a template for the axles the
 * runtime builds itself.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];

/** Rounded to centimetres. */
const r2 = (x) => Math.round(x * 100) / 100;

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

const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const load = (name) => read(`${name}.json`)[0].mesh;
const byNode = (mesh, re) => mesh.filter((m) => re.test(m.node));

/** A mesh is `{pos, uv, idx}` (uv optional). The prims as one mesh, shared vertices welded (position + uv), `xf` applied. */
function meshOf(list, xf = (p) => p) {
  const out = { pos: [], uv: [], idx: [] };
  const map = new Map();
  for (const m of list) {
    const remap = new Map();
    const at = (i) => {
      let j = remap.get(i);
      if (j !== undefined) return j;
      const q = xf(m.pos[i]);
      const key = `${q.map((x) => x.toFixed(4))}|${m.uv[i].map((x) => x.toFixed(4))}`;
      j = map.get(key);
      if (j === undefined) {
        j = out.pos.length;
        map.set(key, j);
        out.pos.push(q);
        out.uv.push(m.uv[i]);
      }
      remap.set(i, j);
      return j;
    };
    for (let t = 0; t < m.idx.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => at(m.idx[t + k]));
      if (a !== b && b !== c && a !== c) out.idx.push(a, b, c);
    }
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

/** The triangles for which `keep(centroid, [p0, p1, p2])` holds. */
function filterTris(m, keep) {
  const out = { pos: [], uv: [], idx: [] };
  const map = new Map();
  for (let t = 0; t < m.idx.length; t += 3) {
    const ids = [0, 1, 2].map((k) => m.idx[t + k]);
    const P = ids.map((i) => m.pos[i]);
    const c = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3);
    if (!keep(c, P)) continue;
    for (const i of ids) {
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

const shifted = (m, dx = 0, dy = 0, dz = 0) => ({
  ...m,
  pos: m.pos.map((p) => [p[0] + dx, p[1] + dy, p[2] + dz]),
});

/** Connected pieces of a prim (vertices that share a position are one), each as its own mesh. */
function pieces(prim, xf) {
  const key = (p) => p.map((x) => Math.round(x * 500)).join(',');
  const parent = new Map();
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  for (const p of prim.pos) if (!parent.has(key(p))) parent.set(key(p), key(p));
  for (let t = 0; t < prim.idx.length; t += 3)
    for (let k = 1; k < 3; k++)
      parent.set(
        find(key(prim.pos[prim.idx[t + k]])),
        find(key(prim.pos[prim.idx[t]])),
      );
  const groups = new Map();
  for (let t = 0; t < prim.idx.length; t += 3) {
    const root = find(key(prim.pos[prim.idx[t]]));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()].map((tris) =>
    meshOf(
      [
        {
          pos: prim.pos,
          uv: prim.uv,
          idx: tris.flatMap((t) => [
            prim.idx[t],
            prim.idx[t + 1],
            prim.idx[t + 2],
          ]),
        },
      ],
      xf,
    ),
  );
}

/**
 * Layout of a pack (base64, little endian): u16 vertex count, u8 flags (1 = uv), u8 0, f32 min xyz + f32 size xyz,
 * with uv: f32 min uv + f32 size uv, then u16 xyz per vertex, with uv u16 uv per vertex, u32 index count + u16 indices.
 */
function pack(m) {
  if (!m.idx.length) return '';
  const withUv = m.uv && m.uv.length === m.pos.length;
  const { lo, hi } = bounds(m.pos);
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  const uvLo = [0, 1].map((k) => Math.min(...m.uv.map((u) => u[k])));
  const uvSize = [0, 1].map((k) =>
    Math.max(Math.max(...m.uv.map((u) => u[k])) - uvLo[k], 1e-6),
  );
  const head = Buffer.alloc(withUv ? 44 : 28);
  head.writeUInt16LE(m.pos.length, 0);
  head.writeUInt8(withUv ? 1 : 0, 2);
  lo.forEach((x, k) => head.writeFloatLE(x, 4 + k * 4));
  size.forEach((x, k) => head.writeFloatLE(x, 16 + k * 4));
  if (withUv) {
    uvLo.forEach((x, k) => head.writeFloatLE(x, 28 + k * 4));
    uvSize.forEach((x, k) => head.writeFloatLE(x, 36 + k * 4));
  }
  const pb = Buffer.alloc(m.pos.length * 6);
  m.pos.forEach((p, i) =>
    p.forEach((x, k) =>
      pb.writeUInt16LE(
        Math.round(((x - lo[k]) / size[k]) * 65535),
        i * 6 + k * 2,
      ),
    ),
  );
  const ub = Buffer.alloc(withUv ? m.uv.length * 4 : 0);
  if (withUv)
    m.uv.forEach((u, i) =>
      u.forEach((x, k) =>
        ub.writeUInt16LE(
          Math.round(((x - uvLo[k]) / uvSize[k]) * 65535),
          i * 4 + k * 2,
        ),
      ),
    );
  const ib = Buffer.alloc(4 + m.idx.length * 2);
  ib.writeUInt32LE(m.idx.length, 0);
  m.idx.forEach((x, i) => ib.writeUInt16LE(x, 4 + i * 2));
  return Buffer.concat([head, pb, ub, ib]).toString('base64');
}

const part = (id, role, tex, mesh) => ({
  id,
  role,
  ...(tex ? { tex } : {}),
  data: pack(tex ? mesh : { ...mesh, uv: [] }),
});

const out = {};
const tyreSize = (m) => {
  const { lo, hi } = bounds(m.pos);
  return { r: r2((hi[1] - lo[1]) / 2), w: r2(hi[2] - lo[2]) };
};

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
  /** Footprint length (m). */
  L: 17.5,
};

{
  const mesh = load('low');
  const { L } = LOW;
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
  const body = meshOf(byNode(mesh, /^Truck_Body_0$/), (p) => place(p, false));
  const glass = meshOf(byNode(mesh, /^model_97/), (p) => place(p, false));
  const trailer = meshOf(byNode(mesh, /backside/), (p) => place(p, true));
  /** A tyre keeps its shape and size (rigid), only its middle follows the stretched trailer. */
  const tyres = byNode(mesh, /_Tires_0$/).map((m) => {
    const { lo, hi } = bounds(m.pos);
    const c = lo.map((l, k) => (l + hi[k]) / 2);
    const trailerWheel = c[2] < -5;
    const at = place(c, trailerWheel);
    const base = place(c, false);
    return {
      trailerWheel,
      mesh: meshOf([m], (p) => {
        const q = place(p, false);
        return [
          q[0] - base[0] + at[0],
          q[1] - base[1] + at[1],
          q[2] - base[2] + at[2],
        ];
      }),
    };
  });
  const tractorTyres = tyres.filter((t) => !t.trailerWheel).map((t) => t.mesh);
  const trailerTyres = tyres.filter((t) => t.trailerWheel).map((t) => t.mesh);
  const cabMask = (c) => c[0] > L / 2 - (LOW.frontZ - LOW.cabCut) * LOW.s;
  const mid = (m) => bounds(m.pos);
  const middle = (m, k) => (mid(m).lo[k] + mid(m).hi[k]) / 2;

  out.tractor = {
    length: L,
    width: 2.6,
    parts: [
      part('body', 'cab', 'lowBody', body),
      part('glass', 'glass', null, glass),
      part('tyres', 'detail', 'lowTyre', merge(tractorTyres)),
    ],
  };
  out.trailer = {
    length: L,
    width: 2.6,
    parts: [
      part('body', 'paint', 'lowTrailer', trailer),
      part('tyres', 'detail', 'lowTyre', merge(trailerTyres)),
    ],
  };

  // The cab alone, for the rigid box truck: what is in front of the cut, without the chassis behind the cab.
  const shift = 4.6 - L / 2;
  const cabOnly = (m) =>
    filterTris(
      m,
      (c, P) =>
        cabMask(c) &&
        P.every((p) => cabMask([p[0] + 0.15])) &&
        !(c[1] < 0.75 && c[0] < L / 2 - 0.7),
    );
  out.cab = {
    length: 9.2,
    width: 2.6,
    parts: [
      part('body', 'cab', 'lowBody', shifted(cabOnly(body), shift)),
      part(
        'glass',
        'glass',
        null,
        shifted(
          filterTris(glass, (c) => cabMask(c)),
          shift,
        ),
      ),
      part(
        'tyres',
        'detail',
        'lowTyre',
        shifted(
          merge(tractorTyres.filter((t) => middle(t, 0) > L / 2 - 2.5)),
          shift,
        ),
      ),
    ],
    cabBack: r2(L / 2 - (LOW.frontZ - LOW.cabCut) * LOW.s + shift),
  };

  // One tyre of each side, centred, for the axles the runtime builds itself (trailer tyres: r ~ 0.46 m).
  const templates = trailerTyres.filter(
    (t, _i, all) => Math.abs(middle(t, 0) - middle(all[0], 0)) < 0.05,
  );
  const side = (t) => Math.sign(middle(t, 2));
  const tpl = (t) => shifted(t, -middle(t, 0), -middle(t, 1), -middle(t, 2));
  const pos = templates.find((t) => side(t) > 0);
  const neg = templates.find((t) => side(t) < 0);
  out.tyre = {
    length: 0,
    width: 0,
    ...tyreSize(pos),
    parts: [
      part('pos', 'detail', 'lowTyre', tpl(pos)),
      part('neg', 'detail', 'lowTyre', tpl(neg)),
    ],
  };
}

// ----- Dump truck -----

{
  const mesh = load('dump');
  const S = 1.2;
  const midZ = (-2.987 + 2.829) / 2;
  const place = (p) => [(p[2] - midZ) * S, p[1] * S, -p[0] * S];
  const L = r2((2.829 + 2.987) * S);
  const cabShell = meshOf(byNode(mesh, /B_01\.1/), place);
  const frame = meshOf(byNode(mesh, /dumb_truck_B_01_0$/), place);
  // The cab's interior is behind dark glass; what stays is outside the cab's width (mirrors and their arms).
  const fittings = filterTris(
    meshOf(byNode(mesh, /dump_truck_D_01/), place),
    (c) => Math.abs(c[2]) > 1.1,
  );
  const dumper = meshOf(byNode(mesh, /dump_truck_A_01/), place);
  const tyres = pieces(byNode(mesh, /dump_truck_E_01/)[0], place);
  const lamp = meshOf(byNode(mesh, /lamp_glass/), place);
  const lens = filterTris(lamp, (c) => c[1] < 1.2);
  const windows = filterTris(lamp, (c) => c[1] >= 1.2);
  // Cab = in front of the dumper's front (model z > 1.2).
  const cabBack = (1.2 - midZ) * S;
  console.log('dump tyres', tyres.length, 'cab tris', cabShell.idx.length / 3);
  out.dump = {
    length: L,
    width: 2.6,
    parts: [
      part('cab', 'cab', 'dumpDirt', cabShell),
      part('frame', 'detail', 'dumpDirt', merge([frame, fittings])),
      part('dumper', 'paint', 'dumpYellow', dumper),
      part('tyres', 'detail', 'dumpTyre', merge(tyres)),
      part('lens', 'detail', null, lens),
      part('glass', 'glass', null, windows),
    ],
    cabBack: r2(cabBack),
    rear: r2(bounds(frame.pos).lo[0]),
    deck: r2(bounds(frame.pos).hi[1]),
  };
}

const textures = read('textures.json');
const file =
  'src/games/rally/maps/ajvatovci/start-row/build/truck-models.data.ts';
const ts = `// Generated by scripts/car-model/bake-trucks.mjs from the CC BY models credited in THIRD-PARTY.md. Do not edit.
/** How a part is drawn: \`cab\` / \`paint\` take the cab / body paint where the texture's tint mask says so. */
export type TruckRole = 'cab' | 'paint' | 'glass' | 'detail';

export interface TruckPartData {
  id: string;
  role: TruckRole;
  /** Key in TRUCK_TEXTURES; none = flat, no uv. */
  tex?: string;
  /** Packed mesh (layout: see the baker). */
  data: string;
}

export interface TruckTexture {
  /** Data URIs: the colour map (jpeg) and the tint mask (png, white = takes the paint colour; none = all of it). */
  map: string;
  mask?: string;
  /** Linear luminance of the brightest panels: the tint is scaled by texel / ref. */
  ref: number;
}

export interface TruckData {
  /** Footprint (m); the model's origin is under its middle. */
  length: number;
  width: number;
  parts: TruckPartData[];
  /** Dump truck / cab only: x of the cab's back wall, the frame's rear end and its top (m). */
  cabBack?: number;
  rear?: number;
  deck?: number;
  /** Tyre templates: radius and width (m). */
  r?: number;
  w?: number;
}

export const TRUCK_TEXTURES: Record<string, TruckTexture> = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(textures).map(([k, v]) => [
      k,
      { map: v.map, ...(v.mask ? { mask: v.mask } : {}), ref: v.ref },
    ]),
  ),
  null,
  2,
)};

export const TRUCK_DATA: Record<'tractor' | 'trailer' | 'cab' | 'dump' | 'tyre', TruckData> = ${JSON.stringify(out, null, 2)};
`;
if (process.env.SHEET)
  fs.writeFileSync(process.env.SHEET, JSON.stringify({ data: out, textures }));
fs.writeFileSync(file, ts);
console.log('wrote', (ts.length / 1024).toFixed(0), 'KB');
for (const [k, v] of Object.entries(out))
  console.log(
    k,
    v.parts
      .map((p) => `${p.id} ${(p.data.length / 1024).toFixed(0)}KB`)
      .join(', '),
  );
