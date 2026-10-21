import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { PEOPLE_BASE } from '../../engine/people-base.data';

/**
 * The two clean base bodies (credits: THIRD-PARTY.md) as game figures: an A-pose mesh skinned on the CPU to the joint
 * angles of a pose (people.ts `Pose`), one geometry per figure. Weights come from the body's own proportions (rules per
 * joint, not painted). Everything a person wears is cut from this mesh (people-tailor.ts), so it shares these weights.
 *
 * Frame: origin = the pelvis joint, +Z forward, Y up, left = +X.
 */

export type BodyModel = 'male' | 'female';

export const BONE = {
  pelvis: 0,
  spine: 1,
  head: 2,
  upL: 3,
  upR: 4,
  foreL: 5,
  foreR: 6,
  thighL: 7,
  thighR: 8,
  shinL: 9,
  shinR: 10,
  footL: 11,
  footR: 12,
} as const;
export const BONES = 13;

type V3 = [number, number, number];

/** Where the joints of a model are (body frame as baked: y up from the soles, left side; the right side mirrors x). */
export interface Rig {
  /** Height of the pelvis joint (the origin of the posed frame). */
  hip: number;
  hipJ: V3;
  kneeJ: V3;
  ankleJ: V3;
  /** Neck joint (the head turns about it): height, z. */
  neck: [number, number];
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  /** Head centre and radii. */
  head: V3;
  headR: V3;
  /** Eye height and the face's front at eye level. */
  eye: [number, number];
  neckR: number;
  /** Waistband height: where trousers and skirts start. */
  waist: number;
  /** Shoulder line. */
  chest: number;
  /** Arm tube radii: shoulder, elbow, wrist, hand. */
  armR: [number, number, number, number];
}

const RIGS: Record<BodyModel, Rig> = {
  male: {
    hip: 0.895,
    hipJ: [0.092, 0.895, 0],
    kneeJ: [0.121, 0.485, 0.008],
    ankleJ: [0.142, 0.095, -0.02],
    neck: [1.545, -0.02],
    shoulder: [0.235, 1.4, -0.1],
    elbow: [0.352, 1.2, -0.082],
    wrist: [0.484, 1.045, 0.095],
    head: [0, 1.69, 0.012],
    headR: [0.095, 0.125, 0.112],
    eye: [1.7, 0.098],
    neckR: 0.062,
    waist: 0.99,
    chest: 1.46,
    armR: [0.075, 0.052, 0.04, 0.06],
  },
  female: {
    hip: 0.87,
    hipJ: [0.09, 0.87, 0.01],
    kneeJ: [0.119, 0.485, 0.012],
    ankleJ: [0.141, 0.09, -0.01],
    neck: [1.49, -0.01],
    shoulder: [0.205, 1.35, -0.03],
    elbow: [0.3, 1.16, -0.012],
    wrist: [0.418, 1.015, 0.125],
    head: [0, 1.61, 0.012],
    headR: [0.09, 0.115, 0.1],
    eye: [1.62, 0.1],
    neckR: 0.052,
    waist: 0.99,
    chest: 1.4,
    armR: [0.065, 0.046, 0.034, 0.055],
  },
};

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One mesh of a model: rest positions (pelvis frame), skin weights and the zones the tailoring cuts along. */
export interface Mesh {
  n: number;
  pos: Float32Array;
  nor: Float32Array;
  uv?: Float32Array;
  index: Uint16Array;
  /** Dense skin weights: BONES per vertex. */
  w: Float32Array;
  /** Arm share (0 torso .. 1 arm), position along the arm (0 shoulder, 1 wrist, beyond = hand). */
  arm: Float32Array;
  armT: Float32Array;
  /** Leg share, position along the leg (0 hip joint, 1 ankle). */
  leg: Float32Array;
  legT: Float32Array;
}

interface Model {
  rig: Rig;
  full: Mesh;
  mid: Mesh;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/** Decodes a pack of scripts/people/bake-base.mjs. */
function unpack(b64: string, withUv: boolean, rig: Rig): Mesh {
  const u8 = bytes(b64);
  const dv = new DataView(u8.buffer);
  const n = dv.getUint32(0, true);
  const nt = dv.getUint32(4, true);
  const lo = [8, 12, 16].map((o) => dv.getFloat32(o, true));
  const size = [20, 24, 28].map((o) => dv.getFloat32(o, true));
  let at = 32;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++, at += 2)
      pos[i * 3 + k] = lo[k] + (size[k] * dv.getUint16(at, true)) / 65535;
  let uv: Float32Array | undefined;
  if (withUv) {
    uv = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++, at += 2)
      uv[i] = dv.getUint16(at, true) / 65535;
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++, at++) nor[i] = dv.getInt8(at) / 127;
  const index = new Uint16Array(nt * 3);
  for (let i = 0; i < nt * 3; i++, at += 2) index[i] = dv.getUint16(at, true);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] -= rig.hip;
  const m: Mesh = {
    n,
    pos,
    nor,
    uv,
    index,
    w: new Float32Array(n * BONES),
    arm: new Float32Array(n),
    armT: new Float32Array(n),
    leg: new Float32Array(n),
    legT: new Float32Array(n),
  };
  weigh(m, rig);
  return m;
}

/** Closest point of the segment a-b to p: [distance, parameter 0..1]. */
function toSegment(p: V3, a: V3, b: V3): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.min(
    1,
    Math.max(
      0,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2,
    ),
  );
  return [
    Math.hypot(
      p[0] - a[0] - dx * t,
      p[1] - a[1] - dy * t,
      p[2] - a[2] - dz * t,
    ),
    t,
  ];
}

/** Length of the hand beyond the wrist joint (m). */
const HAND = 0.19;

/** Skin weights and zones per vertex from the joint rules (see the file comment). */
function weigh(m: Mesh, rig: Rig): void {
  const [sx, sy, sz] = rig.shoulder;
  const E = rig.elbow;
  const W = rig.wrist;
  const upper = Math.hypot(E[0] - sx, E[1] - sy, E[2] - sz);
  const fore = Math.hypot(E[0] - W[0], E[1] - W[1], E[2] - W[2]);
  const dir = (a: V3, b: V3, l: number): V3 => [
    (b[0] - a[0]) / l,
    (b[1] - a[1]) / l,
    (b[2] - a[2]) / l,
  ];
  const dUp = dir(rig.shoulder, E, upper);
  const dFore = dir(E, W, fore);
  const tip: V3 = [
    W[0] + dFore[0] * HAND,
    W[1] + dFore[1] * HAND,
    W[2] + dFore[2] * HAND,
  ];
  const reach = upper + fore;
  // Distance along the arm: on the straight shoulder - wrist line, so it is smooth across the elbow (a bent-arm
  // measure flips between the two segments there and cuts jag).
  const straight = Math.hypot(W[0] - sx, W[1] - sy, W[2] - sz);
  const dSW = dir(rig.shoulder, W, straight);
  const [r0, r1, r2, r3] = rig.armR;
  const hip = rig.hip;
  const slot: [number, number][] = [];
  for (let i = 0; i < m.n; i++) {
    const x = m.pos[i * 3];
    const y = m.pos[i * 3 + 1] + hip;
    const z = m.pos[i * 3 + 2];
    const ax = Math.abs(x);
    const left = x >= 0;
    const p: V3 = [ax, y, z];
    // The arm: inside the tube round the shoulder - elbow - wrist - hand line, or on the shoulder cap.
    const [d1, t1] = toSegment(p, rig.shoulder, E);
    const [d2, t2] = toSegment(p, E, W);
    const [d3, t3] = toSegment(p, W, tip);
    let d = d1;
    let along = t1 * upper;
    let r = r0 + (r1 - r0) * t1;
    if (d2 < d) {
      d = d2;
      along = upper + t2 * fore;
      r = r1 + (r2 - r1) * t2;
    }
    if (d3 < d) {
      d = d3;
      along = reach + t3 * HAND;
      r = r2 + (r3 - r2) * Math.min(1, t3 * 2.5);
    }
    // Past the shoulder joint towards the neck the tube is the chest, not the arm.
    const s =
      (p[0] - sx) * dUp[0] + (p[1] - sy) * dUp[1] + (p[2] - sz) * dUp[2];
    const tube = (1 - smooth(r, r * 1.5, d)) * smooth(-0.06, 0.04, s);
    const cap = smooth(sx, sx + 0.07, ax) * smooth(sy - 0.28, sy - 0.18, y);
    // Nothing but an arm reaches this far out (the hands and the fingers spread beyond the tube).
    const far = smooth(0.24, 0.3, ax);
    const armW = Math.max(tube, cap, far);
    const elbowS =
      (p[0] - E[0]) * dFore[0] +
      (p[1] - E[1]) * dFore[1] +
      (p[2] - E[2]) * dFore[2];
    const foreW = smooth(-0.06, 0.06, elbowS);
    const head =
      smooth(rig.neck[0] - 0.02, rig.neck[0] + 0.055, y) *
      (1 -
        (1 - smooth(rig.neck[0] + 0.03, rig.neck[0] + 0.08, y)) *
          smooth(0.09, 0.13, ax));
    // The hands hang below the hips in the A pose: an arm vertex is never a leg.
    const leg = (1 - smooth(hip - 0.1, hip + 0.04, y)) * (1 - armW);
    const torso = 1 - leg;
    const spine = smooth(hip, hip + 0.18, y);
    const shin = 1 - smooth(rig.kneeJ[1] - 0.08, rig.kneeJ[1] + 0.08, y);
    const foot = 1 - smooth(rig.ankleJ[1] - 0.025, rig.ankleJ[1] + 0.05, y);
    const side = smooth(-0.03, 0.03, x);
    const body = torso * (1 - head) * (1 - armW);
    const up = torso * (1 - head) * armW;
    slot.length = 0;
    slot.push([BONE.pelvis, body * (1 - spine)]);
    slot.push([BONE.spine, body * spine]);
    slot.push([BONE.head, torso * head]);
    slot.push([left ? BONE.upL : BONE.upR, up * (1 - foreW)]);
    slot.push([left ? BONE.foreL : BONE.foreR, up * foreW]);
    const thigh = leg * (1 - shin);
    const low = leg * shin * (1 - foot);
    const toe = leg * shin * foot;
    slot.push([BONE.thighL, thigh * side], [BONE.thighR, thigh * (1 - side)]);
    slot.push([BONE.shinL, low * side], [BONE.shinR, low * (1 - side)]);
    slot.push([BONE.footL, toe * side], [BONE.footR, toe * (1 - side)]);
    for (const [b, v] of slot) m.w[i * BONES + b] = v;
    m.arm[i] = up;
    void along;
    m.armT[i] =
      (((p[0] - sx) * dSW[0] + (p[1] - sy) * dSW[1] + (p[2] - sz) * dSW[2]) *
        (reach / straight)) /
      reach;
    m.leg[i] = leg;
    m.legT[i] = Math.min(
      1.2,
      Math.max(0, (rig.hipJ[1] - y) / (rig.hipJ[1] - rig.ankleJ[1])),
    );
  }
}

const models = new Map<BodyModel, Model>();

function model(m: BodyModel): Model {
  let r = models.get(m);
  if (!r) {
    const d = PEOPLE_BASE[m];
    const rig = RIGS[m];
    r = {
      rig,
      full: unpack(d.lods[0], true, rig),
      mid: unpack(d.lods[1], false, rig),
    };
    models.set(m, r);
  }
  return r;
}

/** The mesh of a model at a level of detail (0 = full, 1 = mid-range). */
export function bodyMesh(m: BodyModel, lod: number): Mesh {
  return lod === 0 ? model(m).full : model(m).mid;
}

/** Rest-frame measures of a model for the things worn (hats, glasses, belts). */
export function bodyRig(m: BodyModel): {
  head: Vector3;
  headR: Vector3;
  eyeY: number;
  faceZ: number;
  neckR: number;
  waist: number;
  chest: number;
  neck: Vector3;
  hip: number;
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  hipJ: Vector3;
  kneeJ: Vector3;
  ankleJ: Vector3;
} {
  const rig = RIGS[m];
  const rel = (p: V3): Vector3 => new Vector3(p[0], p[1] - rig.hip, p[2]);
  return {
    head: rel(rig.head),
    headR: new Vector3(...rig.headR),
    eyeY: rig.eye[0] - rig.hip,
    faceZ: rig.eye[1],
    neckR: rig.neckR,
    waist: rig.waist - rig.hip,
    chest: rig.chest - rig.hip,
    neck: new Vector3(0, rig.neck[0] - rig.hip, rig.neck[1]),
    hip: rig.hip,
    shoulder: rel(rig.shoulder),
    elbow: rel(rig.elbow),
    wrist: rel(rig.wrist),
    hipJ: rel(rig.hipJ),
    kneeJ: rel(rig.kneeJ),
    ankleJ: rel(rig.ankleJ),
  };
}

/** Joint directions of a pose: (left, right) upper arm / forearm and thigh / shin, foot pitch. */
export interface BodyPose {
  /** Torso turn about the pelvis. */
  lean: Matrix4;
  /** Head turn / pitch, applied after the torso's, and its size factor. */
  head: Matrix4;
  headScale: number;
  /** Shoulder / hip width factor. */
  broad: number;
  arm: [{ up: Vector3; low: Vector3 }, { up: Vector3; low: Vector3 }];
  leg: [
    { up: Vector3; low: Vector3; foot: number },
    { up: Vector3; low: Vector3; foot: number },
  ];
}

export interface PosedBody {
  /** Rest frame -> posed frame, per `BONE`. */
  bones: Matrix4[];
  /** Posed hand centres (left, right), shoulder line centre, head centre. */
  hands: Vector3[];
  S: Vector3;
  Hc: Vector3;
}

const ONE = new Vector3(1, 1, 1);

/** Turns by `q` about `at` (the posed joint) the point `rest` of the rest frame, as a matrix. */
function pivot(q: Quaternion, at: Vector3, rest: Vector3): Matrix4 {
  return new Matrix4().compose(
    at.clone().sub(rest.clone().applyQuaternion(q)),
    q,
    ONE,
  );
}

const aim = (from: Vector3, to: Vector3): Quaternion =>
  new Quaternion().setFromUnitVectors(
    from.clone().normalize(),
    to.clone().normalize(),
  );

/** Rest joint positions of a model for a `broad` factor, relative to the pelvis (side +1 = left). */
function joints(rig: Rig, broad: number, side: number) {
  const k = rig.shoulder[0] * (broad - 1);
  const arm = (p: V3): Vector3 =>
    new Vector3((p[0] + k) * side, p[1] - rig.hip, p[2]);
  const leg = (p: V3): Vector3 =>
    new Vector3(
      p[0] * broad * side,
      p[1] - rig.hip,
      p[2] * (1 + (broad - 1) * 0.6),
    );
  return {
    shoulder: arm(rig.shoulder),
    elbow: arm(rig.elbow),
    wrist: arm(rig.wrist),
    hip: leg(rig.hipJ),
    knee: leg(rig.kneeJ),
    ankle: leg(rig.ankleJ),
  };
}

/** Bone matrices of a pose. */
export function pose(m: BodyModel, p: BodyPose): PosedBody {
  const rig = RIGS[m];
  const bones: Matrix4[] = Array.from({ length: BONES }, () => new Matrix4());
  bones[BONE.spine].copy(p.lean);
  const nk = new Vector3(0, rig.neck[0] - rig.hip, rig.neck[1]);
  const lin = p.lean
    .clone()
    .multiply(p.head)
    .multiply(new Matrix4().makeScale(p.headScale, p.headScale, p.headScale));
  bones[BONE.head].copy(lin).setPosition(
    nk
      .clone()
      .applyMatrix4(p.lean)
      .sub(nk.clone().applyMatrix4(lin.clone().setPosition(0, 0, 0))),
  );
  const hands: Vector3[] = [];
  for (const [i, side] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const j = joints(rig, p.broad, side);
    const arm = p.arm[i];
    const J = j.shoulder.clone().applyMatrix4(p.lean);
    const qu = aim(j.elbow.clone().sub(j.shoulder), arm.up);
    bones[BONE.upL + i].copy(pivot(qu, J, j.shoulder));
    const lu = j.elbow.distanceTo(j.shoulder);
    const E = J.clone().add(arm.up.clone().normalize().multiplyScalar(lu));
    const qf = aim(j.wrist.clone().sub(j.elbow), arm.low);
    bones[BONE.foreL + i].copy(pivot(qf, E, j.elbow));
    const lf = j.wrist.distanceTo(j.elbow);
    const W = E.clone().add(arm.low.clone().normalize().multiplyScalar(lf));
    hands.push(W.add(arm.low.clone().normalize().multiplyScalar(0.085)));
    const leg = p.leg[i];
    const qt = aim(j.knee.clone().sub(j.hip), leg.up);
    bones[BONE.thighL + i].copy(pivot(qt, j.hip, j.hip));
    const lt = j.knee.distanceTo(j.hip);
    const K = j.hip.clone().add(leg.up.clone().normalize().multiplyScalar(lt));
    const qs = aim(j.ankle.clone().sub(j.knee), leg.low);
    bones[BONE.shinL + i].copy(pivot(qs, K, j.knee));
    const ls = j.ankle.distanceTo(j.knee);
    const A = K.clone().add(leg.low.clone().normalize().multiplyScalar(ls));
    bones[BONE.footL + i].copy(
      pivot(
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), leg.foot),
        A,
        j.ankle,
      ),
    );
  }
  const hc = rig.head;
  const head = new Vector3(hc[0], hc[1] - rig.hip, hc[2]).applyMatrix4(
    bones[BONE.head],
  );
  return {
    bones,
    hands,
    S: new Vector3(0, rig.chest - rig.hip + 0.02, -0.03).applyMatrix4(p.lean),
    Hc: head,
  };
}

/** Packs the normals of a posed body into signed bytes (4 per vertex: aligned): a third of the memory of a variant. */
export function packNormals(g: BufferGeometry): void {
  const n = g.getAttribute('normal');
  const q = new Int8Array(n.count * 4);
  for (let i = 0; i < n.count; i++) {
    q[i * 4] = Math.round(n.getX(i) * 127);
    q[i * 4 + 1] = Math.round(n.getY(i) * 127);
    q[i * 4 + 2] = Math.round(n.getZ(i) * 127);
  }
  g.setAttribute('normal', new BufferAttribute(q, 4, true));
}

/** Rest positions widened by `broad` (torso / legs / arm roots) into `out`: the same warp for the body and what it wears. */
export function widen(
  rest: ArrayLike<number>,
  arm: ArrayLike<number>,
  n: number,
  rig: Rig,
  broad: number,
  out: Float32Array,
): void {
  const k = rig.shoulder[0] * (broad - 1);
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3];
    // Torso and legs widen with the hips, an arm only moves out by the shoulder's share.
    const bodyW = 1 - arm[i];
    out[i * 3] = x * (1 + (broad - 1) * bodyW) + Math.sign(x) * k * arm[i];
    out[i * 3 + 1] = rest[i * 3 + 1];
    out[i * 3 + 2] = rest[i * 3 + 2] * (1 + (broad - 1) * 0.6 * bodyW);
  }
}

/** Linear blend skinning of positions (and normals) with the four strongest weights per vertex. */
export function skinPoints(
  n: number,
  rest: ArrayLike<number>,
  restNor: ArrayLike<number>,
  dense: ArrayLike<number>,
  bones: Matrix4[],
  pos: Float32Array,
  nor: Float32Array,
): void {
  const m = bones.map((b) => b.elements);
  const top: number[] = [0, 0, 0, 0];
  const topW: number[] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    top.fill(0);
    topW.fill(0);
    let sum = 0;
    for (let b = 0; b < BONES; b++) {
      const w = dense[i * BONES + b];
      if (w <= 0) continue;
      // Insert into the four strongest.
      let k = 3;
      if (w <= topW[3]) continue;
      while (k > 0 && topW[k - 1] < w) {
        topW[k] = topW[k - 1];
        top[k] = top[k - 1];
        k--;
      }
      topW[k] = w;
      top[k] = b;
    }
    for (let k = 0; k < 4; k++) sum += topW[k];
    const x = rest[i * 3];
    const y = rest[i * 3 + 1];
    const z = rest[i * 3 + 2];
    const nx = restNor[i * 3];
    const ny = restNor[i * 3 + 1];
    const nz = restNor[i * 3 + 2];
    let px = 0;
    let py = 0;
    let pz = 0;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    for (let k = 0; k < 4; k++) {
      const w = topW[k] / (sum || 1);
      if (w <= 0) continue;
      const e = m[top[k]];
      px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
      qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
      qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
    }
    const l = Math.hypot(qx, qy, qz) || 1;
    pos[i * 3] = px;
    pos[i * 3 + 1] = py;
    pos[i * 3 + 2] = pz;
    nor[i * 3] = qx / l;
    nor[i * 3 + 1] = qy / l;
    nor[i * 3 + 2] = qz / l;
  }
}

export { RIGS };
