import type { Camera } from 'three';

/**
 * Layer of meshes drawn only into shadow maps (tree crown proxies): the main camera never walks them, where a mesh
 * hidden per frame (`count = 0`) still cost a program and uniform set-up per draw. Shadow cameras list it with
 * `shadowCasterLayers` (three r187+ walks a shadow camera's own layers when it has any besides 0).
 */
export const SHADOW_ONLY_LAYER = 6;

/** A light's shadow camera sees the default layer and SHADOW_ONLY_LAYER. */
export function shadowCasterLayers(camera: Camera): void {
  camera.layers.set(0);
  camera.layers.enable(SHADOW_ONLY_LAYER);
}
