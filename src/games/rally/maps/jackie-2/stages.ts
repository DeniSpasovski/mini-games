import type { StageDef } from '../shared/types';
import { jackieStages } from '../jackie/stages';

/**
 * The stage on the Jackie 2 map (./map.ts): the same parkway as The Jackie on the v2 road engine (test map). Same
 * climate, so it shares the Jackie temperatures.
 */
export const jackie2Stages: StageDef[] = [
  {
    id: 'jackie_2',
    name: 'The Jackie 2',
    year: 2026,
    temps: jackieStages[0].temps,
    tyre: 'tarmac',
    gearing: 'long',
    description:
      'The Jackie Robinson Parkway rebuilt on the v2 road engine: every road, junction, bridge, tunnel and retaining wall generated from OpenStreetMap and lidar terrain. 7.4 km of 1930s parkway from East New York to Kew Gardens.',
    // The finish at 7 500 m: past the Queens Blvd portal (7 320-7 407 m); the run-out carries on ~200 m along the
    // parkway (network.json `stage.runout`), ending before the flyover onto the Grand Central.
    timing: { start: 175, finishFromEnd: 202.9, splits: 4 },
  },
];
