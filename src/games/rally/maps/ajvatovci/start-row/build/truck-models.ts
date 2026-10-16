import {
  BufferAttribute,
  BufferGeometry,
  Color,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TRUCK_DATA,
  TRUCK_TEXTURES,
  type TruckData,
  type TruckRole,
} from './truck-models.data';

/**
 * The baked truck models (`scripts/car-model/bake-trucks.mjs`, credits: THIRD-PARTY.md): a tractor unit, its trailer,
 * the cab alone (rigid box trucks), a dump truck and one tyre of each side (a template for the axles the vehicle
 * builders place themselves). The models' own triangles and textures. Models face +X, origin on the ground under the middle.
 */
export type TruckModel = keyof typeof TRUCK_DATA;
export type { TruckRole };

/** One part of a model: its geometry (position, normal and uv, or a flat colour), how it is drawn, its texture. */
export interface TruckPiece {
  id: string;
  role: TruckRole;
  tex?: string;
  geometry: BufferGeometry;
}

function decode(b64: string, color?: string): BufferGeometry {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(0, true);
  const withUv = (bytes[2] & 1) !== 0;
  const lo = [0, 1, 2].map((k) => dv.getFloat32(4 + k * 4, true));
  const size = [0, 1, 2].map((k) => dv.getFloat32(16 + k * 4, true));
  let at = 28;
  const uvLo = [0, 1].map((k) =>
    withUv ? dv.getFloat32(28 + k * 4, true) : 0,
  );
  const uvSize = [0, 1].map((k) =>
    withUv ? dv.getFloat32(36 + k * 4, true) : 0,
  );
  if (withUv) at = 44;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++)
    pos[i] = lo[i % 3] + (dv.getUint16(at + i * 2, true) / 65535) * size[i % 3];
  at += n * 6;
  const uv = new Float32Array(withUv ? n * 2 : 0);
  for (let i = 0; i < uv.length; i++)
    uv[i] =
      uvLo[i % 2] + (dv.getUint16(at + i * 2, true) / 65535) * uvSize[i % 2];
  if (withUv) at += n * 4;
  const count = dv.getUint32(at, true);
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++) idx[i] = dv.getUint16(at + 4 + i * 2, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  if (withUv) g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  // Hard edges above ~35 deg, non-indexed like every other part of the fleet.
  const out = toCreasedNormals(g, 0.6);
  for (const name of Object.keys(out.attributes))
    if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  if (!withUv) {
    // Flat parts carry a colour attribute like the code-built pieces they are merged with.
    const c = new Color(color ?? '#ffffff');
    const flat = new Float32Array(out.getAttribute('position').count * 3);
    for (let i = 0; i < flat.length; i += 3) flat.set([c.r, c.g, c.b], i);
    out.setAttribute('color', new BufferAttribute(flat, 3));
  }
  return out;
}

export const truckData = (model: TruckModel): TruckData => TRUCK_DATA[model];

/** Fresh geometries of every part of a model. */
export function truckPieces(model: TruckModel): TruckPiece[] {
  return TRUCK_DATA[model].parts
    .filter((p) => p.data)
    .map((p) => ({
      id: p.id,
      role: p.role,
      tex: p.tex,
      geometry: decode(p.data, p.id === 'lens' ? '#dfe6ea' : undefined),
    }));
}

export interface TruckMaps {
  map: Texture;
  mask?: Texture;
  ref: number;
}

const maps = new Map<string, TruckMaps | undefined>();

/** A model texture, its tint mask and brightness reference; undefined without a DOM (tests). */
export function truckMaps(key: string): TruckMaps | undefined {
  if (maps.has(key)) return maps.get(key);
  let made: TruckMaps | undefined;
  if (typeof document !== 'undefined') {
    const load = (uri: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(uri);
      // glTF uv: origin top left; the models tile (the dump truck's dirt).
      t.flipY = false;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = SRGBColorSpace;
      return t;
    };
    const src = TRUCK_TEXTURES[key];
    made = {
      map: load(src.map, true),
      mask: src.mask ? load(src.mask, false) : undefined,
      ref: src.ref,
    };
  }
  maps.set(key, made);
  return made;
}
