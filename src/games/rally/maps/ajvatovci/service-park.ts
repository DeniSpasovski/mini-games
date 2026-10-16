import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Service park of the Ajvatovci stage. Lot 1: the empty field south of the road between the start line and the A2
 * (right of the run-up), 11 m off the road's centre line, 84 x 28 m, its long side parallel to the road. Lot 2: the
 * open field north-west of it beside the farm road (about 150 m from the start), one row of teams whose public edge
 * faces south, 9 m from the road, with three tractor-trailer team trucks along its back edge.
 */
export const START_LOT: ServiceLot = {
  x: -1449.2,
  z: 453.2,
  heading: -0.2164,
  length: 84,
  width: 28,
};

export const FIELD_LOT: ServiceLot = {
  x: -1622,
  z: 375,
  heading: Math.PI,
  length: 56,
  width: 17,
  semis: 3,
};

/** The stage road beside lot 1 (west to east): its level follows it. */
const FRONTAGE = [-1493.8, 436.6, -1454.6, 428.7, -1415.4, 420.5];

export const startLotPad = (): PadDef => servicePad(START_LOT, FRONTAGE);

/** The field is flat to within a metre: one fixed level. */
export const fieldLotPad = (): PadDef => ({
  ...servicePad(FIELD_LOT, []),
  level: 0.1,
});

export const AJVATOVCI_PARK: ServicePark = {
  lots: [START_LOT, FIELD_LOT],
  bays: 12,
  gap: 5,
  crowd: 60,
  startControl: true,
};
