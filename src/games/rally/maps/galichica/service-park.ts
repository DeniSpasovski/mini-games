import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Parc fermé of the Galichica stages: a row of team cars on a small gravel lay-by beside the road behind the start
 * line. Ohrid side (Galichica West): 6 cars on the right, about 60 m before the park entrance. Prespa side (Galichica
 * East, From Prespa to Ohrid): 5 cars on the left, on the approach to the hairpin start. The pads belong to the map,
 * so both lay-bys are there on every stage; only the stage that starts beside one gets the cars.
 */
export const OHRID_LOT: ServiceLot = {
  x: -4684.4,
  z: 1262.1,
  heading: -1.2118,
  length: 28,
  width: 12.5,
  bays: 6,
};

export const PRESPA_LOT: ServiceLot = {
  x: 4425.5,
  z: -788.0,
  heading: 4.6437,
  length: 24,
  width: 12.5,
  bays: 5,
};

/** The road beside each lot (along it): its level follows it. */
const OHRID_FRONTAGE = [-4702.1, 1270.4, -4692.1, 1244.2];
const PRESPA_FRONTAGE = [4413.3, -775.2, 4411.6, -799.1];

/** The strip between a lot's public edge and the road is levelled with it (m): no bump or ditch in front of the cars. */
const APRON = 3.5;

export const galichicaLotPads = (): PadDef[] => [
  servicePad(OHRID_LOT, OHRID_FRONTAGE, 8, APRON),
  servicePad(PRESPA_LOT, PRESPA_FRONTAGE, 8, APRON),
];

export const OHRID_PARK: ServicePark = {
  lots: [OHRID_LOT],
  bays: 6,
  ferme: true,
  crowd: 24,
};

export const PRESPA_PARK: ServicePark = {
  lots: [PRESPA_LOT],
  bays: 5,
  ferme: true,
  crowd: 24,
};
