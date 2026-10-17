import type { ServiceLot, ServicePark } from '../shared/types';

/**
 * Parc fermé of the Vodno hillclimb: six team cars parked along the side street that leaves the run-up street about 140 m
 * before the start line and runs west to the large buildings (its straight west leg, 58 m long). The lot lies over that
 * street (`paved`, `parallel`): the cars stand nose to tail against the north kerb facing the crowd on the open grass, the team
 * tents behind them on the south half of the carriageway. Nothing is levelled, the street keeps its own surface.
 */
export const SIDE_STREET: ServiceLot = {
  x: 1432.6,
  z: -1082.3,
  heading: -2.96,
  length: 39,
  width: 6.2,
  bays: 6,
  paved: true,
  parallel: true,
};

export const VODNO_PARK: ServicePark = {
  lots: [SIDE_STREET],
  bays: 6,
  ferme: true,
  crowd: 30,
};
