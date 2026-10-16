import type { StageDef, StageTemps } from '../shared/types';

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (the
 * matrix of every stage is in rally DETAILS.md "Temperatures", source figures in PHYSICS.md "Climate"). Valid at the stage start (its lowest
 * point; higher up the car is colder, `AIR_LAPSE`). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the stage's own slot at its own hour). Summer: a hot dry June morning near Skopje (27 deg by 07:30 is a heatwave day with a clear sky). Humidity is not simulated.
 */
const TEMPS: StageTemps = {
  spring: {
    early: [13, 19],
    midday: [20, 32],
    afternoon: [21, 30],
    evening: [20, 22],
    night: [10, 10],
  },
  summer: {
    early: [27, 35],
    midday: [34, 53],
    afternoon: [35, 48],
    evening: [34, 37],
    night: [24, 24],
  },
  autumn: {
    early: [14, 18],
    midday: [21, 28],
    afternoon: [22, 28],
    evening: [21, 22],
    night: [11, 11],
  },
};

/** The stages on the Ajvatovci map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const ajvatovciStages: StageDef[] = [
  {
    id: 'ajvatovci',
    name: 'Ajvatovci Hill',
    year: 2026,
    temps: TEMPS,
    /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
    tyre: 'mixed',
    /** Long gearing on the long straights (cars that cannot change it ignore this). */
    gearing: 'long',
    description:
      'A short village stage in North Macedonia. It starts in the north of Ilinden, runs out along a farm road and then climbs Ajvatovci hill in tight switchbacks, finishing at the top beside the hilltop church. Old, narrow tarmac with a dusting of loose gravel.',
    timing: { start: 40, finishFromEnd: 150, splits: 3 },
    // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
    cornerFans: {},
  },
];
