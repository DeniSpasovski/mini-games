import { linkPad, servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Service park of the Ajvatovci stage. Lot 1: the empty field south of the road between the start line and the A2
 * (right of the run-up), 11 m off the road's centre line, 64 x 15 m, its long side parallel to the road, one row of bays
 * with 4 team cars. Lot 2 (the west park): the field north-west of it beside the road that runs up to the factory (about
 * 150 m from the start): one row of bays with 6 team cars whose public edge faces that road, five team trucks parked across
 * the gravel behind them, noses to the west.
 */
export const START_LOT: ServiceLot = {
  x: -1440.8,
  z: 444.7,
  heading: -0.2164,
  length: 64,
  width: 15,
  cars: 4,
  // Lean: the four cars with 2-3 mechanics each, a crowd of 20 and 5 photographers.
  mechanics: [2, 3],
  crowd: 20,
  press: 5,
};

/** Along the road to the factory (8.8 deg off north-south), the public edge facing it, 13 m from its centre line. */
export const FIELD_LOT: ServiceLot = {
  x: -1574.2,
  z: 353.2,
  heading: 1.7254,
  length: 72,
  width: 36,
  cars: 6,
  semis: 5,
  links: [18, 38, 58],
  // Behind the start: a full paddock (more people), drawn only once the player drives up to it (free drive).
  crowd: 40,
  showWithin: 90,
};

/** The stage road beside lot 1 (west to east): its level follows it. */
const FRONTAGE = [-1493.8, 436.6, -1454.6, 428.7, -1415.4, 420.5];

export const startLotPad = (): PadDef => servicePad(START_LOT, FRONTAGE);

/** The field is flat to within a metre: one fixed level. */
export const fieldLotPad = (): PadDef => ({
  ...servicePad(FIELD_LOT, []),
  level: 0,
});

/**
 * Three dirt links from the west park's public edge up the verge to the road: the road stands about a metre above the field,
 * so each ramp ends at the road's own level (reach and height measured at u = 18, 38, 58).
 */
export const fieldLinkPads = (): PadDef[] => [
  linkPad(FIELD_LOT, 18, 8, 1.05),
  linkPad(FIELD_LOT, 38, 8.6, 1.03),
  linkPad(FIELD_LOT, 58, 9.2, 0.45),
];

export const AJVATOVCI_PARK: ServicePark = {
  lots: [START_LOT, FIELD_LOT],
  bays: 12,
  gap: 3,
  startControl: true,
};
