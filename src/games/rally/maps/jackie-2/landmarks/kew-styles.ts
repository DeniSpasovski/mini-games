/**
 * How each surveyed building at the Kew Gardens end looks (one record per building, by its city BIN): the walls,
 * windows, trim and roof details seen in the drive video (opposite lane 0:36-1:20) and the 2024 state aerial photo.
 * The shapes (walls and roofs) are the city's 3-D building model (kew-shapes.json); this file adds what the survey has
 * not got. Faces are picked by the compass bearing they face (0 = north, 90 = east).
 */

/** Apartment blocks, towers and offices: the city model's walls with windows cut in. */
export interface BlockStyle {
  type: 'block';
  /** Raise (+) / lower (-) the whole building (m): where the survey's ground or roofs disagree with the lidar. */
  lift?: number;
  /** Wall finish: face brick (tinted), painted render, or a glass curtain wall. */
  wall: 'brick' | 'render' | 'glass';
  /** Brick / render / glass colour. */
  tint: string;
  /** Glass curtain walls: the lighter panes on the faces of these bearings (deg, +-12), no wider than `maxWidth` m. */
  light?: {
    bearings: number[];
    tint: string;
    maxWidth?: number;
    stripe?: string;
  };
  /** Glass curtain walls: the mullion grid colour (default `frame`). */
  mullion?: string;
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
  /** Pitched (hipped) roofs instead of flat ones: the eaves `rise` m under the survey height, slate / shingle colour. */
  hip?: { rise: number; tiles: string };
  /** Piers (flat pilasters) between every window bay. */
  piers?: { width: number; color: string };
  /** A lantern cupola on the roof over world (x, z). */
  cupola?: { x: number; z: number; color: string; roof: string };
  /** Far off the road: windows as panes on the wall face (no holes, reveals or trim). */
  far?: boolean;
  /**
   * Parts with their own windows / trim: walls whose top is at least `minTop` m and, with `near`, whose middle lies
   * within `near[2]` m of world (`near[0]`, `near[1]`) (first match).
   */
  parts?: {
    minTop: number;
    near?: [number, number, number];
    style: Partial<BlockStyle>;
  }[];
}

/** Detached / semi-detached Tudor houses: brick ground floor, half-timbered upper floor, red tile roofs. */
export interface HouseStyle {
  type: 'house';
  lift?: number;
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
  tint: '#a0837a',
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
  tiles: '#7a4a3d',
  frame: '#f1eee6',
  front: 135,
};

// Tan concrete office slabs: long dark ribbon windows between deep spandrels (frames t0-27 .. t0-31).
const RIBBON: BlockStyle = {
  type: 'block',
  wall: 'render',
  tint: '#ccb995',
  ground: 5,
  floor: 3.5,
  win: { w: 2.85, h: 1.45, sill: 1.0, bay: 3.0 },
  frame: '#2b2a28',
  coping: '#d6c9ab',
  roof: '#8f8c85',
  far: true,
};

// Tall buff brick towers far off the road: punched windows in pairs.
const FAR_TOWER: BlockStyle = {
  type: 'block',
  wall: 'brick',
  tint: '#c9ad88',
  ground: 4.5,
  floor: 2.8,
  win: { w: 1.2, h: 1.4, sill: 0.8, bay: 3.2, pair: 2 },
  frame: '#3a3936',
  coping: '#d8cfbe',
  roof: '#85837e',
  far: true,
};

// Two-storey brick row houses: white sashes, a soldier course over the windows, a light flat roof.
const ROW: BlockStyle = {
  type: 'block',
  wall: 'brick',
  tint: '#9b6e5d',
  ground: 3.1,
  floor: 2.9,
  win: { w: 0.9, h: 1.45, sill: 0.85, bay: 2.3 },
  frame: '#eeebe4',
  sill: '#cfc6b4',
  lintel: '#7d5a4d',
  coping: '#c9c2b5',
  ac: 0.15,
  roof: '#d4d1ca',
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
    tint: '#2a3a5c',
    light: {
      bearings: [20, 75, 200, 260],
      tint: '#a7bfd3',
      maxWidth: 4,
      stripe: '#eef2f4',
    },
    mullion: '#6c7684',
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
  4080002: {
    ...WALKUP,
    tint: '#ddd3c2',
    lift: -0.6,
    fire: [{ face: 320, at: [0.5] }],
  },
  4080003: { ...WALKUP, tint: '#d8cbb6', fire: [{ face: 320, at: [0.5] }] },
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
  // 119-17 Union Tpke (Kew-Forest School) on the cut's north rim: a long white front, tall windows between flat
  // pilasters, grey slate hipped roofs; the red brick wing at the west end under a white cupola (frames t0-59 .. t1-04,
  // aerial photo)
  4079979: {
    type: 'block',
    wall: 'render',
    tint: '#f1efe8',
    ground: 4.0,
    floor: 3.9,
    win: { w: 1.25, h: 2.3, sill: 0.8, bay: 2.6 },
    frame: '#4f5357',
    sill: '#e4e1d8',
    coping: '#f4f2ec',
    roof: '#7d8085',
    hip: { rise: 2.6, tiles: '#80848a' },
    piers: { width: 0.7, color: '#fbfaf6' },
    cupola: { x: 2481.2, z: -1705.1, color: '#f6f5f0', roof: '#6f7378' },
    parts: [
      {
        minTop: 0,
        near: [2481, -1705, 14],
        style: {
          wall: 'brick',
          tint: '#9a5f4c',
          win: { w: 1.1, h: 1.9, sill: 0.9, bay: 2.6 },
          frame: '#f2f0ea',
          piers: undefined,
        },
      },
    ],
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
  // 118-01 Queens Blvd (1963): six-storey office block at the Union Tpke corner, pale buff brick with long bands of
  // windows, a machine room on the white roof (aerial photo)
  4052809: {
    type: 'block',
    lift: -0.6,
    wall: 'brick',
    tint: '#d6c7ac',
    ground: 4.8,
    floor: 3.9,
    win: { w: 1.6, h: 1.7, sill: 1.0, bay: 1.75 },
    frame: '#45474a',
    sill: '#ddd5c4',
    coping: '#e6e1d6',
    roof: '#c9c7c1',
  },
  // 78-11 Kew Forest Ln (1920): four-storey walk-up on the cut's north rim
  4079999: { ...WALKUP, tint: '#a3887a', fire: [{ face: 140, at: [0.5] }] },
  // Queens Borough Hall, 120-55 Queens Blvd (1940): long four-storey wings of red-brown brick with limestone trim,
  // rows of white sashes, tar roofs with plant rooms (aerial photo, frames t0-27 .. t0-35)
  4052812: {
    type: 'block',
    wall: 'brick',
    tint: '#94604f',
    ground: 4.4,
    floor: 4.0,
    win: { w: 1.3, h: 2.1, sill: 0.9, bay: 3.0 },
    frame: '#ece9e2',
    sill: '#d9d1bf',
    lintel: '#d9d1bf',
    bands: { at: [4.2], color: '#d8d0bd' },
    cornice: '#d6cfbf',
    coping: '#cfc8b8',
    plinth: '#d3cbb9',
    roof: '#434447',
  },
  // 120-10 Queens Blvd (1923): five-storey brick apartment house over a row of one-storey shops, white roofs
  4080149: {
    type: 'block',
    wall: 'render',
    tint: '#d3cbbd',
    ground: 4.0,
    floor: 3.6,
    win: { w: 2.6, h: 2.3, sill: 0.5, bay: 3.3 },
    frame: '#3b3c3e',
    coping: '#c9c3b6',
    roof: '#cbc8c1',
    parts: [{ minTop: 10, style: { ...WALKUP, tint: '#a07f70' } }],
  },
  // 119-66 80 Rd (1929): four-storey walk-up, white roof
  4080025: { ...WALKUP, tint: '#a8826f', roof: '#cfccc5' },
  // Past the finish, 300 - 450 m off the road (frames t0-27 .. t0-35, aerial photo): the tan court buildings by
  // 126 St with long dark ribbon windows and a curved front, and the tall towers south of Queens Blvd
  4206522: { ...RIBBON },
  4458617: { ...RIBBON, tint: '#c6b08c' },
  4080169: { ...FAR_TOWER, tint: '#cdb894' },
  4533202: { ...FAR_TOWER, tint: '#c2a987', floor: 2.9 },
  4206486: { ...FAR_TOWER, tint: '#bf9f7e' },
  4206485: { ...FAR_TOWER, tint: '#b8987a' },
  4080168: { ...WALKUP, tint: '#a5836f', roof: '#bdbab3', far: true },
  4080160: {
    ...WALKUP,
    wall: 'render',
    tint: '#cfc9bc',
    roof: '#9a9893',
    ac: 0,
    far: true,
  },
  // East of the finish (aerial photo): two staggered red-brown brick apartment blocks with white roofs, and the
  // two-storey brick school by the expressway under brown hipped roofs
  4206529: {
    ...FAR_TOWER,
    tint: '#8f5f4f',
    roof: '#d6d4ce',
    win: { w: 1.2, h: 1.4, sill: 0.8, bay: 3.0 },
  },
  4206530: {
    ...FAR_TOWER,
    tint: '#94634f',
    roof: '#d6d4ce',
    win: { w: 1.2, h: 1.4, sill: 0.8, bay: 3.0 },
  },
  4314908: {
    ...WALKUP,
    tint: '#9c6a58',
    lift: -2.5,
    ac: 0,
    far: true,
    hip: { rise: 3, tiles: '#6f5b4f' },
  },
  // Multi-storey car park by the finish (rank 33): bare concrete decks with long open bays, solar panels on top
  4206524: {
    ...RIBBON,
    tint: '#bab6ad',
    win: { w: 2.85, h: 1.7, sill: 0.9, bay: 3.0 },
    floor: 3.1,
    ground: 3.4,
    roof: '#4f5866',
  },
  // 118-18 / 118-20 Queens Blvd (1931): low brick shop buildings by the portal, tar roofs
  4079997: {
    type: 'block',
    wall: 'brick',
    tint: '#a3735f',
    ground: 4.2,
    floor: 3.4,
    win: { w: 2.4, h: 2.2, sill: 0.6, bay: 3.2 },
    frame: '#3b3c3e',
    sill: '#cfc6b4',
    cornice: '#bdb3a2',
    coping: '#b7ad9c',
    roof: '#55575b',
  },
  4079998: {
    type: 'block',
    wall: 'brick',
    tint: '#9b6c5a',
    ground: 4.2,
    floor: 3.4,
    win: { w: 2.4, h: 2.2, sill: 0.6, bay: 3.2 },
    frame: '#3b3c3e',
    sill: '#cfc6b4',
    cornice: '#bdb3a2',
    coping: '#b7ad9c',
    roof: '#55575b',
  },
  4079996: {
    type: 'block',
    wall: 'brick',
    tint: '#a87a64',
    ground: 4.2,
    floor: 3.4,
    win: { w: 2.4, h: 2.2, sill: 0.6, bay: 3.2 },
    frame: '#3b3c3e',
    sill: '#cfc6b4',
    cornice: '#bdb3a2',
    coping: '#b7ad9c',
    roof: '#55575b',
  },
  4079995: {
    type: 'block',
    wall: 'brick',
    tint: '#9f705d',
    ground: 4.2,
    floor: 3.4,
    win: { w: 2.4, h: 2.2, sill: 0.6, bay: 3.2 },
    frame: '#3b3c3e',
    sill: '#cfc6b4',
    cornice: '#bdb3a2',
    coping: '#b7ad9c',
    roof: '#55575b',
  },
  // 77-54 Austin St: a six-storey prewar block over the cut; 80-04 Austin St's third wing
  4079660: { ...PREWAR, tint: '#97786b' },
  4434542: { ...WALKUP, tint: '#a08a7a' },
  // More Tudor houses seen from the road: 116-45 Union Tpke, 52 Markwood Pl, 2 Upshaw Rd, 78-18 Burns St's garage
  4079071: { ...TUDOR, tiles: '#7f5041' },
  4079192: { ...TUDOR, brick: '#866254' },
  4079181: { ...TUDOR, front: 225 },
  4521557: { ...TUDOR, eaves: 3.2, upper: 'brick' },
  // 412 - 416 Burns St (1935): brick two-family houses
  4079639: { ...TUDOR, upper: 'brick', front: 225, tiles: '#7f5041' },
  4079640: { ...TUDOR, upper: 'brick', front: 225 },
  4079641: { ...TUDOR, upper: 'brick', front: 225, brick: '#866254' },
  // 418 - 422 Burns St (1935): brick two-family houses like 424, tile roofs
  4079636: { ...TUDOR, upper: 'brick', front: 225 },
  4079637: { ...TUDOR, upper: 'brick', front: 225, tiles: '#734436' },
  4079638: { ...TUDOR, upper: 'brick', front: 225, brick: '#866254' },
  // 116-23 .. 116-45 Union Tpke (1920-25): the row of Tudor houses at the west end of the stretch
  4079072: TUDOR,
  4079073: { ...TUDOR, brick: '#866254' },
  4079074: { ...TUDOR, tiles: '#734436' },
  4079075: { ...TUDOR, upper: 'brick' },
  4079076: { ...TUDOR, tiles: '#7f5041' },
  4079077: { ...TUDOR, brick: '#866254', tiles: '#734436' },
  4079078: TUDOR,
  4079079: { ...TUDOR, eaves: 3.2, upper: 'brick', lift: -1.5 },
  // 424 Burns St (1935): a brick two-family house, tile roof
  4079635: { ...TUDOR, upper: 'brick', front: 225 },
  // Tudor houses on the north side of Union Tpke and Markwood Pl
  4079189: TUDOR,
  4079186: { ...TUDOR, tiles: '#734436' },
  4079183: { ...TUDOR, brick: '#866254' },
  4079182: { ...TUDOR, tiles: '#734436', front: 225 },
  4079190: { ...TUDOR, upper: 'brick' },
  4079070: { ...TUDOR, brick: '#866254' },
  4079188: { ...TUDOR, tiles: '#7f5041' },
  4521553: { ...TUDOR, eaves: 3.2 },
  4079187: { ...TUDOR, upper: 'brick', tiles: '#734436' },
  4079184: TUDOR,
  4079185: { ...TUDOR, brick: '#866254' },
  4079191: { ...TUDOR, front: 225 },
  4079069: { ...TUDOR, tiles: '#7f5041' },
  // Mid stretch, beside Cypress Hills Cemetery (stage ~3 000 m): the cemetery's 1931 three-storey mausoleum, pale cast
  // stone walls with tall narrow stained-glass windows between piers, a dark flat roof behind a stone parapet.
  4091324: {
    type: 'block',
    wall: 'render',
    tint: '#e4dac3',
    ground: 5.5,
    floor: 5.5,
    win: { w: 0.9, h: 3.4, sill: 1.2, bay: 4.2 },
    frame: '#3e3a35',
    sill: '#c9bea4',
    piers: { width: 0.9, color: '#cbbfa2' },
    cornice: '#cdc2a8',
    coping: '#e0d8c5',
    plinth: '#b9ad94',
    roof: '#4b4a47',
  },
  // 89-24 .. 89-46 83 Ave (1920-40, stage ~4 800 m behind the stone wall): two-storey brick row houses in pairs,
  // fronts to the parkway, white-coated flat roofs (2024 aerial photo).
  4094671: { ...ROW, tint: '#9b6e5d' },
  4094672: { ...ROW, tint: '#9b6e5d' },
  4094673: { ...ROW, tint: '#a27a66' },
  4094674: { ...ROW, tint: '#a27a66' },
  4094675: { ...ROW, tint: '#8f6656' },
  4094676: { ...ROW, tint: '#8f6656' },
  4094677: { ...ROW, tint: '#9b6e5d' },
  4094678: { ...ROW, tint: '#9b6e5d' },
  4094679: { ...ROW, tint: '#a27a66' },
  4094680: { ...ROW, tint: '#a27a66' },
  4094681: { ...ROW, tint: '#94705f' },
  // Stage ~1 340 m: the 1949 Parks Department building on Cypress Ave above the parkway, red-brown brick with grey
  // slate hipped roofs (2024 aerial photo).
  4555478: {
    type: 'block',
    wall: 'brick',
    tint: '#9c7465',
    ground: 3.6,
    floor: 3.2,
    win: { w: 1.0, h: 1.5, sill: 0.9, bay: 3.2 },
    frame: '#ebe7de',
    sill: '#cfc6b4',
    coping: '#b9b1a3',
    plinth: '#a59a88',
    roof: '#6d6e70',
    hip: { rise: 2.6, tiles: '#6a6c6f' },
  },
  // Stage ~1 600 m: Congregation Emanu-El's 1931 cemetery chapel on Cypress Hills St, red brick, tall windows between
  // piers, grey slate hipped roofs over the hall and the apse.
  4554843: {
    type: 'block',
    wall: 'brick',
    tint: '#9a5d4b',
    ground: 4.2,
    floor: 3.6,
    win: { w: 1.1, h: 2.6, sill: 1.1, bay: 3.6 },
    frame: '#3f3a35',
    sill: '#d2c8b4',
    piers: { width: 0.7, color: '#8d5443' },
    coping: '#cfc5b2',
    plinth: '#b5a991',
    roof: '#6d6e70',
    hip: { rise: 2.8, tiles: '#707377' },
  },
  // Stage ~4 580 - 4 780 m, left above the wall: 87-55 Myrtle Ave and the 82 Ave row of two-storey brick row houses
  // (1925-50), fronts to the parkway, white-coated flat roofs (2024 aerial photo).
  4094159: { ...ROW, tint: '#9b6e5d' },
  4094160: { ...ROW, tint: '#9b6e5d' },
  4094161: { ...ROW, tint: '#a27a66' },
  4094162: { ...ROW, tint: '#a27a66' },
  4094602: { ...ROW, tint: '#8f6656' },
  4094603: { ...ROW, tint: '#8f6656' },
  4094604: { ...ROW, tint: '#94705f' },
  4094605: { ...ROW, tint: '#94705f' },
  4094606: { ...ROW, tint: '#a5806b' },
  4094639: { ...ROW, tint: '#a5806b' },
  4094640: { ...ROW, tint: '#9b6e5d' },
  4094641: { ...ROW, tint: '#9b6e5d' },
  4094642: { ...ROW, tint: '#a27a66' },
  4094643: { ...ROW, tint: '#a27a66' },
  4094644: { ...ROW, tint: '#8f6656' },
  4094645: { ...ROW, tint: '#8f6656' },
  4094646: { ...ROW, tint: '#94705f' },
  4094647: { ...ROW, tint: '#94705f' },
  4094648: { ...ROW, tint: '#a5806b' },
  4094649: { ...ROW, tint: '#a5806b' },
  4094650: { ...ROW, tint: '#9b6e5d' },
  4094651: { ...ROW, tint: '#9b6e5d' },
  4094652: { ...ROW, tint: '#a27a66' },
  4094653: { ...ROW, tint: '#a27a66' },
  4094654: { ...ROW, tint: '#8f6656' },
};
