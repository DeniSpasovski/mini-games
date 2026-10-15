import type { ClosureRule, StageDef } from '../shared/types';

/**
 * The three stages on the Galichica road (./map.ts). The road runs west -> east: 280 m of the Ohrid lakeside road
 * (run-up / run-out), the pass road R2332, 270 m of the Prespa road. Distances along it of the stage ends, measured on
 * the game road (`tests/rally/galichica.test.ts` checks them against the owner's points):
 */
/** Road length (m). */
export const ROAD_LENGTH = 27954;
/** National park entrance above Lake Ohrid (west start). */
export const PARK_ENTRANCE = 282;
/** Magaro trail parking at the Livada pass (finish of both climbs). */
export const MAGARO = 14967;
/** Prespa side, above the lake shore (east start). */
export const PRESPA = 27681;

/** Closures only along the stage: on the climbs the far side of the pass stays open. */
const CLOSURES: ClosureRule = {
  asset: 'road_barrier',
  length: 2.2,
  setback: 4,
  stageMargin: 60,
};

export const galichicaStages: StageDef[] = [
  {
    id: 'galichica_west',
    name: 'Galichica West',
    year: 2026,
    tyre: 'tarmac',
    description:
      'Galichica National Park, North Macedonia: from Lake Ohrid up the switchbacks through oak and beech woods to the Livada pass. 14.7 km of narrow mountain tarmac.',
    timing: {
      start: PARK_ENTRANCE,
      finishFromEnd: ROAD_LENGTH - MAGARO,
      splits: 3,
    },
    closures: CLOSURES,
    cornerFans: { flag: 'mk', from: PARK_ENTRANCE + 150, to: MAGARO - 150 },
    sources: [
      {
        label: 'Google Maps route (park entrance -> Magaro trail parking)',
        url: 'https://www.google.com/maps/dir/40.9440267,20.789616/40.9537817,20.8289773',
        note: 'stage start and finish',
      },
    ],
  },
  {
    id: 'galichica_east',
    name: 'Galichica East',
    year: 2026,
    tyre: 'tarmac',
    description:
      'Galichica National Park, North Macedonia: from Lake Prespa up through beech forest to the bare karst top of the Livada pass. 12.7 km.',
    reverse: true,
    timing: {
      start: ROAD_LENGTH - PRESPA,
      finishFromEnd: MAGARO,
      splits: 3,
    },
    closures: CLOSURES,
    cornerFans: {
      flag: 'mk',
      from: ROAD_LENGTH - PRESPA + 150,
      to: ROAD_LENGTH - MAGARO - 150,
    },
    sources: [
      {
        label: 'Google Maps route (Prespa -> Magaro trail parking)',
        url: 'https://www.google.com/maps/dir/40.9612712,20.8976721/40.9537817,20.8289773',
        note: 'stage start and finish',
      },
    ],
  },
  {
    id: 'prespa_ohrid',
    name: 'From Prespa to Ohrid',
    year: 2026,
    tyre: 'tarmac',
    gearing: 'long',
    description:
      'The whole Galichica crossing: from Lake Prespa over the Livada pass and down to Lake Ohrid. 27.4 km.',
    reverse: true,
    timing: {
      start: ROAD_LENGTH - PRESPA,
      finishFromEnd: PARK_ENTRANCE,
      splits: 5,
    },
    closures: CLOSURES,
    cornerFans: {
      flag: 'mk',
      from: ROAD_LENGTH - PRESPA + 150,
      to: ROAD_LENGTH - PARK_ENTRANCE - 150,
    },
  },
];
