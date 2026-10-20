import type { StageDef, StageTemps } from '../shared/types';

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (the
 * matrix of every stage is in rally DETAILS.md "Temperatures", source figures in PHYSICS.md "Climate"). Valid at the stage start (its lowest
 * point; higher up the car is colder, `AIR_LAPSE`). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the stage's own slot at its own hour). Basis: Kriva Palanka (about 480 m, the stage start), average daily maximum and minimum of May, July and September.
 */
const TEMPS: StageTemps = {
  spring: {
    early: [11, 14],
    midday: [19, 37],
    afternoon: [21, 35],
    evening: [20, 31],
    night: [11, 11],
  },
  summer: {
    early: [16, 20],
    midday: [26, 47],
    afternoon: [28, 46],
    evening: [28, 42],
    night: [17, 17],
  },
  autumn: {
    early: [11, 11],
    midday: [21, 35],
    afternoon: [24, 34],
    evening: [23, 30],
    night: [14, 14],
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
