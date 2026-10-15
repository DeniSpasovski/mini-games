import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import {
  BAG,
  cellUV,
  GLOVE,
  HAIR,
  HAT,
  HEAD,
  HEAD_RINGS,
  HIVIS,
  JACKET,
  JEANS,
  KNIT,
  REFLECT,
  SKIN,
  SLEEVE,
  TROUSERS,
  ball,
  hand,
  limb as bodyLimb,
  loft,
  shoe,
  slab,
  type Ring,
} from './people-parts';
import type { AssetBuilder } from '../types';
import { TEAMS } from './teams';

/**
 * People kit: a jointed low-poly figure (feet, shins, thighs, pelvis, tapered torso, shoulders, arms, hands, neck,
 * head with hair / cap / helmet) posed by joint angles and dressed by an outfit (colour regions), one draw call per
 * figure. Static: the poses are the animation. Front faces +Z, the origin is on the ground between the feet (a figure is
 * lifted so its lowest point sits there, whatever the pose). ~300 triangles at LOD 0, ~110 at LOD 1, ~30 at LOD 2.
 */

const UP = new Vector3(0, 1, 0);

/** Segment lengths (m). */
const THIGH = 0.44;
const SHIN = 0.43;
const TORSO = 0.56;
const UPPER = 0.29;
const FORE = 0.27;
const HEAD_R = 0.124;

/** Arm / leg pose: swing (rad, + = forward) and spread (+ = outward) of the upper part, bend of the lower part. */
interface Limb {
  /** Upper arm / thigh swing forward from hanging straight down. */
  p: number;
  /** Spread away from the body. */
  ab: number;
  /** Elbow / knee bend: the lower part swings forward (arm) / back (leg) by this much more. */
  bend: number;
  /** Spread of the forearm when it differs from the upper arm (negative = across the body). */
  ab2?: number;
}

type Prop =
  | 'tyre'
  | 'laptop'
  | 'camera'
  | 'phone'
  | 'helmet'
  | 'bottle'
  | 'lens'
  | 'video'
  | 'tripod'
  | 'flag'
  | 'smallFlag'
  | 'flagMk'
  | 'flagUs'
  | 'sign'
  | 'radio';

interface Pose {
  /** Torso pitch forward / roll sideways, head pitch / turn (rad). */
  lean?: number;
  sway?: number;
  head?: number;
  turn?: number;
  legL: Limb;
  legR: Limb;
  armL: Limb;
  armR: Limb;
  prop?: Prop;
  /** Lie on the back (a creeper under a car), feet towards +Z. */
  lie?: boolean;
}

const limb = (p: number, ab = 0.1, bend = 0.1, ab2?: number): Limb => ({
  p,
  ab,
  bend,
  ab2,
});

const POSES = {
  stand: {
    legL: limb(0, 0.05, 0),
    legR: limb(0, 0.05, 0),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(-0.05, 0.12, 0.15),
  },
  stand2: {
    legL: limb(0.12, 0.08, 0.1),
    legR: limb(-0.1, 0.1, 0.05),
    armL: limb(0.1, 0.18, 0.3),
    armR: limb(-0.1, 0.1, 0.1),
    sway: 0.03,
  },
  pockets: {
    legL: limb(0, 0.06, 0),
    legR: limb(0.08, 0.06, 0.05),
    armL: limb(0.12, 0.2, 0.7, -0.15),
    armR: limb(0.12, 0.2, 0.7, -0.15),
    head: -0.05,
  },
  crossed: {
    legL: limb(0, 0.07, 0),
    legR: limb(0.1, 0.07, 0.05),
    armL: limb(0.45, 0.05, 1.35, -1.25),
    armR: limb(0.45, 0.05, 1.35, -1.25),
  },
  wave: {
    legL: limb(0, 0.06, 0),
    legR: limb(0, 0.06, 0),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.2, 2.5, 0.5, 2.7),
    sway: -0.05,
    prop: 'smallFlag',
  },
  // A fan waving a national hand flag (North Macedonia / USA).
  waveMk: {
    legL: limb(0, 0.06, 0),
    legR: limb(0, 0.06, 0),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.2, 2.5, 0.5, 2.7),
    sway: -0.05,
    prop: 'flagMk',
  },
  waveUs: {
    legL: limb(0, 0.06, 0),
    legR: limb(0, 0.06, 0),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.2, 2.5, 0.5, 2.7),
    sway: -0.05,
    prop: 'flagUs',
  },
  camera: {
    legL: limb(0.1, 0.07, 0.05),
    legR: limb(-0.05, 0.07, 0),
    armL: limb(1.0, 0.1, 1.3, -0.1),
    armR: limb(1.0, 0.1, 1.3, -0.1),
    head: 0.05,
    prop: 'camera',
  },
  phone: {
    legL: limb(0, 0.06, 0),
    legR: limb(0.1, 0.06, 0.1),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.7, 0.1, 1.25, -0.1),
    head: 0.35,
    prop: 'phone',
  },
  point: {
    legL: limb(0.1, 0.1, 0.05),
    legR: limb(-0.1, 0.1, 0.05),
    armL: limb(0.05, 0.12, 0.2),
    armR: limb(1.45, 0.2, 0.1),
    turn: 0.25,
  },
  helmet: {
    legL: limb(0, 0.06, 0),
    legR: limb(0.1, 0.06, 0.05),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.05, 0.22, 0.2),
    prop: 'helmet',
  },
  laptop: {
    legL: limb(0, 0.08, 0),
    legR: limb(0.12, 0.08, 0.1),
    armL: limb(0.55, 0.05, 1.0, -0.25),
    armR: limb(0.65, 0.12, 1.1, -0.2),
    head: 0.3,
    prop: 'laptop',
  },
  sit: {
    lean: 0.12,
    legL: limb(1.5, 0.08, 1.45),
    legR: limb(1.45, 0.14, 1.4),
    armL: limb(0.3, 0.1, 1.0, -0.1),
    armR: limb(0.35, 0.1, 1.1, -0.1),
    head: 0.1,
  },
  crouch: {
    lean: 0.5,
    head: -0.25,
    legL: limb(1.35, 0.15, 1.5),
    legR: limb(1.25, 0.2, 1.4),
    armL: limb(1.1, 0.1, 0.45, 0.05),
    armR: limb(1.2, 0.15, 0.35, 0.05),
  },
  bend: {
    lean: 1.15,
    head: -0.6,
    legL: limb(0.2, 0.1, 0.25),
    legR: limb(0.3, 0.1, 0.35),
    armL: limb(1.5, 0.12, 0.15),
    armR: limb(1.35, 0.15, 0.3),
  },
  kneel: {
    lean: 0.35,
    head: -0.3,
    legL: limb(0.05, 0.1, 1.55),
    legR: limb(1.3, 0.15, 1.2),
    armL: limb(0.8, 0.1, 0.9, -0.1),
    armR: limb(1.05, 0.12, 0.6, -0.1),
  },
  carry: {
    lean: -0.08,
    legL: limb(0.28, 0.06, 0.25),
    legR: limb(-0.22, 0.06, 0.2),
    armL: limb(0.7, 0.05, 1.0, -0.05),
    armR: limb(0.7, 0.05, 1.0, -0.05),
    prop: 'tyre',
  },
  lie: {
    lie: true,
    legL: limb(0.2, 0.15, 0.1),
    legR: limb(0.4, 0.25, 0.9),
    armL: limb(0.9, 0.1, 1.2, -0.1),
    armR: limb(1.2, 0.15, 0.6, 0.05),
  },
  walk: {
    legL: limb(0.38, 0.05, 0.1),
    legR: limb(-0.32, 0.05, 0.4),
    armL: limb(-0.35, 0.1, 0.25),
    armR: limb(0.35, 0.1, 0.35),
  },
  // Photographers: raised camera with a long lens, low / kneeling shots, a shoulder video camera, a tripod.
  shoot: {
    legL: limb(0.15, 0.2, 0.1),
    legR: limb(-0.2, 0.15, 0.1),
    armL: limb(1.35, 0.12, 1.1, -0.1),
    armR: limb(1.3, 0.1, 1.35, -0.1),
    head: 0.02,
    prop: 'lens',
  },
  shootLow: {
    lean: 0.35,
    head: -0.2,
    legL: limb(1.3, 0.25, 1.45),
    legR: limb(1.2, 0.3, 1.35),
    armL: limb(1.35, 0.12, 1.1, -0.1),
    armR: limb(1.3, 0.1, 1.35, -0.1),
    prop: 'lens',
  },
  shootKneel: {
    lean: 0.2,
    head: -0.1,
    legL: limb(0.05, 0.1, 1.55),
    legR: limb(1.3, 0.15, 1.25),
    armL: limb(1.3, 0.12, 1.1, -0.1),
    armR: limb(1.25, 0.1, 1.35, -0.1),
    prop: 'lens',
  },
  film: {
    legL: limb(0.1, 0.18, 0.05),
    legR: limb(-0.12, 0.14, 0.05),
    armL: limb(0.9, 0.1, 1.0, -0.15),
    armR: limb(0.5, 0.25, 1.6, -0.3),
    head: 0.05,
    prop: 'video',
  },
  tripod: {
    legL: limb(0.05, 0.12, 0.05),
    legR: limb(0, 0.12, 0),
    armL: limb(0.8, 0.12, 0.6, -0.1),
    armR: limb(0.8, 0.12, 0.6, -0.1),
    prop: 'tripod',
  },
  lower: {
    legL: limb(0.12, 0.1, 0.05),
    legR: limb(-0.12, 0.1, 0.1),
    armL: limb(0.7, 0.12, 1.2, -0.1),
    armR: limb(0.75, 0.1, 1.25, -0.1),
    head: 0.3,
    prop: 'lens',
  },
  // Marshals: yellow flag, green sign on a pole, radio, arms crossed.
  flag: {
    legL: limb(0.05, 0.14, 0),
    legR: limb(-0.05, 0.14, 0.05),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.25, 1.9, 0.3, 1.9),
    prop: 'flag',
  },
  sign: {
    legL: limb(0, 0.08, 0),
    legR: limb(0.08, 0.08, 0.05),
    armL: limb(0.45, 0.06, 0.7, -0.05),
    armR: limb(0.45, 0.06, 0.7, -0.05),
    prop: 'sign',
  },
  radio: {
    legL: limb(0, 0.08, 0),
    legR: limb(0.1, 0.08, 0.05),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.8, 0.1, 1.9, -0.1),
    head: 0.1,
    prop: 'radio',
  },
  // On the ground: legs stretched out leaning back, knees up with arms round them, a squat.
  sitGround: {
    lean: -0.18,
    head: 0.15,
    legL: limb(1.52, 0.18, 0.02),
    legR: limb(1.5, 0.32, 0.03),
    armL: limb(-0.7, 0.35, 0.1),
    armR: limb(-0.6, 0.45, 0.1),
  },
  sitKnees: {
    lean: 0.05,
    legL: limb(2.6, 0.12, 2.35),
    legR: limb(2.65, 0.2, 2.4),
    armL: limb(0.9, 0.05, 1.4, -0.35),
    armR: limb(0.9, 0.05, 1.4, -0.35),
    head: 0.1,
  },
  squat: {
    lean: 0.25,
    head: -0.2,
    legL: limb(1.9, 0.15, 2.4),
    legR: limb(1.95, 0.2, 2.4),
    armL: limb(0.95, 0.12, 0.8, -0.05),
    armR: limb(0.9, 0.12, 0.85, -0.05),
  },
  drink: {
    legL: limb(0, 0.06, 0),
    legR: limb(0.1, 0.06, 0.05),
    armL: limb(0.05, 0.12, 0.15),
    armR: limb(0.6, 0.1, 1.5, -0.05),
    head: -0.1,
    prop: 'bottle',
  },
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

type HatKind = 'none' | 'cap' | 'beanie' | 'helmet' | 'hood';
type HairKind = 'short' | 'long' | 'bald' | 'bun' | 'pony';

interface Outfit {
  shoes: string;
  legs: string;
  torso: string;
  /** Sleeve colour (default the torso). */
  sleeves?: string;
  /** Short sleeves / shorts show skin. */
  shortSleeves?: boolean;
  shorts?: boolean;
  skin: string;
  hair: string;
  hairKind: HairKind;
  hat: HatKind;
  hatColor: string;
  /** Colour band across the chest (and down the legs of a race suit). */
  stripe?: string;
  /** Collar / neck gaiter. */
  collar?: string;
  /** Hi-vis tabard over the torso. */
  vest?: string;
  /** Skirt / dress hem colour and length below the waist (m). */
  skirt?: string;
  skirtLen?: number;
  /** Sunglasses / glasses, a beard (hair colour). */
  glasses?: boolean;
  beard?: boolean;
  /** Head size factor (children ~1.25). */
  headScale?: number;
  /** Reflective bands round the vest. */
  bands?: boolean;
  /** Backpack. */
  pack?: string;
  /** Gloves (default skin). */
  gloves?: string;
  /** Overall size (1 = 1.76 m). */
  scale: number;
  /** Shoulder / hip width factor. */
  broad: number;
}

const SKIN_TONES = [
  '#f4d8bc',
  '#ecc9a6',
  '#d9ae88',
  '#bf8a60',
  '#a07050',
  '#80583c',
];
const HAIR_COLORS = [
  '#1c1814',
  '#2e2218',
  '#4a3220',
  '#6b4a2a',
  '#8a6a3a',
  '#b0a090',
];

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Direction hanging down, swung forward by `pitch` and spread outward by `ab` (mirrored with `side`). */
function dirDown(pitch: number, ab: number, side: number): Vector3 {
  const x = 0;
  const y = -Math.cos(pitch);
  const z = Math.sin(pitch);
  const phi = ab * side;
  return v(
    x * Math.cos(phi) - y * Math.sin(phi),
    x * Math.sin(phi) + y * Math.cos(phi),
    z,
  );
}

/**
 * Maps a part onto its atlas cell: per triangle the projection along the dominant axis of its normal, scaled by the
 * part's longest side so the weave keeps its proportions (a tube is not stretched).
 */
function mapCell(g: BufferGeometry, cell: number): BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const size = Math.max(
    b.max.x - b.min.x,
    b.max.y - b.min.y,
    b.max.z - b.min.z,
    1e-3,
  );
  const uv = g.getAttribute('uv');
  for (let t = 0; t < p.count; t += 3) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      nx += Math.abs(n.getX(t + k));
      ny += Math.abs(n.getY(t + k));
      nz += Math.abs(n.getZ(t + k));
    }
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const x = (p.getX(i) - b.min.x) / size;
      const y = (p.getY(i) - b.min.y) / size;
      const z = (p.getZ(i) - b.min.z) / size;
      const [u, w] =
        nz >= nx && nz >= ny ? [x, 1 - y] : nx >= ny ? [z, 1 - y] : [x, z];
      const [cu, cv] = cellUV(cell, u, w);
      uv.setXY(i, cu, cv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Marks the atlas cell a part is mapped to when the figure is merged (-1 = already mapped). */
const tag = (g: BufferGeometry, cell: number): BufferGeometry => {
  g.userData.cell = cell;
  return g;
};

/** Open tapered tube from `a` (radius `ra`) to `b` (radius `rb`), `flat` squashes it front to back. */
function tube(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  color: string,
  sides = 5,
  flat = 1,
  cell = KNIT,
): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(ra, rb, Math.max(len, 1e-3), sides, 1, true);
  if (flat !== 1) g.scale(1, 1, flat);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(UP, a.clone().sub(b).normalize()),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tag(paint(g, color), cell);
}

/** A box at `at`, optionally turned so its Y axis follows `axis`, or by a matrix. */
function block(
  w: number,
  h: number,
  d: number,
  at: Vector3,
  color: string,
  m?: Matrix4,
  cell = HAT,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (m) g.applyMatrix4(m);
  g.translate(at.x, at.y, at.z);
  return tag(paint(g, color), cell);
}

function along(axis: Vector3): Matrix4 {
  return new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromUnitVectors(UP, axis.clone().normalize()),
  );
}

interface FigureOpts {
  pose: Pose;
  outfit: Outfit;
  lod: number;
  rng: Rng;
}

function figure({ pose, outfit: o, lod, rng }: FigureOpts): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hi = lod === 0;
  const sides = hi ? 5 : 4;
  const broad = o.broad;
  const R = new Matrix4().makeRotationFromEuler(
    new Euler(pose.lean ?? 0, 0, pose.sway ?? 0, 'ZXY'),
  );
  const rot = (x: number, y: number, z: number): Vector3 =>
    v(x, y, z).applyMatrix4(R);
  const P = v(0, 0, 0);

  const legCell = JEAN_COLORS.includes(o.legs) ? JEANS : TROUSERS;
  // Legs: hips, knees, ankles, boots.
  for (const [side, leg] of [
    [1, pose.legL],
    [-1, pose.legR],
  ] as const) {
    const H = v(side * 0.095 * broad, 0, 0);
    const K = H.clone().add(dirDown(leg.p, leg.ab, side).multiplyScalar(THIGH));
    const A = K.clone().add(
      dirDown(leg.p - leg.bend, leg.ab * 0.5, side).multiplyScalar(SHIN),
    );
    const thighColor = o.shorts ? o.skin : o.legs;
    const lc = o.shorts ? SKIN : legCell;
    parts.push(tube(H, K, 0.1, 0.07, thighColor, sides, 1, lc));
    parts.push(
      tube(K, A, 0.07, 0.05, o.shorts ? o.skin : o.legs, sides, 1, lc),
    );
    if (hi) parts.push(block(0.1, 0.1, 0.1, K, thighColor, undefined, lc));
    if (hi && o.stripe && !o.shorts)
      parts.push(
        tube(
          H.clone().add(v(side * 0.075, 0, 0)),
          K.clone().add(v(side * 0.06, 0, 0)),
          0.012,
          0.012,
          o.stripe,
          3,
        ),
      );
    parts.push(
      block(
        0.11,
        0.09,
        hi ? 0.28 : 0.25,
        A.clone().add(v(0, -0.035, 0.07)),
        o.shoes,
        undefined,
        GLOVE,
      ),
    );
    if (hi)
      parts.push(
        block(
          0.115,
          0.022,
          0.29,
          A.clone().add(v(0, -0.08, 0.07)),
          '#d9d4c8',
          undefined,
          GLOVE,
        ),
      );
  }

  // Pelvis, torso, shoulders.
  const S = rot(0, TORSO, 0);
  parts.push(
    block(
      0.33 * broad,
      0.16,
      0.2,
      P,
      o.skirt ?? o.legs,
      undefined,
      o.skirt ? KNIT : legCell,
    ),
  );
  const waist = P.clone().add(rot(0, 0.06, 0));
  if (o.skirt) {
    const len = o.skirtLen ?? 0.45;
    parts.push(
      tube(
        waist.clone().add(rot(0, 0.02, 0)),
        waist.clone().add(rot(0, -len, 0)),
        0.17 * broad,
        0.17 * broad + len * 0.35,
        o.skirt,
        hi ? 7 : 5,
        0.85,
        KNIT,
      ),
    );
  }
  const chest = S.clone().add(rot(0, -0.04, 0));
  parts.push(
    tube(waist, chest, 0.17 * broad, 0.21 * broad, o.torso, hi ? 6 : 5, 0.62),
  );
  if (hi && !o.skirt && !o.shorts)
    parts.push(
      tube(
        waist.clone().add(rot(0, -0.005, 0)),
        waist.clone().add(rot(0, 0.04, 0)),
        0.172 * broad + 0.004,
        0.176 * broad + 0.004,
        '#1c1a18',
        6,
        0.62,
        GLOVE,
      ),
    );
  if (o.vest) {
    parts.push(
      tube(
        waist.clone().add(rot(0, 0.03, 0.0)),
        chest.clone().add(rot(0, -0.02, 0)),
        0.18 * broad,
        0.222 * broad,
        o.vest,
        hi ? 6 : 5,
        0.72,
        HIVIS,
      ),
    );
    if (hi && o.bands)
      for (const y of [0.2, 0.34])
        parts.push(
          tube(
            waist.clone().add(rot(0, y, 0)),
            waist.clone().add(rot(0, y + 0.04, 0)),
            (0.18 + y * 0.065) * broad + 0.004,
            (0.18 + (y + 0.04) * 0.065) * broad + 0.004,
            '#e6e8ea',
            6,
            0.72,
            HIVIS,
          ),
        );
  } else if (hi && o.stripe) {
    parts.push(
      tube(
        S.clone().add(rot(0, -0.2, 0)),
        S.clone().add(rot(0, -0.27, 0)),
        0.19 * broad,
        0.18 * broad,
        o.stripe,
        6,
        0.64,
      ),
    );
  }
  parts.push(
    block(
      0.44 * broad,
      0.1,
      0.2,
      S.clone().add(rot(0, -0.045, 0)),
      o.vest ?? o.torso,
      R,
      o.vest ? HIVIS : KNIT,
    ),
  );
  if (hi && o.pack)
    parts.push(
      block(0.28, 0.34, 0.12, S.clone().add(rot(0, -0.25, -0.17)), o.pack, R),
    );

  // Arms.
  const hands: Vector3[] = [];
  for (const [side, arm] of [
    [1, pose.armL],
    [-1, pose.armR],
  ] as const) {
    const J = S.clone().add(rot(side * 0.205 * broad, -0.04, 0));
    const E = J.clone().add(dirDown(arm.p, arm.ab, side).multiplyScalar(UPPER));
    const fd = dirDown(arm.p + arm.bend, arm.ab2 ?? arm.ab, side);
    const F = E.clone().add(fd.clone().multiplyScalar(FORE));
    const sleeve = o.sleeves ?? o.torso;
    const ac = o.shortSleeves ? SKIN : KNIT;
    if (hi) {
      const cap = new SphereGeometry(0.07, 6, 4);
      cap.translate(J.x, J.y, J.z);
      parts.push(
        tag(paint(cap, o.shortSleeves ? o.skin : (o.vest ?? sleeve)), ac),
      );
    }
    parts.push(
      tube(J, E, 0.062, 0.05, o.shortSleeves ? o.skin : sleeve, sides, 1, ac),
    );
    parts.push(
      tube(E, F, 0.05, 0.04, o.shortSleeves ? o.skin : sleeve, sides, 1, ac),
    );
    const hand = F.clone().add(fd.clone().multiplyScalar(0.05));
    hands.push(hand);
    parts.push(
      block(
        0.085,
        0.11,
        0.07,
        hand,
        o.gloves ?? o.skin,
        along(fd),
        o.gloves ? GLOVE : SKIN,
      ),
    );
  }

  // Neck + head.
  const neck = S.clone().add(rot(0, 0.07, 0));
  parts.push(
    tube(
      S.clone().add(rot(0, -0.02, 0)),
      neck,
      0.058,
      0.05,
      o.collar ?? o.skin,
      4,
      1,
      o.collar ? KNIT : SKIN,
    ),
  );
  const M = R.clone().multiply(
    new Matrix4().makeRotationFromEuler(
      new Euler(pose.head ?? 0, pose.turn ?? 0, 0, 'YXZ'),
    ),
  );
  const hs = o.headScale ?? 1;
  const head = headParts(o, hi, rng).map((g) =>
    g.applyMatrix4(M).scale(hs, hs, hs),
  );
  const Hc = S.clone().add(rot(0, 0.06 + HEAD_R * 0.95 * hs, 0.01));
  for (const g of head) {
    g.translate(Hc.x, Hc.y, Hc.z);
    parts.push(g);
  }

  // What is held.
  if (pose.prop) parts.push(...propParts(pose.prop, hands, S, R, Hc, hi));

  return finishBody(parts, pose, o);
}

/** Merges the parts, lies a figure down when posed so, stands it on the ground and scales it. */
function finishBody(
  parts: BufferGeometry[],
  pose: Pose,
  o: Outfit,
): BufferGeometry {
  const g = merge(
    parts.map((p) =>
      p.userData.cell === -1 ? p : mapCell(p, p.userData.cell ?? HAT),
    ),
  );
  const bodyScale = o.scale;
  if (pose.lie) {
    // On the back: face up, head towards -Z (feet at the origin side).
    g.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  }
  g.computeBoundingBox();
  const minY = g.boundingBox!.min.y;
  g.translate(0, -minY, 0);
  if (bodyScale !== 1) g.scale(bodyScale, bodyScale, bodyScale);
  g.computeBoundingSphere();
  return g;
}

/** Torso rings from the neck base down to the hem (pelvis at y = 0); `bust` fills the chest of a narrower figure. */
function torsoRings(
  broad: number,
  bust: number,
  hemY: number,
  flare: number,
): Ring[] {
  return [
    { y: 0.585, w: 0.055, d: 0.05 },
    { y: 0.565, w: 0.14 * broad, d: 0.075 },
    { y: 0.535, w: 0.21 * broad, d: 0.095 },
    { y: 0.47, w: 0.2 * broad, d: 0.11 * bust },
    { y: 0.38, w: 0.185 * broad, d: 0.112 * bust, z: 0.01 },
    { y: 0.27, w: 0.165 * broad, d: 0.1 },
    { y: 0.15, w: 0.17 * broad, d: 0.102 },
    { y: 0.04, w: 0.2 * broad, d: 0.114 },
    { y: hemY, w: 0.2 * broad * flare, d: 0.114 * flare },
  ];
}

/** Scales rings about the body axis (a garment over another) and keeps those from index `from` to `to`. */
function over(rings: Ring[], k: number, from = 0, to = rings.length): Ring[] {
  return rings
    .slice(from, to)
    .map((r) => ({ ...r, w: r.w * k, d: r.d * (k + 0.02) }));
}

/** The near figure (LOD 0): smooth lofted body, capsule limbs, shaped hands / shoes / head, garments mapped unwrapped. */
function figureDetail({ pose, outfit: o, rng }: FigureOpts): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const broad = o.broad;
  const bust = broad < 0.95 ? 1.1 : 1;
  const R = new Matrix4().makeRotationFromEuler(
    new Euler(pose.lean ?? 0, 0, pose.sway ?? 0, 'ZXY'),
  );
  const rot = (x: number, y: number, z: number): Vector3 =>
    v(x, y, z).applyMatrix4(R);
  const torsoParts: BufferGeometry[] = [];
  const denim = JEAN_COLORS.includes(o.legs);
  const legCell = o.shorts ? SKIN : denim ? JEANS : TROUSERS;
  const legColor = o.shorts ? o.skin : o.legs;
  const lightShoe = o.shoes === '#e6e6e6';

  // Legs: hip, knee, ankle, shoe.
  for (const [side, leg] of [
    [1, pose.legL],
    [-1, pose.legR],
  ] as const) {
    const H = v(side * 0.095 * broad, 0, 0);
    const K = H.clone().add(dirDown(leg.p, leg.ab, side).multiplyScalar(THIGH));
    const A = K.clone().add(
      dirDown(leg.p - leg.bend, leg.ab * 0.5, side).multiplyScalar(SHIN),
    );
    parts.push(bodyLimb(H, K, 0.098, 0.068, legColor, legCell, [0, 0.5]));
    parts.push(ball(K, 0.068, legColor, legCell, [0.46, 0.54]));
    parts.push(bodyLimb(K, A, 0.066, 0.046, legColor, legCell, [0.5, 1]));
    parts.push(
      ...shoe(
        A.clone().add(v(0, -0.04, 0)),
        o.shoes,
        lightShoe ? '#8e8a82' : '#d8d3c6',
        0.27,
      ),
    );
  }

  // Hips (in the trousers / skirt colour) and the belt.
  const hipColor = o.skirt ?? o.legs;
  parts.push(
    loft(
      [
        // Inside the torso garment, which always hangs over the hips.
        { y: 0.1, w: 0.15 * broad, d: 0.092 },
        { y: 0.0, w: 0.164 * broad, d: 0.1 },
        { y: -0.07, w: 0.158 * broad, d: 0.096 },
        { y: -0.13, w: 0.11 * broad, d: 0.088 },
      ],
      12,
      hipColor,
      o.skirt ? KNIT : legCell,
      { fv: [0, 0.2], capBottom: true },
    ),
  );
  const S = rot(0, TORSO, 0);
  const jacketTorso = !(o.shortSleeves || o.vest || o.skirt);
  const torsoCell = jacketTorso ? JACKET : KNIT;
  if (o.skirt) {
    const len = o.skirtLen ?? 0.45;
    parts.push(
      loft(
        [
          { y: 0.14, w: 0.17 * broad, d: 0.105 },
          { y: 0.0, w: 0.2 * broad, d: 0.128 },
          { y: -len * 0.5, w: 0.2 * broad + len * 0.14, d: 0.13 + len * 0.12 },
          { y: -len, w: 0.2 * broad + len * 0.3, d: 0.13 + len * 0.26 },
        ],
        14,
        o.skirt,
        TROUSERS,
      ),
    );
  }

  // Torso, vest, belt, collar, pack (built upright, then leant with the pose).
  const rings = torsoRings(
    broad,
    bust,
    // The hem hangs below the waist over the hips and thigh tops.
    jacketTorso ? -0.11 : -0.07,
    jacketTorso ? 1.12 : 1.08,
  );
  torsoParts.push(loft(rings, 12, o.torso, torsoCell, { capTop: true }));
  if (o.vest) {
    torsoParts.push(loft(over(rings, 1.07, 2, 8), 12, o.vest, HIVIS));
    if (o.bands)
      for (const y of [0.4, 0.28])
        torsoParts.push(
          loft(
            [
              { y, w: (0.186 - (0.4 - y) * 0.1) * broad * 1.085, d: 0.125 },
              {
                y: y - 0.045,
                w: (0.182 - (0.4 - y) * 0.1) * broad * 1.085,
                d: 0.125,
              },
            ],
            12,
            '#e6e8ea',
            REFLECT,
          ),
        );
  } else if (o.stripe) {
    torsoParts.push(
      loft(over(rings, 1.012, 3, 5), 12, o.stripe, KNIT, { fv: [0.4, 0.5] }),
    );
  }
  if (!jacketTorso && !o.skirt && !o.shorts && !o.vest)
    torsoParts.push(
      loft(
        [
          { y: 0.085, w: 0.178 * broad, d: 0.113 },
          { y: 0.045, w: 0.182 * broad, d: 0.115 },
        ],
        12,
        '#1c1a18',
        GLOVE,
      ),
    );
  if (jacketTorso || o.collar)
    torsoParts.push(
      loft(
        [
          { y: 0.64, w: 0.066, d: 0.062 },
          { y: 0.585, w: 0.078, d: 0.074 },
        ],
        10,
        o.collar ?? o.torso,
        o.collar ? KNIT : JACKET,
        { fv: [0, 0.07] },
      ),
    );
  if (o.pack)
    torsoParts.push(slab(0.3, 0.38, 0.13, v(0, 0.3, -0.17), o.pack, BAG));
  for (const g of torsoParts) parts.push(g.applyMatrix4(R));

  // Arms: shoulder, elbow, wrist, hand.
  const hands: Vector3[] = [];
  const sleeveColor = o.sleeves ?? o.torso;
  const armColor = o.shortSleeves ? o.skin : sleeveColor;
  const armCell = o.shortSleeves ? SKIN : SLEEVE;
  for (const [side, arm] of [
    [1, pose.armL],
    [-1, pose.armR],
  ] as const) {
    const J = S.clone().add(rot(side * 0.205 * broad, -0.04, 0));
    const E = J.clone().add(dirDown(arm.p, arm.ab, side).multiplyScalar(UPPER));
    const fd = dirDown(arm.p + arm.bend, arm.ab2 ?? arm.ab, side);
    const F = E.clone().add(fd.clone().multiplyScalar(FORE));
    parts.push(
      ball(
        J,
        0.068,
        o.vest && !o.shortSleeves ? sleeveColor : armColor,
        armCell,
        [0, 0.12],
      ),
    );
    parts.push(bodyLimb(J, E, 0.064, 0.05, armColor, armCell, [0, 0.5]));
    parts.push(ball(E, 0.05, armColor, armCell, [0.46, 0.54]));
    parts.push(bodyLimb(E, F, 0.049, 0.039, armColor, armCell, [0.5, 1]));
    parts.push(
      ...hand(F, fd, side, o.gloves ?? o.skin, o.gloves ? GLOVE : SKIN),
    );
    hands.push(F.clone().add(fd.clone().multiplyScalar(0.05)));
  }

  // Neck + head.
  const neck = S.clone().add(rot(0, 0.07, 0));
  parts.push(
    bodyLimb(
      S.clone().add(rot(0, -0.02, 0)),
      neck,
      0.056,
      0.05,
      o.skin,
      SKIN,
      [0, 1],
      8,
    ),
  );
  const M = R.clone().multiply(
    new Matrix4().makeRotationFromEuler(
      new Euler(pose.head ?? 0, pose.turn ?? 0, 0, 'YXZ'),
    ),
  );
  const hs = o.headScale ?? 1;
  const Hc = S.clone().add(rot(0, 0.06 + HEAD_R * 0.95 * hs, 0.01));
  for (const g of headParts(o, true, rng, true)) {
    g.applyMatrix4(M).scale(hs, hs, hs).translate(Hc.x, Hc.y, Hc.z);
    parts.push(g);
  }

  if (pose.prop) parts.push(...propParts(pose.prop, hands, S, R, Hc, true));
  return finishBody(parts, pose, o);
}

/** Maps a head sphere onto the two-cell head texture: u = angle round the head (0.5 = face), v = chin to crown. */
function headMap(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const [u, w] = cellUV(
      HEAD,
      0.5 + Math.atan2(p.getX(i), p.getZ(i)) / (Math.PI * 2),
      0.5 - p.getY(i) / 0.275,
      2,
    );
    uv.setXY(i, u, w);
  }
  return tag(g, -1);
}

function headParts(
  o: Outfit,
  hi: boolean,
  rng: Rng,
  detail = false,
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const seg = hi ? 6 : 4;
  if (detail) {
    out.push(loft(HEAD_RINGS, 12, o.skin, HEAD, { wCells: 2, capTop: true }));
    // Nose (bridge + tip) and ears.
    out.push(
      block(0.026, 0.05, 0.04, v(0, -0.005, 0.105), o.skin, undefined, SKIN),
      block(0.034, 0.02, 0.03, v(0, -0.03, 0.112), o.skin, undefined, SKIN),
    );
    for (const s of [-1, 1])
      out.push(
        block(
          0.014,
          0.052,
          0.036,
          v(s * 0.106, 0.0, -0.004),
          o.skin,
          undefined,
          SKIN,
        ),
      );
  } else {
    const head = new SphereGeometry(HEAD_R, seg, hi ? 4 : 3);
    head.scale(0.92, 1.1, 1);
    out.push(headMap(paint(head, o.skin)));
    if (hi)
      out.push(
        block(
          0.03,
          0.04,
          0.035,
          v(0, -0.01, HEAD_R + 0.005),
          o.skin,
          undefined,
          SKIN,
        ),
      );
  }
  const coverFrom = out.length;
  if (hi && o.glasses)
    out.push(block(0.17, 0.032, 0.02, v(0, 0.02, HEAD_R * 0.98), '#15171a'));
  if (hi && o.beard)
    out.push(
      block(
        0.13,
        0.07,
        0.05,
        v(0, -0.07, HEAD_R * 0.8),
        o.hair,
        undefined,
        HAIR,
      ),
    );
  const hatLow = o.hat === 'cap' || o.hat === 'beanie' || o.hat === 'helmet';
  if (o.hat === 'helmet') {
    const d = new SphereGeometry(
      HEAD_R * 1.12,
      seg,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.62,
    );
    d.scale(0.97, 1.05, 1.06);
    out.push(paint(d, o.hatColor));
  } else if (o.hat === 'cap') {
    const d = new SphereGeometry(
      HEAD_R * 1.07,
      seg,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5,
    );
    d.scale(0.97, 1, 1.02);
    out.push(paint(d, o.hatColor));
    out.push(
      block(0.19, 0.012, 0.09, v(0, HEAD_R * 0.15, HEAD_R * 1.1), o.hatColor),
    );
  } else if (o.hat === 'beanie') {
    const d = new SphereGeometry(
      HEAD_R * 1.1,
      seg,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    d.scale(0.97, 1.05, 1.03);
    out.push(paint(d, o.hatColor));
  } else if (o.hat === 'hood') {
    const d = new SphereGeometry(
      HEAD_R * 1.14,
      seg,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.8,
    );
    d.scale(0.98, 1.05, 1.0);
    d.translate(0, 0, -0.015);
    out.push(paint(d, o.hatColor));
  }
  if (!hatLow && o.hat !== 'hood' && o.hairKind !== 'bald') {
    const d = new SphereGeometry(
      HEAD_R * 1.07,
      seg,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    d.scale(0.96, 1.05, 1.03);
    d.rotateX(-0.45);
    out.push(tag(paint(d, o.hair), HAIR));
    if (o.hairKind === 'long')
      out.push(
        block(
          0.19,
          0.2,
          0.06,
          v(0, -0.05, -HEAD_R * 0.9),
          o.hair,
          undefined,
          HAIR,
        ),
      );
    else if (o.hairKind === 'pony')
      out.push(
        tube(
          v(0, 0.05, -HEAD_R),
          v(0, -0.2, -HEAD_R * 1.25),
          0.03,
          0.018,
          o.hair,
          4,
          1,
          HAIR,
        ),
      );
    else if (o.hairKind === 'bun')
      out.push(
        block(
          0.08,
          0.08,
          0.08,
          v(0, 0.1, -HEAD_R * 0.95),
          o.hair,
          undefined,
          HAIR,
        ),
      );
  } else if (hi && o.hat === 'cap' && o.hairKind === 'long') {
    out.push(
      block(
        0.12,
        0.14,
        0.05,
        v(0, -0.07, -HEAD_R * 0.85),
        o.hair,
        undefined,
        HAIR,
      ),
    );
  }
  void rng;
  // The ring head is narrower than the sphere one: hair and hats hug it.
  if (detail) for (const g of out.slice(coverFrom)) g.scale(1, 1.02, 0.99);
  return out;
}

function propParts(
  prop: Prop,
  hands: Vector3[],
  S: Vector3,
  R: Matrix4,
  Hc: Vector3,
  hi: boolean,
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const rot = (x: number, y: number, z: number): Vector3 =>
    v(x, y, z).applyMatrix4(R);
  const [hl, hr] = hands;
  if (prop === 'tyre') {
    const at = S.clone().add(rot(0, -0.33, 0.33));
    const t = new CylinderGeometry(0.33, 0.33, 0.21, hi ? 10 : 6);
    t.rotateX(Math.PI / 2);
    t.translate(at.x, at.y, at.z);
    out.push(paint(t, '#1c1c1e'));
    if (hi) {
      const r = new CylinderGeometry(0.2, 0.2, 0.225, 8);
      r.rotateX(Math.PI / 2);
      r.translate(at.x, at.y, at.z);
      out.push(paint(r, '#9aa0a8'));
    }
  } else if (prop === 'laptop') {
    const at = hl
      .clone()
      .add(hr)
      .multiplyScalar(0.5)
      .add(v(0, 0.06, 0.04));
    out.push(block(0.32, 0.02, 0.22, at, '#2b2d31'));
    out.push(
      block(
        0.32,
        0.21,
        0.015,
        at.clone().add(v(0, 0.1, -0.1)),
        '#14181c',
        new Matrix4().makeRotationX(-0.25),
      ),
    );
  } else if (prop === 'camera') {
    const at = Hc.clone().add(v(0, -0.01, 0.2));
    out.push(block(0.13, 0.09, 0.09, at, '#1a1a1c'));
    out.push(block(0.06, 0.06, 0.08, at.clone().add(v(0, 0, 0.08)), '#2a2a2e'));
  } else if (prop === 'phone') {
    out.push(
      block(0.065, 0.12, 0.012, hr.clone().add(v(0, 0.03, 0.05)), '#16181c'),
    );
  } else if (prop === 'helmet') {
    const at = hr.clone().add(v(0, -0.06, 0.02));
    const h = new SphereGeometry(0.13, hi ? 6 : 4, hi ? 4 : 3);
    h.translate(at.x, at.y, at.z);
    out.push(paint(h, '#e8e8ea'));
    if (hi)
      out.push(
        block(0.17, 0.06, 0.05, at.clone().add(v(0, 0.01, 0.1)), '#1c2630'),
      );
  } else if (prop === 'lens') {
    // Body at the face, long telephoto lens pointing forward, a hood on the end.
    const at = Hc.clone().add(rot(0, -0.02, 0.2));
    out.push(block(0.15, 0.1, 0.1, at, '#1a1a1c'));
    out.push(block(0.08, 0.08, 0.3, at.clone().add(rot(0, 0, 0.2)), '#26282c'));
    out.push(block(0.1, 0.1, 0.06, at.clone().add(rot(0, 0, 0.36)), '#111113'));
    if (hi)
      out.push(
        block(0.05, 0.03, 0.1, at.clone().add(rot(0, 0.07, 0)), '#2e3036'),
      );
  } else if (prop === 'video') {
    const at = S.clone().add(rot(-0.21, 0.1, 0.12));
    out.push(block(0.14, 0.17, 0.4, at, '#1d1f23'));
    out.push(
      block(0.1, 0.1, 0.1, at.clone().add(rot(0, 0.02, 0.24)), '#0e0f11'),
    );
    out.push(
      block(0.09, 0.05, 0.2, at.clone().add(rot(0, 0.12, -0.05)), '#2a2c31'),
    );
  } else if (prop === 'tripod') {
    const top = S.clone().add(rot(0, -0.08, 0.4));
    const foot = -0.93;
    for (const [dx, dz] of [
      [0.28, 0.2],
      [-0.28, 0.2],
      [0, -0.22],
    ])
      out.push(
        tube(top, v(top.x + dx, foot, top.z + dz), 0.015, 0.012, '#26282c', 3),
      );
    out.push(block(0.12, 0.16, 0.36, top.clone().add(v(0, 0.1, 0)), '#1d1f23'));
    out.push(
      block(0.1, 0.1, 0.1, top.clone().add(v(0, 0.12, 0.22)), '#0e0f11'),
    );
  } else if (prop === 'flag') {
    const at = hr.clone();
    out.push(
      tube(
        at.clone().add(v(0, -0.15, 0)),
        at.clone().add(v(0, 0.45, 0)),
        0.012,
        0.012,
        '#6b5a40',
        3,
      ),
    );
    out.push(
      block(0.34, 0.26, 0.01, at.clone().add(v(0.17, 0.34, 0)), '#f2d21c'),
    );
  } else if (prop === 'smallFlag') {
    // A fan's hand flag: short pole held upright, cloth streaming to the side.
    out.push(
      tube(
        hr.clone().add(v(0, -0.06, 0)),
        hr.clone().add(v(0, 0.3, 0)),
        0.008,
        0.008,
        '#6b5a40',
        3,
      ),
    );
    out.push(
      block(0.2, 0.13, 0.008, hr.clone().add(v(0.1, 0.23, 0)), '#d8322a'),
    );
  } else if (prop === 'flagMk' || prop === 'flagUs') {
    out.push(
      tube(
        hr.clone().add(v(0, -0.06, 0)),
        hr.clone().add(v(0, 0.31, 0)),
        0.008,
        0.008,
        '#6b5a40',
        3,
      ),
    );
    const c = hr.clone().add(v(0.15, 0.22, 0));
    const zRot = (a: number) => new Matrix4().makeRotationZ(a);
    if (prop === 'flagMk') {
      // North Macedonia: red field, a yellow sun with eight rays.
      out.push(block(0.3, 0.15, 0.008, c, '#d20000'));
      out.push(block(0.055, 0.055, 0.011, c, '#f8e100', zRot(Math.PI / 4)));
      if (hi)
        for (const [len, a] of [
          [0.3, 0],
          [0.14, Math.PI / 2],
          [0.18, Math.PI / 4],
          [0.18, -Math.PI / 4],
        ] as const)
          out.push(block(len, 0.008, 0.01, c, '#f8e100', zRot(a)));
    } else {
      // USA: seven stripes and the blue canton.
      const stripe = 0.15 / 7;
      const top = c.y + 0.075;
      for (let i = 0; i < (hi ? 7 : 2); i++)
        out.push(
          block(
            0.3,
            hi ? stripe : 0.075,
            0.008,
            v(
              c.x,
              hi ? top - stripe * (i + 0.5) : top - 0.0375 - i * 0.075,
              c.z,
            ),
            i % 2 === 0 ? '#bf1e2e' : '#f4f4f4',
          ),
        );
      out.push(
        block(0.12, 0.086, 0.011, v(c.x - 0.09, top - 0.043, c.z), '#1d3c8a'),
      );
    }
  } else if (prop === 'sign') {
    const at = hl
      .clone()
      .add(hr)
      .multiplyScalar(0.5)
      .add(v(0, 0, 0.1));
    out.push(
      tube(
        v(at.x, -0.9, at.z),
        v(at.x, at.y + 0.85, at.z),
        0.015,
        0.015,
        '#6b5a40',
        3,
      ),
    );
    const top = v(at.x, at.y + 0.85, at.z);
    out.push(
      block(0.4, 0.4, 0.015, top.clone().add(v(0, 0.06, 0.02)), '#1f8a4c'),
    );
    if (hi)
      out.push(
        block(0.28, 0.28, 0.018, top.clone().add(v(0, 0.06, 0.022)), '#e8f0ea'),
      );
    if (hi)
      out.push(
        block(0.2, 0.2, 0.02, top.clone().add(v(0, 0.06, 0.024)), '#1f8a4c'),
      );
  } else if (prop === 'radio') {
    out.push(
      block(0.05, 0.13, 0.04, hr.clone().add(v(0, 0.04, 0.03)), '#17191c'),
    );
  } else if (prop === 'bottle') {
    out.push(
      block(0.07, 0.2, 0.07, hr.clone().add(v(0, 0.05, 0.06)), '#3a6ea8'),
    );
  }
  return out;
}

/** LOD 2: a box for the legs, one for the body, a box head, keeping the outfit colours. */
function blob(o: Outfit): BufferGeometry {
  const parts = [
    block(0.3, 0.86, 0.2, v(0, 0.43, 0), o.legs),
    block(0.42, 0.6, 0.24, v(0, 1.17, 0), o.vest ?? o.torso),
    block(
      0.2,
      0.22,
      0.2,
      v(0, 1.58, 0),
      o.hat === 'none' ? o.skin : o.hatColor,
    ),
  ];
  const g = merge(parts.map((p) => mapCell(p, p.userData.cell ?? HAT)));
  g.scale(o.scale, o.scale, o.scale);
  return g;
}

/** LOD 1 of crowds (many instances): boxy legs, body, arms (one raised when waving) and head, ~70 triangles. */
function blocky(o: Outfit, pose: PoseName): BufferGeometry {
  const arm = o.sleeves ?? o.torso;
  const up = pose === 'wave' || pose === 'camera';
  const parts = [
    block(0.13, 0.86, 0.17, v(-0.09, 0.43, 0), o.legs),
    block(0.13, 0.86, 0.17, v(0.09, 0.43, 0), o.legs),
    block(0.42, 0.6, 0.25, v(0, 1.17, 0), o.vest ?? o.torso),
    block(0.1, 0.58, 0.12, v(0.28, 1.15, 0), arm),
    up
      ? block(0.1, 0.58, 0.12, v(-0.3, 1.62, 0.05), arm)
      : block(0.1, 0.58, 0.12, v(-0.28, 1.15, 0), arm),
    block(
      0.22,
      0.24,
      0.22,
      v(0, 1.6, 0),
      o.hat === 'none' ? o.skin : o.hatColor,
    ),
  ];
  const g = merge(parts.map((p) => mapCell(p, p.userData.cell ?? HAT)));
  g.scale(o.scale, o.scale, o.scale);
  return g;
}

function finishFigure(
  pose: PoseName,
  outfit: Outfit,
  lod: number,
  rng: Rng,
  /** Crowd figure: LOD 1 is the boxy body, not the jointed one. */
  crowd = false,
): {
  parts: {
    geometry: BufferGeometry;
    material: ReturnType<typeof getMaterial>;
  }[];
} {
  const g =
    lod >= 3
      ? blob(outfit)
      : lod === 2 && crowd
        ? blocky(outfit, pose)
        : lod === 0
          ? figureDetail({ pose: POSES[pose] as Pose, outfit, lod, rng })
          : figure({
              pose: POSES[pose] as Pose,
              outfit,
              lod: lod === 1 ? 0 : 1,
              rng,
            });
  return { parts: [{ geometry: g, material: getMaterial('people') }] };
}

const baseOutfit = (rng: Rng): Outfit => ({
  shoes: rng.pick(['#1b1b1d', '#2c2a28', '#e6e6e6', '#3a2a1c']),
  legs: '#2b2f3a',
  torso: '#555555',
  skin: rng.pick(SKIN_TONES),
  hair: rng.pick(HAIR_COLORS),
  hairKind: rng.chance(0.3) ? 'long' : rng.chance(0.12) ? 'bald' : 'short',
  hat: 'none',
  hatColor: '#333333',
  scale: rng.range(0.93, 1.06),
  broad: rng.range(0.92, 1.1),
});

// --- spectators --------------------------------------------------------------------------------

/** Mostly saturated: small bright spots make a stage look alive at speed. */
const JACKETS = [
  '#c0302a',
  '#2a5fc0',
  '#e0b020',
  '#2d8a3e',
  '#e6e6e6',
  '#333333',
  '#e06a1a',
  '#7a3ab0',
  '#d4e21c',
  '#e0306e',
  '#1aa6c8',
  '#f05a10',
];
const TROUSER_COLORS = [
  '#2b2f3a',
  '#3b3a36',
  '#25344f',
  '#4a4a4a',
  '#5a5040',
  '#1f2630',
];
const JEAN_COLORS = ['#34486b', '#2a3a58', '#3f5578'];

/** The six spectator outfits (variant % 6); the pose is variant / 6. */
const SPECTATOR_OUTFITS = 6;
const SPECTATOR_POSES: PoseName[] = ['stand', 'wave', 'camera', 'pockets'];

/** Variants from here on sit or squat at the roadside (outfit = variant % 6, pose = 3 seated ones). */
export const SPECTATOR_STANDING = 24;
/** Variants from here wave a hand flag: 6 outfits x (North Macedonia, USA). */
const SPECTATOR_FLAG_FROM = 42;
const FLAG_POSES: PoseName[] = ['waveMk', 'waveUs'];
const SPECTATOR_SEATED: PoseName[] = ['sitGround', 'sitKnees', 'squat'];

export const spectator: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  const jacket = JACKETS[(variant * 5 + rng.int(0, 11)) % JACKETS.length];
  const style = variant % SPECTATOR_OUTFITS;
  o.torso = jacket;
  o.legs = rng.pick(style === 1 ? JEAN_COLORS : TROUSER_COLORS);
  if (style === 0) o.sleeves = jacket;
  if (style === 1) {
    // T-shirt, shorts, cap.
    o.shortSleeves = true;
    o.shorts = rng.chance(0.6);
    o.hat = 'cap';
    o.hatColor = rng.pick(JACKETS);
  } else if (style === 2) {
    // Hoodie, hood up or a beanie.
    o.hat = rng.chance(0.5) ? 'hood' : 'beanie';
    o.hatColor = o.hat === 'hood' ? jacket : rng.pick(JACKETS);
    o.legs = rng.pick(JEAN_COLORS);
  } else if (style === 3) {
    // Hi-vis vest over a dark jacket (helpers, locals).
    o.torso = '#2e3138';
    o.vest = rng.pick(['#d4e21c', '#f05a10']);
    o.hat = rng.chance(0.4) ? 'cap' : 'none';
    o.hatColor = '#222222';
  } else if (style === 4) {
    // Backpack, jeans.
    o.pack = rng.pick(['#2a2f3a', '#7a2a2a', '#2a5a3a']);
    o.legs = rng.pick(JEAN_COLORS);
    o.hat = rng.chance(0.35) ? 'cap' : 'none';
    o.hatColor = rng.pick(JACKETS);
  } else if (style === 5) {
    // Supporter: team-coloured shirt and a scarf.
    const t = TEAMS[rng.int(0, TEAMS.length - 1)];
    o.torso = t.base;
    o.collar = t.accent;
    o.shortSleeves = rng.chance(0.4);
    o.legs = rng.pick(JEAN_COLORS);
  }
  const pose =
    variant >= SPECTATOR_FLAG_FROM
      ? FLAG_POSES[
          Math.floor((variant - SPECTATOR_FLAG_FROM) / SPECTATOR_OUTFITS) % 2
        ]
      : variant >= SPECTATOR_STANDING
        ? SPECTATOR_SEATED[
            Math.floor((variant - SPECTATOR_STANDING) / SPECTATOR_OUTFITS) % 3
          ]
        : SPECTATOR_POSES[Math.floor(variant / SPECTATOR_OUTFITS) % 4];
  return finishFigure(pose, o, lod, rng, true);
};

// --- service park crews --------------------------------------------------------------------------

/** Pose sets: the variant is `team + TEAMS.length * poseIndex`. */
const MECHANIC_POSES: PoseName[] = ['crouch', 'bend', 'kneel'];
const CREW_POSES: PoseName[] = ['carry', 'laptop', 'crossed'];

function teamOutfit(team: number, rng: Rng, overall: boolean): Outfit {
  const t = TEAMS[team % TEAMS.length];
  const o = baseOutfit(rng);
  o.torso = t.base;
  o.legs = overall ? t.base : '#23262c';
  o.stripe = t.accent2;
  o.collar = t.accent;
  o.shoes = '#1b1b1d';
  o.gloves = overall && rng.chance(0.6) ? '#26282c' : undefined;
  o.hat = rng.chance(0.55) ? 'cap' : 'none';
  o.hatColor = t.accent === '#f2f2f2' ? t.accent2 : t.accent;
  return o;
}

/** Mechanic in team overalls: crouching at a wheel, bent over the nose, kneeling. */
export const mechanic: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const team = variant % TEAMS.length;
  const pose = MECHANIC_POSES[Math.floor(variant / TEAMS.length) % 3];
  return finishFigure(pose, teamOutfit(team, rng, true), lod, rng);
};

/** Team crew: carrying a tyre, an engineer with a laptop, the manager with crossed arms (team shirt, dark trousers). */
export const crew: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const team = variant % TEAMS.length;
  const pose = CREW_POSES[Math.floor(variant / TEAMS.length) % 3];
  return finishFigure(pose, teamOutfit(team, rng, pose === 'carry'), lod, rng);
};

const DRIVER_POSES: PoseName[] = ['helmet', 'crossed'];

/** Driver / co-driver in a race suit (team colour, white collar, stripe), helmet in hand or arms crossed. */
export const driver: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const team = variant % TEAMS.length;
  const pose = DRIVER_POSES[Math.floor(variant / TEAMS.length) % 2];
  const o = teamOutfit(team, rng, true);
  o.collar = '#f2f2f2';
  o.hat = 'none';
  o.gloves = undefined;
  return finishFigure(pose, o, lod, rng);
};

/** Marshals and officials: orange / yellow / white tabards with reflective bands, caps, flags and signs. */
const MARSHAL_VESTS = [
  '#f05a10',
  '#f05a10',
  '#d4e21c',
  '#d4e21c',
  '#f2f2f2',
  '#2a6fd0',
];
/** Variants 0-11 (pose = variant % 4); 12+ cycle these. */
const MARSHAL_POSES: PoseName[] = ['stand2', 'point', 'pockets', 'phone'];
const MARSHAL_POSES_EXTRA: PoseName[] = ['flag', 'sign', 'radio', 'crossed'];
export const marshal: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  o.torso = '#2a2e36';
  o.sleeves = rng.pick(['#2a2e36', '#2c4a70', '#4a4a4a']);
  o.legs = '#23262c';
  o.vest = MARSHAL_VESTS[variant % MARSHAL_VESTS.length];
  o.bands = true;
  o.hat = rng.chance(0.6) ? 'cap' : 'none';
  o.hatColor = rng.pick(['#222222', '#d4e21c', '#f05a10', '#2a4a8a']);
  const pose =
    variant < 12
      ? MARSHAL_POSES[variant % 4]
      : MARSHAL_POSES_EXTRA[variant % 4];
  return finishFigure(pose, o, lod, rng);
};

/** Press photographers and camera operators: dark jackets, caps, a coloured press bib, long lenses, a tripod. */
const BIBS = ['#e0306e', '#f05a10', '#e0306e', '#d4e21c'];
const PHOTO_POSES: PoseName[] = [
  'shoot',
  'shootLow',
  'shootKneel',
  'film',
  'tripod',
  'lower',
];
export const photographer: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  o.torso = rng.pick(['#1e2024', '#3a3226', '#2a3a58', '#6b2a24']);
  o.legs = rng.pick(JEAN_COLORS.concat(['#23262c', '#3b3a36']));
  o.vest = BIBS[Math.floor(variant / PHOTO_POSES.length) % BIBS.length];
  o.hat = rng.chance(0.65) ? 'cap' : rng.chance(0.3) ? 'beanie' : 'none';
  o.hatColor = rng.pick(['#c0302a', '#2a4a8a', '#222222', '#e6e6e6']);
  o.shoes = rng.pick(['#1b1b1d', '#e6e6e6']);
  if (rng.chance(0.5)) o.pack = '#1c1e22';
  const pose = PHOTO_POSES[variant % PHOTO_POSES.length];
  return finishFigure(pose, o, lod, rng);
};

/**
 * A person visiting the park or a stage: variant % 4 = pose (walk, drink, phone, stand), variant / 4 = persona (man,
 * woman, child, older man, ...), so a crowd of visitors mixes ages, sizes, hair and clothes.
 */
export const VISITOR_PERSONAS = 12;
const WARM = ['#d9b84a', '#c0302a', '#2a8a6a', '#e08a2a'];
export const visitor: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  const persona = Math.floor(variant / 4) % VISITOR_PERSONAS;
  o.hat = 'none';
  o.torso = rng.pick(JACKETS);
  o.legs = rng.pick(JEAN_COLORS);
  o.hatColor = rng.pick(JACKETS);
  switch (persona) {
    case 0: // man in a hoodie, maybe a cap
      o.hat = rng.chance(0.5) ? 'cap' : 'none';
      o.hairKind = 'short';
      break;
    case 1: // woman, ponytail, jacket and jeans
      o.hairKind = 'pony';
      o.broad = 0.86;
      o.scale = rng.range(0.9, 0.96);
      o.shoes = rng.pick(['#e6e6e6', '#7a3a2a', '#1b1b1d']);
      break;
    case 2: // child
      o.scale = rng.range(0.58, 0.7);
      o.headScale = 1.3;
      o.broad = 0.88;
      o.hairKind = rng.chance(0.5) ? 'pony' : 'short';
      o.torso = rng.pick(WARM);
      o.shoes = rng.pick(['#e6e6e6', '#c0302a']);
      break;
    case 3: // older man, grey hair, jacket, maybe a beard
      o.hair = '#b8b4ac';
      o.hairKind = rng.chance(0.3) ? 'bald' : 'short';
      o.beard = rng.chance(0.4);
      o.torso = rng.pick(['#5a5040', '#3a4a5a', '#6a6a60']);
      o.legs = rng.pick(TROUSER_COLORS);
      o.scale = rng.range(0.94, 1);
      o.broad = 1.08;
      o.glasses = rng.chance(0.4);
      break;
    case 4: // woman in a dress
      o.skirt = rng.pick(WARM.concat(['#7a3ab0', '#2a5fc0']));
      o.torso = o.skirt;
      o.legs = o.skin;
      o.shoes = rng.pick(['#2c2a28', '#e6e6e6']);
      o.hairKind = 'long';
      o.broad = 0.84;
      o.scale = rng.range(0.9, 0.98);
      break;
    case 5: // older woman, bun, cardigan
      o.hair = '#c8c4bc';
      o.hairKind = 'bun';
      o.skirt = rng.pick(['#4a3a5a', '#3a4a4a', '#5a4a3a']);
      o.skirtLen = 0.5;
      o.legs = o.skin;
      o.torso = rng.pick(['#8a5a6a', '#5a7a6a', '#a89a6a']);
      o.broad = 0.9;
      o.scale = rng.range(0.88, 0.94);
      break;
    case 6: // teenager, hood or beanie, backpack
      o.hat = rng.chance(0.5) ? 'beanie' : 'none';
      o.pack = rng.pick(['#2a2f3a', '#7a2a2a']);
      o.scale = rng.range(0.82, 0.9);
      o.broad = 0.9;
      break;
    case 7: // tourist: shorts, T-shirt, cap, sunglasses, backpack
      o.shortSleeves = true;
      o.shorts = true;
      o.hat = 'cap';
      o.glasses = true;
      o.pack = rng.pick(['#2a5a3a', '#7a5a2a']);
      break;
    case 8: // woman, short hair, long coat look (skirt as coat)
      o.skirt = o.torso = rng.pick(['#3a3a40', '#8a4a3a', '#4a5a7a']);
      o.skirtLen = 0.6;
      o.hairKind = 'bun';
      o.broad = 0.88;
      break;
    case 9: // big man, beard, cap, dark jacket
      o.torso = '#23262c';
      o.beard = true;
      o.hat = 'cap';
      o.broad = 1.2;
      o.scale = rng.range(1, 1.06);
      break;
    case 10: // family kid, smaller still, hat
      o.scale = rng.range(0.5, 0.58);
      o.headScale = 1.35;
      o.hat = 'beanie';
      o.torso = rng.pick(WARM);
      o.broad = 0.85;
      break;
    default: // fan in a team scarf and shirt
      o.collar = rng.pick(['#c0302a', '#2a5fc0']);
      o.hat = rng.chance(0.4) ? 'cap' : 'none';
      break;
  }
  if (persona === 0 && variant % 3 === 0) o.vest = '#2a6fd0';
  const pose: PoseName = (['walk', 'drink', 'phone', 'stand2'] as const)[
    variant % 4
  ];
  return finishFigure(pose, o, lod, rng, true);
};
