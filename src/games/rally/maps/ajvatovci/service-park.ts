import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Service park of the Ajvatovci stage. Lot 1: the empty field south of the road between the start line and the A2
 * (right of the run-up), 11 m off the road's centre line, 84 x 28 m, its long side parallel to the road. Lot 2 (the west
 * park): the field north-west of it beside the road that runs up to the factory (about 150 m from the start): one row of
 * team bays whose public edge faces that road, five team trucks parked across the gravel behind them, noses to the west.
 */
export const START_LOT: ServiceLot = {
  x: -1449.2,
  z: 453.2,
  heading: -0.2164,
  length: 84,
  width: 28,
};

/** Along the road to the factory (8.8 deg off north-south), the public edge facing it, 13 m from its centre line. */
export const FIELD_LOT: ServiceLot = {
  x: -1574.5,
  z: 355.2,
  heading: 1.7254,
  length: 56,
  width: 36,
  semis: 5,
};

/** The stage road beside lot 1 (west to east): its level follows it. */
const FRONTAGE = [-1493.8, 436.6, -1454.6, 428.7, -1415.4, 420.5];

export const startLotPad = (): PadDef => servicePad(START_LOT, FRONTAGE);

/** The field is flat to within a metre: one fixed level. */
export const fieldLotPad = (): PadDef => ({
  ...servicePad(FIELD_LOT, []),
  level: 0,
});

export const AJVATOVCI_PARK: ServicePark = {
  lots: [START_LOT, FIELD_LOT],
  bays: 12,
  gap: 5,
  crowd: 60,
  startControl: true,
};
