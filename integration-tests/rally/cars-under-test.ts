import { ALL_CARS } from '../../src/games/rally/cars';
import type { CarDef } from '../../src/games/rally/cars/shared/types';

/**
 * The cars that cover the range: the weakest RWD (Fiat 126p, 23 hp, rear engine), the weakest FWD (Zastava), the
 * reference AWD rally car (Fabia), the strongest RWD (M3 GT2: wheelspin, oversteer) and the strongest, heaviest AWD
 * (RS6). The autopilot is speed-capped, so the other cars drive the same line within a few percent: when the weak cars
 * finish, the strong ones do too, and the strong ones show what power and weight break.
 */
export const REPRESENTATIVE_CARS = [
  'pezetka',
  'zastava_101',
  'skoda_rally',
  'bimmer_gt2',
  'audi_rs6',
];

/**
 * Cars the per-car playtests drive, from `RALLY_CARS`: unset or `all` = every car (local runs, pushes to main); otherwise
 * `REPRESENTATIVE_CARS` plus the comma-separated car ids listed (CI on a PR: the cars whose files it changed, from
 * scripts/ci-affected.mjs).
 */
export function carsUnderTest(): CarDef[] {
  const env = process.env.RALLY_CARS?.trim();
  if (env === undefined || env === 'all') return ALL_CARS;
  const ids = new Set([
    ...REPRESENTATIVE_CARS,
    ...env.split(',').filter(Boolean),
  ]);
  return ALL_CARS.filter((c) => ids.has(c.id));
}
