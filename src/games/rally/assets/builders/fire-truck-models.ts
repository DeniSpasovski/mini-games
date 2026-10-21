import {
  Material,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type BufferGeometry,
} from 'three';
import { FIRE_TRUCK_DATA } from './fire-trucks.data';
import usUrl from './fire-truck-us.jpg';
import mkUrl from './fire-truck-mk.jpg';
import { vehicleModel, type StreetCarShape } from './street-car-models';

/**
 * The two fire engines (credits: THIRD-PARTY.md): `fire_truck`, the US engine of Jackie, and `fire_truck_mk`, the
 * engine of the Macedonian maps. Models face +X, origin on the ground under the middle, real size; baked by
 * `scripts/car-model/bake-fire-trucks.mjs` into `fire-trucks.data.ts`. Each has its own texture atlas and keeps its
 * own livery (no paint tint), so only the maps that place one load its image.
 */
export type FireTruckId = 'fire_truck' | 'fire_truck_mk';

const ATLAS: Record<FireTruckId, string> = {
  fire_truck: usUrl,
  fire_truck_mk: mkUrl,
};

/** The engine `id` at `lod` (0 near); `geometry()` has position, normal and uv only. */
export function fireTruckModel(id: FireTruckId, lod: number): StreetCarShape {
  const index = FIRE_TRUCK_DATA.findIndex((d) => d.id === id);
  const shape = vehicleModel(FIRE_TRUCK_DATA, index, lod);
  return {
    ...shape,
    geometry: (paintHex) => {
      const g: BufferGeometry = shape.geometry(paintHex);
      g.deleteAttribute('color');
      return g;
    },
  };
}

const materials = new Map<FireTruckId, Material>();

/** The material of engine `id`: its atlas as it is, lit like the street cars. Without a DOM (tests) it has no texture. */
export function fireTruckMaterial(id: FireTruckId): Material {
  let m = materials.get(id);
  if (m) return m;
  let map = null;
  if (typeof document !== 'undefined') {
    map = new TextureLoader().load(ATLAS[id]);
    // glTF uv: origin top left.
    map.flipY = false;
    map.anisotropy = 4;
    map.colorSpace = SRGBColorSpace;
  }
  m = new MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.3 });
  m.name = id;
  materials.set(id, m);
  return m;
}
