import { mix32, tcos, tsin, unit } from './math';
import type { FoliageKind } from './species';

/**
 * The foliage sprite atlas of a leaf style (spec: trees/Foliage.md#sprites): CLUSTER_IMAGES images of a whole
 * cluster of leaves (broadleaf) or needle sprays (needles), in a CLUSTER_COLS x CLUSTER_ROWS grid of IMAGE px
 * squares. Pure (the meshing worker reads the outlines, trees/materials.ts makes the textures), drawn with the tree
 * code's own trig (trees/math.ts), so the pixels and the outlines fitted to them are the same on every platform.
 *
 * A broadleaf image is a leafy shoot lying along the image's x axis (its base on the left, `SPRAY_*`): a dozen
 * rounded lobes of small leaves (a leaf is 4-9 % of the image) in a row that swells and tapers, swept towards the tip,
 * on a thin twig, dark in the lobes' hearts and lighter at their rims. A sprite turns so that x follows its twig
 * (trees/sprite-attr.ts), so a crown reads as leafy sprays along its branches with a ragged edge, not as round
 * clumps. A needle image is a burst of sprays round the middle.
 *
 * - `albedo`: grey shading + a slight warm / cool tint per leaf (the sprite's vertex colour is the palette colour)
 *   + alpha (leaf mask).
 * - `normal`: tangent-space normal (x = image right, y = image up, z = towards the viewer) in RGB, and the thickness
 *   map in A (0 = one thin leaf, light shows through; 1 = many leaves stacked). The atlas's three maps travel in two
 *   textures, so a sprite shader samples two atlas textures + the shadow map (+ the cloud noise every lit material
 *   reads).
 */

export const IMAGE = 256;
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
  /** Broadleaf images lie along x and are turned to their twig; needle bursts are round. */
  aligned: boolean;
  /** RGBA8, row 0 = v 0. */
  albedo: Uint8Array;
  normal: Uint8Array;
  /** Per image: outline polygon (CCW, 6-8 vertices) in image coordinates (0..1)^2. */
  outlines: Outline[];
}

/** Polygon vertices (CCW) in image coordinates. */
export type Outline = [number, number][];

/** Point (px) at t (0..1) along a shoot. */
type Arc = (t: number) => [number, number];

interface Spot {
  x: number;
  y: number;
  r: number;
  tone: number;
  /** Direction of the shoot here (rad). */
  slope: number;
}

/** Pixel sizes below are for a 256 px image. */
const K = IMAGE / 256;
/** The shoot: half its length along x (px), lobes along it (min, extra), their radius against a ring lobe's, its sag. */
const SPRAY_HALF = 92;
const SPRAY_LOBES: [number, number] = [12, 4];
const SPRAY_LOBE = 0.78;
const SPRAY_SAG = 0.2;
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
  /** Lobes per image (min, extra) and their radius (px). */
  lobes: [number, number];
  lobeR: [number, number];
  /** Share of the lobe's area the leaves cover (more = denser, darker mass). */
  fill: number;
}

const BROAD: Record<Exclude<LeafStyle, 'pine' | 'juniper'>, BroadStyle> = {
  // Beech, sapling: smooth ovate, pointed tip.
  ovate: {
    len: [17, 24],
    aspect: 1.9,
    edge: 'none',
    repeats: 0,
    amp: 0,
    lobes: [9, 3],
    lobeR: [30, 44],
    fill: 1.3,
  },
  // Hornbeam, hazel: toothed edge.
  serrate: {
    len: [16, 22],
    aspect: 1.75,
    edge: 'saw',
    repeats: 7,
    amp: 0.2,
    lobes: [9, 3],
    lobeR: [30, 44],
    fill: 1.3,
  },
  // Oak, plane: lobed outline.
  lobed: {
    len: [22, 30],
    aspect: 1.55,
    edge: 'wave',
    repeats: 3.5,
    amp: 0.34,
    lobes: [8, 3],
    lobeR: [32, 46],
    fill: 1.25,
  },
  // Walnut, fruit trees, poplar: broad, blunt.
  round: {
    len: [20, 28],
    aspect: 1.35,
    edge: 'none',
    repeats: 0,
    amp: 0,
    lobes: [8, 3],
    lobeR: [32, 46],
    fill: 1.6,
  },
  // Willow, broom: long, narrow.
  narrow: {
    len: [24, 34],
    aspect: 4,
    edge: 'none',
    repeats: 0,
    amp: 0,
    lobes: [10, 3],
    lobeR: [24, 36],
    fill: 1.5,
  },
  // Birch, hawthorn, scrub: small leaves.
  small: {
    len: [11, 16],
    aspect: 1.5,
    edge: 'saw',
    repeats: 4,
    amp: 0.15,
    lobes: [10, 4],
    lobeR: [26, 40],
    fill: 1.4,
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

const NEEDLES: Record<'pine' | 'juniper', NeedleStyle> = {
  pine: {
    sprays: [13, 4],
    twig: [70, 105],
    needle: 30,
    tipShare: 0.55,
    gap: 5,
    radius: 0.95,
    perSide: [2, 3],
  },
  juniper: {
    sprays: [20, 5],
    twig: [60, 90],
    needle: 15,
    tipShare: 0.6,
    gap: 3.6,
    radius: 1.15,
    perSide: [2, 2],
  },
};

const atlases = new Map<LeafStyle, SpriteAtlas>();
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

/** The atlas of a leaf style. */
export function spriteAtlas(style: LeafStyle): SpriteAtlas {
  const cached = atlases.get(style);
  if (cached) return cached;
  const W = IMAGE * CLUSTER_COLS;
  const H = IMAGE * CLUSTER_ROWS;
  const alpha = new Float32Array(W * H);
  const shade = new Float32Array(W * H).fill(1);
  /** Warm (+1, yellower) / cool (-1, bluer) tint of the texel. */
  const warm = new Float32Array(W * H);
  const nx = new Float32Array(W * H);
  const ny = new Float32Array(W * H);
  const layers = new Float32Array(W * H);
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
    if (a >= alpha[k] || a > 0.5) {
      alpha[k] = Math.max(alpha[k], a);
      shade[k] = v;
      warm[k] = w;
      nx[k] = tx;
      ny[k] = ty;
    }
    if (a > 0.5) layers[k]++;
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
        if (l >= 14 * K) {
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
    if (style === 'pine' || style === 'juniper') {
      const ns = NEEDLES[style];
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
    } else {
      const st = BROAD[style];
      const prof = profiles.get(style) ?? profile(st);
      profiles.set(style, prof);
      const half = SPRAY_HALF * K;
      // The shoot arcs: `sag` px below (or above) the line from its base to its tip in the middle, its tip drooping on.
      const sag = (r(900) - 0.5) * 2 * SPRAY_SAG * half;
      const droop = (r(901) - 0.3) * 0.25 * half;
      const main: Arc = (t) => [
        c - half + 2 * half * t,
        c + sag * (1 - (2 * t - 1) ** 2) + droop * t * t,
      ];
      const spots: Spot[] = [];
      /** Lobes along an arc (t 0 = base .. 1 = tip) and the twig under them. */
      const shoot = (
        arc: Arc,
        lobes: number,
        size: number,
        first: number,
        twig: number,
        salt: number,
      ) => {
        for (let t = -first * 0.5; t <= 0.92; t += 0.5 / half) {
          const [x, y] = arc(Math.max(0, t));
          stamp(x, y, twig * K, 0.3, 0, 0, 0, 0);
        }
        for (let m = 0; m < lobes; m++) {
          const q = (k: number) => r(salt + m * 31 + k);
          // The first leaves start a little way out on the twig.
          const t =
            first + ((1 - first) * (m + 0.5 + (q(1) - 0.5) * 0.6)) / lobes;
          // Swells to the middle, narrow at the base and the tip.
          const taper = 0.5 + 0.5 * tsin(Math.PI * Math.pow(t, 0.8));
          const lr =
            (st.lobeR[0] + (st.lobeR[1] - st.lobeR[0]) * q(3)) *
            K *
            SPRAY_LOBE *
            size *
            taper *
            (0.8 + 0.4 * q(5));
          const across = (q(2) - 0.5) * 1.1 * lr;
          const [xa, ya] = arc(Math.max(0, t - 0.01));
          const [xb, yb] = arc(Math.min(1, t + 0.01));
          const slope = Math.atan2(yb - ya, xb - xa);
          const [x, y] = arc(t);
          spots.push({
            x: x - tsin(slope) * across,
            y: y + tcos(slope) * across,
            r: lr,
            tone: 0.8 + 0.25 * Math.abs(t - 0.4),
            slope,
          });
        }
      };
      const lobes = SPRAY_LOBES[0] + Math.floor(r(0) * SPRAY_LOBES[1]);
      // A side shoot forks off the main one, under it: a spray with a branch, not one big leaf.
      if (r(902) < SPRAY_FORK) {
        const at = 0.25 + 0.3 * r(903);
        const [bx, by] = main(at);
        const a = (r(904) < 0.5 ? -1 : 1) * (0.6 + 0.35 * r(905));
        const l = 2 * half * (0.55 + 0.2 * r(906));
        const bend = (r(907) - 0.4) * 0.35 * l;
        shoot(
          (t) => [
            bx + t * l * tcos(a) - bend * t * t * tsin(a),
            by + t * l * tsin(a) + bend * t * t * tcos(a),
          ],
          Math.round(lobes * 0.55),
          0.85,
          0.12,
          1.3,
          5000,
        );
      }
      shoot(main, lobes, 1, 0.1, 1.7, 0);
      // Shaded hearts first, so the lobes' leaves all lie over them.
      spots.forEach((o, m) =>
        stamp(o.x, o.y, o.r * 0.5, 0.5 + 0.1 * r(m * 31 + 4), 0, 0, 0, 0.7),
      );
      // Lobes from the heart outwards (outer ones on top), leaves from the middle of a lobe to its rim.
      spots.forEach((o, m) => {
        const lmid = (st.len[0] + st.len[1]) * 0.5 * K;
        const leafArea = (0.62 * lmid * lmid) / st.aspect;
        const reach = 0.85 * o.r + lmid * 0.3;
        const n = Math.round((st.fill * Math.PI * reach * reach) / leafArea);
        for (let i = 0; i < n; i++) {
          const q = (k: number) => r(m * 4093 + i * 11 + k + 100);
          const rim = Math.sqrt((i + 0.5) / n);
          const rho = rim * o.r * 0.85;
          const th = q(1) * Math.PI * 2;
          // Leaves point out of the lobe and sweep towards the shoot's tip; the ones near its middle any way.
          const point =
            Math.atan2(
              tsin(th) * 0.55 + tsin(o.slope) * 0.9,
              tcos(th) * 0.55 + tcos(o.slope) * 0.9,
            ) +
            (q(2) - 0.5) * (0.7 + 2 * (1 - rim));
          const l = (st.len[0] + (st.len[1] - st.len[0]) * q(3)) * K;
          const v = (0.56 + 0.56 * rim) * o.tone * (0.8 + 0.4 * q(4));
          leaf(
            o.x + tcos(th) * rho,
            o.y + tsin(th) * rho,
            point,
            l,
            l / st.aspect / 2,
            v,
            (q(5) - 0.5) * 2,
            tcos(th) * 0.3 * rim + (q(6) - 0.5) * 0.7,
            tsin(th) * 0.3 * rim + (q(7) - 0.5) * 0.7,
            st,
            prof,
          );
        }
      });
    }
  }
  const albedo = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    const g = Math.min(1, shade[k]);
    const t = warm[k];
    albedo[i] = Math.round(Math.min(1, g * (1 + 0.07 * t)) * 255);
    albedo[i + 1] = Math.round(g * 255);
    albedo[i + 2] = Math.round(Math.min(1, g * (1 - 0.16 * t)) * 255);
    albedo[i + 3] = Math.round(alpha[k] * 255);
    // Tangent-space normal from the leaf tilt + dome (z towards the viewer), thickness from the stacked leaves.
    const x = nx[k];
    const y = ny[k];
    const l = Math.sqrt(x * x + y * y + 1);
    normal[i] = Math.round(((x / l) * 0.5 + 0.5) * 255);
    normal[i + 1] = Math.round(((y / l) * 0.5 + 0.5) * 255);
    normal[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    normal[i + 3] = Math.round(Math.min(1, layers[k] / 4) * 255);
  }
  const outlines: Outline[] = [];
  for (let img = 0; img < CLUSTER_IMAGES; img++)
    outlines.push(outline(albedo, W, img));
  const atlas = {
    width: W,
    height: H,
    aligned: styleKind(style) === 'broadleaf',
    albedo,
    normal,
    outlines,
  };
  atlases.set(style, atlas);
  return atlas;
}

/**
 * The tight outline of an image (trees/Performance.md#mitigations): an 8-direction bounding polygon (axis and
 * diagonal extents) of its texels that pass ALPHA_TEST, grown by a texel. 6 to 8 vertices (coincident corners
 * merge), so few pixels are spent on texels the alpha test throws away.
 */
function outline(albedo: Uint8Array, width: number, img: number): Outline {
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
