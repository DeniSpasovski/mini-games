import {
  clamp,
  lerp,
  smoothstep,
  spline,
  table,
  type P2,
} from '../shared/mesh-kit';

/**
 * Zastava 101 body dimensions (metres, model space: +X left, +Y up from the ground at ride
 * height, +Z forward, z = 0 at the centre of mass).
 *
 * Traced from the blueprints in sources/cars/zastava-101: `ref-08-blueprint-dimensions.png`
 * gives the hard numbers (length 3836, wheelbase 2448, overhangs 611 / 776, height 1392,
 * width 1590, track 1304 / 1320 mm); the outlines were read off `ref-07-blueprint.png`
 * (clean line art of the same drawing, 88.6 px/m in the side view once scaled by the wheelbase).
 * Styling details that differ from the early car in the blueprint (rectangular headlights,
 * black plastic bumpers) follow the reference photos ref-01..06.
 */

export const WHEEL_R = 0.285;
export const AXLE_F = 0.98;
export const AXLE_R = -1.47;
/** Body extremes: bonnet lip, tail corner; bumpers reach 1.591 / -2.246 (overall length 3.837). */
export const Z_TIP = 1.576;
export const Z_TAIL = -2.11;
export const BUMPER_F = 1.591;
export const BUMPER_R = -2.246;

// --- side view: centreline silhouette -------------------------------------------------------

/** Windscreen (centreline): base on the scuttle -> roof header. */
export const SCREEN: [P2, P2] = [
  [0.611, 0.918],
  [0.19, 1.345],
];
/** Rear screen (centreline): hatch hinge -> kink where the hatch panel flattens. */
export const REAR_SCREEN: [P2, P2] = [
  [-1.292, 1.31],
  [-1.688, 0.952],
];
/** Tail lip (centreline). */
export const TAIL_LIP: P2 = [-2.122, 0.754];

const bonnetC = spline([
  [0.611, 0.918],
  [0.66, 0.904],
  [0.83, 0.892],
  [1.0, 0.883],
  [1.147, 0.873],
  [1.282, 0.86],
  [1.395, 0.844],
  [1.508, 0.822],
  [1.553, 0.797],
  [1.576, 0.766],
]);
const roofC = spline([
  [-1.292, 1.31],
  [-1.225, 1.341],
  [-1.146, 1.358],
  [-1.021, 1.37],
  [-0.852, 1.379],
  [-0.525, 1.383],
  [-0.242, 1.381],
  [-0.073, 1.375],
  [0.05, 1.369],
  [0.13, 1.36],
  [0.19, 1.345],
]);
const line = (a: P2, b: P2, z: number) =>
  lerp(a[1], b[1], (z - a[0]) / (b[0] - a[0]));

/** Height of the body's top surface on the centreline. */
export function centre(z: number): number {
  if (z >= SCREEN[0][0]) return bonnetC(z);
  if (z >= SCREEN[1][0]) return line(SCREEN[0], SCREEN[1], z);
  if (z >= REAR_SCREEN[0][0]) return roofC(z);
  if (z >= REAR_SCREEN[1][0]) return line(REAR_SCREEN[0], REAR_SCREEN[1], z);
  if (z >= -2.105) return line(REAR_SCREEN[1], [-2.105, 0.762], z);
  return line([-2.105, 0.762], TAIL_LIP, z);
}

// --- side view: edge between the body side and the top surfaces ---------------------------------

/** A pillar (edge of the windscreen): base at the beltline -> roof corner. */
export const A_PILLAR: [P2, P2] = [
  [0.526, 0.884],
  [0.17, 1.307],
];
/** Edge of the rear screen: roof corner -> kink. */
export const C_EDGE: [P2, P2] = [
  [-1.247, 1.285],
  [-1.665, 0.915],
];
/** Roof edge (drip rail) height. */
export const rail = spline([
  [-1.247, 1.285],
  [-1.15, 1.305],
  [-1.0, 1.32],
  [-0.8, 1.327],
  [-0.3, 1.328],
  [0.0, 1.325],
  [0.1, 1.318],
  [0.17, 1.307],
]);
/** Edge of the hatch panel below the rear screen, down to the tail corner. */
export const hatchEdge = table([
  [Z_TAIL, 0.75],
  [-2.049, 0.76],
  [-1.665, 0.915],
]);

/** How far the centre of a bonnet cross-line sits ahead of its ends (the scuttle is bowed). */
export const bonnetBow = (z: number) =>
  0.085 * clamp((1.45 - z) / 0.924, 0, 1) ** 2;
/** Top edge of the front wing. */
const wingTop = (z: number) =>
  bonnetC(Math.min(Z_TIP, z + bonnetBow(z))) -
  0.034 * clamp((1.45 - z) / 0.924, 0, 1);
/** Beltline (door top / window sill). */
export const belt = (z: number) =>
  0.878 + 0.006 * clamp((z - 0.3) / 0.226, 0, 1);
/** Where the hatch edge comes down to beltline height. */
export const Z_HATCH_BELT = -1.757;

/** Top of the body side below the glass: wing top, beltline, then the hatch edge. */
export function shoulder(z: number): number {
  if (z >= A_PILLAR[0][0]) return wingTop(z);
  if (z >= Z_HATCH_BELT) return belt(z);
  return hatchEdge(z);
}

// --- plan + sections ----------------------------------------------------------------------------

/** Half width at the body crease (widest line of the panels, without the arch lips / corners). */
export const halfWidth = spline([
  [Z_TAIL, 0.672],
  [-2.05, 0.682],
  [-1.767, 0.722],
  [-1.55, 0.75],
  [-1.2, 0.755],
  [-0.3, 0.755],
  [0.66, 0.755],
  [1.17, 0.737],
  [1.37, 0.728],
  [Z_TIP, 0.722],
]);
/** Height of the crease that runs the length of the body side. */
export const crease = spline([
  [Z_TAIL, 0.73],
  [-1.5, 0.74],
  [-0.75, 0.745],
  [0.2, 0.755],
  [0.53, 0.758],
  [1.0, 0.742],
  [1.47, 0.726],
  [Z_TIP, 0.72],
]);
/** Nose / tail corners in plan: how much narrower the body is `d` metres behind the nose face. */
export const cornerF = (d: number) =>
  d < 0.07 ? 0.07 * (1 - Math.sqrt(1 - ((0.07 - d) / 0.07) ** 2)) : 0;
export const cornerT = (d: number) =>
  d < 0.06 ? 0.07 * (1 - Math.sqrt(1 - ((0.06 - d) / 0.06) ** 2)) : 0;

/** The side glass plane leans in from the beltline to the roof rail. */
export const RAIL_Y = 1.327;
export const RAIL_HW = 0.595;
/** Half width of the top of the body side (wing top / base of the side glass). */
export const xTop = (z: number) => halfWidth(z) - 0.045;
/** Half width of the cabin side (pillars, side glass) at height y. */
export const cabinX = (z: number, y: number) =>
  lerp(xTop(z), RAIL_HW, (y - belt(z)) / (RAIL_Y - belt(z)));

// --- lower edge + wheel arches --------------------------------------------------------------------

export interface Arch {
  z: number;
  /** Radius of the opening. */
  r: number;
  /** Width of the flared lip round the opening and how far it stands out. */
  lipW: number;
  lipOut: number;
}
export const ARCH_F: Arch = { z: AXLE_F, r: 0.349, lipW: 0.05, lipOut: 0.028 };
export const ARCH_R: Arch = { z: AXLE_R, r: 0.31, lipW: 0.055, lipOut: 0.028 };

const sill = table([
  [Z_TAIL, 0.275],
  [-1.8, 0.27],
  [-1.1, 0.255],
  [0.6, 0.255],
  [1.35, 0.25],
  [Z_TIP, 0.25],
]);
/** Lower edge of the body side: sill / valances, cut by the wheel arches. */
export function lowerEdge(z: number): number {
  let y = sill(z);
  for (const a of [ARCH_F, ARCH_R]) {
    const dz = z - a.z;
    if (Math.abs(dz) < a.r)
      y = Math.max(y, WHEEL_R + Math.sqrt(a.r * a.r - dz * dz));
  }
  return y;
}
/** Outward offset of the flared wheel-arch lip at a point of the body side. */
export function archLip(z: number, y: number): number {
  let out = 0;
  for (const a of [ARCH_F, ARCH_R]) {
    const d = Math.hypot(z - a.z, Math.max(0, y - WHEEL_R)) - a.r;
    if (d > -1e-6 && d < a.lipW)
      out = Math.max(out, a.lipOut * smoothstep(a.lipW, a.lipW * 0.55, d));
  }
  return out;
}

// --- nose + tail faces ------------------------------------------------------------------------------

/**
 * Nose face ("shark nose": the bonnet lip overhangs the grille): how far behind the lip the
 * face sits at height y.
 */
export const noseSetback = table([
  [0.25, 0.073],
  [0.5, 0.063],
  [0.766, 0],
]);
/** Tail panel: how far ahead of the tail lip it sits at height y. */
export const tailSetback = table([
  [0.27, 0.05],
  [0.32, 0.027],
  [0.5, 0.008],
  [0.7, 0.006],
  [0.74, 0.004],
  [0.75, 0],
]);
/** Grille opening in the nose panel (ref-09): half width, bottom / top heights. */
export const GRILLE_X = 0.59;
export const GRILLE_Y0 = 0.52;
export const GRILLE_Y1 = 0.72;
/** Lean of the grille panel (rad, about X). */
export const NOSE_LEAN = Math.atan2(0.063, 0.266);

// --- glass ----------------------------------------------------------------------------------------

/** Side window openings (z, y), corners before rounding. */
export const WINDOW_F: P2[] = [
  [0.339, 0.897],
  [0.074, 1.251],
  [-0.406, 1.257],
  [-0.406, 0.895],
];
export const WINDOW_R: P2[] = [
  [-0.508, 0.895],
  [-0.508, 1.257],
  [-1.055, 1.262],
  [-1.281, 0.895],
];
/** Door shut lines (z): wing / front door, front / rear door. */
export const SEAM_FRONT = 0.492;
export const SEAM_MID = -0.458;
/** Rear edge of the rear door: down from the beltline, then round the wheel arch. */
export const SEAM_REAR: P2[] = [
  [-1.3, 0.878],
  [-1.27, 0.658],
  [-1.203, 0.568],
  [-1.124, 0.455],
  [-1.09, 0.4],
  [-1.067, 0.32],
];
export const DOOR_BOTTOM = 0.32;
