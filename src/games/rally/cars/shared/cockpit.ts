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

/** The cockpit with its seats where they are fitted (`seat.drop` taken off their heights). */
export function fitted(cp: Cockpit): Cockpit {
  const d = cp.seat.drop ?? 0;
  if (!d) return cp;
  const [z0, y0, z1, y1] = cp.seat.back;
  return {
    ...cp,
    seat: {
      ...cp.seat,
      cushion: cp.seat.cushion - d,
      back: [z0, y0 - d, z1, y1 - d],
      drop: 0,
    },
  };
}
