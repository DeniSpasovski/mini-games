/**
 * How each surveyed building at the Kew Gardens end looks (one record per building, by its city BIN): the walls,
 * windows, trim and roof details seen in the drive video (opposite lane 0:36-1:20) and the 2024 state aerial photo.
 * The shapes (walls and roofs) are the city's 3-D building model (kew-shapes.json); this file adds what the survey has
 * not got. Faces are picked by the compass bearing they face (0 = north, 90 = east).
 */

/** Apartment blocks, towers and offices: the city model's walls with windows cut in. */
export interface BlockStyle {
  type: 'block';
  /** Wall finish: face brick (tinted), painted render, or a glass curtain wall. */
  wall: 'brick' | 'render' | 'glass';
  /** Brick / render / glass colour. */
  tint: string;
  /** Glass curtain walls: the lighter panes on the faces of these bearings (deg, +-12). */
  light?: { bearings: number[]; tint: string };
  /** Ground floor height (m) and the typical floor above it. */
  ground: number;
  floor: number;
  /** Window: width, height, sill above the floor line, bay pitch; `pair` windows per bay (0.3 m pier between). */
  win: { w: number; h: number; sill: number; bay: number; pair?: number };
  /** Window frames (double-hung sashes) and the glass. */
  frame: string;
  /** Stone sills under the windows. */
  sill?: string;
  /** A brick soldier course / stone lintel over the windows. */
  lintel?: string;
  /** Stone string courses (heights above ground, m). */
  bands?: { at: number[]; color: string };
  /** Projecting cornice under the parapet coping. */
  cornice?: string;
  /** Parapet coping. */
  coping: string;
  /** Share of windows with an air conditioner in the lower sash. */
  ac?: number;
  /** Steel fire escapes: the face (bearing) and where along it (0..1 of the face). */
  fire?: { face: number; at: number[] }[];
  /**
   * Stacked balconies (slab + railing) on the faces of these bearings, from floor `from` up: across the whole face, or
   * stacks `width` m wide centred at `at` (0..1 of the face).
   */
  balconies?: {
    faces: number[];
    from: number;
    rail: string;
    at?: number[];
    width?: number;
  };
  /** Full-height strips of lighter brick (no windows behind them) at `at` (0..1 of each face wider than 12 m). */
  pilasters?: { at: number[]; width: number; color: string };
  /** Stone base over the ground floor (walls standing on the ground). */
  plinth?: string;
  /** Flat roof colour (tar / white coating). */
  roof: string;
  /** Parts with their own windows / trim: walls whose top is at least `minTop` m (first match). */
  parts?: { minTop: number; style: Partial<BlockStyle> }[];
}

/** Detached / semi-detached Tudor houses: brick ground floor, half-timbered upper floor, red tile roofs. */
export interface HouseStyle {
  type: 'house';
  /** Ground floor brick colour. */
  brick: string;
  /** Upper floor: brick, or stucco with dark timbers. */
  upper: 'brick' | 'timber';
  stucco: string;
  timber: string;
  /** Eaves height above ground (m); the ridge is the survey height. */
  eaves: number;
  /** Roof tiles. */
  tiles: string;
  /** Window frames. */
  frame: string;
  /** The front cross gable faces this bearing (the street side). */
  front: number;
}

export type KewStyle = BlockStyle | HouseStyle;

// Prewar six-storey blocks (1923-1932) along Union Tpke and Austin St: liver / red-brown brick, white double-hung
// sashes, limestone sills and string courses, air conditioners, black steel fire escapes (frames t1-06 .. t1-10).
const PREWAR: BlockStyle = {
  type: 'block',
  wall: 'brick',
  tint: '#93796d',
  ground: 3.6,
  floor: 3.05,
  win: { w: 0.85, h: 1.6, sill: 0.8, bay: 2.9, pair: 2 },
  frame: '#ece9e2',
  sill: '#cfc6b4',
  lintel: '#86685e',
  bands: { at: [3.3], color: '#cbbfa9' },
  cornice: '#bdb3a2',
  coping: '#b7ad9c',
  ac: 0.22,
  roof: '#9a9792',
};

// Four-storey walk-ups (C1) of the same years: the same brick and trim, lower.
const WALKUP: BlockStyle = { ...PREWAR, tint: '#b3a592', ground: 3.4 };

// The two 20-storey buff-brick towers of 1973-74 (118-17 / 118-18 Union Tpke): small punched windows in dark frames,
// balcony stacks with white rails on the ends and the wide faces, lighter brick piers between the window columns, the
// machine room on top (frames t1-03 .. t1-06).
const TOWER: BlockStyle = {
  type: 'block',
  wall: 'brick',
  tint: '#d9c6a2',
  ground: 4,
  floor: 2.75,
  win: { w: 1.25, h: 1.45, sill: 0.75, bay: 3.4 },
  frame: '#5b5750',
  coping: '#ece8df',
  ac: 0.08,
  roof: '#77756f',
  pilasters: { at: [0.33, 0.67], width: 1.2, color: '#e8dcc2' },
};

// Kew Gardens' Tudor houses on Union Tpke and Markwood Pl (1920-25): brick ground floor, stucco and dark timber
// upstairs, steep red clay tile roofs with a cross gable to the street (aerial photo, frames t1-12 .. t1-20).
const TUDOR: HouseStyle = {
  type: 'house',
  brick: '#8f6a5c',
  upper: 'timber',
  stucco: '#e6dfcf',
  timber: '#4a3a30',
  eaves: 5.6,
  tiles: '#8e5a48',
  frame: '#f1eee6',
  front: 135,
};

export const KEW_STYLES: Record<number, KewStyle> = {
  // 118-17 Union Tpke: buff brick tower, balconies down its north-west end
  4079634: {
    ...TOWER,
    balconies: {
      faces: [325, 55, 235],
      from: 2,
      rail: '#f0eee8',
      at: [0.15, 0.85],
      width: 4.2,
    },
  },
  // 118-18 Union Tpke: its twin across the parkway, a touch paler
  4079667: {
    ...TOWER,
    tint: '#e0cfac',
    balconies: {
      faces: [145, 55, 235],
      from: 2,
      rail: '#f0eee8',
      at: [0.15, 0.85],
      width: 4.2,
    },
  },
  // 80-02 Kew Gardens Rd (80-02 Queens Blvd): dark blue glass office tower of 1989, a stepped band of pale blue
  // glass down its east corner (frames t0-36 .. t0-47)
  4312089: {
    type: 'block',
    wall: 'glass',
    tint: '#10141b',
    light: { bearings: [20, 75, 200, 260], tint: '#7f98b0' },
    ground: 4.5,
    floor: 3.9,
    win: { w: 1.5, h: 3.9, sill: 0, bay: 1.5 },
    frame: '#20262e',
    coping: '#b9bcc0',
    roof: '#8d8b86',
  },
  // 78-14 Austin St (1932): six storeys, fire escapes on the parkway side
  4079633: { ...PREWAR, fire: [{ face: 140, at: [0.3, 0.75] }] },
  // 117-14 Union Tpke (1923)
  4079199: { ...PREWAR, tint: '#907468', fire: [{ face: 320, at: [0.5] }] },
  // 80-15 Grenfell St (1930)
  4079666: { ...PREWAR, tint: '#998073', fire: [{ face: 320, at: [0.35] }] },
  // 119-40 Union Tpke (1926): six storeys at the parkway
  4080004: {
    ...PREWAR,
    tint: '#9a8a7c',
    plinth: '#cfc6b4',
    fire: [{ face: 320, at: [0.4] }],
  },
  // 119-14 / 119-20 Union Tpke (1923-26): four-storey walk-ups
  4080002: { ...WALKUP, fire: [{ face: 320, at: [0.5] }] },
  4080003: { ...WALKUP, tint: '#aa9b88', fire: [{ face: 320, at: [0.5] }] },
  // 80-04 Austin St (1930): two four-storey wings
  4434543: { ...WALKUP, tint: '#a08a7a' },
  4434541: { ...WALKUP, tint: '#a08a7a' },
  // By the tunnel portal (no lot record): a 12-storey tower of brown-buff brick, its north wing with bands of three
  // dark windows and blank brick bays, over a six-storey tan wing with tall paired windows (frames t0-45 .. t0-58)
  4312087: {
    type: 'block',
    wall: 'brick',
    tint: '#cdb48f',
    ground: 3.6,
    floor: 3.0,
    win: { w: 0.75, h: 1.9, sill: 0.7, bay: 2.6, pair: 2 },
    frame: '#3d3b38',
    sill: '#d6ccb8',
    coping: '#cfc6b6',
    ac: 0.05,
    roof: '#8a8884',
    parts: [
      {
        minTop: 25,
        style: {
          tint: '#b49c80',
          floor: 2.95,
          win: { w: 1.7, h: 1.25, sill: 0.85, bay: 2.1 },
          frame: '#2f2d2b',
          sill: undefined,
        },
      },
    ],
  },
  // 119-17 Union Tpke: the low white rendered building on the cut's north rim, a band of windows on each floor
  4079979: {
    type: 'block',
    wall: 'render',
    tint: '#f2f0ea',
    ground: 4.2,
    floor: 3.8,
    win: { w: 1.4, h: 1.5, sill: 0.9, bay: 1.6 },
    frame: '#5e6266',
    coping: '#dcdad4',
    roof: '#6c6f74',
  },
  // 112-09 Queens Blvd (1983): 16-storey office tower of tan brick north of the interchange, rows of paired windows
  // (frames t0-38 .. t0-44)
  4052811: {
    type: 'block',
    wall: 'brick',
    tint: '#c9ad88',
    ground: 4.5,
    floor: 3.6,
    win: { w: 1.2, h: 1.5, sill: 0.9, bay: 3.2, pair: 2 },
    frame: '#3a3936',
    coping: '#d8cfbe',
    roof: '#85837e',
  },
  // 424 Burns St (1935): a brick two-family house, tile roof
  4079635: { ...TUDOR, upper: 'brick', front: 225 },
  // Tudor houses on the north side of Union Tpke and Markwood Pl
  4079189: TUDOR,
  4079186: { ...TUDOR, tiles: '#86533f' },
  4079183: { ...TUDOR, brick: '#866254' },
  4079182: { ...TUDOR, tiles: '#86533f', front: 225 },
  4079190: { ...TUDOR, upper: 'brick' },
  4079070: { ...TUDOR, brick: '#866254' },
  4079188: { ...TUDOR, tiles: '#93604c' },
  4521553: { ...TUDOR, eaves: 3.2 },
  4079187: { ...TUDOR, upper: 'brick', tiles: '#86533f' },
  4079184: TUDOR,
  4079185: { ...TUDOR, brick: '#866254' },
  4079191: { ...TUDOR, front: 225 },
  4079069: { ...TUDOR, tiles: '#93604c' },
};
