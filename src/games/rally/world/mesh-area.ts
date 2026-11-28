import type { PathNetwork } from './real-data';

/**
 * The part of the map a mesh job builds, an x / z box (m): the map viewer builds the view of a camera link first, then
 * the whole map (`RoadMeshOptions.area`). Undefined = the whole map.
 */
export interface MeshArea {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The box spanned by (x0, z0) and (x1, z1), grown by `pad` m, reaches into `area` (always without one). */
export function inArea(
  area: MeshArea | undefined,
  x0: number,
  z0: number,
  x1 = x0,
  z1 = z0,
  pad = 0,
): boolean {
  return (
    !area ||
    (Math.max(x0, x1) + pad >= area.minX &&
      Math.min(x0, x1) - pad <= area.maxX &&
      Math.max(z0, z1) + pad >= area.minZ &&
      Math.min(z0, z1) - pad <= area.maxZ)
  );
}

/** A flat x, z list (an outline / polyline) reaches into `area`, grown by `pad` m. */
export function ptsInArea(
  area: MeshArea | undefined,
  pts: ArrayLike<number>,
  pad = 0,
): boolean {
  if (!area) return true;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    z0 = Math.min(z0, pts[i + 1]);
    z1 = Math.max(z1, pts[i + 1]);
  }
  return inArea(area, x0, z0, x1, z1, pad);
}

/** Way `pi` between `from` and `to` m along reaches into `area`, grown by `pad` m (sampled every `step` m). */
export function wayInArea(
  area: MeshArea | undefined,
  net: PathNetwork,
  pi: number,
  from: number,
  to: number,
  pad = 0,
  step = 10,
): boolean {
  if (!area) return true;
  const p = { x: 0, z: 0 };
  for (let a = from; ; a += step) {
    net.pointAt(pi, Math.min(a, to), p);
    if (inArea(area, p.x, p.z, p.x, p.z, pad + step)) return true;
    if (a >= to) return false;
  }
}
