import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CritterId } from '../sim/types';
import { part } from './parts';

/**
 * The Boom Crew (DETAILS.md "Style"): eight animal demolition workers, each with its own build - a turned torso profile
 * (pear, barrel, slim), tapered limbs, a species head - so they read apart by silhouette alone, while all of them stand
 * on the same footprint (visual only; the sim's hitbox is the same for everyone). One merged geometry per critter with
 * the paint in vertex colours, plus a FUR geometry: the furry parts only, with a per-vertex `fur` length the shell
 * shader (`fur.ts`) grows hair from. Local space: facing +z, standing on y = 0, 0.75-1.05 tall, inside 0.55 of the
 * centre. The hard hat, the vest and the feet are shared instanced meshes, placed per critter by its fit
 * (`hatY` / `hatZ` / `hatScale`, `vest`, `feet`), see `characters.ts`.
 *
 * Fur rules: every part says how long its fur is (`furry`, 0 = bald). Bald parts (eyes, noses, teeth, claws, quills,
 * shells) clear the fur around them so it never grows over a face; fur is also cleared under the hard hat and the
 * vest. Patterns (a raccoon's mask, a badger's stripes, an otter's pale front) are painted into the fur colour.
 */
export interface CritterModel {
  /** Everything: skin, faces, shells; the base the fur grows from. */
  geometry: BufferGeometry;
  /** Only the furry parts, with a `fur` attribute (0..1.5 = length factor). Drawn as shells. */
  furGeometry: BufferGeometry;
  /** Where the hard hat sits: y of the brim, z of its centre, and its size (small heads get a smaller hat). */
  hatY: number;
  hatZ: number;
  hatScale: number;
  /** Radians the hat is tipped back (negative = brim up at the front, so the face shows). */
  hatTilt: number;
  /** The shared vest (built round a torso centred at y 0.36) moved to centre `cy` and scaled to this torso. */
  vest: VestFit;
  /** Feet: half the distance between them, and their size. */
  feet: { spread: number; scale: number };
  /** Colour of the two feet. */
  foot: number;
}

export interface VestFit {
  cy: number;
  sx: number;
  sy: number;
  sz: number;
}

/** The vest geometry's own torso (`vestGeometry` in `crew-parts.ts`): centre y and shell radius. */
const VEST_CY = 0.36;
const VEST_R = 0.352;

type V3 = [number, number, number];

/** Fur fades out this close (critter units) to a bald part: hair never grows over an eye or a nose. */
const BALD_EDGE = 0.03;

const EYE = 0x1d1512;
const SHINE = 0xffffff;
const PINK = 0xe89aa0;
const CLAW = 0xf3ead8;

/** Fur length per part, and the thin parts (whiskers) that must not clear fur around them. */
const furOf = new WeakMap<BufferGeometry, number>();
const thin = new WeakSet<BufferGeometry>();
/** Give a part fur of `len` (1 = the crew's standard length, `FUR_LEN` in `fur.ts`). */
const furry = (g: BufferGeometry, len = 1): BufferGeometry => {
  furOf.set(g, len);
  return g;
};

const shade = (hex: number, k: number): number => {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
};

// ------------------------------------------------------------------ anatomy kit

interface Rot {
  /** Rotations in radians, applied z, then x, then y. */
  rx?: number;
  ry?: number;
  rz?: number;
  tint?: number;
}

/** An ellipsoid centred at `c` with radii `r`, optionally turned. */
function ell(c: V3, r: V3, color: number, o: Rot = {}): BufferGeometry {
  // resolution by size: heads and bellies smooth, eyes and toes cheap (the fur hides the rest)
  const m = Math.max(r[0], r[1], r[2]);
  const [ws, hs] = m >= 0.13 ? [18, 12] : m >= 0.06 ? [12, 8] : [8, 6];
  const g = new SphereGeometry(1, ws, hs).scale(r[0], r[1], r[2]);
  if (o.rz) g.rotateZ(o.rz);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  return part(g, color, { x: c[0], y: c[1], z: c[2], tint: o.tint ?? 0.06 });
}

/** Torso profile: `[y, radius]` from the seat (radius 0) up to the neck (radius 0, under the head). */
type Profile = readonly (readonly [number, number])[];

/** A turned torso from `profile`, squashed to `width` (x) and `depth` (z): one smooth form, no ball-on-ball seams. */
function torso(
  profile: Profile,
  color: number,
  width = 1,
  depth = 1,
): BufferGeometry {
  const pts = profile.map(([y, r]) => new Vector2(Math.max(r, 0.001), y));
  const g = new LatheGeometry(pts, 24).scale(width, 1, depth);
  return part(g, color, { tint: 0.07 });
}

/** Torso radius at height `y` (linear between profile points). */
function radiusAt(profile: Profile, y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [y0, r0] = profile[i - 1];
    const [y1, r1] = profile[i];
    if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / Math.max(1e-6, y1 - y0));
  }
  return profile[profile.length - 1][1];
}

/** The vest moved to centre `cy` and fitted round this torso there (it sits on the fur). */
function vestFor(
  profile: Profile,
  width: number,
  depth: number,
  cy: number,
  sy = 1,
): VestFit {
  const r = radiusAt(profile, cy);
  return {
    cy,
    sx: (r * width + 0.03) / VEST_R,
    sy,
    sz: (r * depth + 0.03) / (VEST_R * 0.97),
  };
}

/** A tapered limb from `a` (radius `ra`) to `b` (radius `rb`) with rounded ends. */
function limb(
  a: V3,
  b: V3,
  ra: number,
  rb: number,
  color: number,
): BufferGeometry[] {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new CylinderGeometry(rb, ra, len, 10, 1, true);
  g.applyQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()),
  );
  return [
    part(g, color, {
      x: (a[0] + b[0]) / 2,
      y: (a[1] + b[1]) / 2,
      z: (a[2] + b[2]) / 2,
      tint: 0.06,
    }),
    ell(a, [ra, ra, ra], color),
    ell(b, [rb, rb, rb], color),
  ];
}

/** A cone from `a` pointing to `b` (claws, quills, snouts, tails). */
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

/** A head: its centre and radii, so eyes, ears and the hat can sit on its surface. */
interface Head {
  c: V3;
  r: V3;
}

/** Depth (z) of the head's surface at offset (`dx`, `dy`) from its centre. */
function surfaceZ(h: Head, dx: number, dy: number): number {
  const q = 1 - (dx / h.r[0]) ** 2 - (dy / h.r[1]) ** 2;
  return h.c[2] + h.r[2] * Math.sqrt(Math.max(0, q));
}

/** Glossy eyes on the head surface: dark ball, a big and a small highlight, optional soft brows. */
function eyes(
  p: BufferGeometry[],
  h: Head,
  spread: number,
  lift: number,
  r: number,
  brow: number | null = null,
  browFur = 0.5,
): void {
  const y = h.c[1] + lift;
  const z = surfaceZ(h, spread, lift) - r * 0.25;
  for (const s of [-1, 1]) {
    const x = s * spread;
    p.push(
      ell([x, y, z], [r, r, r * 0.85], EYE, { tint: 0 }),
      ell(
        [x - r * 0.3, y + r * 0.38, z + r * 0.62],
        [r * 0.34, r * 0.34, r * 0.34],
        SHINE,
        { tint: 0 },
      ),
      ell(
        [x + r * 0.35, y - r * 0.3, z + r * 0.62],
        [r * 0.15, r * 0.15, r * 0.15],
        SHINE,
        { tint: 0 },
      ),
    );
    if (brow !== null)
      p.push(
        furry(
          ell(
            [x * 1.05, y + r * 1.7, z - r * 0.4],
            [r * 1.4, r * 0.35, r * 0.75],
            brow,
            { rz: -s * 0.22 },
          ),
          browFur,
        ),
      );
  }
}

/** A round ear with an inner bowl, tilted out. */
function roundEar(
  p: BufferGeometry[],
  at: V3,
  r: number,
  fur: number,
  inner: number,
  coat: number,
): void {
  for (const s of [-1, 1]) {
    const c: V3 = [s * at[0], at[1], at[2]];
    p.push(
      furry(ell(c, [r, r * 1.05, r * 0.5], fur, { rz: -s * 0.5 }), coat * 0.7),
      ell([c[0], c[1], c[2] + r * 0.22], [r * 0.66, r * 0.7, r * 0.3], inner, {
        rz: -s * 0.5,
        tint: 0.03,
      }),
    );
  }
}

/** A pointed ear: a flattened cone leaning out, a pink inside. */
function pointyEar(
  p: BufferGeometry[],
  at: V3,
  r: number,
  h: number,
  lean: number,
  fur: number,
  inner: number,
  coat: number,
): void {
  for (const s of [-1, 1]) {
    const tip: V3 = [
      s * (at[0] + Math.sin(lean) * h),
      at[1] + Math.cos(lean) * h,
      at[2] - 0.01,
    ];
    const base: V3 = [s * at[0], at[1], at[2]];
    const outer = spike(base, tip, r, fur, 10);
    p.push(furry(squashZ(outer, base, 0.45), coat * 0.6));
    const inTip: V3 = [
      tip[0] * 0.96 + base[0] * 0.04,
      tip[1] - h * 0.12,
      tip[2] + 0.012,
    ];
    p.push(
      squashZ(
        spike(
          [base[0], base[1] + 0.01, base[2] + 0.015],
          inTip,
          r * 0.6,
          inner,
          8,
        ),
        base,
        0.4,
      ),
    );
  }
}

/** Flatten a part along z about `about` (ears are thin). */
function squashZ(g: BufferGeometry, about: V3, k: number): BufferGeometry {
  g.translate(0, 0, -about[2]);
  g.scale(1, 1, k);
  g.translate(0, 0, about[2]);
  return g;
}

/** A paw: a soft ball with `fingers` little pads at the front, and claws when `claws` is a colour. */
function paw(
  p: BufferGeometry[],
  c: V3,
  r: number,
  color: number,
  fingers = 3,
  claws: number | null = null,
  clawLen = 0.05,
): void {
  p.push(furry(ell(c, [r, r * 0.85, r], color), 0.3));
  for (let k = 0; k < fingers; k++) {
    const t = fingers === 1 ? 0 : (k / (fingers - 1)) * 2 - 1;
    const f: V3 = [c[0] + t * r * 0.6, c[1] - r * 0.35, c[2] + r * 0.75];
    p.push(ell(f, [r * 0.32, r * 0.32, r * 0.36], color, { tint: 0.03 }));
    if (claws !== null)
      p.push(
        spike(
          f,
          [f[0], f[1] - clawLen * 0.6, f[2] + clawLen],
          r * 0.16,
          claws,
          5,
        ),
      );
  }
}

// ------------------------------------------------------------------ gear and fur masks

/** Fur cleared under the hard hat and the fitted vest. */
function coveredByGear(x: number, y: number, z: number, m: Fit): boolean {
  if (y > m.hatY - 0.03 && Math.hypot(x, z - m.hatZ) < 0.25 * m.hatScale)
    return true;
  const v = m.vest;
  const xc = x / v.sx;
  const yc = (y - v.cy) / v.sy + VEST_CY;
  const zc = z / v.sz;
  const inside = Math.hypot(xc, zc) < VEST_R + 0.03;
  // the vest shell round the torso, open at the front (the belly fur shows there)
  if (inside && yc > 0.21 && yc < 0.6 && Math.abs(Math.atan2(xc, zc)) > 0.33)
    return true;
  // shoulder straps
  if (inside && Math.abs(Math.abs(xc) - 0.13) < 0.055 && yc > 0.55 && yc < 0.75)
    return true;
  return false;
}

/** A fur pattern: vertices inside the ellipsoid (centre `c`, radii `r`) take `color`, with a soft edge. */
interface Mark {
  c: V3;
  r: V3;
  color: number;
}

function paint(g: BufferGeometry, marks: readonly Mark[]): void {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const c = new Color();
  const m = new Color();
  for (let i = 0; i < pos.count; i++)
    for (const mark of marks) {
      const dx = (pos.getX(i) - mark.c[0]) / mark.r[0];
      const dy = (pos.getY(i) - mark.c[1]) / mark.r[1];
      const dz = (pos.getZ(i) - mark.c[2]) / mark.r[2];
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (q >= 1) continue;
      const k = Math.min(1, (1 - q) / 0.3);
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      c.lerp(m.setHex(mark.color), k);
      col.setXYZ(i, c.r, c.g, c.b);
    }
}

/** Keep only the triangles that grow some fur (the shells redraw every one of them; under the vest is bald). */
function dropBare(g: BufferGeometry): BufferGeometry {
  const fur = g.getAttribute('fur');
  const keep: number[] = [];
  for (let t = 0; t < fur.count; t += 3)
    if (Math.max(fur.getX(t), fur.getX(t + 1), fur.getX(t + 2)) > 0.01)
      keep.push(t);
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    const n = a.itemSize;
    const arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, k) => {
      for (let v = 0; v < 3; v++)
        for (let c = 0; c < n; c++)
          arr[(k * 3 + v) * n + c] = a.getComponent(t + v, c);
    });
    out.setAttribute(name, new Float32BufferAttribute(arr, n));
  }
  g.dispose();
  return out;
}

/** Where a critter's gear goes (everything of `CritterModel` but the geometry). */
type Fit = Omit<CritterModel, 'geometry' | 'furGeometry'>;

/**
 * Merge the parts into the body geometry, and the furry ones (cloned) into the fur geometry with a per-vertex `fur`
 * length: the part's length, faded to 0 near any bald part and under the gear.
 */
function finish(
  parts: BufferGeometry[],
  fit: Fit,
  marks: readonly Mark[] = [],
): CritterModel {
  // patterns (masks, stripes) go into the fur's own colour, so the hair carries them
  if (marks.length) for (const g of parts) if (furOf.has(g)) paint(g, marks);
  // bald parts by their bounding box: tight for flat or long parts (a paddle tail, a quill), unlike a sphere
  const bald: Box3[] = [];
  for (const g of parts) {
    if (furOf.has(g) || thin.has(g)) continue;
    g.computeBoundingBox();
    bald.push(g.boundingBox!.clone());
  }
  const furParts: BufferGeometry[] = [];
  const v = new Vector3();
  for (const g of parts) {
    const len = furOf.get(g) ?? 0;
    const pos = g.getAttribute('position');
    const fur = new Float32Array(pos.count);
    if (len > 0)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let k = coveredByGear(v.x, v.y, v.z, fit) ? 0 : len;
        for (const box of bald) {
          const d = box.distanceToPoint(v);
          if (d < BALD_EDGE) k *= d / BALD_EDGE;
        }
        fur[i] = k;
      }
    // the body gets the attribute too: the skin shader darkens the undercoat where fur grows
    g.setAttribute('fur', new Float32BufferAttribute(fur, 1));
    if (len > 0) furParts.push(g.clone());
  }
  const merged = mergeGeometries(furParts, false);
  const furGeometry = merged && dropBare(merged);
  const geometry = mergeGeometries(parts, false);
  if (!furGeometry || !geometry)
    throw new Error('kabooom: could not merge a critter');
  for (const g of [...parts, ...furParts]) g.dispose();
  return { geometry, furGeometry, ...fit };
}

// ------------------------------------------------------------------ the crew

const BUILDERS: Record<CritterId, () => CritterModel> = {
  /** Short, broad and neckless: a velvet pear with a pink star nose and huge spade hands. */
  mole() {
    const fur = 0x5f6378;
    const pink = 0xe8a0a6;
    const coat = 0.45;
    const prof: Profile = [
      [0.06, 0],
      [0.09, 0.17],
      [0.2, 0.25],
      [0.34, 0.26],
      [0.46, 0.23],
      [0.56, 0.18],
      [0.64, 0.1],
      [0.68, 0],
    ];
    const head: Head = { c: [0, 0.6, 0.1], r: [0.15, 0.14, 0.18] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1, 0.95), coat),
      furry(ell(head.c, head.r, fur), coat),
      // the long snout, then the star: a ring of pink feelers round the nose
      furry(ell([0, 0.56, 0.27], [0.07, 0.06, 0.12], fur), coat * 0.5),
      ell([0, 0.565, 0.38], [0.045, 0.045, 0.03], pink, { tint: 0.03 }),
    ];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const b: V3 = [Math.cos(a) * 0.035, 0.565 + Math.sin(a) * 0.035, 0.385];
      p.push(
        spike(
          b,
          [b[0] * 2.1, 0.565 + (b[1] - 0.565) * 2.1, 0.41],
          0.012,
          pink,
          5,
        ),
      );
    }
    eyes(p, head, 0.1, 0.03, 0.015);
    // spade hands turned out, five long claws each, on short thick arms
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.22, 0.42, 0.04],
          [s * 0.29, 0.33, 0.14],
          0.065,
          0.06,
          fur,
        ).map((g) => furry(g, coat)),
      );
      p.push(
        ell([s * 0.31, 0.32, 0.18], [0.1, 0.12, 0.04], pink, {
          ry: s * 0.6,
          rz: -s * 0.3,
        }),
      );
      for (let k = 0; k < 5; k++) {
        const t = (k / 4) * 2 - 1;
        const f: V3 = [s * (0.31 + t * 0.045), 0.26 + Math.abs(t) * 0.02, 0.21];
        p.push(
          spike(f, [f[0] + s * 0.02, f[1] - 0.05, f[2] + 0.06], 0.012, CLAW, 5),
        );
      }
      p.push(
        ...limb(
          [s * 0.1, 0.14, 0],
          [s * 0.1, 0.06, 0.03],
          0.075,
          0.06,
          fur,
        ).map((g) => furry(g, coat)),
      );
    }
    return finish(p, {
      hatY: 0.76,
      hatZ: 0.05,
      hatScale: 0.76,
      hatTilt: -0.2,
      vest: vestFor(prof, 1, 0.95, 0.32, 0.72),
      feet: { spread: 0.1, scale: 0.9 },
      foot: pink,
    });
  },

  /** Low, wide and heavy-shouldered, a wedge of a head with a striped face and digging claws. */
  badger() {
    const fur = 0x55555f;
    const white = 0xf1efe9;
    const dark = 0x23232a;
    const coat = 1;
    const prof: Profile = [
      [0.07, 0],
      [0.1, 0.19],
      [0.2, 0.26],
      [0.32, 0.28],
      [0.42, 0.27],
      [0.5, 0.23],
      [0.56, 0.16],
      [0.6, 0],
    ];
    const head: Head = { c: [0, 0.62, 0.1], r: [0.19, 0.15, 0.2] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1.06, 0.88), coat),
      furry(ell(head.c, head.r, fur), coat),
      // the long tapering snout
      furry(ell([0, 0.58, 0.28], [0.085, 0.07, 0.14], fur), coat * 0.5),
      ell([0, 0.6, 0.415], [0.04, 0.03, 0.025], 0x111116, { tint: 0 }),
    ];
    eyes(p, head, 0.08, 0.035, 0.028);
    roundEar(p, [0.17, 0.73, 0.02], 0.05, fur, white, coat);
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.27, 0.44, 0.05],
          [s * 0.29, 0.27, 0.14],
          0.08,
          0.065,
          fur,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.29, 0.24, 0.17], 0.07, dark, 4, CLAW, 0.06);
      p.push(
        ...limb(
          [s * 0.13, 0.15, 0],
          [s * 0.13, 0.06, 0.03],
          0.09,
          0.075,
          dark,
        ).map((g) => furry(g, coat * 0.6)),
      );
    }
    p.push(
      furry(spike([0, 0.18, -0.26], [0, 0.12, -0.42], 0.06, fur, 10), coat),
    );
    // the face: white, with a dark stripe from the nose over each eye to the ear
    return finish(
      p,
      {
        hatY: 0.76,
        hatZ: 0.05,
        hatScale: 0.8,
        hatTilt: -0.18,
        vest: vestFor(prof, 1.06, 0.88, 0.32, 0.72),
        feet: { spread: 0.13, scale: 1 },
        foot: dark,
      },
      [
        { c: [0, 0.62, 0.22], r: [0.2, 0.17, 0.24], color: white },
        { c: [0.075, 0.66, 0.2], r: [0.045, 0.16, 0.3], color: dark },
        { c: [-0.075, 0.66, 0.2], r: [0.045, 0.16, 0.3], color: dark },
      ],
    );
  },

  /** Pear-shaped and bottom-heavy, round cheeks, orange teeth and a flat scaly paddle of a tail. */
  beaver() {
    const fur = 0x8c5e33;
    const dark = 0x4f321b;
    const coat = 0.8;
    const prof: Profile = [
      [0.06, 0],
      [0.09, 0.2],
      [0.2, 0.27],
      [0.3, 0.265],
      [0.42, 0.225],
      [0.52, 0.18],
      [0.6, 0.14],
      [0.66, 0],
    ];
    const head: Head = { c: [0, 0.75, 0.04], r: [0.2, 0.18, 0.19] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1, 0.95), coat),
      furry(ell(head.c, head.r, fur), coat),
    ];
    for (const s of [-1, 1])
      p.push(
        furry(
          ell([s * 0.11, 0.69, 0.13], [0.095, 0.085, 0.085], fur),
          coat * 0.9,
        ),
      );
    p.push(
      furry(ell([0, 0.69, 0.17], [0.1, 0.075, 0.08], 0xc89a68), coat * 0.4),
      ell([0, 0.725, 0.245], [0.042, 0.03, 0.025], 0x24160c, { tint: 0 }),
      // the famous orange teeth
      part(new BoxGeometry(0.04, 0.075, 0.022), 0xf0a548, {
        x: 0.021,
        y: 0.62,
        z: 0.215,
        tint: 0,
      }),
      part(new BoxGeometry(0.04, 0.075, 0.022), 0xf0a548, {
        x: -0.021,
        y: 0.62,
        z: 0.215,
        tint: 0,
      }),
    );
    eyes(p, head, 0.085, 0.045, 0.032, shade(fur, 0.8));
    roundEar(p, [0.18, 0.86, -0.01], 0.042, dark, 0x6a4527, coat);
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.21, 0.5, 0.05],
          [s * 0.22, 0.32, 0.16],
          0.065,
          0.05,
          fur,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.22, 0.29, 0.19], 0.05, dark, 4, null);
      p.push(
        ...limb(
          [s * 0.11, 0.14, 0],
          [s * 0.11, 0.06, 0.04],
          0.08,
          0.065,
          fur,
        ).map((g) => furry(g, coat)),
      );
    }
    // paddle tail (scaly: no fur) with a crosshatch
    p.push(ell([0, 0.07, -0.45], [0.15, 0.028, 0.24], dark, { tint: 0.1 }));
    for (const k of [-0.12, -0.04, 0.04, 0.12])
      p.push(
        part(new BoxGeometry(0.24, 0.006, 0.012), 0x2e1d0f, {
          y: 0.1,
          z: -0.45 + k,
          tint: 0,
        }),
      );
    return finish(p, {
      hatY: 0.91,
      hatZ: 0.0,
      hatScale: 0.82,
      hatTilt: -0.15,
      vest: vestFor(prof, 1, 0.95, 0.35, 0.78),
      feet: { spread: 0.11, scale: 0.92 },
      foot: dark,
    });
  },

  /** Small and round, a pointed snout, and a coat of two-tone quills over the back and the crown. */
  hedgehog() {
    const face = 0xe6c99e;
    const quill = 0x56402b;
    const coat = 0.5;
    const prof: Profile = [
      [0.06, 0],
      [0.09, 0.18],
      [0.2, 0.24],
      [0.32, 0.24],
      [0.44, 0.21],
      [0.52, 0.15],
      [0.57, 0],
    ];
    const head: Head = { c: [0, 0.64, 0.06], r: [0.17, 0.16, 0.17] };
    const p: BufferGeometry[] = [
      furry(torso(prof, face, 1, 0.95), coat),
      furry(ell(head.c, head.r, face), coat),
      furry(ell([0, 0.59, 0.22], [0.07, 0.06, 0.13], face), coat * 0.4),
      ell([0, 0.6, 0.35], [0.03, 0.026, 0.026], 0x1c120c, { tint: 0 }),
    ];
    eyes(p, head, 0.075, 0.035, 0.03);
    roundEar(p, [0.13, 0.76, 0.0], 0.04, face, PINK, coat);
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.18, 0.4, 0.07],
          [s * 0.21, 0.27, 0.15],
          0.05,
          0.042,
          face,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.21, 0.25, 0.17], 0.04, 0xb88c5e, 3, null);
      p.push(
        ...limb(
          [s * 0.1, 0.13, 0],
          [s * 0.1, 0.06, 0.03],
          0.06,
          0.05,
          face,
        ).map((g) => furry(g, coat)),
      );
    }
    // quills: a fan over the back half of the torso and the crown, each leaning back and out, with a pale tip
    const n = 100;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = 0.16 + t * 0.62;
      const az = Math.PI + (((i * 0.618034) % 1) * 2 - 1) * 1.55; // spread round the back (-z)
      const onHead = y > 0.56;
      const r = onHead
        ? head.r[0] *
          Math.sqrt(Math.max(0, 1 - ((y - head.c[1]) / head.r[1]) ** 2))
        : radiusAt(prof, y);
      if (r < 0.04) continue;
      const x = Math.sin(az) * r;
      const z = Math.cos(az) * r * 0.95 + (onHead ? head.c[2] : 0);
      if (y > 0.77 && Math.hypot(x, z - 0.04) < 0.2) continue; // under the hat
      const out = new Vector3(
        Math.sin(az),
        0.35 + t * 0.6,
        Math.cos(az) - 0.4,
      ).normalize();
      const len = 0.15 + 0.05 * Math.sin(i * 12.9);
      const a: V3 = [x, y, z];
      const b: V3 = [x + out.x * len, y + out.y * len, z + out.z * len];
      p.push(
        spike(a, b, 0.024, quill, 5),
        spike(
          [
            a[0] + out.x * len * 0.7,
            a[1] + out.y * len * 0.7,
            a[2] + out.z * len * 0.7,
          ],
          [b[0] + out.x * 0.02, b[1] + out.y * 0.02, b[2] + out.z * 0.02],
          0.009,
          0xf0e2c8,
          4,
        ),
      );
    }
    return finish(p, {
      hatY: 0.79,
      hatZ: 0.03,
      hatScale: 0.74,
      hatTilt: -0.2,
      vest: vestFor(prof, 1, 0.95, 0.31, 0.7),
      feet: { spread: 0.1, scale: 0.82 },
      foot: 0xb88c5e,
    });
  },

  /** Hunched under a banded shell, a long narrow snout, tall leathery ears and a long ringed tail. */
  armadillo() {
    const skin = 0xc3aeb0;
    const shell = 0x8b7c82;
    const band = 0x6c5f66;
    const coat = 0.2;
    const prof: Profile = [
      [0.07, 0],
      [0.1, 0.17],
      [0.22, 0.23],
      [0.34, 0.23],
      [0.46, 0.2],
      [0.54, 0.15],
      [0.6, 0],
    ];
    const head: Head = { c: [0, 0.64, 0.1], r: [0.13, 0.12, 0.15] };
    const p: BufferGeometry[] = [
      furry(torso(prof, skin, 1, 0.92), coat),
      furry(ell(head.c, head.r, skin), coat),
      ell([0, 0.59, 0.27], [0.055, 0.05, 0.15], skin, { rx: 0.1 }),
      ell([0, 0.585, 0.415], [0.028, 0.022, 0.02], 0x4a3a3e, { tint: 0 }),
    ];
    // the shell: overlapping bands round the back, a little bigger and darker towards the hips
    const bands = 7;
    for (let k = 0; k < bands; k++) {
      const t0 = 0.35 + k * 0.19;
      const r = 0.285 + k * 0.004;
      const g = new SphereGeometry(
        r,
        30,
        3,
        Math.PI * 0.75,
        Math.PI * 1.5,
        t0,
        0.24,
      );
      p.push(part(g, k % 2 ? band : shell, { y: 0.4, sz: 0.95, tint: 0.07 }));
    }
    // a scaly cap on the head
    p.push(
      ell([0, 0.715, 0.08], [0.11, 0.05, 0.13], shell, {
        rx: 0.15,
        tint: 0.07,
      }),
    );
    eyes(p, head, 0.07, 0.02, 0.022);
    // tall leathery ears leaning out from under the hat
    for (const s of [-1, 1])
      p.push(
        ell([s * 0.15, 0.78, 0.02], [0.035, 0.09, 0.014], skin, {
          rz: -s * 0.55,
          tint: 0.05,
        }),
      );
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.18, 0.42, 0.06],
          [s * 0.21, 0.28, 0.15],
          0.05,
          0.042,
          skin,
        ),
      );
      paw(p, [s * 0.21, 0.26, 0.17], 0.04, skin, 3, CLAW, 0.05);
      p.push(
        ...limb([s * 0.1, 0.14, 0], [s * 0.1, 0.06, 0.03], 0.065, 0.055, skin),
      );
    }
    // the long tail, ringed like the shell
    for (let k = 0; k < 6; k++) {
      const t0 = k / 6;
      const t1 = (k + 1) / 6;
      const at = (t: number): V3 => [0, 0.2 - t * 0.15, -0.26 - t * 0.42];
      p.push(
        spike(
          at(t0),
          at(t1 + 0.04),
          0.065 * (1 - t0 * 0.8),
          k % 2 ? band : shell,
          10,
        ),
      );
    }
    return finish(p, {
      hatY: 0.76,
      hatZ: 0.04,
      hatScale: 0.7,
      hatTilt: -0.2,
      vest: vestFor(prof, 1, 0.92, 0.31, 0.68),
      feet: { spread: 0.1, scale: 0.82 },
      foot: band,
    });
  },

  /** Tall and lean on long limbs: a bandit mask, pointed ears, clever black hands and a bushy ringed tail. */
  raccoon() {
    const fur = 0x8a8d99;
    const dark = 0x2a2a33;
    const white = 0xeceef2;
    const coat = 1.15;
    const prof: Profile = [
      [0.12, 0],
      [0.15, 0.17],
      [0.24, 0.24],
      [0.36, 0.25],
      [0.48, 0.22],
      [0.58, 0.17],
      [0.66, 0.12],
      [0.72, 0],
    ];
    const head: Head = { c: [0, 0.82, 0.03], r: [0.2, 0.17, 0.18] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1, 0.9), coat),
      furry(ell(head.c, head.r, fur), coat),
    ];
    // puffy cheek ruffs and a pointed white muzzle
    for (const s of [-1, 1])
      p.push(
        furry(
          ell([s * 0.14, 0.76, 0.06], [0.1, 0.085, 0.09], fur, { rz: s * 0.4 }),
          coat * 1.2,
        ),
      );
    p.push(
      furry(ell([0, 0.77, 0.18], [0.075, 0.065, 0.11], white), coat * 0.45),
      ell([0, 0.785, 0.29], [0.033, 0.025, 0.022], dark, { tint: 0 }),
    );
    eyes(p, head, 0.078, 0.035, 0.034);
    pointyEar(p, [0.13, 0.93, -0.01], 0.06, 0.12, 0.35, fur, white, coat);
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.2, 0.6, 0.03],
          [s * 0.25, 0.38, 0.1],
          0.06,
          0.045,
          fur,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.25, 0.35, 0.13], 0.045, dark, 4, null);
      p.push(
        ...limb(
          [s * 0.1, 0.2, 0],
          [s * 0.11, 0.06, 0.03],
          0.07,
          0.05,
          dark,
        ).map((g) => furry(g, coat * 0.6)),
      );
    }
    // the bushy ringed tail, curling up behind
    for (let k = 0; k < 7; k++) {
      const t = k / 6;
      const c: V3 = [
        0,
        0.16 + t * 0.42 + Math.sin(t * 2.6) * 0.04,
        -0.3 - Math.sin(t * 1.9) * 0.22,
      ];
      const r = 0.1 - t * 0.03;
      p.push(
        furry(ell(c, [r, r * 1.1, r], k % 2 ? dark : 0xb6b9c4), coat * 1.3),
      );
    }
    return finish(
      p,
      {
        hatY: 0.97,
        hatZ: 0.0,
        hatScale: 0.8,
        hatTilt: -0.15,
        vest: vestFor(prof, 1, 0.9, 0.4, 0.82),
        feet: { spread: 0.11, scale: 0.9 },
        foot: dark,
      },
      [
        // the bandit mask across the eyes, white brows above it
        { c: [0, 0.855, 0.16], r: [0.21, 0.055, 0.1], color: dark },
        { c: [0, 0.915, 0.15], r: [0.15, 0.03, 0.1], color: white },
      ],
    );
  },

  /** A barrel on short legs with a big blunt head held forward, eyes and ears high up. */
  capybara() {
    const fur = 0x9b6f45;
    const dark = 0x6b4a2f;
    const coat = 0.7;
    const prof: Profile = [
      [0.08, 0],
      [0.11, 0.2],
      [0.22, 0.265],
      [0.36, 0.275],
      [0.48, 0.25],
      [0.56, 0.2],
      [0.62, 0],
    ];
    const head: Head = { c: [0, 0.71, 0.12], r: [0.16, 0.15, 0.23] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1, 1), coat),
      furry(ell(head.c, head.r, fur), coat),
      // the long blunt snout and the dark nose pad
      furry(ell([0, 0.665, 0.3], [0.13, 0.12, 0.13], fur), coat * 0.8),
      ell([0, 0.7, 0.415], [0.07, 0.04, 0.022], dark, { rx: -0.3, tint: 0.04 }),
      ell([0.035, 0.708, 0.432], [0.02, 0.006, 0.008], 0x1d120a, {
        rz: 0.4,
        tint: 0,
      }),
      ell([-0.035, 0.708, 0.432], [0.02, 0.006, 0.008], 0x1d120a, {
        rz: -0.4,
        tint: 0,
      }),
      // a lighter chin
      furry(
        ell([0, 0.6, 0.29], [0.09, 0.05, 0.1], shade(fur, 1.15)),
        coat * 0.6,
      ),
    ];
    eyes(p, head, 0.125, 0.09, 0.028);
    roundEar(p, [0.12, 0.85, 0.0], 0.035, dark, shade(dark, 0.8), coat);
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.25, 0.42, 0.08],
          [s * 0.26, 0.27, 0.15],
          0.07,
          0.06,
          fur,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.26, 0.24, 0.17], 0.05, dark, 3, null);
      p.push(
        ...limb(
          [s * 0.12, 0.16, 0],
          [s * 0.12, 0.06, 0.03],
          0.08,
          0.065,
          fur,
        ).map((g) => furry(g, coat)),
      );
    }
    return finish(p, {
      hatY: 0.85,
      hatZ: 0.03,
      hatScale: 0.78,
      hatTilt: -0.12,
      vest: vestFor(prof, 1, 1, 0.33, 0.72),
      feet: { spread: 0.12, scale: 0.95 },
      foot: dark,
    });
  },

  /** The tallest and slimmest: a long sinuous body, a small flat head with whiskers and a thick tapering tail. */
  otter() {
    const fur = 0x6e4f3a;
    const cream = 0xe6cfae;
    const coat = 0.5;
    const prof: Profile = [
      [0.1, 0],
      [0.13, 0.16],
      [0.22, 0.22],
      [0.34, 0.23],
      [0.46, 0.2],
      [0.58, 0.16],
      [0.7, 0.12],
      [0.78, 0.1],
      [0.82, 0],
    ];
    const head: Head = { c: [0, 0.88, 0.04], r: [0.15, 0.125, 0.15] };
    const p: BufferGeometry[] = [
      furry(torso(prof, fur, 1, 0.9), coat),
      furry(ell(head.c, head.r, fur), coat),
      furry(ell([0, 0.84, 0.15], [0.1, 0.07, 0.085], cream), coat * 0.4),
      ell([0, 0.865, 0.23], [0.032, 0.024, 0.02], 0x1c120c, { tint: 0 }),
    ];
    eyes(p, head, 0.07, 0.03, 0.028);
    roundEar(p, [0.135, 0.93, -0.01], 0.03, fur, 0x4d3727, coat);
    // whiskers (thin: they never clear fur)
    for (const s of [-1, 1])
      for (const k of [-1, 0, 1]) {
        const w = part(new BoxGeometry(0.11, 0.005, 0.005), 0xfffaf0, {
          x: s * 0.13,
          y: 0.835 + k * 0.018,
          z: 0.19,
          ry: s * k * 0.25,
          tint: 0,
        });
        thin.add(w);
        p.push(w);
      }
    for (const s of [-1, 1]) {
      p.push(
        ...limb(
          [s * 0.16, 0.62, 0.04],
          [s * 0.2, 0.42, 0.12],
          0.05,
          0.04,
          fur,
        ).map((g) => furry(g, coat)),
      );
      paw(p, [s * 0.2, 0.39, 0.14], 0.04, shade(fur, 0.75), 4, null);
      p.push(
        ...limb(
          [s * 0.1, 0.18, 0],
          [s * 0.1, 0.06, 0.03],
          0.065,
          0.05,
          fur,
        ).map((g) => furry(g, coat)),
      );
    }
    // the thick tapering tail
    for (let k = 0; k < 5; k++) {
      const t0 = k / 5;
      const t1 = (k + 1) / 5;
      const at = (t: number): V3 => [0, 0.2 - t * 0.15, -0.2 - t * 0.5];
      p.push(
        furry(
          spike(at(t0), at(t1 + 0.05), 0.1 * (1 - t0 * 0.8), fur, 12),
          coat * 0.7,
        ),
      );
    }
    return finish(
      p,
      {
        hatY: 0.99,
        hatZ: 0.01,
        hatScale: 0.7,
        hatTilt: -0.18,
        vest: vestFor(prof, 1, 0.9, 0.42, 0.85),
        feet: { spread: 0.1, scale: 0.85 },
        foot: shade(fur, 0.75),
      },
      // the pale throat and chest
      [{ c: [0, 0.62, 0.18], r: [0.15, 0.24, 0.12], color: cream }],
    );
  },
};

export function buildCritter(id: CritterId): CritterModel {
  return BUILDERS[id]();
}
