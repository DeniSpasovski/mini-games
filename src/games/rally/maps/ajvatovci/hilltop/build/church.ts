import { CylinderGeometry, LatheGeometry, Matrix4, Vector2 } from 'three';
import {
  archOutline,
  rectOutline,
  type Local,
  type V2,
  type V3,
  type Wall,
} from './shapes';

/**
 * The church of St. Peter and St. Paul on Ajvatovci Hill: a small cross-in-square Orthodox church of
 * rough-cut limestone with clay tile roofs and dark grey metal trim. Measured from the reference photos
 * (sources/maps/ajvatovci/ref-51..55, scale from the porch / door heights, see DETAILS.md "Hilltop"):
 *
 * - nave 9.5 x 6.2 m, eaves 4.2 m, a west gable with an arched door and a relief cross;
 * - a raised central block (3.2 m along the nave, 6.8 m across, walls 6 m) with gables north and south,
 *   carrying an octagonal drum (2.9 m across, windows on four faces) with a tiled cone and a cross;
 * - a semicircular apse at the east end (radius 2.5 m, half-cone roof);
 * - a timber porch with a tiled lean-to roof on the south side of the west half (the OSM outline's
 *   bulge), a south door under it.
 *
 * Local frame: x along the axis (west -5.3 .. apse 6.75), z across (+z = south), y up from the lawn.
 */
const W = 3.1; // half width of the nave
const XW = -5.3; // west front
const XC0 = -1.6; // central block
const XC1 = 1.6;
const XE = 4.2; // east wall / apse centre
const AR = 2.5; // apse radius
const H1 = 4.2; // nave eaves
const R1 = 5.8; // west ridge
const R3 = 5.6; // east ridge
const WC = 3.4; // central block half width
const H2 = 6.0; // central block walls
const R2 = 6.8; // central ridge (runs across, z)
const HA = 3.7; // apse wall
const RA = 4.75; // apse roof top (against the east wall)
const DR = 1.45; // drum circumradius
const D0 = 6.0; // drum walls from (inside the central roof) ...
const D1 = 8.1; // ... to the cornice
const DA = 8.95; // drum roof apex
const FOOT = -0.8; // walls reach this far below the lawn (the ground is levelled, see site.ts)
const LIFT = 0.1; // roof tiles sit this far over the wall tops

const STONE = '#ffffff';
const PLINTH = '#d8cfc0';
const TRIM = '#45484b';
const GLASS = '#25292e';
const DOOR = '#3d2a1e';
const WOOD = '#6a3d22';
const RELIEF = '#f4efe6';
const BRASS = '#c4a96a';

const SOUTH: Wall = { o: [0, 0, W], n: [0, 0, 1] };
const NORTH: Wall = { o: [0, 0, -W], n: [0, 0, -1] };
const WEST: Wall = { o: [XW, 0, 0], n: [-1, 0, 0] };
const EAST: Wall = { o: [XE, 0, 0], n: [1, 0, 0] };

/** A window / door: dark opening with a pale stone surround, `out` m proud of the wall. */
function opening(
  l: Local,
  w: Wall,
  outline: V2[],
  frame: V2[],
  fill: string,
  out = 0.015,
): void {
  l.panel('paint', w, outline, fill, { off: out });
  l.panel('ashlar', w, frame, PLINTH, { holes: [outline], off: out + 0.01 });
}

/** Narrow arched window centred at `s`, sill `y0`, `w` wide, `h` tall. */
function slit(
  l: Local,
  wall: Wall,
  s: number,
  y0: number,
  w: number,
  h: number,
): void {
  opening(
    l,
    wall,
    archOutline(s, y0, w, y0 + h),
    archOutline(s, y0 - 0.1, w + 0.2, y0 + h + 0.1),
    GLASS,
  );
  // A white glazing bar across, like the photos.
  l.panel(
    'paint',
    wall,
    rectOutline(s - w / 2, y0 + h * 0.55, s + w / 2, y0 + h * 0.55 + 0.04),
    '#e8e6e0',
    {
      off: 0.03,
    },
  );
}

/** Relief cross (white stone) on a wall, centred at (s, y). */
function reliefCross(
  l: Local,
  wall: Wall,
  s: number,
  y: number,
  size: number,
): void {
  const t = size * 0.18;
  l.panel(
    'paint',
    wall,
    rectOutline(s - t / 2, y - size / 2, s + t / 2, y + size / 2),
    RELIEF,
    { off: 0.03 },
  );
  l.panel(
    'paint',
    wall,
    rectOutline(
      s - size * 0.35,
      y + size * 0.05,
      s + size * 0.35,
      y + size * 0.05 + t,
    ),
    RELIEF,
    {
      off: 0.031,
    },
  );
}

/** A gable triangle (stone) on wall `w`: base from s0 to s1 at y0, apex at (s, y1). */
function gable(
  l: Local,
  w: Wall,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
): void {
  l.panel(
    'ashlar',
    w,
    [
      [s0, y0],
      [s1, y0],
      [(s0 + s1) / 2, y1],
    ],
    STONE,
  );
}

/** Orthodox cross (three bars, the lowest slanted) standing at `base`, `h` tall. */
export function cross(
  l: Local,
  base: V3,
  h: number,
  color: string,
  yaw = 0,
): void {
  const t = h * 0.055;
  const at = (dx: number, dy: number, rz = 0) =>
    new Matrix4()
      .makeTranslation(base[0], base[1], base[2])
      .multiply(new Matrix4().makeRotationY(yaw))
      .multiply(new Matrix4().makeTranslation(dx, dy, 0))
      .multiply(new Matrix4().makeRotationZ(rz));
  l.box('metal', [-t / 2, 0, -t / 2], [t / 2, h, t / 2], color, at(0, 0));
  l.box(
    'metal',
    [-h * 0.3, -t / 2, -t / 2],
    [h * 0.3, t / 2, t / 2],
    color,
    at(0, h * 0.68),
  );
  l.box(
    'metal',
    [-h * 0.14, -t / 2, -t / 2],
    [h * 0.14, t / 2, t / 2],
    color,
    at(0, h * 0.86),
  );
  l.box(
    'metal',
    [-h * 0.17, -t / 2, -t / 2],
    [h * 0.17, t / 2, t / 2],
    color,
    at(0, h * 0.3, -0.35),
  );
}

export function buildChurch(l: Local): void {
  // --- Walls -----------------------------------------------------------------------------------
  l.box('ashlar', [XW, FOOT, -W], [XE, H1, W], STONE);
  l.box('ashlar', [XC0, FOOT, -WC], [XC1, H2, WC], STONE);
  // Plinth course round the nave and the central block.
  l.box('ashlar', [XW - 0.1, FOOT, -W - 0.1], [XE, 0.32, W + 0.1], PLINTH);
  l.box(
    'ashlar',
    [XC0 - 0.1, FOOT, -WC - 0.1],
    [XC1 + 0.1, 0.32, WC + 0.1],
    PLINTH,
  );

  // Apse: half cylinder east of the east wall, with a stepped base ring.
  const seg = 14;
  const apseRing = (r: number, y0: number, y1: number, color: string) => {
    for (let i = 0; i < seg; i++) {
      const a0 = -Math.PI / 2 + (i / seg) * Math.PI;
      const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI;
      const p = (a: number, y: number): V3 => [
        XE + Math.cos(a) * r,
        y,
        Math.sin(a) * r,
      ];
      const mid = (a0 + a1) / 2;
      const want: V3 = [Math.cos(mid), 0, Math.sin(mid)];
      const u0 = r * (a0 + Math.PI / 2);
      const u1 = r * (a1 + Math.PI / 2);
      l.tri(
        'ashlar',
        p(a0, y0),
        p(a1, y0),
        p(a1, y1),
        color,
        [
          [u0, y0],
          [u1, y0],
          [u1, y1],
        ],
        want,
      );
      l.tri(
        'ashlar',
        p(a0, y0),
        p(a1, y1),
        p(a0, y1),
        color,
        [
          [u0, y0],
          [u1, y1],
          [u0, y1],
        ],
        want,
      );
    }
  };
  apseRing(AR, FOOT, HA, STONE);
  apseRing(AR + 0.22, FOOT, 0.45, PLINTH);
  // Top of the apse base ring (a ledge).
  for (let i = 0; i < seg; i++) {
    const a0 = -Math.PI / 2 + (i / seg) * Math.PI;
    const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI;
    const p = (a: number, r: number): V3 => [
      XE + Math.cos(a) * r,
      0.45,
      Math.sin(a) * r,
    ];
    l.fan(
      'ashlar',
      [p(a0, AR), p(a1, AR), p(a1, AR + 0.22), p(a0, AR + 0.22)],
      PLINTH,
      [0, 1, 0],
      (q) => [q[0], q[2]],
    );
  }

  // Gables.
  gable(l, WEST, -W, W, H1, R1);
  gable(l, EAST, -W, W, H1, R3);
  const centralS: Wall = { o: [0, 0, WC], n: [0, 0, 1] };
  const centralN: Wall = { o: [0, 0, -WC], n: [0, 0, -1] };
  gable(l, centralS, XC0, XC1, H2, R2);
  gable(l, centralN, -XC1, -XC0, H2, R2);

  // --- Roofs -----------------------------------------------------------------------------------
  const k1 = (R1 - H1) / W;
  const k3 = (R3 - H1) / W;
  const ov = 0.35;
  for (const side of [1, -1]) {
    const z = side * (W + ov);
    // West nave roof: eave, then the ridge; it runs into the central block's west wall.
    l.roof(
      [
        [XW - 0.3, H1 - ov * k1 + LIFT, z],
        [XC0, H1 - ov * k1 + LIFT, z],
        [XC0, R1 + LIFT, 0],
        [XW - 0.3, R1 + LIFT, 0],
      ],
      { trim: [0, 3] },
    );
    // East nave roof.
    l.roof(
      [
        [XC1, H1 - ov * k3 + LIFT, z],
        [XE + 0.3, H1 - ov * k3 + LIFT, z],
        [XE + 0.3, R3 + LIFT, 0],
        [XC1, R3 + LIFT, 0],
      ],
      { trim: [0, 1] },
    );
  }
  // Central block: ridge across (z), slopes falling west and east.
  const k2 = (R2 - H2) / ((XC1 - XC0) / 2);
  for (const side of [-1, 1]) {
    const x = side * ((XC1 - XC0) / 2 + 0.3);
    l.roof(
      [
        [x, H2 - 0.3 * k2 + LIFT, -WC - 0.3],
        [x, H2 - 0.3 * k2 + LIFT, WC + 0.3],
        [0, R2 + LIFT, WC + 0.3],
        [0, R2 + LIFT, -WC - 0.3],
      ],
      { trim: [0, 1, 3] },
    );
  }
  // Apse: a half cone of tiles against the east wall.
  const ka = (RA - HA) / AR;
  for (let i = 0; i < seg; i++) {
    const a0 = -Math.PI / 2 + (i / seg) * Math.PI;
    const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI;
    const r = AR + 0.3;
    const y = HA - 0.3 * ka + LIFT;
    l.roof(
      [
        [XE + Math.cos(a0) * r, y, Math.sin(a0) * r],
        [XE + Math.cos(a1) * r, y, Math.sin(a1) * r],
        [XE + 0.02, RA + LIFT, 0],
      ],
      { trim: [0] },
    );
  }

  // --- Drum and dome ---------------------------------------------------------------------------
  const apothem = DR * Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const n: V3 = [Math.cos(a), 0, Math.sin(a)];
    const face: Wall = { o: [n[0] * apothem, 0, n[2] * apothem], n };
    const half = DR * Math.sin(Math.PI / 8);
    l.panel('ashlar', face, rectOutline(-half, D0, half, D1), STONE, {
      uOff: k * half * 2,
    });
    if (k % 2 === 0) slit(l, face, 0, 7.05, 0.34, 0.78);
    // Cornice band under the cone.
    l.panel(
      'paint',
      face,
      rectOutline(-half - 0.02, D1 - 0.14, half + 0.02, D1),
      TRIM,
      { off: 0.04 },
    );
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const r = DR + 0.3;
    const y = D1 - 0.08;
    l.roof(
      [
        [Math.cos(a0) * r, y, Math.sin(a0) * r],
        [Math.cos(a1) * r, y, Math.sin(a1) * r],
        [0, DA, 0],
      ],
      { trim: [0] },
    );
  }
  // Finial ball and the cross.
  const ball = new LatheGeometry(
    [
      new Vector2(0.001, 0),
      new Vector2(0.12, 0.05),
      new Vector2(0.13, 0.14),
      new Vector2(0.06, 0.24),
      new Vector2(0.001, 0.26),
    ],
    8,
  );
  l.add('metal', ball, BRASS, new Matrix4().makeTranslation(0, DA - 0.05, 0));
  cross(l, [0, DA + 0.18, 0], 1.25, BRASS, Math.PI / 2);

  // --- Openings, trim, relief crosses --------------------------------------------------------
  // West front: arched double door, lamp-height relief cross in the gable.
  opening(
    l,
    WEST,
    archOutline(0, 0.32, 1.15, 2.6, 10),
    archOutline(0, 0.3, 1.45, 2.78, 10),
    DOOR,
  );
  l.panel('paint', WEST, rectOutline(-0.015, 0.32, 0.015, 2.3), '#20160f', {
    off: 0.03,
  });
  reliefCross(l, WEST, 0, 5.0, 0.55);
  slit(l, WEST, 0, 3.2, 0.3, 0.7);
  // Central gables: tall window, relief cross.
  for (const w of [centralS, centralN]) {
    slit(l, w, 0, 2.5, 0.5, 1.3);
    slit(l, w, 0, 4.4, 0.34, 0.8);
    reliefCross(l, w, 0, 6.3, 0.4);
  }
  // Side walls: windows in the west and east bays (the south-west bay has the door under the porch).
  slit(l, NORTH, 3.4, 1.8, 0.4, 1.1); // north wall runs east -> west: s = -x
  slit(l, NORTH, -2.9, 1.8, 0.4, 1.1);
  slit(l, SOUTH, 2.9, 1.8, 0.4, 1.1);
  opening(
    l,
    SOUTH,
    rectOutline(-3.85, 0.32, -2.85, 2.45),
    rectOutline(-3.98, 0.3, -2.72, 2.58),
    '#2d3034',
  );
  // East gable over the apse roof, apse windows.
  slit(l, EAST, 0, 4.75, 0.26, 0.55);
  for (const a of [-0.95, 0, 0.95]) {
    const n: V3 = [Math.cos(a), 0, Math.sin(a)];
    const w: Wall = { o: [XE + n[0] * AR, 0, n[2] * AR], n };
    slit(l, w, 0, 1.75, 0.34, 1.0);
  }
  reliefCross(l, EAST, 0, 5.15, 0.35);
  // Gutters' downpipes where the nave meets the central block.
  for (const x of [XC0 - 0.14, XC1 + 0.14])
    for (const z of [-(W + 0.08), W + 0.08])
      l.box(
        'paint',
        [x - 0.05, 0.3, z - 0.05],
        [x + 0.05, H1 - 0.05, z + 0.05],
        TRIM,
      );
  // Wall lamps either side of the west door.
  for (const s of [-1.1, 1.1])
    l.box('metal', [XW - 0.18, 2.35, s - 0.07], [XW, 2.6, s + 0.07], '#2c2c2c');

  // --- South porch (timber, tiled lean-to) ----------------------------------------------------
  const P0 = -5.0;
  const P1 = -1.75;
  const PZ = W + 2.3; // post line
  l.box('paint', [P0 - 0.15, FOOT, W], [P1 + 0.15, 0.14, PZ + 0.35], '#b4aea3');
  const posts = [P0 + 0.12, (P0 + P1) / 2, P1 - 0.12];
  for (const x of posts) {
    l.box(
      'paint',
      [x - 0.08, 0.14, PZ - 0.08],
      [x + 0.08, 2.6, PZ + 0.08],
      WOOD,
    );
    // Knee braces to the beam.
    for (const d of [-1, 1]) {
      if ((x === posts[0] && d < 0) || (x === posts[2] && d > 0)) continue;
      l.box(
        'paint',
        [-0.04, -0.33, -0.04],
        [0.04, 0.33, 0.04],
        WOOD,
        new Matrix4()
          .makeTranslation(x + d * 0.3, 2.32, PZ)
          .multiply(new Matrix4().makeRotationZ(-d * 0.8)),
      );
    }
  }
  l.box('paint', [P0 - 0.05, 2.6, PZ - 0.1], [P1 + 0.05, 2.8, PZ + 0.1], WOOD);
  l.box('paint', [P0 - 0.05, 3.25, W], [P1 + 0.05, 3.4, W + 0.14], WOOD);
  // Rafters from the wall plate to the beam.
  for (let x = P0; x <= P1 + 1e-6; x += (P1 - P0) / 5) {
    const len = Math.hypot(PZ + 0.45 - W, 0.75);
    l.box(
      'paint',
      [-0.04, -0.06, 0],
      [0.04, 0.06, len],
      WOOD,
      new Matrix4()
        .makeTranslation(x, 3.42, W)
        .multiply(new Matrix4().makeRotationX(Math.atan2(0.75, PZ + 0.45 - W))),
    );
  }
  l.roof(
    [
      [P1 + 0.2, 2.72, PZ + 0.5],
      [P0 - 0.2, 2.72, PZ + 0.5],
      [P0 - 0.2, 3.55, W],
      [P1 + 0.2, 3.55, W],
    ],
    { trim: [0, 1, 3], under: 0.06, soffit: WOOD },
  );

  // A wrought-iron candle stand by the porch door (photo 3): a dark post with a tray.
  const stand = new CylinderGeometry(0.03, 0.03, 1.1, 5);
  l.add(
    'metal',
    stand,
    '#262626',
    new Matrix4().makeTranslation(-2.2, 0.69, W + 0.9),
  );
  l.box('metal', [-2.45, 1.22, W + 0.75], [-1.95, 1.26, W + 1.05], '#262626');
}
