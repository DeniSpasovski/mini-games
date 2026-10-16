import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
} from 'three';
import type { AssetBuilder } from '../types';
import { TEAM_COUNT, TEAMS } from './teams';
import {
  serviceVehicleModel,
  streetCarIndex,
  streetCarModel,
} from './street-car-models';
import { box, finish, solid, wheel } from './vehicles';

/**
 * Service park assets (rally paddock): team trucks, vans, trailers, gazebos, props, the team car stand-in and the
 * public extras. Team-coloured assets use the team index (builders/teams.ts) as variant. The team trucks, vans, pickups
 * and the catering van are the background models (street-car-models.ts) in the team paint plus side stripes; everything
 * else is boxes + a few cylinders. All in the `vehicle` material (vertex colours, one draw call per asset). Vehicles face +X with the origin on
 * the ground under their middle; a truck's awning and a gazebo's open front are on the +Z side. No logos or lettering.
 */

const WHITE = '#f2f2f2';
const DARK = '#1d1d20';

const team = (variant: number) => TEAMS[variant % TEAM_COUNT];

/** A box turned about X (a sloped panel), centred at (x, y, z). */
function tilted(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  tiltX: number,
  color: string,
): BufferGeometry {
  return solid(
    new BoxGeometry(w, h, d).rotateX(tiltX).translate(x, y, z),
    color,
  );
}

/** Vertical post / pole from the ground (6 sides). */
const post = (
  x: number,
  z: number,
  h: number,
  r: number,
  color: string,
  sides = 6,
): BufferGeometry =>
  solid(new CylinderGeometry(r, r, h, sides).translate(x, h / 2, z), color);

/** Both faces of a flat quad strip (the vehicle material is front-side only). */
function sheet(pts: [number, number, number][], color: string): BufferGeometry {
  const pos: number[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i + 2 < pts.length; i += 2) {
      const [a, b, c, d] = [
        pts[i],
        pts[i + 1],
        pts[i + 2],
        pts[i + 3] ?? pts[i + 2],
      ];
      const quad = side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d];
      for (const p of quad) pos.push(...p);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return solid(g, color);
}

// --- team vehicles ---------------------------------------------------------------------------------

/** Half width of the baked vans' body (mirrors excluded); side stripes sit just outside it. */
const SIDE = 1.07;

/** A stripe on both sides of a van or truck: `len` long at height `y`, middle at `x`. */
const sideStripe = (
  len: number,
  h: number,
  x: number,
  y: number,
  color: string,
  out = SIDE,
): BufferGeometry[] =>
  [1, -1].map((side) => box(len, h, 0.03, x, y, side * (out + 0.012), color));

/** Box truck (8 m, the background box truck) in team colours with a side awning on +Z (4.6 x 3.8 m, two legs). */
export const serviceTruck: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const parts: BufferGeometry[] = [
    serviceVehicleModel('box_truck', lod).geometry(t.base),
    ...sideStripe(4.6, 0.38, -1.65, 1.55, t.accent),
    ...sideStripe(4.6, 0.12, -1.65, 1.9, t.accent2),
  ];
  // Awning: canopy sloping down to the valance, two legs.
  parts.push(
    tilted(4.6, 0.07, 3.8, -1.65, 2.85, 3.0, 0.07, WHITE),
    box(4.6, 0.3, 0.05, -1.65, 2.6, 4.9, t.accent),
  );
  for (const x of [-3.8, 0.5]) parts.push(post(x, 4.8, 2.7, 0.04, '#b8bcc2'));
  return finish(parts);
};

/**
 * Team tractor-trailer (17 m): a cab-over tractor and a box semi-trailer in the team colours with side stripes, on
 * three axle groups. Boxes and cylinders only (the lorry stand-in of the park's back row).
 */
export const serviceSemi: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const glass = '#22303a';
  const steel = '#8d9399';
  const parts: BufferGeometry[] = [
    // Trailer box on its underframe, rear doors, side guards, landing legs.
    box(12.6, 2.8, 2.55, -2.1, 2.55, 0, t.base),
    box(0.06, 2.5, 2.3, -8.43, 2.5, 0, WHITE),
    box(12.2, 0.3, 1.9, -2.1, 0.95, 0, DARK),
    ...[1, -1].map((s) => box(6, 0.4, 0.05, -4.6, 0.62, s * 1.22, steel)),
    ...[1, -1].map((s) => box(0.2, 0.9, 0.2, 2.9, 0.5, s * 0.9, steel)),
    ...sideStripe(11.6, 0.5, -2.1, 2.25, t.accent, 1.275),
    ...sideStripe(11.6, 0.14, -2.1, 2.85, t.accent2, 1.275),
    // Tractor: chassis, fifth wheel, cab-over cab with roof deflector, glass, bumper, grille, lamps.
    box(8.4, 0.5, 1.6, 4.4, 0.9, 0, DARK),
    box(1.2, 0.14, 1.3, 1.9, 1.22, 0, DARK),
    box(2.5, 2.4, 2.4, 7.2, 2.3, 0, t.base),
    box(1.5, 0.9, 2.3, 6.1, 3.75, 0, t.base),
    box(0.04, 1.0, 2.1, 8.46, 2.95, 0, glass),
    ...[1, -1].map((s) => box(1.4, 0.9, 0.03, 7.4, 2.95, s * 1.22, glass)),
    box(0.3, 0.5, 2.4, 8.5, 0.8, 0, '#43484e'),
    box(0.04, 0.7, 1.2, 8.47, 1.7, 0, DARK),
    ...[1, -1].map((s) =>
      box(0.05, 0.25, 0.4, 8.46, 1.25, s * 0.85, '#eef3f6'),
    ),
  ];
  // Front axle under the cab, drive tandem under the fifth wheel, trailer tandem at the back.
  for (const x of [7.4, 2.6, 1.3, -5.8, -7.1])
    for (const z of [1.0, -1.0])
      parts.push(
        lod === 0 ? wheel(0.5, 0.3, x, z) : box(1.0, 1.0, 0.3, x, 0.5, z, DARK),
      );
  return finish(parts);
};

/** Panel van (5.6 m, the background high-roof van) in team colours with side stripes. */
export const serviceVan: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  return finish([
    serviceVehicleModel('van_high', lod).geometry(t.base),
    ...sideStripe(3.4, 0.28, -1.1, 1.1, t.accent),
    ...sideStripe(3.4, 0.09, -1.1, 1.38, t.accent2),
  ]);
};

/** Flat car trailer (5.5 m) with a tow bar to +X, the ramp folded at -X. Variant 0 grey, 1 dark. */
export const carTrailer: AssetBuilder = ({ variant, lod }) => {
  const deck = variant ? '#3b3e44' : '#8d9096';
  const parts: BufferGeometry[] = [
    box(5.2, 0.12, 2.1, 0, 0.7, 0, deck),
    box(5.2, 0.1, 0.1, 0, 0.62, 0.8, DARK),
    box(5.2, 0.1, 0.1, 0, 0.62, -0.8, DARK),
    box(1.6, 0.08, 0.12, 3.3, 0.62, 0, DARK),
    box(0.1, 0.18, 2.1, 2.6, 0.82, 0, deck),
  ];
  for (const z of [1.15, -1.15])
    parts.push(
      lod === 0
        ? wheel(0.33, 0.2, -0.3, z)
        : box(0.66, 0.5, 0.2, -0.3, 0.33, z, DARK),
    );
  return finish(parts);
};

/** Double-cab pickup (5.2 m, the background pickup) in team colours with an open bed. */
export const pickup: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const m = streetCarModel(streetCarIndex('pickup'), lod);
  return finish([
    m.geometry(t.base),
    ...sideStripe(1.6, 0.14, -1.45, 0.98, t.accent, m.sideZ),
  ]);
};

/**
 * Pop-up gazebo, long side along X, open on every side: pitched canopy in team colours with a white-striped valance,
 * corner legs. Variant % 13 = team (12 = white timekeeper tent), variant / 13 = 3 x 3 / 3 x 6 m.
 */
function gazebo(variant: number, lod: number, long: boolean): BufferGeometry[] {
  const idx = variant % 13;
  const roof = idx === TEAM_COUNT ? WHITE : team(idx).base;
  const trim = idx === TEAM_COUNT ? '#2a6fd0' : team(idx).accent;
  const trim2 = idx === TEAM_COUNT ? WHITE : team(idx).accent2;
  const L = long ? 6 : 3;
  const W = 3;
  const parts: BufferGeometry[] = [
    tilted(L, 0.05, W / 2 + 0.05, 0, 2.62, W / 4, 0.2, roof),
    tilted(L, 0.05, W / 2 + 0.05, 0, 2.62, -W / 4, -0.2, roof),
    box(L, 0.24, 0.04, 0, 2.38, W / 2 + 0.02, trim),
    box(L, 0.24, 0.04, 0, 2.38, -W / 2 - 0.02, trim),
    box(0.04, 0.24, W, L / 2 + 0.02, 2.38, 0, trim2),
    box(0.04, 0.24, W, -L / 2 - 0.02, 2.38, 0, trim2),
    box(L, 0.06, 0.06, 0, 2.77, 0, '#c8cbd0'),
  ];
  const xs = long ? [-L / 2, 0, L / 2] : [-L / 2, L / 2];
  for (const x of xs)
    for (const z of [W / 2 - 0.05, -W / 2 + 0.05])
      parts.push(post(x, z, 2.45, 0.035, '#c8cbd0', lod ? 4 : 6));
  return parts;
}

export const gazeboShort: AssetBuilder = ({ variant, lod }) =>
  finish(gazebo(variant, lod, false));
export const gazeboLong: AssetBuilder = ({ variant, lod }) =>
  finish(gazebo(variant, lod, true));

// --- team cars ----------------------------------------------------------------------------------

/**
 * A team's rally car as a catalog entry: only the collider (solid) and the placement matter. The car itself is the
 * real model at a low LOD, drawn by world/park-car-mesh.ts; this stand-in (a 1 cm cube inside it) is never in view.
 */
export const teamCar: AssetBuilder = () =>
  finish([box(0.01, 0.01, 0.01, 0, 0.5, 0, DARK)]);

// --- props ---------------------------------------------------------------------------------------

/** Stack of 2-4 tyres (variant + 2). */
export const tyreStack: AssetBuilder = ({ variant, lod }) => {
  const n = 2 + (variant % 3);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++)
    parts.push(
      solid(
        new CylinderGeometry(0.33, 0.33, 0.22, lod ? 6 : 9).translate(
          0,
          0.11 + i * 0.22,
          0,
        ),
        '#1c1c1e',
      ),
    );
  if (lod === 0)
    parts.push(
      solid(
        new CylinderGeometry(0.2, 0.2, 0.012, 8).translate(
          0,
          n * 0.22 + 0.006,
          0,
        ),
        '#9aa0a8',
      ),
    );
  return finish(parts);
};

/** Rolling tool chest (variant = colour). */
export const toolChest: AssetBuilder = ({ variant }) => {
  const c = ['#c8321e', '#2a5fc0', '#3b3f46', '#e0a020'][variant % 4];
  return finish([
    box(0.95, 0.85, 0.55, 0, 0.5, 0, c),
    box(1.0, 0.06, 0.6, 0, 0.95, 0, '#2a2d34'),
    box(0.9, 0.04, 0.02, 0, 0.7, 0.285, '#c8cbd0'),
    box(0.9, 0.04, 0.02, 0, 0.5, 0.285, '#c8cbd0'),
    box(0.9, 0.04, 0.02, 0, 0.3, 0.285, '#c8cbd0'),
    solid(
      new CylinderGeometry(0.07, 0.07, 0.04, 6)
        .rotateX(Math.PI / 2)
        .translate(0.38, 0.07, 0.2),
      DARK,
    ),
    solid(
      new CylinderGeometry(0.07, 0.07, 0.04, 6)
        .rotateX(Math.PI / 2)
        .translate(-0.38, 0.07, 0.2),
      DARK,
    ),
  ]);
};

/** Folding table with two chairs and a laptop. */
export const tableChairs: AssetBuilder = () => {
  const parts: BufferGeometry[] = [box(1.8, 0.05, 0.8, 0, 0.75, 0, '#d9dbde')];
  for (const x of [-0.82, 0.82])
    for (const z of [-0.33, 0.33])
      parts.push(box(0.05, 0.73, 0.05, x, 0.37, z, '#8d9096'));
  for (const x of [-0.45, 0.45])
    parts.push(
      box(0.45, 0.05, 0.45, x, 0.45, 0.85, '#2a2d34'),
      box(0.45, 0.45, 0.05, x, 0.72, 1.05, '#2a2d34'),
      box(0.04, 0.43, 0.04, x - 0.2, 0.22, 0.68, '#8d9096'),
      box(0.04, 0.43, 0.04, x + 0.2, 0.22, 0.68, '#8d9096'),
    );
  parts.push(
    box(0.32, 0.02, 0.22, -0.3, 0.79, 0.05, '#2b2d31'),
    box(0.5, 0.18, 0.3, 0.45, 0.85, 0, '#c8321e'),
  );
  return finish(parts);
};

/** Generator on a frame. */
export const generator: AssetBuilder = () =>
  finish([
    box(1.0, 0.7, 0.6, 0, 0.6, 0, '#d98a1c'),
    box(1.04, 0.06, 0.64, 0, 0.98, 0, '#2a2d34'),
    box(1.1, 0.06, 0.7, 0, 0.22, 0, '#2a2d34'),
    box(0.3, 0.2, 0.02, 0.2, 0.7, 0.31, '#16181c'),
  ]);

/** Feather flag on a pole (variant = team); the flag is a two-sided tapered sheet facing +Z. */
export const featherFlag: AssetBuilder = ({ variant }) => {
  const t = team(variant);
  const poleH = 3.4;
  return finish([
    post(0, 0, poleH, 0.02, '#9aa0a8', 5),
    box(0.4, 0.04, 0.4, 0, 0.02, 0, '#2a2d34'),
    sheet(
      [
        [0, poleH, 0],
        [0.1, poleH - 0.05, 0],
        [0, poleH - 1.1, 0],
        [0.55, poleH - 0.7, 0],
        [0, poleH - 2.2, 0],
        [0.3, poleH - 1.5, 0],
      ],
      t.base,
    ),
    sheet(
      [
        [0, poleH - 1.0, 0.002],
        [0.5, poleH - 0.75, 0.002],
        [0, poleH - 1.5, 0.002],
        [0.45, poleH - 1.3, 0.002],
      ],
      t.accent,
    ),
  ]);
};

/** Ground sheet, unit 1 x 1 m scaled to the bay (variants: blue, grey, green, black tarp). */
export const groundSheet: AssetBuilder = ({ variant }) =>
  finish([
    box(
      1,
      0.02,
      1,
      0,
      0.01,
      0,
      ['#3d4f6b', '#6a6f76', '#2f5a3c', '#26282c'][variant % 4],
    ),
  ]);

/** Trolley jack (red) with a long handle. */
export const trolleyJack: AssetBuilder = () =>
  finish([
    box(0.7, 0.14, 0.28, 0, 0.12, 0, '#c8321e'),
    box(0.2, 0.18, 0.2, 0.1, 0.25, 0, '#c8321e'),
    tilted(1.0, 0.04, 0.05, -0.65, 0.35, 0, 0, '#2a2d34'),
    wheel(0.05, 0.05, 0.28, 0.17),
    wheel(0.05, 0.05, 0.28, -0.17),
  ]);

// --- public side and control ---------------------------------------------------------------------------

/** Catering van (variant = colour, the background low-roof van): serving hatch with an awning flap, counter. */
export const foodTruck: AssetBuilder = ({ variant, lod }) => {
  const c = ['#e0b020', '#c8321e', '#14908c'][variant % 3];
  return finish([
    serviceVehicleModel('van_low', lod).geometry(c),
    box(1.6, 0.7, 0.03, -0.9, 1.45, SIDE + 0.012, '#16181c'),
    tilted(1.9, 0.04, 0.9, -0.9, 2.05, SIDE + 0.55, 0.35, WHITE),
    box(1.8, 0.05, 0.4, -0.9, 1.15, SIDE + 0.2, '#c8cbd0'),
  ]);
};

/** Portable toilet cabin (variant = colour). */
export const portaToilet: AssetBuilder = ({ variant }) => {
  const c = ['#2f7a4a', '#2a6fd0', '#8d9096'][variant % 3];
  return finish([
    box(1.2, 2.3, 1.2, 0, 1.15, 0, c),
    box(1.25, 0.06, 1.25, 0, 2.33, 0, WHITE),
    box(0.8, 1.9, 0.03, 0, 1.0, 0.61, '#d9dbde'),
  ]);
};

/** Fuel trailer: lying tank on a two-wheel chassis, hose reel. */
export const fuelTrailer: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [
    box(3.4, 0.12, 1.5, 0, 0.7, 0, DARK),
    solid(
      new CylinderGeometry(0.6, 0.6, 2.6, lod ? 8 : 12)
        .rotateZ(Math.PI / 2)
        .translate(0, 1.4, 0),
      '#c8321e',
    ),
    box(1.2, 0.06, 0.06, 2.1, 0.64, 0, DARK),
    box(0.5, 0.5, 0.2, 0.9, 0.95, 0.76, '#2a2d34'),
  ];
  for (const z of [0.85, -0.85])
    parts.push(
      lod === 0
        ? wheel(0.33, 0.2, -0.2, z)
        : box(0.66, 0.5, 0.2, -0.2, 0.33, z, DARK),
    );
  return finish(parts);
};

/**
 * Control board on a post (symbol only, no lettering): 0 yellow board with a black clock disc (start of the control
 * zone), 1 red board with a white bar (the control).
 */
export const controlBoard: AssetBuilder = ({ variant }) => {
  const c = variant % 2 ? '#c8161d' : '#f0c020';
  const parts: BufferGeometry[] = [
    post(0, 0, 2.2, 0.03, '#8d9096', 5),
    box(0.9, 0.9, 0.05, 0, 1.9, 0, c),
    box(0.94, 0.04, 0.04, 0, 2.37, 0.005, DARK),
    box(0.94, 0.04, 0.04, 0, 1.43, 0.005, DARK),
  ];
  parts.push(
    variant % 2
      ? box(0.62, 0.16, 0.02, 0, 1.9, 0.035, WHITE)
      : solid(
          new CylinderGeometry(0.28, 0.28, 0.02, 10)
            .rotateX(Math.PI / 2)
            .translate(0, 1.9, 0.035),
          DARK,
        ),
  );
  return finish(parts);
};
