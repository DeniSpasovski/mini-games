/**
 * Fences and low walls along the stage road that OSM does not map (the references), drawn and made solid like the
 * mapped ones (landmarks/osm-features.ts): `from` / `to` m along, `side` of the road going up, the line `offset` m past
 * the road edge.
 */
export interface RoadLine {
  kind: 'fence' | 'wall';
  /**
   * fence: `log` = the brown timber fence with a diagonal brace in every bay, `metal` = a steel post-and-rail railing
   * (else timber rails).
   */
  type?: 'log' | 'metal';
  side: 'left' | 'right';
  from: number;
  to: number;
  offset: number;
}

export const ROAD_LINES: RoadLine[] = [
  // the start street (Salvador Aljende): low walls with steel railings on the left in front of the gardens, behind the
  // sidewalk first, then on the verge; a chain-link fence along the left of the bend before the crossroad
  { kind: 'wall', side: 'left', from: 8, to: 120, offset: 1.9 },
  { kind: 'fence', type: 'metal', side: 'left', from: 8, to: 120, offset: 1.9 },
  { kind: 'wall', side: 'left', from: 180, to: 258, offset: 1.2 },
  {
    kind: 'fence',
    type: 'metal',
    side: 'left',
    from: 180,
    to: 258,
    offset: 1.2,
  },
  // (the references: a wire fence in the scrub behind the grass strip, all along the left of the straight to the crossroad)
  {
    kind: 'fence',
    type: 'metal',
    side: 'left',
    from: 262,
    to: 396,
    offset: 2.6,
  },
  // (no wall at the road edge before the big hairpin: the hikers' car park there has its own, trail-lot.ts)
  // past the big hairpin: the island's own log fence (trail-lot.ts, to ~2 064 m) carries on behind a white gravel strip
  // to the roofed notice board
  {
    kind: 'fence',
    type: 'log',
    side: 'right',
    from: 2064,
    to: 2085,
    offset: 1.6,
  },
  // the light log fence over the drop below the finish (no guard rail there: map.ts NO_DROP_RAIL), gravel behind it, up
  // to the finish junction's mouth
  {
    kind: 'fence',
    type: 'log',
    side: 'right',
    from: 4060,
    to: 4198,
    offset: 0.6,
  },
];

/**
 * Small pieces by the road the references show (generic: blank or plain boards, no text or logos), `at` m along, `offset` m
 * past the road edge, facing the road; `to` + `every` = a row of them.
 */
export interface RoadPoint {
  kind:
    | 'board'
    | 'sign_direction'
    | 'sign_info'
    | 'kiosk'
    | 'concrete_block'
    | 'timber_bollard'
    | 'border_stone';
  side: 'left' | 'right';
  at: number;
  offset: number;
  to?: number;
  every?: number;
}

export const ROAD_POINTS: RoadPoint[] = [
  // the lookout junction: the roofed notice board by its mouth, a board on the left past it
  { kind: 'board', side: 'right', at: 668, offset: 4.5 },
  { kind: 'board', side: 'left', at: 702, offset: 2.2 },
  // the blue information sign before the big hairpin, its yellow direction board at the turn
  { kind: 'sign_info', side: 'left', at: 1868, offset: 1.4 },
  { kind: 'sign_direction', side: 'right', at: 1990, offset: 1.8 },
  // the roofed notice board at the end of the island's fence
  { kind: 'board', side: 'right', at: 2088, offset: 2.6 },
  // Vidikovec: timber bollards along the grass strip in front of the stone wall, white border stones past the lot rail
  {
    kind: 'timber_bollard',
    side: 'left',
    at: 2862,
    to: 2926,
    every: 3,
    offset: 1.3,
  },
  {
    kind: 'border_stone',
    side: 'right',
    at: 2903,
    to: 2928,
    every: 1.6,
    offset: 0.9,
  },
  // the finish junction: the restaurant / hotel boards, a kiosk, a concrete block on the left
  { kind: 'sign_direction', side: 'right', at: 4250, offset: 1.6 },
  { kind: 'board', side: 'right', at: 4284, offset: 2.4 },
  { kind: 'kiosk', side: 'right', at: 4300, offset: 5 },
  { kind: 'concrete_block', side: 'left', at: 4240, offset: 1.4 },
];
