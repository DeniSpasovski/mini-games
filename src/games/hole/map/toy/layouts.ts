/**
 * Toy Emporium floor plans (data only, TOY-STORE.md section 5). World axes: +X east, +Z south, the
 * camera looks north-up from the south, so the entrance is on the south (+Z) wall. Coordinates are
 * metres from the floor centre. `share` is the fraction of the map's points a zone is filled with.
 */
export interface ZoneDef {
  id: string;
  name: string;
  /** Catalog departments (the text before " - " in an item's `where`) that are homed here. */
  depts: string[];
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Floor mat colour. */
  color: number;
  share: number;
  /** Variant of `gondola_shelf` that stocks this department. */
  shelfVariant: number;
  /** Department shelf units placed in rows (catalog ids). */
  shelves: string[];
  /** Fixed showpieces: [item, x, z, yaw]. */
  anchors?: [string, number, number, number][];
}

export interface ToyLayout {
  id: 'a' | 'b' | 'c';
  name: string;
  /** Half extents of the floor (m). */
  hx: number;
  hz: number;
  /** X of the entrance in the south wall. */
  doorX: number;
  start: { x: number; z: number };
  zones: ZoneDef[];
}

const Z = (
  id: string,
  name: string,
  dept: string | string[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  color: number,
  share: number,
  shelfVariant: number,
  shelves: string[] = [],
  anchors: ZoneDef['anchors'] = [],
): ZoneDef => ({
  id,
  name,
  depts: Array.isArray(dept) ? dept : [dept],
  x0,
  z0,
  x1,
  z1,
  color,
  share,
  shelfVariant,
  shelves,
  anchors,
});

/** Scale a layout's footprint (the zone plan is drawn at 240 x 160 m; see FLOOR_SCALE). */
function scaled(l: ToyLayout, k: number): ToyLayout {
  return {
    ...l,
    hx: l.hx * k,
    hz: l.hz * k,
    doorX: l.doorX * k,
    start: { x: l.start.x * k, z: l.start.z * k },
    zones: l.zones.map((z) => ({
      ...z,
      x0: z.x0 * k,
      z0: z.z0 * k,
      x1: z.x1 * k,
      z1: z.z1 * k,
      anchors: (z.anchors ?? []).map(
        ([id, x, zz, r]) =>
          [id, x * k, zz * k, r] as [string, number, number, number],
      ),
    })),
  };
}

/** Layout A - "Grand Hall" (default), drawn at 240 x 160 m, built at 300 x 200 m. */
const LAYOUT_A_BASE: ToyLayout = {
  id: 'a',
  name: 'Grand Hall',
  hx: 120,
  hz: 80,
  doorX: 0,
  start: { x: -52, z: 64 },
  zones: [
    Z(
      'stockroom',
      'Stockroom',
      'Stockroom',
      -120,
      -80,
      120,
      -55,
      0xb9b6ad,
      0.04,
      0,
      [],
      [
        ['semi_trailer', -90, -68, 0],
        ['delivery_truck_box', 20, -68, 0],
      ],
    ),
    Z(
      'robots',
      'Robot Factory',
      'Robot Factory',
      -120,
      -55,
      -60,
      -25,
      0x8fc9c4,
      0.11,
      0,
      [],
      [
        ['rocket_big', -108, -42, 0],
        ['spaceship_display', -84, -40, 0],
      ],
    ),
    Z(
      'games',
      'Game Room',
      'Game Room',
      60,
      -55,
      120,
      -25,
      0xb69be0,
      0.06,
      3,
      ['game_shelf'],
      [['ball_pit', 100, -38, 0]],
    ),
    Z(
      'plush',
      'Plush Meadow',
      'Plush Meadow',
      -120,
      -25,
      -60,
      20,
      0xf7b6cf,
      0.18,
      2,
      ['plush_wall_shelf'],
      [['plush_throne', -100, -2, 0]],
    ),
    Z(
      'vroom',
      'Vroom Row',
      'Vroom Row',
      60,
      -25,
      120,
      5,
      0xe9867a,
      0.09,
      0,
      [],
      [['race_track_set', 95, -10, 0]],
    ),
    Z(
      'splash',
      'Splash Zone',
      'Splash Zone',
      60,
      5,
      120,
      50,
      0x8fd0f0,
      0.095,
      0,
      [],
      [['bounce_house', 100, 28, 0]],
    ),
    Z(
      'dolls',
      'Doll House Lane',
      'Doll House Lane',
      -120,
      20,
      -60,
      50,
      0xd1b8ee,
      0.075,
      4,
      [],
      [['dollhouse_mansion', -96, 36, 0]],
    ),
    Z(
      'bricks',
      'Brick Alley',
      'Brick Alley',
      -120,
      50,
      -60,
      80,
      0xf4d35e,
      0.115,
      0,
      [],
      [['brick_car_big', -90, 68, 0]],
    ),
    Z(
      'figures',
      'Figure Falls',
      'Figure Falls',
      60,
      50,
      120,
      80,
      0x9bd89b,
      0.09,
      1,
      ['figure_gondola'],
      [['figure_pyramid', 100, 66, 0]],
    ),
    Z(
      'checkout',
      'Checkout',
      'Checkout',
      -60,
      50,
      60,
      80,
      0xf3e7c9,
      0.055,
      0,
      [],
      [
        ['checkout_counter', -10, 72, 0],
        ['checkout_counter', 10, 72, 0],
      ],
    ),
    Z(
      'atrium',
      'Atrium',
      'Atrium',
      -60,
      -55,
      60,
      50,
      0xfbeeda,
      0.09,
      0,
      [],
      [
        // a hall, not a cluster: Big Ted at the back of the central aisle (seen from the door), the
        // two robots and the railway behind, the rocket and the titan on the sides, two Ferris wheels
        // and two carousels as pairs either side of the aisle, a brick tower in each front corner
        ['landmark_big_ted', 0, -40, 0],
        ['robot_overlord', -44, -40, 0],
        ['railway_world', 44, -42, 0],
        ['rocket_giant', -50, -8, 0],
        ['robot_titan', 50, -6, 0],
        ['ferris_wheel_giant', -22, -10, 0],
        ['ferris_wheel_giant', 24, -10, 0],
        ['carousel_big', -30, 20, 0],
        ['carousel_big', 30, 20, 0],
        ['brick_tower_display', -52, 36, 0],
        ['brick_tower_display', 52, 36, 0],
      ],
    ),
  ],
};

/** Floor scale of Layout A: 240 x 160 m drawn, FLOOR_SCALE x that built (pacing needs a big floor, see TOY-STORE.md). */
export const FLOOR_SCALE = 2.5;
export const LAYOUT_A = scaled(LAYOUT_A_BASE, FLOOR_SCALE);

/**
 * Layout B - "Ring Walk" (260 x 170 drawn): departments hug the walls, the hero atrium fills the middle
 * and a floor ring path runs around it. Start in the south-west corner.
 */
const LAYOUT_B_BASE: ToyLayout = {
  id: 'b',
  name: 'Ring Walk',
  hx: 130,
  hz: 85,
  doorX: -20,
  start: { x: -100, z: 72 },
  zones: [
    Z(
      'stockroom',
      'Stockroom',
      'Stockroom',
      -130,
      -85,
      130,
      -65,
      0xb9b6ad,
      0.04,
      0,
      [],
      [
        ['semi_trailer', -80, -76, 0],
        ['delivery_truck_box', 60, -76, 0],
      ],
    ),
    Z(
      'robots',
      'Robot Factory',
      'Robot Factory',
      -130,
      -65,
      -85,
      -20,
      0x8fc9c4,
      0.11,
      0,
      [],
      [['rocket_big', -108, -42, 0]],
    ),
    Z(
      'plush',
      'Plush Meadow',
      'Plush Meadow',
      -130,
      -20,
      -85,
      40,
      0xf7b6cf,
      0.18,
      2,
      ['plush_wall_shelf'],
      [['plush_throne', -108, 10, 0]],
    ),
    Z(
      'dolls',
      'Doll House Lane',
      'Doll House Lane',
      -130,
      40,
      -85,
      65,
      0xd1b8ee,
      0.075,
      4,
      [],
      [['dollhouse_mansion', -108, 52, 0]],
    ),
    Z(
      'games',
      'Game Room',
      'Game Room',
      85,
      -65,
      130,
      -20,
      0xb69be0,
      0.06,
      3,
      ['game_shelf'],
      [['ball_pit', 108, -42, 0]],
    ),
    Z(
      'vroom',
      'Vroom Row',
      'Vroom Row',
      85,
      -20,
      130,
      25,
      0xe9867a,
      0.09,
      0,
      [],
      [['race_track_set', 108, 2, 0]],
    ),
    Z(
      'splash',
      'Splash Zone',
      'Splash Zone',
      85,
      25,
      130,
      65,
      0x8fd0f0,
      0.095,
      0,
      [],
      [['bounce_house', 108, 45, 0]],
    ),
    Z(
      'bricks',
      'Brick Alley',
      'Brick Alley',
      -130,
      65,
      -45,
      85,
      0xf4d35e,
      0.115,
      0,
      [],
      [['brick_car_big', -90, 76, 0]],
    ),
    Z(
      'checkout',
      'Checkout',
      'Checkout',
      -45,
      65,
      45,
      85,
      0xf3e7c9,
      0.055,
      0,
      [],
      [
        ['checkout_counter', -10, 78, 0],
        ['checkout_counter', 10, 78, 0],
      ],
    ),
    Z(
      'figures',
      'Figure Falls',
      'Figure Falls',
      45,
      65,
      130,
      85,
      0x9bd89b,
      0.09,
      1,
      ['figure_gondola'],
      [['figure_pyramid', 95, 76, 0]],
    ),
    Z(
      'atrium',
      'Atrium',
      'Atrium',
      -85,
      -65,
      85,
      65,
      0xfbeeda,
      0.09,
      0,
      [],
      [
        ['landmark_big_ted', 0, -35, 0],
        ['robot_overlord', -50, -30, 0],
        ['railway_world', 50, -30, 0],
        ['rocket_giant', -55, 10, 0],
        ['ferris_wheel_giant', 0, 15, 0],
        ['robot_titan', 55, 12, 0],
      ],
    ),
  ],
};

/**
 * Layout C - "Warehouse Sale" (280 x 100 drawn): five bands, a conveyor from the entrance at the west end
 * to the landmark row at the east end. A speed run: the way is a straight line.
 */
const LAYOUT_C_BASE: ToyLayout = {
  id: 'c',
  name: 'Warehouse Sale',
  hx: 140,
  hz: 50,
  doorX: -112,
  start: { x: -118, z: 38 },
  zones: [
    Z(
      'band1',
      'Bricks, Figures, Checkout',
      ['Brick Alley', 'Figure Falls', 'Checkout'],
      -140,
      -50,
      -84,
      50,
      0xf4d35e,
      0.26,
      0,
      ['gondola_shelf', 'figure_gondola'],
    ),
    Z(
      'band2',
      'Dolls and Games',
      ['Doll House Lane', 'Game Room'],
      -84,
      -50,
      -28,
      50,
      0xd1b8ee,
      0.13,
      4,
      ['game_shelf'],
    ),
    Z(
      'band3',
      'Plush and Splash',
      ['Plush Meadow', 'Splash Zone'],
      -28,
      -50,
      28,
      50,
      0xf7b6cf,
      0.29,
      2,
      ['plush_wall_shelf'],
    ),
    Z(
      'band4',
      'Robots and Vroom',
      ['Robot Factory', 'Vroom Row'],
      28,
      -50,
      84,
      50,
      0x8fc9c4,
      0.2,
      0,
    ),
    Z(
      'band5',
      'Landmark Row',
      ['Atrium', 'Stockroom'],
      84,
      -50,
      140,
      50,
      0xfbeeda,
      0.12,
      0,
      [],
      [
        ['landmark_big_ted', 112, -34, 0],
        ['robot_overlord', 112, -10, 0],
        ['railway_world', 112, 12, 0],
        ['rocket_giant', 100, 36, 0],
        ['ferris_wheel_giant', 124, 36, 0],
        ['robot_titan', 112, 0, 0],
      ],
    ),
  ],
};

/** Floor scales (see FLOOR_SCALE): B and C are drawn at a different size, scaled to about the same area as A. */
export const LAYOUT_B = scaled(LAYOUT_B_BASE, 2.3);
export const LAYOUT_C = scaled(LAYOUT_C_BASE, 2.9);

export const LAYOUTS: Record<string, ToyLayout> = {
  a: LAYOUT_A,
  b: LAYOUT_B,
  c: LAYOUT_C,
};
