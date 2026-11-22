import { Vector3 } from 'three';
import type { Cockpit } from './types';

/** The steering column's direction, from the rim toward the dash (model space, unit). */
export function wheelAxis(cp: Cockpit): Vector3 {
  const tilt = (cp.wheel.tilt * Math.PI) / 180;
  return new Vector3(0, -Math.sin(tilt), Math.cos(tilt));
}

/** Centre of the steering wheel's rim where the driver holds it: the modelled one, brought back by `wheel.pull`. */
export function wheelAt(cp: Cockpit): Vector3 {
  return new Vector3(...cp.wheel.at).addScaledVector(
    wheelAxis(cp),
    -(cp.wheel.pull ?? 0),
  );
}
