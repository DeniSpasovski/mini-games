import { lerp, smoothstep, spline, table, type P2 } from '../shared/mesh-kit';

/**
 * Skoda Rally  body dimensions - metres, model space: +X left, +Y up from
 * the ground at the base stance, +Z forward, z = 0 at the centre of mass.
 *
 * Built from scratch, from public dimensions and press photos only (DETAILS.md "Sources"):
 * - `ref-01` (Skoda Auto press graphic: road Fabia 4th gen, orthographic 4-view with dimensions)
 *   gives the hard numbers (length 4108, wheelbase 2564, overhangs 809 / 735, height 1459, width
 *   1780 mm), the centreline silhouette (bonnet, screen, roof, tailgate), the plan outline and the
 *   roof crown. Side view 193.45 px/m (wheel centres 496 px apart), top view 186.95 px/m.
 * - `ref-02` (Skoda Motorsport studio photo, rally car pure side, 280.8 px/m between the wheel
 *   centres) gives everything on the body side plane - belt line, windows, pillars, door seams,
 *   arch openings, flares, skirt, lamps - and the rally add-ons (scoop, vents, wing, splitter).
 *   A plane parallel to the sensor images with one uniform scale, so only side-plane features were
 *   read off it; centreline / inboard features (roof top, bonnet centre) come from `ref-01`.
 * - `ref-03` / `ref-04` (rear / front photos): tumblehome, flare width, grille / lamp / wing outlines.
 *
 * Stance: the press car sits 7 cm lower on its hubs than the road car (tarmac set-up). The
 * blueprint uses a base stance 4 cm below the road car (`STANCE_DROP`), between the tarmac and
 * gravel set-ups; the game's ride-height presets move the body from there. Road-car heights are
 * stored as `y_road - 0.326 + WHEEL_R - STANCE_DROP`, rally-photo heights as
 * `y_photo - 0.335 + WHEEL_R + 0.03` (hub heights 0.326 / 0.335 m in the two pictures).
 */

export const WHEEL_R = 0.321;
export const WHEELBASE = 2.564;
export const AXLE_F = 1.15;
export const AXLE_R = AXLE_F - WHEELBASE;
/** Body 4 cm lower on the hubs than the road car (press tarmac car: 7 cm). */
export const STANCE_DROP = 0.04;

// --- road car (ref-01, spec sheet) ---------------------------------------------------------------

export const ROAD = {
  length: 4.108,
  overhangF: 0.809,
  overhangR: 0.735,
  height: 1.459,
  width: 1.78,
  widthMirrors: 1.954,
  trackF: 1.525,
  trackR: 1.509,
  /** Tyre radius of the pictured road car (18 inch wheel). */
  wheelR: 0.326,
  approachDeg: 14.1,
  departureDeg: 17.5,
} as const;
/** Road bumper tips. */
export const BUMPER_F_ROAD = AXLE_F + ROAD.overhangF;
export const BUMPER_R_ROAD = AXLE_R - ROAD.overhangR;
/** Roof top (centreline peak) at the base stance. */
export const ROOF_Y = ROAD.height - ROAD.wheelR + WHEEL_R - STANCE_DROP;

// --- rally extremes (ref-02 / 03 / 04) -----------------------------------------------------------

/** Rally bumper face, splitter lip, rear bumper (rearmost body line). */
export const Z_TIP = 1.98;
export const SPLITTER_Z = 2.0;
export const Z_TAIL = -2.2;
/** Half width over the arch flares (Rally2 homologation width 1.82 m). */
export const OVERALL_HW = 0.91;

// --- side view: centreline silhouette ------------------------------------------------------------

/** Windscreen (centreline): scuttle -> header (the roof curve takes over above the header). */
export const SCREEN: [P2, P2] = [
  [0.86, 0.965],
  [0.15, 1.33],
];
/** Rear screen (centreline): under the roof lip -> tailgate top edge. */
export const REAR_SCREEN: [P2, P2] = [
  [-1.65, 1.26],
  [-1.95, 1.0],
];
/** Roof trailing lip (the road car's roof spoiler edge; the rally wing stands behind it). */
export const ROOF_LIP: P2 = [-1.62, 1.33];
/** Tail: tailgate panel foot (above the bumper) and the bumper's rearmost line. */
export const TAIL_FOOT: P2 = [-2.1, 0.62];
export const TAIL_LIP: P2 = [Z_TAIL, 0.5];

const bonnetC = spline([
  [0.86, 0.965],
  [0.95, 0.968],
  [1.1, 0.957],
  [1.3, 0.927],
  [1.5, 0.885],
  [1.65, 0.845],
  [1.75, 0.815],
  [1.85, 0.76],
  [1.93, 0.7],
  [Z_TIP, 0.6],
]);
const roofC = spline([
  [-1.62, 1.33],
  [-1.5, 1.351],
  [-1.3, 1.375],
  [-1.1, 1.392],
  [-0.9, 1.405],
  [-0.6, ROOF_Y],
  [-0.3, ROOF_Y - 0.002],
  [-0.1, 1.4],
  [0.05, 1.37],
  [0.15, 1.33],
]);
const line = (a: P2, b: P2, z: number) =>
  lerp(a[1], b[1], (z - a[0]) / (b[0] - a[0]));

/** Height of the body's top surface on the centreline. */
export function centre(z: number): number {
  if (z >= SCREEN[0][0]) return bonnetC(z);
  if (z >= SCREEN[1][0]) return line(SCREEN[0], SCREEN[1], z);
  if (z >= ROOF_LIP[0]) return roofC(z);
  if (z >= REAR_SCREEN[0][0]) return line(ROOF_LIP, REAR_SCREEN[0], z);
  if (z >= REAR_SCREEN[1][0]) return line(REAR_SCREEN[0], REAR_SCREEN[1], z);
  if (z >= TAIL_FOOT[0]) return line(REAR_SCREEN[1], TAIL_FOOT, z);
  return line(TAIL_FOOT, TAIL_LIP, z);
}

// --- side view: edge between the body side and the top surfaces ----------------------------------

/** Windscreen side edge: scuttle corner (bonnet meets glass at the wing) -> roof corner. */
export const SCREEN_SIDE: [P2, P2] = [
  [0.75, 0.96],
  [0.12, 1.33],
];
/** A pillar rear edge = front edge of the door glass: belt -> roof rail. */
export const A_PILLAR: [P2, P2] = [
  [0.5, 0.88],
  [0.05, 1.325],
];
/** B pillar (black, between the door windows): front / rear edge. */
export const B_PILLAR_Z: [number, number] = [-0.42, -0.48];
/** C pillar leading edge (end of the quarter glass): near vertical from the belt to the roof. */
export const C_PILLAR: [P2, P2] = [
  [-1.18, 1.003],
  [-1.19, 1.29],
];
/** Side edge of the rear screen: roof corner -> tail lamp top. */
export const C_EDGE: [P2, P2] = [
  [-1.2, 1.29],
  [-1.85, 1.01],
];
/** Roof edge (rail) height above the door glass. */
export const rail = spline([
  [-1.2, 1.315],
  [-1.0, 1.333],
  [-0.6, 1.34],
  [-0.2, 1.338],
  [0.05, 1.325],
]);
export const RAIL_Y = 1.335;

/** Top edge of the front wing / bonnet side edge (headlight top to the door). */
const wingTop = table([
  [0.55, 0.872],
  [0.8, 0.892],
  [0.95, 0.9],
  [1.05, 0.89],
  [1.15, 0.875],
  [1.3, 0.85],
  [1.5, 0.815],
  [1.6, 0.78],
  [1.7, 0.72],
  [1.8, 0.66],
  [1.93, 0.6],
  [Z_TIP, 0.55],
]);
/** Belt line (door top / window sill): a wedge rising towards the rear. */
export const belt = (z: number) => 0.878 + 0.075 * (0.5 - z);
export const Z_BELT_F = 0.5;
export const Z_BELT_R = C_PILLAR[0][0];
/**
 * Rear quarter: tail lamp top edge down to the bumper top at the rear corner. Behind z -1.95 this
 * sits ABOVE `centre(z)`: the tailgate is set back at the centreline (`tailSetback`), the corners
 * carry the lamps further back.
 */
const quarterEdge = table([
  [Z_TAIL, 0.75],
  [TAIL_FOOT[0], 0.88],
  [-2.0, 0.96],
  [C_EDGE[1][0], C_EDGE[1][1]],
]);

/** Top of the body side below the glass: wing top, belt, then the rear screen edge / quarter. */
export function shoulder(z: number): number {
  if (z >= Z_BELT_F) return wingTop(z);
  if (z >= Z_BELT_R) return belt(z);
  if (z >= C_EDGE[0][0]) return C_PILLAR[1][1];
  if (z >= C_EDGE[1][0]) return line(C_EDGE[0], C_EDGE[1], z);
  return quarterEdge(z);
}

// --- plan + sections -----------------------------------------------------------------------------

/** Half width of the widest body line (door bulge at crease height; no flares, mirrors, handles). */
export const halfWidth = spline([
  [Z_TAIL, 0.2],
  [-2.15, 0.34],
  [-2.1, 0.52],
  [-2.05, 0.66],
  [-2.0, 0.746],
  [-1.95, 0.778],
  [-1.9, 0.8],
  [-1.8, 0.822],
  [-1.7, 0.843],
  [-1.6, 0.853],
  [-1.4, 0.86],
  [-1.0, 0.866],
  [-0.6, 0.866],
  [-0.2, 0.885],
  [0.0, 0.87],
  [0.6, 0.866],
  [1.0, 0.875],
  [1.3, 0.868],
  [1.5, 0.855],
  [1.6, 0.826],
  [1.7, 0.8],
  [1.75, 0.75],
  [1.8, 0.69],
  [1.85, 0.635],
  [1.9, 0.58],
  [1.95, 0.5],
  [Z_TIP, 0.3],
]);
/** Height of the widest line (the body side bulges here, tucks in above and below). */
export const CREASE_Y = 0.6;
/** Sections (ref-03): sill tucked 1.5 cm, belt 7.5 cm, glass leaning in to the rail. */
export const SILL_TUCK = 0.015;
export const BELT_TUCK = 0.075;
export const RAIL_HW = 0.6;
/** Half width of the body side at height y (below the shoulder). */
export function sideX(z: number, y: number): number {
  const w = halfWidth(z);
  // Above the crease the side tucks in up to the belt (or the wing top ahead of the doors).
  const ref = z <= Z_BELT_F ? Math.min(shoulder(z), belt(z)) : shoulder(z);
  if (y >= CREASE_Y) return w - BELT_TUCK * smoothstep(CREASE_Y, ref, y) ** 1.2;
  return w - SILL_TUCK * smoothstep(CREASE_Y, 0.25, y);
}
/** Half width of the cabin side (pillars, side glass) at height y. */
export const cabinX = (z: number, y: number) =>
  lerp(
    halfWidth(z) - BELT_TUCK - 0.02,
    RAIL_HW,
    (y - belt(z)) / (RAIL_Y - belt(z)),
  );
/** Roof crown: how far below the centreline the roof is at |x| (flat middle, rounded shoulder). */
export const crownDrop = (x: number) => {
  const a = Math.abs(x);
  if (a <= 0.45) return 0.015 * (a / 0.45) ** 2;
  return 0.015 + 0.063 * smoothstep(0.45, RAIL_HW, a) ** 0.8;
};
/** Nose / tail corners in plan: how much narrower the body is `d` metres behind the face. */
export const cornerF = (d: number) =>
  d < 0.09 ? 0.09 * (1 - Math.sqrt(1 - ((0.09 - d) / 0.09) ** 2)) : 0;
export const cornerT = (d: number) =>
  d < 0.08 ? 0.09 * (1 - Math.sqrt(1 - ((0.08 - d) / 0.08) ** 2)) : 0;

// --- lower edge, wheel arches, flares, skirt ------------------------------------------------------

export interface Arch {
  z: number;
  /** Opening outline (z -> top of the opening) read off ref-02; wider than a circle at the sill. */
  opening: readonly P2[];
  /** Width of the flare band round the opening. */
  lipW: number;
}
export const ARCH_F: Arch = {
  z: AXLE_F,
  opening: [
    [0.68, 0.19],
    [0.7, 0.26],
    [0.75, 0.38],
    [0.8, 0.52],
    [0.85, 0.63],
    [0.9, 0.71],
    [0.95, 0.725],
    [1.05, 0.72],
    [1.15, 0.714],
    [1.2, 0.703],
    [1.3, 0.671],
    [1.4, 0.597],
    [1.45, 0.53],
    [1.5, 0.42],
    [1.55, 0.19],
  ],
  lipW: 0.07,
};
export const ARCH_R: Arch = {
  z: AXLE_R,
  opening: [
    [-1.85, 0.25],
    [-1.8, 0.4],
    [-1.75, 0.55],
    [-1.7, 0.65],
    [-1.65, 0.725],
    [-1.6, 0.764],
    [-1.5, 0.764],
    [-1.4, 0.757],
    [-1.35, 0.746],
    [-1.3, 0.732],
    [-1.25, 0.71],
    [-1.2, 0.678],
    [-1.15, 0.636],
    [-1.1, 0.57],
    [-1.05, 0.45],
    [-1.0, 0.24],
  ],
  lipW: 0.07,
};
/** How far the flare band stands out beyond the body side. */
export const FLARE_OUT = OVERALL_HW - 0.87;

/** Lower edge of the painted body (sill / bumper bottoms); the black skirt hangs below it. */
export const sill = table([
  [Z_TAIL, 0.42],
  [-2.0, 0.42],
  [-1.9, 0.29],
  [-1.85, 0.247],
  [-1.0, 0.237],
  [0.65, 0.19],
  [1.55, 0.141],
  [1.8, 0.137],
  [Z_TIP, 0.16],
]);
/** Black side skirt under the doors. */
export const SKIRT = {
  z: [0.66, -0.95] as const,
  y: [0.13, 0.19] as const,
  out: 0.03,
};
/** Top of the arch opening at z, or -Infinity outside it. */
export function archTop(a: Arch, z: number): number {
  const o = a.opening;
  if (z <= o[0][0] || z >= o[o.length - 1][0]) return -Infinity;
  return table(o)(z);
}
/** Lower edge of the body side: sill / valances, cut by the wheel arches. */
export function lowerEdge(z: number): number {
  return Math.max(sill(z), archTop(ARCH_F, z), archTop(ARCH_R, z));
}
/** Outward offset of the flare band at a point of the body side. */
export function archLip(z: number, y: number): number {
  let out = 0;
  for (const a of [ARCH_F, ARCH_R]) {
    // distance to the opening edge: vertical gap above the opening, radial beyond its ends
    const o = a.opening;
    const z0 = o[0][0];
    const z1 = o[o.length - 1][0];
    const d =
      z >= z0 && z <= z1
        ? Math.max(0, y - archTop(a, z))
        : Math.hypot(z < z0 ? z0 - z : z - z1, Math.max(0, y - 0.19));
    if (d < a.lipW)
      out = Math.max(out, FLARE_OUT * smoothstep(a.lipW, a.lipW * 0.45, d));
  }
  return out;
}

// --- nose + tail faces ---------------------------------------------------------------------------

/** Nose: how far behind the bumper face (Z_TIP) the centreline sits at height y (grille / bonnet lip lean back). */
export const noseSetback = table([
  [0.16, 0],
  [0.6, 0],
  [0.7, 0.05],
  [0.76, 0.13],
  [0.815, 0.23],
  [0.845, 0.33],
]);
/** Tail: how far ahead of the rear bumper's rearmost line the centreline sits at height y. */
export const tailSetback = table([
  [0.25, 0.08],
  [0.4, 0.02],
  [0.5, 0],
  [0.62, 0.1],
  [1.0, 0.25],
]);
/** Grille (hexagon, ref-04): half width, bottom / top, lean of the nose panel (rad, about X). */
export const GRILLE = {
  hw: 0.36,
  y0: 0.5,
  y1: 0.72,
  lean: Math.atan2(0.06, 0.22),
};
export const INTAKE_LOW = { hw: 0.46, y0: 0.24, y1: 0.42 };
export const INTAKE_CORNER = {
  x: [0.56, 0.8] as const,
  y: [0.3, 0.44] as const,
};
/** Lamps wrap the corner: [z, x, y] at the inner end (on the face) and the outer end (on the side). */
export const HEADLIGHT = {
  inner: [1.95, 0.45, 0.7] as const,
  outer: [1.6, 0.84, 0.74] as const,
  h: 0.08,
};
export const TAIL_LAMP = {
  inner: [-2.17, 0.42, 0.86] as const,
  outer: [-1.85, 0.84, 0.95] as const,
  h: 0.1,
};

// --- glass, seams, handles -----------------------------------------------------------------------

/** Side window openings (z, y), corners before rounding. */
export const WINDOW_F: P2[] = [
  [A_PILLAR[0][0], 0.885],
  [A_PILLAR[1][0], A_PILLAR[1][1]],
  [B_PILLAR_Z[0], 1.335],
  [B_PILLAR_Z[0], 0.947],
];
export const WINDOW_R: P2[] = [
  [B_PILLAR_Z[1], 0.952],
  [B_PILLAR_Z[1], 1.335],
  [-1.0, 1.33],
  [-1.07, 0.995],
];
export const WINDOW_Q: P2[] = [
  [-1.09, 0.997],
  [-1.03, 1.33],
  [-1.17, 1.31],
  [C_PILLAR[0][0], C_PILLAR[0][1]],
];
/** Door shut lines (z): wing / front door, front / rear door. */
export const SEAM_FRONT = 0.58;
export const SEAM_MID = -0.45;
/** Rear edge of the rear door: down from the belt, then round the rear arch to the sill. */
export const SEAM_REAR: P2[] = [
  [-1.13, 1.0],
  [-1.12, 0.85],
  [-1.08, 0.72],
  [-1.0, 0.6],
  [-0.97, 0.45],
  [-0.97, 0.26],
];
export const DOOR_BOTTOM = 0.19;
/** Door handles (z range, y centre). */
export const HANDLE_F = { z: [-0.05, -0.27] as const, y: 0.785 };
export const HANDLE_R = { z: [-0.9, -1.1] as const, y: 0.82 };

// --- rally add-ons -------------------------------------------------------------------------------

/** Roof scoop (carbon, mouth forward). */
export const SCOOP = { z: [0.3, -0.1] as const, hw: 0.22, top: ROOF_Y + 0.05 };
/** Bonnet vents (two, carbon frames, mesh inside). */
export const VENT = {
  z: [1.25, 1.5] as const,
  x: [0.45, 0.72] as const,
  depth: 0.02,
};
/** Rear wing: chord (leading -> trailing z), heights, half span, end plates, swan-neck pylons. */
export const WING = {
  z: [-2.0, -2.38] as const,
  y: [1.33, 1.4] as const,
  halfSpan: 0.72,
  plateH: 0.12,
  pylonX: 0.45,
  pylonBase: [-1.85, 1.25] as const,
};
/** Front splitter (carbon): lip z, half width, height band, how far back it runs. */
export const SPLITTER = {
  z: SPLITTER_Z,
  hw: 0.9,
  y: [0.09, 0.13] as const,
  back: 1.6,
};
/** Rear diffuser / bumper box bottom. */
export const DIFFUSER = { z: [-2.15, -1.9] as const, hw: 0.75, y: 0.25 };
/** Mirrors on the sail panel (z, y range, x range). */
export const MIRROR = {
  z: 0.5,
  y: [0.95, 1.03] as const,
  x: [0.88, 1.05] as const,
};
/** Rear door glass: black vent panel along the top (5 rounded openings; 1 on the quarter glass). */
export const VENT_PANEL_H = 0.08;
