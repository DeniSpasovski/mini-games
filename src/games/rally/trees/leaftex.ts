import { mix32, tcos, tsin, unit } from './math';
import type { FoliageKind } from './species';

/**
 * The foliage sprite atlas of a leaf style (spec: trees/Foliage.md#sprites): CLUSTER_IMAGES images of a whole
 * cluster of leaves (broadleaf) or needle sprays (needles), in a CLUSTER_COLS x CLUSTER_ROWS grid of squares
 * (NEEDLE_IMAGE px for the pine, BROAD_IMAGE for the rest). Pure (the meshing worker reads the outlines, trees/materials.ts makes the textures), drawn with the tree
 * code's own trig (trees/math.ts), so the pixels and the outlines fitted to them are the same on every platform.
 *
 * A broadleaf image is a leafy branch lying along the image's x axis (its base on the left, `SPRAY_*`): a stem with
 * twigs alternating along it, small stalked leaves alternating along each twig (a leaf is 4-6 % of the image), dark
 * near the stem and lighter at the tips, so the twigs and gaps show. A sprite turns so that x follows its twig
 * (trees/sprite-attr.ts), so a crown reads as leafy branches along its limbs, not as round clumps. A juniper / cypress
 * image is a drooping frond of scale-leaf branchlets, the pine's a burst of needle sprays round the middle.
 *
 * - `albedo`: grey shading + a slight warm / cool tint per leaf (the sprite's vertex colour is the palette colour)
 *   + alpha (leaf mask).
 * - `normal`: tangent-space normal (x = image right, y = image up, z = towards the viewer) in RGB, and the thickness
 *   map in A (0 = one thin leaf, light shows through; 1 = many leaves stacked). The atlas's three maps travel in two
 *   textures, so a sprite shader samples two atlas textures + the shadow map (+ the cloud noise every lit material
 *   reads).
 */

/** Image size (px) of the pine's needle bursts and of the other styles (small leaves and fine fronds need the pixels). */
export const NEEDLE_IMAGE = 256;
export const BROAD_IMAGE = 512;
export const CLUSTER_COLS = 4;
export const CLUSTER_ROWS = 2;
export const CLUSTER_IMAGES = CLUSTER_COLS * CLUSTER_ROWS;

/** The one alpha-test threshold of the trees: every pass (trees/Foliage.md#alpha). */
export const ALPHA_TEST = 0.5;

/** Leaf styles: one atlas each (`species.foliage.leaf`), so species differ in leaf shape, not only in colour. */
export type LeafStyle =
  | 'pine'
  | 'juniper'
  | 'ovate'
  | 'serrate'
  | 'lobed'
  | 'round'
  | 'narrow'
  | 'small';

export const LEAF_STYLES: readonly LeafStyle[] = [
  'pine',
  'juniper',
  'ovate',
  'serrate',
  'lobed',
  'round',
  'narrow',
  'small',
];

/** The foliage kind (needle sprays or leaf bunches) of a style. */
export function styleKind(style: LeafStyle): FoliageKind {
  return style === 'pine' || style === 'juniper' ? 'needles' : 'broadleaf';
}

export interface SpriteAtlas {
  width: number;
  height: number;
  /** Leaf sprays and fronds lie along x and are turned to their twig; pine needle bursts are round. */
  aligned: boolean;
  /** Sprite size factor: a thin frond covers less of its image than a leafy branch, so it is drawn larger. */
  grow: number;
  /** RGBA8, row 0 = v 0. */
  albedo: Uint8Array;
  normal: Uint8Array;
  /** Per image: outline polygon (CCW, 6-8 vertices) in image coordinates (0..1)^2. */
  outlines: Outline[];
  /**
   * Mean linear shade of the leaf texels (alpha >= ALPHA_TEST): a sprite's vertex colour is the palette colour over
   * this, so a cluster's mean albedo is its palette colour (trees/mesh.ts).
   */
  mean: number;
}

/** Polygon vertices (CCW) in image coordinates. */
export type Outline = [number, number][];

/** Point (px) at t (0..1) along a shoot. */
type Arc = (t: number) => [number, number];

/** Pixel sizes below are for a 256 px image; a style's image scales them (`K`). */
/** The shoot: half its length along x (px), its sag. */
const SPRAY_HALF = 92;
const SPRAY_SAG = 0.2;
/** Size factor of a frond sprite (`SpriteAtlas.grow`). */
const FROND_GROW = 1.7;
/** Chance of a side shoot forking off. */
const SPRAY_FORK = 0.75;

interface BroadStyle {
  /** Leaf length range (px) and length / width. */
  len: [number, number];
  aspect: number;
  /** Edge: teeth (`saw`) or lobes (`wave`) along each side, amplitude as a share of the half width. */
  edge: 'none' | 'saw' | 'wave';
  repeats: number;
  amp: number;
  /** Distance (px) between twigs along the shoot. */
  step: number;
  /** Twig length range, in leaf lengths, and the leaf spacing along a twig (leaf lengths). */
  twig: [number, number];
  gap: number;
  /** Twig bend (share of its length), + = curls down the image. */
  bend: number;
}

const BROAD: Record<Exclude<LeafStyle, 'pine' | 'juniper'>, BroadStyle> = {
  // Beech, sapling: smooth ovate, pointed tip.
  ovate: {
    len: [10, 14],
    aspect: 1.9,
    edge: 'none',
    repeats: 0,
    amp: 0,
    step: 7,
    twig: [2.5, 5],
    gap: 0.8,
    bend: 0.1,
  },
  // Hornbeam, hazel: toothed edge.
  serrate: {
    len: [9, 13],
    aspect: 1.75,
    edge: 'saw',
    repeats: 7,
    amp: 0.2,
    step: 7,
    twig: [2.5, 5],
    gap: 0.8,
    bend: 0.1,
  },
  // Oak, plane: lobed outline.
  lobed: {
    len: [11, 15],
    aspect: 1.55,
    edge: 'wave',
    repeats: 3.5,
    amp: 0.34,
    step: 7.5,
    twig: [1.8, 4],
    gap: 0.9,
    bend: 0.12,
  },
  // Walnut, fruit trees, poplar: broad, blunt.
  round: {
    len: [10, 14],
    aspect: 1.35,
    edge: 'none',
    repeats: 0,
    amp: 0,
    step: 7.5,
    twig: [2, 4.5],
    gap: 0.9,
    bend: 0.1,
  },
  // Willow, broom: long, narrow, hanging.
  narrow: {
    len: [13, 18],
    aspect: 4,
    edge: 'none',
    repeats: 0,
    amp: 0,
    step: 6,
    twig: [2.5, 6],
    gap: 0.6,
    bend: 0.25,
  },
  // Birch, hawthorn, scrub: small leaves.
  small: {
    len: [6, 9],
    aspect: 1.5,
    edge: 'saw',
    repeats: 4,
    amp: 0.15,
    step: 5,
    twig: [3, 7],
    gap: 0.9,
    bend: 0.15,
  },
};

interface NeedleStyle {
  sprays: [number, number];
  /** Twig length (px) range. */
  twig: [number, number];
  /** Needle length (px) at the twig base, the share at its tip, and the distance between needle pairs. */
  needle: number;
  tipShare: number;
  gap: number;
  radius: number;
  /** Needles per side at a twig node (min, extra). */
  perSide: [number, number];
}

const PINE_NEEDLES: NeedleStyle = {
  sprays: [13, 4],
  twig: [70, 105],
  needle: 30,
  tipShare: 0.55,
  gap: 5,
  radius: 0.95,
  perSide: [2, 3],
};

const atlases = new Map<LeafStyle, SpriteAtlas>();

/** An atlas made elsewhere (a worker) stands for `spriteAtlas(style)`. */
export function primeSpriteAtlas(style: LeafStyle, atlas: SpriteAtlas): void {
  atlases.set(style, atlas);
}
const profiles = new Map<LeafStyle, Float32Array>();

const PROFILE_STEPS = 256;

/** Leaf half-width (share of the widest) along its length: ovate, pointed tip, plus the style's toothed / lobed edge. */
function profile(st: BroadStyle): Float32Array {
  const t = new Float32Array(PROFILE_STEPS + 1);
  for (let i = 0; i <= PROFILE_STEPS; i++) {
    const s = i / PROFILE_STEPS;
    let w = tsin(Math.PI * s) * (1.15 - 0.45 * s);
    if (st.edge === 'saw') {
      const f = s * st.repeats;
      w *= 1 - st.amp + st.amp * 2 * (f - Math.floor(f));
    } else if (st.edge === 'wave') {
      w *= 1 + st.amp * tsin(s * st.repeats * Math.PI * 2);
    }
    t[i] = w;
  }
  return t;
}

/** Atlas uv of point (u, v) of image `i`. */
export function atlasUv(i: number, u: number, v: number): [number, number] {
  const c = i % CLUSTER_COLS;
  const r = Math.floor(i / CLUSTER_COLS);
  return [(c + u) / CLUSTER_COLS, (r + v) / CLUSTER_ROWS];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Linear 0..1 -> an sRGB-encoded byte, from a table (an atlas has millions of texels). */
const SRGB_STEPS = 4096;
let srgbTable: Uint8Array | null = null;
function srgb8(x: number): number {
  if (!srgbTable) {
    srgbTable = new Uint8Array(SRGB_STEPS + 1);
    for (let i = 0; i <= SRGB_STEPS; i++) {
      const v = i / SRGB_STEPS;
      const e =
        v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      srgbTable[i] = Math.round(e * 255);
    }
  }
  return srgbTable[Math.round(x * SRGB_STEPS)];
}

/** The atlas of a leaf style. */
export function spriteAtlas(style: LeafStyle): SpriteAtlas {
  const cached = atlases.get(style);
  if (cached) return cached;
  const IMAGE = style === 'pine' ? NEEDLE_IMAGE : BROAD_IMAGE;
  const K = IMAGE / 256;
  const W = IMAGE * CLUSTER_COLS;
  const H = IMAGE * CLUSTER_ROWS;
  /** Per texel, as bytes (the atlas is millions of texels): alpha and shade 0..255, tint and tilt x 127 / x 64. */
  const alpha = new Uint8Array(W * H);
  const shade = new Uint8Array(W * H).fill(255);
  /** Warm (+1, yellower) / cool (-1, bluer) tint of the texel. */
  const warm = new Int8Array(W * H);
  const nx = new Int8Array(W * H);
  const ny = new Int8Array(W * H);
  const layers = new Uint8Array(W * H);
  let ox = 0;
  let oy = 0;
  const put = (
    k: number,
    a: number,
    v: number,
    w: number,
    tx: number,
    ty: number,
  ) => {
    const a8 = Math.round(a * 255);
    if (a8 >= alpha[k] || a > 0.5) {
      alpha[k] = Math.max(alpha[k], a8);
      shade[k] = Math.min(255, Math.round(v * 255));
      warm[k] = Math.round(w * 127);
      nx[k] = Math.max(-127, Math.min(127, Math.round(tx * 64)));
      ny[k] = Math.max(-127, Math.min(127, Math.round(ty * 64)));
    }
    if (a > 0.5 && layers[k] < 255) layers[k]++;
  };
  /** A round stamp: disc `r` at (cx, cy), shade `v`, tilt (tx, ty) + a dome across the disc. */
  const stamp = (
    cx: number,
    cy: number,
    r: number,
    v: number,
    w: number,
    tx: number,
    ty: number,
    dome: number,
  ) => {
    for (
      let y = Math.max(0, Math.floor(cy - r));
      y <= Math.min(IMAGE - 1, Math.ceil(cy + r));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx - r));
        x <= Math.min(IMAGE - 1, Math.ceil(cx + r));
        x++
      ) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const a = clamp01(r - Math.sqrt(dx * dx + dy * dy) + 0.5);
        if (a <= 0) continue;
        const q = Math.max(r, 1);
        put(
          (oy + y) * W + ox + x,
          a,
          v,
          w,
          tx + (dx / q) * dome,
          ty + (dy / q) * dome,
        );
      }
  };
  /**
   * One leaf from its base (bx, by) along `ang`, `l` long and `hw` half-wide at its widest: ovate with a pointed
   * tip, folded along a pale midrib (the two halves tilt apart, so each leaf shows a lit and a shaded side), the
   * edge toothed or lobed per style, lighter towards the tip and the midrib.
   */
  const leaf = (
    bx: number,
    by: number,
    ang: number,
    l: number,
    hw: number,
    v: number,
    w: number,
    tx: number,
    ty: number,
    st: BroadStyle,
    prof: Float32Array,
  ) => {
    const dx = tcos(ang);
    const dy = tsin(ang);
    const ex = Math.abs(dy) * hw * (1 + st.amp) + 1;
    const ey = Math.abs(dx) * hw * (1 + st.amp) + 1;
    const tx1 = bx + dx * l;
    const ty1 = by + dy * l;
    for (
      let y = Math.max(0, Math.floor(Math.min(by, ty1) - ey));
      y <= Math.min(IMAGE - 1, Math.ceil(Math.max(by, ty1) + ey));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(Math.min(bx, tx1) - ex));
        x <= Math.min(IMAGE - 1, Math.ceil(Math.max(bx, tx1) + ex));
        x++
      ) {
        const rx = x + 0.5 - bx;
        const ry = y + 0.5 - by;
        const sp = rx * dx + ry * dy;
        const tp = ry * dx - rx * dy;
        if (sp < -0.5 || sp > l + 0.5) continue;
        const s = clamp01(sp / l);
        const width = hw * prof[Math.round(s * PROFILE_STEPS)];
        const a = clamp01(width - Math.abs(tp) + 0.5);
        if (a <= 0) continue;
        const u = Math.min(1, Math.abs(tp) / Math.max(width, 0.5));
        let vv = v * (1.08 - 0.2 * u) * (0.9 + 0.2 * s);
        // The midrib and the first side veins are paler.
        if (l >= 9 * K) {
          if (Math.abs(tp) < 0.6 * K && s > 0.08 && s < 0.88) vv *= 1.22;
          else if (s > 0.2 && s < 0.85) {
            const f = (s * 5 + Math.abs(tp) * (0.35 / K)) % 1;
            if (f < 0.12) vv *= 1.1;
          }
        }
        // Fold along the midrib (a V section) + curl of the tip + the leaf's own tilt.
        const side = tp > 0 ? 1 : -1;
        const fold = side * 0.28 + clamp01(Math.abs(tp) / hw) * side * 0.22;
        const curl = (s - 0.4) * 0.4;
        put(
          (oy + y) * W + ox + x,
          a,
          vv,
          w,
          tx - dy * fold + dx * curl,
          ty + dx * fold + dy * curl,
        );
      }
  };
  /**
   * A needle spray: a twig with tufts of needles both sides (2-4 each, varied in angle, length and curve, some
   * missing), darker at the base, lighter at the needle tips.
   */
  const spray = (
    cx: number,
    cy: number,
    len: number,
    ang: number,
    rnd: (k: number) => number,
    v: number,
    w: number,
    tx: number,
    ty: number,
    ns: NeedleStyle,
  ) => {
    const dx = tcos(ang);
    const dy = tsin(ang);
    const gap = ns.gap * K;
    for (let n = 0; n * gap < len; n++) {
      const f = (n * gap) / len;
      const px = cx + dx * len * f;
      const py = cy + dy * len * f;
      stamp(px, py, 1.3 * K, v * 0.55, w, tx, ty, 0);
      const tuft = ns.needle * K * (1 - f * (1 - ns.tipShare));
      for (const side of [-1, 1]) {
        const count =
          ns.perSide[0] + Math.floor(rnd(n * 40 + side + 3) * ns.perSide[1]);
        for (let j = 0; j < count; j++) {
          const q = (k: number) =>
            rnd(n * 40 + (side > 0 ? 20 : 0) + j * 5 + k + 1000);
          if (q(0) < 0.12) continue;
          let a = ang + side * (0.4 + 0.8 * q(1));
          const nl = tuft * (0.65 + 0.5 * q(2));
          const bend = (q(3) - 0.5) * 0.9;
          const steps = Math.max(1, Math.round(nl / (0.8 * K)));
          let sx = px;
          let sy = py;
          for (let k = 0; k <= steps; k++) {
            stamp(
              sx,
              sy,
              ns.radius * K,
              v * (0.7 + 0.45 * (k / steps)),
              w,
              tx + tcos(a) * 0.3,
              ty + tsin(a) * 0.3,
              0,
            );
            a += (bend / steps) * (1 + k / steps);
            sx += tcos(a) * 0.8 * K;
            sy += tsin(a) * 0.8 * K;
          }
        }
      }
    }
  };
  const c = IMAGE / 2;
  for (let img = 0; img < CLUSTER_IMAGES; img++) {
    ox = (img % CLUSTER_COLS) * IMAGE;
    oy = Math.floor(img / CLUSTER_COLS) * IMAGE;
    const r = (k: number) =>
      unit(mix32(mix32(0x1f3a + LEAF_STYLES.indexOf(style) * 977, img), k));
    if (style === 'pine') {
      const ns = PINE_NEEDLES;
      // Sprays radiating from near the centre, back to front.
      const n = ns.sprays[0] + Math.floor(r(0) * ns.sprays[1]);
      for (let i = 0; i < n; i++) {
        const ang = r(i * 7 + 1) * Math.PI * 2;
        const start = r(i * 7 + 2) * 28 * K;
        const len = (ns.twig[0] + (ns.twig[1] - ns.twig[0]) * r(i * 7 + 3)) * K;
        spray(
          c + tcos(ang) * start,
          c + tsin(ang) * start,
          len,
          ang + (r(i * 7 + 4) - 0.5) * 0.6,
          (k) => r(5000 + i * 1000 + k),
          0.75 + 0.35 * r(i * 7 + 5),
          (r(i * 7 + 6) - 0.5) * 1.2,
          (r(i * 7 + 6 + 100) - 0.5) * 0.6,
          (r(i * 7 + 7) - 0.5) * 0.6,
          ns,
        );
      }
    } else if (style === 'juniper') {
      // A drooping frond: a stem along the arc with branchlets alternating left and right (longest near the base, swept
      // towards the tip), each a feathery chain of scale leaves; a second, shorter frond sometimes forks off.
      const half = SPRAY_HALF * K;
      const sag = (r(900) - 0.5) * 2 * SPRAY_SAG * half;
      const droop = (r(901) + 0.2) * 0.32 * half;
      const main: Arc = (t) => [
        c - half + 2 * half * t,
        c + sag * (1 - (2 * t - 1) ** 2) + droop * t * t,
      ];
      const frond = (arc: Arc, scale: number, salt: number) => {
        for (let t = 0; t <= 0.98; t += 0.5 / half)
          stamp(...arc(t), (1.5 - 0.8 * t) * K, 0.32, 0, 0, 0, 0);
        const n = Math.round((2 * half * scale) / (5.2 * K));
        for (let m = 0; m < n; m++) {
          const q = (k: number) => r(salt + 20 + m * 41 + k);
          const t = 0.04 + (0.93 * (m + 0.5)) / n;
          const side = m % 2 === 0 ? 1 : -1;
          const [xa, ya] = arc(Math.max(0, t - 0.01));
          const [xb, yb] = arc(Math.min(1, t + 0.01));
          const slope = Math.atan2(yb - ya, xb - xa);
          const [bx, by] = arc(t);
          const env = Math.pow(1 - t, 0.55) * Math.min(1, 0.3 + t * 7);
          const len = (16 + 26 * q(1)) * env * K * scale;
          let ang = slope + side * (0.85 + 0.35 * q(2));
          let x = bx;
          let y = by;
          const steps = Math.max(2, Math.round(len / (0.7 * K)));
          for (let k = 0; k <= steps; k++) {
            const f = k / steps;
            const v = (0.5 + 0.5 * f) * (0.85 + 0.3 * q(3));
            stamp(
              x,
              y,
              (1.5 - 0.7 * f) * K,
              v,
              (q(4) - 0.5) * 1.2,
              side * 0.35,
              0,
              0,
            );
            // Scale-leaf tufts either side of the branchlet.
            if (k % 4 === 2 && f < 0.95)
              for (const sd of [-1, 1]) {
                const ta = ang + sd * (0.8 + 0.3 * q(5 + k));
                const tl = 5 * K * (1 - 0.5 * f);
                stamp(
                  x + tcos(ta) * tl * 0.5,
                  y + tsin(ta) * tl * 0.5,
                  1 * K,
                  v * 1.05,
                  (q(6) - 0.5) * 1.2,
                  side * 0.35,
                  0,
                  0,
                );
                stamp(
                  x + tcos(ta) * tl,
                  y + tsin(ta) * tl,
                  0.9 * K,
                  v * 1.12,
                  (q(7) - 0.5) * 1.2,
                  side * 0.35,
                  0,
                  0,
                );
              }
            ang += (slope - ang) * 0.03;
            x += tcos(ang) * 0.7 * K;
            y += tsin(ang) * 0.7 * K;
          }
        }
      };
      if (r(902) < 0.6) {
        const at = 0.25 + 0.25 * r(903);
        const [bx, by] = main(at);
        const a = (r(904) < 0.5 ? -1 : 1) * (0.4 + 0.3 * r(905));
        const l = 2 * half * (0.4 + 0.12 * r(906));
        const bend = (r(907) - 0.2) * 0.3 * l;
        frond(
          (t) => [
            bx + t * l * tcos(a) - bend * t * t * tsin(a),
            by + t * l * tsin(a) + bend * t * t * tcos(a),
          ],
          0.5,
          5000,
        );
      }
      frond(main, 1, 0);
    } else {
      const st = BROAD[style];
      const prof = profiles.get(style) ?? profile(st);
      profiles.set(style, prof);
      const half = SPRAY_HALF * K;
      const lmid = (st.len[0] + st.len[1]) * 0.5 * K;
      // The shoot arcs: `sag` px below (or above) the line from its base to its tip in the middle, its tip drooping on.
      const sag = (r(900) - 0.5) * 2 * SPRAY_SAG * half;
      const droop = (r(901) - 0.3) * 0.25 * half;
      const main: Arc = (t) => [
        c - half + 2 * half * t,
        c + sag * (1 - (2 * t - 1) ** 2) + droop * t * t,
      ];
      /** A leaf on a short stalk at (x, y) pointing `ang`, `rim` (0 inner .. 1 outer) darkens the inside of the spray. */
      const stalked = (
        x: number,
        y: number,
        ang: number,
        rim: number,
        scale: number,
        q: (k: number) => number,
      ) => {
        const l = (st.len[0] + (st.len[1] - st.len[0]) * q(0)) * K * scale;
        const stalk = 0.25 * l;
        const sx = x + tcos(ang) * stalk;
        const sy = y + tsin(ang) * stalk;
        stamp(
          x + tcos(ang) * stalk * 0.5,
          y + tsin(ang) * stalk * 0.5,
          0.7 * K,
          0.35,
          0,
          0,
          0,
          0,
        );
        const out = (q(1) - 0.5) * 0.5 + rim * 0.3;
        leaf(
          sx,
          sy,
          ang,
          l,
          l / st.aspect / 2,
          (0.5 + 0.62 * rim) * (0.82 + 0.36 * q(2)),
          (q(3) - 0.5) * 2,
          tcos(ang) * 0.25 * rim + (q(4) - 0.5) * 0.7 + out * 0.1,
          tsin(ang) * 0.25 * rim + (q(5) - 0.5) * 0.7,
          st,
          prof,
        );
      };
      /**
       * A leafy branch along an arc (t 0 = base .. 1 = tip): the stem, twigs alternating left and right (longest in
       * the middle, swept towards the tip), leaves alternating along each twig and three at its end, and a tuft at
       * the tip. Leaves near the stem are darker, the outer ones lighter.
       */
      const shoot = (arc: Arc, scale: number, thick: number, salt: number) => {
        for (let t = 0; t <= 0.97; t += 0.5 / half)
          stamp(...arc(t), (thick * (1 - 0.55 * t) + 0.4) * K, 0.3, 0, 0, 0, 0);
        const n = Math.max(
          3,
          Math.round(
            (2 * half * scale) / (st.step * K * (0.85 + 0.3 * r(salt + 1))),
          ),
        );
        const reachMax = lmid * st.twig[1] + lmid;
        for (let m = 0; m < n; m++) {
          const q = (k: number) => r(salt + 20 + m * 97 + k);
          const t = 0.05 + (0.88 * (m + 0.5 + (q(1) - 0.5) * 0.5)) / n;
          const side = (m + (q(11) < 0.15 ? 1 : 0)) % 2 === 0 ? 1 : -1;
          const [xa, ya] = arc(Math.max(0, t - 0.01));
          const [xb, yb] = arc(Math.min(1, t + 0.01));
          const slope = Math.atan2(yb - ya, xb - xa);
          const [bx, by] = arc(t);
          const env = tsin(Math.PI * Math.pow(t, 0.7));
          const len =
            lmid *
            (st.twig[0] + (st.twig[1] - st.twig[0]) * q(2)) *
            (0.35 + 0.75 * env) *
            scale;
          const dir = slope + side * (0.5 + 0.5 * q(3));
          const bend = st.bend * len * (0.4 + q(4)) * (q(9) < 0.5 ? 1 : -1);
          const at = (s: number): [number, number] => {
            const f = s / Math.max(len, 1);
            return [
              bx + tcos(dir) * s - tsin(dir) * bend * f * f,
              by + tsin(dir) * s + tcos(dir) * bend * f * f,
            ];
          };
          for (let s = 0; s <= len; s += 0.6 * K)
            stamp(...at(s), (0.9 - 0.4 * (s / len)) * K, 0.3, 0, 0, 0, 0);
          const rimAt = (s: number) =>
            Math.min(1, (s + Math.abs(t - 0.5) * lmid) / reachMax + 0.15);
          const spacing = Math.max(1.5 * K, lmid * st.gap);
          let k = 0;
          for (let s = spacing * 0.7; s < len - lmid * 0.4; s += spacing, k++) {
            const [lx, ly] = at(s);
            const alt = k % 2 === 0 ? 1 : -1;
            const qa = (j: number) => r(salt + 5000 + m * 211 + k * 13 + j);
            stalked(
              lx,
              ly,
              dir + alt * (0.55 + 0.6 * qa(6)) + (qa(7) - 0.5) * 0.4,
              rimAt(s),
              0.85 + 0.3 * qa(8),
              qa,
            );
          }
          // Three at the tip: one straight on, two either side.
          const [tx0, ty0] = at(len);
          for (let j = 0; j < 3; j++) {
            const qa = (k2: number) => r(salt + 9000 + m * 211 + j * 17 + k2);
            stalked(
              tx0,
              ty0,
              dir + (j - 1) * (0.5 + 0.3 * qa(6)) + (qa(7) - 0.5) * 0.3,
              rimAt(len),
              j === 1 ? 1.1 : 0.9,
              qa,
            );
          }
        }
        // Tuft at the shoot's tip.
        const [ex, ey] = arc(1);
        const [exa, eya] = arc(0.97);
        const tipAng = Math.atan2(ey - eya, ex - exa);
        for (let j = 0; j < 4; j++) {
          const qa = (k: number) => r(salt + 13000 + j * 17 + k);
          stalked(
            ex,
            ey,
            tipAng + (j - 1.5) * 0.45 + (qa(7) - 0.5) * 0.3,
            0.9,
            1,
            qa,
          );
        }
      };
      // A side shoot forks off the main one: a branch with a branch, not one frond.
      if (r(902) < SPRAY_FORK) {
        const at = 0.25 + 0.3 * r(903);
        const [bx, by] = main(at);
        const a = (r(904) < 0.5 ? -1 : 1) * (0.45 + 0.35 * r(905));
        const l = 2 * half * (0.42 + 0.14 * r(906));
        const bend = (r(907) - 0.4) * 0.35 * l;
        shoot(
          (t) => [
            bx + t * l * tcos(a) - bend * t * t * tsin(a),
            by + t * l * tsin(a) + bend * t * t * tcos(a),
          ],
          0.55,
          1.1,
          5000,
        );
      }
      shoot(main, 1, 1.5, 0);
    }
  }
  const albedo = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  const cut = ALPHA_TEST * 255;
  let sum = 0;
  let leaves = 0;
  for (let k = 0; k < W * H; k++) {
    if (alpha[k] >= cut) {
      sum += shade[k];
      leaves++;
    }
    const i = k * 4;
    const g = shade[k] / 255;
    const t = warm[k] / 127;
    // The shade is a linear multiplier of the palette colour; the texture is sRGB (decoded on read), so encode it.
    albedo[i] = srgb8(Math.min(1, g * (1 + 0.07 * t)));
    albedo[i + 1] = srgb8(g);
    albedo[i + 2] = srgb8(Math.min(1, g * (1 - 0.16 * t)));
    albedo[i + 3] = alpha[k];
    // Tangent-space normal from the leaf tilt + dome (z towards the viewer), thickness from the stacked leaves.
    const x = nx[k] / 64;
    const y = ny[k] / 64;
    const l = Math.sqrt(x * x + y * y + 1);
    normal[i] = Math.round(((x / l) * 0.5 + 0.5) * 255);
    normal[i + 1] = Math.round(((y / l) * 0.5 + 0.5) * 255);
    normal[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    normal[i + 3] = Math.round(Math.min(1, layers[k] / 4) * 255);
  }
  const outlines: Outline[] = [];
  for (let img = 0; img < CLUSTER_IMAGES; img++)
    outlines.push(outline(albedo, W, img, IMAGE));
  const atlas = {
    width: W,
    height: H,
    aligned: style !== 'pine',
    grow: style === 'juniper' ? FROND_GROW : 1,
    albedo,
    normal,
    outlines,
    mean: leaves ? sum / leaves / 255 : 1,
  };
  atlases.set(style, atlas);
  return atlas;
}

/**
 * The tight outline of an image (trees/Performance.md#mitigations): an 8-direction bounding polygon (axis and
 * diagonal extents) of its texels that pass ALPHA_TEST, grown by a texel. 6 to 8 vertices (coincident corners
 * merge), so few pixels are spent on texels the alpha test throws away.
 */
function outline(
  albedo: Uint8Array,
  width: number,
  img: number,
  IMAGE: number,
): Outline {
  const ox = (img % CLUSTER_COLS) * IMAGE;
  const oy = Math.floor(img / CLUSTER_COLS) * IMAGE;
  const thr = ALPHA_TEST * 255;
  let [x0, x1, y0, y1, s0, s1, d0, d1] = [
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
  ];
  for (let y = 0; y < IMAGE; y++)
    for (let x = 0; x < IMAGE; x++) {
      if (albedo[((oy + y) * width + ox + x) * 4 + 3] < thr) continue;
      // The texel's four corners.
      const u0 = x / IMAGE;
      const u1 = (x + 1) / IMAGE;
      const v0 = y / IMAGE;
      const v1 = (y + 1) / IMAGE;
      x0 = Math.min(x0, u0);
      x1 = Math.max(x1, u1);
      y0 = Math.min(y0, v0);
      y1 = Math.max(y1, v1);
      s0 = Math.min(s0, u0 + v0);
      s1 = Math.max(s1, u1 + v1);
      d0 = Math.min(d0, u0 - v1);
      d1 = Math.max(d1, u1 - v0);
    }
  const m = 1 / IMAGE;
  [x0, y0, s0, d0] = [x0 - m, y0 - m, s0 - m, d0 - m];
  [x1, y1, s1, d1] = [x1 + m, y1 + m, s1 + m, d1 + m];
  const clamp = (p: [number, number]): [number, number] => [
    Math.min(1, Math.max(0, p[0])),
    Math.min(1, Math.max(0, p[1])),
  ];
  const raw = (
    [
      [s0 - y0, y0],
      [d1 + y0, y0],
      [x1, x1 - d1],
      [x1, s1 - x1],
      [s1 - y1, y1],
      [d0 + y1, y1],
      [x0, x0 - d0],
      [x0, s0 - x0],
    ] as [number, number][]
  ).map(clamp);
  const out: Outline = [];
  const same = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  for (const p of raw)
    if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  if (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}
