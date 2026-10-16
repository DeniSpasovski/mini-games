import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Service park of the Ajvatovci stage. Lot 1: the empty field south of the road between the start line and the A2
 * (right of the run-up), 11 m off the road's centre line, 84 x 28 m, its long side parallel to the road. Lot 2: the
 * field north-west of it, beside the road that runs up to the factory (about 150 m from the start): one row of
 * team bays whose public edge faces that road. Lot 3: a truck yard in the field behind it, three tractor-trailer team
 * trucks side by side with the bays.
 */
export const START_LOT: ServiceLot = {
  x: -1449.2,
  z: 453.2,
  heading: -0.2164,
  length: 84,
  width: 28,
};

/** Along the road to the factory (8.8 deg off north-south), the public edge facing it, 13 m from its centre line. */
const FIELD_HEADING = 1.7254;

export const FIELD_LOT: ServiceLot = {
  x: -1563.1,
  z: 355,
  heading: FIELD_HEADING,
  length: 56,
  width: 13,
};

/** The team trucks: a yard 36 m behind the bays, in line with them. No bays, tape or crowd of its own. */
export const TRUCK_YARD: ServiceLot = {
  x: -1598.2,
  z: 349.5,
  heading: FIELD_HEADING,
  length: 56,
  width: 6,
  bays: 0,
  semis: 3,
  semiV: 3,
};

/** The stage road beside lot 1 (west to east): its level follows it. */
const FRONTAGE = [-1493.8, 436.6, -1454.6, 428.7, -1415.4, 420.5];

export const startLotPad = (): PadDef => servicePad(START_LOT, FRONTAGE);

/** The fields are flat to within a metre: one fixed level each. */
export const fieldLotPad = (): PadDef => ({
  ...servicePad(FIELD_LOT, []),
  level: 0.2,
});

export const truckYardPad = (): PadDef => ({
  ...servicePad(TRUCK_YARD, []),
  level: -0.3,
});

export const AJVATOVCI_PARK: ServicePark = {
  lots: [START_LOT, FIELD_LOT, TRUCK_YARD],
  bays: 12,
  gap: 5,
  crowd: 60,
  startControl: true,
};
