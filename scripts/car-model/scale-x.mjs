/**
 * Narrow (or widen) a plain car GLB sideways: scales x of every primitive except the `--keep` materials
 * (positions about x = 0, normals corrected), in place. Example (22B body 1.88 -> 1.77 m, springs / dampers stay on the hubs):
 *
 *   node scripts/car-model/scale-x.mjs public/models/cars/subie_22b.glb 0.942 --keep coilover,chrome
 *
 * Run it ONCE on the converted file (stl-to-glb.mjs output, not meshopt: the build compresses on the way); a rebuild
 * from the source model needs it again. Atlas UVs are untouched, so the livery still fits.
 */
import fs from 'node:fs';

const [file, factor, ...rest] = process.argv.slice(2);
const s = Number(factor);
const keep = new Set(
  (rest[0] === '--keep' ? (rest[1] ?? '') : '').split(',').filter(Boolean),
);
if (!file || !(s > 0)) {
  console.error('usage: scale-x.mjs <car.glb> <factor> [--keep mat1,mat2]');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
const binOff = 20 + jsonLen + 8;
const bin = Buffer.from(buf.subarray(binOff));

const done = new Set();
for (const mesh of gltf.meshes)
  for (const p of mesh.primitives) {
    if (keep.has(gltf.materials[p.material]?.name)) continue;
    const pos = gltf.accessors[p.attributes.POSITION];
    const nor = gltf.accessors[p.attributes.NORMAL];
    if (done.has(p.attributes.POSITION)) continue;
    done.add(p.attributes.POSITION);
    const at = (a, i) => {
      const v = gltf.bufferViews[a.bufferView];
      return (
        (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? 12)
      );
    };
    for (let i = 0; i < pos.count; i++) {
      const o = at(pos, i);
      bin.writeFloatLE(bin.readFloatLE(o) * s, o);
    }
    for (let i = 0; i < nor.count; i++) {
      const o = at(nor, i);
      const n = [
        bin.readFloatLE(o) / s,
        bin.readFloatLE(o + 4),
        bin.readFloatLE(o + 8),
      ];
      const l = Math.hypot(...n) || 1;
      n.forEach((v, k) => bin.writeFloatLE(v / l, o + 4 * k));
    }
    pos.min[0] *= s;
    pos.max[0] *= s;
    if (s < 0) [pos.min[0], pos.max[0]] = [pos.max[0], pos.min[0]];
  }

const js = Buffer.from(JSON.stringify(gltf));
const jsPad = Buffer.concat([
  js,
  Buffer.alloc((4 - (js.length % 4)) % 4, 0x20),
]);
const head = Buffer.from(buf.subarray(0, 12));
head.writeUInt32LE(12 + 8 + jsPad.length + 8 + bin.length, 8);
const chunk = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
fs.writeFileSync(
  file,
  Buffer.concat([
    head,
    chunk(jsPad.length, 0x4e4f534a),
    jsPad,
    chunk(bin.length, 0x004e4942),
    bin,
  ]),
);
console.log(
  `${file}: x * ${s} on ${done.size} primitives (kept: ${[...keep].join(', ') || 'none'})`,
);
