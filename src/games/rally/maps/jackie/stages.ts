import type { StageDef } from '../shared/types';

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
      'Real-world city stage in New York: the narrow, winding 1930s Jackie Robinson Parkway, from East New York north-east past Cypress Hills, Forest Park and the cemeteries to the Kew Gardens interchange in Queens. Tree-lined tarmac with bridges and underpasses, a concrete median and guard rails, sheer retaining-wall cuts and thousands of buildings from OpenStreetMap along the way.',
    // Finish at 7 298 m: past the Queens Blvd portal (7 186-7 273 m), 2 m before the last green gantry (7 300 m; the two
    // gantries clipped when they stood on the same spot).
    timing: { start: 40, finishFromEnd: 47, splits: 4 },
    // Side roads / ramps meeting the stage road are closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
  },
];
