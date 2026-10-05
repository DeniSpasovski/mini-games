import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { holeFade } from './materials';

/** Fade zone radius, as a multiple of the hole's on-screen radius. */
const FADE_RADIUS = 1.8;
const tmp = new Vector3();

/**
 * Building fade: tell the item material where the hole is on screen so that
 * anything nearer to the camera and drawn over it turns into a dither.
 * Call once per frame, after the camera moved and before rendering.
 */
export function updateHoleFade(
  camera: PerspectiveCamera,
  x: number,
  z: number,
  diameter: number,
  bufferWidth: number,
  bufferHeight: number,
): void {
  camera.updateMatrixWorld();
  tmp.set(x, 0, z).applyMatrix4(camera.matrixWorldInverse);
  const depth = -tmp.z;
  if (depth <= 0.1) {
    holeFade.uHoleFade.value.w = 0;
    return;
  }
  tmp.applyMatrix4(camera.projectionMatrix);
  const radius = diameter / 2;
  const pxPerMetre =
    bufferHeight / 2 / (depth * Math.tan(MathUtils.degToRad(camera.fov / 2)));
  holeFade.uHoleFade.value.set(
    (tmp.x * 0.5 + 0.5) * bufferWidth,
    (tmp.y * 0.5 + 0.5) * bufferHeight,
    depth,
    radius * FADE_RADIUS * pxPerMetre,
  );
  holeFade.uFadeMargin.value = radius * 1.3 + 1;
}

/** Switch the fade off (menus, viewers). */
export function clearHoleFade(): void {
  holeFade.uHoleFade.value.w = 0;
}
