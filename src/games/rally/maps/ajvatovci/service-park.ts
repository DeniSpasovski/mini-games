import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Service park at the start of the Ajvatovci stage: the empty field south of the road between the start line and the A2
 * (right of the run-up), 11 m off the road's centre line, 84 x 28 m, its long side parallel to the road.
 */
export const START_LOT: ServiceLot = {
  x: -1449.2,
  z: 453.2,
  heading: -0.2164,
  length: 84,
  width: 28,
};

/** The stage road beside the lot (west to east): the lot's level follows it. */
const FRONTAGE = [-1493.8, 436.6, -1454.6, 428.7, -1415.4, 420.5];

export const startLotPad = (): PadDef => servicePad(START_LOT, FRONTAGE);

export const AJVATOVCI_PARK: ServicePark = {
  lots: [START_LOT],
  bays: 12,
  crowd: 34,
  startControl: true,
};
