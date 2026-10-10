/**
 * Bake vertex ambient occlusion into a car GLB: a float `_DARK` attribute (0 = open, 1 = fully occluded) on every
 * primitive. The game reads it as `geometry.attributes._dark` (cars/shared/vertex-ao.ts) and dims the ambient, sky and
 * reflection light there, so fender slots, wheel arches, grilles and the underbody stop glowing.
 *
 *   node scripts/car-model/bake-ao.mjs <car folder under src/games/rally/cars> [more folders]   (writes the GLB in place)
 *
 * Reads `ao` from the car's model.source.json: { wheels: { radius, width, z: [front, rear], track: [front, rear] } }
 * (the GLB has no wheels, so tyres are added as occluders), `glb` is taken from `output` of that file.
 * Per vertex: 64 cosine-weighted rays, a closest-hit BVH, occlusion falls off to 0 at `reach` x the car length.
 * Glass does not occlude. The ground (y = 0) does, so sills and the underbody darken. Re-running replaces the values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readGlb, writeGlb } from './glb-meshopt.mjs';

const RAYS = 64;
const REACH = 0.1; // x car length (~0.45 m on a 4.3 m car)
const NOT_OCCLUDERS = /^(glass|mirror|lenscover)/;
const CT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, i) {
  const a = json.accessors[i];
  const v = json.bufferViews[a.bufferView];
  const T = CT[a.componentType];
  const n = NC[a.type];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? n * T.BYTES_PER_ELEMENT;
  const out = new Float64Array(a.count * n);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = {
    5126: 'getFloat32',
    5125: 'getUint32',
    5123: 'getUint16',
    5121: 'getUint8',
  }[a.componentType];
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++)
      out[k * n + c] = view[get](
        off + k * stride + c * T.BYTES_PER_ELEMENT,
        true,
      );
  return out;
}

// --- BVH over triangles (flat arrays) ----------------------------------------------------------
function buildBvh(tris) {
  const n = tris.length / 9;
  const cen = new Float32Array(n * 3);
  for (let t = 0; t < n; t++)
    for (let c = 0; c < 3; c++)
      cen[t * 3 + c] =
        (tris[t * 9 + c] + tris[t * 9 + 3 + c] + tris[t * 9 + 6 + c]) / 3;
  const order = Uint32Array.from({ length: n }, (_, i) => i);
  const nodes = []; // [minx,miny,minz,maxx,maxy,maxz,left,right,start,count]
  const build = (lo, hi) => {
    const id = nodes.length;
    const nd = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
      -1,
      -1,
      lo,
      hi - lo,
    ];
    nodes.push(nd);
    const cmin = [Infinity, Infinity, Infinity];
    const cmax = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) {
      const t = order[i];
      for (let v = 0; v < 3; v++)
        for (let c = 0; c < 3; c++) {
          const x = tris[t * 9 + v * 3 + c];
          if (x < nd[c]) nd[c] = x;
          if (x > nd[3 + c]) nd[3 + c] = x;
        }
      for (let c = 0; c < 3; c++) {
        cmin[c] = Math.min(cmin[c], cen[t * 3 + c]);
        cmax[c] = Math.max(cmax[c], cen[t * 3 + c]);
      }
    }
    if (hi - lo <= 4) return id;
    let axis = 0;
    for (let c = 1; c < 3; c++)
      if (cmax[c] - cmin[c] > cmax[axis] - cmin[axis]) axis = c;
    if (cmax[axis] - cmin[axis] < 1e-9) return id;
    const sub = Array.from(order.subarray(lo, hi)).sort(
      (a, b) => cen[a * 3 + axis] - cen[b * 3 + axis],
    );
    order.set(sub, lo);
    const mid = (lo + hi) >> 1;
    nd[8] = lo;
    nd[9] = 0;
    nd[6] = build(lo, mid);
    nd[7] = build(mid, hi);
    return id;
  };
  build(0, n);
  const flat = new Float32Array(nodes.length * 6);
  const meta = new Int32Array(nodes.length * 4);
  nodes.forEach((nd, i) => {
    flat.set(nd.slice(0, 6), i * 6);
    meta.set([nd[6], nd[7], nd[8], nd[9]], i * 4);
  });
  return { flat, meta, order, tris };
}

/** Closest hit distance along (o, d) below tMax, or Infinity. */
function trace(bvh, ox, oy, oz, dx, dy, dz, tMax) {
  const { flat, meta, order, tris } = bvh;
  const ix = 1 / (dx || 1e-12);
  const iy = 1 / (dy || 1e-12);
  const iz = 1 / (dz || 1e-12);
  let best = tMax;
  const stack = [0];
  while (stack.length) {
    const id = stack.pop();
    const b = id * 6;
    let t0 = 0;
    let t1 = best;
    let a = (flat[b] - ox) * ix;
    let c = (flat[b + 3] - ox) * ix;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    a = (flat[b + 1] - oy) * iy;
    c = (flat[b + 4] - oy) * iy;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    a = (flat[b + 2] - oz) * iz;
    c = (flat[b + 5] - oz) * iz;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    if (t0 > t1) continue;
    const m = id * 4;
    if (meta[m] < 0) {
      const start = meta[m + 2];
      const count = meta[m + 3];
      for (let i = start; i < start + count; i++) {
        const t = order[i] * 9;
        const e1x = tris[t + 3] - tris[t];
        const e1y = tris[t + 4] - tris[t + 1];
        const e1z = tris[t + 5] - tris[t + 2];
        const e2x = tris[t + 6] - tris[t];
        const e2y = tris[t + 7] - tris[t + 1];
        const e2z = tris[t + 8] - tris[t + 2];
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - tris[t];
        const sy = oy - tris[t + 1];
        const sz = oz - tris[t + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-5 && tt < best) best = tt;
      }
    } else {
      stack.push(meta[m], meta[m + 1]);
    }
  }
  return best < tMax ? best : Infinity;
}

// --- scene ------------------------------------------------------------------------------------------
function tyreTriangles(wheels) {
  const out = [];
  const seg = 20;
  const { radius: r, width: w, z, track } = wheels;
  for (const [axle, zc] of z.entries())
    for (const side of [-1, 1]) {
      const x = (side * track[axle]) / 2;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2;
        const a1 = ((s + 1) / seg) * Math.PI * 2;
        const p = (a, dx) => [
          x + dx,
          r + Math.sin(a) * r,
          zc + Math.cos(a) * r,
        ];
        const q = [p(a0, -w / 2), p(a1, -w / 2), p(a1, w / 2), p(a0, w / 2)];
        out.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
        const c = [x + (w / 2) * 1, r, zc];
        out.push(...c, ...q[2], ...q[3]);
        const c2 = [x - w / 2, r, zc];
        out.push(...c2, ...q[1], ...q[0]);
      }
    }
  return out;
}

function bake(file, cfg) {
  const buf = fs.readFileSync(file);
  const glb = readGlb(buf);
  const { json } = glb;
  let bin = Buffer.from(glb.bin);
  const prims = [];
  const tris = [];
  const walk = (i) => {
    const n = json.nodes[i];
    if (n.matrix || n.translation || n.rotation || n.scale)
      throw new Error(
        'node transforms are not supported (the converters write model space)',
      );
    if (n.mesh !== undefined)
      for (const p of json.meshes[n.mesh].primitives) {
        const P = readAccessor(json, bin, p.attributes.POSITION);
        const N =
          p.attributes.NORMAL !== undefined
            ? readAccessor(json, bin, p.attributes.NORMAL)
            : null;
        const I =
          p.indices !== undefined
            ? readAccessor(json, bin, p.indices)
            : Float64Array.from({ length: P.length / 3 }, (_, k) => k);
        const mat =
          p.material !== undefined
            ? (json.materials[p.material].name ?? '')
            : '';
        prims.push({ p, P, N });
        if (!NOT_OCCLUDERS.test(mat))
          for (const k of I) tris.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      }
    for (const c of n.children ?? []) walk(c);
  };
  for (const s of json.scenes[0].nodes) walk(s);

  let zmin = Infinity;
  let zmax = -Infinity;
  for (const { P } of prims)
    for (let k = 2; k < P.length; k += 3) {
      zmin = Math.min(zmin, P[k]);
      zmax = Math.max(zmax, P[k]);
    }
  const length = zmax - zmin;
  const reach = REACH * length;
  if (cfg.wheels) tris.push(...tyreTriangles(cfg.wheels));
  const G = 50;
  tris.push(-G, 0, -G, G, 0, -G, G, 0, G, -G, 0, -G, G, 0, G, -G, 0, G); // ground
  const bvh = buildBvh(Float32Array.from(tris));

  const total = prims.reduce((s, q) => s + q.P.length / 3, 0);
  const dark = new Float32Array(total);
  let off = 0;
  const eps = 0.004 * (length / 4.3);
  for (const { P, N } of prims) {
    const cnt = P.length / 3;
    for (let v = 0; v < cnt; v++) {
      let nx = N ? N[v * 3] : 0;
      let ny = N ? N[v * 3 + 1] : 1;
      let nz = N ? N[v * 3 + 2] : 0;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // tangent frame
      const ax = Math.abs(ny) < 0.9 ? 0 : 1;
      const ay = ax === 0 ? 1 : 0;
      let tx = ay * nz - 0 * ny;
      let ty = 0 * nx - ax * nz;
      let tz = ax * ny - ay * nx;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;
      const spin = (((v * 2654435761) % 4294967296) / 4294967296) * Math.PI * 2;
      const ox = P[v * 3] + nx * eps;
      const oy = P[v * 3 + 1] + ny * eps;
      const oz = P[v * 3 + 2] + nz * eps;
      let occ = 0;
      for (let i = 0; i < RAYS; i++) {
        const u = (i + 0.5) / RAYS;
        const r = Math.sqrt(u);
        const phi = i * 2.399963 + spin;
        const lx = r * Math.cos(phi);
        const ly = r * Math.sin(phi);
        const lz = Math.sqrt(1 - u);
        const t = trace(
          bvh,
          ox,
          oy,
          oz,
          tx * lx + bx * ly + nx * lz,
          ty * lx + by * ly + ny * lz,
          tz * lx + bz * ly + nz * lz,
          reach,
        );
        if (t < reach) occ += 1 - t / reach;
      }
      dark[off + v] = occ / RAYS;
    }
    off += cnt;
  }

  // Write: reuse an existing _DARK view in place, else append one view + an accessor per primitive.
  const existing = prims.every(({ p }) => p.attributes._DARK !== undefined);
  let o2 = 0;
  if (existing) {
    for (const { p } of prims) {
      const a = json.accessors[p.attributes._DARK];
      const v = json.bufferViews[a.bufferView];
      const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
      Buffer.from(dark.buffer, o2 * 4, a.count * 4).copy(bin, start);
      o2 += a.count;
    }
  } else {
    const pad = (4 - (bin.length % 4)) % 4;
    const start = bin.length + pad;
    bin = Buffer.concat([bin, Buffer.alloc(pad), Buffer.from(dark.buffer)]);
    json.bufferViews.push({
      buffer: 0,
      byteOffset: start,
      byteLength: dark.length * 4,
      target: 34962,
    });
    const view = json.bufferViews.length - 1;
    for (const { p } of prims) {
      const count = json.accessors[p.attributes.POSITION].count;
      json.accessors.push({
        bufferView: view,
        byteOffset: o2 * 4,
        componentType: 5126,
        count,
        type: 'SCALAR',
      });
      p.attributes._DARK = json.accessors.length - 1;
      o2 += count;
    }
    json.buffers[0].byteLength = bin.length;
  }
  fs.writeFileSync(file, writeGlb(json, bin));
  const mean = dark.reduce((s, x) => s + x, 0) / dark.length;
  console.log(
    `${path.basename(file)}: ${total} vertices, mean occlusion ${mean.toFixed(3)}, reach ${reach.toFixed(2)} m`,
  );
}

const root = new URL('../../src/games/rally/cars/', import.meta.url).pathname;
for (const car of process.argv.slice(2)) {
  const src = JSON.parse(
    fs.readFileSync(path.join(root, car, 'model.source.json'), 'utf8'),
  );
  if (!src.ao) throw new Error(`${car}: model.source.json needs an "ao" block`);
  const glb = path.resolve(root, '../../../../', src.output);
  bake(glb, src.ao);
}
