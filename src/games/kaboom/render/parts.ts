import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise2D } from '../../../shared/noise';
import { PALETTE, ROUGH } from './materials';

/**
 * Procedural clay models, one merged geometry each (vertex colours = the paint job), so every kind of block is one
 * InstancedMesh. Local space: centred on the cell in xz, standing on y = 0 (the top of the floor tiles).
 */
const noise = new Noise2D(2024);

interface PartOpts {
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Yaw in radians. */
  ry?: number;
  /** Strength of the smooth colour noise (0 = flat paint, and no painted shading either). */
  tint?: number;
  /** Push vertices along their normal by a noise amount (lumpy rocks, mounds). */
  lumpy?: number;
  /** Weld the vertices first, so a rock or pot gets smooth normals instead of facets. */
  smooth?: boolean;
  /** Flatten everything below this height (a rock sitting on the floor). */
  base?: number;
  /** Cut faces: planes `[nx, ny, nz, d]` through the part's centre offset by `d`; what sticks out is pressed flat. */
  cuts?: readonly (readonly [number, number, number, number])[];
  /** Grooves cut across the surface: a plane through `p` with normal `n`, `w` wide (darkened, pushed in). */
  cracks?: readonly Crack[];
  /** Roughness of the material (`ROUGH`), read by the High material; default clay. */
  rough?: number;
  /** Painted shading strength (lighter tops and edges, darker undersides and foot); default 1, 0 with `tint: 0`. */
  paint?: number;
  /** Highlight the bevelled edges (faces that are neither flat side nor top); default for boxes and `flagstone`. */
  edges?: boolean;
  /** Weights of the level's detail texture (`detail.ts`): red = ground, green = second surface, blue = rock; default none. */
  detail?: readonly [number, number] | readonly [number, number, number];
}

export interface Crack {
  p: readonly [number, number, number];
  n: readonly [number, number, number];
  w: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Transform, paint and de-index one primitive so it can be merged with others. The paint job is the "painted look" of
 * DETAILS.md "Style": lighter tops, warm above and cool below, darker undersides and foot, a highlight on bevelled edges.
 */
export function part(
  geo: BufferGeometry,
  hex: number,
  o: PartOpts = {},
): BufferGeometry {
  let g: BufferGeometry;
  if (o.smooth) {
    g = geo.clone();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
  } else g = geo.index ? geo.toNonIndexed() : geo.clone();
  const boxy =
    o.edges ??
    (geo.type === 'BoxGeometry' ||
      geo.type === 'RoundedBoxGeometry' ||
      geo.userData.edges === true);
  g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  if (o.ry) g.rotateY(o.ry);
  g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let moved = false;
  // how far the lumps pushed each vertex out (-1..1): hollows paint darker, bumps lighter
  const bump = new Float32Array(pos.count);
  if (o.lumpy) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = noise.noise2(x * 4.1 + z * 2.3, y * 4.7 + 0.3) * o.lumpy;
      bump[i] = n / o.lumpy;
      pos.setXYZ(
        i,
        x + nor.getX(i) * n,
        y + nor.getY(i) * n,
        z + nor.getZ(i) * n,
      );
    }
    moved = true;
  }
  if (o.cuts) {
    const ox = o.x ?? 0;
    const oy = o.y ?? 0;
    const oz = o.z ?? 0;
    for (let i = 0; i < pos.count; i++)
      for (const [nx, ny, nz, d] of o.cuts) {
        const l = Math.hypot(nx, ny, nz);
        const over =
          ((pos.getX(i) - ox) * nx +
            (pos.getY(i) - oy) * ny +
            (pos.getZ(i) - oz) * nz) /
            l -
          d;
        if (over > 0)
          pos.setXYZ(
            i,
            pos.getX(i) - (nx / l) * over,
            pos.getY(i) - (ny / l) * over,
            pos.getZ(i) - (nz / l) * over,
          );
      }
    moved = true;
  }
  if (o.base !== undefined) {
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) < o.base) pos.setY(i, o.base);
    moved = true;
  }
  const crackAt = new Float32Array(pos.count);
  if (o.cracks) {
    for (let i = 0; i < pos.count; i++) {
      for (const c of o.cracks) {
        const d =
          (pos.getX(i) - c.p[0]) * c.n[0] +
          (pos.getY(i) - c.p[1]) * c.n[1] +
          (pos.getZ(i) - c.p[2]) * c.n[2];
        const k = 1 - smoothstep(0, c.w, Math.abs(d));
        if (k <= 0) continue;
        crackAt[i] = Math.max(crackAt[i], k);
        const dent = k * c.w * 0.7;
        pos.setXYZ(
          i,
          pos.getX(i) - nor.getX(i) * dent,
          pos.getY(i) - nor.getY(i) * dent,
          pos.getZ(i) - nor.getZ(i) * dent,
        );
      }
    }
    moved = true;
  }
  pos.needsUpdate = true;
  if (moved) g.computeVertexNormals();
  let crack = crackAt;
  let lumps = bump;
  if (g.index) {
    // per-vertex weights follow the vertices out of the index
    const index = g.index.array;
    crack = Float32Array.from(index, (j) => crackAt[j]);
    lumps = Float32Array.from(index, (j) => bump[j]);
    g = g.toNonIndexed();
  }
  const pos2 = g.getAttribute('position');
  const nor2 = g.getAttribute('normal');

  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y;
  const hgt = g.boundingBox!.max.y - y0;
  const base = new Color(hex);
  const tint = o.tint ?? 0.1;
  const paint = o.paint ?? (o.tint === 0 ? 0 : 1);
  const colors = new Float32Array(pos2.count * 3);
  const gloss = new Float32Array(pos2.count).fill(1 - (o.rough ?? ROUGH.clay));
  const c = new Color();
  for (let i = 0; i < pos2.count; i++) {
    const x = pos2.getX(i);
    const y = pos2.getY(i);
    const z = pos2.getZ(i);
    const f = 1 + tint * noise.noise2(x * 3.3 + z * 1.9, y * 3.1 + z * 0.7);
    c.copy(base).multiplyScalar(f);
    if (paint) {
      const nx = nor2.getX(i);
      const ny = nor2.getY(i);
      const nz = nor2.getZ(i);
      let v = 1 + 0.12 * ny;
      if (hgt > 0.06) v *= 0.84 + 0.16 * smoothstep(0, 0.35, (y - y0) / hgt);
      if (boxy) {
        const flatness = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
        v *= 1 + 0.14 * smoothstep(0.98, 0.7, flatness);
      }
      v *= (1 - 0.6 * crack[i]) * (1 + 0.22 * lumps[i]);
      v = 1 + (v - 1) * paint;
      c.r *= v * (1 + 0.03 * ny * paint);
      c.g *= v;
      c.b *= v * (1 - 0.04 * ny * paint);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setAttribute('aGloss', new Float32BufferAttribute(gloss, 1));
  g.setAttribute('aDetail', detailAttr(pos2.count, o.detail));
  // welded rocks and flagstones carry no UVs; give them empty ones so every part merges with every other
  if (!g.getAttribute('uv'))
    g.setAttribute(
      'uv',
      new Float32BufferAttribute(new Float32Array(pos2.count * 2), 2),
    );
  return g;
}

/** The `aDetail` attribute for `count` vertices, every one with the weights `w` (none = untouched by the texture). */
export function detailAttr(
  count: number,
  w: readonly number[] = [0, 0, 0],
): Float32BufferAttribute {
  const a = new Float32Array(count * 3);
  const [r = 0, g = 0, b = 0] = w;
  if (r || g || b)
    for (let i = 0; i < count; i++) {
      a[i * 3] = r;
      a[i * 3 + 1] = g;
      a[i * 3 + 2] = b;
    }
  return new Float32BufferAttribute(a, 3);
}

/**
 * Contact shading baked into a block: the colour darkens towards the floor (`y` = 0) over `h`, so the block sits on the
 * tiles instead of floating on them.
 */
export function footShade(
  geo: BufferGeometry,
  h = 0.28,
  k = 0.5,
): BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  if (!col) return geo;
  for (let i = 0; i < pos.count; i++) {
    const f = 1 - k * (1 - smoothstep(0, h, pos.getY(i)));
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  col.needsUpdate = true;
  return geo;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('kaboom: could not merge geometries');
  for (const p of parts) p.dispose();
  return g;
}

export const box = (w: number, h: number, d: number) =>
  new BoxGeometry(w, h, d);
export const rbox = (w: number, h: number, d: number, r: number, seg = 1) =>
  new RoundedBoxGeometry(w, h, d, seg, r);
export const rock = (r: number, detail = 1) =>
  new IcosahedronGeometry(r, detail);

const up = new Vector3(0, 1, 0);
const dir = new Vector3();
const quat = new Quaternion();

/** A round rod (rope, stay, spar) from `a` to `b`, `r` thick: a cylinder turned and placed between the two points. */
export function strut(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  r: number,
  sides = 5,
  r1 = r,
): BufferGeometry {
  dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = new CylinderGeometry(r1, r, len, sides, 1, true);
  quat.setFromUnitVectors(up, dir.divideScalar(len));
  g.applyQuaternion(quat);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** Edge rule of the mid-poly look: bevels of about 4 % of a block (0.04 m), never more than 45 % of the thinnest side. */
export const BEVEL = 0.04;

/** A box with every edge bevelled (`BEVEL` unless given); `seg` 1 = a soft chamfer, 2 = rounder. */
export const bbox = (w: number, h: number, d: number, bevel = BEVEL, seg = 1) =>
  new RoundedBoxGeometry(
    w,
    h,
    d,
    seg,
    Math.min(bevel, 0.45 * Math.min(w, h, d)),
  );

/**
 * A cut stone or plank: the convex outline `pts` (`[x, z]`) extruded from y = 0 to `h`, its top edge chamfered by
 * `bevel`. Flat faces, about 5 triangles per corner.
 */
export function flagstone(
  outline: readonly (readonly [number, number])[],
  h: number,
  bevel = 0.025,
): BufferGeometry {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = outline[i];
    const [x1, z1] = outline[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
  }
  const pts = area >= 0 ? outline : [...outline].reverse();
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / n;
    cz += z / n;
  }
  const top = pts.map(([x, z]): [number, number] => {
    const dx = cx - x;
    const dz = cz - z;
    const l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * bevel * 1.4, z + (dz / l) * bevel * 1.4];
  });
  const yc = h - bevel;
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) =>
    v.push(...a, ...b, ...c);
  for (let i = 1; i < n - 1; i++)
    tri(
      [top[0][0], h, top[0][1]],
      [top[i + 1][0], h, top[i + 1][1]],
      [top[i][0], h, top[i][1]],
    );
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = [top[i][0], h, top[i][1]];
    const t1 = [top[j][0], h, top[j][1]];
    const o0 = [pts[i][0], yc, pts[i][1]];
    const o1 = [pts[j][0], yc, pts[j][1]];
    const b0 = [pts[i][0], 0, pts[i][1]];
    const b1 = [pts[j][0], 0, pts[j][1]];
    tri(t0, t1, o1);
    tri(t0, o1, o0);
    tri(o0, o1, b1);
    tri(o0, b1, b0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  g.userData.edges = true;
  return g;
}

/** Floor tile: a flat rounded slab, top on y = 0. Tinted per instance. */
export function tileGeometry(): BufferGeometry {
  return box(0.97, 0.16, 0.97).translate(0, -0.08, 0);
}

/**
 * Quarry floor tile: four sandstone flags of different sizes with chamfered, chipped edges on a bed of dark grit (the
 * joints), top on y = 0. Turned a random quarter per cell so the pattern does not repeat.
 */
export function flagTileGeometry(): BufferGeometry {
  const q = PALETTE.flags;
  const gap = 0.017;
  // [x0, z0, x1, z1, which corner is chipped (0..3, -1 none), shade, lift]
  const flags: [number, number, number, number, number, number, number][] = [
    [-0.5, -0.5, 0.08, 0.02, 2, 0, 0],
    [0.08, -0.5, 0.5, -0.12, -1, 1, -0.006],
    [0.08, -0.12, 0.5, 0.5, 0, 2, 0.004],
    [-0.5, 0.02, 0.08, 0.5, 3, 1, -0.004],
  ];
  const p: BufferGeometry[] = [
    part(box(1, 0.08, 1), PALETTE.grit, {
      y: -0.075,
      tint: 0.2,
      rough: ROUGH.stone,
    }),
  ];
  for (const [x0, z0, x1, z1, chip, shade, lift] of flags) {
    const pts: [number, number][] = [
      [x0 + gap, z0 + gap],
      [x1 - gap, z0 + gap + 0.008],
      [x1 - gap - 0.006, z1 - gap],
      [x0 + gap + 0.007, z1 - gap],
    ];
    if (chip >= 0) {
      // knock a corner off: the corner becomes two points
      const [cx, cz] = pts[chip];
      const [px, pz] = pts[(chip + 3) % 4];
      const [nx, nz] = pts[(chip + 1) % 4];
      const k = 0.07;
      const lp = Math.hypot(px - cx, pz - cz);
      const ln = Math.hypot(nx - cx, nz - cz);
      pts.splice(
        chip,
        1,
        [cx + ((px - cx) / lp) * k, cz + ((pz - cz) / lp) * k],
        [cx + ((nx - cx) / ln) * k, cz + ((nz - cz) / ln) * k],
      );
    }
    p.push(
      part(flagstone(pts, 0.09, 0.022), q[shade], {
        y: -0.09 + lift,
        tint: 0.12,
        rough: ROUGH.stone,
      }),
    );
  }
  return merge(p);
}

/**
 * Hard block 0: a weathered granite boulder, smooth and lumpy, flat where it sits, with two cracks, a split-off stone and
 * pebbles at its foot.
 */
export function boulderGeometry(low = false): BufferGeometry {
  return merge([
    part(rock(0.55, low ? 3 : 6), PALETTE.granite, {
      y: 0.44,
      sy: 0.9,
      smooth: true,
      lumpy: 0.06,
      cuts: [
        [0.3, 1, 0.2, 0.36],
        [1, 0.4, 0.1, 0.42],
        [-0.8, 0.5, 0.6, 0.4],
        [-0.3, 0.3, -1, 0.42],
        [0.5, 0.2, 1, 0.45],
      ],
      base: 0.02,
      tint: 0.18,
      rough: ROUGH.stone,
      detail: [0, 0.8, 0],
      cracks: [
        { p: [0.05, 0.5, 0], n: [0.94, 0.15, 0.3], w: 0.06 },
        { p: [0, 0.62, -0.1], n: [0.2, 0.55, -0.81], w: 0.05 },
      ],
    }),
    part(rock(0.2, 2), PALETTE.graniteDark, {
      x: 0.37,
      y: 0.12,
      z: 0.33,
      sy: 0.75,
      smooth: true,
      lumpy: 0.04,
      base: 0,
      rough: ROUGH.stone,
    }),
    part(rock(0.07, 1), PALETTE.pebble, {
      x: -0.42,
      y: 0.04,
      z: 0.3,
      smooth: true,
    }),
    part(rock(0.05, 1), PALETTE.pebble, {
      x: -0.3,
      y: 0.03,
      z: 0.42,
      smooth: true,
    }),
  ]);
}

/**
 * The boulders on the Quarry rim: weathered sandstone, smooth with a few cut faces and a crack, flat where they sit, in a
 * pale base colour the instance colour warms (there are a hundred of them, so a fraction of the hard boulder's triangles).
 */
export function rimRockGeometry(): BufferGeometry {
  return part(rock(0.55, 2), 0xe6d2b0, {
    y: 0.44,
    sy: 0.9,
    smooth: true,
    lumpy: 0.07,
    cuts: [
      [0.3, 1, 0.2, 0.4],
      [1, 0.3, 0.2, 0.44],
      [-0.6, 0.4, -0.8, 0.44],
    ],
    cracks: [{ p: [0.1, 0.5, 0], n: [0.9, 0.2, 0.4], w: 0.05 }],
    base: 0.02,
    tint: 0.16,
    rough: ROUGH.stone,
    detail: [0, 0.7, 0],
  });
}

/**
 * Hard block 1: a pillar of four cut blue-grey stone courses on dark mortar, an iron band round the second joint, a wider
 * chamfered capstone and rubble at its foot. Cool, mid-value and taller than a crate (1.3 m against 0.86 m), so it never
 * reads as one of the warm breakables.
 */
export function postGeometry(): BufferGeometry {
  const s = PALETTE.pillar;
  const p: BufferGeometry[] = [
    part(bbox(0.74, 1.12, 0.74), PALETTE.mortar, {
      y: 0.56,
      rough: ROUGH.stone,
      paint: 0,
    }),
  ];
  // [height, width, depth, dx, dz, yaw, shade]
  const courses: [number, number, number, number, number, number, number][] = [
    [0.31, 0.88, 0.86, 0.01, -0.005, 0.02, 1],
    [0.28, 0.84, 0.86, -0.014, 0.008, -0.04, 0],
    [0.28, 0.86, 0.83, 0.008, 0.012, 0.035, 2],
    [0.28, 0.82, 0.84, -0.008, -0.01, -0.02, 0],
  ];
  let y = 0;
  for (const [h, w, d, dx, dz, ry, shade] of courses) {
    p.push(
      part(bbox(w, h - 0.045, d, 0.05), s[shade], {
        x: dx,
        z: dz,
        y: y + h / 2,
        ry,
        tint: 0.14,
        rough: ROUGH.stone,
        cracks:
          shade === 2
            ? [{ p: [0.2, y + h / 2, 0], n: [0.85, 0.3, 0.42], w: 0.025 }]
            : undefined,
      }),
    );
    y += h;
  }
  // the capstone: wider than the shaft, a chipped chamfer catching the light on top
  p.push(
    part(bbox(0.96, 0.14, 0.96, 0.05, 2), PALETTE.pillarCap, {
      y: y + 0.07,
      ry: 0.03,
      tint: 0.1,
      rough: ROUGH.stone,
      cracks: [{ p: [-0.3, y + 0.14, 0.3], n: [0.7, 0, 0.7], w: 0.02 }],
    }),
  );
  // an iron band round the joint over the first course, with two rivets a side
  p.push(
    part(bbox(0.92, 0.07, 0.92, 0.015), PALETTE.ironBand, {
      y: 0.31,
      rough: ROUGH.iron,
      tint: 0.06,
    }),
  );
  for (const [nx, nz] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const)
    for (const t of [-0.22, 0.22])
      p.push(
        part(box(0.035, 0.035, 0.035), PALETTE.rail, {
          x: nx * 0.465 + nz * t,
          z: nz * 0.465 + nx * t,
          y: 0.31,
          rough: ROUGH.iron,
          tint: 0,
        }),
      );
  // rubble at the foot
  for (const [x, z, r] of [
    [0.44, 0.3, 0.09],
    [-0.43, -0.36, 0.07],
    [-0.36, 0.44, 0.06],
  ] as const)
    p.push(
      part(rock(r, 1), s[1], {
        x,
        z,
        y: r * 0.5,
        sy: 0.7,
        smooth: true,
        lumpy: r * 0.25,
        base: 0,
        rough: ROUGH.stone,
      }),
    );
  return merge(p);
}

/** Profile of a clay storage pot (radius, height), turned on a lathe. */
const POT = [
  [0, 0],
  [0.12, 0],
  [0.19, 0.04],
  [0.245, 0.15],
  [0.24, 0.27],
  [0.19, 0.37],
  [0.12, 0.42],
  [0.115, 0.46],
  [0.14, 0.48],
  [0.13, 0.5],
  [0.095, 0.49],
  [0.09, 0.44],
].map(([r, y]) => new Vector2(r, y));

/**
 * Crate 1 (Quarry): a tall amphora and two squat storage pots in terracotta, each with a lighter lip, a dark open mouth
 * and a rope tied round the neck; the amphora stands about as tall as a crate so the cell reads as blocked.
 */
export function potsGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [];
  // [x, z, width scale, height scale, shade]
  const pots = [
    [-0.13, -0.1, 1.38, 1.62, 0],
    [0.22, 0.02, 1.08, 1.1, 1],
    [-0.04, 0.27, 0.95, 0.98, 2],
  ] as const;
  for (const [x, z, k, ky, shade] of pots) {
    p.push(
      part(new LatheGeometry(POT, 16), PALETTE.pots[shade], {
        x,
        z,
        sx: k,
        sy: ky,
        sz: k,
        smooth: true,
        tint: 0.1,
        rough: ROUGH.clay,
      }),
      // the lip, a shade lighter (worn and sun-bleached)
      part(ring(0.135, 0.022, 6, 16), PALETTE.potRim, {
        x,
        z,
        y: 0.488 * ky,
        sx: k,
        sz: k,
        tint: 0.06,
        rough: ROUGH.clay,
      }),
      // a dark mouth, a little sunk
      part(
        new CylinderGeometry(0.11 * k, 0.11 * k, 0.01, 14),
        PALETTE.potMouth,
        { x, z, y: 0.47 * ky, paint: 0 },
      ),
      // rope round the neck
      part(ring(0.122, 0.014, 5, 14), PALETTE.rope, {
        x,
        z,
        y: 0.425 * ky,
        sx: k,
        sz: k,
        tint: 0.06,
        rough: ROUGH.rope,
      }),
    );
  }
  return merge(p);
}

/** A torus lying flat (round the y axis), for lips, hoops and ropes. */
const ring = (r: number, tube: number, rad = 6, seg = 16) =>
  new TorusGeometry(r, tube, rad, seg).rotateX(Math.PI / 2);

/**
 * A rectangular slab `w x d`, `h` tall, centred on the origin, with only its top edges chamfered (`flagstone`): the edges
 * the camera sees catch the light at a fifth of the triangles of `bbox`.
 */
const slab = (w: number, h: number, d: number, bevel: number) =>
  flagstone(
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ],
    h,
    bevel,
  ).translate(0, -h / 2, 0);

/**
 * Crate 0: a slatted wooden crate. Chamfered corner posts, a top and a bottom rail round every side, a criss-cross lattice
 * of slats between them with the dark inside showing through, three top boards and a nail at each rail end. About 600
 * triangles: there can be a hundred on the floor.
 */
export function woodCrateGeometry(
  wood: { crate: number; band: number; dark: number } = {
    crate: PALETTE.crate,
    band: PALETTE.crateBand,
    dark: PALETTE.crateDark,
  },
): BufferGeometry {
  const H = 0.84;
  const p: BufferGeometry[] = [
    // the dark inside seen through the lattice
    part(
      box(0.72, H - 0.04, 0.72),
      new Color(wood.dark).multiplyScalar(0.6).getHex(),
      {
        y: H / 2,
        paint: 0,
        tint: 0,
      },
    ),
  ];
  // corner posts
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(
        part(slab(0.12, H, 0.12, 0.025), wood.band, {
          x: sx * 0.39,
          z: sz * 0.39,
          y: H / 2,
          tint: 0.14,
          rough: ROUGH.wood,
          edges: true,
        }),
      );
  // every side: a rail at the top and the bottom, and a lattice of slats crossing at 45 degrees between them
  const sides = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const;
  const span = 0.56; // height of the opening between the rails (the slats cross a square of this size)
  sides.forEach(([nx, nz], k) => {
    const yaw = nx ? Math.PI / 2 : 0;
    const out = 0.395;
    for (const y of [0.075, H - 0.075])
      p.push(
        part(box(0.7, 0.13, 0.05), wood.band, {
          x: nx * out,
          z: nz * out,
          y,
          ry: yaw,
          tint: 0.14,
          rough: ROUGH.wood,
        }),
      );
    for (const t of [-0.3, 0.3])
      p.push(
        part(box(0.03, 0.03, 0.03), PALETTE.rail, {
          x: nx * (out + 0.03) + nz * t,
          z: nz * (out + 0.03) + nx * t,
          y: H - 0.075,
          tint: 0,
          rough: ROUGH.iron,
        }),
      );
    const shade = new Color(wood.crate)
      .multiplyScalar(0.96 + 0.03 * k)
      .getHex();
    for (const dir of [1, -1])
      for (const o of [-0.15, 0, 0.15]) {
        // a slat across the open square, offset `o` from its diagonal, cut to the square
        const len = span * Math.SQRT2 - 2 * Math.abs(o) * Math.SQRT2;
        const slat = part(box(len, 0.07, 0.035), shade, {
          tint: 0.16,
          rough: ROUGH.wood,
        });
        // in the side's own plane (x across, y up), then turned to face out
        slat
          .rotateZ((dir * Math.PI) / 4)
          // across the slat (not along it), so the three stay parallel; the second set sits a little proud
          .translate(o, H / 2 - dir * o, dir > 0 ? 0 : 0.012)
          .rotateY(
            nx ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : nz > 0 ? 0 : Math.PI,
          )
          .translate(nx * 0.37, 0, nz * 0.37);
        p.push(slat);
      }
  });
  // three top boards with gaps
  for (const [x, f] of [
    [-0.25, 1.02],
    [0, 0.96],
    [0.25, 1.05],
  ] as const)
    p.push(
      part(
        slab(0.235, 0.05, 0.84, 0.018),
        new Color(wood.crate).multiplyScalar(f * 1.04).getHex(),
        { x, y: H - 0.02, tint: 0.14, rough: ROUGH.wood, edges: true },
      ),
    );
  return merge(p);
}

/** The plate the tiles lie on: `w x h` cells plus `pad` all round, its top just under the tiles. */
export function floorGeometry(
  w: number,
  h: number,
  pad: number,
): BufferGeometry {
  return merge([
    part(rbox(w + pad * 2, 0.5, h + pad * 2, 0.18), PALETTE.slab[0], {
      y: -0.1 - 0.25,
      tint: 0.18,
      detail: [1, 0],
    }),
  ]);
}

export interface DecorParts {
  body: BufferGeometry;
  /** Lantern bulbs (drawn unlit). */
  bulbs: BufferGeometry;
}

/**
 * Quarry decor on the slab margin around the arena (never inside it): mine-cart rails along the front edge with a cart,
 * barrels, rocks, and a lantern post at each corner.
 */
export function decorGeometry(w: number, h: number, pad: number): DecorParts {
  const p: BufferGeometry[] = [];
  const bulbs: BufferGeometry[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const mz = hh + pad * 0.5; // middle of the front margin

  // rails + sleepers along the front
  for (const dz of [-0.2, 0.2])
    p.push(
      part(box(w + pad, 0.07, 0.07), PALETTE.rail, { z: mz + dz, y: 0.1 }),
    );
  for (let x = -hw; x <= hw; x += 0.55)
    p.push(
      part(box(0.16, 0.05, 0.62), PALETTE.timber, {
        x,
        z: mz,
        y: 0.04,
        tint: 0.2,
      }),
    );

  // a mine cart on the rails
  const cx = hw * 0.35;
  p.push(
    part(rbox(0.9, 0.42, 0.55, 0.05), PALETTE.rail, { x: cx, z: mz, y: 0.42 }),
    part(rbox(0.8, 0.12, 0.45, 0.03), PALETTE.graniteDark, {
      x: cx,
      z: mz,
      y: 0.64,
    }),
  );
  for (const dx of [-0.3, 0.3])
    for (const dz of [-0.22, 0.22])
      p.push(
        part(
          new CylinderGeometry(0.11, 0.11, 0.06, 10).rotateX(Math.PI / 2),
          PALETTE.postCap,
          {
            x: cx + dx,
            z: mz + dz,
            y: 0.14,
          },
        ),
      );

  // barrels + rocks on the back and side margins
  const back = -hh - pad * 0.5;
  for (const [x, z, s] of [
    [hw * 0.1, back, 1],
    [hw * 0.1 + 0.42, back + 0.05, 0.85],
    [hw * 0.55, back, 1],
  ] as const)
    p.push(
      part(
        new CylinderGeometry(0.2 * s, 0.22 * s, 0.5 * s, 10),
        PALETTE.timber,
        { x, z, y: 0.25 * s, tint: 0.2 },
      ),
      part(new CylinderGeometry(0.225 * s, 0.225 * s, 0.05, 10), PALETTE.rail, {
        x,
        z,
        y: 0.2 * s,
      }),
    );
  for (const [x, z, r] of [
    [-hw - pad * 0.5, -hh * 0.4, 0.28],
    [-hw - pad * 0.45, hh * 0.3, 0.2],
    [hw + pad * 0.5, hh * 0.45, 0.3],
    [hw + pad * 0.5, -hh * 0.5, 0.2],
  ] as const)
    p.push(
      part(rock(r, 1), PALETTE.granite, {
        x,
        z,
        y: r * 0.6,
        sy: 0.8,
        lumpy: r * 0.2,
      }),
    );

  // the story prop: a timber derrick on the back margin, its boom swung out along the wall with a cut block on the hook
  {
    const x0 = -hw * 0.82;
    const z0 = back - 0.1;
    const top = 4.4;
    const tip: [number, number, number] = [x0 + 2.7, 3.1, z0 + 0.05];
    p.push(
      part(bbox(0.62, 0.3, 0.62), PALETTE.sandstone[1], {
        x: x0,
        z: z0,
        y: 0.15,
        rough: ROUGH.stone,
      }),
      part(bbox(0.28, top, 0.28, 0.04), PALETTE.timber, {
        x: x0,
        z: z0,
        y: 0.3 + top / 2,
        rough: ROUGH.wood,
      }),
      part(bbox(0.3, 0.1, 0.3, 0.02), PALETTE.rail, {
        x: x0,
        z: z0,
        y: 0.3 + top,
        rough: ROUGH.iron,
      }),
      // the boom, from the mast's foot up and out
      part(
        strut([x0 + 0.1, 0.55, z0], tip, 0.1, 6, 0.08),
        PALETTE.timberLight,
        {
          rough: ROUGH.wood,
        },
      ),
      // stays: two back into the stands, the topping lift from the masthead to the boom tip
      part(
        strut([x0, 0.3 + top, z0], [x0 - 2.2, 2.4, z0 - 3.4], 0.02),
        PALETTE.rope,
        {
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
      part(
        strut([x0, 0.3 + top, z0], [x0 + 1.8, 2.4, z0 - 3.4], 0.02),
        PALETTE.rope,
        {
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
      part(strut([x0, 0.25 + top, z0], tip, 0.02), PALETTE.rope, {
        tint: 0,
        rough: ROUGH.rope,
      }),
      // the hoist rope, the hook block and a cut sandstone block on two slings
      part(strut(tip, [tip[0], 1.95, tip[2]], 0.018), PALETTE.rope, {
        tint: 0,
        rough: ROUGH.rope,
      }),
      part(bbox(0.14, 0.2, 0.1, 0.03), PALETTE.rail, {
        x: tip[0],
        z: tip[2],
        y: 1.85,
        rough: ROUGH.iron,
      }),
      part(
        strut([tip[0], 1.78, tip[2]], [tip[0] - 0.25, 1.38, tip[2]], 0.015),
        PALETTE.rope,
        {
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
      part(
        strut([tip[0], 1.78, tip[2]], [tip[0] + 0.25, 1.38, tip[2]], 0.015),
        PALETTE.rope,
        {
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
      part(bbox(0.62, 0.36, 0.42, 0.04), PALETTE.sandstone[2], {
        x: tip[0],
        z: tip[2],
        y: 1.2,
        rough: ROUGH.stone,
      }),
    );
  }

  // lantern posts at the four corners of the margin
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (hw + pad * 0.5);
      const z = sz * (hh + pad * 0.5);
      p.push(
        part(box(0.1, 1.25, 0.1), PALETTE.timber, { x, z, y: 0.62 }),
        part(box(0.3, 0.06, 0.3), PALETTE.rail, { x, z, y: 1.3 }),
        part(rbox(0.3, 0.02, 0.3, 0.01), PALETTE.rail, { x, z, y: 1.02 }),
      );
      bulbs.push(
        part(rbox(0.2, 0.26, 0.2, 0.05), PALETTE.lantern, {
          x,
          z,
          y: 1.16,
          tint: 0,
        }),
      );
    }
  return { body: merge(p), bulbs: merge(bulbs) };
}
