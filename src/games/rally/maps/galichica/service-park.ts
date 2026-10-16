import { servicePad } from '../shared/service-lot';
import type { PadDef, ServiceLot, ServicePark } from '../shared/types';

/**
 * Parc fermé of the Galichica stages: a row of team cars on a small gravel lay-by beside the road behind the start
 * line. Ohrid side (Galichica West): 6 cars on the right, about 60 m before the park entrance. Prespa side (Galichica
 * East, From Prespa to Ohrid): 5 cars on the left, on the approach to the hairpin start. The pads belong to the map,
 * so both lay-bys are there on every stage; only the stage that starts beside one gets the cars.
 */
export const OHRID_LOT: ServiceLot = {
  x: -4683.6,
  z: 1262.4,
  heading: -1.2118,
  length: 28,
  width: 9,
  bays: 6,
};

export const PRESPA_LOT: ServiceLot = {
  x: 4426.4,
  z: -788.1,
  heading: 4.6437,
  length: 24,
  width: 9,
  bays: 5,
};

/** The road beside each lot (along it): its level follows it. */
const OHRID_FRONTAGE = [-4702.1, 1270.4, -4692.1, 1244.2];
const PRESPA_FRONTAGE = [4413.3, -775.2, 4411.6, -799.1];

export const galichicaLotPads = (): PadDef[] => [
  servicePad(OHRID_LOT, OHRID_FRONTAGE),
  servicePad(PRESPA_LOT, PRESPA_FRONTAGE),
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
