import { atlasUv, CLUSTER_IMAGES, spriteAtlas } from './leaftex';
import {
  cross,
  GOLDEN,
  hexToLinear,
  len,
  madd,
  mix32,
  norm,
  scale,
  sub,
  tcos,
  tsin,
  TreeRng,
  unit,
  type V3,
} from './math';
import { segmentDir, type LeafPoint, type Skeleton } from './skeleton';
import type { SpeciesDef } from './species';

/**
 * Stage 3, meshing (spec: trees/Lod.md#levels, trees/Foliage.md): the branch levels of a variant from its one
 * skeleton, and its foliage sprites on the skeleton's leaf points. Pure (typed arrays, no engine), so it runs in the
 * generator worker.
 *
 *  - LOD0: every segment at least the species' `twigRadius` thick as a tapered tube (fewer sides per higher order);
 *    thinner twigs are left out, the sprites cover them. Capped at `maxBranchTriangles` (the twig radius grows until
 *    it fits).
 *  - LOD1: the trunk and the thicker first-order limbs of LOD0 (the levels nest: same segments, same place and radius).
 *  - Sprites: one per leaf point, at most `maxSprites` (the most important ones, grown to keep the crown's area),
 *    drawn with every branch level and thinned continuously with distance by the shader (trees/materials.ts).
 * The impostor is baked from LOD0 + the sprites (trees/impostor.ts).
 *
 * Branch vertices: position, normal, uv, color (linear), `treeWind` = (branch order, phase, distance along the
 * limb, baked ambient occlusion).
 */

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  wind: Float32Array;
  index: Uint32Array;
}

/**
 * Foliage sprites (trees/Foliage.md#sprites): every vertex of a sprite's outline carries the sprite's centre
 * (`position`, object space), the crown's normal there (`normal`), its atlas uv, colour, `treeWind` (as branches,
 * w = the sprite's baked AO), `treeSprite` = (outline corner x, y in sprite units -0.5..0.5, size m, - ), its
 * `heading` (the way a broadleaf spray grows, trees/sprite-attr.ts packs both) and `treeRank` (0 = kept longest ..
 * 1 = thinned first). The shader turns each into a quad facing the camera position, its x axis along the heading.
 */
export interface SpriteData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  wind: Float32Array;
  sprite: Float32Array;
  /** Unit, object space, 3 per vertex; a needle burst (round image) has none: the first vertex's y is 2. */
  heading: Float32Array;
  rank: Float32Array;
  index: Uint32Array;
  /** Index count up to and including sprite j (sprites are stored in rank order: a thinned crown draws a prefix). */
  ends: Uint32Array;
  /** Sprites (not vertices). */
  count: number;
}

/** The crown's fitted ellipsoid (object space): centre and radii. */
export interface Crown {
  c: V3;
  r: V3;
}

export interface VariantMeshes {
  /** LOD0 and LOD1 branches. */
  levels: [MeshData, MeshData];
  /** Segments drawn per branch level. */
  segments: [number, number];
  sprites: SpriteData;
  crown: Crown;
  /** Top of the tree incl. foliage (m) and its widest horizontal reach. */
  height: number;
  radius: number;
  /** Bounding sphere centre height and radius (impostor frames, level selection). */
  sphere: { cy: number; r: number };
  /** Mean foliage colour (linear). */
  foliageColor: V3;
}

/** Radius of a segment's overlap tip, as a share of its end radius (`tube`). */
const OVERLAP_TIP = 0.75;

/** Tube sides per branch order (last entry for every higher order). */
/** LOD1 keeps the trunk and the first-order limbs at least `height / LOD1_LIMB_DIV` thick. */
const LOD1_LIMB_DIV = 120;

const SIDES: number[][] = [
  [8, 5, 4, 3],
  [6, 4],
];

class Builder {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  w: number[] = [];
  idx: number[] = [];

  get count(): number {
    return this.p.length / 3;
  }

  vertex(
    p: V3,
    n: V3,
    u: number,
    v: number,
    c: V3,
    w: [number, number, number, number],
  ): void {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.c.push(c[0], c[1], c[2]);
    this.w.push(w[0], w[1], w[2], w[3]);
  }

  build(): MeshData {
    return {
      position: new Float32Array(this.p),
      normal: new Float32Array(this.n),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.c),
      wind: new Float32Array(this.w),
      index: new Uint32Array(this.idx),
    };
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function fitCrown(sk: Skeleton, size: number): Crown {
  const ls = sk.leaves;
  if (!ls.length) return { c: [0, sk.height * 0.6, 0], r: [1, 1, 1] };
  let c: V3 = [0, 0, 0];
  for (const l of ls) c = madd(c, l.pos, 1 / ls.length);
  let rxz = 0;
  let ry = 0;
  for (const l of ls) {
    const d = sub(l.pos, c);
    rxz = Math.max(rxz, Math.sqrt(d[0] * d[0] + d[2] * d[2]));
    ry = Math.max(ry, Math.abs(d[1]));
  }
  rxz = Math.max(0.3, rxz + size * 0.4);
  ry = Math.max(0.3, ry + size * 0.4);
  return { c, r: [rxz, ry, rxz] };
}

/** Crown-relative position: ellipsoid "radius" (1 on its surface) and outward normal. */
function crownAt(cr: Crown, p: V3): { e: number; n: V3 } {
  const d: V3 = [
    (p[0] - cr.c[0]) / cr.r[0],
    (p[1] - cr.c[1]) / cr.r[1],
    (p[2] - cr.c[2]) / cr.r[2],
  ];
  const e = len(d);
  return { e, n: norm([d[0] / cr.r[0], d[1] / cr.r[1], d[2] / cr.r[2]]) };
}

/** Ambient occlusion from how deep a point sits inside the crown (0.5 at its heart: sky still reaches in). */
function occlusion(cr: Crown, p: V3): number {
  return 0.5 + 0.5 * smoothstep(0.1, 1.0, crownAt(cr, p).e);
}

/** A sprite's: leaves in a crown's heart are shaded but not black (0.8 at the heart). */
function spriteOcclusion(cr: Crown, p: V3): number {
  return 0.8 + 0.2 * smoothstep(0.1, 1.0, crownAt(cr, p).e);
}

function perpendicular(d: V3): V3 {
  return norm(cross(d, Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
}

interface WindData {
  /** Phase of each segment's first-order limb (rad) and the distance along that limb at the segment start (m). */
  phase: Float32Array;
  dist: Float32Array;
}

/**
 * Wind data per segment: every segment of a first-order limb (and its twigs) shares the limb's phase, and the
 * distance runs along the path from where the limb leaves the trunk, so a twig sways with the limb it grows on.
 */
function windData(sk: Skeleton, seed: number): WindData {
  const n = sk.segments.length;
  const phase = new Float32Array(n);
  const dist = new Float32Array(n);
  sk.segments.forEach((s, i) => {
    const p = s.parent >= 0 ? sk.segments[s.parent] : null;
    if (s.order === 0 || !p || p.order === 0) {
      phase[i] = unit(mix32(seed, s.branch + 1)) * Math.PI * 2;
      dist[i] = 0;
    } else {
      phase[i] = phase[s.parent];
      dist[i] = dist[s.parent] + len(sub(p.end, p.start));
    }
  });
  return { phase, dist };
}

function leafWind(sk: Skeleton, wd: WindData, l: LeafPoint): [number, number] {
  if (l.segment < 0) return [0, 0];
  const s = sk.segments[l.segment];
  return [wd.phase[l.segment], wd.dist[l.segment] + len(sub(s.end, s.start))];
}

function tube(
  b: Builder,
  sk: Skeleton,
  i: number,
  sides: number,
  bark: V3,
  tiling: number,
  cr: Crown,
  wd: WindData,
): void {
  const s = sk.segments[i];
  const d = segmentDir(s);
  const a = perpendicular(d);
  const c = cross(d, a);
  const length = len(sub(s.end, s.start));
  // Overlap into the next segment: no gap on the outside of a bend. The overlap narrows to OVERLAP_TIP of the end
  // radius, so it sits inside the next segment instead of on its surface (no z-fighting, trees/Drawing.md#depth).
  const over = Math.min(s.r1 * 0.6, length * 0.5);
  const rings: [V3, number, number][] = [
    [s.start, s.r0, 0],
    [s.end, s.r1, length],
    [madd(s.end, d, over), s.r1 * OVERLAP_TIP, length + over],
  ];
  const base = b.count;
  for (const [o, r, along] of rings) {
    const v = (s.dist + along) * tiling;
    const wd2 = wd.dist[i] + along;
    for (let k = 0; k <= sides; k++) {
      const t = (k / sides) * Math.PI * 2;
      const n = norm(madd(scale(a, tcos(t)), c, tsin(t)));
      const p = madd(o, n, r);
      b.vertex(p, n, k / sides, v, bark, [
        s.order,
        wd.phase[i],
        wd2,
        occlusion(cr, p),
      ]);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let k = 0; k < sides; k++) {
      const i0 = base + ring * (sides + 1) + k;
      const i1 = i0 + sides + 1;
      b.idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
}

function leafColor(def: SpeciesDef, seed: number, l: number): V3 {
  const rng = new TreeRng(mix32(seed ^ 0x51ed27, l));
  const pal = def.foliage.palette;
  const c = hexToLinear(pal[Math.floor(rng.next() * pal.length)]);
  return scale(c, rng.range(0.88, 1.1));
}

/** Thin twigs that show between the leaves are dark brown, not the pale grey of the trunk. */
function twigBark(bark: V3, order: number): V3 {
  const k = Math.min(1, Math.max(0, (order - 1) / 2));
  return [
    bark[0] + (0.06 * 0.9 - bark[0]) * k,
    bark[1] + (0.045 * 0.9 - bark[1]) * k,
    bark[2] + (0.03 * 0.9 - bark[2]) * k,
  ];
}

function mean(cs: V3[]): V3 {
  let m: V3 = [0, 0, 0];
  for (const c of cs) m = madd(m, c, 1 / cs.length);
  return m;
}

/** LOD0 / LOD1 branch tubes for a twig radius; the triangle count of LOD0. */
function branches(
  sk: Skeleton,
  def: SpeciesDef,
  twig: number,
  cr: Crown,
  wd: WindData,
): { levels: [MeshData, MeshData]; segments: [number, number]; tris: number } {
  const bark = hexToLinear(def.bark.color);
  const sides = (lod: number, order: number) =>
    SIDES[lod][Math.min(order, SIDES[lod].length - 1)];
  const b0 = new Builder();
  const b1 = new Builder();
  let n0 = 0;
  let n1 = 0;
  // LOD1 starts where a tree is 7 % of the screen high: a limb under 1 / 120 of its height is under a pixel wide there.
  const limb = sk.height / LOD1_LIMB_DIV;
  sk.segments.forEach((s, i) => {
    if (s.r0 < twig) return;
    const tint = twigBark(bark, s.order);
    tube(b0, sk, i, sides(0, s.order), tint, def.bark.tiling, cr, wd);
    n0++;
    if (s.order === 0 || (s.order === 1 && s.r0 >= limb)) {
      tube(b1, sk, i, sides(1, s.order), tint, def.bark.tiling, cr, wd);
      n1++;
    }
  });
  return {
    levels: [b0.build(), b1.build()],
    segments: [n0, n1],
    tris: b0.idx.length / 3,
  };
}

/**
 * Sprite rank (trees/Foliage.md#simplification): leaf points on the branches carrying the most wood (prune priority
 * of the segment they hang from) first, with a seeded jitter so thinning does not follow branch boundaries.
 */
function spriteOrder(sk: Skeleton, seed: number): number[] {
  const importance = sk.leaves.map((l, i) => {
    const pr = l.segment >= 0 ? sk.segments[l.segment].priority : 0;
    return Math.log(1e-4 + pr) + (unit(mix32(seed ^ 0x2a7e, i)) - 0.5) * 1.5;
  });
  return [...sk.leaves.keys()].sort(
    (a, b) => importance[b] - importance[a] || a - b,
  );
}

/** A broadleaf spray is longer than wide: grown so a crown covers about what round clumps did. */
const SPRAY_GROW = 1.15;
/** Share of the sprite size a spray's centre lies beyond its leaf point (its base sits on the twig). */
const SPRAY_REACH = 0.2;
/** A spray leans this far from the twig's heading, round it by the golden angle, and droops. */
const SPRAY_SPLAY = 0.55;
const SPRAY_DROOP = 0.18;

/** The way the spray of leaf point `l` grows: along its twig, splayed round it, drooping. */
function sprayHeading(l: LeafPoint, jitter: number): V3 {
  const left = cross(l.heading, l.up);
  const phi = l.index * GOLDEN + jitter * 0.9;
  const side = madd(scale(l.up, tcos(phi)), left, tsin(phi));
  const h = madd(l.heading, side, SPRAY_SPLAY);
  return norm([h[0], h[1] - SPRAY_DROOP, h[2]]);
}

function sprites(
  sk: Skeleton,
  def: SpeciesDef,
  seed: number,
  cr: Crown,
  wd: WindData,
  colors: V3[],
): SpriteData {
  const atlas = spriteAtlas(def.foliage.leaf);
  const order = spriteOrder(sk, seed);
  const kept = order.slice(0, def.maxSprites);
  // Fewer sprites than leaf points: each kept one grows so the crown covers the same area.
  const grow = Math.sqrt(order.length / Math.max(1, kept.length));
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const spr: number[] = [];
  const head: number[] = [];
  const rank: number[] = [];
  const idx: number[] = [];
  const ends: number[] = [];
  kept.forEach((li, k) => {
    const l = sk.leaves[li];
    const r = (n: number) => unit(mix32(mix32(seed, li), n));
    const image = Math.min(
      CLUSTER_IMAGES - 1,
      Math.floor(r(1) * CLUSTER_IMAGES),
    );
    // Size from the cluster: the finer the branch it hangs on, the smaller the bunch.
    const size =
      def.foliage.spriteSize *
      grow *
      (0.8 + 0.4 * r(2)) *
      (l.order <= 1 ? 1.15 : 1) *
      (atlas.aligned ? SPRAY_GROW : 1);
    // A spray grows along its heading from the twig; a round burst has none.
    const heading = atlas.aligned ? sprayHeading(l, r(3) - 0.5) : null;
    // Needle sprays sit along the twig behind its tip, leaf sprays start on it and grow out, bunches around it.
    const centre = heading
      ? madd(l.pos, heading, SPRAY_REACH * size)
      : def.foliage.kind === 'needles'
        ? madd(l.pos, l.heading, -0.3 * size)
        : l.pos;
    const n = crownAt(cr, centre).n;
    const ao = spriteOcclusion(cr, centre);
    const w = leafWind(sk, wd, l);
    const shape = atlas.outlines[image];
    const base = pos.length / 3;
    for (const [u, v] of shape) {
      pos.push(...centre);
      nrm.push(...n);
      uv.push(...atlasUv(image, u, v));
      col.push(...colors[li]);
      wind.push(l.order, w[0], w[1], ao);
      spr.push(u - 0.5, v - 0.5, size, 0);
      head.push(...(heading ?? [0, 2, 0]));
      rank.push(k / Math.max(1, kept.length));
    }
    for (let j = 1; j + 1 < shape.length; j++)
      idx.push(base, base + j, base + j + 1);
    ends.push(idx.length);
  });
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uv),
    color: new Float32Array(col),
    wind: new Float32Array(wind),
    sprite: new Float32Array(spr),
    heading: new Float32Array(head),
    rank: new Float32Array(rank),
    index: new Uint32Array(idx),
    ends: new Uint32Array(ends),
    count: kept.length,
  };
}

export function buildMeshes(
  sk: Skeleton,
  def: SpeciesDef,
  seed: number,
): VariantMeshes {
  const cr = fitCrown(sk, def.foliage.spriteSize);
  const wd = windData(sk, seed);
  const colors = sk.leaves.map((_, i) => leafColor(def, seed, i));
  // Branch cap: thicker twigs drop out until LOD0 fits (deterministic, the levels still nest).
  let twig = def.twigRadius;
  let br = branches(sk, def, twig, cr, wd);
  while (br.tris > def.maxBranchTriangles) {
    twig *= 1.2;
    br = branches(sk, def, twig, cr, wd);
  }
  const sp = sprites(sk, def, seed, cr, wd, colors);

  // Bounds: branches + sprites (a sprite reaches half its diagonal around its centre).
  let height = 0;
  let radius = 0;
  const reach = (x: number, y: number, z: number, r: number) => {
    height = Math.max(height, y + r);
    radius = Math.max(radius, Math.sqrt(x * x + z * z) + r);
  };
  const p0 = br.levels[0].position;
  for (let i = 0; i < p0.length; i += 3) reach(p0[i], p0[i + 1], p0[i + 2], 0);
  for (let i = 0; i < sp.position.length / 3; i++)
    reach(
      sp.position[i * 3],
      sp.position[i * 3 + 1],
      sp.position[i * 3 + 2],
      sp.sprite[i * 4 + 2] * 0.71,
    );
  const cy = height / 2;
  let r = 0;
  for (let i = 0; i < p0.length; i += 3)
    r = Math.max(
      r,
      Math.sqrt(p0[i] ** 2 + (p0[i + 1] - cy) ** 2 + p0[i + 2] ** 2),
    );
  for (let i = 0; i < sp.position.length / 3; i++) {
    const [x, y, z] = [
      sp.position[i * 3],
      sp.position[i * 3 + 1] - cy,
      sp.position[i * 3 + 2],
    ];
    r = Math.max(
      r,
      Math.sqrt(x * x + y * y + z * z) + sp.sprite[i * 4 + 2] * 0.71,
    );
  }

  return {
    levels: br.levels,
    segments: br.segments,
    sprites: sp,
    crown: cr,
    height,
    radius,
    sphere: { cy, r: r * 1.02 },
    foliageColor: colors.length
      ? mean(colors)
      : hexToLinear(def.foliage.palette[0]),
  };
}

/** Every typed array buffer of a variant's meshes (transferred from the worker, not copied). */
export function meshBuffers(m: VariantMeshes): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const d of m.levels)
    for (const a of [d.position, d.normal, d.uv, d.color, d.wind, d.index])
      out.push(a.buffer as ArrayBuffer);
  const s = m.sprites;
  for (const a of [
    s.position,
    s.normal,
    s.uv,
    s.color,
    s.wind,
    s.sprite,
    s.rank,
    s.index,
    s.ends,
  ])
    out.push(a.buffer as ArrayBuffer);
  return out;
}
