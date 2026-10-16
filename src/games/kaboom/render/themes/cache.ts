import type { BufferGeometry } from 'three';

/**
 * Geometry is built once and shared by every Arena (a new round makes a new Arena: rebuilding the merged models cost a
 * visible hitch). It lives for the page's lifetime, so Arena.dispose leaves it alone. Keys carry the level id.
 */
const sharedGeos = new Map<string, BufferGeometry>();
export function shared(
  key: string,
  build: () => BufferGeometry,
): BufferGeometry {
  let g = sharedGeos.get(key);
  if (!g) sharedGeos.set(key, (g = build()));
  return g;
}

const sharedObjects = new Map<string, unknown>();
/** Any other build-once value (a pair of geometries, a texture). */
export function sharedValue<T>(key: string, build: () => T): T {
  let v = sharedObjects.get(key) as T | undefined;
  if (v === undefined) sharedObjects.set(key, (v = build()));
  return v;
}
