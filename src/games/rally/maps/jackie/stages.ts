import type { StageDef, StageTemps } from '../shared/types';

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (the
 * matrix of every stage is in rally DETAILS.md "Temperatures", source figures in PHYSICS.md "Climate"). Valid at the stage start (its lowest
 * point; higher up the car is colder, `AIR_LAPSE`). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the stage's own slot at its own hour). Summer: a mild morning.
 */
const TEMPS: StageTemps = {
  spring: {
    early: [9, 18],
    midday: [15, 30],
    afternoon: [17, 27],
    evening: [15, 18],
    night: [5, 5],
  },
  summer: {
    early: [17, 28],
    midday: [23, 42],
    afternoon: [25, 37],
    evening: [23, 26],
    night: [13, 13],
  },
  autumn: {
    early: [11, 15],
    midday: [17, 25],
    afternoon: [19, 24],
    evening: [17, 19],
    night: [7, 7],
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
  },
];
