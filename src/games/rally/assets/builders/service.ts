import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
} from 'three';
import type { CarProfile } from '../../cars/shared/types';
import type { AssetBuilder } from '../types';
import { TEAM_COUNT, TEAM_SHAPE, TEAMS } from './teams';
import { box, carParts, finish, SHAPES, solid, wheel } from './vehicles';

/**
 * Service park assets (rally paddock): team trucks, vans, trailers, gazebos, props, the team cars and the public
 * extras. Team-coloured assets use the team index (builders/teams.ts) as variant; everything is boxes + a few
 * cylinders in the `vehicle` material (vertex colours, one draw call per asset). Vehicles face +X with the origin on
 * the ground under their middle; a truck's awning and a gazebo's open front are on the +Z side. No logos or lettering.
 */

const WHITE = '#f2f2f2';
const DARK = '#1d1d20';
const GLASS = '#1b232b';

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

/** Cab colour: the team's base, or dark grey where the base is too light to read as a cab. */
const cabColor = (base: string): string =>
  base === '#eeeeee' || base === '#f0c020' ? '#d4d6da' : base;

/** Box truck (9 m) in team colours with a side awning on +Z (6 x 3.8 m, two legs). */
export const serviceTruck: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const parts: BufferGeometry[] = [
    box(9, 0.35, 2.1, 0, 0.55, 0, DARK),
    box(6.6, 2.6, 2.5, -1.2, 2.15, 0, t.base),
    box(1.9, 2.2, 2.4, 3.4, 1.7, 0, cabColor(t.base)),
    box(0.06, 0.85, 2.2, 4.36, 2.35, 0, GLASS),
    box(6.62, 0.38, 2.52, -1.2, 1.55, 0, t.accent),
    box(6.62, 0.12, 2.52, -1.2, 1.9, 0, t.accent2),
    box(0.06, 2.2, 2.3, -4.52, 2.1, 0, '#3a3d42'),
  ];
  for (const z of [1.21, -1.21])
    parts.push(box(1.1, 0.7, 0.04, 3.5, 2.35, z, GLASS));
  if (lod === 0)
    for (const x of [3.2, -2.4, -3.7])
      for (const z of [1.05, -1.05]) parts.push(wheel(0.55, 0.4, x, z));
  else
    for (const z of [1.05, -1.05])
      parts.push(box(8, 0.55, 0.4, -0.5, 0.55, z, DARK));
  // Awning: canopy sloping down to the valance, two legs.
  parts.push(
    tilted(6, 0.07, 3.8, -1.2, 3.1, 3.2, 0.07, WHITE),
    box(6, 0.3, 0.05, -1.2, 2.85, 5.1, t.accent),
  );
  for (const x of [-3.9, 1.5]) parts.push(post(x, 5.0, 2.95, 0.04, '#b8bcc2'));
  return finish(parts);
};

/** Panel van (5.4 m) in team colours with a roof rack. */
export const serviceVan: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const parts: BufferGeometry[] = [
    box(5.2, 0.3, 1.9, 0, 0.5, 0, DARK),
    box(3.4, 1.85, 2.0, -0.7, 1.5, 0, t.base),
    box(1.8, 1.2, 2.0, 1.8, 1.1, 0, cabColor(t.base)),
    tilted(1.0, 0.06, 1.9, 1.75, 1.78, 0, 0, cabColor(t.base)),
    box(0.06, 0.7, 1.8, 2.5, 1.5, 0, GLASS),
    box(3.42, 0.3, 2.02, -0.7, 1.25, 0, t.accent),
    box(3.42, 0.1, 2.02, -0.7, 1.55, 0, t.accent2),
  ];
  for (const z of [1.01, -1.01])
    parts.push(box(0.9, 0.55, 0.03, 1.7, 1.6, z, GLASS));
  if (lod === 0) {
    for (const x of [1.7, -1.6])
      for (const z of [0.95, -0.95]) parts.push(wheel(0.36, 0.26, x, z));
    for (const x of [-1.5, 0.1])
      parts.push(box(0.06, 0.06, 1.8, x, 2.5, 0, '#8d9096'));
  } else
    for (const z of [0.95, -0.95])
      parts.push(box(4.2, 0.4, 0.26, 0, 0.4, z, DARK));
  return finish(parts);
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

/** Double-cab pickup (5.2 m) in team colours with an open bed. */
export const pickup: AssetBuilder = ({ variant, lod }) => {
  const t = team(variant);
  const parts: BufferGeometry[] = [
    box(5.0, 0.3, 1.8, 0, 0.55, 0, DARK),
    box(2.3, 0.85, 1.9, 0.9, 0.95, 0, t.base),
    box(1.5, 0.6, 1.8, 0.55, 1.65, 0, t.base),
    box(0.05, 0.5, 1.7, 1.3, 1.68, 0, GLASS),
    box(2.2, 0.5, 1.9, -1.6, 0.9, 0, t.base),
    box(2.2, 0.06, 1.7, -1.6, 1.12, 0, '#2a2d34'),
    box(2.22, 0.14, 1.92, -1.6, 1.0, 0, t.accent),
  ];
  for (const z of [0.95, -0.95])
    parts.push(box(0.9, 0.38, 0.03, 0.6, 1.68, z, GLASS));
  if (lod === 0)
    for (const x of [1.6, -1.6])
      for (const z of [0.9, -0.9]) parts.push(wheel(0.37, 0.26, x, z));
  else
    for (const z of [0.9, -0.9])
      parts.push(box(3.8, 0.4, 0.26, 0, 0.4, z, DARK));
  return finish(parts);
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

// --- team cars -------------------------------------------------------------------------------------

/** Upper edge of a closed (z, y) outline at z (the roof line). */
function envelope(outline: number[], z: number): number {
  let best = -Infinity;
  const n = outline.length / 2;
  for (let i = 0; i < n; i++) {
    const [za, ya] = [outline[2 * i], outline[2 * i + 1]];
    const j = (i + 1) % n;
    const [zb, yb] = [outline[2 * j], outline[2 * j + 1]];
    if (Math.min(za, zb) > z || Math.max(za, zb) < z) continue;
    best = Math.max(
      best,
      za === zb ? Math.max(ya, yb) : ya + ((yb - ya) * (z - za)) / (zb - za),
    );
  }
  return best;
}

/** A stripe along the car's centre line (width `w`, centre offset `x`) over bonnet, roof and boot. */
function stripe(
  s: CarProfile,
  x: number,
  w: number,
  color: string,
  lift: number,
): BufferGeometry {
  const zs = s.outline.filter((_, i) => i % 2 === 0);
  const [z0, z1] = [Math.min(...zs) + 0.12, Math.max(...zs) - 0.12];
  const pos: number[] = [];
  const step = 0.14;
  let prev: [number, number] | undefined;
  for (let z = z0; z <= z1 + 1e-6; z += step) {
    const y = envelope(s.outline, z) + lift;
    if (prev) {
      const [pz, py] = prev;
      const a = [x - w / 2, py, pz];
      const b = [x + w / 2, py, pz];
      const c = [x - w / 2, y, z];
      const d = [x + w / 2, y, z];
      for (const p of [a, c, b, b, c, d]) pos.push(...p);
    }
    prev = [z, y];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return solid(g, color);
}

/**
 * A team's rally car: one of the boxy rally cars (cars/<car>/profile.ts, the team's own shape) in the team's colours -
 * two bonnet / roof / boot stripes, a door band, white door plates. Variants 12-23 stand raised on axle stands with
 * the rear wheels off (a wheel change under way). Faces +X.
 */
export const teamCar: AssetBuilder = ({ variant, lod }) => {
  const idx = variant % TEAM_COUNT;
  const raised = variant >= TEAM_COUNT;
  const t = TEAMS[idx];
  const s = SHAPES[TEAM_SHAPE[idx]];
  const parts = carParts(s, t.base, lod, raised ? 1 : -1);
  if (lod === 0) {
    // Model space (z along the car) until the final turn to +X.
    const model: BufferGeometry[] = [
      stripe(s, -0.14, 0.2, t.accent, 0.006),
      stripe(s, 0.14, 0.2, t.accent, 0.006),
      stripe(s, 0, 0.08, t.accent2, 0.009),
    ];
    const hw = s.width / 2 + 0.004;
    const belt = s.wheel * 1.75;
    const [zr, zf] = [s.axles[1] + 0.5, s.axles[0] - 0.5];
    for (const side of [1, -1]) {
      model.push(
        solid(
          new BoxGeometry(0.014, 0.1, zf - zr).translate(
            side * hw,
            belt,
            (zf + zr) / 2,
          ),
          t.accent2,
        ),
        solid(
          new BoxGeometry(0.014, 0.22, 0.55).translate(
            side * hw,
            belt + 0.22,
            zf - 0.55,
          ),
          WHITE,
        ),
      );
    }
    for (const g of model) {
      g.rotateY(Math.PI / 2);
      parts.push(g);
    }
  }
  if (raised) {
    for (const g of parts) g.translate(0, 0.16, 0);
    const z = s.axles[1];
    for (const side of [1, -1])
      for (const dz of lod ? [0] : [-0.3, 0.3])
        parts.push(
          box(
            0.4,
            0.06,
            0.4,
            z + dz,
            0.03,
            side * (s.width / 2 - 0.3),
            '#c8321e',
          ),
          box(
            0.07,
            0.34,
            0.07,
            z + dz,
            0.2,
            side * (s.width / 2 - 0.3),
            '#c8321e',
          ),
        );
  }
  return finish(parts);
};

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

/** Catering van (variant = colour): serving hatch with an awning flap, counter. */
export const foodTruck: AssetBuilder = ({ variant, lod }) => {
  const c = ['#e0b020', '#c8321e', '#14908c'][variant % 3];
  const parts: BufferGeometry[] = [
    box(5.0, 0.3, 1.9, 0, 0.5, 0, DARK),
    box(3.2, 2.05, 2.1, -0.8, 1.6, 0, c),
    box(1.6, 1.3, 2.0, 1.65, 1.15, 0, c),
    box(0.06, 0.65, 1.8, 2.43, 1.55, 0, GLASS),
    box(1.6, 0.7, 0.03, -0.8, 1.75, 1.06, '#16181c'),
    tilted(1.9, 0.04, 0.9, -0.8, 2.35, 1.5, 0.35, WHITE),
    box(1.8, 0.05, 0.4, -0.8, 1.38, 1.2, '#c8cbd0'),
  ];
  if (lod === 0)
    for (const x of [1.6, -1.6])
      for (const z of [0.95, -0.95]) parts.push(wheel(0.38, 0.26, x, z));
  else
    for (const z of [0.95, -0.95])
      parts.push(box(4, 0.4, 0.26, 0, 0.4, z, DARK));
  return finish(parts);
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
