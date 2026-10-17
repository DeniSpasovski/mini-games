import type { PadDef, RoadMarking } from '../shared/types';

/**
 * The first crossroad (about 445 m along the road): the road widens to three lanes (`LANE_EXTRA` in map.ts) and the land on
 * its right side stands as a terrace above it, held back by a concrete retaining wall (`road.cutWalls` over `WALL_RANGE`).
 * The terrace is a graded pad that keeps `BANK` m above the road, between the road's right side and 17 m off it.
 */
export const BANK = 3.2;
/** Distances along the road (m) between which the cut is sheer and walled. */
export const WALL_RANGE: [number, number] = [398, 492];

/** The road's centre every 10 m from 390 to 500 m along: the pad's heights follow it. */
const ROAD: number[] = [
  1703.9, -910.4, 1712.1, -904.6, 1720.0, -898.5, 1727.8, -892.2, 1735.2,
  -885.5, 1742.1, -878.3, 1748.5, -870.6, 1754.7, -862.7, 1760.3, -854.5,
  1765.1, -845.7, 1769.9, -836.9, 1774.6, -828.1,
];
/** The terrace's inner edge (5.8 m to the right of the road's centre) 400..490 m along, then its outer edge (18 m) back. */
const TERRACE: number[] = [
  1708.6, -899.9, 1716.4, -893.9, 1724.0, -887.7, 1731.2, -881.3, 1737.8,
  -874.4, 1744.0, -867.0, 1750.1, -859.3, 1755.4, -851.5, 1760.0, -843.0,
  1764.8, -834.1, 1754.1, -828.2, 1749.2, -837.4, 1744.9, -845.2, 1740.3,
  -852.0, 1734.6, -859.3, 1728.6, -866.3, 1722.7, -872.5, 1716.1, -878.4,
  1708.9, -884.3, 1701.3, -890.1,
];

/**
 * The first crossroad (445 m along): the road widens to three lanes, the extra lane on the right (the uphill side, where the
 * retaining wall stands), and narrows again after it. Extra width (m) at distances along the route, linear between.
 */
const LANE_EXTRA: readonly (readonly [number, number])[] = [
  [366, 0],
  [391, 1.2],
  [429, 2.9],
  [453, 2.9],
  [486, 1.0],
  [505, 0],
];
export const laneExtra = (along: number): number => {
  if (along <= LANE_EXTRA[0][0]) return 0;
  for (let i = 1; i < LANE_EXTRA.length; i++) {
    const [a1, e1] = LANE_EXTRA[i];
    if (along > a1) continue;
    const [a0, e0] = LANE_EXTRA[i - 1];
    return e0 + ((e1 - e0) * (along - a0)) / (a1 - a0);
  }
  return 0;
};
/** The widened stretch: its texture has no lines, every line is paint (`MARKINGS`). */
export const WIDE_FROM = 366;
export const WIDE_TO = 505;
/** Where the side street meets the left edge (about 447 m along): the left edge line and the centre line stop for it (m along the road). */
export const JUNCTION: [number, number] = [443.5, 450.7];
/** The road before it widens is 6.4 m wide: its centre line is 3.2 m from the left edge, and stays there (the left edge stays where it is). */
const CENTRE = 3.2;
/** The road's edge lines sit this far in from its edges (the texture's own edge line is 5% of 6.4 m in). */
const EDGE = 0.32;
/** The two lanes of the widened side (everything right of the centre line) are as wide as each other. */
const FULL = 6.4 + 2.9;
const DIVIDER = (CENTRE + FULL) / 2;
const DOUBLE_GAP = 0.12;
const LINE = 0.15;

/** A line over [from, to]; `open` leaves the side street's mouth (`JUNCTION`) out of it. */
const line = (
  from: number,
  to: number,
  edge: 'left' | 'right',
  offset: number,
  open: boolean,
  width = LINE,
): RoadMarking[] =>
  (open
    ? [
        [from, Math.min(to, JUNCTION[0])],
        [Math.max(from, JUNCTION[1]), to],
      ]
    : [[from, to]]
  )
    .filter(([a, b]) => b > a)
    .map(([a, b]) => ({ kind: 'line', from: a, to: b, edge, offset, width }));

/**
 * Lane paint of the first crossroad, uphill (the stage's direction), all measured from the road's edges so each line keeps
 * its place as the road widens on the right: the edge lines (the road texture has none here), a double solid centre line
 * on the texture's own centre line, the left lane of the climb a turn-left-only pocket (arrow) beside the straight-ahead
 * lane (arrow, dashed line between them). The edge and centre lines stop at the side street's mouth (`JUNCTION`).
 */
export const MARKINGS: RoadMarking[] = [
  ...line(WIDE_FROM, WIDE_TO, 'left', EDGE, true),
  ...line(WIDE_FROM, WIDE_TO, 'right', EDGE, false),
  ...[-1, 1].flatMap((k) =>
    line(WIDE_FROM, 490, 'left', CENTRE + k * DOUBLE_GAP, true, 0.13),
  ),
  ...line(490, WIDE_TO, 'left', CENTRE, true),
  {
    kind: 'line',
    from: 398,
    to: 478,
    edge: 'left',
    offset: DIVIDER,
    width: LINE,
    dash: [2, 3],
  },
  ...[412, 430].flatMap((at): RoadMarking[] => [
    {
      kind: 'arrow',
      arrow: 'left',
      at,
      edge: 'left',
      offset: (CENTRE + DIVIDER) / 2,
    },
    {
      kind: 'arrow',
      arrow: 'straight',
      at,
      edge: 'left',
      offset: 7.5,
    },
  ]),
];

/** The road's centre line moves right by half the extra width: the extra lane is on the right, the left edge stays. */
export const laneShift = (along: number): number => laneExtra(along) / 2;

export const CROSSROAD_BANK: PadDef = {
  name: 'crossroad_bank',
  polygon: TERRACE,
  blend: 6,
  frontage: ROAD,
  lift: BANK,
};
