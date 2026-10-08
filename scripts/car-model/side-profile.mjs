/**
 * Boxy profile of a car GLB (`CarProfile`, cars/shared/profile-body.ts): the car's fallback body when the GLB can't
 * load, and the street cars of the city maps (assets/builders/vehicles.ts).
 *
 *   node scripts/car-model/side-profile.mjs <car.glb> --axles <front z>,<rear z> --wheel <radius> [--tol 0.03]
 *
 * Reads the plain GLB (model space: y = 0 ground, +z nose), projects every triangle onto the side (z, y) on a 1 cm
 * grid, opens it (drops antennae / wipers thinner than ~6 cm), cuts a round arch over each axle (wheel radius + 4 cm,
 * hub at y = radius), takes the top + bottom edge per column and simplifies that outline to `--tol` metres (boxy).
 * Width = the x extent of the painted `body` material (no mirrors / trim). Tags: `glass` = the side projection of the
 * glass grown 2 cm (so it stands proud of the windscreen / rear window), `lamps` = the box (x0, x1, y0, y1) of the
 * left head / tail lamps seen from the front / back. Prints `profile.ts` for the car folder.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = args[0];
if (!file || !opt('axles') || !opt('wheel')) {
  console.error(
    'usage: side-profile.mjs <car.glb> --axles <front z>,<rear z> --wheel <radius> [--tol 0.03]',
  );
  process.exit(1);
}
const axles = opt('axles').split(',').map(Number);
const wheel = Number(opt('wheel'));
const tol = Number(opt('tol', '0.03'));
const CELL = 0.01;
const OPEN = 3; // cells: features thinner than ~2 * OPEN cm go
const ARCH = wheel + 0.04;
const PILLAR = 15; // cells: glass gaps up to 30 cm (pillars) are closed

// --- read the plain GLB (one buffer, no node transforms: stl-to-glb.mjs output) ---------------------------------
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
const bin = buf.subarray(20 + jsonLen + 8);
const view = (acc) => {
  const a = gltf.accessors[acc];
  const v = gltf.bufferViews[a.bufferView];
  const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = a.count * { SCALAR: 1, VEC3: 3 }[a.type];
  if (a.componentType === 5126)
    return new Float32Array(bin.buffer.slice(off, off + n * 4));
  if (a.componentType === 5125)
    return new Uint32Array(bin.buffer.slice(off, off + n * 4));
  return new Uint16Array(bin.buffer.slice(off, off + n * 2));
};
const GLASS = new Set(['glass', 'ventglass']);
/** Lamp lenses / covers (part-materials.ts); indicators ('amber') left out. */
const LAMPS = new Set([
  'headlight',
  'twinlamp',
  'lens',
  'lenscover',
  'lamphousing',
  'headled',
  'tail',
  'tailc',
  'tailled',
  'redcover',
]);
const tris = []; // [z0, y0, z1, y1, z2, y2]
const glassTris = [];
const lampTris = []; // [x0, y0, x1, y1, x2, y2, centre z] of every left (x > 0) lamp triangle
let minZ = Infinity;
let maxZ = -Infinity;
let maxY = 0;
let halfWidth = 0;
for (const mesh of gltf.meshes)
  for (const p of mesh.primitives) {
    const pos = view(p.attributes.POSITION);
    const idx =
      p.indices !== undefined
        ? view(p.indices)
        : pos.map((_, i) => i).slice(0, pos.length / 3);
    const mat = gltf.materials?.[p.material]?.name ?? '';
    for (let i = 0; i < pos.length; i += 3) {
      minZ = Math.min(minZ, pos[i + 2]);
      maxZ = Math.max(maxZ, pos[i + 2]);
      maxY = Math.max(maxY, pos[i + 1]);
      if (mat === 'body') halfWidth = Math.max(halfWidth, Math.abs(pos[i]));
    }
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++)
        tri.push(pos[idx[t + k] * 3 + 2], pos[idx[t + k] * 3 + 1]);
      tris.push(tri);
      if (GLASS.has(mat)) glassTris.push(tri);
      if (LAMPS.has(mat)) {
        const v = [0, 1, 2].map((k) => idx[t + k] * 3);
        if (v.every((o) => pos[o] > 0.02))
          lampTris.push([
            ...v.flatMap((o) => [pos[o], pos[o + 1]]),
            (pos[v[0] + 2] + pos[v[1] + 2] + pos[v[2] + 2]) / 3,
          ]);
      }
    }
  }

// --- rasterise the side view --------------------------------------------------------------------------------------
const W = Math.ceil((maxZ - minZ) / CELL) + 1;
const H = Math.ceil(maxY / CELL) + 1;
const cz = (z) => Math.round((z - minZ) / CELL);
const cy = (y) => Math.round(y / CELL);
function raster(list) {
  const grid = new Uint8Array(W * H);
  for (const [z0, y0, z1, y1, z2, y2] of list) {
    // Vertices always mark their cell (edge-on panels are slivers that miss every cell centre).
    for (const [z, y] of [
      [z0, y0],
      [z1, y1],
      [z2, y2],
    ]) {
      const i = cz(z);
      const j = cy(y);
      if (j >= 0 && j < H) grid[j * W + i] = 1;
    }
    const d = (z1 - z0) * (y2 - y0) - (z2 - z0) * (y1 - y0);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = cz(Math.min(z0, z1, z2)); i <= cz(Math.max(z0, z1, z2)); i++)
      for (
        let j = Math.max(0, cy(Math.min(y0, y1, y2)));
        j <= Math.min(H - 1, cy(Math.max(y0, y1, y2)));
        j++
      ) {
        const z = minZ + i * CELL;
        const y = j * CELL;
        const a = ((z1 - z) * (y2 - y) - (z2 - z) * (y1 - y)) / d;
        const b = ((z2 - z) * (y0 - y) - (z0 - z) * (y2 - y)) / d;
        if (a >= 0 && b >= 0 && a + b <= 1) grid[j * W + i] = 1;
      }
  }
  return grid;
}

/** Square-kernel erode (min) or dilate (max), radius r cells. */
function morph(src, r, dilate) {
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let v = dilate ? 0 : 1;
      for (let dj = -r; dj <= r && v === (dilate ? 0 : 1); dj++)
        for (let di = -r; di <= r; di++) {
          const x = i + di;
          const y = j + dj;
          const s = x >= 0 && x < W && y >= 0 && y < H ? src[y * W + x] : 0;
          if (dilate ? s : !s) {
            v = dilate ? 1 : 0;
            break;
          }
        }
      out[j * W + i] = v;
    }
  return out;
}
let grid = raster(tris);
grid = morph(morph(grid, 1, true), 1, false); // close pinholes
grid = morph(morph(grid, OPEN, false), OPEN, true); // drop thin bits

// Wheel arches: a half circle over each hub, open down to the ground.
for (const za of axles)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const dz = minZ + i * CELL - za;
      const dy = j * CELL - wheel;
      if (Math.abs(dz) <= ARCH && (dy <= 0 || dz * dz + dy * dy <= ARCH * ARCH))
        grid[j * W + i] = 0;
    }

// Greenhouse: the glass, closed over the pillars between the panes, grown 2 cm past the body.
/** Closing along z only (bridges the pillars between the panes), radius r cells. */
function closeRows(src, r) {
  const out = src.slice();
  for (let j = 0; j < H; j++) {
    let last = -1;
    for (let i = 0; i < W; i++)
      if (src[j * W + i]) {
        if (last >= 0 && i - last <= 2 * r)
          for (let k = last + 1; k < i; k++) out[j * W + k] = 1;
        last = i;
      }
  }
  return out;
}
let glassGrid = raster(glassTris);
glassGrid = morph(morph(glassGrid, 4, true), 4, false);
glassGrid = morph(closeRows(glassGrid, PILLAR), 2, true);

// --- outline: top + bottom per column, simplified -------------------------------------------------------------------
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let best = -1;
  let far = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dist =
      Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) /
      len;
    if (dist > far) {
      far = dist;
      best = i;
    }
  }
  if (far <= eps) return [a, b];
  return [
    ...simplify(pts.slice(0, best + 1), eps).slice(0, -1),
    ...simplify(pts.slice(best), eps),
  ];
}
/** Counter-clockwise (z, y) outline of a mask: top + bottom edge per column, simplified to `eps`. */
function outlineOf(mask, eps) {
  const top = [];
  const bottom = [];
  for (let i = 0; i < W; i++) {
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < H; j++)
      if (mask[j * W + i]) {
        if (lo < 0) lo = j;
        hi = j;
      }
    if (lo < 0) continue;
    const z = minZ + i * CELL;
    top.push([z, (hi + 0.5) * CELL]);
    bottom.push([z, Math.max(0, (lo - 0.5) * CELL)]);
  }
  // Closed loop: top rear -> front, bottom front -> rear; simplified as two halves split at the point farthest from
  // the start.
  const loop = [...top, ...bottom.reverse()];
  const [z0, y0] = loop[0];
  let k = 0;
  loop.forEach(([z, y], i) => {
    if (
      Math.hypot(z - z0, y - y0) > Math.hypot(loop[k][0] - z0, loop[k][1] - y0)
    )
      k = i;
  });
  const out = [
    ...simplify(loop.slice(0, k + 1), eps).slice(0, -1),
    ...simplify([...loop.slice(k), loop[0]], eps).slice(0, -1),
  ];
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const [za, ya] = out[i];
    const [zb, yb] = out[(i + 1) % out.length];
    area += za * yb - zb * ya;
  }
  return area < 0 ? out.reverse() : out;
}
const outline = outlineOf(grid, tol);
const glass = outlineOf(glassGrid, tol / 2);

/**
 * Box (x0, x1, y0, y1) of the left lamp at one end (x > 0; the right side mirrors it): the biggest connected patch of
 * lamp triangles seen from that end on a 2 cm grid (the headlight, not the fog lamps; the tail lamp, not the third
 * brake light).
 */
function lampBox(front) {
  const C = 0.02;
  const NX = 60;
  const NY = Math.ceil(maxY / C) + 1;
  const g = new Uint8Array(NX * NY);
  const mark = (x, y) => {
    const i = Math.min(NX - 1, Math.floor(x / C));
    const j = Math.min(NY - 1, Math.max(0, Math.floor(y / C)));
    g[j * NX + i] = 1;
  };
  for (const [x0, y0, x1, y1, x2, y2, z] of lampTris) {
    if (front ? z <= 0 : z >= 0) continue;
    // Corners plus a few points inside: enough to join a lamp's triangles on a 2 cm grid.
    for (const [a, b] of [
      [1, 0],
      [0, 1],
      [0, 0],
      [0.33, 0.33],
      [0.5, 0],
      [0, 0.5],
      [0.5, 0.5],
    ])
      mark(
        x0 * (1 - a - b) + x1 * a + x2 * b,
        y0 * (1 - a - b) + y1 * a + y2 * b,
      );
  }
  const seen = new Uint8Array(NX * NY);
  let best = null;
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || seen[s]) continue;
    const box = [Infinity, -Infinity, Infinity, -Infinity];
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop();
      const [i, j] = [c % NX, Math.floor(c / NX)];
      n++;
      box[0] = Math.min(box[0], i * C);
      box[1] = Math.max(box[1], (i + 1) * C);
      box[2] = Math.min(box[2], j * C);
      box[3] = Math.max(box[3], (j + 1) * C);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [a, b] = [i + di, j + dj];
        const k = b * NX + a;
        if (a >= 0 && a < NX && b >= 0 && b < NY && g[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (!best || n > best.n) best = { n, box };
  }
  return best?.box ?? null;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const flat = (pts) => pts.map(([z, y]) => `${r3(z)}, ${r3(y)}`).join(', ');
const box = (b) => `[${b.map(r3).join(', ')}]`;
const [front, rear] = [lampBox(true), lampBox(false)];
console.log(`import type { CarProfile } from '../shared/types';

/**
 * Boxy profile (cars/shared/profile-body.ts): the fallback body when the GLB can't load and the street car of the
 * city maps. Baked from the GLB - do not edit by hand:
 *   node scripts/car-model/side-profile.mjs ${file} --axles ${axles.join(',')} --wheel ${wheel}${tol !== 0.03 ? ` --tol ${tol}` : ''}
 */
export const profile: CarProfile = {
  width: ${r3(halfWidth * 2)},
  axles: [${axles.join(', ')}],
  wheel: ${wheel},
  outline: [${flat(outline)}],
  glass: [${flat(glass)}],
  lamps: { front: ${box(front)}, rear: ${box(rear)} },
};`);
