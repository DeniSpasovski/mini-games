/**
 * Mesh helpers shared by the vehicle bakers (bake-street-cars.mjs, bake-fire-trucks.mjs): meshes are `{pos, uv, idx}`
 * (pos / uv arrays of [x, y, z] / [u, v], idx triangle corners). `pack` writes the base64 layout of one LOD.
 */
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** A mesh `{pos, uv, idx}` from triangle corners, vertices with the same position and uv welded. */
export function weld(corners) {
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

export const merge = (list) => {
  const out = { pos: [], uv: [], idx: [] };
  for (const m of list) {
    const base = out.pos.length;
    // (loops, not push(...list): a 70k-triangle model overflows the call stack)
    for (const p of m.pos) out.pos.push(p);
    for (const q of m.uv) out.uv.push(q);
    for (const i of m.idx) out.idx.push(i + base);
  }
  return out;
};

export function simplify(m, tris, error, uvWeight, flags = ['LockBorder']) {
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
    flags,
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

export const bounds = (list) => {
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
export function visibleTriangles(main, others) {
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
export function onlyTriangles(m, keep) {
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

export function pack(m) {
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
