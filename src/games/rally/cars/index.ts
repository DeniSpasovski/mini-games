import { CARS_LIST, released } from '../release';
import { audiRs6 } from './audi-rs6/audi-rs6';
import { bimmerGt2 } from './bimmer-gt2/bimmer-gt2';
import { bimmerM3 } from './bimmer-m3/bimmer-m3';
import { citroenC4 } from './citroen-c4/citroen-c4';
import { fiesta } from './fiesta/fiesta';
import { fordGt3 } from './ford-gt3/ford-gt3';
import { merc190 } from './merc-190/merc-190';
import { lancerEvo6 } from './lancer-evo-6/lancer-evo-6';
import { peugeot206 } from './peugeot-206/peugeot-206';
import { pezetka } from './pezetka/pezetka';
import { porsche911930 } from './porsche-911-930/porsche-911-930';
import type { CarDef } from './shared/types';
import { skodaRally } from './skoda-rally/skoda-rally';
import { subie22b } from './subie-22b/subie-22b';
import { subieWrxSti } from './subie-wrx-sti/subie-wrx-sti';
import { zastava101 } from './zastava-101/zastava-101';

/** Car registry in menu order (AWD, FWD, RWD; each by name), test-only cars included. Add new cars here + a `hideInProd` row to CARS_LIST in release.ts (see .claude/skills/rally-content). */
export const ALL_CARS: CarDef[] = [
  citroenC4,
  fiesta,
  lancerEvo6,
  audiRs6,
  skodaRally,
  subie22b,
  subieWrxSti,
  // FWD, by name
  peugeot206,
  zastava101,
  // RWD, by name
  bimmerGt2,
  bimmerM3,
  fordGt3,
  merc190,
  pezetka,
  porsche911930,
];

/** Cars this build offers: ALL_CARS on the dev server, those without `hideInProd` in the published build (release.ts). */
export const CARS: CarDef[] = released(ALL_CARS, CARS_LIST);

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
