import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Ray,
  Vector3,
  type Material,
} from 'three';
import { merge } from '../../engine/geo';
import {
  colorGap,
  plainCrew,
  type CrewLivery,
  type CrewMotif,
} from '../../cars/shared/livery';
import type { Cockpit } from '../../cars/shared/types';
import {
  camLock,
  gripGlove,
  knuckles,
  notes,
  slab,
  strap,
  type Grip,
} from './crew-gear';
import { helmet, HELMET_BACK, HELMET_POST, HELMET_TOP } from './crew-helmet';
import {
  BONE,
  BONES,
  bodyRig,
  pose as poseBones,
  RIGS,
  skinPoints,
  widen,
  type BodyModel,
  type BodyPose,
} from './people-body';
import {
  F_JERSEY,
  F_JERSEY_SLEEVE,
  F_TWILL,
  GLOVE,
  HAT,
  REFLECT,
  RIB,
  mapCell,
  tag,
} from './people-parts';
import { shoesOf } from './people-shoes';
import { clipAll, field, join, posed, type Surf } from './people-surf';
import {
  alongOf,
  between,
  heightIn,
  painted,
  split,
  splitIn,
  tailor,
  top,
  type Field,
  type Piece,
  type SplitOpts,
  type Tailor,
  type Where,
} from './people-tailor';
import type { AssetBuilder } from '../types';
import { TEAMS } from './teams';

/**
 * The crew in a rally car: the driver with both hands on the wheel, the co-driver with the pace notes, strapped into
 * the seats of one car. Built for that car's cockpit (`Cockpit`, measured on its model: seats, steering wheel, roof)
 * in the car's own frame (y = 0 the ground, +Z the nose, +X the car's left), so game/car-crew.ts adds it to the body
 * as it is. The figure is the people kit's base body in a race suit cut from it (people-tailor.ts), posed by reach:
 * hips in the seat, back along the backrest, the arms bent to wherever the wheel is. What makes it a rally crew is
 * worn over that: helmet (crew-helmet.ts), head restraint and six-point harness, gloves closed round the rim
 * (crew-gear.ts).
 */

export interface CrewParams {
  cockpit: Cockpit;
  /** What the crew wears with the car's livery: the colours and the motif of suit and helmet. */
  livery: CrewLivery;
}

/** What a part is drawn with: the people atlas (cloth and matt gear), a glossy paint (helmet shells and visors). */
export type CrewLook = 'atlas' | 'crew_gloss';

export interface CrewPart {
  geometry: BufferGeometry;
  look: CrewLook;
}

const MODEL: BodyModel = 'male';
/** Hip joint above the cushion and ahead of the backrest of someone sat in a seat (m). */
const HIP_UP = 0.085;
/** The same on a cushion pressed down as far as it goes. */
const HIP_LOW = 0.045;
/** Where the back meets a backrest, in the body's frame (pelvis origin): [y, z] of the seat and the shoulder blades. */
const BACK: [number, number][] = [
  [0.03, -0.132],
  [0.47, -0.153],
];
/** Size of the figure against the base body (a tall one): a driver of average height. */
const SCALE = 0.96;
/** How straight the arms reach for the wheel at most (1 = straight) while the seat can still move forward. */
const REACH = 0.86;
/** How far forward of the model's seat a driver may sit for that (m). */
const SLIDE = 0.2;
/** How far a driver sits up from the slouch to reach the wheel (rad). */
const SIT_UP = 0.1;
/** The lowest the pace notes are held above the hips: on the thighs. */
const LAP = 0.2;
/** The wrist to the knuckles (people-body.ts poses a hand this far past the wrist). */
const HAND = 0.085;
/** The middle of the body's wrist from its wrist joint (rest frame, left arm). */
const WRIST_OFF = [-0.021, 0.008, 0.027];
/** How small a figure may get to fit under a low roof: under that it sinks into the seat instead. */
const MIN_SCALE = 0.9;
const HEADROOM = 0.02;
/** Radius of a steering wheel's rim. */
const RIM = 0.016;
const CARBON = '#1c1d20';
/** Harness webbing: the one that shows best on the suit. */
const WEBBING = ['#b8202a', '#1d3f9c', '#18191c'];
const GLOVE_COLOR = '#1a1b1f';
const BALACLAVA = '#e6e4dc';

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const shade = (css: string, k: number): string =>
  `#${new Color(css).multiplyScalar(k).getHexString()}`;

/** The harness webbing that shows best on a suit of these colours. */
const webbingOn = (lv: CrewLivery): string =>
  WEBBING.reduce((best, x) => {
    const d = (y: string): number =>
      Math.min(colorGap(y, lv.main), colorGap(y, lv.second));
    return d(x) > d(best) ? x : best;
  });

/** The elbow / knee of a two-bone limb from `from` reaching `to`, bent towards `pole`. */
function reach(
  from: Vector3,
  to: Vector3,
  l1: number,
  l2: number,
  pole: Vector3,
): { up: Vector3; low: Vector3; mid: Vector3; end: Vector3 } {
  const d = to.clone().sub(from);
  const len = Math.min(
    l1 + l2 - 1e-4,
    Math.max(Math.abs(l1 - l2) + 1e-4, d.length()),
  );
  d.normalize();
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  const mid = from.clone().addScaledVector(d, a).addScaledVector(p, h);
  const end = from.clone().addScaledVector(d, len);
  return {
    up: mid.clone().sub(from).normalize(),
    low: end.clone().sub(mid).normalize(),
    mid,
    end,
  };
}

/** The body's surface in the rest frame (pelvis origin), for what lies on it. */
function surface(t: Tailor) {
  const s = t.cloth.s;
  const p = s.a.pos;
  const arm = s.a.arm;
  const neckY = RIGS[t.m].neck[0] - RIGS[t.m].hip - 0.03;
  const pick = (
    ok: (x: number, y: number, z: number) => boolean,
    score: (x: number, y: number, z: number) => number,
  ): number => {
    let best = -1;
    let bs = -Infinity;
    for (let i = 0; i < s.n; i++) {
      if (arm[i] > 0.6) continue;
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      if (!ok(x, y, z)) continue;
      const sc = score(x, y, z);
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    }
    return best;
  };
  return {
    /** Front (dir 1) or back (-1) of the torso at (x, y). */
    z(x: number, y: number, dir = 1): number {
      for (const win of [0.018, 0.035, 0.07]) {
        // On that side of it: a coarse mesh may have only a point of the other side this near.
        const i = pick(
          (px, py, pz) =>
            Math.abs(px - x) < win &&
            Math.abs(py - y) < win &&
            (pz - t.torsoZ) * dir > 0,
          (_x, _y, pz) => pz * dir,
        );
        if (i >= 0) return p[i * 3 + 2];
      }
      return t.torsoZ + dir * t.torsoB;
    },
    /** Top of the shoulder at x: its height and where it is front to back. */
    top(x: number): { y: number; z: number } {
      const i = pick(
        (px, py) => Math.abs(px - x) < 0.02 && py < neckY,
        (_x, py) => py,
      );
      // Its crest is a fifth of the way back (the highest point of a coarse mesh can be anywhere on it).
      const y = p[i * 3 + 1];
      const back = this.z(x, y - 0.03, -1);
      return { y, z: back + 0.79 * (this.z(x, y - 0.03) - back) };
    },
    /** Bone weights of the body next to a point. */
    weights(at: Vector3): Float32Array {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < s.n; i++) {
        const d =
          (p[i * 3] - at.x) ** 2 +
          (p[i * 3 + 1] - at.y) ** 2 +
          (p[i * 3 + 2] - at.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return s.a.w.subarray(best * BONES, best * BONES + BONES);
    },
  };
}

/** A mountain in a plane of two measures: under both slopes (`k` = rise over run) of a peak at (u0, v0). */
const peakOf = (
  U: Field,
  V: Field,
  u0: number,
  v0: number,
  k: number,
): Field[] => [
  (s, i) => v0 - V(s, i) - k * (U(s, i) - u0),
  (s, i) => v0 - V(s, i) + k * (U(s, i) - u0),
];

/**
 * A crescent in a plane of two measures, from `p` to `q`: between two arcs over that chord, one bulging `deep` to the
 * right of p -> q, one `flat` (0 = the chord itself). Pointed at both ends, widest in the middle.
 */
function lune(
  U: Field,
  V: Field,
  p: [number, number],
  q: [number, number],
  deep: number,
  flat: number,
): Field[] {
  const c = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const n = [(q[1] - p[1]) / c, -(q[0] - p[0]) / c];
  const arc = (sag: number): { x: number; y: number; r: number } => {
    const r = (c * c) / (8 * sag) + sag / 2;
    return { x: mid[0] + n[0] * (sag - r), y: mid[1] + n[1] * (sag - r), r };
  };
  const a = arc(deep);
  const inside: Field = (s, i) =>
    a.r - Math.hypot(U(s, i) - a.x, V(s, i) - a.y);
  if (flat < 1e-4)
    return [
      inside,
      (s, i) => (U(s, i) - p[0]) * n[0] + (V(s, i) - p[1]) * n[1],
    ];
  const b = arc(flat);
  return [inside, (s, i) => Math.hypot(U(s, i) - b.x, V(s, i) - b.y) - b.r];
}

/**
 * A race suit: close-cut overalls in the livery's main colour that carry its motif in the other two - on the shoulders
 * and sleeves first (what shows through the glass), then on the chest and legs. Matching, not a copy of the car: the
 * stripes, the split, the mountains come back as a suit maker would cut them. Every graphic is a straight or circular
 * cut of the cloth in its rest frame (people-tailor.ts `split`), so its edges are sharp at any mesh density.
 */
function raceSuit(
  t: Tailor,
  lv: CrewLivery,
  hi: boolean,
): { pieces: Piece[]; cover: Float32Array } {
  const rig = RIGS[t.m];
  const { main, second, third, motif } = lv;
  const Y = heightIn(t);
  const Xs: Field = (s, i) => s.a.pos[i * 3];
  const X: Field = (s, i) => Math.abs(s.a.pos[i * 3]);
  const Z: Field = (s, i) => s.a.pos[i * 3 + 2];
  const front: Field = (s, i) => s.a.nor[i * 3 + 2] * 0.05;
  const neg =
    (f: Field): Field =>
    (s, i) =>
      -f(s, i);
  const suit = top(t, {
    color: main,
    sleeve: t.reach - 0.02,
    neck: 'high',
    hem: 0.88,
    fit: 0.015,
    ease: 0.003,
    loose: -0.007,
    soft: 4,
    fold: 0.003,
    seed: 7,
    cell: F_JERSEY,
    sleeveCell: F_JERSEY_SLEEVE,
    trim: motif === 'plain' ? shade(second, 0.9) : third,
    collar: 0.05,
    suit: { hem: 0.11, cell: F_TWILL, flare: 0.006 },
  });
  let out = suit.pieces;
  // A cut is never cut again, so what lies on top is cut first.
  const all = (f: Field[], color: string, o: SplitOpts = {}): void => {
    out = split(out, f, { color, fixed: true, ...o });
  };
  const on = (
    where: Where,
    f: Field[],
    color: string,
    o: SplitOpts = {},
  ): void => {
    out = splitIn(out, { [where]: f }, { color, fixed: true, ...o });
  };

  // The arms' own measures (both arms as the left one): along and across the upper arm and the forearm.
  const unit = (a: number[]): number[] => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const cross = (a: number[], b: number[]): number[] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const upper = unit(rig.elbow.map((x, k) => x - rig.shoulder[k]));
  const fore = unit(rig.wrist.map((x, k) => x - rig.elbow[k]));
  const inward = unit(cross(upper, fore));
  const armM =
    (from: number[], dir: number[], k = 1): Field =>
    (s, i) => {
      const p = s.a.pos;
      return (
        k *
        ((Math.abs(p[i * 3]) - from[0]) * dir[0] +
          (p[i * 3 + 1] + rig.hip - from[1]) * dir[1] +
          (p[i * 3 + 2] - from[2]) * dir[2])
      );
    };
  /** Back from the wrist along the forearm. */
  const upArm = armM(rig.wrist, fore, -1);
  /** Out of the plane of the arm: > 0 on its outside. */
  const outer = armM(rig.shoulder, inward, -1);
  /** Across the upper arm / the forearm, + = its front. */
  const acU = armM(rig.shoulder, cross(inward, upper));
  const acF = armM(rig.elbow, cross(inward, fore));
  /** Past the elbow: < 0 on the upper arm, > 0 on the forearm. */
  const elbow = armM(rig.elbow, unit(upper.map((x, k) => x + fore[k])));
  const along = alongOf(t);

  // The gauntlets of the gloves over the ends of the sleeves, a band of trim round their edge: cut square to the
  // forearm, measured back from the wrist.
  on('arm', [(s, i) => 0.1 - upArm(s, i)], GLOVE_COLOR, {
    cell: GLOVE,
    raise: 0.005,
    slope: 0.004,
  });
  on('arm', [(s, i) => 0.116 - upArm(s, i)], third, {
    cell: GLOVE,
    raise: 0.005,
    slope: 0.004,
  });
  // Epaulettes: the straps a marshal pulls a driver out by.
  if (motif !== 'stripes')
    on(
      'torso',
      [
        ...between(X, 0.09, 0.165),
        (s, i) => 0.02 - Math.abs(Z(s, i) - rig.shoulder[2] - 0.02),
        (s, i) => (s.a.nor[i * 3 + 1] - 0.3) * 0.05,
      ],
      third,
      { raise: 0.005, slope: 0.006 },
    );
  // The belt of the suit.
  const under = motif === 'peaks' ? second : main;
  on(
    'torso',
    between(Y, rig.waist + 0.05, rig.waist + 0.095),
    motif === 'stripes' ? third : shade(under, 0.82),
    { raise: 0.003 },
  );
  // Patches on the chest of a suit with nothing else there: a light one on the left, the trim colour on the right.
  if (motif === 'plain' || motif === 'stripes') {
    const patch = (sd: number, color: string, y0: number, y1: number): void =>
      on(
        'torso',
        [
          ...between((s, i) => Xs(s, i) * sd, 0.04, 0.125),
          ...between(Y, y0, y1),
          front,
        ],
        color,
      );
    patch(
      1,
      colorGap(main, '#f1f1ec') > 0.4 ? '#f1f1ec' : second,
      rig.chest - 0.165,
      rig.chest - 0.11,
    );
    patch(-1, third, rig.chest - 0.155, rig.chest - 0.12);
  }

  /** Yoke over the shoulders, front and back. */
  const yoke: Field = (s, i) => Y(s, i) - (rig.chest - 0.075);
  /** Knee to ankle: a band down the outside of each leg. */
  const legBand = (color: string): void =>
    on(
      'leg',
      [(s, i) => (Math.sign(Xs(s, i)) * s.a.nor[i * 3] - 0.9) * 0.05],
      color,
    );

  switch (motif) {
    case 'plain':
      all([yoke], second);
      legBand(second);
      break;
    case 'stripes': {
      // Twin stripes from the collar over the shoulder and down the outside of the arm to the cuff, and down the legs.
      for (const [a, b] of [
        [-0.031, -0.007],
        [0.007, 0.031],
      ]) {
        on('arm', [...between(acU, a, b), outer, neg(elbow)], second);
        on('arm', [...between(acF, a, b), outer, elbow], second);
        on(
          'torso',
          [
            ...between(acU, a, b),
            (s, i) => X(s, i) - 0.095,
            (s, i) => (s.a.nor[i * 3 + 1] - 0.25) * 0.05,
          ],
          second,
        );
        on(
          'leg',
          [
            ...between(Z, a, b),
            (s, i) => (Math.sign(Xs(s, i)) * s.a.nor[i * 3] - 0.4) * 0.05,
          ],
          second,
        );
      }
      break;
    }
    case 'slant': {
      // Leaning bands that thin out, like speed stripes: a sash of them up the chest to one shoulder, and round the
      // upper arms.
      const a = 0.66;
      const d: Field = (s, i) =>
        (Y(s, i) - 1.19) * Math.cos(a) - Xs(s, i) * Math.sin(a);
      const sash: [number, number, string][] = [
        [0.05, 0.11, second],
        [0.008, 0.038, third],
        [-0.022, -0.004, second],
        [-0.043, -0.031, third],
        [-0.058, -0.051, second],
      ];
      // The thinnest of them on the close-up mesh only.
      for (const [lo, up, c] of sash.slice(0, hi ? 5 : 3))
        on('torso', between(d, lo, up), c);
      const ring: Field = (s, i) => along(s, i) + 0.6 * acU(s, i);
      const rings: [number, number, string][] = [
        [0.06, 0.12, second],
        [0.133, 0.163, third],
        [0.175, 0.193, second],
        [0.203, 0.213, third],
      ];
      for (const [lo, up, c] of rings.slice(0, hi ? 4 : 3))
        on('arm', between(ring, lo, up), c);
      break;
    }
    case 'split': {
      // Two blocks of colour on a leaning line with a line of the third between them: one shoulder and its sleeve, and
      // the lower legs the other way.
      const f: Field = (s, i) => Y(s, i) - 1.24 + 0.75 * Xs(s, i);
      all(between(f, -0.015, 0.015), third);
      all([f], second);
      const g: Field = (s, i) => 0.44 - Y(s, i) - 0.6 * Xs(s, i);
      on('leg', between(g, -0.012, 0.012), third);
      on('leg', [g], second);
      break;
    }
    case 'peaks': {
      // A mountain range: the second colour from the legs up to a ridge across the chest, the third as the higher range
      // behind it; the same at the cuffs.
      on('leg', [() => 1], second);
      on('torso', [(s, i) => 1.13 - Y(s, i)], second);
      for (const [x, y] of [
        [-0.165, 1.245],
        [-0.05, 1.21],
        [0.065, 1.265],
        [0.175, 1.225],
      ])
        on('torso', peakOf(Xs, Y, x, y, 1.35), second);
      for (const [x, y] of [
        [-0.105, 1.3],
        [0.01, 1.275],
        [0.125, 1.315],
      ])
        on('torso', peakOf(Xs, Y, x, y, 1.35), third);
      on('arm', [(s, i) => 0.17 - upArm(s, i)], second);
      on('arm', peakOf(acF, upArm, 0, 0.245, 1.5), second);
      on('arm', peakOf(acF, upArm, 0.03, 0.275, 1.8), third);
      on('arm', peakOf(acF, upArm, -0.035, 0.24, 1.8), third);
      break;
    }
    case 'swoosh': {
      // A swoosh of three lines: a crescent from one hip up to the other shoulder with two thinner ones under it, and
      // one down each upper arm.
      const p: [number, number] = [-0.18, 1.12];
      const q: [number, number] = [0.2, 1.41];
      on('torso', lune(Xs, Y, p, q, 0.075, 0.03), second);
      if (hi) {
        on('torso', lune(Xs, Y, p, q, 0.094, 0.084), third);
        on('torso', lune(Xs, Y, p, q, 0.112, 0.105), second);
      }
      const a: [number, number] = [-0.04, 0.02];
      const b: [number, number] = [0.04, 0.215];
      on('arm', lune(acU, along, a, b, 0.034, 0.008), second);
      if (hi) on('arm', lune(acU, along, a, b, 0.05, 0.042), third);
      legBand(second);
      break;
    }
    case 'checker': {
      // A band of checkers across the chest and round the upper arms, under a yoke of the second colour.
      all([yoke], second);
      const w = 0.04;
      if (hi)
        for (const [lo, up] of [
          [1.222, 1.229],
          [1.321, 1.328],
        ])
          on('torso', between(Y, lo, up), third);
      for (let r = 0; r < 2; r++)
        for (let k = -5; k < 5; k++)
          if ((k + r) & 1)
            on(
              'torso',
              [
                ...between(Y, 1.235 + r * w, 1.235 + (r + 1) * w),
                ...between(Xs, k * w, (k + 1) * w),
              ],
              second,
            );
      const h = 0.034;
      if (hi)
        for (const [lo, up] of [
          [0.088, 0.094],
          [0.174, 0.18],
        ])
          on('arm', between(along, lo, up), third);
      for (let r = 0; r < 2; r++)
        for (let k = -2; k < 2; k++)
          if ((k + r) & 1)
            on(
              'arm',
              [
                ...between(along, 0.1 + r * h, 0.1 + (r + 1) * h),
                ...between(acU, k * 0.03, (k + 1) * 0.03),
              ],
              second,
            );
      legBand(second);
      break;
    }
  }
  // The flap over the zip, where the suit is still its own colour: a graphic runs over it.
  out = splitIn(
    out,
    {
      torso: [
        (s, i) => 0.011 - X(s, i),
        front,
        (s, i) => rig.chest + 0.04 - Y(s, i),
      ],
    },
    { color: shade(main, 0.8), raise: 0.002, fixed: true },
  );
  return { pieces: out, cover: suit.cover };
}

/** How a figure sits in a seat: where the hips are, how far the back leans, its size. */
interface Sit {
  hip: Vector3;
  lean: number;
  scale: number;
}

interface Posed {
  sit: Sit;
  pose: BodyPose;
  /** Grips of the hands (left, right) with their wrist and forearm, in the figure's frame. */
  hands: { grip: Grip; wrist: Vector3; fore: Vector3 }[];
  /** The pace notes: centre, up the page, out of the page. */
  book?: [Vector3, Vector3, Vector3];
}

/** Sits the figure in its seat and finds the pose that brings its hands to the wheel / the notes. */
function sitIn(cp: Cockpit, codriver: boolean): Posed {
  const rig = bodyRig(MODEL);
  const side = (cp.rhd ? -1 : 1) * (codriver ? -1 : 1);
  const [z0, y0, z1, y1] = cp.seat.back;
  const recline = Math.atan2(z0 - z1, y1 - y0);
  const backZ = (y: number): number => z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
  const lu = rig.elbow.distanceTo(rig.shoulder);
  const lf = rig.wrist.distanceTo(rig.elbow) + HAND;
  const lt = rig.kneeJ.distanceTo(rig.hipJ);
  const ls = rig.ankleJ.distanceTo(rig.kneeJ);
  const leanM = (lean: number): Matrix4 => new Matrix4().makeRotationX(-lean);
  const headM = (lean: number): Matrix4 =>
    new Matrix4().makeRotationX(lean * 0.9 + (codriver ? 0.38 : 0.04));

  // Size and height: the helmet has to clear the roof (measured with the head up, the driver's, for both).
  const topOf = (lean: number): number => {
    const m = leanM(lean);
    const neck = rig.neck.clone().applyMatrix4(m);
    const up = rig.head
      .clone()
      .sub(rig.neck)
      .applyMatrix4(
        m.clone().multiply(new Matrix4().makeRotationX(lean * 0.9 + 0.04)),
      );
    return neck.y + up.y + HELMET_TOP;
  };
  // Under a low roof: first the cushion gives, then the figure gets smaller, then it sits lower still.
  const slouch = Math.min(0.46, Math.max(recline, 0.3));
  // Both of the crew are one size: what fits the driver sat up.
  const top = topOf(slouch - SIT_UP);
  const ceil = cp.roof - HEADROOM;
  let scale = SCALE;
  let hipY = cp.seat.cushion + HIP_UP * scale;
  if (hipY + scale * top > ceil) {
    hipY = Math.max(cp.seat.cushion + HIP_LOW * scale, ceil - scale * top);
    scale = Math.min(SCALE, Math.max(MIN_SCALE, (ceil - hipY) / top));
    hipY = Math.min(hipY, ceil - scale * top);
  }
  const place = (lean: number, slide: number): Sit => {
    // Back against the backrest: the seat of the pants or the shoulder blades, whichever meets it first.
    const m = leanM(lean);
    let z = -Infinity;
    for (const [by, bz] of BACK) {
      const b = v(0, by, bz).applyMatrix4(m).multiplyScalar(scale);
      z = Math.max(z, backZ(Math.max(y0, hipY + b.y)) - b.z);
    }
    return { hip: v(side * cp.seat.x, hipY, z + slide), lean, scale };
  };

  // The wheel in the car, and the hands' grips on it: a little above quarter to three.
  const tilt = (cp.wheel.tilt * Math.PI) / 180;
  const axis = v(0, Math.sin(tilt), -Math.cos(tilt));
  const upW = v(0, Math.cos(tilt), Math.sin(tilt));
  const gripsOf = (sit: Sit): Grip[] => {
    const toBody = (p: Vector3): Vector3 =>
      p.clone().sub(sit.hip).divideScalar(sit.scale);
    if (!codriver) {
      const a = 0.2;
      return [1, -1].map((sd) => {
        const out = v(sd, 0, 0)
          .multiplyScalar(Math.cos(a))
          .addScaledVector(upW, Math.sin(a));
        return {
          at: toBody(v(...cp.wheel.at).addScaledVector(out, cp.wheel.r)),
          bar: v(sd, 0, 0)
            .multiplyScalar(-Math.sin(a))
            .addScaledVector(upW, Math.cos(a)),
          outer: out,
          far: axis.clone().negate(),
          r: RIM / sit.scale,
        };
      });
    }
    // The notes: held over the lap by both edges, tilted to the reader.
    const [at, up, nor] = bookOf();
    return [1, -1].map((sd) => ({
      at: at.clone().addScaledVector(v(sd, 0, 0), 0.071),
      bar: up,
      outer: v(sd, 0, 0),
      far: nor.clone().negate(),
      r: 0.005,
    }));
  };
  const bookOf = (): [Vector3, Vector3, Vector3] => {
    const a = 0.75;
    // Below and ahead of the shoulders, within easy reach, clear of the thighs.
    const sh = v(0, rig.shoulder.y, rig.shoulder.z).applyMatrix4(leanM(lean));
    return [
      v(0, Math.max(sh.y - 0.25, LAP), sh.z + 0.39),
      v(0, Math.sin(a), Math.cos(a)),
      v(0, Math.cos(a), -Math.sin(a)),
    ];
  };

  const arms = (sit: Sit, grips: Grip[]) =>
    [1, -1].map((sd, i) => {
      const sh = v(
        rig.shoulder.x * sd,
        rig.shoulder.y,
        rig.shoulder.z,
      ).applyMatrix4(leanM(sit.lean));
      const to = knuckles(grips[i]);
      return {
        sh,
        to,
        far: to.distanceTo(sh) / (lu + lf),
        pole: v(sd * (codriver ? 0.8 : 0.55), -1, codriver ? -0.5 : -0.2),
      };
    });

  // Sit back in the seat, a little slouched like in a bucket seat. A wheel out of comfortable reach: sit up some,
  // then move forward (the seat on its rails), and stretch the arms only for what is left.
  let lean = slouch;
  let slide = 0;
  let sit = place(lean, slide);
  if (!codriver) {
    const far = (): number =>
      Math.max(...arms(sit, gripsOf(sit)).map((a) => a.far));
    for (let k = 0; k < 200 && far() > REACH; k++) {
      if (lean > slouch - SIT_UP) lean -= 0.01;
      else if (slide < SLIDE) slide += 0.005;
      else if (far() > 0.96) slide += 0.005;
      else break;
      sit = place(lean, slide);
    }
  }
  // Legs: feet in the footwell, the driver's on the pedals.
  const leg = [1, -1].map((sd) => {
    const hip = v(rig.hipJ.x * sd, rig.hipJ.y, rig.hipJ.z);
    const dy = (cp.floor + 0.1 - sit.hip.y) / sit.scale;
    const dx = sd * 0.03;
    const len = (lt + ls) * (codriver ? 0.86 : 0.92);
    const dz = Math.sqrt(Math.max(0.04, len * len - dy * dy - dx * dx));
    const r = reach(
      hip,
      hip.clone().add(v(dx, dy, dz)),
      lt,
      ls,
      v(sd * 0.2, 1, 0),
    );
    return { up: r.up, low: r.low, foot: -0.45 };
  });

  const grips = gripsOf(sit);
  const a = arms(sit, grips);
  // The forearm of the body runs beside the line of its joints: aim the joints so that the wrist itself meets the hand.
  const off = [v(0, 0, 0), v(0, 0, 0)];
  let arm = a.map((x) => reach(x.sh, x.to, lu, lf, x.pole));
  const wrists = [v(0, 0, 0), v(0, 0, 0)];
  const poseOf = (): BodyPose => ({
    lean: leanM(sit.lean),
    head: headM(sit.lean),
    headScale: 1,
    broad: 1,
    arm: [
      { up: arm[0].up, low: arm[0].low },
      { up: arm[1].up, low: arm[1].low },
    ],
    leg: [leg[0], leg[1]],
  });
  for (let k = 0; k < 4; k++) {
    arm = a.map((x, i) =>
      reach(x.sh, x.to.clone().sub(off[i]), lu, lf, x.pole),
    );
    const bones = poseBones(MODEL, poseOf()).bones;
    [1, -1].forEach((sd, i) => {
      wrists[i]
        .set(
          (rig.wrist.x + WRIST_OFF[0]) * sd,
          rig.wrist.y + WRIST_OFF[1],
          rig.wrist.z + WRIST_OFF[2],
        )
        .applyMatrix4(bones[BONE.foreL + i]);
      const joint = arm[i].end.clone().addScaledVector(arm[i].low, -HAND);
      off[i].copy(wrists[i]).sub(joint);
    });
  }

  return {
    sit,
    pose: poseOf(),
    hands: arm.map((r, i) => ({
      grip: grips[i],
      wrist: wrists[i],
      fore: r.low,
    })),
    book: codriver ? bookOf() : undefined,
  };
}

/** Where the lap straps head for from the buckle: this far below the hip joints, and this far back (m). */
const LAP_DROP = 0.06;
const LAP_BACK = 0.12;

/** How far down the chest the legs of the head restraint's yoke reach (m below the shoulder). */
const YOKE = 0.15;

/**
 * How far a mesh reaches from a point inside it in a direction (m): the last of its faces on that ray (closer than
 * `cap`), among the faces within `near` of the origin of its frame. 0 when the ray meets none.
 */
function reachOf(
  g: BufferGeometry,
  near: number,
): (from: Vector3, dir: Vector3, cap?: number) => number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const tris: Vector3[] = [];
  for (let k = 0; k < count; k += 3) {
    const abc = [0, 1, 2].map((j) =>
      new Vector3().fromBufferAttribute(pos, idx ? idx.getX(k + j) : k + j),
    );
    if (abc.some((p) => p.length() < near)) tris.push(...abc);
  }
  const ray = new Ray();
  const hit = new Vector3();
  return (from, dir, cap = Infinity) => {
    ray.set(from, dir);
    let far = 0;
    for (let k = 0; k < tris.length; k += 3)
      if (
        ray.intersectTriangle(tris[k], tris[k + 1], tris[k + 2], false, hit)
      ) {
        const d = hit.distanceTo(from);
        if (d < cap) far = Math.max(far, d);
      }
    return far;
  };
}

/**
 * A line round a body pulled tight: the distances `far` from a point along the flat directions `dirs`, each raised
 * to the straight line between its neighbours where the body is hollow.
 */
function taut(far: number[], dirs: number[][]): number[] {
  const at = dirs.map(([x, y], i) => [far[i] * x, far[i] * y]);
  return far.map((r, i) => {
    const [dx, dy] = dirs[i];
    let best = r;
    for (let j = 0; j < i; j++)
      for (let k = i + 1; k < far.length; k++) {
        const [ex, ey] = [at[k][0] - at[j][0], at[k][1] - at[j][1]];
        const den = dx * ey - dy * ex;
        if (den > 1e-6)
          best = Math.max(best, (at[j][0] * ey - at[j][1] * ex) / den);
      }
    return best;
  });
}

/** The six-point harness and the head restraint under it, on the posed body. */
function restraint(
  t: Tailor,
  bones: Matrix4[],
  headAt: Matrix4,
  suit: BufferGeometry,
  webbing: string,
  hi: boolean,
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const rig = bodyRig(t.m);
  const sf = surface(t);
  const OFF = 0.027;
  /** Rest-frame points to where the body next to them went. */
  const skinned = (pts: Vector3[], nor: Vector3[]): [Vector3[], Vector3[]] => {
    const n = pts.length;
    const rest = new Float32Array(n * 3);
    const rn = new Float32Array(n * 3);
    const w = new Float32Array(n * BONES);
    pts.forEach((p, i) => {
      rest.set([p.x, p.y, p.z], i * 3);
      rn.set([nor[i].x, nor[i].y, nor[i].z], i * 3);
      w.set(sf.weights(p), i * BONES);
    });
    const pos = new Float32Array(n * 3);
    const no = new Float32Array(n * 3);
    skinPoints(n, rest, rn, w, bones, pos, no);
    return [
      pts.map((_, i) => v(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])),
      pts.map((_, i) => v(no[i * 3], no[i * 3 + 1], no[i * 3 + 2]).normalize()),
    ];
  };
  /** Normals of a path over the body: square to it, turned from `up` at its start to the front at its end. */
  const over = (
    pts: Vector3[],
    from: Vector3,
    to: Vector3,
    turn: number,
  ): Vector3[] =>
    pts.map((_p, i) => {
      const d = pts[Math.min(pts.length - 1, i + 1)]
        .clone()
        .sub(pts[Math.max(0, i - 1)])
        .normalize();
      const ref = i < turn ? from : to;
      return ref.clone().addScaledVector(d, -ref.dot(d)).normalize();
    });
  const spine = bones[BONE.spine];
  const X0 = 0.08;
  const buckleY = 0.13;
  const buckle = v(0, buckleY, sf.z(0, buckleY) + OFF + 0.004);

  const [[guess], [lockN]] = skinned([buckle], [v(0, 0.15, 1).normalize()]);
  // The plane of the lap straps: across the hips, and from the buckle steeply down and back to where they are
  // bolted behind the seat.
  const lapTo = v(0, guess.y + LAP_DROP, LAP_BACK).normalize();
  const lapFrom = guess.clone().addScaledVector(lapTo, -0.12);
  const lapAcross = v(0, lapTo.z, -lapTo.y);
  const reach = reachOf(suit, 0.32);
  // The buckle sits on the webbing where the lap straps meet in the middle of the belly.
  const lock = lapFrom
    .clone()
    .addScaledVector(lapTo, reach(lapFrom, lapTo) + 0.007);

  for (const sd of [1, -1]) {
    const tp = sf.top(X0);
    // Shoulder strap: from the seat over the yoke, down the chest to the buckle.
    {
      const pts = [
        v(sd * X0, tp.y - 0.02, tp.z - 0.17),
        v(sd * X0, tp.y + OFF + 0.011, tp.z - 0.085),
        v(sd * X0, tp.y + OFF + 0.014, tp.z - 0.03),
        v(sd * X0, tp.y + OFF + 0.009, tp.z + 0.032),
      ];
      const y0 = tp.y - 0.05;
      const y1 = buckleY + 0.035;
      const steps = hi ? 9 : 6;
      // Over the yoke to just past its end, and only then down on to the suit.
      const off = tp.y - YOKE - 0.012;
      const ys = [off, off - 0.035];
      for (let k = 0; k <= steps; k++) {
        const y = y0 + ((y1 - y0) * k) / steps;
        if (ys.every((o) => Math.abs(o - y) > 0.012)) ys.push(y);
      }
      ys.sort((a, b) => b - a);
      for (const y of ys) {
        const f = (y - y0) / (y1 - y0);
        const x = X0 + (0.036 - X0) * f * f * (3 - 2 * f);
        const onYoke = y > off - 0.001 ? 0.011 : 0;
        pts.push(v(sd * x, y, sf.z(x, y) + OFF + onYoke));
      }
      // Pulled tight: straight over a hollow of the chest, not down into it.
      for (let i = 5; i < pts.length - 1; i++)
        for (let j = 4; j < i; j++)
          for (let k = i + 1; k < pts.length; k++) {
            const f = (pts[i].y - pts[j].y) / (pts[k].y - pts[j].y);
            pts[i].z = Math.max(pts[i].z, pts[j].z + (pts[k].z - pts[j].z) * f);
          }
      const nor = over(pts, v(0, 1, 0), v(0, 0.15, 1).normalize(), 4);
      const [p, n] = skinned(pts, nor);
      // Its tongue goes into the buckle.
      p.push(
        lock
          .clone()
          .addScaledVector(lockN, -0.004)
          .add(v(sd * 0.02, 0.012, 0)),
      );
      n.push(lockN.clone());
      out.push(strap(p, n, 0.068, 0.004, webbing, RIB, hi));
      // Head restraint: a leg of its yoke over each collarbone. It lies under the strap all the way, so the two
      // stay apart however the chest is posed, and its end tucks in.
      {
        const last = 3 + ys.filter((y) => y > off - 0.001).length;
        const under = (i: number): number =>
          i === 1 ? 0.019 : i === last ? 0.018 : 0.012;
        out.push(
          strap(
            p
              .slice(1, last + 1)
              .map((q, i) =>
                q.clone().addScaledVector(n[i + 1], -under(i + 1)),
              ),
            n.slice(1, last + 1),
            0.056,
            0.01,
            CARBON,
            HAT,
          ),
        );
      }
      // The adjuster on the chest.
      const at = y0 + (y1 - y0) * 0.45;
      const k =
        4 +
        ys.reduce(
          (best, y, i) =>
            Math.abs(y - at) < Math.abs(ys[best] - at) ? i : best,
          0,
        );
      const d = p[k + 1]
        .clone()
        .sub(p[k - 1])
        .normalize();
      const sideways = d.clone().cross(n[k]).normalize();
      const up = sideways.clone().cross(d).normalize();
      out.push(
        slab(
          p[k].clone().addScaledVector(up, 0.006),
          sideways.multiplyScalar(0.037),
          d.multiplyScalar(0.016),
          up.multiplyScalar(0.003),
          '#aeb1b7',
          REFLECT,
        ),
      );
    }
    // Lap strap: from the buckle round the hip and down to the seat, in one plane. Every point of it is as far out
    // as the suit reaches that way, across its whole width, so it lies on the seated body.
    {
      const HALF = 0.034;
      const step = hi ? 6 : 11;
      const dirs: Vector3[] = [];
      for (let a = 4; a <= 130; a += step) {
        const rad = (a * Math.PI) / 180;
        dirs.push(
          lapTo
            .clone()
            .multiplyScalar(Math.cos(rad))
            .add(v(sd * Math.sin(rad), 0, 0)),
        );
      }
      const far = taut(
        dirs.map((d) =>
          Math.max(
            ...[-HALF, 0, HALF].map((e) =>
              reach(lapFrom.clone().addScaledVector(lapAcross, e), d),
            ),
          ),
        ),
        dirs.map((d) => [d.dot(lapTo), Math.abs(d.x)]),
      );
      // Webbing does not follow every fold of the suit: over the highest of its neighbours, then evened out.
      const up = far.map((r, i) =>
        Math.max(
          r,
          far[Math.max(0, i - 1)],
          far[Math.min(far.length - 1, i + 1)],
        ),
      );
      const even = up.map(
        (r, i) =>
          (up[Math.max(0, i - 1)] +
            2 * r +
            up[Math.min(up.length - 1, i + 1)]) /
          4,
      );
      const pts = dirs.map((d, i) =>
        lapFrom.clone().addScaledVector(d, Math.max(even[i], far[i]) + 0.003),
      );
      out.push(strap(pts, dirs, 2 * HALF, 0.004, webbing, RIB, hi));
    }
  }
  // Sub straps: a pair from under the buckle, down over the belly and in between the thighs to the seat.
  for (const sd of [1, -1]) {
    const fwd = v(0, 0, 1);
    const pts = [
      lock
        .clone()
        .addScaledVector(lockN, -0.005)
        .add(v(sd * 0.016, 0, 0)),
    ];
    for (let k = 1; k <= 10; k++) {
      const y = lock.y - 0.012 * k;
      const x = sd * (0.022 + 0.08 * (lock.y - y));
      // Only the front of the body here: no further than the belly reaches (not along the thigh).
      const r = reach(v(x, y, t.torsoZ), fwd, 0.22);
      const prev = pts[pts.length - 1];
      if (!r || t.torsoZ + r > prev.z + 0.02) break;
      pts.push(v(x, y, Math.max(t.torsoZ + r + 0.003, prev.z - 0.025)));
    }
    // In between the thighs.
    const end = pts[pts.length - 1];
    pts.push(end.clone().add(v(0, -0.03, -0.03)));
    if (pts.length > 2)
      out.push(
        strap(
          pts,
          pts.map(() => fwd),
          0.046,
          0.004,
          webbing,
          RIB,
          hi,
        ),
      );
  }
  out.push(...camLock(lock, lockN, v(0, 1, 0)));

  // The collar of the head restraint, standing behind the helmet, and its tethers to the helmet.
  {
    const tp = sf.top(X0);
    const base = tp.y + OFF - 0.012;
    // It stands close behind the helmet wherever the head is: the helmet's middle in the frame of the chest.
    const hc = v(0, -0.05, 0)
      .applyMatrix4(headAt)
      .applyMatrix4(spine.clone().invert());
    const span = 1.05;
    const seg = hi ? 14 : 8;
    const mix = (p: number, q: number, k: number): number => p + (q - p) * k;
    const at = (a: number, h: number, inner: number): Vector3 => {
      const f = Math.pow(
        Math.max(0, Math.cos((a / span) * (Math.PI / 2))),
        0.8,
      );
      // Out to clear the helmet in its first third, then straight up behind it.
      const k = Math.min(1, h / 0.35);
      const out = k * k * (3 - 2 * k) * Math.min(1, f * 1.6);
      const top = base + 0.03 + Math.max(0, hc.y + 0.01 - base - 0.03) * f;
      const r = mix(0.094, HELMET_BACK + 0.02, out) - inner;
      const w = mix(0.086, 0.125, out) - inner;
      return v(
        w * Math.sin(a),
        mix(base, top, h),
        mix(rig.neck.z - 0.01, hc.z, out) - r * Math.cos(a),
      ).applyMatrix4(spine);
    };
    const pos: number[] = [];
    const idx: number[] = [];
    const rows = hi ? 5 : 3;
    // Outer face, top edge, inner face: one strip folded over the top.
    const prof: [number, number][] = [];
    for (let j = 0; j <= rows; j++) prof.push([j / rows, 0]);
    for (let j = rows; j >= 0; j--) prof.push([j / rows, 0.012]);
    prof.forEach(([h, inner]) => {
      for (let i = 0; i <= seg; i++) {
        const p = at(-span + (2 * span * i) / seg, h, inner);
        pos.push(p.x, p.y, p.z);
      }
    });
    for (let j = 0; j < prof.length - 1; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        idx.push(a, b, c, b, c + 1, c);
      }
    out.push(sheet(pos, idx, CARBON, HAT));
    for (const sd of [1, -1]) {
      const from = at(sd * 0.6, 0.85, -0.002);
      const to = v(HELMET_POST[0] * sd, HELMET_POST[1], HELMET_POST[2])
        .multiplyScalar(1.03)
        .applyMatrix4(headAt);
      const n = v(sd, 0, -0.4).normalize();
      out.push(
        strap(
          [from, from.clone().lerp(to, 0.5), to],
          [n, n, n],
          0.02,
          0.002,
          '#101114',
        ),
      );
    }
  }
  return out;
}

/** A painted part from points and triangles (smooth normals), on a cell of the atlas. */
function sheet(
  pos: number[],
  idx: number[],
  color: string,
  cell: number,
): BufferGeometry {
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.length; i += 3)
    pts.push(v(pos[i], pos[i + 1], pos[i + 2]));
  const nor = pts.map(() => v(0, 0, 0));
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [pts[idx[k]], pts[idx[k + 1]], pts[idx[k + 2]]];
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    for (const i of [idx[k], idx[k + 1], idx[k + 2]]) nor[i].add(n);
  }
  const col = new Color(color);
  const P = new Float32Array(idx.length * 3);
  const N = new Float32Array(idx.length * 3);
  const C = new Float32Array(idx.length * 3);
  idx.forEach((i, k) => {
    P.set([pts[i].x, pts[i].y, pts[i].z], k * 3);
    const n = nor[i].clone().normalize();
    N.set([n.x, n.y, n.z], k * 3);
    C.set([col.r, col.g, col.b], k * 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3));
  g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('color', new BufferAttribute(C, 3));
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array(idx.length * 2), 2),
  );
  return tag(g, cell);
}

/** The crew of a car as parts with the look of their material: `codriver` picks the seat. */
export function buildCrew(
  codriver: boolean,
  lod: number,
  params: CrewParams,
): CrewPart[] {
  const hi = lod === 0;
  const lv = params.livery;
  const sat = sitIn(params.cockpit, codriver);
  const bp = poseBones(MODEL, sat.pose);
  const t = tailor(MODEL, lod);
  const abs = RIGS[MODEL];
  const rig = bodyRig(MODEL);
  const warp = (s: Surf, out: Float32Array): void =>
    widen(s.a.pos, s.a.arm, s.n, abs, 1, out);

  // The suit. Of the body itself only the neck shows, between the helmet and the collar, in a balaclava.
  const suit = raceSuit(t, lv, hi);
  const height = (i: number): number => t.body.s.a.pos[i * 3 + 1] + abs.hip;
  const neck = clipAll(t.body.s, [
    field(t.body.s, (i) => 0.03 - suit.cover[i]),
    field(t.body.s, (i) => height(i) - (abs.neck[0] - 0.1)),
    field(t.body.s, (i) => abs.head[1] - 0.085 - height(i)),
  ]);
  const sock = posed(neck, bp.bones, warp, []);
  const count = sock.getAttribute('position').count;
  const sockColor = new Color(BALACLAVA).toArray();
  sock.setAttribute(
    'color',
    new BufferAttribute(
      Float32Array.from({ length: count * 3 }, (_, i) => sockColor[i % 3]),
      3,
    ),
  );
  sock.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  const cloth = (list: Surf[]): BufferGeometry => {
    const g = posed(join(list), bp.bones, warp, ['uv', 'color']);
    g.userData.cell = -1;
    return g;
  };
  const worn = cloth(suit.pieces.map(painted));
  const parts: BufferGeometry[] = [
    worn,
    cloth(shoesOf(MODEL, 'sneaker', '#17181b', '#2b2c30', hi)),
    tag(sock, HAT),
  ];

  // Helmet on the head.
  const headAt = bp.bones[BONE.head]
    .clone()
    .multiply(
      new Matrix4().makeTranslation(rig.head.x, rig.head.y, rig.head.z),
    );
  const hel = helmet(lv, hi);
  hel.shell.applyMatrix4(headAt);
  const trim = hel.trim.toNonIndexed();
  hel.trim.dispose();
  trim.applyMatrix4(headAt);
  parts.push(tag(trim, HAT));

  for (const h of sat.hands)
    parts.push(...gripGlove(h.grip, h.wrist, h.fore, GLOVE_COLOR, hi));
  if (sat.book) parts.push(...notes(...sat.book));
  parts.push(...restraint(t, bp.bones, headAt, worn, webbingOn(lv), hi));

  const atlas = merge(
    parts.map((p) => {
      const m = p.userData.cell === -1 ? p : mapCell(p, p.userData.cell ?? HAT);
      if (!m.index)
        m.setIndex(
          Array.from({ length: m.getAttribute('position').count }, (_, i) => i),
        );
      return m;
    }),
  );

  // Into the car: the figure's frame has its origin at the hips.
  const { hip, scale } = sat.sit;
  const place = new Matrix4()
    .makeTranslation(hip.x, hip.y, hip.z)
    .multiply(new Matrix4().makeScale(scale, scale, scale));
  for (const g of [atlas, hel.shell]) {
    g.applyMatrix4(place);
    g.computeBoundingSphere();
  }
  return [
    { geometry: atlas, look: 'atlas' },
    { geometry: hel.shell, look: 'crew_gloss' },
  ];
}

/** How the crew sits in a cockpit (tests, tuning): hips, lean of the back (rad), size. */
export function crewSit(
  cockpit: Cockpit,
  codriver: boolean,
): { hip: Vector3; lean: number; scale: number; recline: number } {
  const [z0, y0, z1, y1] = cockpit.seat.back;
  return {
    ...sitIn(cockpit, codriver).sit,
    recline: Math.atan2(z0 - z1, y1 - y0),
  };
}

/** A cockpit to show the crew in on its own (asset viewer): a modern rally car's. */
const DEMO: Cockpit = {
  seat: { x: 0.33, cushion: 0.32, back: [-0.42, 0.55, -0.56, 1.0] },
  wheel: { at: [0.315, 0.848, 0.14], r: 0.161, tilt: 16.8 },
  roof: 1.38,
  floor: 0.25,
};

const MOTIFS: CrewMotif[] = [
  'plain',
  'stripes',
  'slant',
  'split',
  'peaks',
  'swoosh',
  'checker',
];

/** A livery to show the crew in on its own: the colours of a service-park team, each motif in turn. */
function demoLivery(k: number): CrewLivery {
  const team = TEAMS[k % TEAMS.length];
  const motif = MOTIFS[k % MOTIFS.length];
  return motif === 'plain'
    ? plainCrew(team.base)
    : { main: team.base, second: team.accent, third: team.accent2, motif };
}

/**
 * Catalog builder. Variant % 2 = the seat (driver, co-driver); `params` (`CrewParams`) names the car, without them it
 * is a demo cockpit and the livery of team variant / 2 (every motif in turn). The parts carry the look of their
 * material (`CrewLook`) in place of one: assets/people-pool.ts `materialOf` turns it into the material.
 */
export const crewSeated: AssetBuilder = ({ variant, lod, params }) => {
  const p = (params as CrewParams | undefined) ?? {
    cockpit: DEMO,
    livery: demoLivery(Math.floor(variant / 2)),
  };
  return {
    parts: buildCrew(variant % 2 === 1, lod, p).map((part) => ({
      geometry: part.geometry,
      material: part.look as unknown as Material,
    })),
  };
};
