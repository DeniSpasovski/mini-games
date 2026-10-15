import { mix32, tcos, tsin, unit } from './math';
import type { FoliageKind } from './species';

/**
 * The foliage sprite atlas of a foliage kind (spec: trees/Foliage.md#sprites): CLUSTER_IMAGES images of a whole
 * cluster of leaves (broadleaf) or needle sprays (needles), in a CLUSTER_COLS x CLUSTER_ROWS grid of IMAGE px
 * squares. Pure (the meshing worker reads the outlines, trees/materials.ts makes the textures), drawn with the tree
 * code's own trig (trees/math.ts), so the pixels and the outlines fitted to them are the same on every platform.
 *
 * - `albedo`: grey shading (the sprite's vertex colour tints it) + alpha (leaf mask).
 * - `normal`: tangent-space normal (x = image right, y = image up, z = towards the viewer) in RGB, and the thickness
 *   map in A (0 = one thin leaf, light shows through; 1 = many leaves stacked). The atlas's three maps travel in two
 *   textures, so a sprite shader samples two atlas textures + the shadow map (+ the cloud noise every lit material
 *   reads).
 */

export const IMAGE = 128;
export const CLUSTER_COLS = 4;
export const CLUSTER_ROWS = 2;
export const CLUSTER_IMAGES = CLUSTER_COLS * CLUSTER_ROWS;

/** The one alpha-test threshold of the trees: every pass (trees/Foliage.md#alpha). */
export const ALPHA_TEST = 0.5;

export interface SpriteAtlas {
  width: number;
  height: number;
  /** RGBA8, row 0 = v 0. */
  albedo: Uint8Array;
  normal: Uint8Array;
  /** Per image: outline polygon (CCW, 6-8 vertices) in image coordinates (0..1)^2. */
  outlines: Outline[];
}

/** Polygon vertices (CCW) in image coordinates. */
export type Outline = [number, number][];

const atlases = new Map<string, SpriteAtlas>();

/** Atlas uv of point (u, v) of image `i`. */
export function atlasUv(i: number, u: number, v: number): [number, number] {
  const c = i % CLUSTER_COLS;
  const r = Math.floor(i / CLUSTER_COLS);
  return [(c + u) / CLUSTER_COLS, (r + v) / CLUSTER_ROWS];
}

/** The atlas of a foliage kind; `density` scales the leaves (sprays) per image (the species' foliage density). */
export function spriteAtlas(kind: FoliageKind, density = 1): SpriteAtlas {
  const key = `${kind}:${density}`;
  const cached = atlases.get(key);
  if (cached) return cached;
  const W = IMAGE * CLUSTER_COLS;
  const H = IMAGE * CLUSTER_ROWS;
  const alpha = new Float32Array(W * H);
  const shade = new Float32Array(W * H).fill(1);
  const nx = new Float32Array(W * H);
  const ny = new Float32Array(W * H);
  const layers = new Float32Array(W * H);
  let ox = 0;
  let oy = 0;
  /** One leaf-shaped stamp: a disc `r` at (cx, cy), shade `v`, leaf tilt (tx, ty) + a dome across the disc. */
  const stamp = (
    cx: number,
    cy: number,
    r: number,
    v: number,
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
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = Math.min(1, Math.max(0, r - d + 0.5));
        if (a <= 0) continue;
        const k = (oy + y) * W + ox + x;
        if (a >= alpha[k] || a > 0.5) {
          alpha[k] = Math.max(alpha[k], a);
          shade[k] = v;
          nx[k] = tx + (dx / Math.max(r, 1)) * dome;
          ny[k] = ty + (dy / Math.max(r, 1)) * dome;
        }
        if (a > 0.5) layers[k]++;
      }
  };
  /** An elongated leaf from (cx, cy) along `ang`: discs along its length, lighter towards the tip. */
  const leaf = (
    cx: number,
    cy: number,
    ang: number,
    l: number,
    wd: number,
    v: number,
    tx: number,
    ty: number,
  ) => {
    const dx = tcos(ang);
    const dy = tsin(ang);
    const n = Math.ceil(l / 0.8);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const r = wd * tsin(Math.PI * Math.min(1, f * 1.05 + 0.02));
      // The leaf surface curves across its width (the dome) and its blade tilts (tx, ty).
      stamp(
        cx + dx * l * f,
        cy + dy * l * f,
        Math.max(0.6, r),
        v * (0.85 + 0.25 * f),
        tx,
        ty,
        0.45,
      );
    }
  };
  /** A twig with needles both sides. */
  const spray = (
    cx: number,
    cy: number,
    len: number,
    ang: number,
    seed: number,
    v: number,
    tx: number,
    ty: number,
  ) => {
    const dx = tcos(ang);
    const dy = tsin(ang);
    for (let n = 0; n * 4 < len; n++) {
      const f = (n * 4) / len;
      const px = cx + dx * len * f;
      const py = cy + dy * len * f;
      stamp(px, py, 1.1, v * 0.6, tx, ty, 0);
      for (const side of [-1, 1]) {
        const a =
          ang +
          side * (0.8 + 0.3 * unit(mix32(seed, n * 2 + (side > 0 ? 1 : 0))));
        const nl = 15 * (1 - f * 0.5);
        for (let s = 0; s <= nl; s += 0.8)
          stamp(
            px + tcos(a) * s,
            py + tsin(a) * s,
            0.7,
            v * (0.75 + 0.35 * (s / nl)),
            tx + tcos(a) * 0.3,
            ty + tsin(a) * 0.3,
            0,
          );
      }
    }
  };
  for (let img = 0; img < CLUSTER_IMAGES; img++) {
    ox = (img % CLUSTER_COLS) * IMAGE;
    oy = Math.floor(img / CLUSTER_COLS) * IMAGE;
    const r = (k: number) =>
      unit(mix32(mix32(kind === 'needles' ? 31 : 41, img), k));
    const c = IMAGE / 2;
    if (kind === 'needles') {
      // Sprays radiating from near the centre, back to front.
      const n = Math.round((9 + Math.floor(r(0) * 4)) * density);
      for (let i = 0; i < n; i++) {
        const ang = r(i * 7 + 1) * Math.PI * 2;
        const start = r(i * 7 + 2) * 14;
        const len = 34 + 18 * r(i * 7 + 3);
        spray(
          c + tcos(ang) * start,
          c + tsin(ang) * start,
          len,
          ang + (r(i * 7 + 4) - 0.5) * 0.6,
          img * 97 + i,
          0.7 + 0.35 * r(i * 7 + 5),
          (r(i * 7 + 6) - 0.5) * 0.6,
          (r(i * 7 + 7) - 0.5) * 0.6,
        );
      }
    } else {
      // A rounded bunch of leaves: inner ones first (darker), outer ones on top, all pointing roughly outwards.
      const n = Math.round((34 + Math.floor(r(0) * 10)) * density);
      for (let i = 0; i < n; i++) {
        const ang = r(i * 9 + 1) * Math.PI * 2;
        const rad = Math.sqrt((i + 0.5) / n) * IMAGE * 0.36;
        const px = c + tcos(ang) * rad * (0.8 + 0.3 * r(i * 9 + 2));
        const py = c + tsin(ang) * rad * (0.8 + 0.3 * r(i * 9 + 3));
        const point = ang + (r(i * 9 + 4) - 0.5) * 1.4;
        const v =
          (0.62 + 0.4 * (rad / (IMAGE * 0.36))) * (0.85 + 0.25 * r(i * 9 + 5));
        leaf(
          px,
          py,
          point,
          18 + 9 * r(i * 9 + 6),
          6 + 2 * r(i * 9 + 7),
          v,
          (r(i * 9 + 8) - 0.5) * 0.8,
          (r(i * 9 + 9) - 0.5) * 0.8,
        );
      }
    }
  }
  const albedo = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const g = Math.round(Math.min(1, shade[k]) * 255);
    albedo.set([g, g, g, Math.round(alpha[k] * 255)], k * 4);
    // Tangent-space normal from the leaf tilt + dome (z towards the viewer), thickness from the stacked leaves.
    const x = nx[k];
    const y = ny[k];
    const z = 1;
    const l = Math.sqrt(x * x + y * y + z * z);
    normal.set(
      [
        Math.round(((x / l) * 0.5 + 0.5) * 255),
        Math.round(((y / l) * 0.5 + 0.5) * 255),
        Math.round(((z / l) * 0.5 + 0.5) * 255),
        Math.round(Math.min(1, layers[k] / 4) * 255),
      ],
      k * 4,
    );
  }
  const outlines: Outline[] = [];
  for (let img = 0; img < CLUSTER_IMAGES; img++)
    outlines.push(outline(albedo, W, img));
  const atlas = { width: W, height: H, albedo, normal, outlines };
  atlases.set(key, atlas);
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
      for (const [cx, cy] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ]) {
        const u = cx / IMAGE;
        const v = cy / IMAGE;
        x0 = Math.min(x0, u);
        x1 = Math.max(x1, u);
        y0 = Math.min(y0, v);
        y1 = Math.max(y1, v);
        s0 = Math.min(s0, u + v);
        s1 = Math.max(s1, u + v);
        d0 = Math.min(d0, u - v);
        d1 = Math.max(d1, u - v);
      }
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
