import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { AssetBuilder } from '../types';
import { EVENT_COLOR, TEAM_COUNT, teamDress, TEAMS } from './teams';
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
import { tyreOnRim, TYRE_R, TYRE_W } from './simready';
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

type P3 = [number, number, number];

/** A straight beam `w` wide (sideways) and `h` deep (up) from `a` to `b`. */
function bar(
  a: P3,
  b: P3,
  w: number,
  h: number,
  color: string,
): BufferGeometry {
  const from = new Vector3(...a);
  const to = new Vector3(...b);
  const m = new Matrix4().lookAt(to, from, new Vector3(0, 1, 0));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  return solid(
    new BoxGeometry(w, h, from.distanceTo(to))
      .applyMatrix4(m)
      .translate(mid.x, mid.y, mid.z),
    color,
  );
}

/** Triangles seen from both sides (fabric): the `under` colour on the back faces. */
function cloth(tris: P3[][], color: string, under = color): BufferGeometry[] {
  const face = (flip: boolean): BufferGeometry => {
    const pos: number[] = [];
    for (const [a, b, c] of tris)
      for (const p of flip ? [a, c, b] : [a, b, c]) pos.push(...p);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return solid(g, flip ? under : color);
  };
  return [face(false), face(true)];
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
  const d = teamDress(t);
  const parts: BufferGeometry[] =
    lod <= EXTRAS_LOD
      ? [
          ...sideStripe(4.6, 0.38, -1.65, 1.55, d.band),
          ...sideStripe(4.6, 0.12, -1.65, 1.9, d.trim),
        ]
      : [];
  // Awning: canopy sloping down to the valance, two legs.
  parts.push(
    tilted(4.6, 0.07, 3.8, -1.65, 2.85, 3.0, 0.07, WHITE),
    box(4.6, 0.3, 0.05, -1.65, 2.6, 4.9, t.dress),
  );
  for (const x of [-3.8, 0.5]) parts.push(post(x, 4.8, 2.7, 0.04, '#b8bcc2'));
  return withExtras(
    serviceVehicleModel('box_truck', lod).geometry(d.main),
    parts,
  );
};

/**
 * Team tractor-trailer (17.5 m): the baked lorry model (maps/ajvatovci/start-row/build/truck-models.ts) in the team's
 * colour, drawn with its own textures (`teamSemi`).
 */
export const serviceSemi: AssetBuilder = ({ variant, lod }) => ({
  parts: teamSemi(team(variant).dress, lod),
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
  const d = teamDress(t);
  return withExtras(
    serviceVehicleModel('van_high', lod).geometry(d.main),
    lod <= EXTRAS_LOD
      ? [
          ...sideStripe(3.4, 0.28, -1.1, 1.1, d.band),
          ...sideStripe(3.4, 0.09, -1.1, 1.38, d.trim),
        ]
      : [],
  );
};

/**
 * Car transporter trailer (4.8 m bed, tandem axle), parked unhitched: two tread-plate runways on a ladder chassis, the
 * loading ramps pinned upright at the back, wheel stops and a winch post at the front, tie-down rails along the sides,
 * curved mudguards over the wheels (outside the bed), tail lamps on the rear member, an A-frame drawbar with coupling,
 * handbrake and jockey wheel to +X, rubber chocks under the wheels. Variant 0 galvanised, 1 painted dark.
 */
export const carTrailer: AssetBuilder = ({ variant, lod }) => {
  const steel = variant ? '#3b3e44' : '#8d9096';
  const plate = variant ? '#4a4d53' : '#a3a6aa';
  const near = lod === 0;
  const XB = -2.5;
  const XF = 2.3;
  const LEN = XF - XB;
  const MID = (XF + XB) / 2;
  const TOP = 0.5;
  const AXLES = [-1.0, -0.2];
  const WZ = 1.1;
  const parts: BufferGeometry[] = [];
  for (const s of [1, -1]) {
    parts.push(
      // Runway, its inner edge, the chassis rail outside it.
      box(LEN, 0.03, 0.58, MID, TOP - 0.015, s * 0.62, plate),
      box(LEN, 0.07, 0.03, MID, TOP - 0.05, s * 0.33, steel),
      box(LEN, 0.11, 0.05, MID, TOP - 0.075, s * 0.93, steel),
      // Drawbar side of the A-frame.
      bar([XF, 0.42, s * 0.72], [3.72, 0.42, s * 0.05], 0.06, 0.08, steel),
    );
    // Mudguard: flat over the two wheels, rounded down at both ends, a lip along its outer edge.
    const R = 0.2;
    const x0 = AXLES[0] - 0.42;
    const x1 = AXLES[1] + 0.42;
    const GY = 0.69;
    const arc = near ? 5 : 2;
    const profile: [number, number][] = [[x0, 0.4]];
    for (let i = 0; i <= arc; i++) {
      const t = ((i / arc) * Math.PI) / 2;
      profile.push([x0 + R - Math.cos(t) * R, GY - R + Math.sin(t) * R]);
    }
    for (let i = arc; i >= 0; i--) {
      const t = ((i / arc) * Math.PI) / 2;
      profile.push([x1 - R + Math.cos(t) * R, GY - R + Math.sin(t) * R]);
    }
    profile.push([x1, 0.4]);
    const zIn = s * 0.965;
    const zOut = s * 1.27;
    parts.push(
      sheet(
        profile.flatMap(([x, y]): P3[] => [
          [x, y, zIn],
          [x, y, zOut],
        ]),
        steel,
      ),
    );
    if (near)
      parts.push(
        sheet(
          profile.flatMap(([x, y]): P3[] => {
            // Towards the inside of the outline: across on the ends, to the corner centres on the arcs, down on top.
            const cx = Math.min(x1 - R, Math.max(x0 + R, x));
            const cy = Math.min(GY - R, y);
            const d = Math.hypot(cx - x, cy - y) || 1;
            return [
              [x, y, zOut],
              [x + ((cx - x) / d) * 0.045, y + ((cy - y) / d) * 0.045, zOut],
            ];
          }),
          steel,
        ),
      );
    // Wheels.
    for (const x of AXLES) {
      if (lod < 2)
        for (const g of tyreOnRim(lod))
          parts.push(g.rotateY(Math.PI / 2).translate(x, TYRE_R, s * WZ));
      else parts.push(box(0.6, 0.6, 0.2, x, 0.3, s * WZ, DARK));
    }
    // Loading ramp pinned upright on the back of its runway.
    const lean = 0.16;
    const foot: P3 = [XB - 0.03, TOP, s * 0.62];
    const up = (d: number, z: number): P3 => [
      foot[0] + Math.sin(lean) * d,
      foot[1] + Math.cos(lean) * d,
      z,
    ];
    const RAMP = 1.5;
    if (!near) {
      parts.push(bar(foot, up(RAMP, foot[2]), 0.5, 0.04, plate));
      continue;
    }
    for (const side of [-0.24, 0.24])
      parts.push(
        bar(
          up(0, foot[2] + side),
          up(RAMP, foot[2] + side),
          0.03,
          0.055,
          steel,
        ),
      );
    for (let i = 0; i < 9; i++) {
      const d = 0.08 + (i * (RAMP - 0.16)) / 8;
      parts.push(
        bar(up(d, foot[2] - 0.24), up(d, foot[2] + 0.24), 0.07, 0.014, plate),
      );
    }
    parts.push(
      // The stay that holds the ramp up.
      bar(
        up(0.75, s * 0.9),
        [XB + 0.62, TOP - 0.03, s * 0.9],
        0.014,
        0.022,
        DARK,
      ),
      // Wheel stop at the front of the runway.
      bar(
        [1.98, TOP, s * 0.62],
        [1.84, TOP + 0.15, s * 0.62],
        0.56,
        0.014,
        steel,
      ),
      bar(
        [1.84, TOP + 0.15, s * 0.62],
        [1.74, TOP, s * 0.62],
        0.56,
        0.014,
        steel,
      ),
      // Tie-down rail on its stanchions.
      box(4.3, 0.024, 0.024, MID, TOP + 0.11, s * 0.93, steel),
      // Tail lamp cluster (red, amber outside), amber side markers.
      box(0.02, 0.075, 0.16, XB - 0.035, 0.42, s * 0.76, '#b03024'),
      box(0.02, 0.075, 0.07, XB - 0.035, 0.42, s * 0.885, '#d88a1a'),
      box(0.07, 0.03, 0.012, 1.7, 0.42, s * 0.961, '#d88a1a'),
      box(0.07, 0.03, 0.012, -2.2, 0.42, s * 0.961, '#d88a1a'),
      // Rubber chocks before and behind the wheels.
      ...[AXLES[0] - 0.37, AXLES[1] + 0.37].map((x) =>
        solid(
          new CylinderGeometry(0.1, 0.1, 0.16, 3)
            .rotateX(Math.PI / 2)
            .rotateZ(Math.PI)
            .translate(x, 0.05, s * WZ),
          '#1c1c1e',
        ),
      ),
    );
    for (const x of [-2.25, -1.6, 0.4, 1.2, 2.05])
      parts.push(box(0.024, 0.11, 0.024, x, TOP + 0.055, s * 0.93, steel));
  }
  // Cross members of the ladder chassis, the axles.
  const members = near ? 9 : 3;
  for (let i = 0; i < members; i++)
    parts.push(
      box(0.05, 0.08, 1.86, XB + (i * LEN) / (members - 1), 0.43, 0, steel),
    );
  if (lod < 2)
    for (const x of AXLES) parts.push(box(0.06, 0.06, 2.1, x, 0.3, 0, DARK));
  // Coupling head on the point of the A-frame.
  parts.push(box(0.36, 0.07, 0.1, 3.85, 0.44, 0, steel));
  if (!near) return finish(parts);
  parts.push(
    solid(
      new CylinderGeometry(0.06, 0.06, 0.08, 10).translate(4.03, 0.44, 0),
      steel,
    ),
    bar([3.86, 0.49, 0], [4.0, 0.55, 0], 0.035, 0.02, DARK),
    box(0.05, 0.06, 0.8, 3.0, 0.42, 0, steel),
    // Handbrake lever.
    bar([3.5, 0.46, 0], [3.36, 0.74, 0], 0.02, 0.025, steel),
    bar([3.36, 0.74, 0], [3.33, 0.84, 0], 0.03, 0.035, DARK),
    // Jockey wheel clamped beside the drawbar, its crank on top.
    solid(
      new CylinderGeometry(0.028, 0.028, 0.5, 8).translate(3.3, 0.55, 0.24),
      steel,
    ),
    solid(
      new CylinderGeometry(0.02, 0.02, 0.2, 8).translate(3.3, 0.22, 0.24),
      steel,
    ),
    box(0.03, 0.14, 0.09, 3.3, 0.13, 0.24, steel),
    wheel(0.1, 0.06, 3.3, 0.24),
    box(0.13, 0.016, 0.016, 3.355, 0.81, 0.24, steel),
    box(0.02, 0.07, 0.02, 3.41, 0.84, 0.24, DARK),
    // Headboard rail, the winch post behind it.
    box(0.04, 0.34, 0.04, XF, 0.64, 0.93, steel),
    box(0.04, 0.34, 0.04, XF, 0.64, -0.93, steel),
    box(0.04, 0.04, 1.9, XF, 0.81, 0, steel),
    box(0.05, 0.5, 0.05, XF + 0.3, 0.7, 0, steel),
    box(0.16, 0.13, 0.12, XF + 0.3, 0.98, 0, DARK),
    bar([XF + 0.3, 0.98, 0.07], [XF + 0.42, 1.08, 0.07], 0.016, 0.02, steel),
    // Blank number plate on the rear member.
    box(0.012, 0.11, 0.5, XB - 0.032, 0.42, 0, '#e4e4de'),
  );
  return finish(parts);
};

/** Double-cab pickup (5.2 m, the background pickup) in team colours with an open bed. */
export const pickup: AssetBuilder = ({ variant, lod }) => {
  const d = teamDress(team(variant));
  const m = streetCarModel(streetCarIndex('pickup'), lod);
  return withExtras(
    m.geometry(d.main),
    lod <= EXTRAS_LOD
      ? sideStripe(1.6, 0.14, -1.45, 0.98, d.band, m.sideZ)
      : [],
  );
};

/** Aluminium of the tent frames, the cast weights on their feet. */
const ALU = '#c3c7cc';
const WEIGHT = '#2b2d31';

/**
 * Pop-up gazebo, long side along X, open on every side: a peaked canopy (one peak on the 3 x 3, a ridge between two on
 * the 3 x 6) in the team dressing colour with a valance all round and a band along its hem, on a folding frame - telescopic
 * legs on foot plates with a weight each, scissor trusses under the eaves and from the sides to the hub of every peak
 * pole. Variant % 13 = team (12 = white timekeeper tent), variant / 13 = 3 x 3 / 3 x 6 m.
 */
function gazebo(variant: number, lod: number, long: boolean): BufferGeometry[] {
  const idx = variant % 13;
  const { main: roof, band } =
    idx === TEAM_COUNT
      ? { main: WHITE, band: EVENT_COLOR }
      : teamDress(team(idx));
  const under = `#${new Color(roof).multiplyScalar(0.8).getHexString()}`;
  const near = lod === 0;
  const L = long ? 6 : 3;
  const W = 3;
  const EAVE = 2.3;
  const PEAK = 3.16;
  const DROP = 0.27;
  const hx = L / 2 + 0.02;
  const hz = W / 2 + 0.02;
  /** Peak poles (x): the canopy rises to each, a ridge between two. */
  const peaks = long ? [-1.5, 1.5] : [0];
  const p0 = peaks[0];
  const p1 = peaks[peaks.length - 1];
  const parts: BufferGeometry[] = [];

  // Canopy: hip ends, the long sides up to the peak / ridge.
  const tris: P3[][] = [
    [
      [-hx, EAVE, hz],
      [-hx, EAVE, -hz],
      [p0, PEAK, 0],
    ],
    [
      [hx, EAVE, -hz],
      [hx, EAVE, hz],
      [p1, PEAK, 0],
    ],
  ];
  for (const s of [1, -1]) {
    const a: P3 = [-hx * s, EAVE, hz * s];
    const b: P3 = [hx * s, EAVE, hz * s];
    const pa: P3 = [s > 0 ? p0 : p1, PEAK, 0];
    const pb: P3 = [s > 0 ? p1 : p0, PEAK, 0];
    tris.push([a, b, pb]);
    if (long) tris.push([a, pb, pa]);
  }
  parts.push(...cloth(tris, roof, under));

  // Valance: hangs from the eave all round, the band along its hem.
  const HEM = 0.08;
  const skirt = (y0: number, y1: number, out: number): P3[][] => {
    const x = hx + out;
    const z = hz + out;
    const ring: [number, number][] = [
      [-x, z],
      [x, z],
      [x, -z],
      [-x, -z],
    ];
    return ring.flatMap(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % 4];
      return [
        [
          [ax, y0, az],
          [bx, y0, bz],
          [bx, y1, bz],
        ],
        [
          [ax, y0, az],
          [bx, y1, bz],
          [ax, y1, az],
        ],
      ] as P3[][];
    });
  };
  parts.push(
    ...cloth(skirt(EAVE - DROP + HEM, EAVE, 0), roof, under),
    ...cloth(skirt(EAVE - DROP, EAVE - DROP + HEM, 0), band, under),
  );

  // Legs: the outer tube from the eave, the thinner inner one down to a foot plate, a weight on the foot.
  const xs = long ? [-L / 2, 0, L / 2] : [-L / 2, L / 2];
  const legZ = W / 2 - 0.05;
  const TOP = EAVE - 0.03;
  const LOW = EAVE - 0.58;
  for (const x of xs)
    for (const z of [legZ, -legZ]) {
      const lx = x - Math.sign(x) * 0.05;
      if (!near) {
        parts.push(box(0.04, EAVE, 0.04, lx, EAVE / 2, z, ALU));
        continue;
      }
      parts.push(
        box(0.042, EAVE - 0.95, 0.042, lx, (EAVE + 0.95) / 2, z, ALU),
        box(0.032, 1, 0.032, lx, 0.5, z, ALU),
        box(0.12, 0.008, 0.12, lx, 0.004, z, ALU),
        box(0.06, 0.07, 0.06, lx, LOW, z, WEIGHT),
        box(0.06, 0.06, 0.06, lx, TOP, z, WEIGHT),
        box(0.05, 0.03, 0.05, lx, 0.97, z, WEIGHT),
        solid(
          new CylinderGeometry(0.17, 0.18, 0.09, 14).translate(lx, 0.053, z),
          WEIGHT,
        ),
      );
    }
  if (!near) return parts;

  // Scissor trusses: crossed bars between two uprights (top and bottom joints `a` / `b` are x, z).
  const scissor = (
    a: [number, number],
    b: [number, number],
    topA = TOP,
    lowA = LOW,
    topB = TOP,
    lowB = LOW,
  ): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // The two bars pass side by side.
    const ox = (-(b[1] - a[1]) / len) * 0.009;
    const oz = ((b[0] - a[0]) / len) * 0.009;
    parts.push(
      bar(
        [a[0] + ox, topA, a[1] + oz],
        [b[0] + ox, lowB, b[1] + oz],
        0.014,
        0.028,
        ALU,
      ),
      bar(
        [a[0] - ox, lowA, a[1] - oz],
        [b[0] - ox, topB, b[1] - oz],
        0.014,
        0.028,
        ALU,
      ),
    );
  };
  const legX = L / 2 - 0.05;
  // Eave trusses: 1.5 m units along the sides and the ends (and between the middle legs of the 3 x 6).
  const stops = long ? [-legX, -1.5, 0, 1.5, legX] : [-legX, 0, legX];
  for (const z of [legZ, -legZ])
    for (let i = 0; i + 1 < stops.length; i++)
      scissor([stops[i], z], [stops[i + 1], z]);
  for (const x of long ? [-legX, 0, legX] : [-legX, legX]) {
    scissor([x, -legZ], [x, 0]);
    scissor([x, 0], [x, legZ]);
  }
  // Peak poles on a hub the inner trusses hold up; the hub sits a little higher than the eave trusses.
  const HUB_TOP = TOP + 0.16;
  const HUB_LOW = LOW + 0.16;
  for (const px of peaks) {
    parts.push(
      box(
        0.03,
        PEAK - 0.01 - HUB_LOW,
        0.03,
        px,
        (PEAK - 0.01 + HUB_LOW) / 2,
        0,
        ALU,
      ),
      box(0.055, 0.05, 0.055, px, HUB_TOP, 0, WEIGHT),
      box(0.055, 0.05, 0.055, px, HUB_LOW, 0, WEIGHT),
    );
    const from: [number, number][] = [
      [px, legZ],
      [px, -legZ],
      [Math.max(px - 1.5, -legX), 0],
      [Math.min(px + 1.5, legX), 0],
    ];
    for (const f of from) scissor(f, [px, 0], TOP, LOW, HUB_TOP, HUB_LOW);
  }
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
      t.dress,
    ),
    sheet(
      [
        [0, poleH - 1.0, 0.002],
        [0.5, poleH - 0.75, 0.002],
        [0, poleH - 1.5, 0.002],
        [0.45, poleH - 1.3, 0.002],
      ],
      t.neutral,
    ),
  ]);
};

/** Ground sheet, unit 1 x 1 m scaled to the bay (variants: slate, grey, olive, black tarp). */
export const groundSheet: AssetBuilder = ({ variant }) =>
  finish([
    box(
      1,
      0.02,
      1,
      0,
      0.01,
      0,
      ['#63656a', '#7b7c7d', '#4d5349', '#2a2c30'][variant % 4],
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

/** Portable toilet colours: [walls, door and its frame moulding]. */
const TOILET_COLORS: [string, string][] = [
  ['#2f7a4a', '#286a40'],
  ['#2a6fd0', '#245fb4'],
  ['#8d9096', '#7d8086'],
];

/**
 * Portable toilet cabin (variant = colour), 1.1 x 1.16 m, door on +Z: moulded walls with vertical ribs on a dark skid,
 * a pale translucent roof dome on a rim, the door in a raised frame with handle and red / green lock window, a vent
 * pipe up the back corner. No lettering.
 */
export const portaToilet: AssetBuilder = ({ variant, lod }) => {
  const [c, door] = TOILET_COLORS[variant % TOILET_COLORS.length];
  const W = 1.1;
  const D = 1.16;
  const TOP = 2.15;
  const parts: BufferGeometry[] = [
    box(W + 0.06, 0.1, D + 0.06, 0, 0.05, 0, '#2a2d30'),
    box(W, TOP - 0.1, D, 0, (TOP + 0.1) / 2, 0, c),
    box(W + 0.08, 0.06, D + 0.08, 0, TOP + 0.03, 0, '#d8dbde'),
    solid(
      new SphereGeometry(
        0.6,
        lod ? 8 : 14,
        lod ? 3 : 5,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      )
        .scale(0.95, 0.32, 1)
        .translate(0, TOP + 0.06, 0),
      '#e9ebe6',
    ),
    // Door and its frame on the front face.
    box(0.84, 1.86, 0.03, 0, 1.08, D / 2 + 0.01, door),
    box(0.07, 1.98, 0.05, -0.47, 1.12, D / 2 + 0.02, door),
    box(0.07, 1.98, 0.05, 0.47, 1.12, D / 2 + 0.02, door),
    box(1.01, 0.08, 0.05, 0, 2.08, D / 2 + 0.02, door),
    // Vent pipe up the back right corner, above the roof.
    solid(
      new CylinderGeometry(0.05, 0.05, 0.75, lod ? 5 : 8).translate(
        0.4,
        TOP - 0.05,
        -D / 2 - 0.05,
      ),
      '#3a3d42',
    ),
  ];
  if (lod === 0) {
    // Ribs down the sides and the back.
    for (const z of [-0.39, -0.13, 0.13, 0.39])
      for (const s of [1, -1])
        parts.push(box(0.03, 1.7, 0.07, (s * (W + 0.03)) / 2, 1.15, z, c));
    for (const x of [-0.3, 0, 0.3])
      parts.push(box(0.07, 1.7, 0.03, x, 1.15, -(D + 0.03) / 2, c));
    // Handle, lock window (red = occupied / green = free), hinge plates.
    parts.push(box(0.04, 0.16, 0.05, 0.33, 1.05, D / 2 + 0.04, '#c4c8cc'));
    parts.push(
      box(
        0.1,
        0.05,
        0.02,
        0.33,
        1.2,
        D / 2 + 0.03,
        variant % 2 ? '#2f9a3a' : '#c8321e',
      ),
    );
    for (const y of [0.45, 1.75])
      parts.push(box(0.04, 0.12, 0.04, -0.4, y, D / 2 + 0.04, '#9a9ea4'));
  }
  return finish(parts);
};

/**
 * Fuel trailer: a tank with dished ends strapped into two saddles on a ladder chassis, mudguards over the wheels, a
 * filler dome on top, pump cabinet and hose reel on the front deck, A-frame drawbar with a jockey wheel.
 */
export const fuelTrailer: AssetBuilder = ({ lod }) => {
  const RED = '#b5301c';
  const STEEL = '#8d9096';
  const CABINET = '#2a2d34';
  const near = lod === 0;
  // Tank: its axis along X, centre (TX, TY); a straight shell with ends dished DISH deep (a lathe about the axis).
  const R = 0.58;
  const HALF = 0.95;
  const DISH = 0.22;
  const TX = -0.45;
  const TY = 1.3;
  const arc = near ? 6 : 3;
  const profile: Vector2[] = [];
  for (let i = 0; i <= arc; i++) {
    const a = ((i / arc) * Math.PI) / 2;
    profile.push(new Vector2(Math.sin(a) * R, -HALF - Math.cos(a) * DISH));
  }
  for (let i = arc; i >= 0; i--) {
    const a = ((i / arc) * Math.PI) / 2;
    profile.push(new Vector2(Math.sin(a) * R, HALF + Math.cos(a) * DISH));
  }
  const round = (r: number, h: number, sides: number) =>
    new CylinderGeometry(r, r, h, sides);
  const parts: BufferGeometry[] = [
    solid(
      new LatheGeometry(profile, near ? 20 : 10)
        .rotateZ(Math.PI / 2)
        .translate(TX, TY, 0),
      RED,
    ),
    // Chassis rails, axle, front deck.
    box(3.2, 0.1, 0.08, -0.1, 0.6, 0.45, DARK),
    box(3.2, 0.1, 0.08, -0.1, 0.6, -0.45, DARK),
    box(0.08, 0.08, 1.6, -0.35, 0.33, 0, DARK),
    box(0.8, 0.04, 1, 1.1, 0.67, 0, STEEL),
    // Pump cabinet, the hose reel on it.
    box(0.45, 0.5, 0.8, 1.15, 0.94, 0, CABINET),
    solid(
      round(0.17, 0.3, 10)
        .rotateX(Math.PI / 2)
        .translate(1.15, 1.4, 0),
      DARK,
    ),
    // Filler dome.
    solid(round(0.2, 0.1, near ? 12 : 8).translate(TX, TY + R + 0.03, 0), RED),
    // A-frame drawbar and coupling.
    solid(
      new BoxGeometry(1.1, 0.07, 0.07).rotateY(0.42).translate(2, 0.6, 0.225),
      DARK,
    ),
    solid(
      new BoxGeometry(1.1, 0.07, 0.07).rotateY(-0.42).translate(2, 0.6, -0.225),
      DARK,
    ),
    box(0.25, 0.08, 0.1, 2.58, 0.62, 0, STEEL),
  ];
  for (const x of [TX - 0.6, TX + 0.6]) {
    // Saddle and the strap over the tank.
    parts.push(box(0.12, 0.3, 1, x, 0.8, 0, DARK));
    parts.push(
      solid(
        round(R + 0.012, 0.07, near ? 20 : 10)
          .rotateZ(Math.PI / 2)
          .translate(x, TY, 0),
        STEEL,
      ),
    );
  }
  for (const z of [0.82, -0.82]) {
    parts.push(
      near
        ? wheel(0.33, 0.2, -0.35, z)
        : box(0.66, 0.5, 0.2, -0.35, 0.33, z, DARK),
      box(0.9, 0.04, 0.26, -0.35, 0.72, z, CABINET),
    );
    if (!near) continue;
    parts.push(
      solid(
        round(0.16, 0.21, 12)
          .rotateX(Math.PI / 2)
          .translate(-0.35, 0.33, z),
        '#b9bcc0',
      ),
      box(0.04, 0.14, 0.26, -0.8, 0.67, z, CABINET),
      box(0.04, 0.14, 0.26, 0.1, 0.67, z, CABINET),
      // Reel flanges, tail lamps.
      solid(
        round(0.24, 0.03, 12)
          .rotateX(Math.PI / 2)
          .translate(1.15, 1.4, z > 0 ? 0.16 : -0.16),
        RED,
      ),
      box(0.03, 0.08, 0.14, -1.71, 0.6, z > 0 ? 0.45 : -0.45, '#b03024'),
    );
  }
  if (near)
    parts.push(
      // Chassis cross members, filler cap, the nozzle in its holster, jockey wheel.
      box(0.08, 0.08, 0.9, -1.6, 0.6, 0, DARK),
      box(0.08, 0.08, 0.9, 0.6, 0.6, 0, DARK),
      box(0.08, 0.08, 0.9, 1.45, 0.6, 0, DARK),
      solid(round(0.12, 0.05, 10).translate(TX, TY + R + 0.1, 0), STEEL),
      box(0.06, 0.22, 0.06, 0.98, 1.05, 0.43, STEEL),
      box(0.05, 0.5, 0.05, 2.3, 0.4, 0.16, STEEL),
      wheel(0.1, 0.07, 2.3, 0.16),
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
