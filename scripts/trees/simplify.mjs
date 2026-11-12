// Mesh simplifier for scripts/trees/bake-tree-packs.py (meshoptimizer, uv seams kept): the bark of a pack model that has no
// levels of detail of its own, down to the target or as far as the error (relative to the model's size) allows.
// stdin: u32 vertices, u32 indices, u32 target index count, f32 error, f32 positions [v * 3], f32 uvs [v * 2], u32 indices;
// stdout: u32 count, u32 indices.
import { MeshoptSimplifier as S } from 'meshoptimizer';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const buf = Buffer.concat(chunks);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const nv = dv.getUint32(0, true);
const ni = dv.getUint32(4, true);
const target = dv.getUint32(8, true);
const error = dv.getFloat32(12, true);
const copy = (o, n, T) =>
  new T(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + n * 4));
const pos = copy(16, nv * 3, Float32Array);
const uv = copy(16 + nv * 12, nv * 2, Float32Array);
const idx = copy(16 + nv * 20, ni, Uint32Array);
await S.ready;
S.useExperimentalFeatures = true;
const [out] = S.simplifyWithAttributes(
  idx,
  pos,
  3,
  uv,
  2,
  [0.5, 0.5],
  null,
  target,
  error,
);
const res = Buffer.alloc(4 + out.length * 4);
res.writeUInt32LE(out.length, 0);
Buffer.from(out.buffer, out.byteOffset, out.byteLength).copy(res, 4);
process.stdout.write(res);
