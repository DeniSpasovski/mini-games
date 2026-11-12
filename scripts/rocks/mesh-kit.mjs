/**
 * Mesh helpers of the rock bakes (scripts/rocks/bake-outcrops.mjs): read a glTF primitive, simplify to triangle budgets
 * (meshoptimizer; the far level vertex-clustered where the simplifier stops short on an open scan) and pack.
 *
 * Packed mesh (little endian, base64): u16 vertex count, u16 0, then per vertex i16 x3 position (/ `unit`), i8 x3
 * normal, u16 x2 uv (/ 65535), then u16 indices.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;

const SIZE = { 5126: 4, 5123: 2, 5125: 4 };
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3 };

/** The first primitive of a glTF file's first mesh: position, normal, uv, indices. */
export function readPrimitive(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bin = fs.readFileSync(path.join(path.dirname(file), g.buffers[0].uri));
  const acc = (i) => {
    const a = g.accessors[i];
    const v = g.bufferViews[a.bufferView];
    const n = COMP[a.type];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = v.byteStride ?? n * SIZE[a.componentType];
    const T =
      a.componentType === 5126
        ? Float32Array
        : a.componentType === 5125
          ? Uint32Array
          : Uint16Array;
    const out = new T(a.count * n);
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        const o = off + k * stride + c * SIZE[a.componentType];
        out[k * n + c] =
          a.componentType === 5126
            ? bin.readFloatLE(o)
            : a.componentType === 5125
              ? bin.readUInt32LE(o)
              : bin.readUInt16LE(o);
      }
    return out;
  };
  const prim = g.meshes[0].primitives[0];
  return {
    pos: Float32Array.from(acc(prim.attributes.POSITION)),
    nor: Float32Array.from(acc(prim.attributes.NORMAL)),
    uv: Float32Array.from(acc(prim.attributes.TEXCOORD_0)),
    idx: Uint32Array.from(acc(prim.indices)),
  };
}

/** Packs the vertices the indices use (positions / `unit`, so |x| < 32767 / unit). */
export function pack(pos, nor, uv, idx, unit) {
  const map = new Map();
  const vi = [];
  const ni = new Uint16Array(idx.length);
  idx.forEach((v, k) => {
    if (!map.has(v)) {
      map.set(v, vi.length);
      vi.push(v);
    }
    ni[k] = map.get(v);
  });
  const n = vi.length;
  if (n > 65535) throw new Error(`too many vertices: ${n}`);
  const buf = Buffer.alloc(4 + n * (6 + 3 + 4) + ni.length * 2);
  let o = 0;
  buf.writeUInt16LE(n, o);
  o += 4;
  for (const v of vi) {
    for (let c = 0; c < 3; c++) {
      buf.writeInt16LE(Math.round(pos[v * 3 + c] * unit), o);
      o += 2;
    }
    for (let c = 0; c < 3; c++)
      buf.writeInt8(Math.round(nor[v * 3 + c] * 127), o++);
    for (let c = 0; c < 2; c++) {
      buf.writeUInt16LE(
        Math.round(Math.min(1, Math.max(0, uv[v * 2 + c])) * 65535),
        o,
      );
      o += 2;
    }
  }
  for (const i of ni) {
    buf.writeUInt16LE(i, o);
    o += 2;
  }
  return { b64: buf.toString('base64'), tris: ni.length / 3 };
}

/**
 * Vertex clustering on a `res`^3 grid over the mesh's box: corners move to their cell's first vertex but keep their own
 * normal and uv (so seams stay clean); collapsed and repeated triangles drop out.
 */
function cluster(pos, nor, uv, idx, res) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < pos.length / 3; v++)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], pos[v * 3 + c]);
      hi[c] = Math.max(hi[c], pos[v * 3 + c]);
    }
  const cell = new Map();
  const rep = new Uint32Array(pos.length / 3);
  for (let v = 0; v < rep.length; v++) {
    const k = [0, 1, 2]
      .map((c) =>
        Math.min(
          res - 1,
          Math.floor(((pos[v * 3 + c] - lo[c]) / (hi[c] - lo[c] || 1)) * res),
        ),
      )
      .join(',');
    if (!cell.has(k)) cell.set(k, v);
    rep[v] = cell.get(k);
  }
  const [P, N, U, I] = [[], [], [], []];
  const corners = new Map();
  const seen = new Set();
  const corner = (v) => {
    const k = `${rep[v]}:${v}`;
    if (!corners.has(k)) {
      corners.set(k, P.length / 3);
      P.push(...pos.subarray(rep[v] * 3, rep[v] * 3 + 3));
      N.push(...nor.subarray(v * 3, v * 3 + 3));
      U.push(...uv.subarray(v * 2, v * 2 + 2));
    }
    return corners.get(k);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (rep[a] === rep[b] || rep[b] === rep[c] || rep[a] === rep[c]) continue;
    const key = [rep[a], rep[b], rep[c]].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    I.push(corner(a), corner(b), corner(c));
  }
  return [
    Float32Array.from(P),
    Float32Array.from(N),
    Float32Array.from(U),
    Uint32Array.from(I),
  ];
}

function simplify(idx, pos, tris) {
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, tris * 3, 0.05, []);
  for (const err of [0.2, 1])
    if (out.length > tris * 3 * 1.3)
      [out] = MeshoptSimplifier.simplify(idx, pos, 3, tris * 3, err, []);
  return out;
}

/**
 * The levels of detail of one mesh (packed): each simplified from the full mesh, the last from the level before it
 * (or vertex-clustered where the simplifier stops short: open scans keep their borders).
 */
export function lodChain(pos, nor, uv, idx, budgets, unit) {
  let prev;
  return budgets.map((tris, k) => {
    if (k === budgets.length - 1 && prev) {
      const out = simplify(prev, pos, tris);
      let mesh = [pos, nor, uv, out];
      for (let res = 12; mesh[3].length > tris * 3 * 1.5 && res >= 2; res--)
        mesh = cluster(pos, nor, uv, prev, res);
      return pack(...mesh, unit);
    }
    const out = simplify(idx, pos, tris);
    prev = out;
    return pack(pos, nor, uv, out, unit);
  });
}
