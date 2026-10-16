import type { PadDef, ServiceLot } from './types';

/** World point of lot coordinates (u along the lot from its west end, v across from the public edge). */
export function lotWorld(
  lot: ServiceLot,
  u: number,
  v: number,
): [number, number] {
  const c = Math.cos(lot.heading);
  const s = Math.sin(lot.heading);
  const du = u - lot.length / 2;
  const dv = v - lot.width / 2;
  return [lot.x + du * c - dv * s, lot.z + du * s + dv * c];
}

/** Lot coordinates of a world point. */
export function lotLocal(
  lot: ServiceLot,
  x: number,
  z: number,
): [number, number] {
  const c = Math.cos(lot.heading);
  const s = Math.sin(lot.heading);
  const dx = x - lot.x;
  const dz = z - lot.z;
  return [dx * c + dz * s + lot.length / 2, -dx * s + dz * c + lot.width / 2];
}

/** The lot grown by `margin` m on every side contains (x, z). */
export function lotContains(
  lot: ServiceLot,
  x: number,
  z: number,
  margin = 0,
): boolean {
  const [u, v] = lotLocal(lot, x, z);
  return (
    u >= -margin &&
    u <= lot.length + margin &&
    v >= -margin &&
    v <= lot.width + margin
  );
}

/**
 * Level, gravelled yard for a service lot (`terrain.pads`): the rectangle follows the stage road's height along its
 * public edge (`frontage`: two road points beside it, west to east) and blends back to the land over `blend` m. An
 * `apron` (m) levels the strip in front of the public edge too, so the land between the lot and the road has no bump.
 */
export function servicePad(
  lot: ServiceLot,
  frontage: number[],
  blend = 8,
  apron = 0,
): PadDef {
  const corners = [
    lotWorld(lot, 0, -apron),
    lotWorld(lot, lot.length, -apron),
    lotWorld(lot, lot.length, lot.width),
    lotWorld(lot, 0, lot.width),
  ];
  return {
    name: 'service-park',
    polygon: corners.flat(),
    blend,
    frontage,
    lift: 0.02,
    surface: 'gravel',
  };
}

/** Width (m) of a dirt link (`ServiceLot.links`). */
export const LINK_WIDTH = 5;

/**
 * Dirt link from a lot's public edge across the verge to the road (a gravel ramp, `terrain.pads`): it starts level with the
 * lot (v = 0) and climbs to `rise` m above the lot's level `reach` m in front of the edge, just short of the road.
 */
export function linkPad(
  lot: ServiceLot,
  u: number,
  reach: number,
  rise: number,
  level = 0,
): PadDef {
  const h = LINK_WIDTH / 2;
  return {
    name: 'service-park-link',
    polygon: [
      ...lotWorld(lot, u - h, 1),
      ...lotWorld(lot, u + h, 1),
      ...lotWorld(lot, u + h, -reach),
      ...lotWorld(lot, u - h, -reach),
    ],
    blend: 2,
    frontage: [],
    level,
    lift: 0.02,
    ramp: {
      from: lotWorld(lot, u, 0),
      to: lotWorld(lot, u, -reach),
      lift: [0.02, rise],
    },
    surface: 'gravel',
  };
}
