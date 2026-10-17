import type { ClosureRule, StageDef } from '../shared/types';
import { VODNO_PARK } from './service-park';

/**
 * The Vodno stage (./map.ts): the hillclimb from the Vodno neighbourhood of Skopje up the hairpins of the north face of
 * Mount Vodno to Sredno Vodno. The road has a 259 m run-up before the start (Salvador Aljende street) and runs 187 m
 * on past the finish along the road to the summit. Distances along the game road, measured by
 * `tests/rally/vodno.test.ts` against the owner's points:
 */
/** Road length (m). */
export const ROAD_LENGTH = 4474;
/** Start: the owner's route start (Vodno neighbourhood). */
export const START = 259;
/** Finish: the road junction at Sredno Vodno, beside the restaurant the owner's route ends at. */
export const FINISH = 4287;

/** Side streets are closed along the stage only (a suburb has one every 50 m at the start). */
const CLOSURES: ClosureRule = {
  asset: 'road_barrier',
  length: 2.2,
  setback: 4,
  stageMargin: 60,
};

export const vodnoStages: StageDef[] = [
  {
    id: 'vodno',
    name: 'Vodno Hillclimb',
    year: 2026,
    tyre: 'tarmac',
    gearing: 'short',
    description:
      'Skopje, North Macedonia: from the Vodno neighbourhood up the hairpins on the north face of Mount Vodno, through the pine woods to Sredno Vodno, with the Millennium Cross on the ridge above. 4.0 km, 220 m of climb.',
    timing: {
      start: START,
      finishFromEnd: ROAD_LENGTH - FINISH,
      splits: 3,
    },
    closures: CLOSURES,
    servicePark: VODNO_PARK,
    cornerFans: { from: START + 150, to: FINISH - 150 },
    sources: [
      {
        label: 'Google Maps route (Vodno -> Sredno Vodno)',
        url: 'https://www.google.com/maps/dir/41.9808131,21.4219566/41.9752441,21.4096439',
        note: 'stage start and finish',
      },
    ],
  },
];
