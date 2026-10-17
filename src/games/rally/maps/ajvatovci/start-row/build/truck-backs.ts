import {
  BoxGeometry,
  CylinderGeometry,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';

/**
 * The rear bodies of the rigid trucks of the yards, built in code on top of a baked cab (`vehicles.ts` adds the
 * chassis): a roll-back tow truck and a freezer box with its cooling unit. Both sit on the frame of either cab;
 * `BackFrame` says where.
 */
export type Rigid = 'tow' | 'reefer';

type Part = 'paint' | 'cab' | 'glass' | 'chrome' | 'detail';

/** What `Pieces` of `vehicles.ts` offers: boxes and free geometry per part. */
interface Sink {
  add(part: Part, g: BufferGeometry, color?: ColorRepresentation): void;
  box(
    part: Part,
    a: number[],
    b: number[],
    color?: ColorRepresentation,
    mirror?: boolean,
  ): void;
}

export interface BackFrame {
  /** Rear end and front end of the body along the vehicle (m); the front is the cab's back wall. */
  x0: number;
  x1: number;
  /** Top of the chassis frame (m) and half the body's width (m). */
  y0: number;
  hw: number;
  /** The cab's roof: height (m) and x of its middle (the beacons stand there). */
  roof: number;
  cabX: number;
}

const DARK = '#1d1f22';
const PLATE = '#5d636a';
const STEEL = '#8d9399';
const AMBER = '#f39a1e';
const RED = '#c8242b';
const WHITE = '#ececea';

/** An amber warning lamp (a short dome on a base) standing on a roof or a rack. */
const beacon = (p: Sink, x: number, y: number, z: number): void => {
  p.add(
    'detail',
    new CylinderGeometry(0.14, 0.15, 0.05, 10).translate(x, y + 0.025, z),
    DARK,
  );
  p.add(
    'detail',
    new CylinderGeometry(0.1, 0.12, 0.17, 10).translate(x, y + 0.135, z),
    AMBER,
  );
};

/** Tail lamps: a red cluster and an amber one on each side of the rear end, `y` the lower edge. */
const tailLamps = (p: Sink, f: BackFrame, y: number, h = 0.2): void => {
  const { x0, hw } = f;
  p.box('detail', [x0 - 0.06, y, hw - 0.34], [x0, y + h, hw - 0.1], RED, true);
  p.box(
    'detail',
    [x0 - 0.06, y + h + 0.03, hw - 0.34],
    [x0, y + h + 0.03 + h * 0.6, hw - 0.1],
    AMBER,
    true,
  );
};

/** Roll-back tow truck: a flat deck with a tilted tail ramp, side rails, a winch, tool boxes and a headache rack. */
const tow = (p: Sink, f: BackFrame): void => {
  const { x0, x1, y0, hw } = f;
  const bed = y0 + 0.32;
  const ramp = 1.6;
  const tilt = 0.24;
  const xj = x0 + ramp * Math.cos(tilt) - 0.02; // where the flat deck starts
  p.box('detail', [xj, y0, -hw + 0.45], [x1, y0 + 0.2, hw - 0.45], DARK); // sub-frame
  p.box('detail', [xj, y0 + 0.2, -hw + 0.1], [x1, bed, hw - 0.1], PLATE); // deck
  p.add(
    'detail',
    new BoxGeometry(ramp, 0.12, (hw - 0.1) * 2)
      .rotateZ(tilt)
      .translate(
        xj - (ramp / 2) * Math.cos(tilt),
        bed - 0.06 - (ramp / 2) * Math.sin(tilt),
        0,
      ),
    PLATE,
  );
  for (const s of [1, -1])
    p.add(
      'paint',
      new BoxGeometry(ramp, 0.12, 0.1)
        .rotateZ(tilt)
        .translate(
          xj - (ramp / 2) * Math.cos(tilt),
          bed + 0.02 - (ramp / 2) * Math.sin(tilt),
          s * (hw - 0.2),
        ),
    );
  p.box(
    'paint',
    [xj, bed, hw - 0.2],
    [x1 - 1.9, bed + 0.12, hw - 0.1],
    undefined,
    true,
  ); // side rails
  for (let x = xj + 0.3; x < x1 - 2.0; x += 0.8)
    p.box(
      'chrome',
      [x, bed, hw - 0.2],
      [x + 0.08, bed + 0.2, hw - 0.1],
      undefined,
      true,
    ); // stake pockets
  p.add(
    'chrome',
    new CylinderGeometry(0.13, 0.13, 1.1, 12)
      .rotateX(Math.PI / 2)
      .translate(x1 - 0.55, bed + 0.17, 0),
  ); // winch
  p.box('detail', [x1 - 0.7, bed, -0.62], [x1 - 0.4, bed + 0.3, 0.62], DARK);
  // Headache rack behind the cab, a lamp bar on top.
  const rack = Math.min(f.roof - 0.1, y0 + 1.7);
  for (const z of [-hw + 0.12, -0.5, 0.5, hw - 0.12])
    p.box('paint', [x1 - 0.22, bed, z - 0.05], [x1 - 0.1, rack, z + 0.05]);
  for (const y of [rack - 0.14, bed + 0.5])
    p.box('paint', [x1 - 0.22, y, -hw + 0.07], [x1 - 0.1, y + 0.14, hw - 0.07]);
  for (let z = -hw + 0.4; z < hw - 0.3; z += 0.3)
    p.box(
      'chrome',
      [x1 - 0.2, bed + 0.6, z],
      [x1 - 0.14, rack - 0.14, z + 0.04],
    );
  for (const z of [-0.7, 0, 0.7]) beacon(p, x1 - 0.16, rack, z);
  for (const z of [-0.5, 0.5]) beacon(p, f.cabX, f.roof, z);
  for (let x = xj + 0.4; x < x1 - 0.3; x += 0.9)
    p.box(
      'detail',
      [x, y0 + 0.08, hw - 0.1],
      [x + 0.18, y0 + 0.16, hw - 0.09],
      AMBER,
      true,
    );
  tailLamps(p, f, y0 + 0.02);
  p.box(
    'detail',
    [x0 - 0.12, y0 - 0.5, -hw + 0.1],
    [x0, y0 - 0.3, hw - 0.1],
    STEEL,
  );
};

/** Freezer truck: an insulated white box with seams and a reflective strip, rear doors and the cooling unit over the cab. */
const reefer = (p: Sink, f: BackFrame): void => {
  const { x0, x1, y0, hw } = f;
  const h = 2.45;
  p.add(
    'paint',
    new BoxGeometry(x1 - x0, h, hw * 2).translate(
      (x0 + x1) / 2,
      y0 + 0.1 + h / 2,
      0,
    ),
  );
  p.box(
    'chrome',
    [x0, y0 + 0.1, hw],
    [x1, y0 + 0.2, hw + 0.04],
    undefined,
    true,
  );
  p.box(
    'chrome',
    [x0, y0 + 0.1 + h - 0.08, hw],
    [x1, y0 + 0.1 + h, hw + 0.04],
    undefined,
    true,
  );
  for (let x = x0 + 1.1; x < x1 - 0.3; x += 1.1)
    p.box(
      'detail',
      [x - 0.01, y0 + 0.22, hw],
      [x + 0.01, y0 + 0.1 + h - 0.1, hw + 0.012],
      '#c4cacf',
      true,
    ); // panel seams
  p.box(
    'detail',
    [x0 + 0.15, y0 + 0.24, hw],
    [x1 - 0.15, y0 + 0.36, hw + 0.012],
    RED,
    true,
  ); // reflective strip
  for (let x = x0 + 0.3; x < x1 - 0.4; x += 0.5)
    p.box(
      'detail',
      [x, y0 + 0.24, hw + 0.004],
      [x + 0.22, y0 + 0.36, hw + 0.016],
      WHITE,
      true,
    );
  // Rear doors: two leaves, locking bars, a rubber seal line.
  p.box(
    'detail',
    [x0 - 0.04, y0 + 0.2, -hw + 0.05],
    [x0, y0 + 0.1 + h - 0.1, hw - 0.05],
    '#dfe3e5',
  );
  p.box(
    'detail',
    [x0 - 0.06, y0 + 0.2, -0.02],
    [x0 - 0.03, y0 + h, 0.02],
    DARK,
  );
  for (const z of [-0.95, -0.55, 0.55, 0.95])
    p.box(
      'chrome',
      [x0 - 0.09, y0 + 0.3, z - 0.02],
      [x0 - 0.05, y0 + h - 0.1, z + 0.02],
    );
  tailLamps(p, f, y0 + 0.3, 0.26);
  // The cooling unit on the front wall above the cab: housing, dark grille with slats, a top vent.
  const uy = y0 + 1.58;
  p.box(
    'detail',
    [x1 - 0.02, uy, -0.8],
    [x1 + 0.55, uy + 0.82, 0.8],
    '#e9ecee',
  );
  p.box(
    'detail',
    [x1 + 0.55, uy + 0.12, -0.62],
    [x1 + 0.58, uy + 0.7, 0.62],
    DARK,
  );
  for (let i = 0; i < 5; i++)
    p.box(
      'detail',
      [x1 + 0.58, uy + 0.17 + i * 0.1, -0.58],
      [x1 + 0.6, uy + 0.2 + i * 0.1, 0.58],
      STEEL,
    );
  p.box(
    'detail',
    [x1 + 0.1, uy + 0.82, -0.5],
    [x1 + 0.45, uy + 0.9, 0.5],
    '#c4cacf',
  );
};

const BACKS: Record<Rigid, (p: Sink, f: BackFrame) => void> = {
  tow,
  reefer,
};

/** The body of `kind` on a chassis described by `f`. */
export const buildRigidBack = (p: Sink, kind: Rigid, f: BackFrame): void =>
  BACKS[kind](p, f);
