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
import { merge, paint, planarUV } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
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

type Prop = 'tyre' | 'laptop' | 'camera' | 'phone' | 'helmet' | 'bottle';

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
type HairKind = 'short' | 'long' | 'bald';

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
  /** Backpack. */
  pack?: string;
  /** Gloves (default skin). */
  gloves?: string;
  /** Overall size (1 = 1.76 m). */
  scale: number;
  /** Shoulder / hip width factor. */
  broad: number;
}

const SKIN = ['#f0d0b0', '#e8c4a0', '#c99a72', '#a8744c', '#8d5a3b', '#6b4430'];
const HAIR = ['#1c1814', '#2e2218', '#4a3220', '#6b4a2a', '#8a6a3a', '#b0a090'];

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

/** Open tapered tube from `a` (radius `ra`) to `b` (radius `rb`), `flat` squashes it front to back. */
function tube(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  color: string,
  sides = 5,
  flat = 1,
): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(ra, rb, Math.max(len, 1e-3), sides, 1, true);
  if (flat !== 1) g.scale(1, 1, flat);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(UP, a.clone().sub(b).normalize()),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
}

/** A box at `at`, optionally turned so its Y axis follows `axis`, or by a matrix. */
function block(
  w: number,
  h: number,
  d: number,
  at: Vector3,
  color: string,
  m?: Matrix4,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (m) g.applyMatrix4(m);
  g.translate(at.x, at.y, at.z);
  return paint(g, color);
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
    parts.push(tube(H, K, 0.1, 0.07, thighColor, sides));
    parts.push(tube(K, A, 0.07, 0.05, o.shorts ? o.skin : o.legs, sides));
    if (hi) parts.push(block(0.1, 0.1, 0.1, K, thighColor));
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
      ),
    );
  }

  // Pelvis, torso, shoulders.
  const S = rot(0, TORSO, 0);
  parts.push(block(0.33 * broad, 0.16, 0.2, P, o.legs));
  const waist = P.clone().add(rot(0, 0.06, 0));
  const chest = S.clone().add(rot(0, -0.04, 0));
  parts.push(
    tube(waist, chest, 0.17 * broad, 0.21 * broad, o.torso, hi ? 6 : 5, 0.62),
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
    parts.push(
      tube(J, E, 0.062, 0.05, o.shortSleeves ? o.skin : sleeve, sides),
    );
    parts.push(tube(E, F, 0.05, 0.04, o.shortSleeves ? o.skin : sleeve, sides));
    const hand = F.clone().add(fd.clone().multiplyScalar(0.05));
    hands.push(hand);
    parts.push(block(0.085, 0.11, 0.07, hand, o.gloves ?? o.skin, along(fd)));
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
    ),
  );
  const M = R.clone().multiply(
    new Matrix4().makeRotationFromEuler(
      new Euler(pose.head ?? 0, pose.turn ?? 0, 0, 'YXZ'),
    ),
  );
  const head = headParts(o, hi, rng).map((g) => g.applyMatrix4(M));
  const Hc = S.clone().add(rot(0, 0.06 + HEAD_R * 0.95, 0.01));
  for (const g of head) {
    g.translate(Hc.x, Hc.y, Hc.z);
    parts.push(g);
  }

  // What is held.
  if (pose.prop) parts.push(...propParts(pose.prop, hands, S, R, Hc, hi));

  const g = merge(parts.map((p) => planarUV(p, 1.3)));
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

function headParts(o: Outfit, hi: boolean, rng: Rng): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const seg = hi ? 6 : 4;
  const head = new SphereGeometry(HEAD_R, seg, hi ? 4 : 3);
  head.scale(0.92, 1.1, 1);
  out.push(paint(head, o.skin));
  if (hi)
    out.push(block(0.03, 0.04, 0.035, v(0, -0.01, HEAD_R + 0.005), o.skin));
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
    out.push(paint(d, o.hair));
    if (o.hairKind === 'long')
      out.push(block(0.19, 0.2, 0.06, v(0, -0.05, -HEAD_R * 0.9), o.hair));
  } else if (hi && o.hat === 'cap' && o.hairKind === 'long') {
    out.push(block(0.12, 0.14, 0.05, v(0, -0.07, -HEAD_R * 0.85), o.hair));
  }
  void rng;
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
  const g = merge(parts.map((p) => planarUV(p, 1.3)));
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
  const g = merge(parts.map((p) => planarUV(p, 1.3)));
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
    lod >= 2
      ? blob(outfit)
      : crowd && lod === 1
        ? blocky(outfit, pose)
        : figure({ pose: POSES[pose] as Pose, outfit, lod, rng });
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
}

const baseOutfit = (rng: Rng): Outfit => ({
  shoes: rng.pick(['#1b1b1d', '#2c2a28', '#e6e6e6', '#3a2a1c']),
  legs: '#2b2f3a',
  torso: '#555555',
  skin: rng.pick(SKIN),
  hair: rng.pick(HAIR),
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
const TROUSERS = [
  '#2b2f3a',
  '#3b3a36',
  '#25344f',
  '#4a4a4a',
  '#5a5040',
  '#1f2630',
];
const JEANS = ['#34486b', '#2a3a58', '#3f5578'];

/** The six spectator outfits (variant % 6); the pose is variant / 6. */
const SPECTATOR_OUTFITS = 6;
const SPECTATOR_POSES: PoseName[] = ['stand', 'wave', 'camera', 'pockets'];

export const spectator: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  const jacket = JACKETS[(variant * 5 + rng.int(0, 11)) % JACKETS.length];
  const style = variant % SPECTATOR_OUTFITS;
  o.torso = jacket;
  o.legs = rng.pick(style === 1 ? JEANS : TROUSERS);
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
    o.legs = rng.pick(JEANS);
  } else if (style === 3) {
    // Hi-vis vest over a dark jacket (helpers, locals).
    o.torso = '#2e3138';
    o.vest = rng.pick(['#d4e21c', '#f05a10']);
    o.hat = rng.chance(0.4) ? 'cap' : 'none';
    o.hatColor = '#222222';
  } else if (style === 4) {
    // Backpack, jeans.
    o.pack = rng.pick(['#2a2f3a', '#7a2a2a', '#2a5a3a']);
    o.legs = rng.pick(JEANS);
    o.hat = rng.chance(0.35) ? 'cap' : 'none';
    o.hatColor = rng.pick(JACKETS);
  } else if (style === 5) {
    // Supporter: team-coloured shirt and a scarf.
    const t = TEAMS[rng.int(0, TEAMS.length - 1)];
    o.torso = t.base;
    o.collar = t.accent;
    o.shortSleeves = rng.chance(0.4);
    o.legs = rng.pick(JEANS);
  }
  const pose = SPECTATOR_POSES[Math.floor(variant / SPECTATOR_OUTFITS) % 4];
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

/** Marshals and officials: orange / yellow / white tabards over dark clothes, caps, one pointing. */
const MARSHAL_VESTS = [
  '#f05a10',
  '#f05a10',
  '#d4e21c',
  '#d4e21c',
  '#f2f2f2',
  '#2a6fd0',
];
export const marshal: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  o.torso = '#2a2e36';
  o.legs = '#23262c';
  o.vest = MARSHAL_VESTS[variant % MARSHAL_VESTS.length];
  o.hat = rng.chance(0.6) ? 'cap' : 'none';
  o.hatColor = rng.pick(['#222222', '#d4e21c', '#f05a10']);
  const pose = (['stand2', 'point', 'pockets', 'phone'] as const)[variant % 4];
  return finishFigure(pose, o, lod, rng);
};

/** A person for the pit lane around the park: drinks, phone, walks - caps, hoodies, press bibs. */
export const visitor: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const o = baseOutfit(rng);
  o.torso = rng.pick(JACKETS);
  o.legs = rng.pick(JEANS);
  o.hat = rng.chance(0.4) ? 'cap' : 'none';
  o.hatColor = rng.pick(JACKETS);
  if (variant % 3 === 0) o.vest = '#2a6fd0';
  const pose: PoseName = (['walk', 'drink', 'phone', 'stand2'] as const)[
    variant % 4
  ];
  return finishFigure(pose, o, lod, rng);
};
