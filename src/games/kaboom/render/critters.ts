import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CritterId } from '../sim/types';
import { ROUGH } from './materials';
import { bbox, part } from './parts';
import {
  buildBody,
  extentAt,
  reachAt,
  surfaceRay,
  surfaceY,
  surfaceZ,
  type Shape,
  type Solid,
  type V3,
} from './sdf-body';
import type { ToonMark, ToonPaint } from './toon';

/**
 * The Boom Crew (DETAILS.md "Cast"): eight animal demolition workers in a toon look, each its own build so they read
 * apart by silhouette, all on the same footprint (visual only; the sim's hitbox is the same for everyone). Each body is
 * ONE seamless surface generated from a signed distance field (`sdf-body.ts`): a species is a list of solids (torso,
 * neck, carved skull, cheekbones, snout, brow ridges, ears, limbs, tail, sculpted fur tufts) smoothly joined, with ear
 * bowls carved out, shaded by baked occlusion. The colour is painted per pixel (`toon.ts`): graphic blocks with tufted
 * edges, almond eyes whose lids blink, brows and a smile. Small hard parts stay rigid and ride one bone each: noses,
 * teeth, quills, shell bands, whiskers, and the gear on the body (gloves, tool belt). Local space: facing +z, standing
 * on y = 0, inside 0.55 of the centre.
 *
 * Every critter has the same skeleton (`BONE`, bind positions per critter in `joints`), so `characters.ts` animates
 * them all alike. The hard hat, vest and boots are shared instanced meshes that follow the head, chest and shin bones
 * (`hatY` / `hatZ` / `hatScale` / `hatTilt`, `vest`, `feet`).
 */
export interface CritterModel {
  /** Everything: skin, faces, gear on the body; skinned (`skinIndex` / `skinWeight`), `aToon` = 1 on the painted skin. */
  geometry: BufferGeometry;
  /** Where the hard hat sits: y of the brim, z of its centre, and its size (small heads get a smaller hat). */
  hatY: number;
  hatZ: number;
  hatScale: number;
  /** Radians the hat is tipped back (negative = brim up at the front, so the face shows). */
  hatTilt: number;
  /** The shared vest (built round a torso centred at y 0.36) moved to centre `cy` and scaled to this torso. */
  vest: VestFit;
  /** Boots: half the distance between them, and their size. */
  feet: { spread: number; scale: number };
  /** Bind position of every bone (`BONE`), x y z. */
  joints: Float32Array;
  /** The paint of the skin, per pixel (`toon.ts`). */
  paint: ToonPaint;
}

export interface VestFit {
  cy: number;
  sx: number;
  sy: number;
  sz: number;
}

/** The vest geometry's own torso (`vestGeometry` in `crew-parts.ts`): centre y and shell radius. */
export const VEST_CY = 0.36;
export const VEST_R = 0.352;
/** Polar angles (radians from the top) where the vest shell starts and ends. */
const VEST_TOP = 0.92;
const VEST_BOTTOM = 1.96;

/** The crew's skeleton: the same bones for everyone (L = the critter's left, +x). */
export const BONE = {
  root: 0,
  hips: 1,
  spine: 2,
  head: 3,
  armL: 4,
  foreL: 5,
  armR: 6,
  foreR: 7,
  legL: 8,
  shinL: 9,
  legR: 10,
  shinR: 11,
  tail0: 12,
  tail1: 13,
  tail2: 14,
  earL: 15,
  earR: 16,
  lidL: 17,
  lidR: 18,
} as const;
export const BONE_COUNT = 19;
/** Parent of each bone (-1 = none). */
export const BONE_PARENT: readonly number[] = [
  -1, 0, 1, 2, 2, 4, 2, 6, 1, 8, 1, 10, 1, 12, 13, 3, 3, 3, 3,
];
/** The same bone on the other side. */
const MIRROR = [
  0, 1, 2, 3, 6, 7, 4, 5, 10, 11, 8, 9, 12, 13, 14, 16, 15, 18, 17,
];

/** Grid cell of the body surface (critter units). */
const CELL = 0.022;

/** The body solids are white: they carry only the shading, the colour is painted per pixel. */
const W = 0xffffff;
const SCLERA = 0xf7f2e8;
const PUPIL = 0x0b0807;
const SHINE = 0xffffff;
const PINK = 0xe89aa0;
const CLAW = 0xf3ead8;
const INK = 0x24181a;

const LEATHER = 0xc48a48;
const LEATHER_DARK = 0x8a5a2e;
const BRASS = 0xd4a443;
const STEEL = 0x9aa1a8;

const flipX = (v: V3): V3 => [-v[0], v[1], v[2]];

/** A solid seen in the mirror (x -> -x). */
function mirrored<T extends Solid>(s: T): T {
  const o: T = { ...s };
  if (s.c) o.c = flipX(s.c);
  if (s.a) o.a = flipX(s.a);
  if (s.b) o.b = flipX(s.b);
  if (s.rot) o.rot = [s.rot[0], -s.rot[1], -s.rot[2]];
  if (s.cuts) o.cuts = s.cuts.map(([x, y, z, k]) => [-x, y, z, k] as const);
  return o;
}

/** A toon mark and its mirror image (x -> -x). */
function toonBoth(m: ToonMark): ToonMark[] {
  const o: ToonMark = { ...m };
  if (m.c) o.c = flipX(m.c);
  if (m.a) o.a = flipX(m.a);
  if (m.b) o.b = flipX(m.b);
  if (m.rot) o.rot = [m.rot[0], -m.rot[1], -m.rot[2]];
  if (m.minus) o.minus = { c: flipX(m.minus.c), r: m.minus.r };
  return [m, o];
}

/** Bones of a critter (the left side; the right is its mirror). */
interface Joints {
  hips: V3;
  spine: V3;
  /** The neck pivot. */
  head: V3;
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  hip: V3;
  knee: V3;
  ankle: V3;
  /** Tail: three bones and the tip. */
  tail: [V3, V3, V3, V3];
  ear: V3;
}

/** A body solid; white unless it says otherwise. */
type Body = Omit<Shape, 'color'> & { color?: number };

/** A critter under construction: the solids of its body and its rigid parts (each on one bone). */
class Kit {
  readonly shapes: Shape[] = [];
  readonly parts: { g: BufferGeometry; bone: number; vest?: VestRule }[] = [];
  /** Where the eyes are (left; the lid bone), set by `toonFace`. */
  eye: V3 = [0.08, 0.6, 0.2];

  constructor(readonly j: Joints) {}

  /** Add a solid; `both` adds its mirror image too (on the other side's bone). */
  add(b: Body, both = false): this {
    const s: Shape = { color: W, ...b };
    this.shapes.push(s);
    if (both) this.shapes.push({ ...mirrored(s), bone: MIRROR[s.bone] });
    return this;
  }

  /** A rigid part on `bone`; `vest` says how it gets along with the vest (fitted later, in `finish`). */
  rigid(g: BufferGeometry, bone: number, vest?: VestRule): this {
    this.parts.push({ g, bone, vest });
    return this;
  }

  /** The front of the body at (x, y) (before anything is carved). */
  front(x: number, y: number): number {
    return surfaceZ(
      this.shapes.filter((s) => !s.sub),
      x,
      y,
    );
  }

  /** Upper arm, forearm, thigh and shin of both sides as tapered round cones (radii at the joints). */
  limbs(arm: V3, leg: V3): this {
    const j = this.j;
    return this.add(
      {
        a: j.shoulder,
        b: j.elbow,
        ra: arm[0],
        rb: arm[1],
        bone: BONE.armL,
        blend: 0.07,
      },
      true,
    )
      .add(
        {
          a: j.elbow,
          b: j.wrist,
          ra: arm[1],
          rb: arm[2],
          bone: BONE.foreL,
          blend: 0.035,
        },
        true,
      )
      .add(
        {
          a: j.hip,
          b: j.knee,
          ra: leg[0],
          rb: leg[1],
          bone: BONE.legL,
          blend: 0.07,
        },
        true,
      )
      .add(
        {
          a: j.knee,
          b: j.ankle,
          ra: leg[1],
          rb: leg[2],
          bone: BONE.shinL,
          blend: 0.035,
        },
        true,
      );
  }

  /** A tail along the tail joints: three tapering round cones (radii at the joints, root to tip). */
  tail(r: readonly [number, number, number, number]): this {
    const t = this.j.tail;
    return this.add({
      a: t[0],
      b: t[1],
      ra: r[0],
      rb: r[1],
      bone: BONE.tail0,
      blend: 0.05,
    })
      .add({
        a: t[1],
        b: t[2],
        ra: r[1],
        rb: r[2],
        bone: BONE.tail1,
        blend: 0.03,
      })
      .add({
        a: t[2],
        b: t[3],
        ra: r[2],
        rb: r[3],
        bone: BONE.tail2,
        blend: 0.03,
      });
  }

  /** A sculpted fur tuft: a round cone tapering to a point from `a` to `b` (both sides). */
  tuft(a: V3, b: V3, r: number, bone: number, blend = 0.04): this {
    return this.add(
      { a, b, ra: r, rb: Math.max(0.006, r * 0.19), bone, blend },
      true,
    );
  }

  /** A glossy bevelled nose pad on the head. */
  nose(c: V3, w: number, h: number, d: number, color: number): this {
    return this.rigid(
      part(bbox(w, h, d, Math.min(w, h, d) * 0.48, 3), color, {
        x: c[0],
        y: c[1],
        z: c[2],
        tint: 0,
        rough: ROUGH.paint,
      }),
      BONE.head,
    );
  }
}

/** A cone from `a` pointing to `b` (claws, quills, feelers). */
function spike(
  a: V3,
  b: V3,
  r: number,
  color: number,
  seg = 6,
): BufferGeometry {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new ConeGeometry(r, len, seg);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()),
  );
  return part(g, color, {
    x: (a[0] + b[0]) / 2,
    y: (a[1] + b[1]) / 2,
    z: (a[2] + b[2]) / 2,
    tint: 0.04,
  });
}

// ------------------------------------------------------------------ gear on the body (merged: no extra draws)

/**
 * A fingerless work glove with real fingers, hanging relaxed: the palm turned to the body, four short fingers curling
 * in, the thumb in front, a snug cuff round the wrist (side `s`, size `k`); claws come out of the fingertips and follow
 * their curl. Built in the hand's own frame (palm facing +z, fingers down, thumb at +x for the left hand), then turned
 * to the side.
 */
function fingerGlove(kit: Kit, s: number, claws: number | null, k = 1): void {
  const w = kit.j.wrist;
  const bone = s > 0 ? BONE.foreL : BONE.foreR;
  const c: V3 = [s * w[0], w[1] - 0.038 * k, w[2] + 0.006 * k];
  // the hand's yaw: palm to the body, a little forward
  const yaw = -s * (Math.PI / 2 - 0.35);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const world = (v: V3): V3 => [
    c[0] + (v[0] * cy + v[2] * sy) * k,
    c[1] + v[1] * k,
    c[2] + (-v[0] * sy + v[2] * cy) * k,
  ];
  const piece = (g: BufferGeometry, hex: number) =>
    part(g, hex, {
      sx: k,
      sy: k,
      sz: k,
      ry: yaw,
      x: c[0],
      y: c[1],
      z: c[2],
      tint: 0.04,
    });
  const CURL = 0.55;
  const R = 0.0125;
  kit
    // the padded palm
    .rigid(piece(bbox(0.064, 0.06, 0.038, 0.016, 2), LEATHER), bone)
    // the cuff, a darker band snug round the wrist
    .rigid(
      part(new CylinderGeometry(0.043, 0.045, 0.024, 14), LEATHER_DARK, {
        x: c[0],
        y: c[1] + 0.036 * k,
        z: c[2] - 0.004 * k,
        sx: k,
        sz: k,
        tint: 0.03,
        edges: true,
      }),
      bone,
    );
  // four fingers, index next to the thumb, the middle one longest
  const fingers: [number, number][] = [
    [0.021, 0.03],
    [0.007, 0.033],
    [-0.008, 0.03],
    [-0.022, 0.024],
  ];
  for (const [fx, len] of fingers) {
    const x = s * fx;
    kit.rigid(
      piece(
        new CapsuleGeometry(R, len, 3, 8)
          .translate(0, -len / 2, 0)
          .rotateX(-CURL)
          .translate(x, -0.026, 0.004),
        LEATHER,
      ),
      bone,
    );
    if (claws !== null) {
      const reach = len + R;
      const tip: V3 = [
        x,
        -0.026 - reach * Math.cos(CURL),
        0.004 + reach * Math.sin(CURL),
      ];
      const end: V3 = [
        x,
        tip[1] - 0.026 * Math.cos(CURL + 0.35),
        tip[2] + 0.026 * Math.sin(CURL + 0.35),
      ];
      kit.rigid(spike(world(tip), world(end), 0.0085 * k, claws, 5), bone);
    }
  }
  // the thumb in front, curling down and in
  kit.rigid(
    piece(
      new CapsuleGeometry(0.013, 0.024, 3, 8)
        .translate(0, -0.012, 0)
        .rotateX(-0.9)
        .rotateZ(s * 0.35)
        .translate(s * 0.03, -0.002, 0.012),
      LEATHER,
    ),
    bone,
  );
}

/** A tool belt round the hips at `y` (torso half-widths `rx`, `rz`): band, buckle, a pouch and a hammer in a loop. */
function toolBelt(kit: Kit, y: number, rx: number, rz: number): void {
  // pouch and hammer shrink with a small critter
  const k = Math.min(1, rx / 0.29);
  const b = BONE.hips;
  kit
    .rigid(
      part(new CylinderGeometry(1, 1, 0.055, 24), LEATHER_DARK, {
        y,
        sx: rx,
        sz: rz,
        tint: 0.04,
        edges: true,
      }),
      b,
    )
    .rigid(
      part(bbox(0.075, 0.065, 0.025, 0.01), BRASS, {
        y,
        z: rz + 0.008,
        tint: 0,
        rough: ROUGH.iron,
      }),
      b,
    )
    .rigid(
      part(bbox(0.055, 0.04, 0.02, 0.008), LEATHER_DARK, {
        y,
        z: rz + 0.016,
        tint: 0,
      }),
      b,
    )
    // pouch on the right hip with its flap
    .rigid(
      part(bbox(0.09 * k, 0.1 * k, 0.06 * k, 0.018 * k), LEATHER, {
        x: -rx * 0.78,
        y: y - 0.03 * k,
        z: rz * 0.6,
        ry: -0.9,
        tint: 0.05,
      }),
      b,
    )
    .rigid(
      part(bbox(0.095 * k, 0.03 * k, 0.065 * k, 0.01 * k), LEATHER_DARK, {
        x: -rx * 0.8,
        y: y + 0.02 * k,
        z: rz * 0.62,
        ry: -0.9,
        tint: 0.03,
      }),
      b,
    )
    // hammer on the left, head up in a loop
    .rigid(
      part(new CylinderGeometry(0.013, 0.015, 0.2 * k, 6), 0xb07a45, {
        x: rx * 1.02,
        y: y - 0.06 * k,
        z: rz * 0.25,
        tint: 0.05,
      }),
      b,
    )
    .rigid(
      part(bbox(0.035 * k, 0.035 * k, 0.1 * k, 0.008), STEEL, {
        x: rx * 1.02,
        y: y + 0.045 * k,
        z: rz * 0.25,
        tint: 0,
        rough: ROUGH.iron,
      }),
      b,
    );
}

// ------------------------------------------------------------------ finishing

/** A rigid part as a skinned piece of the body: one bone, unpainted (`aToon` 0), indexed so it merges with the body. */
function rigidGeometry(src: BufferGeometry, bone: number): BufferGeometry {
  const g = new BufferGeometry();
  const n = src.getAttribute('position').count;
  for (const name of ['position', 'normal', 'color'])
    g.setAttribute(name, src.getAttribute(name));
  g.setAttribute('aToon', new Float32BufferAttribute(new Float32Array(n), 1));
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

/** How a rigid part meets the vest: `over` = worn over it (pushed out to sit just outside), `base` = dropped where the
 * vest covers that point (it would poke through). */
type VestRule = 'over' | { base: V3 };

interface Finish {
  /** Hat: tipped back by `tilt`, its size, how deep the brim sinks below the crown top, and z of its centre. */
  hat: { z: number; scale: number; tilt: number; sink?: number };
  /** Vest centre and height factor. */
  vest: { cy: number; sy: number };
  feet: number;
  paint: ToonPaint;
}

/**
 * Fit the gear to the body, add the tool belt, generate the body surface and merge it with the rigid parts into the
 * body geometry.
 */
function finish(kit: Kit, o: Finish): CritterModel {
  const j = kit.j;
  const torso = kit.shapes.filter(
    (s) => !s.sub && (s.bone === BONE.hips || s.bone === BONE.spine),
  );
  const head = kit.shapes.filter((s) => !s.sub && s.bone === BONE.head);
  const vx = extentAt(torso, o.vest.cy);
  const vest: VestFit = {
    cy: o.vest.cy,
    sy: o.vest.sy,
    sx: (vx.x + 0.03) / VEST_R,
    sz: (vx.z + 0.03) / (VEST_R * 0.97),
  };
  // the vest is fitted at its centre height; widen it until the torso stays inside the whole shell (a barrel chest
  // or a wide back would otherwise poke through above or below the middle)
  const dirs: [number, number][] = [];
  for (let a = 0.35; a <= Math.PI * 2 - 0.35; a += Math.PI / 12)
    dirs.push([Math.sin(a), Math.cos(a)]);
  let grow = 1;
  for (let th = VEST_TOP; th <= VEST_BOTTOM; th += 0.08) {
    const y = vest.cy + Math.cos(th) * VEST_R * 1.05 * vest.sy;
    const rx = VEST_R * vest.sx * Math.sin(th);
    const rz = VEST_R * 0.97 * vest.sz * Math.sin(th);
    reachAt(torso, y, dirs).forEach((r, i) => {
      if (r <= 0) return;
      const [dx, dz] = dirs[i];
      const need = Math.hypot(((r + 0.02) * dx) / rx, ((r + 0.02) * dz) / rz);
      grow = Math.max(grow, need);
    });
  }
  vest.sx *= grow;
  vest.sz *= grow;
  // gear the vest meets: parts it covers go (quills), parts worn over it sit just outside it (a shell)
  const vax = VEST_R * vest.sx;
  const vay = VEST_R * 1.05 * vest.sy;
  const vaz = VEST_R * 0.97 * vest.sz;
  const covered = (x: number, y: number, z: number): boolean => {
    const ny = (y - vest.cy) / vay;
    if (ny > Math.cos(VEST_TOP) || ny < Math.cos(VEST_BOTTOM)) return false;
    if (Math.abs(Math.atan2(x / vax, z / vaz)) < 0.33) return false;
    return Math.hypot(x / vax, ny, z / vaz) < 1.15;
  };
  for (let i = kit.parts.length - 1; i >= 0; i--) {
    const rule = kit.parts[i].vest;
    if (rule && rule !== 'over' && covered(...rule.base))
      kit.parts.splice(i, 1);
  }
  const over = kit.parts.filter((p) => p.vest === 'over');
  let spread = 1;
  for (const p of over) {
    const pos = p.g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ny = (pos.getY(i) - vest.cy) / vay;
      const h = (x / vax) ** 2 + (z / vaz) ** 2;
      const need = 1.06 ** 2 - ny * ny;
      if (need > 0 && h > 1e-6) spread = Math.max(spread, Math.sqrt(need / h));
    }
  }
  for (const p of over) p.g.scale(spread, 1, spread);
  const hatScale = o.hat.scale;
  const hatY = surfaceY(head, 0, o.hat.z) - (o.hat.sink ?? 0.035);
  // the belt sits just under the vest's hem
  const beltY = vest.cy + (0.21 - VEST_CY) * vest.sy - 0.025;
  const bx = extentAt(torso, beltY);
  toolBelt(kit, beltY, bx.x + 0.015, bx.z + 0.015);

  // the vest and the hat brim shade what is under and next to them
  const brim = 0.264 * hatScale * 1.15;
  const body = buildBody({
    shapes: kit.shapes,
    occluders: [
      {
        c: [0, vest.cy, 0],
        r: [VEST_R * vest.sx, VEST_R * 1.05 * vest.sy, VEST_R * vest.sz],
        cuts: [
          [0, 1, 0, 0.6],
          [0, -1, 0, 0.38],
        ],
      },
      {
        c: [0, hatY - 0.02, o.hat.z + 0.03],
        r: [brim, 0.03, brim * 1.18],
        rot: [o.hat.tilt, 0, 0],
      },
    ],
    cell: CELL,
    bones: BONE_COUNT,
  });

  const nv = body.position.length / 3;
  const skin = new BufferGeometry();
  skin.setAttribute('position', new Float32BufferAttribute(body.position, 3));
  skin.setAttribute('normal', new Float32BufferAttribute(body.normal, 3));
  skin.setAttribute('color', new Float32BufferAttribute(body.color, 3));
  skin.setAttribute(
    'aToon',
    new Float32BufferAttribute(new Float32Array(nv).fill(1), 1),
  );
  skin.setAttribute('skinIndex', new Uint16BufferAttribute(body.skinIndex, 4));
  skin.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(body.skinWeight, 4),
  );
  skin.setIndex(Array.from(body.index));

  const rigid = kit.parts.map((p) => rigidGeometry(p.g, p.bone));
  const geometry = mergeGeometries([skin, ...rigid], false);
  if (!geometry) throw new Error('kaboom: could not merge a critter');
  for (const g of [skin, ...rigid, ...kit.parts.map((p) => p.g)]) g.dispose();

  const joints = new Float32Array(BONE_COUNT * 3);
  const put = (b: number, p: V3) => {
    joints.set(p, b * 3);
    joints.set(flipX(p), MIRROR[b] * 3);
  };
  put(BONE.hips, j.hips);
  put(BONE.spine, j.spine);
  put(BONE.head, j.head);
  put(BONE.armL, j.shoulder);
  put(BONE.foreL, j.elbow);
  put(BONE.legL, j.hip);
  put(BONE.shinL, j.knee);
  put(BONE.tail0, j.tail[0]);
  put(BONE.tail1, j.tail[1]);
  put(BONE.tail2, j.tail[2]);
  put(BONE.earL, j.ear);
  put(BONE.lidL, kit.eye);
  return {
    geometry,
    joints,
    hatY,
    hatZ: o.hat.z,
    hatScale,
    hatTilt: o.hat.tilt,
    vest,
    feet: { spread: j.ankle[0], scale: o.feet },
    paint: o.paint,
  };
}

// ------------------------------------------------------------------ the toon proportions and face

/** The planes of a carved skull: brow sloping to the snout, cheeks, jaw and back (`k` = how deep). */
const SKULL = (k: number): Shape['cuts'] => [
  [0, 1, 0.45, k],
  [1, 0, 0.35, k + 0.02],
  [-1, 0, 0.35, k + 0.02],
  [0, -1, 0.15, k - 0.02],
  [0, 0, -1, k],
];

/** The planes of a carved torso: flat chest and back, flat flanks, chamfered shoulders. */
const CHEST = (k = 1): Shape['cuts'] => [
  [0, 0, 1, 0.9 + 0.1 * (1 - k)],
  [0, 0, -1, 0.92 + 0.08 * (1 - k)],
  [1, 0, 0, 0.94 + 0.06 * (1 - k)],
  [-1, 0, 0, 0.94 + 0.06 * (1 - k)],
  [1, 1.1, 0, 0.93 + 0.07 * (1 - k)],
  [-1, 1.1, 0, 0.93 + 0.07 * (1 - k)],
];

const LEG_BONES: readonly number[] = [
  BONE.legL,
  BONE.shinL,
  BONE.legR,
  BONE.shinR,
];
const HEAD_BONES: readonly number[] = [
  BONE.head,
  BONE.earL,
  BONE.earR,
  BONE.lidL,
  BONE.lidR,
];

/** Where things drawn before `toonize` ended up: points and paint on the body (lifted) and on the head (also shrunk). */
interface ToonFrame {
  hs: number;
  head(v: V3): V3;
  bodyMark(m: ToonMark): ToonMark;
  headMark(m: ToonMark): ToonMark;
}

/**
 * The toon proportions (a cartoon mascot's): longer legs - everything above them (body, arms, head, tail, rigid parts,
 * joints) sits `up` higher - and a smaller head: everything on the head shrinks by `hs` about `hc` (as first drawn).
 * Called once the body and its rigid parts are built; paint drawn in the first coordinates goes through the frame.
 */
function toonize(k: Kit, up: number, hs: number, hc: V3): ToonFrame {
  const c: V3 = [hc[0], hc[1] + up, hc[2]];
  const lift = (v: V3): V3 => [v[0], v[1] + up, v[2]];
  const shrink = (v: V3): V3 => [
    c[0] + (v[0] - c[0]) * hs,
    c[1] + (v[1] - c[1]) * hs,
    c[2] + (v[2] - c[2]) * hs,
  ];
  const head = (v: V3): V3 => shrink(lift(v));
  for (const s of k.shapes) {
    if (LEG_BONES.includes(s.bone)) continue;
    const onHead = HEAD_BONES.includes(s.bone);
    const f = onHead ? head : lift;
    if (s.c) s.c = f(s.c);
    if (s.a) s.a = f(s.a);
    if (s.b) s.b = f(s.b);
    if (!onHead) continue;
    if (s.r) s.r = [s.r[0] * hs, s.r[1] * hs, s.r[2] * hs];
    if (s.ra) s.ra *= hs;
    if (s.rb) s.rb *= hs;
  }
  for (const p of k.parts) {
    if (LEG_BONES.includes(p.bone)) continue;
    p.g.translate(0, up, 0);
    if (HEAD_BONES.includes(p.bone))
      p.g
        .translate(-c[0], -c[1], -c[2])
        .scale(hs, hs, hs)
        .translate(c[0], c[1], c[2]);
  }
  const j = k.j;
  for (const key of [
    'hips',
    'spine',
    'head',
    'shoulder',
    'elbow',
    'wrist',
  ] as const)
    j[key] = lift(j[key]);
  j.tail = [lift(j.tail[0]), lift(j.tail[1]), lift(j.tail[2]), lift(j.tail[3])];
  j.ear = head(j.ear);
  const mark =
    (f: (v: V3) => V3, s: number) =>
    (m: ToonMark): ToonMark => ({
      ...m,
      c: m.c && f(m.c),
      r: m.r && [m.r[0] * s, m.r[1] * s, m.r[2] * s],
      a: m.a && f(m.a),
      b: m.b && f(m.b),
      ra: m.ra && m.ra * s,
      rb: m.rb && m.rb * s,
      minus: m.minus && {
        c: f(m.minus.c),
        r: [m.minus.r[0] * s, m.minus.r[1] * s, m.minus.r[2] * s],
      },
    });
  return { hs, head, bodyMark: mark(lift, 1), headMark: mark(head, hs) };
}

interface Face {
  /**
   * The eyes: centre (x, y as first drawn), size (1 = the badger's), iris colour, the lid's colour (the paint round
   * the eye), how far the upper lid stays open (the badger's 0.032: lower = sleepier) and the turn of the almond.
   */
  eye: {
    x: number;
    y: number;
    size?: number;
    iris: number;
    lid: number;
    open?: number;
    rot?: V3;
  };
  /** The brow stroke over each eye (as first drawn; z depth as is). */
  brow: { c: V3; r: V3; rot?: V3; color: number };
  /** The nose pad (as first drawn). */
  nose?: { c: V3; w: number; h: number; d: number; color: number };
  /**
   * The mouth: a short line down from the nose (`at` as first drawn when there is no pad) into a smile `w` wide
   * (1 = the badger's), `drop` under it, with the tongue showing.
   */
  mouth: {
    at?: V3;
    w?: number;
    drop?: number;
    line?: boolean;
    tongue?: boolean;
  };
}

/**
 * The painted face (crisp almonds on the surface): eyes with outline, white, big iris, pupil and two
 * highlights under an upper lid lowered a little over the iris (a friendly look) that a blink brings right down;
 * brow strokes; the nose pad and a smile with the tongue in it. Returns the paint (after the species' own marks).
 */
function toonFace(k: Kit, f: ToonFrame, o: Face): ToonMark[] {
  const s = (o.eye.size ?? 1) * f.hs;
  const [ex, ey] = f.head([o.eye.x, o.eye.y, 0]);
  const ez = k.front(ex, ey);
  k.eye = [ex, ey, ez - 0.03];
  const rot = o.eye.rot ?? [0, 0.32, -0.12];
  const open = o.eye.open ?? 0.032;
  const depth = Math.max(1, s / f.hs);
  const eye = (
    dx: number,
    dy: number,
    r: V3,
    color: number,
    more: Pick<ToonMark, 'cut' | 'blink'> = {},
  ): ToonMark[] =>
    toonBoth({
      c: [ex + dx * s, ey + dy * s, ez - 0.01],
      r: [r[0] * s, r[1] * s, r[2] * depth],
      rot,
      color,
      ...more,
    });
  const brow = toonBoth({
    c: f.head(o.brow.c),
    r: [o.brow.r[0] * f.hs, o.brow.r[1] * f.hs, o.brow.r[2]],
    rot: o.brow.rot ?? [0.2, 0.3, -0.18],
    color: o.brow.color,
  });
  const marks: ToonMark[] = [
    ...brow,
    ...eye(0, 0, [0.058, 0.047, 0.06], INK),
    ...eye(0, 0, [0.05, 0.04, 0.062], SCLERA),
    ...eye(-0.003, -0.002, [0.035, 0.039, 0.064], o.eye.iris),
    ...eye(-0.003, -0.002, [0.019, 0.023, 0.066], PUPIL),
    ...eye(-0.014, 0.013, [0.01, 0.01, 0.068], SHINE),
    ...eye(0.008, -0.016, [0.005, 0.005, 0.068], SHINE),
    ...eye(0, 0.002, [0.058, 0.048, 0.07], o.eye.lid, {
      cut: [0, -1, 0, -open * s],
      blink: (open + 0.053) * s,
    }),
  ];
  let n = o.mouth.at && f.head(o.mouth.at);
  if (o.nose) {
    const c = f.head(o.nose.c);
    const hs = f.hs;
    k.nose(c, o.nose.w * hs, o.nose.h * hs, o.nose.d * hs, o.nose.color);
    n ??= c;
  }
  if (!n) return marks;
  const MOUTH = 0x3a1418;
  const front = (y: number): number => k.front(0, y);
  const w = o.mouth.w ?? 1;
  const my = n[1] - (o.mouth.drop ?? 0.042);
  if (o.mouth.line ?? true)
    marks.push({
      a: [0, n[1] - 0.012, front(n[1] - 0.012)],
      b: [0, my + 0.004, front(my + 0.004)],
      ra: 0.0055,
      rb: 0.0055,
      color: MOUTH,
    });
  marks.push({
    c: [0, my, front(my) - 0.02],
    r: [0.058 * w, 0.034, 0.12],
    color: MOUTH,
    minus: {
      c: [0, my + 0.013, front(my) - 0.02],
      r: [0.066 * w, 0.031, 0.14],
    },
  });
  if (o.mouth.tongue ?? true)
    marks.push({
      c: [0, my - 0.026, front(my - 0.026) - 0.02],
      r: [0.022 * w, 0.0085, 0.12],
      color: 0xe0707a,
    });
  return marks;
}

/** Trousers: the paint under `top` (final height), a tufted edge. */
const trousers = (top: number, color: number): ToonMark => ({
  c: [0, top - 0.27, 0],
  r: [0.6, 0.27, 0.6],
  color,
  zig: [0.014, 26],
});

/** Sleeves from the shoulder (or the elbow) to the wrist (final joints), a tufted edge at the top. */
function sleeves(
  k: Kit,
  color: number,
  ra: number,
  rb: number,
  from: 'shoulder' | 'elbow' = 'shoulder',
): ToonMark[] {
  const a = k.j[from];
  const w = k.j.wrist;
  return toonBoth({
    a: from === 'shoulder' ? [a[0] + 0.015, a[1] - 0.03, a[2] + 0.01] : a,
    b: [w[0], w[1] - 0.01, w[2]],
    ra,
    rb,
    color,
    zig: [0.01, 30],
  });
}

// ------------------------------------------------------------------ the crew

const BUILDERS: Record<CritterId, () => CritterModel> = {
  /**
   * Compact and heavy-shouldered, a carved wedge of a head with cheek ruffs, a striped face, dark trousers and
   * sleeves, digging claws through the gloves.
   */
  badger() {
    const grey = 0x9a99a1;
    const dark = 0x2c2c34;
    const white = 0xf3f1ec;
    const k = new Kit({
      hips: [0, 0.22, 0],
      spine: [0, 0.36, 0],
      head: [0, 0.52, 0.04],
      shoulder: [0.2, 0.47, 0.02],
      elbow: [0.25, 0.375, 0.065],
      wrist: [0.27, 0.3, 0.12],
      hip: [0.105, 0.24, 0],
      knee: [0.11, 0.145, 0.025],
      ankle: [0.115, 0.07, 0.035],
      tail: [
        [0, 0.22, -0.18],
        [0, 0.2, -0.26],
        [0, 0.19, -0.32],
        [0, 0.19, -0.38],
      ],
      ear: [0.2, 0.83, 0.0],
    });
    k.add({
      c: [0, 0.25, 0],
      r: [0.2, 0.125, 0.17],
      cuts: [[0, -1, 0, 0.85]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.38, 0],
        r: [0.215, 0.165, 0.18],
        cuts: CHEST(0.6),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.09,
      })
      .add({
        a: [0, 0.47, 0.02],
        b: [0, 0.56, 0.06],
        ra: 0.12,
        rb: 0.12,
        bone: BONE.head,
        blend: 0.07,
      })
      // a carved skull (firm planes: brow, cheeks, jaw), cheekbones, brow ridges, a wedge of a snout
      .add({
        c: [0, 0.68, 0.06],
        r: [0.245, 0.205, 0.225],
        cuts: SKULL(0.83),
        bevel: 0.035,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.11, 0.605, 0.15],
          r: [0.1, 0.075, 0.1],
          cuts: [[0, -1, 0.2, 0.8]],
          bone: BONE.head,
          blend: 0.07,
        },
        true,
      )
      .add(
        {
          c: [0.092, 0.752, 0.235],
          r: [0.07, 0.024, 0.05],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.035,
        },
        true,
      )
      // cheek ruffs: three tufts each side, sweeping out and down
      .tuft([0.19, 0.64, 0.08], [0.275, 0.625, 0.035], 0.045, BONE.head)
      .tuft([0.19, 0.6, 0.1], [0.29, 0.55, 0.065], 0.055, BONE.head)
      .tuft([0.165, 0.56, 0.12], [0.24, 0.5, 0.1], 0.045, BONE.head)
      .add({
        c: [0, 0.605, 0.31],
        r: [0.082, 0.066, 0.15],
        rot: [-0.1, 0, 0],
        cuts: [
          [0, 1, 0.1, 0.82],
          [1, 0, 0.25, 0.86],
          [-1, 0, 0.25, 0.86],
        ],
        bevel: 0.02,
        bone: BONE.head,
        blend: 0.07,
      })
      // round ears with a bowl
      .add(
        {
          c: [0.2, 0.84, 0.0],
          r: [0.065, 0.07, 0.035],
          rot: [0, 0.35, -0.55],
          bone: BONE.earL,
          blend: 0.035,
        },
        true,
      )
      .add(
        {
          c: [0.203, 0.846, 0.028],
          r: [0.04, 0.045, 0.02],
          rot: [0, 0.35, -0.55],
          bone: BONE.earL,
          sub: true,
          blend: 0.012,
        },
        true,
      )
      .limbs([0.058, 0.05, 0.044], [0.062, 0.055, 0.048])
      // a tuft at the back of each elbow
      .tuft([0.245, 0.385, 0.05], [0.29, 0.37, 0.0], 0.035, BONE.foreL, 0.025)
      // the tail ends in a little fan of three tufts
      .tail([0.06, 0.05, 0.04, 0.008]);
    const t = k.j.tail;
    k.tuft(
      t[2],
      [0.04, t[3][1] + 0.01, t[3][2] + 0.01],
      0.03,
      BONE.tail2,
      0.02,
    );
    const f = toonize(k, 0.07, 0.88, [0, 0.6, 0.06]);
    const marks: ToonMark[] = [
      // dark trousers and sleeves, a tufted edge
      trousers(0.36, dark),
      ...sleeves(k, dark, 0.085, 0.075),
      // the white face (a tufted edge over the cheeks), the dark stripes from the nose over each eye to the ear
      ...(
        [
          {
            c: [0, 0.64, 0.22],
            r: [0.38, 0.22, 0.3],
            color: white,
            zig: [0.012, 24],
          },
          ...toonBoth({
            c: [0.086, 0.76, 0.19],
            r: [0.05, 0.17, 0.32],
            rot: [0.38, 0.12, -0.12],
            color: dark,
          }),
          // ears: dark backs, white bowls
          ...toonBoth({
            c: [0.2, 0.84, 0.0],
            r: [0.08, 0.085, 0.05],
            rot: [0, 0.35, -0.55],
            color: dark,
          }),
          ...toonBoth({
            c: [0.205, 0.848, 0.03],
            r: [0.045, 0.05, 0.03],
            rot: [0, 0.35, -0.55],
            color: white,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: { x: 0.088, y: 0.7, iris: 0xa8601f, lid: dark },
        // lighter strokes along the brow ridges, so they read on the dark stripe
        brow: {
          c: [0.094, 0.758, 0.25],
          r: [0.056, 0.011, 0.06],
          color: 0x8c8b95,
        },
        nose: {
          c: [0, 0.632, 0.455],
          w: 0.07,
          h: 0.048,
          d: 0.045,
          color: 0x141418,
        },
        mouth: {},
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, CLAW, 1.1);
    return finish(k, {
      hat: { z: 0.05, scale: 0.8, tilt: -0.26 },
      vest: { cy: 0.42, sy: 0.66 },
      feet: 0.95,
      paint: { base: grey, marks, texture: 1 },
    });
  },

  /** Short, broad and neckless: a velvet pear with a pink star nose, a sleepy squint and huge pink spade hands. */
  mole() {
    const fur = 0x5d6283;
    const face = 0x7c81a4;
    const dark = 0x3b3f5a;
    const pink = 0xeda3a9;
    const k = new Kit({
      hips: [0, 0.2, 0],
      spine: [0, 0.34, 0],
      head: [0, 0.5, 0.06],
      shoulder: [0.2, 0.44, 0.04],
      elbow: [0.245, 0.385, 0.09],
      wrist: [0.28, 0.345, 0.14],
      hip: [0.1, 0.17, 0],
      knee: [0.1, 0.115, 0.02],
      ankle: [0.105, 0.06, 0.035],
      tail: [
        [0, 0.15, -0.2],
        [0, 0.13, -0.25],
        [0, 0.12, -0.29],
        [0, 0.115, -0.33],
      ],
      ear: [0.15, 0.66, 0.02],
    });
    k.add({
      c: [0, 0.26, 0],
      r: [0.26, 0.18, 0.245],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.42, 0.02],
        r: [0.235, 0.2, 0.22],
        cuts: CHEST(0.6),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      // no neck: the head melts into the shoulders
      .add({
        c: [0, 0.6, 0.1],
        r: [0.175, 0.16, 0.2],
        cuts: SKULL(0.88),
        bevel: 0.03,
        bone: BONE.head,
        blend: 0.12,
      })
      .add(
        {
          c: [0.09, 0.565, 0.17],
          r: [0.075, 0.06, 0.075],
          bone: BONE.head,
          blend: 0.06,
        },
        true,
      )
      .add(
        {
          c: [0.072, 0.665, 0.245],
          r: [0.05, 0.017, 0.035],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      // the long snout and the star at its tip
      .add({
        a: [0, 0.578, 0.2],
        b: [0, 0.566, 0.4],
        ra: 0.072,
        rb: 0.043,
        bone: BONE.head,
        blend: 0.05,
      })
      .add({
        c: [0, 0.566, 0.413],
        r: [0.05, 0.05, 0.022],
        bone: BONE.head,
        blend: 0.012,
      })
      // short velvet tufts on the cheeks
      .tuft([0.15, 0.58, 0.12], [0.22, 0.555, 0.08], 0.04, BONE.head)
      .tuft([0.14, 0.535, 0.14], [0.2, 0.495, 0.12], 0.035, BONE.head)
      .limbs([0.075, 0.07, 0.065], [0.072, 0.066, 0.06])
      .tuft([0.24, 0.395, 0.07], [0.285, 0.38, 0.02], 0.03, BONE.foreL, 0.025)
      .add({
        a: k.j.tail[0],
        b: k.j.tail[3],
        ra: 0.035,
        rb: 0.015,
        bone: BONE.tail0,
        blend: 0.03,
      });
    // the feelers of the star
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const b: V3 = [Math.cos(a) * 0.036, 0.566 + Math.sin(a) * 0.036, 0.422];
      k.rigid(
        spike(
          b,
          [b[0] * 2.1, 0.566 + (b[1] - 0.566) * 2.1, 0.447],
          0.012,
          pink,
          5,
        ),
        BONE.head,
      );
    }
    // spade hands, part of the body (no gloves: too wide): a broad flat palm turned out and a little back (digging),
    // five thick digits fused into a scalloped edge and a big curved claw on each; furred on the back of the hand
    const hands: ToonMark[] = [];
    for (const s of [1, -1]) {
      const bone = s > 0 ? BONE.foreL : BONE.foreR;
      const w = k.j.wrist;
      const pc: V3 = [s * (w[0] + 0.03), w[1] - 0.065, w[2] + 0.035];
      // the hand's frame: `n` = the palm's normal (out, a little back and down), `d` = down along the digits, `u` =
      // across its width; the back of the hand (-n) faces up and in, to the camera
      const turn = new Euler(0, s * 0.455, -s * 0.5, 'YXZ');
      const axis = (x: number, y: number, z: number): V3 => {
        const v = new Vector3(x, y, z).applyEuler(turn);
        return [v.x, v.y, v.z];
      };
      const n = axis(s, 0, 0);
      const d = axis(0, -1, 0);
      const u = axis(0, 0, 1);
      const at = (base: V3, du: number, dn: number, dd: number): V3 => [
        base[0] + u[0] * du + n[0] * dn + d[0] * dd,
        base[1] + u[1] * du + n[1] * dn + d[1] * dd,
        base[2] + u[2] * du + n[2] * dn + d[2] * dd,
      ];
      k.add({
        c: pc,
        r: [0.042, 0.085, 0.115],
        rot: [turn.x, turn.y, turn.z],
        bone,
        blend: 0.045,
      });
      for (let i = 0; i < 5; i++) {
        const t = (i / 4) * 2 - 1;
        const base = at(pc, t * 0.085, 0.004, 0.052 - Math.abs(t) * 0.024);
        const tip = at(base, t * 0.018, 0.014, 0.05 - Math.abs(t) * 0.014);
        k.add({
          a: base,
          b: tip,
          ra: 0.027,
          rb: 0.021,
          bone,
          blend: 0.013,
        });
        // the claw: long, curving down and out (to the palm side) from the digit's tip
        const c1 = at(tip, t * 0.004, 0.012, 0.014);
        const c2 = at(c1, t * 0.006, 0.026, 0.038);
        const c3 = at(c2, 0, 0.02, 0.009);
        k.rigid(spike(c1, c2, 0.017, CLAW, 6), bone).rigid(
          spike(c2, c3, 0.011, CLAW, 5),
          bone,
        );
      }
      // pink skin from the wrist down, a tufted fur edge round the wrist
      hands.push({
        a: at(pc, 0, 0, 0.065),
        b: at(pc, 0, 0, 0.2),
        ra: 0.125,
        rb: 0.11,
        color: pink,
        zig: [0.012, 34],
      });
      // the back of the hand furred like the arm, a tufted edge where the bare digits start; the mark's own frame has
      // its x across the hand (the tufts run along it)
      const back = new Euler().setFromRotationMatrix(
        new Matrix4().makeBasis(
          new Vector3(...u),
          new Vector3(-d[0], -d[1], -d[2]),
          new Vector3(...u).cross(new Vector3(-d[0], -d[1], -d[2])),
        ),
        'YXZ',
      );
      hands.push({
        c: at(pc, 0, -0.036, -0.006),
        r: [0.128, 0.094, 0.05],
        rot: [back.x, back.y, back.z],
        color: fur,
        zig: [0.01, 46],
      });
    }
    const f = toonize(k, 0.04, 0.95, [0, 0.56, 0.1]);
    const tl = k.j.tail;
    const marks: ToonMark[] = [
      trousers(0.27, dark),
      ...hands.map(f.bodyMark),
      // a paler belly and a pink tail
      {
        c: [0, 0.37, 0.2],
        r: [0.17, 0.17, 0.12],
        color: face,
        zig: [0.012, 24],
      },
      { a: tl[0], b: tl[3], ra: 0.05, rb: 0.03, color: pink },
      ...(
        [
          // a paler face, the snout pink from halfway
          {
            c: [0, 0.6, 0.25],
            r: [0.17, 0.11, 0.16],
            color: face,
            zig: [0.01, 26],
          },
          {
            a: [0, 0.574, 0.31],
            b: [0, 0.566, 0.44],
            ra: 0.085,
            rb: 0.07,
            color: pink,
            zig: [0.008, 40],
          },
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: {
          x: 0.068,
          y: 0.638,
          size: 0.72,
          iris: 0x5a3a2a,
          lid: face,
          open: 0.012,
        },
        brow: { c: [0.072, 0.672, 0.255], r: [0.045, 0.01, 0.05], color: dark },
        // a smile under the snout
        mouth: { at: [0, 0.53, 0], w: 0.8, drop: 0.025, line: false },
      }),
    ];
    return finish(k, {
      hat: { z: 0.06, scale: 0.8, tilt: -0.26 },
      vest: { cy: 0.36, sy: 0.72 },
      feet: 0.9,
      paint: { base: fur, marks, texture: 0.8 },
    });
  },

  /** Pear-shaped and bottom-heavy, puffy cheeks, a pale muzzle with orange teeth and a flat scaly paddle of a tail. */
  beaver() {
    const fur = 0x8f5e33;
    const dark = 0x5a391e;
    const pale = 0xdcb88e;
    const paddle = 0x4a3020;
    const k = new Kit({
      hips: [0, 0.2, 0],
      spine: [0, 0.36, 0],
      head: [0, 0.58, 0.04],
      shoulder: [0.19, 0.51, 0.05],
      elbow: [0.225, 0.415, 0.1],
      wrist: [0.235, 0.335, 0.15],
      hip: [0.11, 0.19, 0],
      knee: [0.115, 0.125, 0.02],
      ankle: [0.115, 0.065, 0.04],
      tail: [
        [0, 0.15, -0.2],
        [0, 0.08, -0.3],
        [0, 0.07, -0.47],
        [0, 0.07, -0.66],
      ],
      ear: [0.2, 0.87, -0.01],
    });
    k.add({
      c: [0, 0.26, 0],
      r: [0.27, 0.2, 0.25],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.46, 0.01],
        r: [0.21, 0.18, 0.19],
        cuts: CHEST(0.7),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      .add({
        a: [0, 0.55, 0.02],
        b: [0, 0.65, 0.04],
        ra: 0.15,
        rb: 0.15,
        bone: BONE.head,
        blend: 0.07,
      })
      .add({
        c: [0, 0.76, 0.04],
        r: [0.225, 0.2, 0.215],
        cuts: SKULL(0.86),
        bevel: 0.035,
        bone: BONE.head,
        blend: 0.06,
      })
      // puffy cheeks and a round muzzle
      .add(
        {
          c: [0.12, 0.69, 0.14],
          r: [0.105, 0.095, 0.095],
          cuts: [[0, 0, 1, 0.9]],
          bone: BONE.head,
          blend: 0.05,
        },
        true,
      )
      .add({
        c: [0, 0.69, 0.2],
        r: [0.11, 0.085, 0.09],
        cuts: [
          [0, 0, 1, 0.84],
          [0, 1, 0.4, 0.9],
        ],
        bone: BONE.head,
        blend: 0.04,
      })
      .add(
        {
          c: [0.098, 0.85, 0.205],
          r: [0.055, 0.02, 0.035],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.2, 0.875, -0.01],
          r: [0.048, 0.048, 0.028],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.202, 0.878, 0.01],
          r: [0.028, 0.03, 0.016],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          sub: true,
          blend: 0.01,
        },
        true,
      )
      // cheek ruffs over the puffy cheeks
      .tuft([0.2, 0.73, 0.08], [0.285, 0.71, 0.04], 0.045, BONE.head)
      .tuft([0.2, 0.68, 0.1], [0.29, 0.63, 0.07], 0.05, BONE.head)
      .tuft([0.17, 0.635, 0.13], [0.24, 0.575, 0.11], 0.04, BONE.head)
      .limbs([0.072, 0.066, 0.06], [0.08, 0.072, 0.065])
      .tuft([0.22, 0.425, 0.085], [0.265, 0.41, 0.03], 0.035, BONE.foreL, 0.025)
      // the paddle: flat, bald and scaly
      .add({
        a: k.j.tail[0],
        b: k.j.tail[1],
        ra: 0.07,
        rb: 0.05,
        bone: BONE.tail0,
        blend: 0.05,
      })
      .add({
        c: [0, 0.07, -0.48],
        r: [0.15, 0.032, 0.22],
        cuts: [
          [0, 1, 0, 0.7],
          [0, -1, 0, 0.7],
        ],
        bevel: 0.01,
        bone: BONE.tail1,
        blend: 0.04,
      });
    // the famous orange teeth
    for (const s of [1, -1])
      k.rigid(
        part(bbox(0.04, 0.075, 0.026, 0.01), 0xf0a548, {
          x: s * 0.022,
          y: 0.668,
          z: 0.268,
          tint: 0,
        }),
        BONE.head,
      );
    const f = toonize(k, 0.06, 0.9, [0, 0.68, 0.06]);
    const tl = k.j.tail;
    const marks: ToonMark[] = [
      trousers(0.29, dark),
      { c: [0, 0.38, 0.2], r: [0.2, 0.2, 0.12], color: pale, zig: [0.012, 24] },
      // the paddle, crossed with scale lines both ways
      { a: tl[0], b: tl[1], ra: 0.09, rb: 0.07, color: paddle },
      ...(
        [
          { c: [0, 0.07, -0.48], r: [0.17, 0.06, 0.24], color: paddle },
          {
            c: [0, 0.07, -0.48],
            r: [0.17, 0.06, 0.24],
            color: 0x2c1c0f,
            bands: [16, 0.14, 0.5],
          },
          {
            c: [0, 0.07, -0.48],
            r: [0.24, 0.06, 0.17],
            rot: [0, Math.PI / 2, 0],
            color: 0x2c1c0f,
            bands: [16, 0.14],
          },
        ] as ToonMark[]
      ).map(f.bodyMark),
      ...(
        [
          // the pale muzzle and chin, dark ears
          {
            c: [0, 0.68, 0.21],
            r: [0.13, 0.1, 0.12],
            color: pale,
            zig: [0.01, 26],
          },
          ...toonBoth({
            c: [0.2, 0.875, -0.01],
            r: [0.06, 0.06, 0.045],
            rot: [0, 0.3, -0.4],
            color: dark,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: { x: 0.098, y: 0.8, size: 0.95, iris: 0x8a5a24, lid: fur },
        brow: { c: [0.098, 0.857, 0.215], r: [0.05, 0.011, 0.06], color: dark },
        nose: {
          c: [0, 0.738, 0.283],
          w: 0.075,
          h: 0.05,
          d: 0.04,
          color: 0x24160c,
        },
        mouth: { drop: 0.034, w: 0.95, tongue: false },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, null, 1.1);
    return finish(k, {
      hat: { z: 0.0, scale: 0.86, tilt: -0.21 },
      vest: { cy: 0.41, sy: 0.78 },
      feet: 0.92,
      paint: { base: fur, marks, texture: 1 },
    });
  },

  /** Small and round, a pointed snout, a cream face under a brown hood and a coat of two-tone quills. */
  hedgehog() {
    const cream = 0xecd0a4;
    const brown = 0x8a6a4a;
    const dark = 0x6a4f35;
    const quill = 0x56402b;
    const k = new Kit({
      hips: [0, 0.19, 0],
      spine: [0, 0.32, 0],
      head: [0, 0.5, 0.05],
      shoulder: [0.165, 0.41, 0.06],
      elbow: [0.2, 0.34, 0.11],
      wrist: [0.215, 0.29, 0.16],
      hip: [0.1, 0.17, 0],
      knee: [0.1, 0.115, 0.02],
      ankle: [0.1, 0.06, 0.03],
      tail: [
        [0, 0.16, -0.2],
        [0, 0.14, -0.24],
        [0, 0.13, -0.27],
        [0, 0.125, -0.3],
      ],
      ear: [0.15, 0.78, 0],
    });
    k.add({
      c: [0, 0.25, 0],
      r: [0.24, 0.19, 0.23],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.38, 0],
        r: [0.22, 0.18, 0.21],
        cuts: CHEST(0.6),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      .add({
        a: [0, 0.48, 0.03],
        b: [0, 0.56, 0.06],
        ra: 0.14,
        rb: 0.14,
        bone: BONE.head,
        blend: 0.08,
      })
      .add({
        c: [0, 0.645, 0.07],
        r: [0.195, 0.185, 0.195],
        cuts: SKULL(0.86),
        bevel: 0.03,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.09, 0.6, 0.15],
          r: [0.08, 0.07, 0.08],
          bone: BONE.head,
          blend: 0.05,
        },
        true,
      )
      .add({
        c: [0, 0.605, 0.26],
        r: [0.075, 0.062, 0.13],
        rot: [-0.05, 0, 0],
        cuts: [
          [0, 1, 0.1, 0.84],
          [1, 0, 0.2, 0.86],
          [-1, 0, 0.2, 0.86],
        ],
        bevel: 0.02,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.08, 0.695, 0.215],
          r: [0.045, 0.016, 0.03],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.15, 0.785, 0.0],
          r: [0.045, 0.048, 0.024],
          rot: [0, 0.3, -0.45],
          bone: BONE.earL,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.152, 0.788, 0.018],
          r: [0.027, 0.03, 0.014],
          rot: [0, 0.3, -0.45],
          bone: BONE.earL,
          sub: true,
          blend: 0.01,
        },
        true,
      )
      // soft cream tufts on the cheeks
      .tuft([0.15, 0.6, 0.1], [0.225, 0.58, 0.06], 0.04, BONE.head)
      .tuft([0.14, 0.56, 0.13], [0.205, 0.52, 0.11], 0.035, BONE.head)
      .limbs([0.055, 0.05, 0.046], [0.06, 0.055, 0.05])
      .add({
        a: k.j.tail[0],
        b: k.j.tail[3],
        ra: 0.03,
        rb: 0.012,
        bone: BONE.tail0,
        blend: 0.03,
      });
    // quills: a fan over the back half of the torso and the crown, each leaning back and out, with a pale tip
    const back = k.shapes.filter((s) => !s.sub && s.bone === BONE.spine);
    const crown = k.shapes.filter((s) => !s.sub && s.bone === BONE.head);
    const n = 90;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = 0.18 + t * 0.62;
      const az = Math.PI + (((i * 0.618034) % 1) * 2 - 1) * 1.55; // round the back (-z)
      const onHead = y > 0.56;
      if (onHead && y > 0.7) continue; // under the hat
      const o: V3 = onHead ? [0, y, 0.06] : [0, y, 0];
      const p = surfaceRay(onHead ? crown : back, o, [
        Math.sin(az),
        0,
        Math.cos(az),
      ]);
      if (Math.hypot(p[0] - o[0], p[2] - o[2]) < 0.05) continue;
      const out = new Vector3(
        Math.sin(az),
        0.35 + t * 0.6,
        Math.cos(az) - 0.4,
      ).normalize();
      const len = 0.15 + 0.05 * Math.sin(i * 12.9);
      const a: V3 = [
        p[0] - out.x * 0.02,
        p[1] - out.y * 0.02,
        p[2] - out.z * 0.02,
      ];
      const b: V3 = [
        p[0] + out.x * len,
        p[1] + out.y * len,
        p[2] + out.z * len,
      ];
      const bone = onHead ? BONE.head : BONE.spine;
      // the vest covers the middle of the back: no quills poking through it (their base is placed after the lift)
      const vr: VestRule = { base: [p[0], p[1] + 0.05, p[2]] };
      k.rigid(spike(a, b, 0.026, quill, 5), bone, vr).rigid(
        spike(
          [
            a[0] + out.x * len * 0.7,
            a[1] + out.y * len * 0.7,
            a[2] + out.z * len * 0.7,
          ],
          [b[0] + out.x * 0.02, b[1] + out.y * 0.02, b[2] + out.z * 0.02],
          0.01,
          0xf3e6cc,
          4,
        ),
        bone,
        vr,
      );
    }
    const f = toonize(k, 0.05, 0.92, [0, 0.6, 0.07]);
    const marks: ToonMark[] = [
      trousers(0.27, dark),
      ...sleeves(k, brown, 0.075, 0.068),
      // the brown back under the quills
      f.bodyMark({
        c: [0, 0.4, -0.13],
        r: [0.3, 0.36, 0.2],
        color: brown,
        zig: [0.012, 24],
      }),
      ...(
        [
          // a brown hood over the crown and the back of the head, a cream face; pink ears
          {
            c: [0, 0.76, 0.02],
            r: [0.27, 0.15, 0.23],
            color: brown,
            zig: [0.012, 26],
          },
          ...toonBoth({
            c: [0.152, 0.788, 0.018],
            r: [0.03, 0.033, 0.02],
            rot: [0, 0.3, -0.45],
            color: PINK,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: { x: 0.085, y: 0.675, size: 0.92, iris: 0x6a3d1a, lid: cream },
        brow: { c: [0.08, 0.702, 0.23], r: [0.045, 0.01, 0.06], color: brown },
        nose: {
          c: [0, 0.605, 0.39],
          w: 0.045,
          h: 0.036,
          d: 0.032,
          color: 0x1c120c,
        },
        mouth: { w: 0.7, drop: 0.036 },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, null, 0.95);
    return finish(k, {
      hat: { z: 0.03, scale: 0.78, tilt: -0.26 },
      vest: { cy: 0.36, sy: 0.7 },
      feet: 0.82,
      paint: { base: cream, marks, texture: 1 },
    });
  },

  /** Hunched under a banded shell, a long narrow snout, tall leathery ears and a long ringed tail. */
  armadillo() {
    const skin = 0xcdb5b5;
    const shell = 0x8b7c82;
    const band = 0x6c5f66;
    const k = new Kit({
      hips: [0, 0.2, 0],
      spine: [0, 0.34, 0],
      head: [0, 0.5, 0.08],
      shoulder: [0.165, 0.43, 0.07],
      elbow: [0.2, 0.35, 0.11],
      wrist: [0.215, 0.3, 0.16],
      hip: [0.1, 0.17, 0],
      knee: [0.1, 0.115, 0.02],
      ankle: [0.1, 0.06, 0.035],
      tail: [
        [0, 0.2, -0.24],
        [0, 0.15, -0.39],
        [0, 0.1, -0.54],
        [0, 0.05, -0.7],
      ],
      ear: [0.16, 0.76, 0.03],
    });
    k.add({
      c: [0, 0.25, 0],
      r: [0.235, 0.2, 0.22],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.4, 0.01],
        r: [0.215, 0.18, 0.2],
        cuts: CHEST(0.6),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      .add({
        a: [0, 0.48, 0.05],
        b: [0, 0.58, 0.09],
        ra: 0.11,
        rb: 0.11,
        bone: BONE.head,
        blend: 0.07,
      })
      .add({
        c: [0, 0.645, 0.1],
        r: [0.15, 0.14, 0.17],
        cuts: SKULL(0.88),
        bevel: 0.025,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.07, 0.6, 0.17],
          r: [0.065, 0.055, 0.07],
          bone: BONE.head,
          blend: 0.05,
        },
        true,
      )
      .add(
        {
          c: [0.07, 0.69, 0.215],
          r: [0.042, 0.014, 0.03],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      // the long narrow snout
      .add({
        a: [0, 0.61, 0.2],
        b: [0, 0.59, 0.47],
        ra: 0.062,
        rb: 0.03,
        bone: BONE.head,
        blend: 0.05,
      })
      // tall leathery ears
      .add(
        {
          c: [0.165, 0.79, 0.03],
          r: [0.038, 0.095, 0.016],
          rot: [0, 0.3, -0.55],
          bone: BONE.earL,
          blend: 0.025,
        },
        true,
      )
      .add(
        {
          c: [0.167, 0.795, 0.042],
          r: [0.024, 0.07, 0.01],
          rot: [0, 0.3, -0.55],
          bone: BONE.earL,
          sub: true,
          blend: 0.008,
        },
        true,
      )
      .limbs([0.055, 0.05, 0.046], [0.065, 0.06, 0.055])
      .tail([0.065, 0.05, 0.033, 0.015]);
    // the shell: overlapping bands round the back, a little bigger towards the hips; flat plates with highlighted
    // edges, riding the chest
    for (let b = 0; b < 7; b++) {
      const t0 = 0.35 + b * 0.19;
      const g = new SphereGeometry(
        0.285 + b * 0.004,
        16,
        3,
        Math.PI * 0.95,
        Math.PI * 1.1,
        t0,
        0.24,
      );
      k.rigid(
        part(g, b % 2 ? band : shell, {
          y: 0.4,
          sz: 0.95,
          tint: 0.07,
          edges: true,
        }),
        b < 4 ? BONE.spine : BONE.hips,
        'over',
      );
    }
    // a scaly cap on the head
    k.rigid(
      part(
        new SphereGeometry(1, 14, 8).scale(0.125, 0.055, 0.15).rotateX(0.15),
        shell,
        {
          y: 0.735,
          z: 0.085,
          smooth: true,
          cuts: [[0, 1, 0, 0.04]],
          tint: 0.07,
        },
      ),
      BONE.head,
    );
    const f = toonize(k, 0.05, 0.92, [0, 0.6, 0.1]);
    const tl = k.j.tail;
    const marks: ToonMark[] = [
      trousers(0.25, shell),
      // the tail plated and ringed like the shell (it runs straight: one cone)
      { a: tl[0], b: tl[3], ra: 0.09, rb: 0.04, color: shell },
      {
        a: tl[0],
        b: tl[3],
        ra: 0.09,
        rb: 0.04,
        color: band,
        bands: [12, 0.4, 0.3],
      },
      {
        c: [0, 0.37, 0.2],
        r: [0.15, 0.15, 0.12],
        color: 0xe2cfcd,
        zig: [0.01, 26],
      },
      ...toonBoth({
        c: [0.167, 0.795, 0.042],
        r: [0.028, 0.075, 0.016],
        rot: [0, 0.3, -0.55],
        color: PINK,
      }).map(f.headMark),
      ...toonFace(k, f, {
        eye: {
          x: 0.074,
          y: 0.665,
          size: 0.82,
          iris: 0x5a3a24,
          lid: 0xb59d9f,
          rot: [0, 0.4, -0.12],
        },
        brow: { c: [0.072, 0.697, 0.225], r: [0.04, 0.009, 0.06], color: band },
        nose: {
          c: [0, 0.59, 0.485],
          w: 0.042,
          h: 0.032,
          d: 0.025,
          color: 0x4a3a3e,
        },
        mouth: { w: 0.55, drop: 0.03, tongue: false },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, CLAW, 0.95);
    return finish(k, {
      hat: { z: 0.04, scale: 0.74, tilt: -0.26 },
      vest: { cy: 0.36, sy: 0.68 },
      feet: 0.82,
      paint: { base: skin, marks, texture: 0.55 },
    });
  },

  /** Tall and lean on long limbs: a bandit mask, pointed ears, cheek ruffs, dark forearms and a bushy ringed tail. */
  raccoon() {
    const fur = 0x8e929f;
    const dark = 0x2a2a33;
    const white = 0xeceef2;
    const k = new Kit({
      hips: [0, 0.26, 0],
      spine: [0, 0.42, 0],
      head: [0, 0.66, 0.02],
      shoulder: [0.19, 0.6, 0.03],
      elbow: [0.23, 0.5, 0.065],
      wrist: [0.25, 0.39, 0.1],
      hip: [0.1, 0.22, 0],
      knee: [0.105, 0.14, 0.015],
      ankle: [0.11, 0.07, 0.03],
      tail: [
        [0, 0.2, -0.22],
        [0, 0.3, -0.4],
        [0, 0.46, -0.5],
        [0, 0.62, -0.5],
      ],
      ear: [0.15, 0.95, -0.01],
    });
    k.add({
      c: [0, 0.31, 0],
      r: [0.22, 0.19, 0.2],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.5, 0],
        r: [0.21, 0.2, 0.19],
        cuts: CHEST(),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      .add({
        a: [0, 0.62, 0.01],
        b: [0, 0.73, 0.03],
        ra: 0.12,
        rb: 0.12,
        bone: BONE.head,
        blend: 0.07,
      })
      .add({
        c: [0, 0.83, 0.03],
        r: [0.225, 0.19, 0.2],
        cuts: SKULL(0.84),
        bevel: 0.035,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.11, 0.77, 0.11],
          r: [0.09, 0.07, 0.09],
          cuts: [[0, -1, 0.2, 0.8]],
          bone: BONE.head,
          blend: 0.06,
        },
        true,
      )
      // a pointed muzzle
      .add({
        c: [0, 0.785, 0.2],
        r: [0.08, 0.062, 0.12],
        rot: [-0.05, 0, 0],
        cuts: [
          [0, 1, 0.1, 0.84],
          [1, 0, 0.2, 0.86],
          [-1, 0, 0.2, 0.86],
        ],
        bevel: 0.02,
        bone: BONE.head,
        blend: 0.06,
      })
      .add(
        {
          c: [0.09, 0.905, 0.19],
          r: [0.062, 0.022, 0.04],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.035,
        },
        true,
      )
      // pointed ears with a white inside
      .add(
        {
          c: [0.155, 0.97, -0.01],
          r: [0.06, 0.09, 0.026],
          rot: [0, 0.25, -0.35],
          cuts: [
            [1, 1, 0, 0.8],
            [-1, 1, 0, 0.8],
          ],
          bone: BONE.earL,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.157, 0.97, 0.012],
          r: [0.035, 0.06, 0.014],
          rot: [0, 0.25, -0.35],
          bone: BONE.earL,
          sub: true,
          blend: 0.01,
        },
        true,
      )
      // big cheek ruffs sweeping out and down
      .tuft([0.18, 0.81, 0.06], [0.29, 0.8, 0.0], 0.05, BONE.head)
      .tuft([0.18, 0.765, 0.08], [0.305, 0.715, 0.03], 0.06, BONE.head)
      .tuft([0.16, 0.72, 0.1], [0.255, 0.65, 0.08], 0.05, BONE.head)
      .limbs([0.06, 0.054, 0.048], [0.065, 0.058, 0.052])
      .tuft([0.225, 0.51, 0.05], [0.275, 0.495, 0.0], 0.035, BONE.foreL, 0.025)
      // the bushy tail, a fan of tufts at the tip
      .tail([0.075, 0.105, 0.095, 0.045]);
    const t = k.j.tail;
    k.tuft(
      t[2],
      [0.045, t[3][1] + 0.03, t[3][2] - 0.01],
      0.05,
      BONE.tail2,
      0.03,
    );
    const f = toonize(k, 0.05, 0.86, [0, 0.76, 0.04]);
    const tl = k.j.tail;
    const at = (a: V3, b: V3, u: number): V3 => [
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
    ];
    const marks: ToonMark[] = [
      // dark lower legs and forearms
      trousers(0.21, dark),
      ...sleeves(k, dark, 0.07, 0.066, 'elbow'),
      // dark rings round the tail, the tip dark
      {
        a: at(tl[0], tl[1], 0.45),
        b: tl[1],
        ra: 0.14,
        rb: 0.15,
        color: dark,
        bands: [11, 0.42],
      },
      {
        a: tl[1],
        b: tl[2],
        ra: 0.15,
        rb: 0.14,
        color: dark,
        bands: [11, 0.42, 0.55],
      },
      {
        a: tl[2],
        b: tl[3],
        ra: 0.14,
        rb: 0.1,
        color: dark,
        bands: [11, 0.5, 0.1],
      },
      ...(
        [
          // the bandit mask, a dark stripe up the nose, the white muzzle; white inside the ears
          {
            c: [0, 0.865, 0.16],
            r: [0.25, 0.066, 0.15],
            color: dark,
            zig: [0.012, 22],
          },
          {
            c: [0, 0.83, 0.26],
            r: [0.022, 0.09, 0.1],
            rot: [0.5, 0, 0],
            color: dark,
          },
          {
            c: [0, 0.775, 0.22],
            r: [0.105, 0.075, 0.14],
            color: white,
            zig: [0.008, 30],
          },
          ...toonBoth({
            c: [0.157, 0.97, 0.012],
            r: [0.04, 0.065, 0.02],
            rot: [0, 0.25, -0.35],
            color: white,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: { x: 0.088, y: 0.865, size: 0.95, iris: 0xa0662a, lid: dark },
        // pale brows over the mask
        brow: {
          c: [0.09, 0.915, 0.205],
          r: [0.058, 0.013, 0.06],
          color: 0xdcdee4,
        },
        nose: {
          c: [0, 0.79, 0.322],
          w: 0.05,
          h: 0.036,
          d: 0.03,
          color: 0x18181e,
        },
        mouth: { w: 0.85 },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, null, 1.05);
    return finish(k, {
      hat: { z: 0.0, scale: 0.84, tilt: -0.21 },
      vest: { cy: 0.45, sy: 0.82 },
      feet: 0.9,
      paint: { base: fur, marks, texture: 1 },
    });
  },

  /** A barrel on short legs with a big blunt head held forward, eyes and ears high up, a dark square muzzle. */
  capybara() {
    const fur = 0xa8794b;
    const dark = 0x6b4a2f;
    const pale = 0xc99d6e;
    const k = new Kit({
      hips: [0, 0.2, 0],
      spine: [0, 0.36, 0],
      head: [0, 0.55, 0.08],
      // shoulders out on the sides (not on the chest under the vest's front)
      shoulder: [0.265, 0.45, 0.02],
      elbow: [0.285, 0.36, 0.08],
      wrist: [0.29, 0.29, 0.14],
      hip: [0.12, 0.18, 0],
      knee: [0.12, 0.12, 0.02],
      ankle: [0.12, 0.065, 0.04],
      tail: [
        [0, 0.22, -0.24],
        [0, 0.21, -0.28],
        [0, 0.2, -0.31],
        [0, 0.19, -0.33],
      ],
      ear: [0.135, 0.87, 0],
    });
    k.add({
      c: [0, 0.28, 0],
      r: [0.28, 0.2, 0.27],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.42, 0.02],
        r: [0.27, 0.18, 0.26],
        cuts: CHEST(0.7),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.12,
      })
      .add({
        a: [0, 0.5, 0.06],
        b: [0, 0.62, 0.1],
        ra: 0.15,
        rb: 0.14,
        bone: BONE.head,
        blend: 0.08,
      })
      .add({
        c: [0, 0.715, 0.12],
        r: [0.185, 0.17, 0.26],
        cuts: SKULL(0.9),
        bevel: 0.03,
        bone: BONE.head,
        blend: 0.06,
      })
      // the long blunt snout, squared off, a rounder chin
      .add({
        c: [0, 0.665, 0.33],
        r: [0.15, 0.135, 0.15],
        cuts: [
          [0, 0, 1, 0.8],
          [0, 1, 0.3, 0.86],
          [1, 0, 0, 0.88],
          [-1, 0, 0, 0.88],
        ],
        bevel: 0.025,
        bone: BONE.head,
        blend: 0.06,
      })
      .add({
        c: [0, 0.6, 0.32],
        r: [0.1, 0.055, 0.11],
        bone: BONE.head,
        blend: 0.04,
      })
      .add(
        {
          c: [0.13, 0.84, 0.21],
          r: [0.045, 0.016, 0.03],
          rot: [0.2, 0.45, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.135, 0.88, 0.0],
          r: [0.04, 0.042, 0.022],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          blend: 0.025,
        },
        true,
      )
      .add(
        {
          c: [0.137, 0.884, 0.016],
          r: [0.024, 0.026, 0.012],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          sub: true,
          blend: 0.008,
        },
        true,
      )
      // a few coarse tufts on the cheeks
      .tuft([0.165, 0.7, 0.14], [0.235, 0.675, 0.1], 0.038, BONE.head)
      .tuft([0.16, 0.655, 0.18], [0.215, 0.61, 0.16], 0.032, BONE.head)
      .limbs([0.075, 0.068, 0.062], [0.08, 0.072, 0.065])
      .tuft([0.25, 0.36, 0.1], [0.3, 0.345, 0.05], 0.035, BONE.foreL, 0.025)
      .add({
        a: k.j.tail[0],
        b: k.j.tail[3],
        ra: 0.035,
        rb: 0.02,
        bone: BONE.tail0,
        blend: 0.03,
      });
    for (const s of [1, -1])
      k.rigid(
        part(
          new SphereGeometry(1, 10, 6)
            .scale(0.024, 0.008, 0.009)
            .rotateZ(s * 0.4),
          0x1d120a,
          { x: s * 0.038, y: 0.712, z: 0.466, tint: 0 },
        ),
        BONE.head,
      );
    const f = toonize(k, 0.05, 0.92, [0, 0.7, 0.18]);
    const marks: ToonMark[] = [
      trousers(0.25, dark),
      {
        c: [0, 0.38, 0.22],
        r: [0.22, 0.18, 0.13],
        color: pale,
        zig: [0.012, 24],
      },
      ...(
        [
          // the dark front of the snout, a pale chin, dark ears
          {
            c: [0, 0.69, 0.46],
            r: [0.13, 0.09, 0.06],
            color: 0x845b3a,
            zig: [0.008, 28],
          },
          { c: [0, 0.59, 0.33], r: [0.11, 0.06, 0.12], color: pale },
          ...toonBoth({
            c: [0.135, 0.88, 0.0],
            r: [0.05, 0.052, 0.04],
            rot: [0, 0.3, -0.4],
            color: dark,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: {
          x: 0.13,
          y: 0.79,
          size: 0.85,
          iris: 0x6a4020,
          lid: fur,
          rot: [0, 0.5, -0.1],
        },
        brow: {
          c: [0.13, 0.845, 0.22],
          r: [0.045, 0.01, 0.06],
          rot: [0.2, 0.45, -0.18],
          color: dark,
        },
        nose: {
          c: [0, 0.705, 0.45],
          w: 0.13,
          h: 0.06,
          d: 0.03,
          color: 0x3f2818,
        },
        mouth: { w: 1.1, drop: 0.06 },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, null, 1.15);
    return finish(k, {
      hat: { z: 0.04, scale: 0.82, tilt: -0.18 },
      vest: { cy: 0.38, sy: 0.72 },
      feet: 0.95,
      paint: { base: fur, marks, texture: 1 },
    });
  },

  /** The tallest and slimmest: a long sinuous body, a small flat head with whiskers, a cream front and a thick tail. */
  otter() {
    const fur = 0x80593a;
    const dark = 0x573a24;
    const cream = 0xecd4b0;
    const k = new Kit({
      hips: [0, 0.26, 0],
      spine: [0, 0.44, 0],
      head: [0, 0.74, 0.03],
      shoulder: [0.155, 0.635, 0.04],
      elbow: [0.185, 0.525, 0.08],
      wrist: [0.2, 0.43, 0.11],
      hip: [0.1, 0.22, 0],
      knee: [0.1, 0.14, 0.015],
      ankle: [0.1, 0.07, 0.03],
      tail: [
        [0, 0.2, -0.18],
        [0, 0.14, -0.36],
        [0, 0.09, -0.53],
        [0, 0.05, -0.7],
      ],
      ear: [0.155, 0.94, -0.01],
    });
    k.add({
      c: [0, 0.3, 0],
      r: [0.2, 0.19, 0.19],
      cuts: [[0, -1, 0, 0.8]],
      bone: BONE.hips,
    })
      .add({
        c: [0, 0.52, 0],
        r: [0.18, 0.22, 0.17],
        cuts: CHEST(0.5),
        bevel: 0.03,
        bone: BONE.spine,
        blend: 0.14,
      })
      .add({
        a: [0, 0.66, 0.02],
        b: [0, 0.8, 0.04],
        ra: 0.115,
        rb: 0.11,
        bone: BONE.head,
        blend: 0.08,
      })
      .add({
        c: [0, 0.885, 0.04],
        r: [0.172, 0.145, 0.172],
        cuts: SKULL(0.88),
        bevel: 0.03,
        bone: BONE.head,
        blend: 0.06,
      })
      .add({
        c: [0, 0.835, 0.17],
        r: [0.115, 0.08, 0.1],
        cuts: [
          [0, 0, 1, 0.84],
          [0, 1, 0.3, 0.88],
        ],
        bone: BONE.head,
        blend: 0.05,
      })
      .add(
        {
          c: [0.08, 0.95, 0.17],
          r: [0.045, 0.015, 0.03],
          rot: [0.2, 0.3, -0.15],
          bone: BONE.head,
          blend: 0.03,
        },
        true,
      )
      .add(
        {
          c: [0.155, 0.945, -0.01],
          r: [0.036, 0.036, 0.02],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          blend: 0.025,
        },
        true,
      )
      .add(
        {
          c: [0.157, 0.947, 0.006],
          r: [0.02, 0.02, 0.01],
          rot: [0, 0.3, -0.4],
          bone: BONE.earL,
          sub: true,
          blend: 0.008,
        },
        true,
      )
      // sleek short tufts at the cheeks
      .tuft([0.13, 0.855, 0.08], [0.205, 0.835, 0.05], 0.035, BONE.head)
      .tuft([0.12, 0.815, 0.1], [0.19, 0.78, 0.08], 0.03, BONE.head)
      .limbs([0.052, 0.048, 0.044], [0.062, 0.056, 0.05])
      .tuft([0.18, 0.535, 0.065], [0.22, 0.52, 0.015], 0.03, BONE.foreL, 0.025)
      // the thick tapering tail
      .tail([0.1, 0.08, 0.055, 0.02]);
    // whiskers
    for (const s of [1, -1])
      for (const w of [-1, 0, 1])
        k.rigid(
          part(
            new CylinderGeometry(0.0028, 0.0028, 0.12, 4).rotateZ(Math.PI / 2),
            0xfffaf0,
            {
              x: s * 0.13,
              y: 0.83 + w * 0.018,
              z: 0.215,
              ry: s * w * 0.25,
              tint: 0,
            },
          ),
          BONE.head,
        );
    const f = toonize(k, 0.07, 0.88, [0, 0.84, 0.05]);
    const marks: ToonMark[] = [
      trousers(0.29, dark),
      ...sleeves(k, dark, 0.065, 0.06, 'elbow'),
      // the cream throat and chest
      {
        c: [0, 0.68, 0.17],
        r: [0.14, 0.24, 0.12],
        color: cream,
        zig: [0.012, 24],
      },
      ...(
        [
          // the cream lower face (muzzle, cheeks, chin), dark ear bowls
          {
            c: [0, 0.815, 0.16],
            r: [0.165, 0.085, 0.16],
            color: cream,
            zig: [0.01, 26],
          },
          ...toonBoth({
            c: [0.157, 0.947, 0.006],
            r: [0.024, 0.024, 0.016],
            rot: [0, 0.3, -0.4],
            color: dark,
          }),
        ] as ToonMark[]
      ).map(f.headMark),
      ...toonFace(k, f, {
        eye: { x: 0.08, y: 0.912, size: 0.85, iris: 0x7a4a20, lid: fur },
        brow: { c: [0.08, 0.957, 0.18], r: [0.045, 0.01, 0.06], color: dark },
        nose: {
          c: [0, 0.862, 0.262],
          w: 0.06,
          h: 0.04,
          d: 0.03,
          color: 0x1c120c,
        },
        mouth: { w: 0.8, drop: 0.04 },
      }),
    ];
    for (const s of [1, -1]) fingerGlove(k, s, null, 0.95);
    return finish(k, {
      hat: { z: 0.03, scale: 0.74, tilt: -0.24 },
      vest: { cy: 0.49, sy: 0.85 },
      feet: 0.85,
      paint: { base: fur, marks, texture: 1 },
    });
  },
};

const cache = new Map<CritterId, CritterModel>();

/** A critter's model (generated once per page, then copied: every crew owns and disposes its own geometry). */
export function buildCritter(id: CritterId): CritterModel {
  let m = cache.get(id);
  if (!m) {
    m = BUILDERS[id]();
    cache.set(id, m);
  }
  return { ...m, geometry: m.geometry.clone() };
}
