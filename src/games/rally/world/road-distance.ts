import type { Road } from './road';

/**
 * Distance from a point to the stage road for ANY range (the Road grid only knows its ~40 m influence):
 * brute force over a coarse polyline of the road, fine for "within 130 m of the stage" tests.
 */
export function nearestRoadPoint(
  road: Road,
  step = 12,
): (x: number, z: number) => { d: number; x: number; z: number } {
  const pts: { x: number; z: number }[] = [];
  for (let d = 0; d <= road.length; d += step) pts.push(road.at(d));
  return (x, z) => {
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) [best, bx, bz] = [d, p.x, p.z];
    }
    return { d: best, x: bx, z: bz };
  };
}
