import { Color, Euler, Matrix4, Vector3, type BufferGeometry } from 'three';
import {
  cone,
  ellipsoid,
  evalField,
  fixed,
  gridFor,
  makeField,
  polygonise,
  smoothstep,
  toGeometry,
  cl,
  type ClothFn,
  type Field,
  type Prim,
  type V3,
} from './people-sculpt';
import {
  BAG,
  cellUV,
  GLOVE,
  HAIR,
  HAT,
  HEAD,
  HIVIS,
  JACKET,
  JEANS,
  KNIT,
  REFLECT,
  SHOE,
  SKIN,
  SLEEVE,
  SOLE,
  TROUSERS,
} from './people-parts';
import {
  dirDown,
  FORE,
  HEAD_R,
  JEAN_COLORS,
  SHIN,
  THIGH,
  TORSO,
  UPPER,
  type Outfit,
  type Pose,
} from './people';

/** Garment ids of the field (what a point of the body is made of). */
const G = {
  skin: 0,
  torso: 1,
  sleeve: 2,
  leg: 3,
  vest: 4,
  skirt: 5,
  hair: 6,
  hat: 7,
  shoe: 8,
  sole: 9,
  glove: 10,
  collar: 11,
  band: 12,
  stripe: 13,
  beard: 14,
  dark: 15,
};

interface Garment {
  color: Color;
  cell: number;
}

/** How a primitive's points are mapped on its garment's atlas cell. */
const enum Fk {
  Limb,
  Torso,
  Head,
  Shoe,
  Planar,
}
interface Frame {
  kind: Fk;
  a: V3;
  b: V3;
  /** Texture rows of a limb frame (fv at a / at b). */
  fv: [number, number];
  /** Torso / head: centre and the three local axes (world space), head scale. */
  c: V3;
  ax: number[];
  sc: number;
}

const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Value noise in 3D, [0, 1]. */
function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(
      l(hash(i, j, k), hash(i + 1, j, k), ux),
      l(hash(i, j + 1, k), hash(i + 1, j + 1, k), ux),
      uy,
    ),
    l(
      l(hash(i, j, k + 1), hash(i + 1, j, k + 1), ux),
      l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), ux),
      uy,
    ),
    uz,
  );
}

export interface Built {
  geometry: BufferGeometry;
  hands: Vector3[];
  S: Vector3;
  R: Matrix4;
  Hc: Vector3;
}

/** The axes of a rotation as a row basis (world -> local for an orthonormal frame). */
function rows(m: Matrix4): number[] {
  const e = m.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}

/** Basis with Y along `axis`, Z as near to `fwd` as it gets. */
function axisBasis(axis: Vector3, fwd = v3(0, 0, 1)): number[] {
  const y = axis.clone().normalize();
  let z = fwd.clone().sub(y.clone().multiplyScalar(fwd.dot(y)));
  if (z.lengthSq() < 1e-4) z = v3(1, 0, 0);
  z.normalize();
  const x = y.clone().cross(z).normalize();
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
}

const arr = (v: Vector3): V3 => [v.x, v.y, v.z];

/**
 * The near figure as one sculpted skin: torso / limbs in one field, the head, hands and shoes in finer ones.
 * `lod` 0 = close up (fine grids, cloth folds in the normals), 1 = mid range (coarse grids).
 */
export function sculptBody(
  pose: Pose,
  o: Outfit,
  lod: number,
  parts: { rngSeed: number },
): Built {
  const fine = lod === 0;
  void parts;
  const broad = o.broad;
  const bust = broad < 0.95 ? 1.1 : 1;
  const R = new Matrix4().makeRotationFromEuler(
    new Euler(pose.lean ?? 0, 0, pose.sway ?? 0, 'ZXY'),
  );
  const rot = (x: number, y: number, z: number): Vector3 =>
    v3(x, y, z).applyMatrix4(R);
  const Rax = rows(R);
  const Rcols = [
    rot(1, 0, 0).toArray(),
    rot(0, 1, 0).toArray(),
    rot(0, 0, 1).toArray(),
  ].flat();
  void Rcols;
  // Torso local frame as a row basis: world -> local = R^T, whose rows are R's columns.
  const torsoRows = [
    ...rot(1, 0, 0).toArray(),
    ...rot(0, 1, 0).toArray(),
    ...rot(0, 0, 1).toArray(),
  ];
  void Rax;

  // --- garments -----------------------------------------------------------------------------------
  const denim = JEAN_COLORS.includes(o.legs);
  const jacketTorso = !(o.shortSleeves || o.vest || o.skirt);
  const bareLegs = o.shorts || o.legs === o.skin;
  const garments: Garment[] = [];
  const gar = (id: number, color: string, cell: number) => {
    garments[id] = { color: new Color(color), cell };
  };
  gar(G.skin, o.skin, SKIN);
  gar(G.torso, o.torso, jacketTorso ? JACKET : KNIT);
  gar(G.sleeve, o.sleeves ?? o.torso, o.shortSleeves ? KNIT : SLEEVE);
  gar(G.leg, o.legs, denim ? JEANS : TROUSERS);
  gar(G.vest, o.vest ?? o.torso, HIVIS);
  gar(G.skirt, o.skirt ?? o.legs, TROUSERS);
  gar(G.hair, o.hair, HAIR);
  gar(G.hat, o.hatColor, HAT);
  gar(G.shoe, o.shoes, SHOE);
  gar(G.sole, o.shoes === '#e6e6e6' ? '#8e8a82' : '#d8d3c6', SOLE);
  gar(G.glove, o.gloves ?? o.skin, o.gloves ? GLOVE : SKIN);
  gar(G.collar, o.collar ?? o.torso, o.collar ? KNIT : JACKET);
  gar(G.band, '#e6e8ea', REFLECT);
  gar(G.stripe, o.stripe ?? o.torso, KNIT);
  gar(G.beard, o.hair, HAIR);
  gar(G.dark, '#15171a', HAT);
  void BAG;

  // --- skeleton -----------------------------------------------------------------------------------
  const S = rot(0, TORSO, 0);
  const legs = [
    [1, pose.legL],
    [-1, pose.legR],
  ] as const;
  const arms = [
    [1, pose.armL],
    [-1, pose.armR],
  ] as const;

  const frames: Frame[] = [];
  const frame = (f: Partial<Frame> & { kind: Fk }): number => {
    frames.push({
      a: [0, 0, 0],
      b: [0, -1, 0],
      fv: [0, 1],
      c: [0, 0, 0],
      ax: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      sc: 1,
      ...f,
    });
    return frames.length - 1;
  };
  const torsoFrame = frame({ kind: Fk.Torso, ax: torsoRows });

  // Cloth: thickness + garment of the torso prims (the hem lies at `hem` in torso space).
  const hem = jacketTorso ? -0.125 : -0.07;
  const lowG = o.skirt ? G.skirt : bareLegs ? G.skin : G.leg;
  const lowT = bareLegs && !o.skirt ? 0 : 0.01;
  const torsoCloth: ClothFn = (x, y, z) => {
    const ty = torsoRows[3] * x + torsoRows[4] * y + torsoRows[5] * z;
    const tx = torsoRows[0] * x + torsoRows[1] * y + torsoRows[2] * z;
    void tx;
    if (ty < hem) {
      cl.g = lowG;
      cl.t = lowT;
      return;
    }
    const loose = o.vest ? 0.022 : jacketTorso ? 0.014 : 0.009;
    const droop = smoothstep(0.5, 0.0, ty);
    let t = loose * (0.65 + 0.5 * droop);
    // Waistband / hem rib.
    if (jacketTorso) t += 0.006 * smoothstep(hem + 0.18, hem, ty);
    // Eases to the trousers' thickness just above the hem, so the edge stays clean at any grid size.
    t = lowT + (t - lowT) * smoothstep(hem, hem + 0.03, ty);
    cl.g = o.vest ? G.vest : G.torso;
    cl.t = t;
    if (o.vest && o.bands) {
      const bandAt = (yy: number) => ty < yy && ty > yy - 0.045;
      if (bandAt(0.4) || bandAt(0.28)) {
        cl.g = G.band;
        cl.t = t + 0.002;
      }
    } else if (o.stripe && ty > 0.38 && ty < 0.46) cl.g = G.stripe;
  };

  const prims: Prim[] = [];
  const bodyCut: Field['cuts'] = [];
  const add = (p: Prim) => prims.push(p);
  const b = broad;
  // Torso masses.
  add(
    ellipsoid(
      arr(rot(0, 0.015, -0.005)),
      [0.165 * b, 0.115, 0.104],
      torsoRows,
      0.025,
      torsoFrame,
      torsoCloth,
    ),
  );
  add(
    ellipsoid(
      arr(rot(0, 0.2, 0)),
      [0.15 * b, 0.13, 0.094],
      torsoRows,
      0.03,
      torsoFrame,
      torsoCloth,
    ),
  );
  add(
    ellipsoid(
      arr(rot(0, 0.38, 0.01)),
      [0.168 * b, 0.15, 0.097 * bust],
      torsoRows,
      0.035,
      torsoFrame,
      torsoCloth,
    ),
  );
  add(
    ellipsoid(
      arr(rot(0, 0.495, 0)),
      [0.185 * b, 0.065, 0.08],
      torsoRows,
      0.03,
      torsoFrame,
      torsoCloth,
    ),
  );
  for (const side of [1, -1]) {
    // Trapezius: shoulder slope into the neck.
    add(
      cone(
        arr(rot(side * 0.17 * b, 0.505, 0)),
        arr(rot(side * 0.045, 0.585, -0.005)),
        0.042,
        0.036,
        0.04,
        torsoFrame,
        torsoCloth,
      ),
    );
    // Buttocks.
    add(
      ellipsoid(
        arr(rot(side * 0.07 * b, -0.025, -0.042)),
        [0.078, 0.09, 0.064],
        torsoRows,
        0.05,
        torsoFrame,
        torsoCloth,
      ),
    );
    if (bust > 1)
      add(
        ellipsoid(
          arr(rot(side * 0.052 * b, 0.415, 0.075)),
          [0.062, 0.062, 0.055],
          torsoRows,
          0.04,
          torsoFrame,
          torsoCloth,
        ),
      );
  }
  // Skirt / dress / coat hanging from the waist.
  if (o.skirt) {
    const len = o.skirtLen ?? 0.45;
    add(
      cone(
        arr(rot(0, 0.1, 0)),
        arr(rot(0, -len, 0)),
        0.2 * b,
        0.2 * b + len * 0.3,
        0.04,
        torsoFrame,
        fixed(G.skirt, 0.004),
      ),
    );
  }
  // Neck base + collar (the head grid carries the rest of the neck).
  add(
    cone(
      arr(rot(0, 0.55, 0)),
      arr(rot(0, 0.62, 0.005)),
      0.05,
      0.046,
      0.04,
      torsoFrame,
      jacketTorso || o.collar
        ? (x, y, z) => {
            const ty = torsoRows[3] * x + torsoRows[4] * y + torsoRows[5] * z;
            cl.g = G.collar;
            cl.t = 0.012 * smoothstep(0.64, 0.58, ty) + 0.004;
          }
        : fixed(G.skin, 0),
    ),
  );

  // Legs.
  const feet: { A: Vector3; side: number }[] = [];
  for (const [side, leg] of legs) {
    const H = v3(side * 0.095 * b, 0, 0);
    const K = H.clone().add(dirDown(leg.p, leg.ab, side).multiplyScalar(THIGH));
    const A = K.clone().add(
      dirDown(leg.p - leg.bend, leg.ab * 0.5, side).multiplyScalar(SHIN),
    );
    feet.push({ A, side });
    const thighF = frame({
      kind: Fk.Limb,
      a: arr(H),
      b: arr(K),
      fv: [0, 0.5],
    });
    const shinF = frame({
      kind: Fk.Limb,
      a: arr(K),
      b: arr(A),
      fv: [0.5, 1],
    });
    const hemEnd = o.shorts ? 0.62 : 1.1;
    const trouser = (t0: number): ClothFn => {
      return (x, y, z, s) => {
        // Above the hem the torso garment hangs over the thigh tops.
        const ty = torsoRows[3] * x + torsoRows[4] * y + torsoRows[5] * z;
        if (ty > hem) {
          torsoCloth(x, y, z, s);
          return;
        }
        if (bareLegs && !o.shorts) {
          cl.g = G.skin;
          cl.t = 0;
          return;
        }
        const cover = smoothstep(hemEnd + 0.02, hemEnd - 0.04, s);
        cl.g = cover > 0.5 ? G.leg : G.skin;
        cl.t = (t0 + (o.shorts ? 0.006 : 0)) * cover;
      };
    };
    const thighCloth = trouser(0.009);
    add(cone(arr(H), arr(K), 0.088, 0.058, 0.03, thighF, thighCloth));
    add(
      cone(arr(K), arr(A), 0.056, 0.038, 0.03, shinF, (x, y, z, s) => {
        const ty = torsoRows[3] * x + torsoRows[4] * y + torsoRows[5] * z;
        if (ty > hem) {
          torsoCloth(x, y, z, s);
          return;
        }
        cl.g = bareLegs ? G.skin : G.leg;
        cl.t = bareLegs ? 0 : 0.008;
      }),
    );
    // Calf.
    const shinAxis = A.clone().sub(K);
    const calf = K.clone()
      .add(shinAxis.clone().multiplyScalar(0.32))
      .add(v3(0, 0, -0.022));
    add(
      ellipsoid(
        arr(calf),
        [0.046, 0.12, 0.05],
        axisBasis(shinAxis),
        0.035,
        shinF,
        (x, y, z) => {
          void x;
          void y;
          void z;
          cl.g = bareLegs ? G.skin : G.leg;
          cl.t = bareLegs ? 0 : 0.008;
        },
      ),
    );
  }

  // Arms.
  const hands: Vector3[] = [];
  const handSpecs: { F: Vector3; fd: Vector3; side: number }[] = [];
  for (const [side, arm] of arms) {
    const J = S.clone().add(rot(side * 0.192 * b, -0.045, 0));
    const E = J.clone().add(dirDown(arm.p, arm.ab, side).multiplyScalar(UPPER));
    const fd = dirDown(arm.p + arm.bend, arm.ab2 ?? arm.ab, side);
    const F = E.clone().add(fd.clone().multiplyScalar(FORE));
    handSpecs.push({ F, fd, side });
    hands.push(F.clone().add(fd.clone().multiplyScalar(0.05)));
    const upF = frame({
      kind: Fk.Limb,
      a: arr(J),
      b: arr(E),
      fv: [0, 0.5],
    });
    const foreF = frame({
      kind: Fk.Limb,
      a: arr(E),
      b: arr(F),
      fv: [0.5, 1],
    });
    const short = !!o.shortSleeves;
    const sleeve = (upper: boolean): ClothFn => {
      return (x, y, z, s) => {
        void x;
        void y;
        void z;
        // Where the sleeve ends along the arm (shoulder = 0 in the upper arm, elbow = 0 in the forearm).
        const end = short ? (upper ? 0.5 : -1) : upper ? 2 : 0.98;
        const cover = smoothstep(end + 0.015, end - 0.03, s);
        const cuff = !short && !upper ? 0.004 * smoothstep(0.82, 0.95, s) : 0;
        cl.g = cover > 0.5 ? G.sleeve : G.skin;
        cl.t = (upper ? 0.009 : 0.007) * cover + cuff * cover;
      };
    };
    add(cone(arr(J), arr(E), 0.05, 0.043, 0.03, upF, sleeve(true)));
    add(cone(arr(E), arr(F), 0.043, 0.032, 0.03, foreF, sleeve(false)));
  }

  const bodyField = makeField(prims, bodyCut);
  bodyField.fold = (x, y, z, g) => {
    if (g === G.skin || g === G.sole || g === G.glove) return 0;
    const a = vnoise(x * 34, y * 34, z * 34);
    const c = vnoise(x * 78 + 9, y * 78, z * 78);
    const amp = g === G.leg ? 0.0035 : 0.003;
    return amp * (1 - Math.abs(2 * a - 1)) + 0.0012 * (1 - Math.abs(2 * c - 1));
  };

  // --- head ---------------------------------------------------------------------------------------
  const M = R.clone().multiply(
    new Matrix4().makeRotationFromEuler(
      new Euler(pose.head ?? 0, pose.turn ?? 0, 0, 'YXZ'),
    ),
  );
  const hs = o.headScale ?? 1;
  const Hc = S.clone().add(rot(0, 0.06 + HEAD_R * 0.95 * hs, 0.01));
  const hax = [
    ...v3(1, 0, 0).applyMatrix4(M).toArray(),
    ...v3(0, 1, 0).applyMatrix4(M).toArray(),
    ...v3(0, 0, 1).applyMatrix4(M).toArray(),
  ];
  const hp = (x: number, y: number, z: number): V3 =>
    arr(Hc.clone().add(v3(x * hs, y * hs, z * hs).applyMatrix4(M)));
  // Head-local coordinates (head units) of a world point.
  const hl = (x: number, y: number, z: number): V3 => {
    const dx = x - Hc.x;
    const dy = y - Hc.y;
    const dz = z - Hc.z;
    return [
      (hax[0] * dx + hax[1] * dy + hax[2] * dz) / hs,
      (hax[3] * dx + hax[4] * dy + hax[5] * dz) / hs,
      (hax[6] * dx + hax[7] * dy + hax[8] * dz) / hs,
    ];
  };
  const headFrame = frame({
    kind: Fk.Head,
    c: arr(Hc),
    ax: hax,
    sc: hs,
  });
  const hr = (x: number, y: number, z: number): V3 => [x * hs, y * hs, z * hs];
  const hairY = (a: number, front: number, side: number, back: number) =>
    a < 0.5
      ? front + (side - front) * (a / 0.5)
      : side + (back - side) * ((a - 0.5) / 0.5);
  const hat = o.hat;
  const hatLow = hat === 'cap' || hat === 'beanie' || hat === 'helmet';
  const headCloth: ClothFn = (x, y, z) => {
    const [lx, ly, lz] = hl(x, y, z);
    const a = Math.abs(Math.atan2(lx, lz)) / Math.PI;
    if (hat === 'cap' || hat === 'beanie' || hat === 'helmet') {
      const yh =
        hat === 'cap'
          ? hairY(a, 0.03, 0.005, -0.03)
          : hat === 'beanie'
            ? hairY(a, 0.012, -0.03, -0.04)
            : hairY(a, 0.0, -0.02, -0.07);
      if (ly > yh) {
        cl.g = G.hat;
        cl.t =
          (hat === 'helmet' ? 0.024 : 0.016) * smoothstep(yh, yh + 0.01, ly);
        return;
      }
    }
    if (hat === 'hood') {
      // Hood: handled by its own prim; the head under it stays skin / hair.
    }
    if (o.hairKind !== 'bald' && !(hat === 'hood')) {
      const yh = hairY(a, 0.05, -0.005, -0.075);
      if (ly > yh) {
        cl.g = G.hair;
        cl.t =
          (0.012 + 0.006 * smoothstep(0.0, 0.1, ly)) *
          smoothstep(yh, yh + 0.012, ly);
        return;
      }
    }
    if (
      o.beard &&
      ly < -0.045 &&
      lz > -0.02 &&
      !(ly > -0.088 && ly < -0.066 && Math.abs(lx) < 0.026 && lz > 0.07)
    ) {
      cl.g = G.beard;
      cl.t = 0.008 * smoothstep(-0.045, -0.06, ly);
      return;
    }
    cl.g = G.skin;
    cl.t = 0;
  };
  const skin = fixed(G.skin, 0);
  const hprims: Prim[] = [];
  const hadd = (p: Prim) => hprims.push(p);
  // Cranium, face, jaw, chin.
  hadd(
    ellipsoid(
      hp(0, 0.02, -0.005),
      hr(0.092, 0.112, 0.105),
      hax,
      0.03,
      headFrame,
      headCloth,
    ),
  );
  hadd(
    ellipsoid(
      hp(0, -0.045, 0.012),
      hr(0.08, 0.095, 0.088),
      hax,
      0.04,
      headFrame,
      headCloth,
    ),
  );
  hadd(
    ellipsoid(
      hp(0, -0.1, 0.04),
      hr(0.04, 0.036, 0.04),
      hax,
      0.03,
      headFrame,
      headCloth,
    ),
  );
  hadd(
    ellipsoid(
      hp(0, 0.027, 0.09),
      hr(0.07, 0.014, 0.026),
      hax,
      0.02,
      headFrame,
      skin,
    ),
  );
  for (const s of [1, -1]) {
    // Cheekbones, ears.
    hadd(
      ellipsoid(
        hp(s * 0.052, -0.022, 0.07),
        hr(0.03, 0.024, 0.028),
        hax,
        0.03,
        headFrame,
        skin,
      ),
    );
    hadd(
      ellipsoid(
        hp(s * 0.093, -0.006, -0.008),
        hr(0.009, 0.03, 0.02),
        hax,
        0.012,
        headFrame,
        skin,
      ),
    );
    hadd(
      ellipsoid(
        hp(s * 0.016, -0.044, 0.108),
        hr(0.012, 0.012, 0.012),
        hax,
        0.012,
        headFrame,
        skin,
      ),
    );
  }
  // Nose, lips.
  hadd(
    cone(
      hp(0, 0.012, 0.098),
      hp(0, -0.036, 0.121),
      0.0105 * hs,
      0.0155 * hs,
      0.015,
      headFrame,
      skin,
    ),
  );
  hadd(
    ellipsoid(
      hp(0, -0.076, 0.089),
      hr(0.026, 0.009, 0.014),
      hax,
      0.012,
      headFrame,
      skin,
    ),
  );
  // Neck.
  hadd(
    cone(
      hp(0, -0.1, -0.005),
      hp(0, -0.215, 0.0),
      0.052 * hs,
      0.054 * hs,
      0.03,
      headFrame,
      skin,
    ),
  );
  // Hair volume behind the head.
  if (!hatLow && hat !== 'hood' && o.hairKind !== 'bald') {
    const hairBack = (x: number, y: number, z: number): V3 => hp(x, y, z);
    if (o.hairKind === 'long')
      hadd(
        ellipsoid(
          hairBack(0, -0.07, -0.07),
          hr(0.098, 0.15, 0.056),
          hax,
          0.04,
          headFrame,
          fixed(G.hair, 0),
        ),
      );
    else if (o.hairKind === 'pony')
      hadd(
        cone(
          hairBack(0, 0.05, -0.1),
          hairBack(0, -0.19, -0.14),
          0.03 * hs,
          0.018 * hs,
          0.02,
          headFrame,
          fixed(G.hair, 0),
        ),
      );
    else if (o.hairKind === 'bun')
      hadd(
        ellipsoid(
          hairBack(0, 0.09, -0.1),
          hr(0.045, 0.045, 0.045),
          hax,
          0.02,
          headFrame,
          fixed(G.hair, 0),
        ),
      );
  } else if (hat === 'cap' && o.hairKind === 'long')
    hadd(
      ellipsoid(
        hp(0, -0.07, -0.075),
        hr(0.065, 0.13, 0.04),
        hax,
        0.04,
        headFrame,
        fixed(G.hair, 0),
      ),
    );
  if (hat === 'cap')
    hadd(
      ellipsoid(
        hp(0, 0.03, 0.128),
        hr(0.088, 0.007, 0.068),
        hax,
        0.01,
        headFrame,
        fixed(G.hat, 0),
      ),
    );
  if (hat === 'hood')
    hadd(
      ellipsoid(
        hp(0, -0.01, -0.03),
        hr(0.13, 0.15, 0.135),
        hax,
        0.05,
        headFrame,
        fixed(G.hat, 0.0),
      ),
    );
  if (o.glasses)
    hadd(
      ellipsoid(
        hp(0, 0.015, 0.098),
        hr(0.085, 0.017, 0.012),
        hax,
        0.01,
        headFrame,
        fixed(G.dark, 0),
      ),
    );
  const headCuts: Field['cuts'] = [];
  for (const s of [1, -1])
    headCuts.push({
      p: ellipsoid(
        hp(s * 0.034, 0.012, 0.104),
        hr(0.017, 0.012, 0.014),
        hax,
        0.01,
        headFrame,
        skin,
      ),
      k: 0.006,
    });
  if (hat === 'hood')
    headCuts.push({
      p: ellipsoid(
        hp(0, -0.025, 0.17),
        hr(0.078, 0.1, 0.1),
        hax,
        0.01,
        headFrame,
        skin,
      ),
      k: 0.02,
    });
  const headField = makeField(hprims, headCuts);
  headField.fold = (x, y, z, g) => {
    if (g === G.hair) return 0.002 * vnoise(x * 120, y * 40, z * 120);
    if (g === G.hat) return 0.0015 * vnoise(x * 60, y * 60, z * 60);
    return 0;
  };

  // --- hands --------------------------------------------------------------------------------------
  const handFields: Field[] = [];
  for (const { F, fd, side } of handSpecs) {
    const d = fd.clone().normalize();
    // Thumb towards the front, palm towards the body.
    const t0 = v3(0.0, 0, 1)
      .multiplyScalar(0.8)
      .add(v3(-side * 0.35, 0, 0));
    const tdir = t0.sub(d.clone().multiplyScalar(t0.dot(d))).normalize();
    const across = d.clone().cross(tdir).normalize();
    const palmN = tdir.clone().cross(d).normalize();
    // Make the palm normal point inwards (towards the body centre line).
    if (palmN.x * -side < 0) palmN.negate();
    const hf = frame({ kind: Fk.Planar });
    const cloth = fixed(o.gloves ? G.glove : G.skin, o.gloves ? 0.004 : 0);
    const hpz: Prim[] = [];
    const at = (u: number, w: number, n: number) =>
      F.clone()
        .add(d.clone().multiplyScalar(u))
        .add(across.clone().multiplyScalar(w))
        .add(palmN.clone().multiplyScalar(n));
    // Wrist and palm.
    hpz.push(
      cone(
        arr(at(-0.02, 0, 0)),
        arr(at(0.03, 0, 0)),
        0.036,
        0.04,
        0.02,
        hf,
        cloth,
      ),
    );
    hpz.push(
      ellipsoid(
        arr(at(fine ? 0.06 : 0.09, 0, 0)),
        [0.04, fine ? 0.05 : 0.085, 0.02],
        axisBasisHand(d, across, palmN),
        0.02,
        hf,
        cloth,
      ),
    );
    // Four fingers, slightly curled towards the palm.
    const lens = [0.07, 0.078, 0.073, 0.058];
    // Mid range: a mitten (fingers are thinner than its grid).
    for (let i = 0; i < (fine ? 4 : 0); i++) {
      const w = (i - 1.5) * 0.0215 * (side > 0 ? -1 : -1);
      const L = lens[i];
      const base = at(0.1, w, 0.002);
      const mid = at(0.1 + L * 0.55, w, 0.014);
      const tip = at(0.1 + L * 0.85, w, 0.03);
      hpz.push(cone(arr(base), arr(mid), 0.0112, 0.0104, 0.008, hf, cloth));
      hpz.push(cone(arr(mid), arr(tip), 0.0104, 0.0092, 0.006, hf, cloth));
    }
    // Thumb.
    const tb = at(0.035, 0.036, 0.004);
    const tm = at(0.075, 0.049, 0.012);
    const tt = at(0.105, 0.052, 0.02);
    hpz.push(cone(arr(tb), arr(tm), 0.0155, 0.0125, 0.01, hf, cloth));
    hpz.push(cone(arr(tm), arr(tt), 0.0125, 0.0105, 0.006, hf, cloth));
    handFields.push(makeField(hpz));
  }

  // --- shoes --------------------------------------------------------------------------------------
  const shoeFields: { f: Field; at: Vector3 }[] = [];
  for (const { A } of feet) {
    const at = A.clone().add(v3(0, -0.04, 0.045));
    const sf = frame({ kind: Fk.Shoe, c: arr(at) });
    const sp: Prim[] = [];
    const c = (x: number, y: number, z: number): V3 => [
      at.x + x,
      at.y + y,
      at.z + z,
    ];
    const sh = fixed(G.shoe, 0);
    // Boot: heel + ankle shaft, instep, toe cap, and a flat lugged sole.
    sp.push(
      ellipsoid(c(0, 0.03, -0.065), [0.046, 0.07, 0.052], null, 0.03, sf, sh),
    );
    sp.push(
      cone(c(0, 0.03, -0.062), c(0, 0.12, -0.052), 0.047, 0.046, 0.03, sf, sh),
    );
    sp.push(
      ellipsoid(c(0, -0.005, 0.03), [0.05, 0.04, 0.085], null, 0.03, sf, sh),
    );
    sp.push(
      ellipsoid(c(0, -0.016, 0.105), [0.047, 0.03, 0.06], null, 0.025, sf, sh),
    );
    sp.push(
      ellipsoid(
        c(0, -0.05, 0.015),
        [0.056, 0.016, 0.148],
        null,
        0.008,
        sf,
        fixed(G.sole, 0),
      ),
    );
    sp.push(
      ellipsoid(
        c(0, -0.045, -0.09),
        [0.05, 0.02, 0.05],
        null,
        0.008,
        sf,
        fixed(G.sole, 0),
      ),
    );
    shoeFields.push({ f: makeField(sp), at });
  }

  // --- polygonise everything ----------------------------------------------------------------------
  const hBody = fine ? 0.04 : 0.08;
  const hHead = fine ? 0.018 : 0.04;
  const hHand = fine ? 0.011 : 0.026;
  const hFoot = fine ? 0.02 : 0.04;
  const out: Parameters<typeof toGeometry>[0] = [];

  const emit = (f: Field, h: number, pad: number, detail: boolean) => {
    const { min, n } = gridFor(f.prims, h, pad);
    const mesh = polygonise(f, min, n, h, detail);
    const tc = mesh.idx.length / 3;
    const vc = tc * 3;
    const pos = new Float32Array(vc * 3);
    const nor = new Float32Array(vc * 3);
    const col = new Float32Array(vc * 3);
    const uv = new Float32Array(vc * 2);
    const tg = new Uint8Array(tc);
    // Planar mapping boxes per garment (normalised over the part, like the old mapCell).
    const lo = new Map<number, V3>();
    const hi = new Map<number, V3>();
    const planarC: boolean[] = [];
    for (let t = 0; t < tc; t++) {
      const i0 = mesh.idx[t * 3];
      let i1 = mesh.idx[t * 3 + 1];
      let i2 = mesh.idx[t * 3 + 2];
      // Edge splits and the projection onto the surface can turn a triangle over: wind it to its normals.
      {
        const P = mesh.pos;
        const N = mesh.nor;
        const ax = P[i1 * 3] - P[i0 * 3];
        const ay = P[i1 * 3 + 1] - P[i0 * 3 + 1];
        const az = P[i1 * 3 + 2] - P[i0 * 3 + 2];
        const bx = P[i2 * 3] - P[i0 * 3];
        const by = P[i2 * 3 + 1] - P[i0 * 3 + 1];
        const bz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
        const d =
          (ay * bz - az * by) * (N[i0 * 3] + N[i1 * 3] + N[i2 * 3]) +
          (az * bx - ax * bz) *
            (N[i0 * 3 + 1] + N[i1 * 3 + 1] + N[i2 * 3 + 1]) +
          (ax * by - ay * bx) * (N[i0 * 3 + 2] + N[i1 * 3 + 2] + N[i2 * 3 + 2]);
        if (d < 0) {
          const tmp = i1;
          i1 = i2;
          i2 = tmp;
          mesh.idx[t * 3 + 1] = i1;
          mesh.idx[t * 3 + 2] = i2;
        }
      }
      const g0 = mesh.gar[i0];
      const g1 = mesh.gar[i1];
      const g2 = mesh.gar[i2];
      // One garment per triangle: its corners' when they agree, else the garment at its centre.
      let g = g0;
      if (!(g0 === g1 && g1 === g2)) {
        evalField(
          f,
          (mesh.pos[i0 * 3] + mesh.pos[i1 * 3] + mesh.pos[i2 * 3]) / 3,
          (mesh.pos[i0 * 3 + 1] + mesh.pos[i1 * 3 + 1] + mesh.pos[i2 * 3 + 1]) /
            3,
          (mesh.pos[i0 * 3 + 2] + mesh.pos[i1 * 3 + 2] + mesh.pos[i2 * 3 + 2]) /
            3,
        );
        g = cl.g;
      }
      tg[t] = g;
      const gm = garments[g] ?? garments[0];
      const us: number[] = [];
      for (let c = 0; c < 3; c++) {
        const i = mesh.idx[t * 3 + c];
        const o = t * 3 + c;
        const px = mesh.pos[i * 3];
        const py = mesh.pos[i * 3 + 1];
        const pz = mesh.pos[i * 3 + 2];
        pos[o * 3] = px;
        pos[o * 3 + 1] = py;
        pos[o * 3 + 2] = pz;
        nor[o * 3] = mesh.nor[i * 3];
        nor[o * 3 + 1] = mesh.nor[i * 3 + 1];
        nor[o * 3 + 2] = mesh.nor[i * 3 + 2];
        const ao = 0.62 + 0.38 * mesh.ao[i];
        col[o * 3] = gm.color.r * ao;
        col[o * 3 + 1] = gm.color.g * ao;
        col[o * 3 + 2] = gm.color.b * ao;
        const fr = frames[f.prims[mesh.own[i]].frame];
        let fu = 0;
        let fvv = 0;
        let wc = 1;
        let cell = gm.cell;
        let planar = false;
        if (fr.kind === Fk.Limb) {
          const dx = fr.b[0] - fr.a[0];
          const dy = fr.b[1] - fr.a[1];
          const dz = fr.b[2] - fr.a[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          const ax = [dx / l, dy / l, dz / l];
          // Forward reference +Z made perpendicular to the axis.
          let fx = 0 - ax[2] * ax[0];
          let fy = 0 - ax[2] * ax[1];
          let fz = 1 - ax[2] * ax[2];
          const fl = Math.hypot(fx, fy, fz);
          if (fl < 1e-3) {
            fx = 1;
            fy = 0;
            fz = 0;
          } else {
            fx /= fl;
            fy /= fl;
            fz /= fl;
          }
          const xx = ax[1] * fz - ax[2] * fy;
          const xy = ax[2] * fx - ax[0] * fz;
          const xz = ax[0] * fy - ax[1] * fx;
          const rx = px - fr.a[0];
          const ry = py - fr.a[1];
          const rz = pz - fr.a[2];
          const lx = rx * xx + ry * xy + rz * xz;
          const lz = rx * fx + ry * fy + rz * fz;
          fu = 0.5 + Math.atan2(lx, lz) / (Math.PI * 2);
          const s = Math.min(
            1,
            Math.max(0, (rx * ax[0] + ry * ax[1] + rz * ax[2]) / l),
          );
          fvv = fr.fv[0] + (fr.fv[1] - fr.fv[0]) * s;
        } else if (fr.kind === Fk.Torso) {
          const rx = px - fr.c[0];
          const ry = py - fr.c[1];
          const rz = pz - fr.c[2];
          const a = fr.ax;
          const lx = a[0] * rx + a[1] * ry + a[2] * rz;
          const ly = a[3] * rx + a[4] * ry + a[5] * rz;
          const lz = a[6] * rx + a[7] * ry + a[8] * rz;
          fu = 0.5 + Math.atan2(lx, lz) / (Math.PI * 2);
          fvv = Math.min(1, Math.max(0, (0.585 - ly) / 0.695));
        } else if (fr.kind === Fk.Head && g === G.skin) {
          const [lx, ly, lz] = hl(px, py, pz);
          fu = 0.5 + Math.atan2(lx, lz) / (Math.PI * 2);
          fvv = Math.min(1, Math.max(0, 0.5 - ly / 0.275));
          cell = HEAD;
          wc = 2;
        } else if (fr.kind === Fk.Shoe) {
          const rx = px - fr.c[0];
          const ry = py - fr.c[1];
          const rz = pz - fr.c[2];
          const tt = Math.min(1, Math.max(0, rz / 0.27 + 0.5));
          const ny = mesh.nor[i * 3 + 1];
          fu = tt;
          fvv = ny > 0.5 ? 0.15 + 0.3 * (rx / 0.105 + 0.5) : 0.5 - ry / 0.085;
          fvv = Math.min(1, Math.max(0, fvv));
        } else planar = true;
        if (planar || (fr.kind === Fk.Head && g !== G.skin)) {
          const l0 = lo.get(g) ?? [1e9, 1e9, 1e9];
          const h0 = hi.get(g) ?? [-1e9, -1e9, -1e9];
          l0[0] = Math.min(l0[0], px);
          l0[1] = Math.min(l0[1], py);
          l0[2] = Math.min(l0[2], pz);
          h0[0] = Math.max(h0[0], px);
          h0[1] = Math.max(h0[1], py);
          h0[2] = Math.max(h0[2], pz);
          lo.set(g, l0);
          hi.set(g, h0);
          planarC[o] = true;
          continue;
        }
        us.push(fu);
        uv[o * 2] = fu;
        uv[o * 2 + 1] = fvv;
        // Cell + width are applied once the seam is fixed below.
        void cell;
        void wc;
      }
      // A triangle across the back seam of an angular map takes the high side for the whole triangle.
      const wrap = us.length === 3 && Math.max(...us) - Math.min(...us) > 0.5;
      for (let c = 0; c < 3; c++) {
        const o = t * 3 + c;
        if (planarC[o]) continue;
        const i = mesh.idx[t * 3 + c];
        const fr = frames[f.prims[mesh.own[i]].frame];
        const isFace = fr.kind === Fk.Head && g === G.skin;
        let fu = uv[o * 2];
        if (wrap && fu < 0.5) fu = 1;
        const [cu, cv] = cellUV(
          isFace ? HEAD : gm.cell,
          fu,
          uv[o * 2 + 1],
          isFace ? 2 : 1,
        );
        uv[o * 2] = cu;
        uv[o * 2 + 1] = cv;
      }
    }
    if (!detail) {
      // Mid range: crisp flat facets (a low-poly look) instead of smooth shading.
      for (let t = 0; t < tc; t++) {
        const b = t * 9;
        const ax = pos[b + 3] - pos[b];
        const ay = pos[b + 4] - pos[b + 1];
        const az = pos[b + 5] - pos[b + 2];
        const bx = pos[b + 6] - pos[b];
        const by = pos[b + 7] - pos[b + 1];
        const bz = pos[b + 8] - pos[b + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        for (let c = 0; c < 3; c++) {
          nor[b + c * 3] = nx;
          nor[b + c * 3 + 1] = ny;
          nor[b + c * 3 + 2] = nz;
        }
      }
    }
    for (let o = 0; o < vc; o++) {
      if (!planarC[o]) continue;
      const g = tg[Math.floor(o / 3)];
      const l0 = lo.get(g)!;
      const h0 = hi.get(g)!;
      const size = Math.max(h0[0] - l0[0], h0[1] - l0[1], h0[2] - l0[2], 1e-3);
      const x = (pos[o * 3] - l0[0]) / size;
      const y = (pos[o * 3 + 1] - l0[1]) / size;
      const z = (pos[o * 3 + 2] - l0[2]) / size;
      // The triangle's dominant axis (from its face normal), so a triangle maps in one plane.
      const t3 = Math.floor(o / 3) * 3;
      const nx = Math.abs(nor[t3 * 3] + nor[(t3 + 1) * 3] + nor[(t3 + 2) * 3]);
      const ny = Math.abs(
        nor[t3 * 3 + 1] + nor[(t3 + 1) * 3 + 1] + nor[(t3 + 2) * 3 + 1],
      );
      const nz = Math.abs(
        nor[t3 * 3 + 2] + nor[(t3 + 1) * 3 + 2] + nor[(t3 + 2) * 3 + 2],
      );
      const [fu, fvv] =
        nz >= nx && nz >= ny ? [x, 1 - y] : nx >= ny ? [z, 1 - y] : [x, z];
      const gm = garments[g] ?? garments[0];
      const [cu, cv] = cellUV(gm.cell, Math.min(1, fu), Math.min(1, fvv));
      uv[o * 2] = cu;
      uv[o * 2 + 1] = cv;
    }
    out.push({
      pos,
      nor,
      col,
      uv,
      idx: Uint32Array.from({ length: vc }, (_, i) => i),
    });
  };

  emit(bodyField, hBody, 0.09, fine);
  emit(headField, hHead, 0.07, fine);
  for (const hf of handFields) emit(hf, hHand, 0.04, fine);
  for (const s of shoeFields) emit(s.f, hFoot, 0.05, fine);
  void evalField;

  const geometry = toGeometry(out);
  return { geometry, hands, S, R, Hc };
}

function axisBasisHand(d: Vector3, across: Vector3, n: Vector3): number[] {
  // Local x = across, y = along the hand, z = palm normal.
  return [across.x, across.y, across.z, d.x, d.y, d.z, n.x, n.y, n.z];
}
