import type { StageDef, StageTemps } from '../shared/types';
import { JACKIE_PARK } from './service-park';

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (the
 * matrix of every stage is in rally DETAILS.md "Temperatures", source figures in PHYSICS.md "Climate"). Valid at the stage start (its lowest
 * point; higher up the car is colder, `AIR_LAPSE`). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the stage's own slot at its own hour). Basis: LaGuardia 1991-2020 normals (average high and low) of May, July and October.
 */
const TEMPS: StageTemps = {
  spring: {
    early: [15, 21],
    midday: [20, 38],
    afternoon: [22, 39],
    evening: [22, 34],
    night: [16, 16],
  },
  summer: {
    early: [24, 31],
    midday: [28, 50],
    afternoon: [30, 51],
    evening: [30, 45],
    night: [24, 24],
  },
  autumn: {
    early: [12, 13],
    midday: [17, 26],
    afternoon: [19, 27],
    evening: [19, 23],
    night: [14, 14],
  },
};

/** The stages on the Jackie map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const jackieStages: StageDef[] = [
  {
    id: 'jackie',
    name: 'The Jackie',
    year: 2026,
    temps: TEMPS,
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
