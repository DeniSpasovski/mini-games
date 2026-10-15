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
      'Real-world mountain stage in Rankovce, north-east North Macedonia: from Ginovci across the E-871 road and up the valley on a straight road through fields to Petralica village, then a twisty climb through oak woods and open pasture to Vila Ristovski. It climbs from 478 m to 1040 m: asphalt first, gravel from about halfway.',
    timing: { start: 40, finishFromEnd: 150, splits: 4 },
    // Every side road / track meeting the stage road is closed with barriers (as on a real stage).
    closures: { asset: 'road_barrier', length: 2.2, setback: 4 },
    // Small fan groups (tape, spectators, flags) inside the tight corners.
    cornerFans: {},
  },
];
