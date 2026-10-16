import { BufferAttribute, BufferGeometry, Color } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRUCK_DATA, type TruckData } from './truck-models.data';

/**
 * The baked truck models (`scripts/car-model/bake-trucks.mjs`, credits: THIRD-PARTY.md): a tractor unit, its trailer,
 * the cab alone (rigid box trucks) and a dump truck. Models face +X, origin on the ground under the middle.
 */
export type TruckModel = keyof typeof TRUCK_DATA;
export type TruckPart = 'cab' | 'paint' | 'glass' | 'detail';

/** sRGB byte -> linear. */
const LINEAR = new Float32Array(256).map(
  (_, i) => new Color().setRGB(i / 255, i / 255, i / 255, 'srgb').r,
);

function decode(b64: string): BufferGeometry {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(0, true);
  const lo = [0, 1, 2].map((k) => dv.getFloat32(4 + k * 4, true));
  const size = [0, 1, 2].map((k) => dv.getFloat32(16 + k * 4, true));
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++)
    pos[i] = lo[i % 3] + (dv.getUint16(28 + i * 2, true) / 65535) * size[i % 3];
  const colAt = 28 + n * 6;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) col[i] = LINEAR[bytes[colAt + i]];
  const idxAt = colAt + n * 3;
  const count = dv.getUint32(idxAt, true);
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++)
    idx[i] = dv.getUint16(idxAt + 4 + i * 2, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  // Hard edges above ~35 deg, non-indexed like every other part of the fleet.
  const out = toCreasedNormals(g, 0.6);
  for (const name of Object.keys(out.attributes))
    if (!['position', 'normal', 'color'].includes(name))
      out.deleteAttribute(name);
  return out;
}

export const truckData = (model: TruckModel): TruckData => TRUCK_DATA[model];

/** A fresh geometry of one part of a model (position, normal, baked colour), or undefined when it has none. */
export function truckPart(
  model: TruckModel,
  part: TruckPart,
): BufferGeometry | undefined {
  const b64 = TRUCK_DATA[model][part];
  return b64 ? decode(b64) : undefined;
}
