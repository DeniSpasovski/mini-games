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
  /** Stacked balconies (slab + railing) across the faces of these bearings, from floor `from` up. */
  balconies?: { faces: number[]; from: number; rail: string };
  /** Flat roof colour (tar / white coating). */
  roof: string;
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
  tint: '#9c7b70',
  ground: 3.6,
  floor: 3.05,
  win: { w: 0.95, h: 1.6, sill: 0.8, bay: 2.3 },
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
const WALKUP: BlockStyle = { ...PREWAR, tint: '#977468', ground: 3.4 };

// The two 20-storey buff-brick towers of 1973-74 (118-17 / 118-18 Union Tpke): small punched windows in dark frames,
// balconies stacked down the narrow ends, a white band at the setback, the machine room on top (frame t1-05).
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
  4079634: { ...TOWER, balconies: { faces: [325], from: 2, rail: '#f0eee8' } },
  // 118-18 Union Tpke: its twin across the parkway, a touch paler
  4079667: {
    ...TOWER,
    tint: '#e0cfac',
    balconies: { faces: [145], from: 2, rail: '#f0eee8' },
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
  4079199: { ...PREWAR, tint: '#95766a', fire: [{ face: 320, at: [0.5] }] },
  // 80-15 Grenfell St (1930)
  4079666: { ...PREWAR, tint: '#a08072', fire: [{ face: 320, at: [0.35] }] },
  // 119-40 Union Tpke (1926): six storeys at the parkway
  4080004: { ...PREWAR, tint: '#927064', fire: [{ face: 320, at: [0.4] }] },
  // 119-14 / 119-20 Union Tpke (1923-26): four-storey walk-ups
  4080002: { ...WALKUP, fire: [{ face: 320, at: [0.5] }] },
  4080003: { ...WALKUP, tint: '#9e7b6c', fire: [{ face: 320, at: [0.5] }] },
  // 80-04 Austin St (1930): two four-storey wings
  4434543: { ...WALKUP, tint: '#9b796b' },
  4434541: { ...WALKUP, tint: '#9b796b' },
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
