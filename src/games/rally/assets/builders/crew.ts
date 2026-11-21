import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Vector3,
  type Material,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { merge } from '../../engine/geo';
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
  packNormals,
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
  mapCell,
  tag,
} from './people-parts';
import { shoesOf } from './people-shoes';
import { clipAll, field, join, posed, type Surf } from './people-surf';
import {
  between,
  heightIn,
  painted,
  split,
  splitIn,
  tailor,
  top,
  type Piece,
  type Tailor,
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
  /** The car's colours: suit, its panels and trim; the helmet's paint. */
  colors: { base: string; accent: string; accent2: string };
}

/** What a part is drawn with: the body's skin, the people atlas (cloth and matt gear), a glossy paint (helmet shells). */
export type CrewLook = `skin|${string}` | 'atlas' | 'crew_gloss';

export interface CrewPart {
  geometry: BufferGeometry;
  look: CrewLook;
}

const MODEL: BodyModel = 'male';
const SKIN = ['#d9a581', '#cc9470', '#b97f5a', '#9a6542', '#865535'];
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
const PANEL = ['#eeeeea', '#23252b'];
const GLOVE_COLOR = '#1a1b1f';

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const shade = (css: string, k: number): string =>
  `#${new Color(css).multiplyScalar(k).getHexString()}`;

/** How far apart two colours are (0 = the same, ~1.7 = black to white). */
const apart = (a: string, b: string): number => {
  const x = new Color(a);
  const y = new Color(b);
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
};

/**
 * A suit in the car's colour: its panels (shoulders, legs) white or charcoal, whichever stands out on it, the trim one
 * of the livery's accents, and the harness in the webbing that shows on both.
 */
function suitColors(c: CrewParams['colors']): {
  panel: string;
  trim: string;
  webbing: string;
} {
  const far = (list: string[], from: string[]): string =>
    list.reduce((best, x) => {
      const d = (y: string): number =>
        Math.min(...from.map((f) => apart(y, f)));
      return d(x) > d(best) ? x : best;
    });
  const panel = far(PANEL, [c.base]);
  return {
    panel,
    trim: far([c.accent, c.accent2], [c.base, panel]),
    webbing: far(WEBBING, [c.base, panel]),
  };
}

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
        const i = pick(
          (px, py) => Math.abs(px - x) < win && Math.abs(py - y) < win,
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
      return { y: p[i * 3 + 1], z: p[i * 3 + 2] };
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

/** A race suit: plain close-cut overalls with the panels of one - yoke, epaulettes, belt, patches, leg bands. */
function raceSuit(
  t: Tailor,
  c: CrewParams['colors'],
): { pieces: Piece[]; cover: Float32Array } {
  const rig = RIGS[t.m];
  const Y = heightIn(t);
  const X = (s: Surf, i: number): number => Math.abs(s.a.pos[i * 3]);
  const front = (s: Surf, i: number): number => s.a.nor[i * 3 + 2] * 0.05;
  // The second colour has to show on the first: the one further from it.
  const { panel, trim } = suitColors(c);
  const suit = top(t, {
    color: c.base,
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
    trim: shade(panel, 0.9),
    collar: 0.05,
    suit: { hem: 0.11, cell: F_TWILL, flare: 0.006 },
  });
  let out = suit.pieces;
  // Yoke over the shoulders, front and back, carried down the outside of the sleeves.
  const yoke = (s: Surf, i: number): number =>
    s.a.pos[i * 3 + 1] + rig.hip - (rig.chest - 0.075);
  out = split(out, yoke, { color: panel, fixed: true });
  // The gauntlets of the gloves over the ends of the sleeves, a band of the trim colour round their edge: cut square
  // to the forearm, measured back from the wrist.
  const fore = [0, 1, 2].map((k) => rig.wrist[k] - rig.elbow[k]);
  const fl = Math.hypot(...fore);
  const upArm = (s: Surf, i: number): number => {
    const p = s.a.pos;
    const sd = Math.sign(p[i * 3]) || 1;
    return (
      -(
        (p[i * 3] * sd - rig.wrist[0]) * fore[0] +
        (p[i * 3 + 1] + rig.hip - rig.wrist[1]) * fore[1] +
        (p[i * 3 + 2] - rig.wrist[2]) * fore[2]
      ) / fl
    );
  };
  out = splitIn(
    out,
    { arm: [(s, i) => 0.1 - upArm(s, i)] },
    {
      color: GLOVE_COLOR,
      cell: GLOVE,
      raise: 0.005,
      slope: 0.004,
      fixed: true,
    },
  );
  out = splitIn(
    out,
    { arm: [(s, i) => 0.116 - upArm(s, i)] },
    { color: trim, cell: GLOVE, raise: 0.005, slope: 0.004, fixed: true },
  );
  // Epaulettes: the straps a marshal pulls a driver out by.
  out = splitIn(
    out,
    {
      torso: [
        ...between(X, 0.09, 0.165),
        (s, i) => 0.02 - Math.abs(s.a.pos[i * 3 + 2] - rig.shoulder[2] - 0.02),
        (s, i) => (s.a.nor[i * 3 + 1] - 0.3) * 0.05,
      ],
    },
    { color: trim, raise: 0.005, slope: 0.006, fixed: true },
  );
  // The belt of the suit and the flap over the zip.
  out = splitIn(
    out,
    { torso: between(Y, rig.waist + 0.05, rig.waist + 0.095) },
    { color: shade(c.base, 0.82), raise: 0.003, fixed: true },
  );
  out = splitIn(
    out,
    {
      torso: [
        (s, i) => 0.011 - X(s, i),
        front,
        (s, i) => rig.chest + 0.04 - Y(s, i),
      ],
    },
    { color: shade(c.base, 0.8), raise: 0.002, fixed: true },
  );
  // Patches on the chest: a light one on the left, the trim colour on the right.
  const patch = (sd: number, color: string, y0: number, y1: number): void => {
    out = splitIn(
      out,
      {
        torso: [
          ...between((s, i) => s.a.pos[i * 3] * sd, 0.04, 0.125),
          ...between(Y, y0, y1),
          front,
        ],
      },
      { color, fixed: true },
    );
  };
  patch(1, '#f1f1ec', rig.chest - 0.165, rig.chest - 0.11);
  patch(-1, trim, rig.chest - 0.155, rig.chest - 0.12);
  // Knee to ankle: a band of the panel colour down the outside of each leg.
  out = splitIn(
    out,
    {
      leg: [
        (s, i) => (Math.sign(s.a.pos[i * 3]) * s.a.nor[i * 3] - 0.9) * 0.05,
      ],
    },
    { color: panel, fixed: true },
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

/** The six-point harness and the head restraint under it, on the posed body. */
function restraint(
  t: Tailor,
  bones: Matrix4[],
  headAt: Matrix4,
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

  for (const sd of [1, -1]) {
    const tp = sf.top(X0);
    // Head restraint: a leg of the yoke over each collarbone.
    {
      const pts = [
        v(sd * X0, tp.y + OFF - 0.012, tp.z - 0.085),
        v(sd * X0, tp.y + OFF - 0.002, tp.z - 0.03),
        v(sd * X0, tp.y + OFF - 0.006, tp.z + 0.03),
      ];
      for (const dy of [0.05, 0.1, 0.15])
        pts.push(v(sd * X0, tp.y - dy, sf.z(X0, tp.y - dy) + OFF - 0.004));
      const nor = over(pts, v(0, 1, 0), v(0, 0.2, 1).normalize(), 3);
      out.push(
        strap(
          pts.map((p) => p.clone().applyMatrix4(spine)),
          nor.map((n) => n.clone().transformDirection(spine)),
          0.056,
          0.014,
          CARBON,
          HAT,
        ),
      );
    }
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
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const y = y0 + (y1 - y0) * f;
        const x = X0 + (0.036 - X0) * f * f * (3 - 2 * f);
        const onYoke = y > tp.y - 0.155 ? 0.013 : 0;
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
      out.push(strap(p, n, 0.068, 0.004, webbing));
      // The adjuster on the chest.
      const k = 4 + Math.round(steps * 0.45);
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
    // Lap strap: from the buckle round the hip down to the seat.
    {
      // Over the belly with the body, then (the pelvis does not move) over the hip crease and down beside the hip.
      const belly = [0.03, 0.085].map((x, i) =>
        v(sd * x, buckleY + i * 0.006, sf.z(x, buckleY + i * 0.006) + OFF),
      );
      const [p, n] = skinned(
        belly,
        belly.map(() => v(0, 0.25, 1).normalize()),
      );
      const hipside: [number, number, number, number, number, number][] = [
        [0.14, buckleY - 0.01, 0.075, 0.3, 0.6, 0.75],
        [0.185, buckleY - 0.045, 0.025, 0.75, 0.5, 0.4],
        [0.21, 0.02, -0.03, 1, 0.15, 0.1],
        [0.215, -0.08, -0.07, 1, 0, 0],
      ];
      for (const [x, y, z, nx, ny, nz] of hipside) {
        p.push(v(sd * x, y, z));
        n.push(v(sd * nx, ny, nz).normalize());
      }
      out.push(strap(p, n, 0.068, 0.004, webbing));
    }
  }
  {
    const [p, n] = skinned([buckle], [v(0, 0.15, 1).normalize()]);
    out.push(...camLock(p[0], n[0], v(0, 1, 0)));
  }

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
  seed: number,
  codriver: boolean,
  lod: number,
  params: CrewParams,
): CrewPart[] {
  const hi = lod === 0;
  const skin = new Rng(seed).pick(SKIN);
  const c = params.colors;
  const sat = sitIn(params.cockpit, codriver);
  const bp = poseBones(MODEL, sat.pose);
  const t = tailor(MODEL, lod);
  const abs = RIGS[MODEL];
  const rig = bodyRig(MODEL);
  const warp = (s: Surf, out: Float32Array): void =>
    widen(s.a.pos, s.a.arm, s.n, abs, 1, out);

  // The suit, and the body where nothing covers it: only the head (the gloves are built on the grips, not on the
  // body's open hands).
  const suit = raceSuit(t, c);
  const low = field(
    t.body.s,
    (i) => abs.neck[0] - 0.07 - (t.body.s.a.pos[i * 3 + 1] + abs.hip),
  );
  const visible = clipAll(
    t.body.s,
    [suit.cover, low].map((cv) => field(t.body.s, (i) => 0.03 - cv[i])),
  );
  const skinG = posed(visible, bp.bones, warp, ['uv']);
  const cloth = (list: Surf[]): BufferGeometry => {
    const g = posed(join(list), bp.bones, warp, ['uv', 'color']);
    g.userData.cell = -1;
    return g;
  };
  const parts: BufferGeometry[] = [
    cloth(suit.pieces.map(painted)),
    cloth(shoesOf(MODEL, 'sneaker', '#17181b', '#2b2c30', hi)),
  ];

  // Helmet on the head.
  const headAt = bp.bones[BONE.head]
    .clone()
    .multiply(
      new Matrix4().makeTranslation(rig.head.x, rig.head.y, rig.head.z),
    );
  const WHITE = '#f1f1ee';
  const stripe = apart(c.base, WHITE) > 0.4 ? c.base : c.accent;
  const line = [c.accent, c.accent2, '#17181b'].find(
    (x) => apart(x, stripe) > 0.4 && apart(x, WHITE) > 0.4,
  )!;
  const hel = helmet(
    { base: WHITE, stripe, line },
    hi,
    abs.eye[0] - abs.head[1],
    abs.eye[1] - abs.head[2],
  );
  hel.shell.applyMatrix4(headAt);
  const trim = hel.trim.toNonIndexed();
  hel.trim.dispose();
  trim.applyMatrix4(headAt);
  parts.push(tag(trim, HAT));

  for (const h of sat.hands)
    parts.push(...gripGlove(h.grip, h.wrist, h.fore, GLOVE_COLOR, hi));
  if (sat.book) parts.push(...notes(...sat.book));
  parts.push(...restraint(t, bp.bones, headAt, suitColors(c).webbing, hi));

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
  for (const g of [skinG, atlas, hel.shell]) {
    g.applyMatrix4(place);
    g.computeBoundingSphere();
  }
  if (hi) packNormals(skinG);
  return [
    { geometry: skinG, look: `skin|${MODEL}|${skin}` },
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

/**
 * Catalog builder. Variant % 2 = the seat (driver, co-driver); `params` (`CrewParams`) names the car, without them it
 * is a demo cockpit in the colours of team variant / 2. The parts carry the look of their material (`CrewLook`) in
 * place of one: assets/people-pool.ts `materialOf` turns it into the material.
 */
export const crewSeated: AssetBuilder = ({ seed, variant, lod, params }) => {
  const p = (params as CrewParams | undefined) ?? {
    cockpit: DEMO,
    colors: TEAMS[Math.floor(variant / 2) % TEAMS.length],
  };
  return {
    parts: buildCrew(seed, variant % 2 === 1, lod, p).map((part) => ({
      geometry: part.geometry,
      material: part.look as unknown as Material,
    })),
  };
};
