import {
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROUGH } from './materials';
import { bbox, merge, part, strut } from './parts';

export { buildCritter, type CritterModel } from './critters';

/** Gear, TNT and pickups built from primitives (the critters themselves: `critters.ts`). Local space as the critters. */
const ball = (r: number) => new SphereGeometry(r, 12, 8);
const rbox = (w: number, h: number, d: number, r: number) =>
  new RoundedBoxGeometry(w, h, d, 2, r);

/**
 * Gear parts that keep their own paint instead of the team colour (reflective stripes, the hat's inner band): `aPlain`
 * = 1 on them, 0 elsewhere; `characters.ts` mixes the instance colour out where it is 1.
 */
const plainParts = new WeakSet<BufferGeometry>();
const plain = (g: BufferGeometry): BufferGeometry => {
  plainParts.add(g);
  return g;
};
function mergeGear(parts: BufferGeometry[]): BufferGeometry {
  for (const g of parts) {
    const n = g.getAttribute('position').count;
    g.setAttribute(
      'aPlain',
      new Float32BufferAttribute(
        new Float32Array(n).fill(plainParts.has(g) ? 1 : 0),
        1,
      ),
    );
  }
  return merge(parts);
}

/** An arc of tube (a strap, a rib, a hem): torus arc of `arc` radians centred on +y, in the xy plane. */
function arch(
  radius: number,
  tube: number,
  arc: number,
  seg = 18,
): BufferGeometry {
  return new TorusGeometry(radius, tube, 5, seg, arc).rotateZ(
    Math.PI / 2 - arc / 2,
  );
}

/**
 * Hard hat: a smooth dome with three crown ribs, a brim that curves down to a rolled edge and runs out into a front
 * peak, and the dark suspension band underneath. White paint = tinted by the team colour per instance.
 */
export function hatGeometry(): BufferGeometry {
  // brim profile (radius, height), lathed round: flat at the dome, curving down to a rolled lip
  const brim = [
    [0.17, 0.012],
    [0.205, 0.008],
    [0.235, -0.002],
    [0.258, -0.016],
    [0.268, -0.03],
    [0.262, -0.04],
    [0.25, -0.034],
    [0.225, -0.02],
    [0.19, -0.012],
    [0.17, -0.008],
  ].map(([r, y]) => new Vector2(r, y));
  const parts: BufferGeometry[] = [
    part(
      new SphereGeometry(0.205, 28, 9, 0, Math.PI * 2, 0, Math.PI / 2),
      0xffffff,
      { sy: 0.86, tint: 0.02 },
    ),
    // the brim, stretched forward into a peak
    part(new LatheGeometry(brim, 30), 0xf2f2f2, {
      sz: 1.2,
      z: 0.03,
      tint: 0,
    }),
    // crown ribs: one over the middle, a lower one each side
    part(arch(0.2, 0.018, Math.PI * 0.9).rotateY(Math.PI / 2), 0xe2e2e2, {
      sy: 0.86,
      tint: 0,
    }),
  ];
  for (const s of [-1, 1])
    parts.push(
      part(arch(0.19, 0.011, Math.PI * 0.8).rotateY(Math.PI / 2), 0xe8e8e8, {
        x: s * 0.07,
        sy: 0.8,
        tint: 0,
      }),
    );
  parts.push(
    plain(
      part(
        new TorusGeometry(0.19, 0.012, 4, 28).rotateX(Math.PI / 2),
        0x3a3633,
        {
          y: -0.004,
          tint: 0,
        },
      ),
    ),
  );
  return mergeGear(parts);
}

/**
 * Hi-vis vest: a shaped shell round the torso, open at the front (the belly fur shows), shoulder straps, a hem, two
 * pockets and two silver reflective stripes. Team colour per instance, the stripes stay silver. It sits on the fur.
 */
export function vestGeometry(): BufferGeometry {
  // the shell: a band of sphere round the torso (centre y 0.36), with a gap of OPEN radians at the front (+z)
  const OPEN = 0.62;
  const R = 0.352;
  const top = 0.92;
  const bottom = 1.96;
  const phi0 = Math.PI / 2 + OPEN / 2;
  const phiLen = Math.PI * 2 - OPEN;
  const band = (t0: number, t1: number, r: number) =>
    new SphereGeometry(r, 30, 4, phi0, phiLen, t0, t1 - t0);
  const yAt = (t: number, r = R) => 0.36 + Math.cos(t) * r * 1.05;
  const parts: BufferGeometry[] = [
    part(band(top, bottom, R), 0xffffff, {
      y: 0.36,
      sy: 1.05,
      sz: 0.97,
      tint: 0,
    }),
  ];
  // reflective stripes: thin bands a hair outside the shell
  for (const t of [1.33, 1.7])
    parts.push(
      plain(
        part(band(t - 0.055, t + 0.055, R + 0.004), 0xd9dde3, {
          y: 0.36,
          sy: 1.05,
          sz: 0.97,
          tint: 0,
        }),
      ),
    );
  // hems along the bottom and the top edge, piping down both sides of the opening
  for (const t of [bottom, top])
    parts.push(
      part(
        new TorusGeometry(Math.sin(t) * R, 0.012, 4, 32, phiLen)
          .rotateX(Math.PI / 2)
          .rotateY(phi0 + phiLen - Math.PI),
        0xeeeeee,
        { y: yAt(t), sz: 0.97, tint: 0 },
      ),
    );
  for (const phi of [phi0, phi0 + phiLen])
    parts.push(
      part(
        new TorusGeometry(R, 0.012, 4, 10, bottom - top)
          .rotateZ(Math.PI / 2 - bottom)
          .rotateY(Math.PI + phi),
        0xeeeeee,
        { y: 0.36, sy: 1.05, sz: 0.97, tint: 0 },
      ),
    );
  // shoulder straps from the front edge over the shoulder to the back
  for (const s of [-1, 1])
    parts.push(
      part(arch(0.3, 0.024, Math.PI * 0.62).rotateY(Math.PI / 2), 0xf4f4f4, {
        x: s * 0.13,
        y: 0.41,
        sx: 1.9,
        tint: 0,
      }),
    );
  // patch pockets either side of the opening
  for (const s of [-1, 1])
    parts.push(
      part(rbox(0.1, 0.08, 0.02, 0.008), 0xeaeaea, {
        x: s * 0.17,
        y: 0.31,
        z: 0.3,
        ry: s * 0.5,
        tint: 0,
      }),
    );
  return mergeGear(parts);
}

/**
 * Fan shirt (the crowd's sprites): a closed single-colour T-shirt with short sleeves, built on the vest's torso (`VEST_CY`
 * 0.36, radius 0.352) so the same per-critter fit applies. No stripes, hems or straps.
 */
export function fanShirtGeometry(): BufferGeometry {
  const R = 0.352;
  const top = 0.9;
  const bottom = 2.0;
  const parts: BufferGeometry[] = [
    part(
      new SphereGeometry(R, 30, 5, 0, Math.PI * 2, top, bottom - top),
      0xffffff,
      { y: 0.36, sy: 1.05, sz: 0.97, tint: 0 },
    ),
  ];
  // sleeves: short tapered tubes from the shoulder out and down, capped by a rounded shoulder
  for (const s of [-1, 1]) {
    const tilt = s * 0.95;
    const sleeve = new CylinderGeometry(0.1, 0.125, 0.2, 14, 1, true).rotateZ(
      tilt,
    );
    const cap = new SphereGeometry(0.1, 12, 8)
      .translate(0, 0.1, 0)
      .rotateZ(tilt);
    for (const g of [sleeve, cap])
      parts.push(part(g, 0xffffff, { x: s * 0.31, y: 0.46, tint: 0 }));
  }
  return mergeGear(parts);
}

/** One foot (instanced twice per player, coloured per critter): a rounded paw with three toes. */
export function footGeometry(): BufferGeometry {
  const p = [
    part(new SphereGeometry(0.09, 14, 9), 0xffffff, {
      y: 0.045,
      z: 0.02,
      sy: 0.55,
      sz: 1.3,
      tint: 0.03,
    }),
  ];
  for (const k of [-1, 0, 1])
    p.push(
      part(new SphereGeometry(0.034, 10, 7), 0xf2f2f2, {
        x: k * 0.048,
        y: 0.032,
        z: 0.125 - Math.abs(k) * 0.015,
        sy: 0.8,
        tint: 0,
      }),
    );
  return mergeGear(p);
}

/**
 * Where a part samples the stick texture when it only wants its vertex colour: the plain white strip at its right
 * edge (`stickPaperTexture` in `tnt.ts`).
 */
const PLAIN_U = 0.99;
/** The paper side of a stick samples u = 0 ... PAPER_U of the stick texture (well clear of the plain strip at 0.97, mipmaps included). */
const PAPER_U = 0.9;
function plainUV<T extends BufferGeometry>(g: T): T {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN_U, 0.5);
  return g;
}

/** Parts that sample the stick paper (the tubes); everything else in a TNT or pickup model takes the plain strip. */
const paperParts = new WeakSet<BufferGeometry>();

/** Merge a model that uses the stick texture: every part but the paper tubes samples its plain strip. */
function mergePaper(p: BufferGeometry[]): BufferGeometry {
  for (const g of p) if (!paperParts.has(g)) plainUV(g);
  return merge(p);
}

/** Where and how a stick stands: base centre, yaw of its wrap, lean (radians round x and z). */
interface StickPose {
  x: number;
  z: number;
  y0?: number;
  turn: number;
  tiltX?: number;
  tiltZ?: number;
}

const stickM = new Matrix4();
const stickR = new Matrix4();

/**
 * A dynamite stick, `h` tall to its shoulder and `r` thick: a paper tube with bevelled shoulders (textured: red wrap,
 * seam, printed rings, waxed ends) and the wrap folded over the top in a six-pleat crimp that dips to a dimple (pleats
 * shaded in vertex colour). Its open bottom stands on the floor (never seen).
 */
function stick(h: number, r: number, pose: StickPose): BufferGeometry[] {
  const b = r * 0.16;
  const tube = new LatheGeometry(
    [
      new Vector2(r * 0.95, 0),
      new Vector2(r, b),
      new Vector2(r, h - b),
      new Vector2(r * 0.95, h),
    ],
    14,
  );
  // u round the stick (the paper part of the texture only), v along it
  const tuv = tube.getAttribute('uv');
  const tpos = tube.getAttribute('position');
  for (let i = 0; i < tuv.count; i++)
    tuv.setXY(i, tuv.getX(i) * PAPER_U, tpos.getY(i) / h);
  const side = part(tube, 0xffffff, { tint: 0.02, rough: 0.5 });
  paperParts.add(side);

  // the crimp: a low dome of folded paper, its radius and height rippled into pleats
  const PLEATS = 6;
  const crimp = new LatheGeometry(
    [
      new Vector2(r * 0.95, 0),
      new Vector2(r * 0.82, r * 0.17),
      new Vector2(r * 0.45, r * 0.25),
      new Vector2(0, r * 0.13),
    ],
    PLEATS * 4,
  );
  const cpos = crimp.getAttribute('position');
  for (let i = 0; i < cpos.count; i++) {
    const x = cpos.getX(i);
    const z = cpos.getZ(i);
    const rr = Math.hypot(x, z);
    const fold = 0.5 + 0.5 * Math.cos(Math.atan2(z, x) * PLEATS);
    const amp = 0.14 * Math.sin(Math.PI * Math.min(1, rr / (r * 0.95)));
    const k = 1 - amp * fold;
    cpos.setXYZ(i, x * k, cpos.getY(i) - amp * fold * r * 0.35 + h, z * k);
  }
  crimp.computeVertexNormals();
  const cap = plainUV(part(crimp, 0xe6cb98, { tint: 0, rough: 0.6 }));
  // shade the folds: valleys darker
  const pos = cap.getAttribute('position');
  const col = cap.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const fold =
      0.5 + 0.5 * Math.cos(Math.atan2(pos.getZ(i), pos.getX(i)) * PLEATS);
    const k = 1.04 - 0.22 * fold;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }

  stickM
    .makeTranslation(pose.x, pose.y0 ?? 0, pose.z)
    .multiply(stickR.makeRotationZ(pose.tiltZ ?? 0))
    .multiply(stickR.makeRotationX(pose.tiltX ?? 0))
    .multiply(stickR.makeRotationY(pose.turn));
  side.applyMatrix4(stickM);
  cap.applyMatrix4(stickM);
  return [side, cap];
}

/** A point of a bundle's outline with its outward direction. */
interface OutlinePoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/**
 * The convex outline round a bundle of upright sticks (`[x, z]` centres) at `off` from their centres, sampled in `n`
 * directions: an arc round each outer stick, a straight run where the outline bridges two.
 */
function hullOutline(
  sticks: readonly (readonly [number, number])[],
  off: number,
  n: number,
): OutlinePoint[] {
  const out: OutlinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    let best = sticks[0];
    for (const s of sticks)
      if (s[0] * nx + s[1] * nz > best[0] * nx + best[1] * nz) best = s;
    out.push({ x: best[0] + nx * off, z: best[1] + nz * off, nx, nz });
  }
  return out;
}

/**
 * A closed band hugging a bundle: `profile` = `[offset from the stick centres, y, uv.y]` from its bottom edge up (a
 * chamfered strap, the label), swept round `hullOutline`. Indexed, smooth normals; `u` (optional) = uv.x of each of
 * the `n` outline samples.
 */
function hullBand(
  sticks: readonly (readonly [number, number])[],
  profile: readonly (readonly [number, number, number])[],
  n: number,
  u?: readonly number[],
): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  for (const [off, y, v] of profile)
    hullOutline(sticks, off, n).forEach((p, i) => {
      pos.push(p.x, y, p.z);
      uvs.push(u ? u[i] : PLAIN_U, v);
    });
  const index: number[] = [];
  for (let j = 0; j < profile.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i;
      const b = j * n + ((i + 1) % n);
      const c = a + n;
      const d = b + n;
      index.push(a, c, b, c, d, b);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A chamfered strap profile for `hullBand`: `r` = stick radius, `w` wide round `y`, `t` thick; its top and bottom run
 * in as lips (inside the sticks, they close the gaps where the band bridges two).
 */
const strapProfile = (r: number, y: number, w: number, t: number) =>
  [
    [r * 0.3, y - w / 2, 0.12],
    [r, y - w / 2, 0],
    [r + t, y - w / 2 + t * 0.6, 0.04],
    [r + t, y + w / 2 - t * 0.6, 0.96],
    [r, y + w / 2, 1],
    [r * 0.3, y + w / 2, 0.88],
  ] as const;

/**
 * A chunky rope tied round a bundle at height `y`, hugging its outline, with a knot and two loose ends at angle `knot`
 * (radians from +x towards +z, +z = the front).
 */
function rope(
  sticks: readonly (readonly [number, number])[],
  r: number,
  y: number,
  knot: number,
): BufferGeometry[] {
  const R = 0.013;
  const SEG = 24;
  const SIDES = 6;
  const pts = hullOutline(sticks, r + R * 0.45, 28).map(
    (p) => new Vector3(p.x, y, p.z),
  );
  const cord = part(
    new TubeGeometry(new CatmullRomCurve3(pts, true), SEG, R, SIDES, true),
    0xa2804f,
    { tint: 0.08, rough: ROUGH.rope },
  );
  // twisted strands: light and dark alternate round and along the cord, so they run in a spiral
  const uv = cord.getAttribute('uv');
  const col = cord.getAttribute('color');
  for (let i = 0; i < uv.count; i++) {
    const k =
      (Math.round(uv.getX(i) * SEG) + Math.round(uv.getY(i) * SIDES)) % 2
        ? 0.78
        : 1.08;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  const p: BufferGeometry[] = [cord];
  const kp = hullOutline(sticks, r + R * 1.2, 64)[
    Math.round(((knot / (Math.PI * 2)) % 1) * 64 + 64) % 64
  ];
  p.push(
    part(new SphereGeometry(0.022, 7, 5), 0x9a7848, {
      x: kp.x,
      y,
      z: kp.z,
      sx: 1.25,
      sy: 0.9,
      tint: 0.06,
      rough: ROUGH.rope,
    }),
  );
  // two loose ends hanging down out of the knot
  for (const s of [-1, 1]) {
    const ex = kp.x + kp.nx * 0.014 - kp.nz * s * 0.018;
    const ez = kp.z + kp.nz * 0.014 + kp.nx * s * 0.018;
    p.push(
      part(
        strut([kp.x, y, kp.z], [ex, y - 0.065, ez], 0.009, 5, 0.007),
        0xa2804f,
        {
          tint: 0.06,
          rough: ROUGH.rope,
        },
      ),
    );
  }
  return p;
}

/** The TNT fuse: a cord rising out of the blasting cap in the middle of the bundle and curling forward. */
const FUSE = new CatmullRomCurve3([
  new Vector3(0, 0.56, -0.02),
  new Vector3(0, 0.63, -0.02),
  new Vector3(0.035, 0.7, 0.0),
  new Vector3(0.09, 0.74, 0.035),
]);

/** Point `t` of the fuse (0 = where it leaves the blasting cap, 1 = its tip, by length), in TNT space. */
export function fusePoint(t: number, out: Vector3): Vector3 {
  return FUSE.getPointAt(Math.min(1, Math.max(0, t)), out);
}

/** Stick radius of a placed TNT. */
const STICK_R = 0.11;

/**
 * Where the sticks of a TNT stand, by blast level (index 0 = level 1): one stick at level 1, two at level 2 ... five at
 * level 5 - you can read how far a TNT will blow from how fat it is.
 */
export const TNT_LAYOUTS: readonly (readonly (readonly [number, number])[])[] =
  [
    [[0, 0]],
    [
      [-0.115, 0],
      [0.115, 0],
    ],
    [
      [-0.14, 0.05],
      [0.14, 0.05],
      [0, -0.075],
    ],
    [
      [-0.115, 0.1],
      [0.115, 0.1],
      [-0.115, -0.1],
      [0.115, -0.1],
    ],
    [
      [-0.22, 0.07],
      [0, 0.07],
      [0.22, 0.07],
      [-0.11, -0.11],
      [0.11, -0.11],
    ],
  ];

/** Tag every vertex of `g` with the TNT layout it belongs to (`aLayout`: level 1-5, 0 = shared by all). */
function layout<T extends BufferGeometry>(g: T, level: number): T {
  const n = g.getAttribute('position').count;
  g.setAttribute(
    'aLayout',
    new Float32BufferAttribute(new Float32Array(n).fill(level), 1),
  );
  return g;
}

/**
 * Tag the fuse cord: `aFuseT` = how far along the fuse a vertex is (-1 = not the fuse), `aFuseC` = the centre of the
 * cord there. The TNT shader burns the cord down to ash past the spark.
 */
function fuseTag<T extends BufferGeometry>(g: T, t?: (i: number) => number): T {
  const n = g.getAttribute('position').count;
  const ft = new Float32Array(n).fill(-1);
  const fc = new Float32Array(n * 3);
  const c = new Vector3();
  if (t)
    for (let i = 0; i < n; i++) {
      ft[i] = t(i);
      fusePoint(ft[i], c).toArray(fc, i * 3);
    }
  g.setAttribute('aFuseT', new Float32BufferAttribute(ft, 1));
  g.setAttribute('aFuseC', new Float32BufferAttribute(fc, 3));
  return g;
}

/**
 * TNT bundles for all five blast levels in one geometry (`aLayout` says which level a vertex belongs to; the TNT
 * renderer shows only the one matching each TNT's level): crimped paper sticks a hair apart in height, two turns of
 * chunky rope hugging the bundle with a knot, and one shared brass blasting cap with the fuse curling out of it (frayed
 * at its tip, `aFuseT` / `aFuseC`). The paper label is a separate mesh (it shows the count). Sticks sample the shared
 * stick texture; every other part its plain strip.
 */
export function tntBodyGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [];
  TNT_LAYOUTS.forEach((sticks, li) => {
    const level = li + 1;
    sticks.forEach(([x, z], k) => {
      // the back sticks a touch taller and each a hair off the next: a hand-tied bundle, not a block
      const h = (z < 0 ? 0.52 : 0.5) + (((k * 7 + level * 3) % 5) - 2) * 0.005;
      for (const g of stick(h, STICK_R, { x, z, turn: k * 2.1 + level * 0.7 }))
        p.push(layout(g, level));
    });
    for (const [y, knot] of [
      [0.1, Math.PI * 0.65],
      [0.43, Math.PI * 0.32],
    ])
      for (const g of rope(sticks, STICK_R, y, knot)) p.push(layout(g, level));
  });
  // the blasting cap: a brass tube with a crimp groove, the fuse leaving its top
  p.push(
    layout(
      part(
        new LatheGeometry(
          [
            [0.026, 0.48],
            [0.031, 0.49],
            [0.031, 0.515],
            [0.027, 0.522],
            [0.031, 0.53],
            [0.031, 0.556],
            [0.026, 0.566],
            [0.017, 0.568],
          ].map(([r, y]) => new Vector2(r, y)),
          10,
        ).translate(0, 0, -0.02),
        0xc99a45,
        { tint: 0.04, rough: ROUGH.iron },
      ),
      0,
    ),
  );
  const cord = new TubeGeometry(FUSE, 24, 0.013, 6);
  const along = Float32Array.from(
    { length: cord.getAttribute('uv').count },
    (_, i) => cord.getAttribute('uv').getX(i),
  );
  const fuse = part(cord, 0x3a2c22, { tint: 0.1, rough: 0.9 });
  // part() de-indexed the tube: carry its along-the-fuse coordinate over
  const idx = cord.index!.array;
  p.push(
    layout(
      fuseTag(fuse, (i) => along[idx[i]]),
      0,
    ),
  );
  // the frayed tip: three short strands splaying out of the cord's end
  const tip = fusePoint(1, new Vector3());
  const dir = FUSE.getTangentAt(1).normalize();
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2;
    const end: [number, number, number] = [
      tip.x + dir.x * 0.025 + Math.cos(a) * 0.012,
      tip.y + dir.y * 0.025 + Math.sin(a) * 0.012,
      tip.z + dir.z * 0.025 + Math.sin(a + 1) * 0.008,
    ];
    p.push(
      layout(
        fuseTag(
          part(strut([tip.x, tip.y, tip.z], end, 0.006, 4, 0.003), 0x6a5240, {
            tint: 0,
            rough: 0.9,
          }),
          () => 1.001,
        ),
        0,
      ),
    );
  }
  for (const g of p) {
    if (!paperParts.has(g)) plainUV(g);
    if (!g.getAttribute('aFuseT')) fuseTag(g);
  }
  return merge(p);
}

/** Height of the paper label, and its centre. */
const LABEL_H = 0.16;
const LABEL_Y = 0.27;

/**
 * The paper label round the sticks, one per blast level (`aLayout`): a thin raised band hugging the bundle with
 * chamfered edges. uv.x runs along the band in atlas cells (one cell = 3 band heights, so the digit stays round), 0.5 =
 * the middle of the front: the TNT shader prints the digit in the cell round the front and plain paper elsewhere.
 */
export function tntBandGeometry(): BufferGeometry {
  const bands: BufferGeometry[] = [];
  const cell = LABEL_H * 3;
  const N = 36;
  const T = 0.016;
  for (let level = 1; level <= TNT_LAYOUTS.length; level++) {
    const sticks = TNT_LAYOUTS[level - 1];
    // arc length round the outline (it runs from +x towards +z, so right to left across the front), measured from
    // where the front crosses the middle of the bundle and wrapped to either side
    const outline = hullOutline(sticks, STICK_R + T, N);
    const xs = sticks.map((p) => p[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const s = [0];
    let front = 0;
    for (let i = 1; i <= N; i++) {
      const a = outline[i - 1];
      const b = outline[i % N];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (a.nz > 0 && a.x >= cx && b.x < cx)
        front = s[i - 1] + ((a.x - cx) / (a.x - b.x)) * len;
      s.push(s[i - 1] + len);
    }
    const per = s[N];
    const u = outline.map((_, i) => {
      let d = front - s[i];
      if (d > per / 2) d -= per;
      if (d < -per / 2) d += per;
      return 0.5 + d / cell;
    });
    const g = hullBand(
      sticks,
      strapProfile(STICK_R - 0.004, LABEL_Y, LABEL_H, T),
      N,
      u,
    );
    bands.push(layout(g, level));
  }
  const merged = mergeGeometries(bands, false);
  if (!merged) throw new Error('kaboom: could not merge the TNT labels');
  for (const g of bands) g.dispose();
  return merged;
}

/** A bevelled badge floating over a power-up: a plus (more dynamites) or an up arrow (more sticks). */
function badge(kind: 'plus' | 'up', hex: number, y: number): BufferGeometry[] {
  if (kind === 'plus')
    return [
      part(bbox(0.2, 0.065, 0.065, 0.018, 2), hex, { y, tint: 0 }),
      part(bbox(0.065, 0.2, 0.065, 0.018, 2), hex, { y, tint: 0 }),
    ];
  return [
    part(bbox(0.065, 0.12, 0.065, 0.018, 2), hex, { y: y - 0.04, tint: 0 }),
    part(new ConeGeometry(0.1, 0.1, 8), hex, { y: y + 0.07, tint: 0 }),
  ];
}

/**
 * Power-up "more dynamites": a small open wooden crate - bevelled planks, dark corner posts, rope handles and a cyan
 * stencilled band - with five crimped sticks leaning out of it ("a box of dynamite to carry"), under a cyan plus. Wide
 * and low against the tall gold bundle. Local space like the other models: centred, standing on y = 0.
 */
export function dynamitesItemGeometry(): BufferGeometry {
  const W = 0.36;
  const D = 0.26;
  const H = 0.17;
  const T = 0.024;
  const wood = 0xb47c46;
  const p: BufferGeometry[] = [
    part(bbox(W - 0.02, 0.025, D - 0.02, 0.008), 0x8e5d33, {
      y: 0.0125,
      rough: ROUGH.wood,
    }),
  ];
  // two planks per wall, a hair apart
  for (const k of [0, 1]) {
    const y = 0.025 + k * (H / 2) + H / 4;
    for (const s of [-1, 1]) {
      p.push(
        part(bbox(W - 0.03, H / 2 - 0.006, T, 0.008), wood, {
          y,
          z: s * (D / 2 - T / 2),
          tint: 0.08,
          rough: ROUGH.wood,
        }),
        part(bbox(T, H / 2 - 0.006, D - 0.03, 0.008), wood, {
          y,
          x: s * (W / 2 - T / 2),
          tint: 0.08,
          rough: ROUGH.wood,
        }),
      );
    }
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(
        part(bbox(0.034, H + 0.012, 0.034, 0.008), 0x7a4b28, {
          x: sx * (W / 2 - 0.012),
          z: sz * (D / 2 - 0.012),
          y: (H + 0.012) / 2 + 0.012,
          tint: 0.06,
          rough: ROUGH.wood,
        }),
      );
  // the cyan stencilled band on the upper front and back planks
  for (const s of [-1, 1])
    p.push(
      part(bbox(W - 0.1, 0.034, 0.006, 0.002), 0x38c6ff, {
        y: 0.025 + H * 0.75,
        z: s * (D / 2 + 0.002),
        tint: 0,
        rough: ROUGH.paint,
      }),
    );
  // rope handles on the short sides
  for (const s of [-1, 1])
    p.push(
      part(arch(0.045, 0.009, Math.PI).rotateY(Math.PI / 2), 0xb48d5a, {
        x: s * (W / 2 + 0.006),
        y: 0.1,
        tint: 0.05,
        rough: ROUGH.rope,
      }),
    );
  const sticks: [number, number, number, number, number][] = [
    // x, z, height, lean round z, lean round x
    [-0.09, -0.04, 0.27, 0.22, -0.1],
    [-0.02, -0.05, 0.3, 0.06, -0.16],
    [0.06, -0.035, 0.28, -0.14, -0.08],
    [-0.055, 0.045, 0.26, 0.12, 0.14],
    [0.07, 0.04, 0.25, -0.24, 0.12],
  ];
  sticks.forEach(([x, z, h, tz, tx], i) =>
    p.push(
      ...stick(h, 0.042, {
        x,
        z,
        y0: 0.02,
        turn: i * 2.3,
        tiltX: tx,
        tiltZ: tz,
      }),
    ),
  );
  p.push(...badge('plus', 0x52d4ff, 0.62));
  return mergePaper(p);
}

/**
 * Power-up "more sticks": ONE tall, fat bundle of seven crimped sticks bound by two gold straps with a buckle, a fuse
 * out of a blasting cap on top, under a gold up arrow - the dynamite itself got bigger. Tall and narrow against the
 * wide cyan crate, so the two read apart at a glance.
 */
export function sticksItemGeometry(): BufferGeometry {
  const r = 0.068;
  const ring: [number, number][] = [[0, 0]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ring.push([Math.cos(a) * r * 2, Math.sin(a) * r * 2]);
  }
  const p: BufferGeometry[] = [];
  ring.forEach(([x, z], i) =>
    p.push(
      ...stick(i === 0 ? 0.6 : 0.52 + ((i * 3) % 4) * 0.008, r, {
        x,
        z,
        y0: 0.02,
        turn: i * 2.3,
      }),
    ),
  );
  for (const y of [0.15, 0.44])
    p.push(
      part(
        hullBand(ring, strapProfile(r - 0.002, y, 0.05, 0.012), 36),
        0xf2b630,
        {
          tint: 0.03,
          rough: ROUGH.paint,
        },
      ),
    );
  // the buckle on the front of the top strap
  const front = r * 3 + 0.008;
  p.push(
    part(bbox(0.07, 0.07, 0.014, 0.006), 0xc98a1c, {
      y: 0.44,
      z: front,
      tint: 0,
      rough: ROUGH.iron,
    }),
    part(bbox(0.012, 0.06, 0.012, 0.004), 0xf7d36a, {
      y: 0.44,
      z: front + 0.009,
      tint: 0,
      rough: ROUGH.iron,
    }),
  );
  // blasting cap and a short fuse with a glowing tip
  p.push(
    part(new CylinderGeometry(0.022, 0.024, 0.05, 10), 0xc99a45, {
      y: 0.64,
      tint: 0.03,
      rough: ROUGH.iron,
    }),
    part(
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(0, 0.66, 0),
          new Vector3(0, 0.72, 0),
          new Vector3(0.03, 0.77, 0.02),
        ]),
        10,
        0.012,
        6,
      ),
      0x3a2c22,
      { tint: 0.05, rough: 0.9 },
    ),
    part(ball(0.026), 0xffc247, { x: 0.03, y: 0.775, z: 0.02, tint: 0 }),
  );
  p.push(...badge('up', 0xffd23e, 1.0));
  return mergePaper(p);
}
