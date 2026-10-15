import { BufferAttribute, BufferGeometry, Color } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREET_CAR_DATA } from './street-cars.data';

/**
 * The background cars: vehicles of three CC BY packs (credits: THIRD-PARTY.md), simplified and packed by
 * `scripts/car-model/bake-street-cars.mjs` into `street-cars.data.ts`. Models face +X, origin on the ground under the middle.
 * Paint triangles come first in a model; they get the car's paint, the rest keeps its baked colour.
 */

/** Models 0-4 are the old boxy cars, the rest are modern. */
const OLD_COUNT = 5;
export const STREET_CAR_COUNT = STREET_CAR_DATA.length;
/** Index of the sedan (the taxi and police car). */
export const SEDAN = STREET_CAR_DATA.findIndex((d) => d.id === 'sedan');

/** sRGB byte -> linear. */
const LINEAR = new Float32Array(256).map(
  (_, i) => new Color().setRGB(i / 255, i / 255, i / 255, 'srgb').r,
);

export interface StreetCarShape {
  old: boolean;
  /** Height of the roof (m) and its middle along the car. */
  height: number;
  roofX: number;
  /** Half width of the body at the doors (m), mirrors excluded. */
  sideZ: number;
  /** A fresh geometry painted in `paintHex` (non-indexed: position, normal, uv, color). */
  geometry: (paintHex: string) => BufferGeometry;
}

interface Decoded {
  pos: Float32Array;
  col: Uint8Array;
  idx: Uint16Array;
  paintVerts: number;
}

function decode(b64: string): Decoded {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(0, true);
  const paintVerts = dv.getUint16(2, true);
  const lo = [0, 1, 2].map((k) => dv.getFloat32(4 + k * 4, true));
  const size = [0, 1, 2].map((k) => dv.getFloat32(16 + k * 4, true));
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++)
    pos[i] = lo[i % 3] + (dv.getUint16(28 + i * 2, true) / 65535) * size[i % 3];
  const colAt = 28 + n * 6;
  const col = bytes.slice(colAt, colAt + n * 3);
  const idxAt = colAt + n * 3;
  const count = dv.getUint32(idxAt, true);
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++)
    idx[i] = dv.getUint16(idxAt + 4 + i * 2, true);
  return { pos, col, idx, paintVerts };
}

const cache = new Map<string, StreetCarShape>();

/** The model `index` (wrapped) at `lod` (0 near, 1 far). */
export function streetCarModel(index: number, lod: number): StreetCarShape {
  const i = ((index % STREET_CAR_COUNT) + STREET_CAR_COUNT) % STREET_CAR_COUNT;
  const key = `${i}:${lod ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = decode(STREET_CAR_DATA[i].lods[lod ? 1 : 0]);
  let height = 0;
  for (let v = 0; v < d.pos.length; v += 3)
    height = Math.max(height, d.pos[v + 1]);
  // Roof middle: vertices within 5 cm of the top. Door side: the median |z| of the paint vertices at door height.
  let roofX = 0;
  let roofN = 0;
  const side: number[] = [];
  for (let v = 0; v < d.paintVerts; v++) {
    const y = d.pos[v * 3 + 1];
    if (y > height - 0.05) {
      roofX += d.pos[v * 3];
      roofN++;
    }
    if (y > 0.5 && y < 0.95 && Math.abs(d.pos[v * 3]) < 0.9)
      side.push(Math.abs(d.pos[v * 3 + 2]));
  }
  side.sort((a, b) => a - b);
  const shape: StreetCarShape = {
    old: i < OLD_COUNT,
    height,
    roofX: roofN ? roofX / roofN : 0,
    sideZ: side.length
      ? side[Math.floor(side.length / 2)]
      : STREET_CAR_DATA[i].width / 2,
    geometry: (paintHex) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(d.pos, 3));
      const base = new Color(paintHex);
      const col = new Float32Array(d.col.length);
      for (let v = 0; v < d.col.length / 3; v++) {
        if (v < d.paintVerts) col.set([base.r, base.g, base.b], v * 3);
        else
          col.set(
            [
              LINEAR[d.col[v * 3]],
              LINEAR[d.col[v * 3 + 1]],
              LINEAR[d.col[v * 3 + 2]],
            ],
            v * 3,
          );
      }
      g.setAttribute('color', new BufferAttribute(col, 3));
      g.setIndex(new BufferAttribute(d.idx, 1));
      // Creased normals (hard edges above ~35 deg), non-indexed like every other vehicle part.
      const out = lod ? g.toNonIndexed() : toCreasedNormals(g, 0.6);
      if (lod) out.computeVertexNormals();
      const n = out.getAttribute('position').count;
      const uv = new Float32Array(n * 2);
      for (let v = 0; v < n; v++) uv.set(PLAIN_UV, v * 2);
      out.setAttribute('uv', new BufferAttribute(uv, 2));
      for (const name of Object.keys(out.attributes))
        if (!['position', 'normal', 'uv', 'color'].includes(name))
          out.deleteAttribute(name);
      return out;
    },
  };
  cache.set(key, shape);
  return shape;
}

/** u / v of the plain-white corner of the decals atlas (engine/textures.ts `vehicle_decals`). */
const PLAIN_UV = [0.03, 0.5];
