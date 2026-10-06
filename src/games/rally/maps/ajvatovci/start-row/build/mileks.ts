import { CylinderGeometry, Matrix4, Vector2, type BufferGeometry } from 'three';
import { roadLine, roadZ, SIDEWALK_BACK } from '../frame';
import { MILEKS_CORNERS, MILEKS_HEIGHT, type Yard } from '../layout';
import { lotFrame, type Build } from './ctx';
import { bench, condenser, planter, stonePot } from './props';
import { Shell, type Wall } from './wall';

/**
 * The Mileks building (the warehouse): white rendered walls with pilasters and bands, the
 * two-storey office front with its loggia, canopy, glazed doors and fascia sign, the roll-up
 * door in the wall on the yard side, the concrete yard and the front garden behind its low wall
 * (the wall and the lot's fences are in `streetwork.ts`). Built with real wall openings
 * and the rally's PBR materials.
 *
 * The facade was measured for a 19.1 m wide building; the real roof in the satellite image is
 * narrower, so the front and back features are scaled across (`K`), the side walls are as measured.
 * Wall coordinates: u to the right seen from outside. The side walls' distances are measured from
 * the front corner (`fromFront`) or from the back corner (`fromBack`); which side has the roll-up
 * door follows the yard: it faces the wider side of the lot.
 */

const WHITE = '#fbfbf9';
const TRIM = '#d7d5cf';
const FRAME = '#f1f2f0';
const ANTHRACITE = '#3d4247';
const METAL = '#a2a8ad';
const YELLOW = '#e5b423';
/** The two-storey offices at the front, measured along the side walls; the hall is behind. */
const FRONT_BLOCK = 9.9;
/** The office block's parapet rises this much above the hall's roof. */
const ATTIC = 0.7;
/** Width the facade was measured for (m). */
const MEASURED_WIDTH = 19.1;
const H = MILEKS_HEIGHT;

type Range = (a: number, b: number) => [number, number];

const [, , SE, SW] = MILEKS_CORNERS;

/** Window pair (ground + upper floor), one above the other, centred at u. */
const windowPair = (w: Wall, f: Range, u: number, width = 1.1) => {
  w.window(f(u - width / 2, u + width / 2), [1.0, 2.5]);
  w.window(f(u - width / 2, u + width / 2), [4.8, 6.3]);
};

const pilaster = (w: Wall, f: Range, u: number) =>
  w.box('render', f(u - 0.25, u + 0.25), [0.4, H], [0, 0.07], WHITE);

const band = (w: Wall, f: Range, u0: number, u1: number, y: number) =>
  w.box('render', f(u0, u1), [y, y + 0.25], [0, 0.045], WHITE);

const downpipe = (w: Wall, f: Range, u: number) => {
  w.box(
    'metal',
    f(u - 0.055, u + 0.055),
    [0.15, H - 0.2],
    [0.075, 0.185],
    METAL,
  );
  w.box(
    'metal',
    f(u - 0.14, u + 0.14),
    [H - 0.35, H - 0.05],
    [0.02, 0.26],
    METAL,
  );
};

/** Parapet continuing the facade above the roof. */
const parapet = (w: Wall, u: [number, number], y0: number, y1: number) => {
  w.box('render', u, [y0, y1], [-0.25, 0], WHITE);
  w.paint(u, [y1, y1 + 0.1], [-0.3, 0.05], TRIM);
};

export function buildMileks(b: Build, yard: Yard): void {
  const { plot } = yard;
  const f = lotFrame(b, [
    ...MILEKS_CORNERS,
    ...yard.polygon.map((p): [number, number] => [p.x, p.y]),
  ]);
  const shell = new Shell(
    f,
    MILEKS_CORNERS,
    H,
    { mat: 'render', tint: '#f7f7f4' },
    { mat: 'roofing', tint: '#cfcfca' },
  );
  const west = shell.side('w')!;
  const east = shell.side('e')!;
  const back = shell.side('n')!;
  const front = shell.side('s')!;
  const K = front.length / MEASURED_WIDTH;

  // The roll-up door faces the wider side of the lot (the yard).
  const xs = MILEKS_CORNERS.map(([x]) => x);
  const [lotWest, lotEast] = plot.yard.street!;
  const mirror = lotEast - Math.max(...xs) > Math.min(...xs) - lotWest;
  const rollWall = mirror ? east : west;
  const plainWall = mirror ? west : east;
  /** Distances from the front corner / the back corner of a side wall -> u. */
  const fromFront =
    (w: Wall): Range =>
    (a, c) =>
      w.w.side === 'w' ? [w.length - c, w.length - a] : [a, c];
  const fromBack =
    (w: Wall): Range =>
    (a, c) =>
      w.w.side === 'w' ? [a, c] : [w.length - c, w.length - a];

  // ----- The roll-up wall (the yard side) -----
  {
    const w = rollWall;
    const fl = fromFront(w);
    const L = w.length;
    // The door sits about two thirds of the way back, as measured.
    const doorD = 19.0;
    const dw = 2.8;
    const [d0, d1] = [doorD - dw / 2, doorD + dw / 2];
    w.plinth(TRIM, 0.4, fl(0, d0 - 0.15));
    w.plinth(TRIM, 0.4, fl(d1 + 0.15, L));
    for (const u of [3.6, 7.4]) windowPair(w, fl, u, 1.2);
    for (const u of [FRONT_BLOCK, 14.9, 24.9]) pilaster(w, fl, u);
    w.box('render', fl(L - 0.45, L), [0.4, H], [0, 0.07], WHITE);
    for (const u of [12.4, 16.6, 23.3, 27.4]) windowPair(w, fl, u);
    w.window(fl(doorD - 0.8, doorD + 0.8), [5.3, 6.3]); // above the door
    band(w, fl, FRONT_BLOCK, d0 - 0.3, 3.3);
    band(w, fl, d1 + 0.3, L, 3.3);
    band(w, fl, FRONT_BLOCK, L, 7.3);
    for (const u of [10.3, 25.3]) downpipe(w, fl, u);
    parapet(w, fl(0, FRONT_BLOCK), H, H + ATTIC);
    w.coping(TRIM, 0.1, 0.3, fl(FRONT_BLOCK, L));
    // The roll-up door and its surround: guide rails, the roll housing above, bollards either side.
    const [r0, r1] = fl(d0, d1);
    w.doorway([r0, r1], 4.4, {
      leaf: 'roller',
      color: '#e4e6e6',
      frame: ANTHRACITE,
    });
    w.box('metal', [r0 - 0.2, r1 + 0.2], [4.4, 4.95], [0, 0.45], METAL);
    for (const u of [r0 - 0.55, r1 + 0.55]) {
      f.add('metal', cylinder(0.1, 1.0), YELLOW, {
        matrix: wallAt(w, u, 0.45),
      });
      f.add('metal', cylinder(0.102, 0.1, 0.72), ANTHRACITE, {
        matrix: wallAt(w, u, 0.45),
      });
    }
    // Wall light over the door.
    w.box(
      'paint',
      [(r0 + r1) / 2 - 0.2, (r0 + r1) / 2 + 0.2],
      [5.0, 5.12],
      [0, 0.5],
      ANTHRACITE,
    );
  }

  // ----- The plain side wall (towards the next lot) -----
  {
    const w = plainWall;
    const fl = fromBack(w);
    const L = w.length;
    const eastFront = L - FRONT_BLOCK;
    w.plinth(TRIM, 0.4);
    w.box('render', fl(0, 0.45), [0.4, H], [0, 0.07], WHITE);
    for (const u of [5, 10, 15, eastFront]) pilaster(w, fl, u);
    for (const u of [2.5, 7.5, 12.5, (15 + eastFront) / 2])
      windowPair(w, fl, u);
    for (const u of [eastFront + 2.5, eastFront + 6.3])
      windowPair(w, fl, u, 1.2);
    band(w, fl, 0, eastFront, 3.3);
    band(w, fl, 0, eastFront, 7.3);
    for (const u of [5.4, 15.4]) downpipe(w, fl, u);
    w.coping(TRIM, 0.1, 0.3, fl(0, eastFront));
    parapet(w, fl(eastFront, L), H, H + ATTIC);
    condenser(w, fl(1, 2.2));
  }

  // ----- Back wall (features scaled across by K; u from the west end) -----
  {
    const w = back;
    const L = w.length;
    const fb: Range = (a, c) => [L - c * K, L - a * K];
    w.plinth(TRIM, 0.4);
    for (const u of [6.4, 12.7]) pilaster(w, fb, u);
    // Service door and the window above it.
    w.doorway(fb(2.7, 3.7), 2.2, {
      leaf: 'panel',
      color: METAL,
      frame: ANTHRACITE,
      depth: 0.12,
    });
    w.window(fb(2.65, 3.75), [4.8, 6.3]);
    for (const u of [9.55, 15.9]) windowPair(w, fb, u);
    band(w, fb, 0, MEASURED_WIDTH, 3.3);
    band(w, fb, 0, MEASURED_WIDTH, 7.3);
    w.coping(TRIM, 0.1, 0.3);
  }

  // ----- Front: the office facade on the street (u = metres from the west corner, scaled by K) -----
  {
    const w = front;
    const L = w.length;
    const ff: Range = (a, c) => [a * K, c * K];
    w.plinth(TRIM, 0.4);
    parapet(w, [0, L], H, H + ATTIC);
    // Back edge of the office block's parapet, across the roof.
    w.box(
      'render',
      [0, L],
      [H, H + ATTIC],
      [-FRONT_BLOCK - 0.25, -FRONT_BLOCK],
      WHITE,
    );
    w.paint(
      [0, L],
      [H + ATTIC, H + ATTIC + 0.1],
      [-FRONT_BLOCK - 0.3, -FRONT_BLOCK + 0.05],
      TRIM,
    );
    // Canopy slab over the entrances, between the floors.
    w.box('render', ff(0.6, 12.6), [3.35, 3.6], [0, 1.3], WHITE);
    w.paint(ff(0.6, 12.6), [3.3, 3.36], [0, 1.3], TRIM);
    // Upper left: a loggia - a deep frame round a big window, a glass balustrade.
    w.box('render', ff(0.9, 1.25), [3.6, 7.4], [0, 0.9], WHITE);
    w.box('render', ff(6.25, 6.6), [3.6, 7.4], [0, 0.9], WHITE);
    w.box('render', ff(0.9, 6.6), [7.05, 7.4], [0, 0.9], WHITE);
    w.window(ff(1.7, 5.8), [4.0, 6.8], { panes: 3, sill: false });
    w.box('railGlass', ff(1.25, 6.25), [3.6, 4.6], [0.78, 0.8], '#ffffff');
    w.box('metal', ff(1.25, 6.25), [4.6, 4.66], [0.76, 0.82], METAL);
    // Upper middle: a projecting box frame round a three-pane window.
    w.box('render', ff(7.0, 7.35), [3.6, 7.1], [0, 0.55], WHITE);
    w.box('render', ff(11.95, 12.3), [3.6, 7.1], [0, 0.55], WHITE);
    w.box('render', ff(7.0, 12.3), [6.75, 7.1], [0, 0.55], WHITE);
    w.box('render', ff(7.0, 12.3), [3.6, 3.95], [0, 0.55], WHITE);
    w.window(ff(7.6, 11.7), [4.25, 6.5], { panes: 3, sill: false });
    // Upper right: two smaller windows, the company sign above them.
    w.window(ff(13.9, 15.2), [4.6, 6.3]);
    w.window(ff(16.4, 17.7), [4.6, 6.3]);
    // Ground floor: glazed doors and windows, the main entrance in the middle.
    w.doorway(ff(1.6, 3.4), 2.6, { leaf: 'glass', frame: FRAME, depth: 0.14 });
    w.window(ff(3.9, 5.8), [0.9, 2.7]);
    w.doorway(ff(7.6, 9.2), 2.6, {
      leaf: 'glass',
      frame: ANTHRACITE,
      depth: 0.14,
    });
    w.window(ff(9.8, 11.8), [0.9, 2.7]);
    w.window(ff(13.4, 15.4), [0.9, 2.6]);
    w.doorway(ff(16.4, 17.4), 2.4, {
      leaf: 'glass',
      frame: ANTHRACITE,
      depth: 0.12,
    });
    w.paint(ff(7.3, 9.5), [0, 0.14], [0, 0.7], TRIM); // entrance step
    w.paint(ff(1.3, 3.7), [0, 0.14], [0, 0.5], TRIM);
    for (const s of [7.25, 9.4])
      w.paint(ff(s, s + 0.15), [2.75, 3.0], [0, 0.12], ANTHRACITE); // wall lamps
    // Fascia sign, upper right: the company name in teal on white.
    w.paint(ff(12.9, 18.7), [6.62, 7.68], [0, 0.03], '#cfd2d0');
    w.panel(
      'sign',
      ff(13.0, 18.6),
      [6.67, 6.67 + (5.6 * K) / 8],
      0.035,
      '#ffffff',
      true,
    );

    // Roof: a couple of air-conditioning units on the hall roof, behind the office block.
    w.box('metal', ff(4, 5.8), [H, H + 1], [-16.5, -15.4], '#a2a8ad', {
      bottom: false,
    });
    w.box('paint', ff(4.2, 5.6), [H + 1, H + 1.04], [-16.3, -15.6], ANTHRACITE);
    w.box('metal', ff(12, 13.4), [H, H + 0.8], [-23, -22], '#a2a8ad', {
      bottom: false,
    });
  }

  shell.finish();

  // ----- Ground: the front garden, the patio under the canopy, pots, planters, the bench -----
  const frontBack = roadLine(SIDEWALK_BACK, SW[0], SE[0]);
  f.polygon(
    'lawn',
    [new Vector2(...SW), ...frontBack, new Vector2(...SE)],
    0.045,
    '#ffffff',
  );
  const PATIO = 1.45;
  const fp = (s: number, wOut = 0) => front.w.point(s * K, wOut);
  f.polygon(
    'patchPavers',
    [fp(0), fp(12.6), fp(12.6, PATIO), fp(0, PATIO)],
    0.08,
    '#c4c1ba',
  );
  // Gate posts either side of the vehicle gate.
  const gate = [
    plot.gate - (plot.gateWidth ?? 9) / 2,
    plot.gate + (plot.gateWidth ?? 9) / 2,
  ];
  for (const x of gate) {
    const z = roadZ(x, SIDEWALK_BACK);
    f.box(
      'paint',
      [x - 0.07, 0, z - 0.1],
      [x + 0.07, 1.8, z + 0.1],
      ANTHRACITE,
    );
  }
  for (const s of [6.8, 9.95]) {
    const q = fp(s, 0.55);
    stonePot(f, q.x, q.y);
  }
  for (const s of [1.15, 3.65]) {
    const q = fp(s, 0.4);
    planter(f, q.x, q.y);
  }
  const bq = fp(4.85, 0.55);
  bench(f, bq.x, bq.y, Math.atan2(-(SW[1] - SE[1]), SW[0] - SE[0]));
}

function cylinder(radius: number, height: number, y0 = 0): BufferGeometry {
  return new CylinderGeometry(radius, radius, height, 10).translate(
    0,
    y0 + height / 2,
    0,
  );
}

/** Matrix placing a local-origin object at wall coordinates (u, w), standing on the pad. */
function wallAt(w: Wall, u: number, out: number): Matrix4 {
  const p = w.w.point(u, out);
  return new Matrix4().makeTranslation(p.x, 0, p.y);
}
