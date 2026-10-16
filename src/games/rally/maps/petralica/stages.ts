import type { StageDef, StageTemps } from '../shared/types';

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (the
 * matrix of every stage is in rally DETAILS.md "Temperatures", source figures in PHYSICS.md "Climate"). Valid at the stage start (its lowest
 * point; higher up the car is colder, `AIR_LAPSE`). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the stage's own slot at its own hour). Autumn: a September afternoon (dry golden grass), a cool autumn day.
 */
const TEMPS: StageTemps = {
  spring: {
    early: [2, 7],
    midday: [10, 25],
    afternoon: [11, 18],
    evening: [10, 13],
    night: [0, 0],
  },
  summer: {
    early: [8, 14],
    midday: [16, 35],
    afternoon: [17, 25],
    evening: [16, 19],
    night: [6, 6],
  },
  autumn: {
    early: [4, 9],
    midday: [12, 25],
    afternoon: [13, 19],
    evening: [12, 14],
    night: [2, 2],
  },
};

/** The stages on the Petralica map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const petralicaStages: StageDef[] = [
  {
    id: 'petralica',
    name: 'Petralica',
    year: 2026,
    temps: TEMPS,
    /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
    tyre: 'gravel',
    description:
      'A mountain stage in North Macedonia: a fast run up a valley through fields, then a twisty climb through oak woods and open pasture to the finish high on the mountain. Asphalt at first, gravel from about halfway, climbing from 478 m to over 1,000 m.',
    timing: { start: 40, finishFromEnd: 150, splits: 4 },
    // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
    // Small fan groups (tape, spectators, flags) inside the tight corners.
    cornerFans: {},
  },
];
