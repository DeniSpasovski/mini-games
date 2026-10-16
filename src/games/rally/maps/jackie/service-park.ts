import type { ServiceLot, ServicePark } from '../shared/types';

/**
 * Parc fermé of The Jackie: ten team cars parked along the kerb on both sides of the stage road at the start line, five
 * on the street east of it and five on the inner lane of the opposite carriageway west of it, side-on to the start. Both
 * lots lie over those roads (`paved`) and are `parallel`: the cars nose to tail on the side facing the stage, the crowd
 * on the strip between. Nothing is levelled, the roads keep their own surface.
 */
export const EAST_STREET: ServiceLot = {
  x: -2808.1,
  z: 1857.6,
  heading: -1.6988,
  length: 33,
  width: 5,
  bays: 5,
  paved: true,
  parallel: true,
};

export const WEST_LANE: ServiceLot = {
  x: -2837.4,
  z: 1857.5,
  heading: 1.6208,
  length: 33,
  width: 4.1,
  bays: 5,
  paved: true,
  parallel: true,
};

export const JACKIE_PARK: ServicePark = {
  lots: [EAST_STREET, WEST_LANE],
  bays: 10,
  ferme: true,
  crowd: 24,
};
