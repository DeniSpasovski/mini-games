import { BufferAttribute, BufferGeometry, Color } from 'three';
import { Rng } from '../../../../shared/rng';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';
import { ROCK_MODELS } from './rock-models.data';

/** Decoded stones per (model, lod); the packed layout is described in scripts/rocks/bake-rocks.mjs. */
const decoded = new Map<string, BufferGeometry>();
function stone(model: number, lod: number): BufferGeometry {
  const key = `${model}:${lod}`;
  let g = decoded.get(key);
  if (g) return g;
  const lods = ROCK_MODELS[model].lods;
  const bin = Uint8Array.from(atob(lods[Math.min(lod, lods.length - 1)]), (c) =>
    c.charCodeAt(0),
  );
  const dv = new DataView(bin.buffer);
  const n = dv.getUint16(0, true);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++)
      pos[i * 3 + c] = dv.getInt16(o + c * 2, true) / 16384;
    o += 6;
    for (let c = 0; c < 3; c++) nor[i * 3 + c] = dv.getInt8(o + c) / 127;
    o += 3;
    uv[i * 2] = dv.getUint16(o, true) / 65535;
    uv[i * 2 + 1] = dv.getUint16(o + 2, true) / 65535;
    o += 4;
  }
  const idx = new Uint16Array((bin.length - o) / 2);
  for (let k = 0; k < idx.length; k++) idx[k] = dv.getUint16(o + k * 2, true);
  g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  decoded.set(key, g);
  return g;
}

/**
 * One of the scanned stones, its footprint `size` m across (half-extent) and no taller than `maxH`; turned and tinted
 * per seed. The scan keeps its own shape and moss; the vertex colour only shifts the tone a little.
 */
function rock(
  seed: number,
  lod: number,
  size: number,
  maxH: number,
): BufferGeometry {
  const rng = new Rng(seed);
  const model = Math.floor(rng.next() * ROCK_MODELS.length);
  const s = Math.min(size, maxH / ROCK_MODELS[model].height);
  const g = stone(model, lod).toNonIndexed();
  g.scale(s, s, s);
  g.rotateY(rng.next() * Math.PI * 2);
  const tone = new Color(rng.pick(['#ffffff', '#f2efe8', '#e8e6e0']));
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([tone.r, tone.g, tone.b], i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

export const rockBoulder: AssetBuilder = ({ seed, lod }) => ({
  parts: [
    { geometry: rock(seed, lod, 1.05, 1.1), material: getMaterial('rock') },
  ],
});

export const rockSmall: AssetBuilder = ({ seed }) => ({
  parts: [
    { geometry: rock(seed, 1, 0.25, 0.22), material: getMaterial('rock') },
  ],
});
