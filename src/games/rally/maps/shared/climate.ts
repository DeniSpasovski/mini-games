import { sunAt } from '../../engine/environment';
import { climateFor, type Climate } from '../../physics/tyre-temp';
import type { EnvironmentDef } from './types';

/**
 * Tyre-temperature climate of a stage (physics/tyre-temp.ts): `airTemp`, the sun height (`timeOfDay` or
 * `sunElevation`; pass the game's effective one after `?tod=`) and the clouds.
 */
export function stageClimate(
  env: EnvironmentDef,
  sunElevation?: number,
  air = env.airTemp ?? 20,
): Climate {
  const elevation =
    sunElevation ??
    (env.timeOfDay !== undefined
      ? sunAt(env.timeOfDay).elevation
      : env.sunElevation);
  return climateFor(air, elevation, env.cloudCoverage ?? 0.4);
}
