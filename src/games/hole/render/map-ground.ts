import type { Object3D } from 'three';
import type { MapData } from '../map/types';
import { buildAnimalGround } from './animal-ground';
import { buildGround } from './ground';
import { buildToyGround } from './toy-ground';

/** Ground (and walls / water) for whichever map this is. */
export function buildMapGround(map: MapData): Object3D {
  if (map.terrain) return buildAnimalGround(map);
  return map.bounds ? buildToyGround(map) : buildGround(map);
}

/** Free the GPU buffers of a ground group built by `buildMapGround`. */
export function disposeGround(obj: Object3D): void {
  obj.traverse((o) => {
    const m = o as {
      geometry?: { dispose(): void };
      material?: { dispose(): void };
    };
    m.geometry?.dispose();
  });
}
