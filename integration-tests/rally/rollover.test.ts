import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { applySetup } from '../../src/games/rally/physics/car-setup';
import { SURFACES } from '../../src/games/rally/physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
  SetupId,
} from '../../src/games/rally/physics/types';
import { Vehicle } from '../../src/games/rally/physics/vehicle';
import { carDef, run } from './handling-harness';

/**
 * Rollover margin (headless): a car slides sideways at 80 km/h with locked wheels into a kerb (tarmac, a step up) or a
 * ditch (gravel, a step down) 5 m away. A real car may flip on a big step, so only small ones are guarded: the softest
 * and stiffest set-up of every car must stay on its wheels at 15 and 25 cm. Lowering `forceHeight` / the anti-roll bars
 * (more lean) must not eat that margin.
 */
const STEP_X = 5;

function stepGround(surface: 'tarmac' | 'gravel', dh: number): GroundProvider {
  return {
    sampleGround(x: number, _z: number, out: GroundSample) {
      out.height = x > STEP_X ? dh : 0;
      out.normal.set(0, 1, 0);
      out.surface = SURFACES[surface];
      return out;
    },
    queryColliders: () => 0,
  };
}

/** Lowest `up.y` of the car (1 = upright, < 0.3 = flipped) while it slides over the step. */
function slide(
  car: string,
  setup: SetupId,
  surface: 'tarmac' | 'gravel',
  dh: number,
  kmh = 80,
): number {
  const v = new Vehicle(applySetup(carDef(car), setup), stepGround(surface, dh));
  v.setTyre(surface);
  v.reset(new Vector3(), 0);
  run(v, 1.5);
  v.velocity.copy(v.right).multiplyScalar(kmh / 3.6);
  for (const w of v.wheels) w.omega = 0;
  let minUp = 1;
  run(v, 4, () => {
    v.controls.brake = 1;
    v.controls.throttle = 0;
    minUp = Math.min(minUp, v.up.y);
  });
  return minUp;
}

describe('rollover margin', () => {
  for (const c of ALL_CARS)
    test(c.id, () => {
      for (const setup of ['soft', 'stiff'] as const)
        for (const surface of ['tarmac', 'gravel'] as const)
          for (const dh of [0.15, 0.25]) {
            const up = slide(c.id, setup, surface, surface === 'tarmac' ? dh : -dh);
            expect(up, `${setup} ${surface} ${dh} m`).toBeGreaterThan(0.3);
          }
    });
});
