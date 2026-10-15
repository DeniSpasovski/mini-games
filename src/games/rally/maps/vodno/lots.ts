import type { PadDef, PathDef } from '../shared/types';
import { lotPolygon, SREDNO, VIDIKOVEC } from './landmarks/car-parks';

/**
 * The two big car parks on the stage road: the Vidikovec viewpoint lot (beside a hairpin, 1.3 km below the finish) and the
 * Sredno Vodno lot at the finish. OSM draws them as thin aisle lines that stop short of the road; here the ground under
 * each is a graded pad following the road's height and the lot is an ai-generated model (landmarks/car-parks.ts).
 */
export const LOT_PADS: PadDef[] = [
  {
    name: 'vidikovec_lot',
    polygon: lotPolygon(VIDIKOVEC),
    blend: 6,
    // Stage road points along the lot (the pad takes their heights).
    frontage: [
      1500.2, -557.2, 1535, -574.6, 1553, -580.7, 1570.4, -584.9, 1591.3,
      -584.5, 1603.7, -581.2,
    ],
    lift: 0,
  },
  {
    name: 'sredno_lot',
    polygon: lotPolygon(SREDNO),
    blend: 6,
    frontage: [493.2, -314.5, 518.4, -321.1, 543.2, -328.6, 569.9, -332.7],
    lift: 0,
  },
];

/** The baked OSM aisle lines the lots replace (first point, rounded). */
const REPLACED = new Set(['1492,-570', '539,-349', '554,-339']);

export const dropLotAisles = (paths: PathDef[]): PathDef[] =>
  paths.filter(
    (p) => !REPLACED.has(`${Math.round(p.pts[0])},${Math.round(p.pts[1])}`),
  );

/**
 * The road that leaves the stage road to the right at the hairpin below the finish (OSM way, first point rounded): the
 * mountain road on towards the summit - narrower than the stage road, no kerbs or sidewalks.
 */
const SUMMIT_ROAD = '656,-343';

/** The nearest point of a polyline to (x, z). */
function snapToRoute(
  route: number[][],
  x: number,
  z: number,
): [number, number] {
  let best: [number, number, number] = [x, z, Infinity];
  for (let i = 1; i < route.length; i++) {
    const [x0, z0] = route[i - 1];
    const [x1, z1] = route[i];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const t = Math.max(
      0,
      Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)),
    );
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best[2]) best = [px, pz, d];
  }
  return [best[0], best[1]];
}

/** Narrows the summit road, drops its sidewalks and joins its end to the stage road (OSM stops 13 m short of it). */
export const countryRoad = (paths: PathDef[], route: number[][]): PathDef[] =>
  paths.map((p) =>
    `${Math.round(p.pts[0])},${Math.round(p.pts[1])}` === SUMMIT_ROAD
      ? {
          ...p,
          width: 5,
          bare: true,
          pts: [...snapToRoute(route, p.pts[0], p.pts[1]), ...p.pts],
        }
      : p,
  );
