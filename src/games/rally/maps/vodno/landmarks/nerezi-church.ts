import { cross } from '../../ajvatovci/hilltop/build/church';
import {
  arc,
  archOutline,
  BRASS,
  coneRoof,
  DOOR,
  FOOT,
  gable,
  gabledBox,
  LIFT,
  octagonDrum,
  PLINTH,
  ringWalls,
  slit,
  squareDrum,
  type Local,
  type V3,
  type Wall,
} from './common';

/**
 * St. Panteleimon at Gorno Nerezi (1164, Komnenian): a small cross-in-square church of brick and stone with five domes.
 * Sizes from the published figures (15.9 x 9.6 m overall, the central dome 11.7 m high on an octagonal drum, the four
 * corner domes 9.0 m on square drums; sources in the map's DETAILS.md):
 *
 * - the cross: an east-west arm and a north-south arm 3.8 m wide with steep gabled roofs, walls 6.4 m;
 * - four corner chapels (walls 5.8 m), each with a square drum and a pyramid roof;
 * - a semicircular central apse and two small side apses on the east, a lower narthex on the west with the door.
 *
 * Local frame: x along the axis (narthex -7.95 .. apse 7.75), z across, y up from the lawn.
 */
const NX0 = -7.95; // narthex west wall
const NX1 = -5.05; // narthex / naos
const XE = 5.85; // naos east wall = apse centre
const W = 4.8; // half width
const A = 1.9; // half width of the arms
const H_ARM = 6.4;
const R_ARM = 8.0;
const H_COR = 5.8;
const H_NART = 4.0;
const R_NART = 5.3;
const H_APSE = 5.0;
const DRUM_R = 2.1;
const DRUM_Y0 = 7.4;
const DRUM_Y1 = 10.2;
const DRUM_APEX = 11.7;
const CORNER_APEX = 9.0;

/** Brick and stone: the rough-cut stone texture in a warm tone. */
const WALL = { key: 'ashlar', color: '#ecc9a8' } as const;
const CORNERS: [number, number][] = [
  [-3.5, -3.35],
  [-3.5, 3.35],
  [3.875, -3.35],
  [3.875, 3.35],
];

const WEST: Wall = { o: [NX0, 0, 0], n: [-1, 0, 0] };
const NORTH: Wall = { o: [0, 0, -W], n: [0, 0, -1] };
const SOUTH: Wall = { o: [0, 0, W], n: [0, 0, 1] };

export function buildNereziChurch(l: Local): void {
  // --- Walls -----------------------------------------------------------------------------------
  l.box(WALL.key, [NX1, FOOT, -A], [XE, H_ARM, A], WALL.color);
  l.box(WALL.key, [-A, FOOT, -W], [A, H_ARM, W], WALL.color);
  for (const [cx, cz] of CORNERS)
    l.box(
      WALL.key,
      [cx < 0 ? NX1 : A, FOOT, cz < 0 ? -W : A],
      [cx < 0 ? -A : XE, H_COR, cz < 0 ? -A : W],
      WALL.color,
    );
  l.box(
    'ashlar',
    [NX1 - 0.1, FOOT, -W - 0.1],
    [XE + 0.05, 0.4, W + 0.1],
    PLINTH,
  );
  gabledBox(l, NX0, NX1, -W, W, H_NART, R_NART, WALL);
  l.box('ashlar', [NX0 - 0.1, FOOT, -W - 0.1], [NX1, 0.4, W + 0.1], PLINTH);

  // Apses: the central one on the east arm, a small one on each corner chapel's east face.
  const apses: [number, number, number][] = [
    [XE, 0, A],
    [XE, -3.35, 1.0],
    [XE, 3.35, 1.0],
  ];
  for (const [cx, cz, r] of apses) {
    const h = r === A ? H_APSE : H_COR - 1.2;
    ringWalls(
      l,
      arc(cx, cz, r, -Math.PI / 2, Math.PI / 2, 10),
      FOOT,
      h,
      WALL.key,
      WALL.color,
      true,
    );
    coneRoof(l, cx, cz, r, -Math.PI / 2, Math.PI / 2, 8, h, [
      cx - 0.01,
      h + (r === A ? 1.6 : 1.1),
      cz,
    ]);
  }

  // --- Roofs -----------------------------------------------------------------------------------
  const ov = 0.3;
  const k = (R_ARM - H_ARM) / A;
  const yE = H_ARM - ov * k + LIFT;
  const yR = R_ARM + LIFT;
  for (const s of [-1, 1]) {
    const z = s * (A + ov);
    // East-west arm: west half, east half; north-south arm: north half, south half.
    l.roof(
      [
        [NX1 - ov, yE, z],
        [-A, yE, z],
        [-A, yR, 0],
        [NX1 - ov, yR, 0],
      ],
      { trim: [0, 3] },
    );
    l.roof(
      [
        [A, yE, z],
        [XE + ov, yE, z],
        [XE + ov, yR, 0],
        [A, yR, 0],
      ],
      { trim: [0, 1] },
    );
  }
  // North-south arm: two planes on each half.
  for (const sx of [-1, 1])
    for (const nz of [-1, 1])
      l.roof(
        [
          [sx * (A + ov), yE, nz * (A - ov)],
          [sx * (A + ov), yE, nz * (W + ov)],
          [0, yR, nz * (W + ov)],
          [0, yR, nz * (A - ov)],
        ],
        { trim: [1, 2] },
      );
  // The crossing: a low pyramid under the drum.
  const hip = (a: V3, b: V3) =>
    l.roof([a, b, [0, R_ARM + 0.9 + LIFT, 0]], { trim: [0] });
  hip([-A - ov, yE + 0.1, -A - ov], [A + ov, yE + 0.1, -A - ov]);
  hip([A + ov, yE + 0.1, A + ov], [-A - ov, yE + 0.1, A + ov]);
  hip([A + ov, yE + 0.1, -A - ov], [A + ov, yE + 0.1, A + ov]);
  hip([-A - ov, yE + 0.1, A + ov], [-A - ov, yE + 0.1, -A - ov]);
  // Gable ends of the north and south arms.
  gable(l, NORTH, -A, A, H_ARM, R_ARM, WALL.key, WALL.color);
  gable(l, SOUTH, -A, A, H_ARM, R_ARM, WALL.key, WALL.color);
  gable(
    l,
    { o: [XE, 0, 0], n: [1, 0, 0] },
    -A,
    A,
    H_ARM,
    R_ARM,
    WALL.key,
    WALL.color,
  );
  gable(
    l,
    { o: [NX1, 0, 0], n: [-1, 0, 0] },
    -A,
    A,
    H_ARM,
    R_ARM,
    WALL.key,
    WALL.color,
  );

  // --- Domes -----------------------------------------------------------------------------------
  octagonDrum(
    l,
    0,
    0,
    DRUM_R,
    DRUM_Y0,
    DRUM_Y1,
    DRUM_APEX,
    WALL,
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  cross(l, [0, DRUM_APEX + 0.15, 0], 1.3, BRASS, Math.PI / 2);
  for (const [cx, cz] of CORNERS)
    squareDrum(l, cx, cz, 2.2, H_COR, H_COR + 2.1, CORNER_APEX, WALL);

  // --- Openings --------------------------------------------------------------------------------
  // North / south facades: a three-light window in the lower register, two lights above (the arms' gables).
  for (const w of [NORTH, SOUTH]) {
    const side = w === SOUTH ? 1 : -1;
    for (const s of [-0.95, 0, 0.95]) slit(l, w, s * side, 2.3, 0.4, 1.7);
    for (const s of [-0.5, 0.5]) slit(l, w, s * side, 5.0, 0.36, 1.2);
  }
  // Corner chapels: one light each on their outer faces.
  for (const [cx, cz] of CORNERS) {
    const w: Wall =
      cz < 0
        ? { o: [cx, 0, -W], n: [0, 0, -1] }
        : { o: [cx, 0, W], n: [0, 0, 1] };
    slit(l, w, 0, 2.4, 0.36, 1.3);
  }
  // West front: the narthex door and a light each side.
  l.panel('paint', WEST, archOutline(0, 0, 1.3, 2.7), DOOR, { off: 0.015 });
  l.panel('ashlar', WEST, archOutline(0, -0.05, 1.6, 2.9), PLINTH, {
    holes: [archOutline(0, 0, 1.3, 2.7)],
    off: 0.025,
  });
  for (const s of [-2.8, 2.8]) slit(l, WEST, s, 1.6, 0.4, 1.2);
}
