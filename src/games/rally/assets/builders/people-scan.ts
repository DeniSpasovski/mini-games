import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { PEOPLE_SCAN } from '../../engine/people-scan.data';
import type { ScanLook, ScanModel } from '../../engine/people-scan-material';

/**
 * The two scanned people (credits: THIRD-PARTY.md) as game figures: a T-pose mesh skinned on the CPU to the joint
 * angles of a pose (people.ts `Pose`), one geometry per figure. Weights come from the body's own proportions (rules
 * per joint, not painted), so nothing but the mesh and its texture is needed. People are dressed by colour
 * (engine/people-scan-material.ts) and by accessories attached to the posed bones (people-wear.ts).
 *
 * Frame: origin = the pelvis joint, +Z forward, Y up, left = +X.
 */

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
const BONES = 13;

/** Where the joints of a model are (scan frame, left side; the right side mirrors x). */
interface Rig {
  /** Height of the pelvis joint (the origin of the posed frame). */
  hip: number;
  hipJ: [number, number, number];
  kneeJ: [number, number, number];
  ankleJ: [number, number, number];
  neck: [number, number];
  shoulder: [number, number, number];
  elbow: [number, number, number];
  wrist: [number, number, number];
  /** Head centre and radii (hair included). */
  head: [number, number, number];
  headR: [number, number, number];
  /** Eye height and the face's front at eye level. */
  eye: [number, number];
  /** Height of the ears: cropped hair ends here. */
  cut: number;
  neckR: number;
  /** Waistband (scan frame): where a skirt starts. */
  waist: number;
  /** Shoulder line: top of a vest. */
  chest: number;
  /** x range over which the arm takes over from the torso. */
  ramp: [number, number];
}

const RIGS: Record<ScanModel, Rig> = {
  male: {
    hip: 0.93,
    hipJ: [0.098, 0.93, 0],
    kneeJ: [0.126, 0.5, -0.01],
    ankleJ: [0.148, 0.09, -0.05],
    neck: [1.52, -0.045],
    shoulder: [0.215, 1.43, -0.05],
    elbow: [0.48, 1.435, -0.065],
    wrist: [0.68, 1.425, -0.06],
    head: [0, 1.685, -0.015],
    headR: [0.125, 0.125, 0.13],
    eye: [1.69, 0.092],
    cut: 1.665,
    neckR: 0.064,
    waist: 0.99,
    chest: 1.46,
    ramp: [0.185, 0.265],
  },
  female: {
    hip: 0.92,
    hipJ: [0.1, 0.92, 0],
    kneeJ: [0.1, 0.5, -0.02],
    ankleJ: [0.08, 0.09, -0.02],
    neck: [1.52, -0.04],
    shoulder: [0.165, 1.465, -0.055],
    elbow: [0.42, 1.447, -0.058],
    wrist: [0.595, 1.446, -0.034],
    head: [0, 1.69, -0.005],
    headR: [0.127, 0.13, 0.115],
    eye: [1.69, 0.105],
    cut: 1.67,
    neckR: 0.055,
    waist: 1.13,
    chest: 1.46,
    ramp: [0.14, 0.21],
  },
};

/**
 * The scans stand in a T. Their arms are turned down by this much (about the shoulder) once at load, so the poses
 * that let the arms hang need a smaller turn and the shoulders keep their shape.
 */
const A_POSE = 0.55;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One mesh of a model: rest positions (pelvis frame), skin weights, static zone data. */
interface Rest {
  n: number;
  pos: Float32Array;
  nor: Float32Array;
  index: BufferAttribute;
  uv?: BufferAttribute;
  col?: Uint8Array;
  mask?: Uint8Array;
  /** How much of a vertex is hair (0..255). */
  hair: Uint8Array;
  /** Four bone slots per vertex. */
  bone: Uint8Array;
  weight: Float32Array;
  /** Arm share, position along the arm (0 shoulder, 1 wrist), rest height. */
  zone: Float32Array;
  zoneAttr?: BufferAttribute;
  /** How much a vertex belongs to the torso / legs (the part `broad` widens) and to the arms. */
  body: Float32Array;
  arm: Float32Array;
}

interface Model {
  rig: Rig;
  full: Rest;
  mid: Rest;
  rings?: Rings;
  head?: Head;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/** Decodes a pack of scripts/people/bake-people.mjs. */
function unpack(b64: string, mid: boolean, rig: Rig): Rest {
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
  let uv: BufferAttribute | undefined;
  let col: Uint8Array | undefined;
  let mask: Uint8Array | undefined;
  if (mid) {
    col = u8.slice(at, at + n * 3);
    at += n * 3;
    mask = u8.slice(at, at + n * 6);
    at += n * 6;
  } else {
    const t = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++, at += 2)
      t[i] = dv.getUint16(at, true) / 65535;
    uv = new BufferAttribute(t, 2);
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++, at++) nor[i] = dv.getInt8(at) / 127;
  let hair: Uint8Array;
  if (mid) {
    hair = new Uint8Array(n);
    for (let i = 0; i < n; i++) hair[i] = mask![i * 6 + 3];
  } else {
    hair = u8.slice(at, at + n);
    at += n;
  }
  const idx = new Uint16Array(nt * 3);
  for (let i = 0; i < nt * 3; i++, at += 2) idx[i] = dv.getUint16(at, true);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] -= rig.hip;
  const r: Rest = {
    n,
    pos,
    nor,
    index: new BufferAttribute(idx, 1),
    uv,
    col,
    mask,
    hair,
    bone: new Uint8Array(n * 4),
    weight: new Float32Array(n * 4),
    zone: new Float32Array(n * 3),
    body: new Float32Array(n),
    arm: new Float32Array(n),
  };
  weigh(r, rig);
  lowerArms(r, rig);
  if (!mid) r.zoneAttr = new BufferAttribute(r.zone, 3);
  return r;
}

/** Turns the arms from the T into the A pose (`A_POSE`), each vertex by its arm weight. */
function lowerArms(r: Rest, rig: Rig): void {
  const c = Math.cos(A_POSE);
  const s = Math.sin(A_POSE);
  const [xs, ys] = rig.shoulder;
  // In the left arm's frame (the right side is mirrored in x).
  const turn = (x: number, y: number): [number, number] => [
    x * c + y * s,
    -x * s + y * c,
  ];
  for (let i = 0; i < r.n; i++) {
    const w = r.arm[i];
    if (w <= 0) continue;
    const side = r.pos[i * 3] >= 0 ? 1 : -1;
    const dx = r.pos[i * 3] - side * xs;
    const dy = r.pos[i * 3 + 1] - (ys - rig.hip);
    const [tx, ty] = turn(dx * side, dy);
    r.pos[i * 3] += w * (side * tx - dx);
    r.pos[i * 3 + 1] += w * (ty - dy);
    const [nx, ny] = turn(r.nor[i * 3] * side, r.nor[i * 3 + 1]);
    const px = r.nor[i * 3] + w * (side * nx - r.nor[i * 3]);
    const py = r.nor[i * 3 + 1] + w * (ny - r.nor[i * 3 + 1]);
    const l = Math.hypot(px, py, r.nor[i * 3 + 2]) || 1;
    r.nor[i * 3] = px / l;
    r.nor[i * 3 + 1] = py / l;
    r.nor[i * 3 + 2] /= l;
  }
}

/** Skin weights and zone data per vertex from the joint rules (see the file comment). */
function weigh(r: Rest, rig: Rig): void {
  const [xs] = rig.shoulder;
  const [xe] = rig.elbow;
  const [xw] = rig.wrist;
  const hip = rig.hip;
  const slot: [number, number][] = [];
  for (let i = 0; i < r.n; i++) {
    const x = r.pos[i * 3];
    const y = r.pos[i * 3 + 1] + hip;
    const ax = Math.abs(x);
    const left = x >= 0;
    const head =
      smooth(rig.neck[0] - 0.02, rig.neck[0] + 0.055, y) *
      (1 -
        (1 - smooth(rig.neck[0] + 0.03, rig.neck[0] + 0.08, y)) *
          smooth(0.09, 0.13, ax));
    const arm = smooth(rig.ramp[0], rig.ramp[1], ax) * smooth(1.22, 1.3, y);
    const fore = smooth(xe - 0.07, xe + 0.07, ax);
    const leg = 1 - smooth(hip - 0.1, hip + 0.04, y);
    const torso = 1 - leg;
    const spine = smooth(hip, hip + 0.18, y);
    const shin = 1 - smooth(rig.kneeJ[1] - 0.08, rig.kneeJ[1] + 0.08, y);
    const foot = 1 - smooth(rig.ankleJ[1] - 0.025, rig.ankleJ[1] + 0.05, y);
    const side = smooth(-0.03, 0.03, x);
    const body = torso * (1 - head) * (1 - arm);
    const up = torso * (1 - head) * arm;
    slot.length = 0;
    slot.push([BONE.pelvis, body * (1 - spine)]);
    slot.push([BONE.spine, body * spine]);
    slot.push([BONE.head, torso * head]);
    slot.push([left ? BONE.upL : BONE.upR, up * (1 - fore)]);
    slot.push([left ? BONE.foreL : BONE.foreR, up * fore]);
    const thigh = leg * (1 - shin);
    const low = leg * shin * (1 - foot);
    const toe = leg * shin * foot;
    slot.push([BONE.thighL, thigh * side], [BONE.thighR, thigh * (1 - side)]);
    slot.push([BONE.shinL, low * side], [BONE.shinR, low * (1 - side)]);
    slot.push([BONE.footL, toe * side], [BONE.footR, toe * (1 - side)]);
    slot.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += slot[k][1];
    for (let k = 0; k < 4; k++) {
      r.bone[i * 4 + k] = slot[k][1] > 0 ? slot[k][0] : 0;
      r.weight[i * 4 + k] = slot[k][1] / sum;
    }
    r.body[i] = leg + body;
    r.arm[i] = up;
    r.zone[i * 3] = up;
    r.zone[i * 3 + 1] = Math.min(1.4, Math.max(0, (ax - xs) / (xw - xs)));
    r.zone[i * 3 + 2] = y;
  }
}

const models = new Map<ScanModel, Model>();

function model(m: ScanModel): Model {
  let r = models.get(m);
  if (!r) {
    const d = PEOPLE_SCAN[m];
    const rig = RIGS[m];
    r = {
      rig,
      full: unpack(d.lods[0], false, rig),
      mid: unpack(d.lods[1], true, rig),
    };
    models.set(m, r);
  }
  return r;
}

/** Joint directions of a pose: (left, right) upper arm / forearm and thigh / shin, foot pitch. */
export interface ScanPose {
  /** Torso turn about the pelvis. */
  lean: Matrix4;
  /** Head turn / pitch, applied after the torso's, and its size factor. */
  head: Matrix4;
  headScale: number;
  /** Shoulder / hip width factor. */
  broad: number;
  /** 0 = the hair as scanned, 1 = cropped at the ears. */
  crop: number;
  arm: [{ up: Vector3; low: Vector3 }, { up: Vector3; low: Vector3 }];
  leg: [
    { up: Vector3; low: Vector3; foot: number },
    { up: Vector3; low: Vector3; foot: number },
  ];
}

export interface ScanBody {
  geometry: BufferGeometry;
  /** Rest frame -> posed frame, per `BONE`. */
  bones: Matrix4[];
  /** Posed hand centres (left, right), shoulder line centre, head centre. */
  hands: Vector3[];
  S: Vector3;
  Hc: Vector3;
}

const ONE = new Vector3(1, 1, 1);

/** Turns `from` to `to` about `at` (rest point), as a matrix. */
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
  const sh = new Vector3(
    (rig.shoulder[0] + k) * side,
    rig.shoulder[1] - rig.hip,
    rig.shoulder[2],
  );
  // The arm joints of the A pose (`A_POSE`): the T pose's turned down about the shoulder.
  const arm = (p: [number, number, number]): Vector3 => {
    const d = new Vector3(
      p[0] - rig.shoulder[0],
      p[1] - rig.shoulder[1],
      p[2] - rig.shoulder[2],
    );
    const c = Math.cos(A_POSE);
    const s = Math.sin(A_POSE);
    return new Vector3(
      sh.x + side * (d.x * c + d.y * s),
      sh.y - d.x * s + d.y * c,
      sh.z + d.z,
    );
  };
  const leg = (p: [number, number, number]): Vector3 =>
    new Vector3(
      p[0] * broad * side,
      p[1] - rig.hip,
      p[2] * (1 + (broad - 1) * 0.6),
    );
  return {
    shoulder: sh,
    elbow: arm(rig.elbow),
    wrist: arm(rig.wrist),
    hip: leg(rig.hipJ),
    knee: leg(rig.kneeJ),
    ankle: leg(rig.ankleJ),
  };
}

/** Bone matrices of a pose. */
function pose(rig: Rig, p: ScanPose): { bones: Matrix4[]; hands: Vector3[] } {
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
  return { bones, hands };
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

/** Rest positions widened by `broad` (torso / legs / arm roots) and with the hair cropped by `crop`, into `out`. */
function shape(
  r: Rest,
  rig: Rig,
  broad: number,
  crop: number,
  out: Float32Array,
): void {
  const k = rig.shoulder[0] * (broad - 1);
  const [hx, , hz] = rig.head;
  for (let i = 0; i < r.n; i++) {
    const x = r.pos[i * 3];
    const z = r.pos[i * 3 + 2];
    const w = r.body[i];
    out[i * 3] = x * (1 + (broad - 1) * w) + Math.sign(x) * k * r.arm[i];
    out[i * 3 + 1] = r.pos[i * 3 + 1];
    out[i * 3 + 2] = z * (1 + (broad - 1) * 0.6 * w);
    if (crop > 0 && r.hair[i] > 100) {
      // Hair above the ears hugs the head a little closer; what hangs below them is drawn up and in.
      const y = r.pos[i * 3 + 1] + rig.hip;
      const low = smooth(rig.cut, rig.cut - 0.08, y);
      const f = 1 - crop * (0.06 + 0.17 * low);
      out[i * 3] = hx + (x - hx) * f;
      out[i * 3 + 2] = hz + (z - hz) * f;
      if (y < rig.cut)
        out[i * 3 + 1] = rig.cut - rig.hip + (y - rig.cut) * (1 - 0.9 * crop);
    }
  }
}

/** Linear blend skinning of positions (and normals) with the four weights per vertex. */
function skin(
  r: Rest,
  bones: Matrix4[],
  rest: Float32Array,
  pos: Float32Array,
  nor: Float32Array,
): void {
  const m = bones.map((b) => b.elements);
  for (let i = 0; i < r.n; i++) {
    const x = rest[i * 3];
    const y = rest[i * 3 + 1];
    const z = rest[i * 3 + 2];
    const nx = r.nor[i * 3];
    const ny = r.nor[i * 3 + 1];
    const nz = r.nor[i * 3 + 2];
    let px = 0;
    let py = 0;
    let pz = 0;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    for (let k = 0; k < 4; k++) {
      const w = r.weight[i * 4 + k];
      if (w <= 0) continue;
      const e = m[r.bone[i * 4 + k]];
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

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** The shader's dye (engine/people-scan-material.ts) on the vertex colours of the mid-range mesh. */
function dye(
  r: Rest,
  look: ScanLook,
  ref: number[],
  skinBase: number[],
): Float32Array {
  const out = new Float32Array(r.n * 3);
  const top = new Color(look.top ?? '#ffffff');
  const low = new Color(look.low ?? '#ffffff');
  const hair = new Color(look.hair ?? '#ffffff');
  const shoe = new Color(look.shoe ?? '#ffffff');
  const sleeve = new Color(look.sleeve ?? look.top ?? '#ffffff');
  const glove = new Color(look.glove ?? '#ffffff');
  const skin = look.skin ? new Color(look.skin) : null;
  const sleeveEnd = look.sleeveEnd ?? 0;
  const hem = look.hem ?? 0;
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const tone = (c: Color, lum: number, ref: number, k: number): number =>
    (k === 0 ? c.r : k === 1 ? c.g : c.b) *
    Math.min(1.7, Math.max(0.45, Math.pow(lum / Math.max(ref, 0.004), 0.6)));
  const c = [0, 0, 0];
  for (let i = 0; i < r.n; i++) {
    const tx = [0, 1, 2].map((k) => toLinear(r.col![i * 3 + k]));
    const lum = 0.2126 * tx[0] + 0.7152 * tx[1] + 0.0722 * tx[2];
    const m = [0, 1, 2, 3, 4, 5].map((k) => r.mask![i * 6 + k] / 255);
    const armW = r.zone[i * 3];
    const armT = r.zone[i * 3 + 1];
    const y = r.zone[i * 3 + 2];
    const sleeveCov =
      sleeveEnd > 0
        ? armW * (1 - smooth(sleeveEnd - 0.02, sleeveEnd + 0.02, armT))
        : 0;
    const glovesOn = look.glove ? armW * smooth(1, 1.05, armT) : 0;
    const legSkin =
      hem > 0
        ? (1 - smooth(hem - 0.02, hem + 0.02, y)) * smooth(0.1, 0.14, y)
        : 0;
    const refCloth = mix(ref[2], ref[0], m[0]);
    const topW = look.top
      ? Math.min(1, m[0] + m[5] * (1 - m[0]) * (1 - m[1]))
      : 0;
    for (let k = 0; k < 3; k++) {
      let v = tx[k];
      v = mix(v, tone(top, lum, refCloth, k), topW);
      v = mix(v, tone(low, lum, ref[1], k), look.low ? m[1] : 0);
      if (skin)
        v = mix(
          v,
          tx[k] *
            Math.min(
              2.5,
              (k === 0 ? skin.r : k === 1 ? skin.g : skin.b) / skinBase[k],
            ),
          m[2],
        );
      v = mix(v, tone(hair, lum, ref[3], k), look.hair ? m[3] : 0);
      v = mix(v, tone(shoe, lum, ref[4], k), look.shoe ? m[4] : 0);
      v = mix(v, tone(sleeve, lum, refCloth, k), sleeveCov);
      if (skin) v = mix(v, tone(skin, lum, ref[1], k), legSkin);
      v = mix(v, tone(glove, lum, ref[2], k), glovesOn);
      c[k] = v;
    }
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/**
 * The posed body of `m`: lod 0 = the full mesh (uv + zone for the dye shader), lod 1 = the mid-range mesh with the
 * look dyed into its vertex colours.
 */
export function skinScan(
  m: ScanModel,
  lod: number,
  p: ScanPose,
  look: ScanLook,
): ScanBody {
  const md = model(m);
  const r = lod === 0 ? md.full : md.mid;
  const rest = new Float32Array(r.n * 3);
  shape(r, md.rig, p.broad, p.crop, rest);
  const { bones, hands } = pose(md.rig, p);
  const pos = new Float32Array(r.n * 3);
  const nor = new Float32Array(r.n * 3);
  skin(r, bones, rest, pos, nor);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setIndex(r.index);
  if (lod === 0) {
    g.setAttribute('uv', r.uv!);
    g.setAttribute('zone', r.zoneAttr!);
  } else {
    const d = PEOPLE_SCAN[m];
    g.setAttribute(
      'color',
      new BufferAttribute(dye(r, look, d.refs, d.skinBase), 3),
    );
  }
  g.computeBoundingSphere();
  const hc = md.rig.head;
  const head = new Vector3(hc[0], hc[1] - md.rig.hip, hc[2]).applyMatrix4(
    bones[BONE.head],
  );
  return {
    geometry: g,
    bones,
    hands,
    S: new Vector3(0, md.rig.chest - md.rig.hip + 0.02, -0.03).applyMatrix4(
      p.lean,
    ),
    Hc: head,
  };
}

/** Rest-frame measures of a model for the things worn (hats, vests, packs). */
export function scanRig(m: ScanModel): {
  head: Vector3;
  headR: Vector3;
  eyeY: number;
  faceZ: number;
  neckR: number;
  waist: number;
  chest: number;
  neck: Vector3;
} {
  const rig = RIGS[m];
  return {
    head: new Vector3(rig.head[0], rig.head[1] - rig.hip, rig.head[2]),
    headR: new Vector3(...rig.headR),
    eyeY: rig.eye[0] - rig.hip,
    faceZ: rig.eye[1],
    neckR: rig.neckR,
    waist: rig.waist - rig.hip,
    chest: rig.chest - rig.hip,
    neck: new Vector3(0, rig.neck[0] - rig.hip, rig.neck[1]),
  };
}

/** Radial profile of the torso (rest frame): `r[k][a]` = radius at height `ys[k]` towards angle `a` (0 = +Z, turning to +X). */
interface Rings {
  ys: number[];
  cx: number[];
  cz: number[];
  r: Float32Array[];
}
const SEG = 16;

function rings(m: ScanModel): Rings {
  const md = model(m);
  if (md.rings) return md.rings;
  const r = md.full;
  const ys: number[] = [];
  const cx: number[] = [];
  const cz: number[] = [];
  const rad: Float32Array[] = [];
  const hip = md.rig.hip;
  for (let y = 0.02; y <= md.rig.chest - hip + 0.03; y += 0.03) {
    const pts: [number, number][] = [];
    for (let i = 0; i < r.n; i++) {
      const vy = r.pos[i * 3 + 1];
      if (Math.abs(vy - y) > 0.025 || r.arm[i] > 0.3 || r.body[i] < 0.9)
        continue;
      pts.push([r.pos[i * 3], r.pos[i * 3 + 2]]);
    }
    if (pts.length < 8) continue;
    let x0 = 1e9;
    let x1 = -1e9;
    let z0 = 1e9;
    let z1 = -1e9;
    for (const [x, z] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const x = (x0 + x1) / 2;
    const z = (z0 + z1) / 2;
    const prof = new Float32Array(SEG);
    for (const [px, pz] of pts) {
      const a = Math.atan2(px - x, pz - z);
      const k =
        Math.round(
          ((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / SEG),
        ) % SEG;
      prof[k] = Math.max(prof[k], Math.hypot(px - x, pz - z));
    }
    // Empty bins take their neighbours; one smoothing pass.
    const mean =
      prof.reduce((s, v) => s + v, 0) / prof.filter((v) => v > 0).length;
    const filled = prof.map((v) => (v > 0 ? v : mean));
    const sm = filled.map((v, k) =>
      Math.max(filled[(k + SEG - 1) % SEG], v, filled[(k + 1) % SEG]),
    );
    ys.push(y);
    cx.push(x);
    cz.push(z);
    rad.push(Float32Array.from(sm));
  }
  md.rings = { ys, cx, cz, r: rad };
  return md.rings;
}

/**
 * An open shell round the torso between heights `y0` and `y1` (pelvis frame), `off` outside the body: a vest, a
 * stripe, a belt. Rings follow the scan's own cross-sections.
 */
export function torsoShell(
  m: ScanModel,
  y0: number,
  y1: number,
  off: number,
  broad: number,
  rows = 4,
  /** How far the top edge drops at a ring angle (a neckline). */
  drop: (ang: number) => number = () => 0,
): BufferGeometry {
  const R = rings(m);
  const at = (y: number): { x: number; z: number; r: Float32Array } => {
    let k = 0;
    while (k < R.ys.length - 2 && R.ys[k + 1] < y) k++;
    const t = Math.min(1, Math.max(0, (y - R.ys[k]) / (R.ys[k + 1] - R.ys[k])));
    const mix = (a: number, b: number): number => a + (b - a) * t;
    return {
      x: mix(R.cx[k], R.cx[k + 1]),
      z: mix(R.cz[k], R.cz[k + 1]),
      r: R.r[k].map((v, a) => mix(v, R.r[k + 1][a])),
    };
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let a = 0; a < SEG; a++) {
      const ang = (a / SEG) * Math.PI * 2;
      const y = y0 + ((y1 - drop(ang) - y0) * row) / rows;
      const c = at(y);
      const rr = c.r[a] + off;
      const sx = 1 + (broad - 1);
      const sz = 1 + (broad - 1) * 0.6;
      pos.push(
        (c.x + Math.sin(ang) * rr) * sx,
        y,
        (c.z + Math.cos(ang) * rr) * sz,
      );
    }
  for (let row = 0; row < rows; row++)
    for (let a = 0; a < SEG; a++) {
      const b = (a + 1) % SEG;
      const i0 = row * SEG + a;
      const i1 = row * SEG + b;
      const j0 = (row + 1) * SEG + a;
      const j1 = (row + 1) * SEG + b;
      idx.push(i0, i1, j0, i1, j1, j0);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A flat strap `width` (rad of the ring) wide down the torso at the ring angle `ang` (0 = front, + towards +X), between
 * heights `y0` and `y1` (pelvis frame), `off` outside the body.
 */
export function torsoStrap(
  m: ScanModel,
  ang: number,
  width: number,
  y0: number,
  y1: number,
  off: number,
  broad: number,
): BufferGeometry {
  const R = rings(m);
  const rows = 5;
  const pos: number[] = [];
  const idx: number[] = [];
  const radius = (k: number, a: number): number => {
    const f = ((a / (Math.PI * 2)) * SEG + SEG) % SEG;
    const i = Math.floor(f);
    const t = f - i;
    return R.r[k][i] * (1 - t) + R.r[k][(i + 1) % SEG] * t;
  };
  for (let row = 0; row <= rows; row++) {
    const y = y0 + ((y1 - y0) * row) / rows;
    let k = 0;
    while (k < R.ys.length - 1 && R.ys[k + 1] < y) k++;
    for (const a of [ang - width / 2, ang + width / 2]) {
      const rr = radius(k, a) + off;
      pos.push(
        (R.cx[k] + Math.sin(a) * rr) * broad,
        y,
        (R.cz[k] + Math.cos(a) * rr) * (1 + (broad - 1) * 0.6),
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    const i = row * 2;
    idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Box round the hips and legs per height (rest frame, pelvis frame): the skirt has to clear what is under it. */
interface Hull {
  ys: number[];
  rx: number[];
  cz: number[];
  rz: number[];
}

function hull(m: ScanModel, pos: ArrayLike<number>): Hull {
  const r = model(m).full;
  const top = 0.3;
  const step = 0.04;
  const bins = Math.round(1.25 / step);
  const h: Hull = {
    ys: Array.from({ length: bins }, (_, k) => top - k * step),
    rx: new Array<number>(bins).fill(0),
    cz: new Array<number>(bins).fill(0),
    rz: new Array<number>(bins).fill(0),
  };
  const z0 = new Array<number>(bins).fill(1e9);
  const z1 = new Array<number>(bins).fill(-1e9);
  for (let i = 0; i < r.n; i++) {
    if (r.arm[i] > 0.3) continue;
    const y = pos[i * 3 + 1];
    const k0 = Math.ceil((top - y - 0.03) / step);
    const k1 = Math.floor((top - y + 0.03) / step);
    for (let k = Math.max(0, k0); k <= Math.min(bins - 1, k1); k++) {
      h.rx[k] = Math.max(h.rx[k], Math.abs(pos[i * 3]));
      z0[k] = Math.min(z0[k], pos[i * 3 + 2]);
      z1[k] = Math.max(z1[k], pos[i * 3 + 2]);
    }
  }
  for (let k = 0; k < bins; k++) {
    // A height nothing reaches (a bent leg) keeps the one above.
    if (z1[k] < z0[k]) {
      h.rx[k] = k ? h.rx[k - 1] : 0;
      h.cz[k] = k ? h.cz[k - 1] : 0;
      h.rz[k] = k ? h.rz[k - 1] : 0;
    } else {
      h.cz[k] = (z0[k] + z1[k]) / 2;
      h.rz[k] = (z1[k] - z0[k]) / 2;
    }
  }
  return h;
}

/**
 * A skirt / long coat from `top` down `len` metres (pelvis frame): a rounded box round the hips and legs as `posed`
 * (the posed body's positions; the baggy trousers of the woman included) that opens towards the hem by `flare` metres.
 */
export function skirtShell(
  m: ScanModel,
  top: number,
  len: number,
  flare: number,
  posed: ArrayLike<number>,
): BufferGeometry {
  const H = hull(m, posed);
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (y: number, a: number[]): number => {
    let k = 0;
    while (k < H.ys.length - 2 && H.ys[k + 1] > y) k++;
    const t = Math.min(1, Math.max(0, (H.ys[k] - y) / (H.ys[k] - H.ys[k + 1])));
    return a[k] + (a[k + 1] - a[k]) * t;
  };
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const y = top - len * t;
    // The widest the legs get over the skirt's reach: walking swings them through it.
    const rx = at(y, H.rx) + 0.02 + flare * t;
    const rz = at(y, H.rz) + 0.03 + (flare + 0.03) * t;
    const cz = at(y, H.cz);
    for (let a = 0; a < SEG; a++) {
      const ang = (a / SEG) * Math.PI * 2;
      const sx = Math.sin(ang);
      const sz = Math.cos(ang);
      // A rounded box (exponent 2.6): the hull's corners are filled.
      const e = 2 / 2.6;
      pos.push(
        Math.sign(sx) * Math.abs(sx) ** e * rx,
        y,
        cz + Math.sign(sz) * Math.abs(sz) ** e * rz,
      );
    }
  }
  for (let row = 0; row < rows; row++)
    for (let a = 0; a < SEG; a++) {
      const b = (a + 1) % SEG;
      const i0 = row * SEG + a;
      const i1 = row * SEG + b;
      const j0 = (row + 1) * SEG + a;
      const j1 = (row + 1) * SEG + b;
      // Rows go down: the winding is the other way round to the torso's.
      idx.push(i0, j0, i1, i1, j0, j1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cross-sections of the head (hair included) from the neck up: ellipses per height. */
interface Head {
  ys: number[];
  cx: number[];
  cz: number[];
  rx: number[];
  rz: number[];
  top: number;
}

function head(m: ScanModel): Head {
  const md = model(m);
  if (md.head) return md.head;
  const r = md.full;
  const lo = md.rig.neck[0] - md.rig.hip + 0.05;
  const h: Head = { ys: [], cx: [], cz: [], rx: [], rz: [], top: 0 };
  for (let i = 0; i < r.n; i++)
    if (r.pos[i * 3 + 1] > lo && Math.abs(r.pos[i * 3]) < 0.16)
      h.top = Math.max(h.top, r.pos[i * 3 + 1]);
  for (let y = lo; y <= h.top; y += 0.012) {
    let x0 = 1e9;
    let x1 = -1e9;
    let z0 = 1e9;
    let z1 = -1e9;
    for (let i = 0; i < r.n; i++) {
      const vy = r.pos[i * 3 + 1];
      if (Math.abs(vy - y) > 0.012 || Math.abs(r.pos[i * 3]) > 0.16) continue;
      x0 = Math.min(x0, r.pos[i * 3]);
      x1 = Math.max(x1, r.pos[i * 3]);
      z0 = Math.min(z0, r.pos[i * 3 + 2]);
      z1 = Math.max(z1, r.pos[i * 3 + 2]);
    }
    if (x1 < x0) continue;
    h.ys.push(y);
    h.cx.push((x0 + x1) / 2);
    h.cz.push((z0 + z1) / 2);
    h.rx.push((x1 - x0) / 2);
    h.rz.push((z1 - z0) / 2);
  }
  md.head = h;
  return h;
}

/**
 * A cap-shaped shell over the head from height `y0` (pelvis frame) to the crown, `grow` outside the hair: caps,
 * beanies, helmets, hoods. `open` leaves the front (the face) bare within that angle (rad) either side of +Z.
 */
export function headShell(
  m: ScanModel,
  y0: number,
  grow: number,
  seg = 14,
  open = 0,
  rows = 7,
  y1?: number,
): BufferGeometry {
  const h = head(m);
  const at = (y: number): number[] => {
    let k = 0;
    while (k < h.ys.length - 2 && h.ys[k + 1] < y) k++;
    const t = Math.min(1, Math.max(0, (y - h.ys[k]) / (h.ys[k + 1] - h.ys[k])));
    const mix = (a: number[]): number => a[k] + (a[k + 1] - a[k]) * t;
    return [mix(h.cx), mix(h.cz), mix(h.rx), mix(h.rz)];
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const top = h.top;
  const end = y1 ?? top;
  const ring = (y: number, k: number): void => {
    const [cx, cz, rx, rz] = at(Math.min(y, h.ys[h.ys.length - 1]));
    // Radii close towards the crown.
    const s = Math.sqrt(
      Math.max(0, 1 - Math.pow(Math.max(0, y - (top - 0.05)) / 0.06, 2)),
    );
    for (let a = 0; a < seg; a++) {
      const ang = (a / seg) * Math.PI * 2;
      pos.push(
        cx + Math.sin(ang) * (rx * s + grow),
        y + (k === rows && end >= top ? grow : 0),
        cz + Math.cos(ang) * (rz * s + grow),
      );
    }
  };
  for (let k = 0; k <= rows; k++) ring(y0 + ((end - y0) * k) / rows, k);
  for (let k = 0; k < rows; k++)
    for (let a = 0; a < seg; a++) {
      const b = (a + 1) % seg;
      const mid = (a + 0.5) / seg;
      const ang = Math.min(mid, 1 - mid) * Math.PI * 2;
      if (open && ang < open) continue;
      const i0 = k * seg + a;
      const i1 = k * seg + b;
      const j0 = (k + 1) * seg + a;
      const j1 = (k + 1) * seg + b;
      idx.push(i0, i1, j0, i1, j1, j0);
    }
  if (end >= top) {
    // The crown: a fan to the top centre.
    const [cx, cz] = at(top);
    pos.push(cx, top + grow, cz);
    for (let a = 0; a < seg; a++)
      idx.push(
        rows * seg + a,
        rows * seg + ((a + 1) % seg),
        pos.length / 3 - 1,
      );
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Depth of the torso (back / front z at chest height), for packs. */
export function torsoDepth(m: ScanModel): { back: number; front: number } {
  const R = rings(m);
  const k = R.ys.findIndex((y) => y > 0.3);
  const r = R.r[k];
  return {
    back: R.cz[k] - Math.max(r[SEG / 2], r[SEG / 2 + 1], r[SEG / 2 - 1]),
    front: R.cz[k] + Math.max(r[0], r[1], r[SEG - 1]),
  };
}
