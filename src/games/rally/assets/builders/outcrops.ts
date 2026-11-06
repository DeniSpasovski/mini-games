import { BufferAttribute, BufferGeometry, Color } from 'three';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';
import { OUTCROP_MODELS, OUTCROP_UNIT } from './outcrop-models.data';

/** Decoded scans per (model, lod); the packed layout is in scripts/rocks/mesh-kit.mjs. */
const decoded = new Map<string, BufferGeometry>();
function face(model: number, lod: number): BufferGeometry {
  const key = `${model}:${lod}`;
  let g = decoded.get(key);
  if (g) return g;
  const lods = OUTCROP_MODELS[model].lods;
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
      pos[i * 3 + c] = dv.getInt16(o + c * 2, true) / OUTCROP_UNIT;
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
 * Variants: the two scans (Poly Haven "Rock Face 01", 5 x 3.6 m; "Rock Face 02", 2.7 x 2.5 m) as scanned, then each
 * lower and wider (a ledge of the band). Every variant is about 3 m across at scale 1, the face at +Z, the open back
 * of the scan behind it (buried in the slope by `world/outcrops.ts`).
 */
const SHAPES: { model: number; w: number; h: number; tone: string }[] = [
  { model: 0, w: 3.2, h: 1, tone: '#ffffff' },
  { model: 1, w: 3.0, h: 1, tone: '#f0ede6' },
  { model: 0, w: 3.6, h: 0.7, tone: '#ebe8e2' },
  { model: 1, w: 3.4, h: 0.75, tone: '#fbf8f2' },
];

/** A piece of a rock band (catalog `rock_outcrop`): one of the scanned rock faces, tinted a little per variant. */
export const rockOutcrop: AssetBuilder = ({ variant, lod }) => {
  const s = SHAPES[variant % SHAPES.length];
  const m = OUTCROP_MODELS[s.model];
  const k = s.w / m.size[0];
  const g = face(s.model, lod).toNonIndexed();
  g.scale(k, k * s.h, k);
  const tone = new Color(s.tone);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([tone.r, tone.g, tone.b], i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  return { parts: [{ geometry: g, material: getMaterial('outcrop') }] };
};
