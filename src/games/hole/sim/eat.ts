import { COMMIT, canEat } from './progression';

/** Hole centre must be this close (m) to an item's pivot for the item to commit to falling. */
export function commitRadius(holeDiameter: number, size: number): number {
  return holeDiameter / 2 - COMMIT * size;
}

/** True when the item can be eaten at this hole level and the hole is over it. */
export function startsFalling(
  level: number,
  holeDiameter: number,
  size: number,
  dist: number,
): boolean {
  return canEat(level, size) && dist <= commitRadius(holeDiameter, size);
}

/** Max teeter tilt (radians) of an item that is too big. */
export const TEETER_MAX = (6 * Math.PI) / 180;

/**
 * 0..1 amount an item that is too big should lean towards the hole: 0 when the
 * hole is far, 1 when its centre is right under the item.
 */
export function teeterAmount(
  holeDiameter: number,
  size: number,
  dist: number,
): number {
  const reach = holeDiameter / 2 + 0.25 * size;
  if (dist >= reach) return 0;
  return 1 - dist / reach;
}
