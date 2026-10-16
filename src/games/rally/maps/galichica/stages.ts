import type { ClosureRule, StageDef, StageTemps } from '../shared/types';

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

/**
 * Air and road temperature (°C, `[air, road]`) by season and time of day: hardcoded for the stage, researched (rally
 * DETAILS.md "Temperatures"). The road is the stage's first surface; a time of day is a slot of game/time-of-day.ts (the
 * stage's own slot at its own hour).
 */
const TEMPS: StageTemps = {
  spring: {
    early: [6, 19],
    midday: [10, 27],
    afternoon: [12, 24],
    evening: [11, 13],
    night: [1, 1],
  },
  summer: {
    early: [12, 29],
    midday: [16, 38],
    afternoon: [18, 33],
    evening: [17, 20],
    night: [7, 7],
  },
  autumn: {
    early: [9, 16],
    midday: [13, 22],
    afternoon: [15, 21],
    evening: [14, 15],
    night: [4, 4],
  },
};

export const galichicaStages: StageDef[] = [
  {
    id: 'galichica_west',
    name: 'Galichica West',
    year: 2026,
    temps: TEMPS,
    tyre: 'tarmac',
    description:
      'A narrow mountain road in Galichica National Park, North Macedonia: tarmac switchbacks climb from Lake Ohrid through oak and beech woods to the Livada pass, with both lakes in the distance.',
    timing: {
      start: PARK_ENTRANCE,
      finishFromEnd: ROAD_LENGTH - MAGARO,
      splits: 3,
    },
    closures: CLOSURES,
    cornerFans: { from: PARK_ENTRANCE + 150, to: MAGARO - 150 },
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
    temps: TEMPS,
    tyre: 'tarmac',
    description:
      'The same mountain road from the Prespa side: tarmac switchbacks through beech forest up to the bare, rocky top of the Livada pass, with both lakes below.',
    reverse: true,
    timing: {
      start: ROAD_LENGTH - PRESPA,
      finishFromEnd: MAGARO,
      splits: 3,
    },
    closures: CLOSURES,
    cornerFans: {
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
    temps: TEMPS,
    tyre: 'tarmac',
    gearing: 'long',
    description:
      'The whole Galichica crossing in one run: up from Lake Prespa, over the Livada pass and down through the woods to Lake Ohrid. The longest stage.',
    reverse: true,
    timing: {
      start: ROAD_LENGTH - PRESPA,
      finishFromEnd: PARK_ENTRANCE,
      splits: 5,
    },
    closures: CLOSURES,
    cornerFans: {
      from: ROAD_LENGTH - PRESPA + 150,
      to: ROAD_LENGTH - PARK_ENTRANCE - 150,
    },
  },
];
