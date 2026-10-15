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
 * public edge (`frontage`: two road points beside it, west to east) and blends back to the land over `blend` m.
 */
export function servicePad(
  lot: ServiceLot,
  frontage: number[],
  blend = 8,
): PadDef {
  const corners = [
    lotWorld(lot, 0, 0),
    lotWorld(lot, lot.length, 0),
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
