import { ALL_CARS } from '../../src/games/rally/cars';
import type { CarDef } from '../../src/games/rally/cars/shared/types';

/**
 * One car per drive type: the reference AWD rally car (Fabia), the weakest FWD (Zastava) and the strongest RWD (M3 GT2:
 * wheelspin, oversteer). The autopilot is speed-capped, so the other cars drive the same line within a few percent; a
 * change to a car adds that car (scripts/ci-affected.mjs), and pushes to main drive every car.
 */
export const REPRESENTATIVE_CARS = ['skoda_rally', 'zastava_101', 'bimmer_gt2'];

/** A comma-separated env list: undefined when unset or `all` (= everything), else the ids. */
function envList(name: string): Set<string> | undefined {
  const env = process.env[name]?.trim();
  if (env === undefined || env === 'all') return undefined;
  return new Set(env.split(',').filter(Boolean));
}

/**
 * Cars the per-car playtests drive, from `RALLY_CARS`: unset or `all` = every car (local runs, pushes to main); otherwise
 * `REPRESENTATIVE_CARS` plus the comma-separated car ids listed (CI on a PR: the cars whose files it changed, from
 * scripts/ci-affected.mjs).
 */
export function carsUnderTest(): CarDef[] {
  const ids = envList('RALLY_CARS');
  if (!ids) return ALL_CARS;
  return ALL_CARS.filter(
    (c) => REPRESENTATIVE_CARS.includes(c.id) || ids.has(c.id),
  );
}

/**
 * The maps (of `mapIds`) the worst-tyre hill test drives `carId` on, from `RALLY_HILL_CARS` (cars on every map) and
 * `RALLY_HILL_MAPS` (maps with the representative cars): unset or `all` = every map. CI on a PR sets both from the
 * changed cars and map roads (scripts/ci-affected.mjs), so an unrelated PR skips it.
 */
export function hillMaps(carId: string, mapIds: string[]): string[] {
  const cars = envList('RALLY_HILL_CARS');
  if (!cars || cars.has(carId)) return mapIds;
  if (!REPRESENTATIVE_CARS.includes(carId)) return [];
  const maps = envList('RALLY_HILL_MAPS');
  return maps ? mapIds.filter((m) => maps.has(m)) : mapIds;
}
