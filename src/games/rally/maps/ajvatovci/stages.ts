import type { StageDef } from '../shared/types';
import { AJVATOVCI_PARK } from './service-park';

/** The stages on the Ajvatovci map (./map.ts). The id is the map's old id: stored times are keyed by it. */
export const ajvatovciStages: StageDef[] = [
  {
    id: 'ajvatovci',
    name: 'Ajvatovci Hill',
    year: 2026,
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
    servicePark: AJVATOVCI_PARK,
  },
];
