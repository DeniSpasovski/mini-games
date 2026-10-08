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

/** The floor plan, drawn at 240 x 160 m: stockroom on the north wall, checkout on the south, the atrium in the middle, eight department slots either side. */
const LAYOUT_BASE: ToyLayout = {
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

/** Floor scale: 240 x 160 m drawn, FLOOR_SCALE x that built (1.75 = 420 x 280 m, 70 % of the original 2.5). */
export const FLOOR_SCALE = 1.75;
export const LAYOUT = scaled(LAYOUT_BASE, FLOOR_SCALE);

/** Zones that never move: the stockroom (the outdoor dock) and the atrium. */
const FIXED = new Set(['stockroom', 'atrium']);

/**
 * The floor plan with the eight departments and the checkout dealt onto their nine slots at random
 * (`next` is a unit random source). The checkout, with the entrance door and the start, takes one of the
 * three slots on the south wall (left corner, centre, right corner); the departments fill the rest. A
 * department keeps its mat, shelves, showpieces and points, shifted to its new slot (mirrored when it
 * crosses the central aisle), so every seed holds the same points.
 */
export function shuffledLayout(next: () => number): ToyLayout {
  const slots = LAYOUT.zones.filter((z) => !FIXED.has(z.id));
  const south = slots.filter((z) => z.z1 >= LAYOUT.hz - 0.01);
  const checkout = LAYOUT.zones.find((z) => z.id === 'checkout')!;
  const doorSlot = south[Math.floor(next() * south.length)];
  const others = slots.filter((z) => z !== checkout);
  const free = slots.filter((z) => z !== doorSlot);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const centre = (z: ZoneDef) => ({
    x: (z.x0 + z.x1) / 2,
    z: (z.z0 + z.z1) / 2,
  });
  const moved = new Map<string, ZoneDef>();
  const place = (z: ZoneDef, slot: ZoneDef) => {
    const from = centre(z);
    const to = centre(slot);
    const flip =
      from.x === 0 || to.x === 0 || Math.sign(from.x) === Math.sign(to.x)
        ? 1
        : -1;
    moved.set(z.id, {
      ...z,
      x0: slot.x0,
      z0: slot.z0,
      x1: slot.x1,
      z1: slot.z1,
      anchors: (z.anchors ?? []).map(
        ([id, x, zz, r]) =>
          [id, to.x + (x - from.x) * flip, to.z + (zz - from.z), r] as [
            string,
            number,
            number,
            number,
          ],
      ),
    });
  };
  place(checkout, doorSlot);
  others.forEach((z, i) => place(z, free[i]));
  // the fixed zones vary in place: the dock's two trucks swap sides, shift and may face the other way,
  // and the atrium showpieces mirror left to right
  const stockroom = LAYOUT.zones.find((z) => z.id === 'stockroom')!;
  const atrium = LAYOUT.zones.find((z) => z.id === 'atrium')!;
  const swapTrucks = next() < 0.5;
  const trucks = (stockroom.anchors ?? []).map(
    ([id, x, zz, r], i) =>
      [
        id,
        (swapTrucks ? -x : x) +
          (next() - 0.5) * 30 * FLOOR_SCALE +
          (i ? -20 : 20),
        zz,
        next() < 0.5 ? r : r + Math.PI,
      ] as [string, number, number, number],
  );
  moved.set(stockroom.id, { ...stockroom, anchors: trucks });
  const mirror = next() < 0.5;
  if (mirror)
    moved.set(atrium.id, {
      ...atrium,
      anchors: (atrium.anchors ?? []).map(
        ([id, x, zz, r]) => [id, -x, zz, r] as [string, number, number, number],
      ),
    });
  const doorX = centre(doorSlot).x;
  return {
    ...LAYOUT,
    doorX,
    // a corner entrance starts a little towards the middle, the centre one keeps its start
    start:
      doorX === 0
        ? LAYOUT.start
        : {
            x: doorX + (doorX < 0 ? 1 : -1) * 22 * FLOOR_SCALE,
            z: LAYOUT.start.z,
          },
    zones: LAYOUT.zones.map((z) => moved.get(z.id) ?? z),
  };
}
