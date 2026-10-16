import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Parc fermé of the Test map: four team cars on a small gravel lot left of the straight run-up behind the start line,
 * the public edge facing the road.
 */
export const TEST_LOT: ServiceLot = {
  x: -245.8,
  z: -385.0,
  heading: -Math.PI / 2,
  length: 19,
  width: 12.5,
  bays: 4,
};

/** The road beside the lot (west to east along it): its level follows it. */
const FRONTAGE = [-262, -375.5, -262, -394.5];

export const testLotPad = (): PadDef => servicePad(TEST_LOT, FRONTAGE);

export const TEST_PARK: ServicePark = {
  lots: [TEST_LOT],
  bays: 4,
  ferme: true,
  crowd: 20,
};
