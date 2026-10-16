import { cross } from '../../ajvatovci/hilltop/build/church';
import {
  arc,
  archOutline,
  BRASS,
  coneRoof,
  DOOR,
  FOOT,
  gabledBox,
  LIFT,
  octagonDrum,
  PLINTH,
  ringWalls,
  slit,
  TRIM,
  type Local,
  type V3,
  type Wall,
} from './common';

/**
 * The church of the Nativity of the Theotokos at Sredno Vodno (the Middle Vodno monastery, OSM way 689815741, a few
 * metres from the finish): a small white church with a three-lobed (triconch) east end. Plan fitted to the OSM outline:
 *
 * - nave 8.5 x 6.1 m, a gabled roof;
 * - a square crossing 6.2 x 6.1 m with a hipped roof, an octagonal drum (circumradius 2.3 m) and a tiled cone with a cross;
 * - three semicircular apses (north, south, east; radius 3.1 m) round the crossing, half cones of tiles over them.
 *
 * Local frame: x along the axis (west door -12.7 .. east apse 5.2), z across, y up from the ground; (0, 0) is the OSM
 * outline's centre, the crossing's centre is (-1.1, 0).
 */
export const NAVE_X0 = -12.7;
const X1 = -4.2; // nave / crossing
const XC = 2.05; // crossing east wall = east apse centre
const W = 3.05; // half width
const CX = (X1 + XC) / 2; // crossing centre x
const AR = 3.1; // apse radius
const H_NAVE = 3.9;
const R_NAVE = 5.7;
const H_CROSS = 5.0;
const R_HIP = 6.8;
const H_APSE = 3.6;
const R_APSE = 5.0;
const DRUM_R = 2.3;
const DRUM_Y0 = 6.4;
const DRUM_Y1 = 9.0;
const DRUM_APEX = 10.7;

const WALL = { key: 'render', color: '#f2eee5' } as const;
const SEG = 12;

const WEST: Wall = { o: [NAVE_X0, 0, 0], n: [-1, 0, 0] };
const NORTH: Wall = { o: [0, 0, -W], n: [0, 0, -1] };
const SOUTH: Wall = { o: [0, 0, W], n: [0, 0, 1] };

export function buildSrednoChurch(l: Local): void {
  // --- Walls -----------------------------------------------------------------------------------
  // Nave and crossing as boxes, the three apses as round walls on the crossing's walls.
  l.box(WALL.key, [X1, FOOT, -W], [XC, H_CROSS, W], WALL.color);
  gabledBox(l, NAVE_X0, X1, -W, W, H_NAVE, R_NAVE, WALL);
  const apses: [number, number, number, number][] = [
    [CX + 0.05, -W, Math.PI, Math.PI * 2],
    [CX + 0.05, W, 0, Math.PI],
    [XC, 0, -Math.PI / 2, Math.PI / 2],
  ];
  for (const [cx, cz, a0, a1] of apses) {
    ringWalls(
      l,
      arc(cx, cz, AR, a0, a1, 14),
      FOOT,
      H_APSE,
      WALL.key,
      WALL.color,
      true,
    );
    ringWalls(
      l,
      arc(cx, cz, AR + 0.12, a0, a1, 14),
      FOOT,
      0.45,
      'ashlar',
      PLINTH,
      true,
    );
  }
  l.box(
    'ashlar',
    [NAVE_X0 - 0.12, FOOT, -W - 0.12],
    [X1, 0.4, W + 0.12],
    PLINTH,
  );
  l.box('ashlar', [X1, FOOT, -W - 0.12], [XC + 0.12, 0.4, W + 0.12], PLINTH);

  // --- Roofs -----------------------------------------------------------------------------------
  // Crossing: hip to a flat top under the drum.
  const ov = 0.3;
  const hip: V3[][] = [
    [
      [X1 - ov, H_CROSS + LIFT, -W - ov],
      [XC + ov, H_CROSS + LIFT, -W - ov],
      [CX, R_HIP + LIFT, 0],
    ],
    [
      [XC + ov, H_CROSS + LIFT, W + ov],
      [X1 - ov, H_CROSS + LIFT, W + ov],
      [CX, R_HIP + LIFT, 0],
    ],
    [
      [XC + ov, H_CROSS + LIFT, -W - ov],
      [XC + ov, H_CROSS + LIFT, W + ov],
      [CX, R_HIP + LIFT, 0],
    ],
    [
      [X1 - ov, H_CROSS + LIFT, W + ov],
      [X1 - ov, H_CROSS + LIFT, -W - ov],
      [CX, R_HIP + LIFT, 0],
    ],
  ];
  for (const t of hip) l.roof(t, { trim: [0] });
  // Apses: half cones against the crossing walls.
  coneRoof(l, CX + 0.05, -W, AR, Math.PI, Math.PI * 2, SEG, H_APSE, [
    CX + 0.05,
    R_APSE,
    -W + 0.01,
  ]);
  coneRoof(l, CX + 0.05, W, AR, 0, Math.PI, SEG, H_APSE, [
    CX + 0.05,
    R_APSE,
    W - 0.01,
  ]);
  coneRoof(l, XC, 0, AR, -Math.PI / 2, Math.PI / 2, SEG, H_APSE, [
    XC - 0.01,
    R_APSE,
    0,
  ]);

  // --- Drum, dome, cross -----------------------------------------------------------------------
  octagonDrum(l, CX, 0, DRUM_R, DRUM_Y0, DRUM_Y1, DRUM_APEX, WALL);
  cross(l, [CX, DRUM_APEX + 0.18, 0], 1.5, BRASS, Math.PI / 2);

  // --- Openings --------------------------------------------------------------------------------
  // West front: an arched door, a window and a relief in the gable.
  l.panel('paint', WEST, archOutline(0, 0, 1.3, 2.7), DOOR, { off: 0.015 });
  l.panel('ashlar', WEST, archOutline(0, -0.05, 1.6, 2.9), PLINTH, {
    holes: [archOutline(0, 0, 1.3, 2.7)],
    off: 0.025,
  });
  slit(l, WEST, 0, 3.2, 0.5, 1.1);
  // Nave side windows, apse windows (three on each lobe).
  for (const x of [-9.6, -6.4]) {
    slit(l, { o: NORTH.o, n: NORTH.n }, -x, 1.6, 0.45, 1.3);
    slit(l, { o: SOUTH.o, n: SOUTH.n }, x, 1.6, 0.45, 1.3);
  }
  const lobe = (cx: number, cz: number, a0: number) => {
    for (const da of [-0.7, 0, 0.7]) {
      const a = a0 + da;
      const n: V3 = [Math.cos(a), 0, Math.sin(a)];
      const w: Wall = { o: [cx + n[0] * AR, 0, cz + n[2] * AR], n };
      slit(l, w, 0, 1.4, 0.4, 1.3);
    }
  };
  lobe(CX + 0.05, -W, -Math.PI / 2);
  lobe(CX + 0.05, W, Math.PI / 2);
  lobe(XC, 0, 0);
  // Dark trim band under the eaves of the nave.
  for (const side of [-1, 1])
    l.box(
      'paint',
      [NAVE_X0, H_NAVE - 0.18, side * W - 0.03],
      [X1, H_NAVE, side * W + 0.03],
      TRIM,
    );
  // A small bell frame on the west gable.
  l.box(
    'metal',
    [NAVE_X0 - 0.05, R_NAVE + 0.1, -0.5],
    [NAVE_X0 + 0.25, R_NAVE + 1.2, 0.5],
    '#3a3a3a',
  );
  cross(l, [NAVE_X0 + 0.1, R_NAVE + 1.2, 0], 0.9, BRASS, 0);
}
