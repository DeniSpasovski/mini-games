/**
 * Bake the two fire engines (CC BY models, credits in THIRD-PARTY.md; the GLBs are not in the repository) into
 * `src/games/rally/assets/builders/fire-trucks.data.ts` + their texture atlases `fire-truck-us.jpg` / `fire-truck-mk.jpg`.
 *
 *   python scripts/car-model/street-pack-extract.py sources/cars/fire-engine/us-fire-truck.glb <dir>/us.json --images <dir>/us
 *   python scripts/car-model/street-pack-extract.py sources/cars/fire-engine/fire-engine-fixedshark554.glb <dir>/fe.json --images <dir>/fe
 *   python scripts/car-model/bake-fire-truck-textures.py <dir>
 *   node scripts/car-model/bake-fire-trucks.mjs <dir>
 *   npx prettier --write src/games/rally/assets/builders/fire-trucks.data.ts
 *
 * Per engine: scaled to its real size, turned to face +X, origin on the ground under the middle, vertices welded, every
 * uv moved into the engine's own atlas. LOD 0 keeps the model's shapes (only triangles no outside view can see are
 * dropped: the cab interior, the underside, the insides of the lockers); the far LODs are meshopt reductions (borders
 * kept). Layout of a LOD: as bake-street-cars.mjs (street-bake-lib.mjs `pack`).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  bounds,
  clamp01,
  merge,
  onlyTriangles,
  pack,
  simplify,
  visibleTriangles,
  weld,
} from './street-bake-lib.mjs';

const dir = process.argv[2];
const OUT = 'src/games/rally/assets/builders';

/**
 * id, extractor file, atlas, scale (source units -> m), turn (degrees about Y that bring the nose to +X: the US truck's
 * nose is +X already, the other one's +Z) and per LOD the triangles / error the simplifier aims for (LOD 0: Infinity = as is).
 */
const MODELS = [
  {
    id: 'fire_truck',
    pack: 'us',
    atlas: 'us',
    scale: 7.9,
    turn: 0,
    lods: [
      { tris: 22000, error: 0.002 },
      { tris: 4500, error: 0.01, flags: ['Prune'] },
      { tris: 2000, error: 0.03, flags: ['Prune'], from: 1 },
    ],
  },
  {
    id: 'fire_truck_mk',
    pack: 'fe',
    atlas: 'mk',
    scale: 0.39,
    turn: 90,
    lods: [
      { tris: Infinity, error: 0 },
      { tris: 3000, error: 0.02, flags: ['Prune'] },
      { tris: 1200, error: 0.05, flags: ['Prune'] },
    ],
  },
];
const UV_WEIGHT = 6;
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'));

const atlases = JSON.parse(
  fs.readFileSync(path.join(dir, 'fire-atlas.json'), 'utf8'),
);

/** Where a source uv goes in the atlas: inside the tile of its image (tiled images: the repeats the tile holds). */
function mapUv(model, img, uv) {
  const t = atlases[model.atlas].tiles[`${model.pack}:${img}`];
  const [u0, v0, u1, v1] = t.rect;
  const fu = (uv[0] - t.lo[0]) / (t.hi[0] - t.lo[0]);
  const fv = (uv[1] - t.lo[1]) / (t.hi[1] - t.lo[1]);
  return [u0 + clamp01(fu) * (u1 - u0), v0 + clamp01(fv) * (v1 - v0)];
}

const roleOf = (mat) => (/Glass|Windshield/i.test(mat) ? 'glass' : 'body');

function bake(model, vehicle) {
  const a = (model.turn * Math.PI) / 180;
  const rot = (p) => [
    (p[0] * Math.cos(a) + p[2] * Math.sin(a)) * model.scale,
    p[1] * model.scale,
    (-p[0] * Math.sin(a) + p[2] * Math.cos(a)) * model.scale,
  ];
  const prims = vehicle.mesh.map((m) => ({ ...m, role: roleOf(m.mat) }));
  const turned = prims.map((p) => p.pos.map(rot));
  const { lo, hi } = bounds(turned.flat());
  const off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const parts = prims.map((m, pi) => {
    const pos = turned[pi].map((q) => q.map((c, k) => c - off[k]));
    const corners = [];
    for (let i = 0; i < m.idx.length; i++)
      corners.push({
        pos: pos[m.idx[i]],
        uv: mapUv(model, m.img, m.uv[m.idx[i]]),
      });
    return { role: m.role, mesh: weld(corners) };
  });
  const of = (role) =>
    merge(parts.filter((p) => p.role === role).map((p) => p.mesh));
  const whole = of('body');
  const glass = of('glass');
  const keep = visibleTriangles(whole, [glass]);
  const main = onlyTriangles(whole, keep);
  console.log(
    ' ',
    model.id,
    'body',
    whole.idx.length / 3,
    '->',
    main.idx.length / 3,
    'tris, glass',
    glass.idx.length / 3,
  );
  // Each LOD is a reduction of the culled model, or (`from`) of an earlier LOD.
  const bodies = [];
  const lamps = [];
  const lods = model.lods.map((b, lod) => {
    const [from, fromGlass] =
      b.from === undefined ? [main, glass] : [bodies[b.from], lamps[b.from]];
    bodies[lod] = simplify(from, b.tris, b.error, UV_WEIGHT, b.flags);
    lamps[lod] = simplify(
      fromGlass,
      Math.max(40, b.tris / 20),
      b.error,
      UV_WEIGHT,
      b.flags,
    );
    return merge([bodies[lod], lamps[lod]]);
  });
  const top = Math.max(...main.pos.map((p) => p[1]));
  const roof = main.pos.filter((p) => p[1] > top - 0.1);
  const [lo2, hi2] = [bounds(lods[0].pos).lo, bounds(lods[0].pos).hi];
  return {
    lods,
    length: hi2[0] - lo2[0],
    width: hi2[2] - lo2[2],
    height: top,
    roofX: roof.reduce((s, p) => s + p[0], 0) / roof.length,
    sideZ: (hi2[2] - lo2[2]) / 2,
  };
}

const r2 = (x) => Math.round(x * 100) / 100;
const rows = [];
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  const vehicle = JSON.parse(
    fs.readFileSync(path.join(dir, `${m.pack}.json`), 'utf8'),
  )[0];
  const b = bake(m, vehicle);
  rows.push({
    id: m.id,
    length: r2(b.length),
    width: r2(b.width),
    height: r2(b.height),
    roofX: r2(b.roofX),
    sideZ: r2(b.sideZ),
    lods: b.lods.map(pack),
  });
  console.log(
    m.id,
    `${b.length.toFixed(2)} x ${b.width.toFixed(2)} x ${b.height.toFixed(2)} m, tris`,
    b.lods.map((l) => l.idx.length / 3).join(' / '),
    'verts',
    b.lods.map((l) => l.pos.length).join(' / '),
  );
}

if (!only.length) {
  const header =
    '// Generated by scripts/car-model/bake-fire-trucks.mjs from the CC BY fire engine models credited in THIRD-PARTY.md. Do not edit.';
  const ts = `${header}
import type { StreetCarData } from './street-cars.data';

/** The two fire engines (same layout as the street cars). */
export const FIRE_TRUCK_DATA: StreetCarData[] = ${JSON.stringify(rows, null, 2)};
`;
  fs.writeFileSync(`${OUT}/fire-trucks.data.ts`, ts);
  for (const name of ['us', 'mk'])
    fs.copyFileSync(
      path.join(dir, `fire-${name}.jpg`),
      `${OUT}/fire-truck-${name}.jpg`,
    );
  console.log('wrote fire-trucks.data.ts', (ts.length / 1024).toFixed(0), 'KB');
}
