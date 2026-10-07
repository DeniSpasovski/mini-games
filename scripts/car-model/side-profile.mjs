/**
 * Side outline of a car GLB for its fallback body (`model.profile`, cars/shared/profile-body.ts): what the game shows
 * when the GLB can't load - the outline extruded to the body width, in the car's livery.
 *
 *   node scripts/car-model/side-profile.mjs <car.glb> --axles <front z>,<rear z> --wheel <radius> [--tol 0.03]
 *
 * Reads the plain GLB (model space: y = 0 ground, +z nose), projects every triangle onto the side (z, y) on a 1 cm
 * grid, opens it (drops antennae / wipers thinner than ~6 cm), cuts a round arch over each axle (wheel radius + 4 cm,
 * hub at y = radius), takes the top + bottom edge per column and simplifies that outline to `--tol` metres (boxy).
 * Width = the x extent of the painted `body` material (no mirrors / trim). Prints the `profile` block to paste into <car>.ts.
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
const tris = []; // [z0, y0, z1, y1, z2, y2]
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
    }
  }

// --- rasterise the side view --------------------------------------------------------------------------------------
const W = Math.ceil((maxZ - minZ) / CELL) + 1;
const H = Math.ceil(maxY / CELL) + 1;
let grid = new Uint8Array(W * H);
const cz = (z) => Math.round((z - minZ) / CELL);
const cy = (y) => Math.round(y / CELL);
for (const [z0, y0, z1, y1, z2, y2] of tris) {
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

// --- outline: top + bottom per column, simplified -------------------------------------------------------------------
const top = [];
const bottom = [];
for (let i = 0; i < W; i++) {
  let lo = -1;
  let hi = -1;
  for (let j = 0; j < H; j++)
    if (grid[j * W + i]) {
      if (lo < 0) lo = j;
      hi = j;
    }
  if (lo < 0) continue;
  const z = minZ + i * CELL;
  top.push([z, (hi + 0.5) * CELL]);
  bottom.push([z, Math.max(0, (lo - 0.5) * CELL)]);
}
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
// Closed loop: top rear -> front, bottom front -> rear; simplified as two halves split at the point farthest from
// the start.
const loop = [...top, ...bottom.reverse()];
const [z0, y0] = loop[0];
let k = 0;
loop.forEach(([z, y], i) => {
  if (Math.hypot(z - z0, y - y0) > Math.hypot(loop[k][0] - z0, loop[k][1] - y0))
    k = i;
});
const outline = [
  ...simplify(loop.slice(0, k + 1), tol).slice(0, -1),
  ...simplify([...loop.slice(k), loop[0]], tol).slice(0, -1),
];
// Counter-clockwise in (z, y) (three.js Shape outer contour).
let area = 0;
for (let i = 0; i < outline.length; i++) {
  const [z0, y0] = outline[i];
  const [z1, y1] = outline[(i + 1) % outline.length];
  area += z0 * y1 - z1 * y0;
}
if (area < 0) outline.reverse();

const r3 = (v) => Math.round(v * 1000) / 1000;
console.log(`// ${outline.length} points from ${file} (tol ${tol} m)`);
console.log(`profile: {`);
console.log(`  width: ${r3(halfWidth * 2)},`);
console.log(
  `  outline: [${outline.map(([z, y]) => `${r3(z)}, ${r3(y)}`).join(', ')}],`,
);
console.log(`},`);
