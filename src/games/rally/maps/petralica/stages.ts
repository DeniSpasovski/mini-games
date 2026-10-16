import type { StageDef } from '../shared/types';

/** The stages on the Petralica map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const petralicaStages: StageDef[] = [
  {
    id: 'petralica',
    name: 'Petralica',
    year: 2026,
    /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
    tyre: 'gravel',
    description:
      'Rankovce, North Macedonia: from Ginovci up the valley to Petralica, then a narrow switchback climb through oak woods. 9.6 km of tarmac and gravel.',
    timing: { start: 40, finishFromEnd: 150, splits: 4 },
    // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
    // Small fan groups (tape, spectators, flags) inside the tight corners.
    cornerFans: {},
  },
];
