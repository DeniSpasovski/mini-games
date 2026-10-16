import type { StageDef } from '../shared/types';
import { JACKIE_PARK } from './service-park';

/** The stages on the Jackie map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const jackieStages: StageDef[] = [
  {
    id: 'jackie',
    name: 'The Jackie',
    year: 2026,
    /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
    tyre: 'tarmac',
    // Fast parkway: the race cars' long final drive (Skoda Rally ~205 km/h instead of 165).
    gearing: 'long',
    description:
      'A fast, narrow parkway in New York City, driven from Brooklyn into Queens: tight bends under tall trees, bridges overhead, a concrete median and guard rails close on both sides, and a long run into the Kew Gardens interchange.',
    // Finish at 7 298 m: past the Queens Blvd portal (7 186-7 273 m), 2 m before the last green gantry (7 300 m; the two
    // gantries clipped when they stood on the same spot).
    timing: { start: 40, finishFromEnd: 47, splits: 4 },
    // Side roads / ramps meeting the stage road are closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
    // Fans, marshals and photographers behind the tape in the bends, at the side-road mouths, the start and the finish.
    cornerFans: { maxRadius: 160, chance: 0.6 },
    // Parc fermé: ten team cars parked side-on to the start, five each side of the stage road (./service-park.ts).
    servicePark: JACKIE_PARK,
  },
];
