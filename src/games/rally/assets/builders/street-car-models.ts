import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Material,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import atlasUrl from './street-car-atlas.jpg';
import maskUrl from './street-car-mask.png';
import { SERVICE_VEHICLE_DATA } from './service-vehicles.data';
import { STREET_CAR_DATA, type StreetCarData } from './street-cars.data';

/**
 * The background cars and the service park's vans and trucks: vehicles of three CC BY packs (credits: THIRD-PARTY.md) with
 * their own triangles and textures, packed by `scripts/car-model/bake-street-cars.mjs` into `street-cars.data.ts` and
 * `service-vehicles.data.ts`. Models face +X, origin on the ground under the middle. A model is one mesh (body, glass, lamps,
 * wheels) with its uv in one shared atlas; the vehicle's paint goes in the `color` attribute and replaces the source paint
 * where the atlas's tint mask is white (`streetCarMaterial`).
 */

/** Models 0-4 are the old boxy cars, the rest are modern. */
const OLD_COUNT = 5;
export const STREET_CAR_COUNT = STREET_CAR_DATA.length;
/** Index of the sedan (the taxi and police car). */
export const SEDAN = STREET_CAR_DATA.findIndex((d) => d.id === 'sedan');
/** Index of the model `id` (-1 if there is none). */
export const streetCarIndex = (id: string): number =>
  STREET_CAR_DATA.findIndex((d) => d.id === id);

export interface StreetCarShape {
  old: boolean;
  /** Length and width of the model (m), mirrors included. */
  length: number;
  width: number;
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
  uv: Float32Array;
  idx: Uint16Array;
}

function decode(b64: string): Decoded {
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
  const uvAt = 28 + n * 6;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++)
    uv[i] = dv.getUint16(uvAt + i * 2, true) / 65535;
  const idxAt = uvAt + n * 4;
  const count = dv.getUint32(idxAt, true);
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++)
    idx[i] = dv.getUint16(idxAt + 4 + i * 2, true);
  return { pos, uv, idx };
}

const caches = new WeakMap<StreetCarData[], Map<string, StreetCarShape>>();

/** The street car `index` (wrapped) at `lod` (0 near; the last one is the farthest). */
export const streetCarModel = (index: number, lod: number): StreetCarShape =>
  vehicleModel(STREET_CAR_DATA, index, lod);

/** A van or truck of pack 7 by id (`van_low`, `van_high`, `minibus`, `box_truck`, `flatbed`), same LODs. */
export function serviceVehicleModel(id: string, lod: number): StreetCarShape {
  const index = SERVICE_VEHICLE_DATA.findIndex((d) => d.id === id);
  if (index < 0) throw new Error(`Unknown service vehicle "${id}"`);
  return vehicleModel(SERVICE_VEHICLE_DATA, index, lod);
}

function vehicleModel(
  list: StreetCarData[],
  index: number,
  lod: number,
): StreetCarShape {
  const i = ((index % list.length) + list.length) % list.length;
  const data = list[i];
  const l = Math.min(Math.max(lod, 0), data.lods.length - 1);
  const key = `${i}:${l}`;
  let cache = caches.get(list);
  if (!cache) caches.set(list, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const d = decode(data.lods[l]);
  const shape: StreetCarShape = {
    old: list === STREET_CAR_DATA && i < OLD_COUNT,
    length: data.length,
    width: data.width,
    height: data.height,
    roofX: data.roofX,
    sideZ: data.sideZ,
    geometry: (paintHex) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(d.pos, 3));
      g.setAttribute('uv', new BufferAttribute(d.uv, 2));
      const base = new Color(paintHex);
      const col = new Float32Array(d.pos.length);
      for (let v = 0; v < col.length; v += 3)
        col.set([base.r, base.g, base.b], v);
      g.setAttribute('color', new BufferAttribute(col, 3));
      g.setIndex(new BufferAttribute(d.idx, 1));
      // Creased normals (hard edges above ~35 deg), non-indexed like every other vehicle part.
      const out = toCreasedNormals(g, 0.6);
      for (const name of Object.keys(out.attributes))
        if (!['position', 'normal', 'uv', 'color'].includes(name))
          out.deleteAttribute(name);
      return out;
    },
  };
  cache.set(key, shape);
  return shape;
}

let material: Material | undefined;

/**
 * The one material of every background car: the atlas, drawn as it is where the tint mask is black (glass, lamps, wheels,
 * trim) and multiplied by the car's paint (the `color` attribute) where it is white - the atlas holds the shade of the
 * source paint there, so the baked shading stays. Without a DOM (tests) it has no textures.
 */
export function streetCarMaterial(): Material {
  if (material) return material;
  const load = (uri: string, srgb: boolean): Texture => {
    const t = new TextureLoader().load(uri);
    // glTF uv: origin top left.
    t.flipY = false;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const dom = typeof document !== 'undefined';
  const mask = dom ? load(maskUrl, false) : null;
  const m = new MeshStandardMaterial({
    map: dom ? load(atlasUrl, true) : null,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.3,
  });
  m.onBeforeCompile = (shader, renderer) => {
    // The world shading's uniforms (fog, lights) come with the default hook (engine/world-shading.ts).
    Material.prototype.onBeforeCompile.call(m, shader, renderer);
    shader.uniforms.tintMask = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tintMask;',
      )
      // The paint colour is applied below, through the mask.
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_COLOR
        diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, texture2D( tintMask, vMapUv ).r );
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'street-car-tint';
  m.name = 'street_car';
  material = m;
  return m;
}
