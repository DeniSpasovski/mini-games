import { AVAILABLE_CARS, released } from '../release';
import { bimmerGt2 } from './bimmer-gt2/bimmer-gt2';
import { bimmerM3 } from './bimmer-m3/bimmer-m3';
import { fiesta } from './fiesta/fiesta';
import { lancerEvo6 } from './lancer-evo-6/lancer-evo-6';
import type { CarDef } from './shared/types';
import { skodaRally } from './skoda-rally/skoda-rally';
import { zastava101 } from './zastava-101/zastava-101';

/** Car registry - every car, test-only ones included. Add new cars here + their id to TEST_CARS in release.ts (see .claude/skills/rally-content). */
export const ALL_CARS: CarDef[] = [
  skodaRally,
  zastava101,
  bimmerM3,
  bimmerGt2,
  fiesta,
  lancerEvo6,
];

/** Cars this build offers: ALL_CARS on the dev server, AVAILABLE_CARS in the published build (release.ts). */
export const CARS: CarDef[] = released(ALL_CARS, AVAILABLE_CARS);

/** Must be a released car (it's the fallback for hidden / unknown ids). */
export const DEFAULT_CAR = skodaRally.id;

/** An available car; hidden (test-only in the published build) or unknown ids fall back to the default. */
export function getCar(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? skodaRally;
}

/** Display name for any saved id (leaderboards can hold runs with a car this build hides). */
export function carName(id: string): string {
  return ALL_CARS.find((c) => c.id === id)?.name ?? id;
}
