import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  TorusGeometry,
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
  // welded rocks and flagstones carry no UVs; give them empty ones so every part merges with every other
  if (!g.getAttribute('uv'))
    g.setAttribute(
      'uv',
      new Float32BufferAttribute(new Float32Array(pos2.count * 2), 2),
    );
  return g;
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

/** The rocks on the Quarry rim: the boulder's look at a fraction of its triangles (there are a hundred of them). */
export function rimRockGeometry(): BufferGeometry {
  return part(rock(0.55, 2), PALETTE.granite, {
    y: 0.44,
    sy: 0.9,
    smooth: true,
    lumpy: 0.09,
    base: 0,
    tint: 0.12,
    rough: ROUGH.stone,
  });
}

/**
 * Hard block 1: a pillar of four cut sandstone blocks with dark mortar joints between them, a timber brace on two sides
 * (an upright and a cross beam lashed with rope) and rubble at its foot.
 */
export function postGeometry(): BufferGeometry {
  const s = PALETTE.sandstone;
  const p: BufferGeometry[] = [
    part(bbox(0.74, 1.06, 0.74), PALETTE.mortar, {
      y: 0.53,
      rough: ROUGH.stone,
      paint: 0,
    }),
  ];
  // [height, width, depth, dx, dz, yaw, shade]
  const courses: [number, number, number, number, number, number, number][] = [
    [0.31, 0.88, 0.86, 0.01, -0.005, 0.02, 0],
    [0.29, 0.84, 0.86, -0.014, 0.008, -0.04, 1],
    [0.29, 0.86, 0.83, 0.008, 0.012, 0.035, 0],
    [0.29, 0.82, 0.84, -0.008, -0.01, -0.02, 2],
  ];
  let y = 0;
  for (const [h, w, d, dx, dz, ry, shade] of courses) {
    p.push(
      part(bbox(w, h - 0.045, d, 0.05), s[shade], {
        x: dx,
        z: dz,
        y: y + h / 2,
        ry,
        tint: 0.16,
        rough: ROUGH.stone,
      }),
    );
    y += h;
  }
  // timber brace on the front and back: a centred upright and a cross beam, lashed with rope where they cross
  for (const sz of [-1, 1]) {
    const z = sz * 0.465;
    p.push(
      part(bbox(0.15, 0.96, 0.08, 0.02), PALETTE.timber, {
        x: 0.04 * sz,
        z,
        y: 0.56,
        tint: 0.16,
        rough: ROUGH.wood,
      }),
      part(bbox(0.96, 0.13, 0.08, 0.02), PALETTE.timberLight, {
        z: z + sz * 0.06,
        y: 0.78,
        tint: 0.16,
        rough: ROUGH.wood,
      }),
    );
    for (const dy of [-0.035, 0.035])
      p.push(
        part(
          new TorusGeometry(0.1, 0.016, 5, 10).rotateY(Math.PI / 4),
          PALETTE.rope,
          {
            x: 0.04 * sz,
            z: z + sz * 0.035,
            y: 0.78 + dy,
            sz: 0.7,
            tint: 0.08,
            rough: ROUGH.rope,
          },
        ),
      );
  }
  // rubble at the foot
  for (const [x, z, r] of [
    [0.44, 0.3, 0.09],
    [-0.43, -0.36, 0.07],
    [-0.36, 0.44, 0.06],
  ] as const)
    p.push(
      part(rock(r, 1), s[2], {
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

/** Crate 1 (Quarry): three terracotta storage pots, rope tied round their necks. */
export function potsGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [];
  const pots = [
    [-0.15, -0.12, 1.12, 0],
    [0.2, -0.04, 0.95, 1],
    [-0.02, 0.24, 0.85, 2],
  ] as const;
  for (const [x, z, k, shade] of pots) {
    p.push(
      part(new LatheGeometry(POT, 14), PALETTE.pots[shade], {
        x,
        z,
        sx: k,
        sy: k,
        sz: k,
        tint: 0.1,
        rough: ROUGH.clay,
      }),
      // a dark mouth
      part(
        new CylinderGeometry(0.09 * k, 0.09 * k, 0.01, 12),
        PALETTE.potMouth,
        {
          x,
          z,
          y: 0.475 * k,
          paint: 0,
        },
      ),
    );
  }
  return merge(p);
}

/** Crate 0: a wooden crate with corner posts, bands and a cross plank. */
export function woodCrateGeometry(
  wood: { crate: number; band: number; dark: number } = {
    crate: PALETTE.crate,
    band: PALETTE.crateBand,
    dark: PALETTE.crateDark,
  },
): BufferGeometry {
  const p: BufferGeometry[] = [
    part(rbox(0.8, 0.8, 0.8, 0.06), wood.crate, { y: 0.42, tint: 0.1 }),
    part(box(0.88, 0.1, 0.88), wood.band, { y: 0.2 }),
    part(box(0.88, 0.1, 0.88), wood.band, { y: 0.64 }),
    part(box(0.07, 0.08, 0.7), wood.dark, { y: 0.83, x: 0.12 }),
    part(box(0.07, 0.08, 0.7), wood.dark, { y: 0.83, x: -0.12 }),
  ];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(
        part(box(0.11, 0.84, 0.11), wood.dark, {
          x: sx * 0.4,
          z: sz * 0.4,
          y: 0.42,
        }),
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
    [-hw * 0.5, back, 1],
    [-hw * 0.5 + 0.42, back + 0.05, 0.85],
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
