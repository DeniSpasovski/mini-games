import {
  CylinderGeometry,
  BufferAttribute,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import {
  scanMaterial,
  scanMidMaterial,
  type ScanLook,
  type ScanModel,
} from '../../engine/people-scan-material';
import {
  GLOVE,
  HAIR,
  HAT,
  HEAD,
  HIVIS,
  JEANS,
  KNIT,
  REFLECT,
  SKIN,
  TROUSERS,
  along,
  block,
  cellUV,
  mapCell,
  tag,
  tube,
} from './people-parts';
import { packNormals, skinScan, type ScanPose } from './people-scan';
import { dress } from './people-wear';
import type { AssetBuilder } from '../types';
import { TEAMS } from './teams';

/**
 * People kit. Close up (LOD 0 / 1) a figure is one of two scanned people (people-scan.ts: CC BY models, credits in
 * THIRD-PARTY.md) posed by joint angles and dressed by an outfit: colours dyed into the scan's own texture, plus hats,
 * vests, skirts, packs and props built on the posed bones (people-wear.ts). Far away (LOD 2 / 3) it is the old
 * jointed low-poly figure, a boxy body, a silhouette. Static: the poses are the animation. Front faces +Z, the origin
 * is on the ground between the feet (a figure is lifted so its lowest point sits there, whatever the pose).
 */

/** Segment lengths (m). */
export const THIGH = 0.44;
export const SHIN = 0.43;
export const TORSO = 0.56;
export const UPPER = 0.29;
export const FORE = 0.27;
export const HEAD_R = 0.124;

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

export interface Pose {
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
/** `long` keeps the scan's own hair, `short` / `bald` crop it close to the head. */
type HairKind = 'short' | 'long' | 'bald';

export interface Outfit {
  /** Which scanned body (people-scan.ts). */
  model: ScanModel;
  /** Hand-flag cloth for the plain `wave` pose: [main, lower band] (never a national flag). */
  flag?: [string, string];
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
  /** A closed top (jacket, overalls) over the woman's cropped one: hides the bare midriff. */
  jacket?: boolean;
  /** Hi-vis tabard over the torso. */
  vest?: string;
  /** Skirt / dress hem colour and length below the waist (m). */
  skirt?: string;
  skirtLen?: number;
  /** Sunglasses / glasses. */
  glasses?: boolean;
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
  '#d9a581',
  '#cc9470',
  '#b97f5a',
  '#9a6542',
  '#865535',
  '#5f3b26',
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
export function dirDown(pitch: number, ab: number, side: number): Vector3 {
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

/** A thin flat polygon (points in x / y about `at`), `depth` thick: the printed pieces of a hand flag. */
function flatPoly(
  pts: [number, number][],
  at: Vector3,
  color: string,
  depth = 0.01,
): BufferGeometry {
  const g = new ExtrudeGeometry(
    new Shape(pts.map(([x, y]) => new Vector2(x, y))),
    {
      depth,
      bevelEnabled: false,
    },
  );
  g.translate(at.x, at.y, at.z - depth / 2);
  return tag(paint(g, color), REFLECT);
}

/**
 * Marks parts as a hand flag (pole + cloth) that the `people_flag` material waves about the hand `pivot`: `flagRel` =
 * vertex minus pivot, `flutter` = 0 for the pole (first part), 1 for the cloth (its pieces turn together).
 */
function markFlag(parts: BufferGeometry[], pivot: Vector3): void {
  for (const [k, g] of parts.entries()) {
    const p = g.getAttribute('position');
    const rel = new Float32Array(p.count * 3);
    const fl = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      rel[i * 3] = p.getX(i) - pivot.x;
      rel[i * 3 + 1] = p.getY(i) - pivot.y;
      rel[i * 3 + 2] = p.getZ(i) - pivot.z;
      fl[i] = k === 0 ? 0 : 1;
    }
    g.setAttribute('flagRel', new BufferAttribute(rel, 3));
    g.setAttribute('flutter', new BufferAttribute(fl, 1));
    g.userData.flag = true;
  }
}

interface FigureOpts {
  pose: Pose;
  outfit: Outfit;
  lod: number;
  rng: Rng;
}

/** The far figure (LOD 2 / 3 of a non-crowd person): jointed tubes and boxes. */
function figure({
  pose,
  outfit: o,
}: Pick<FigureOpts, 'pose' | 'outfit'>): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const sides = 4;
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
        5,
        0.85,
        KNIT,
      ),
    );
  }
  const chest = S.clone().add(rot(0, -0.04, 0));
  parts.push(tube(waist, chest, 0.17 * broad, 0.21 * broad, o.torso, 5, 0.62));
  if (o.vest) {
    parts.push(
      tube(
        waist.clone().add(rot(0, 0.03, 0.0)),
        chest.clone().add(rot(0, -0.02, 0)),
        0.18 * broad,
        0.222 * broad,
        o.vest,
        5,
        0.72,
        HIVIS,
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
  const head = headParts(o).map((g) => g.applyMatrix4(M).scale(hs, hs, hs));
  const Hc = S.clone().add(rot(0, 0.06 + HEAD_R * 0.95 * hs, 0.01));
  for (const g of head) {
    g.translate(Hc.x, Hc.y, Hc.z);
    parts.push(g);
  }

  // What is held.
  if (pose.prop)
    parts.push(...propParts(pose.prop, hands, S, R, Hc, false, false, o.flag));

  const built = finishBody(parts, pose, o);
  if (built.flag) built.atlas!.userData.flag = built.flag;
  return built.atlas!;
}

interface Built {
  /** Atlas-mapped parts (merged), the scanned body, the hand flag. */
  atlas?: BufferGeometry;
  scan?: BufferGeometry;
  flag?: BufferGeometry;
}

/**
 * Merges the parts, lies a figure down when posed so, stands it on the ground (the lowest point of the parts and the
 * scanned body) and scales it by `o.scale` (and `extra`).
 */
function finishBody(
  parts: BufferGeometry[],
  pose: Pose,
  o: Outfit,
  scan?: BufferGeometry,
  extra = 1,
): Built {
  const cloth = parts.filter((p) => p.userData.flag);
  const mapped = parts
    .filter((p) => !p.userData.flag)
    .map((p) => {
      const m = p.userData.cell === -1 ? p : mapCell(p, p.userData.cell ?? HAT);
      return m.index ? m.toNonIndexed() : m;
    });
  const atlas = mapped.length ? merge(mapped) : undefined;
  const geoms = [atlas, scan].filter((g): g is BufferGeometry => !!g);
  const k = o.scale * extra;
  if (pose.lie) {
    // On the back: face up, head towards -Z (feet at the origin side).
    for (const g of geoms)
      g.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  }
  let minY = Infinity;
  for (const g of geoms) {
    g.computeBoundingBox();
    minY = Math.min(minY, g.boundingBox!.min.y);
  }
  for (const g of geoms) {
    g.translate(0, -minY, 0);
    if (k !== 1) g.scale(k, k, k);
    g.computeBoundingSphere();
  }
  let flag: BufferGeometry | undefined;
  if (cloth.length) {
    // A hand flag is its own mesh (the `people_flag` material waves it); it follows the body's placement.
    flag = merge(cloth);
    flag.translate(0, -minY, 0);
    flag.scale(k, k, k);
    const rel = flag.getAttribute('flagRel');
    for (let i = 0; i < rel.count; i++)
      rel.setXYZ(i, rel.getX(i) * k, rel.getY(i) * k, rel.getZ(i) * k);
  }
  return { atlas, scan, flag };
}

/** Joint angles of a pose for the scanned body. */
function scanPose(pose: Pose, o: Outfit): ScanPose {
  const arm = (a: Limb, side: number) => ({
    up: dirDown(a.p, a.ab, side),
    low: dirDown(a.p + a.bend, a.ab2 ?? a.ab, side),
  });
  const leg = (l: Limb, side: number) => {
    const shin = l.p - l.bend;
    // The foot stays flat until the shin leans past ~0.4 rad, then follows it (toe-off, kneeling).
    const lean = shin - Math.min(0.4, Math.max(-0.4, shin));
    return {
      up: dirDown(l.p, l.ab, side),
      low: dirDown(shin, l.ab * 0.5, side),
      foot: -lean,
    };
  };
  return {
    lean: new Matrix4().makeRotationFromEuler(
      new Euler(pose.lean ?? 0, 0, pose.sway ?? 0, 'ZXY'),
    ),
    head: new Matrix4().makeRotationFromEuler(
      new Euler(pose.head ?? 0, pose.turn ?? 0, 0, 'YXZ'),
    ),
    headScale: o.headScale ?? 1,
    broad: o.broad,
    crop: o.hairKind === 'short' || o.hairKind === 'bald' ? 1 : 0,
    arm: [arm(pose.armL, 1), arm(pose.armR, -1)],
    leg: [leg(pose.legL, 1), leg(pose.legR, -1)],
  };
}

/** Where the scanned body's own sleeves end on a short-sleeved woman (the man's shirt already has them). */
const SHORT_SLEEVE = 0.32;
/** Shorts end this high (scan frame, m). */
const SHORTS_HEM = 0.62;
/** The scans are a little taller than the old figures (1.81 m): bring the average person to 1.76 m. */
const SCAN_SCALE = 0.975;

/** The colours an outfit dyes into the scanned body. */
function scanLook(o: Outfit): ScanLook {
  return {
    top: o.torso,
    low: o.legs,
    hair: o.hairKind === 'bald' ? o.skin : o.hair,
    shoe: o.shoes,
    skin: o.skin,
    sleeve: o.sleeves ?? o.torso,
    glove: o.gloves,
    sleeveEnd: o.shortSleeves
      ? o.model === 'female'
        ? SHORT_SLEEVE
        : 0
      : 0.97,
    hem: o.shorts ? SHORTS_HEM : 0,
  };
}

/** The near figure (LOD 0 / 1): the scanned body, what it wears, what it holds. */
function figureScan({ pose, outfit: o, lod }: FigureOpts): Built {
  const hi = lod === 0;
  const sp = scanPose(pose, o);
  const body = skinScan(o.model, lod, sp, scanLook(o));
  const parts = dress(o, o.model, body, o.broad, hi);
  if (pose.prop)
    parts.push(
      ...propParts(
        pose.prop,
        body.hands,
        body.S,
        sp.lean,
        body.Hc,
        hi,
        hi,
        o.flag,
      ),
    );
  const built = finishBody(parts, pose, o, body.geometry, SCAN_SCALE);
  if (hi) packNormals(built.scan!);
  return built;
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

function headParts(o: Outfit): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const seg = 4;
  const head = new SphereGeometry(HEAD_R, seg, 3);
  head.scale(0.92, 1.1, 1);
  out.push(headMap(paint(head, o.skin)));
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
  }
  return out;
}

function propParts(
  prop: Prop,
  hands: Vector3[],
  S: Vector3,
  R: Matrix4,
  Hc: Vector3,
  hi: boolean,
  /** The near figure: flags get their rays, stripes and stars. */
  fine = false,
  flag: [string, string] = ['#d8322a', '#d8322a'],
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
      .add(v(0, 0.045, -0.02));
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
    const f0 = out.length;
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
    out.push(block(0.2, 0.13, 0.008, hr.clone().add(v(0.1, 0.23, 0)), flag[0]));
    if (flag[1] !== flag[0])
      out.push(
        block(0.2, 0.05, 0.012, hr.clone().add(v(0.1, 0.2, 0)), flag[1]),
      );
    markFlag(out.slice(f0), hr);
  } else if (prop === 'flagMk' || prop === 'flagUs') {
    const f0 = out.length;
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
    // Flag units: W x H, origin at the cloth centre, +y up.
    const W = 0.3;
    const H = 0.15;
    if (prop === 'flagMk') {
      // North Macedonia: red field, a yellow disc and eight rays reaching the edges (a ray = two inner points near the
      // disc and two on the border).
      out.push(block(W, H, 0.006, c, '#d82126', undefined, REFLECT));
      const disc = new CylinderGeometry(0.0215, 0.0215, 0.02, fine ? 10 : 6);
      disc.rotateX(Math.PI / 2);
      disc.translate(c.x, c.y, c.z);
      out.push(tag(paint(disc, '#f8e92e'), REFLECT));
      if (fine) {
        const edge: [number, number][][] = [
          [
            [-W / 2, -H / 2],
            [-W / 2 + 0.15 * W, -H / 2],
          ],
          [
            [W / 2, -H / 2],
            [W / 2 - 0.15 * W, -H / 2],
          ],
          [
            [-W / 2, H / 2],
            [-W / 2 + 0.15 * W, H / 2],
          ],
          [
            [W / 2, H / 2],
            [W / 2 - 0.15 * W, H / 2],
          ],
          [
            [-0.05 * W, -H / 2],
            [0.05 * W, -H / 2],
          ],
          [
            [-0.05 * W, H / 2],
            [0.05 * W, H / 2],
          ],
          [
            [-W / 2, -0.1 * H],
            [-W / 2, 0.1 * H],
          ],
          [
            [W / 2, -0.1 * H],
            [W / 2, 0.1 * H],
          ],
        ];
        for (const [p1, p2] of edge) {
          const inner = (p: [number, number]): [number, number] => {
            const k = (0.029 * 1.0) / Math.hypot(p[0], p[1]);
            return [p[0] * k, p[1] * k];
          };
          out.push(
            flatPoly([inner(p1), inner(p2), p2, p1], c, '#f8e92e', 0.02),
          );
        }
      }
    } else {
      // USA: thirteen stripes, the blue canton (two fifths wide, seven stripes tall) with rows of stars.
      const stripe = H / 13;
      out.push(block(W, H, 0.006, c, '#f4f4f4', undefined, REFLECT));
      if (fine) {
        for (let i = 0; i < 13; i += 2)
          out.push(
            block(
              W,
              stripe,
              0.016,
              v(c.x, c.y + H / 2 - stripe * (i + 0.5), c.z),
              '#bb1030',
              undefined,
              REFLECT,
            ),
          );
      } else
        out.push(
          block(
            W,
            H * 0.4,
            0.01,
            v(c.x, c.y - H * 0.25, c.z),
            '#bb1030',
            undefined,
            REFLECT,
          ),
        );
      const cw = W * 0.4;
      const ch = stripe * 7;
      const cc = v(c.x - W / 2 + cw / 2, c.y + H / 2 - ch / 2, c.z);
      out.push(block(cw, ch, 0.022, cc, '#002060', undefined, REFLECT));
      if (fine)
        for (let r = 0; r < 5; r++)
          for (let k = 0; k < (r % 2 === 0 ? 4 : 3); k++)
            out.push(
              block(
                0.0075,
                0.0075,
                0.028,
                v(
                  cc.x - cw / 2 + (cw / 9) * ((r % 2 === 0 ? 1 : 2) + k * 2),
                  cc.y + ch / 2 - (ch / 6) * (r + 1),
                  cc.z,
                ),
                '#ffffff',
                undefined,
                REFLECT,
              ),
            );
    }
    markFlag(out.slice(f0), hr);
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
  /** Crowd figure: LOD 2 is the boxy body, not the jointed one. */
  crowd = false,
): {
  parts: {
    geometry: BufferGeometry;
    material: ReturnType<typeof getMaterial>;
  }[];
} {
  if (lod <= 1) {
    const b = figureScan({ pose: POSES[pose] as Pose, outfit, lod, rng });
    const parts = [
      {
        geometry: b.scan!,
        material:
          lod === 0
            ? scanMaterial(outfit.model, scanLook(outfit))
            : scanMidMaterial(),
      },
    ];
    if (b.atlas)
      parts.push({ geometry: b.atlas, material: getMaterial('people') });
    if (b.flag)
      parts.push({ geometry: b.flag, material: getMaterial('people_flag') });
    return { parts };
  }
  const g =
    lod >= 3
      ? blob(outfit)
      : lod === 2 && crowd
        ? blocky(outfit, pose)
        : figure({ pose: POSES[pose] as Pose, outfit });
  const parts = [{ geometry: g, material: getMaterial('people') }];
  const flag = g.userData.flag as BufferGeometry | undefined;
  if (flag)
    parts.push({ geometry: flag, material: getMaterial('people_flag') });
  return { parts };
}

const baseOutfit = (rng: Rng): Outfit => {
  const model: ScanModel = rng.chance(0.5) ? 'female' : 'male';
  return {
    model,
    shoes: rng.pick(['#1b1b1d', '#2c2a28', '#e6e6e6', '#3a2a1c']),
    legs: '#2b2f3a',
    torso: '#555555',
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR_COLORS),
    hairKind:
      model === 'female'
        ? rng.chance(0.3)
          ? 'short'
          : 'long'
        : rng.chance(0.3)
          ? 'long'
          : rng.chance(0.12)
            ? 'bald'
            : 'short',
    hat: 'none',
    hatColor: '#333333',
    scale: rng.range(0.93, 1.06),
    broad: rng.range(0.94, 1.08),
  };
};

/** Puts an outfit on one of the two bodies (a woman keeps her hair). */
function wearing(o: Outfit, model: ScanModel): Outfit {
  o.model = model;
  if (model === 'female' && o.hairKind === 'bald') o.hairKind = 'long';
  return o;
}

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
export const JEAN_COLORS = ['#34486b', '#2a3a58', '#3f5578'];

/** The six spectator outfits (variant % 6); the pose is variant / 6. */
const SPECTATOR_OUTFITS = 6;
const SPECTATOR_POSES: PoseName[] = ['stand', 'wave', 'camera', 'pockets'];

/** Variants from here on sit or squat at the roadside (outfit = variant % 6, pose = 3 seated ones). */
export const SPECTATOR_STANDING = 24;
/** Variants from here wave a hand flag: 6 outfits x (North Macedonia, USA). */
const SPECTATOR_FLAG_FROM = 42;
/** Plain hand flags (solid or two-tone, no national colour combinations). */
const FAN_FLAGS: [string, string][] = [
  ['#1c6fd1', '#1c6fd1'],
  ['#1f9e5a', '#1f9e5a'],
  ['#7a35b8', '#7a35b8'],
  ['#f07a10', '#f07a10'],
  ['#14a6b8', '#14a6b8'],
  ['#d8322a', '#d8322a'],
  ['#1c6fd1', '#f07a10'],
  ['#1f9e5a', '#f2f2f2'],
  ['#7a35b8', '#f2c21c'],
  ['#14181c', '#f2f2f2'],
  ['#d8327a', '#14a6b8'],
  ['#f2c21c', '#14181c'],
];
const FLAG_POSES: PoseName[] = ['waveMk', 'waveUs'];
const SPECTATOR_SEATED: PoseName[] = ['sitGround', 'sitKnees', 'squat'];

export const spectator: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  const jacket = JACKETS[(variant * 5 + rng.int(0, 11)) % JACKETS.length];
  const style = variant % SPECTATOR_OUTFITS;
  o.torso = jacket;
  o.legs = rng.pick(style === 1 ? JEAN_COLORS : TROUSER_COLORS);
  if (style === 0 || style === 2 || style === 3) o.jacket = true;
  if (style === 0) o.sleeves = jacket;
  if (style === 1) {
    // T-shirt, shorts, cap.
    o.shortSleeves = true;
    o.shorts = rng.chance(0.6);
    if (o.shorts) wearing(o, 'male');
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
    o.pack = rng.pick(['#3d4a66', '#a03838', '#3a7048']);
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
  o.flag = FAN_FLAGS[rng.int(0, FAN_FLAGS.length - 1)];
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
  o.jacket = true;
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
  o.jacket = true;
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
  o.jacket = true;
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
      wearing(o, 'male');
      o.hat = rng.chance(0.5) ? 'cap' : 'none';
      o.hairKind = 'short';
      break;
    case 1: // woman, jacket and jeans
      wearing(o, 'female');
      o.jacket = true;
      o.broad = rng.range(0.96, 1.02);
      o.scale = rng.range(0.9, 0.96);
      o.shoes = rng.pick(['#e6e6e6', '#7a3a2a', '#1b1b1d']);
      break;
    case 2: // child
      o.scale = rng.range(0.58, 0.7);
      o.headScale = 1.3;
      o.broad = 0.94;
      o.hairKind = rng.chance(0.5) ? 'long' : 'short';
      o.torso = rng.pick(WARM);
      o.shoes = rng.pick(['#e6e6e6', '#c0302a']);
      break;
    case 3: // older man, grey hair, jacket, maybe glasses
      wearing(o, 'male');
      o.hair = '#b8b4ac';
      o.hairKind = rng.chance(0.3) ? 'bald' : 'short';
      o.torso = rng.pick(['#5a5040', '#3a4a5a', '#6a6a60']);
      o.legs = rng.pick(TROUSER_COLORS);
      o.scale = rng.range(0.94, 1);
      o.broad = 1.06;
      o.glasses = rng.chance(0.5);
      break;
    case 4: // woman in a dress over dark tights
      wearing(o, 'female');
      o.skirt = rng.pick(WARM.concat(['#7a3ab0', '#2a5fc0']));
      o.skirtLen = 0.8;
      o.torso = o.skirt;
      o.legs = '#26262c';
      o.shoes = rng.pick(['#2c2a28', '#e6e6e6']);
      o.hairKind = 'long';
      o.broad = rng.range(0.96, 1.02);
      o.scale = rng.range(0.9, 0.98);
      break;
    case 5: // older woman, grey hair, cardigan, skirt
      wearing(o, 'female');
      o.hair = '#c8c4bc';
      o.hairKind = 'short';
      o.skirt = rng.pick(['#4a3a5a', '#3a4a4a', '#5a4a3a']);
      o.skirtLen = 0.78;
      o.legs = '#2e2a2a';
      o.torso = rng.pick(['#8a5a6a', '#5a7a6a', '#a89a6a']);
      o.jacket = true;
      o.broad = 1;
      o.scale = rng.range(0.88, 0.94);
      break;
    case 6: // teenager, hood or beanie, backpack
      o.hat = rng.chance(0.5) ? 'beanie' : 'none';
      o.pack = rng.pick(['#3d4a66', '#a03838']);
      o.scale = rng.range(0.82, 0.9);
      o.broad = 0.94;
      break;
    case 7: // tourist: shorts, T-shirt, cap, sunglasses, backpack
      wearing(o, 'male');
      o.shortSleeves = true;
      o.shorts = true;
      o.hat = 'cap';
      o.glasses = true;
      o.pack = rng.pick(['#2a5a3a', '#7a5a2a']);
      break;
    case 8: // woman in a long coat
      wearing(o, 'female');
      o.skirt = o.torso = rng.pick(['#3a3a40', '#8a4a3a', '#4a5a7a']);
      o.skirtLen = 0.7;
      o.broad = rng.range(0.96, 1.02);
      break;
    case 9: // big man, cap, dark jacket
      wearing(o, 'male');
      o.torso = '#23262c';
      o.hat = 'cap';
      o.broad = 1.18;
      o.scale = rng.range(1, 1.06);
      break;
    case 10: // family kid, smaller still, hat
      o.scale = rng.range(0.5, 0.58);
      o.headScale = 1.35;
      o.hat = 'beanie';
      o.torso = rng.pick(WARM);
      o.broad = 0.92;
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
