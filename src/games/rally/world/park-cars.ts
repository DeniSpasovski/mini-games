import { TEAM_COUNT } from '../assets/builders/teams';

/**
 * The real rally cars a service park shows (released GLB cars only). Each has a cheap copy of its model,
 * `public/models/cars/<id>_park.glb` (three body LODs + rims, scripts/car-model/park-lods.mjs); a new released car
 * gets one and a line here. A team runs the car `parkCarId(team)` in its colours (a works team's two cars are one model).
 */
export const PARK_CAR_IDS: readonly string[] = [
  'skoda_rally',
  'bimmer_m3',
  'bimmer_gt2',
  'fiesta',
  'citroen_c4',
  'lancer_evo_6',
  'ford_gt3',
  'merc_190',
  'audi_rs6',
];

/** The car model of a team (`team_car` variant % TEAM_COUNT). */
export const parkCarId = (team: number): string =>
  PARK_CAR_IDS[(team % TEAM_COUNT) % PARK_CAR_IDS.length];
