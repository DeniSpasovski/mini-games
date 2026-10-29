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
import {
  RECOVERY_COLORS,
  recoveryTruck,
  teamSemi,
} from '../../maps/ajvatovci/start-row/build/vehicles';
import { tyreOnRim, TYRE_W } from './simready';
import { box, EXTRAS_LOD, finish, solid, wheel, withExtras } from './vehicles';

/**
 * Service park assets (rally paddock): team trucks, vans, trailers, gazebos, props, the team car stand-in and the
 * public extras. Team-coloured assets use the team index (builders/teams.ts) as variant. The team trucks, vans, pickups
 * and the catering van are the background models with their own textures (street-car-models.ts) in the team paint, their
 * side stripes and awnings a second draw call in the `vehicle` material; the tractor-trailer is the baked lorry model with
 * its own textures; everything else is boxes + a few cylinders in the `vehicle` material (vertex colours, one draw call per
 * asset). Vehicles face +X with the origin on the ground under their middle; a truck's awning and a gazebo's open front are
 * on the +Z side. No logos or lettering.
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
  const parts: BufferGeometry[] =
    lod <= EXTRAS_LOD
      ? [
          ...sideStripe(4.6, 0.38, -1.65, 1.55, t.accent),
          ...sideStripe(4.6, 0.12, -1.65, 1.9, t.accent2),
        ]
      : [];
  // Awning: canopy sloping down to the valance, two legs.
  parts.push(
    tilted(4.6, 0.07, 3.8, -1.65, 2.85, 3.0, 0.07, WHITE),
    box(4.6, 0.3, 0.05, -1.65, 2.6, 4.9, t.accent),
  );
  for (const x of [-3.8, 0.5]) parts.push(post(x, 4.8, 2.7, 0.04, '#b8bcc2'));
  return withExtras(
    serviceVehicleModel('box_truck', lod).geometry(t.base),
    parts,
  );
};

/**
 * Team tractor-trailer (17.5 m): the baked lorry model (maps/ajvatovci/start-row/build/truck-models.ts) in the team's
 * colour, drawn with its own textures (`teamSemi`).
 */
export const serviceSemi: AssetBuilder = ({ variant, lod }) => ({
  parts: teamSemi(team(variant).base, lod),
});

/**
 * Recovery tow truck of a parc fermé (7 m): the baked dump cab with a roll-back deck, one colour all over (variant =
 * colour of the fleet's tow palette), drawn with its own textures (`recoveryTruck`).
 */
export const serviceTow: AssetBuilder = ({ variant, lod }) => ({
  parts: recoveryTruck(RECOVERY_COLORS[variant % RECOVERY_COLORS.length], lod),
});

/** Panel van (5.6 m, the background high-roof van) in team colours with side stripes. */
export const serviceVan: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  return withExtras(
    serviceVehicleModel('van_high', lod).geometry(t.base),
    lod <= EXTRAS_LOD
      ? [
          ...sideStripe(3.4, 0.28, -1.1, 1.1, t.accent),
          ...sideStripe(3.4, 0.09, -1.1, 1.38, t.accent2),
        ]
      : [],
  );
};

/**
 * Flat car trailer (5.5 m): deck with side rails and a folded ramp at -X, round wheels outside the deck under
 * fenders, an A-frame tow bar with a coupler and jockey wheel to +X. Variant 0 grey, 1 dark.
 */
export const carTrailer: AssetBuilder = ({ variant, lod }) => {
  const deck = variant ? '#3b3e44' : '#8d9096';
  const parts: BufferGeometry[] = [
    box(5.2, 0.1, 2.1, 0, 0.72, 0, deck),
    box(5.2, 0.12, 0.1, 0, 0.61, 0.85, DARK),
    box(5.2, 0.12, 0.1, 0, 0.61, -0.85, DARK),
    // Tow bar: two bars of the A-frame meeting at the coupler.
    solid(
      new BoxGeometry(2.0, 0.08, 0.08).rotateY(0.3).translate(3.05, 0.62, 0.4),
      DARK,
    ),
    solid(
      new BoxGeometry(2.0, 0.08, 0.08)
        .rotateY(-0.3)
        .translate(3.05, 0.62, -0.4),
      DARK,
    ),
    box(0.3, 0.14, 0.2, 4.05, 0.62, 0, DARK),
    // Folded ramp at the back.
    solid(
      new BoxGeometry(0.06, 0.6, 1.9).rotateZ(0.12).translate(-2.62, 1.05, 0),
      deck,
    ),
  ];
  for (const z of [1.05, -1.05]) {
    parts.push(box(5.2, 0.08, 0.06, 0, 0.8, z, deck));
    parts.push(box(0.1, 0.12, 2.0, 2.55, 0.82, 0, deck));
  }
  for (const z of [1.17, -1.17]) {
    parts.push(box(0.95, 0.05, 0.3, -0.3, 0.74, z, deck));
    if (lod < 2)
      for (const g of tyreOnRim(lod))
        parts.push(
          g
            .scale(1.1, 1.1, 1.1)
            .rotateY(Math.PI / 2)
            .translate(-0.3, 0.33, z),
        );
    else parts.push(box(0.66, 0.5, 0.22, -0.3, 0.33, z, DARK));
  }
  if (lod <= EXTRAS_LOD) parts.push(post(3.6, 0, 0.5, 0.04, DARK, 6));
  return finish(parts);
};

/** Double-cab pickup (5.2 m, the background pickup) in team colours with an open bed. */
export const pickup: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const m = streetCarModel(streetCarIndex('pickup'), lod);
  return withExtras(
    m.geometry(t.base),
    lod <= EXTRAS_LOD
      ? sideStripe(1.6, 0.14, -1.45, 0.98, t.accent, m.sideZ)
      : [],
  );
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

/** Stack of 2-4 tyres (variant + 2): the rack's rally tyres on their rims, lying on each other. */
export const tyreStack: AssetBuilder = ({ variant, lod }) => {
  const n = 2 + (variant % 3);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++)
    for (const g of tyreOnRim(lod > 1 ? 0 : lod))
      parts.push(
        g.rotateZ(Math.PI / 2).translate(0, TYRE_W / 2 + i * TYRE_W, 0),
      );
  return finish(parts);
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

// --- public side and control ---------------------------------------------------------------------------

/** Catering van (variant = colour, the background low-roof van): serving hatch with an awning flap, counter. */
export const foodTruck: AssetBuilder = ({ variant, lod }) => {
  const c = ['#e0b020', '#c8321e', '#14908c'][variant % 3];
  return withExtras(
    serviceVehicleModel('van_low', lod).geometry(c),
    lod <= EXTRAS_LOD
      ? [
          box(1.6, 0.7, 0.03, -0.9, 1.45, SIDE + 0.012, '#16181c'),
          tilted(1.9, 0.04, 0.9, -0.9, 2.05, SIDE + 0.55, 0.35, WHITE),
          box(1.8, 0.05, 0.4, -0.9, 1.15, SIDE + 0.2, '#c8cbd0'),
        ]
      : [],
  );
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
