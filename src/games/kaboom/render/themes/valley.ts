import {
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Color,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
  BufferGeometry,
  type Material,
} from 'three';
import { Noise2D } from '../../../../shared/noise';
import { Rng, hash3 } from '../../../../shared/rng';
import { gridToWorldX, gridToWorldZ } from '../../sim/grid';
import { Terrain } from '../../sim/types';
import { WALL_D, ringPoints } from '../bowl';
import {
  bbox,
  box,
  merge,
  part,
  rbox,
  rock,
  tileGeometry,
  woodCrateGeometry,
  type DecorParts,
} from '../parts';
import { ROUGH } from '../materials';
import type { FxTint, LevelTheme, SceneryCtx } from './theme';
import { shared } from './cache';

/** Green Valley palette (DETAILS.md "Levels"): green floor; grey stone and warm wood / straw stay the only things that block or break. */
const V = {
  tiles: [0x80ba5b, 0x75ae52, 0x8ac364],
  dirt: 0xa88c5c,
  margin: 0x5f9a45,
  moss: 0x4f8a3c,
  boulder: 0x8f9088,
  boulderDark: 0x777871,
  cairn: 0x9a9690,
  cairnCap: 0xb6b1a6,
  cairnDark: 0x7c7973,
  crate: 0xd9a65f,
  crateBand: 0xb9833f,
  crateDark: 0x8d5d2c,
  hay: 0xe8cc6c,
  hayDark: 0xc9a850,
  hayBand: 0xa9822f,
  fence: 0x9a6b3c,
  fenceDark: 0x7a5230,
  stream: 0x58aee0,
  streamDark: 0x3f8fc2,
  trunk: 0x6a4a2c,
  pine: [0x2f6b3a, 0x3a7a42, 0x4a8f4c],
  bush: 0x3f7d3a,
  steel: 0xc9ced4,
  milk: 0xe9ecef,
  cart: 0x8a5a2e,
  red: 0xd24a3a,
  hedge: 0x5aa03f,
  hedgeSide: 0x4a8a35,
  hedgeDark: 0x376a2a,
  mill: 0xebe3d0,
  millCap: 0x7a5434,
  millWin: 0x3c4a52,
  sail: 0xe9dfc8,
  meadow: [0x86b95d, 0x7aae55],
  trodden: 0x9dc66a,
  haze: 0xc9dcae,
  leaf: [0x4f9a3f, 0x5fae48, 0x3f8a38],
  skyTop: '#8fc4ee',
  skyMid: '#d8ecf7',
  skyLow: '#f4f0d6',
} as const;

const FX: FxTint = {
  dustDark: [0.5, 0.48, 0.32],
  dustLight: [0.88, 0.9, 0.72],
  wood: [
    [0.85, 0.6, 0.32],
    [0.95, 0.8, 0.35],
    [0.9, 0.72, 0.42],
  ],
  scorch: [0.05, 0.06, 0.03],
};

// ------------------------------------------------------------------ models

/** Hard block 0: a boulder with a cap of moss on one shoulder and two small rocks at its feet. */
function mossyBoulder(): BufferGeometry {
  return merge([
    part(rock(0.55, 5), V.boulder, {
      y: 0.46,
      sy: 0.92,
      smooth: true,
      lumpy: 0.09,
      base: 0.02,
      tint: 0.12,
      rough: ROUGH.stone,
    }),
    part(rock(0.3, 3), V.moss, {
      x: -0.12,
      y: 0.84,
      z: 0.08,
      sy: 0.4,
      sx: 1.15,
      smooth: true,
      lumpy: 0.06,
      tint: 0.18,
      rough: ROUGH.grass,
    }),
    part(rock(0.2, 0), V.boulderDark, {
      x: 0.36,
      y: 0.14,
      z: 0.34,
      lumpy: 0.04,
    }),
    part(rock(0.15, 0), V.boulderDark, {
      x: -0.38,
      y: 0.1,
      z: 0.3,
      lumpy: 0.03,
    }),
  ]);
}

/** Hard block 1: a cairn of five flat stones, wider at the foot, with a tuft of grass. */
function cairn(): BufferGeometry {
  const stones: [number, number, number, number, number][] = [
    // width, height, depth, y, turn
    [0.92, 0.26, 0.86, 0.13, 0.1],
    [0.78, 0.24, 0.74, 0.37, -0.35],
    [0.66, 0.22, 0.62, 0.59, 0.5],
    [0.52, 0.2, 0.5, 0.79, -0.2],
    [0.36, 0.16, 0.34, 0.96, 0.7],
  ];
  const p = stones.map(([w, h, d, y, ry], i) =>
    part(rbox(w, h, d, 0.07, 2), i % 2 ? V.cairn : V.cairnCap, {
      y,
      ry,
      tint: 0.14,
    }),
  );
  p.push(part(rbox(0.96, 0.08, 0.9, 0.03), V.cairnDark, { y: 0.04 }));
  for (const [x, z] of [
    [0.42, 0.3],
    [-0.4, -0.34],
  ])
    p.push(part(new ConeGeometry(0.05, 0.22, 5), V.moss, { x, z, y: 0.12 }));
  return merge(p);
}

/** Crate 1: a round hay bale on its side, rolled end to the camera, with two twine bands and loose straws. */
function hayBale(): BufferGeometry {
  const R = 0.4;
  const L = 0.84;
  const e = 0.09;
  // a lathed drum with rounded shoulders, axis along x (turned at the end)
  const prof: Vector2[] = [new Vector2(0, -L / 2)];
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    prof.push(
      new Vector2(R - e + Math.sin(a) * e, -L / 2 + e - Math.cos(a) * e),
    );
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    prof.push(
      new Vector2(R - e + Math.cos(a) * e, L / 2 - e + Math.sin(a) * e),
    );
  }
  prof.push(new Vector2(0, L / 2));
  const lie = (g: BufferGeometry) => g.rotateZ(Math.PI / 2);
  const p: BufferGeometry[] = [
    part(lie(new LatheGeometry(prof, 18)), V.hay, {
      y: R,
      smooth: true,
      lumpy: 0.02,
      tint: 0.16,
      rough: ROUGH.grass,
    }),
  ];
  // the rolled ends: rings of darker and lighter straw, a little proud of the face
  for (const sx of [-1, 1])
    for (const [r, c] of [
      [0.3, V.hayDark],
      [0.21, V.hay],
      [0.12, V.hayDark],
    ] as const)
      p.push(
        part(lie(new CylinderGeometry(r, r, 0.02, 16)), c, {
          x: sx * (L / 2 + 0.005 + (0.3 - r) * 0.04),
          y: R,
          tint: 0.2,
          rough: ROUGH.grass,
        }),
      );
  // two twine bands round the drum
  for (const x of [-0.2, 0.2])
    p.push(
      part(
        new TorusGeometry(R + 0.006, 0.014, 4, 24).rotateY(Math.PI / 2),
        V.hayBand,
        {
          x,
          y: R,
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
    );
  // loose straws sticking out of the ends and the drum
  const r = new Rng(2210);
  for (let i = 0; i < 22; i++) {
    const end = i < 10;
    const a = r.range(0, Math.PI * 2);
    const rr = end ? r.range(0.08, 0.36) : R;
    const straw = new ConeGeometry(0.012, r.range(0.12, 0.2), 3);
    if (end)
      straw.rotateZ(((i & 1 ? 1 : -1) * Math.PI) / 2 + r.range(-0.5, 0.5));
    else straw.rotateX(Math.PI / 2 - a);
    p.push(
      part(straw, i % 3 ? V.hayDark : V.hay, {
        x: end ? (i & 1 ? -1 : 1) * (L / 2 + 0.03) : r.range(-0.3, 0.3),
        y: R + Math.sin(a) * rr,
        z: Math.cos(a) * rr,
        tint: 0.2,
        rough: ROUGH.grass,
      }),
    );
  }
  // the rolled end faces the camera: the bale reads at a glance
  return merge(p).rotateY(Math.PI / 2);
}

/** One crossed bunch of grass blades, standing on y = 0. */
function tuftGeometry(): BufferGeometry {
  const r = new Rng(9911);
  const p: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const hgt = r.range(0.14, 0.28);
    const a = r.range(0, 6.28);
    const lean = r.range(0.1, 0.3);
    const blade = part(
      new ConeGeometry(0.028, hgt, 3),
      [0x5d9a3e, 0x6aa848, 0x4f8b36][i % 3],
      {
        x: Math.cos(a) * 0.05,
        z: Math.sin(a) * 0.05,
        y: hgt / 2,
        tint: 0.15,
      },
    );
    blade.rotateZ(Math.cos(a) * lean);
    blade.rotateX(Math.sin(a) * lean);
    p.push(blade);
  }
  return merge(p);
}

/** A pine: trunk and three stacked cones (low poly; the rim is far from the camera). */
function pineGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.1, 0.16, 0.8, 5), V.trunk, { y: 0.4 }),
    part(new ConeGeometry(0.95, 1.5, 6), V.pine[0], { y: 1.45, tint: 0.1 }),
    part(new ConeGeometry(0.74, 1.3, 6), V.pine[1], {
      y: 2.3,
      ry: 0.5,
      tint: 0.1,
    }),
    part(new ConeGeometry(0.5, 1.15, 6), V.pine[2], { y: 3.1, tint: 0.1 }),
  ]);
}

/** A broadleaf tree: a short trunk under three lumpy crowns. */
function oakGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.13, 0.2, 1.0, 6), V.trunk, { y: 0.5 }),
    part(rock(0.85, 1), V.leaf[0], {
      y: 1.65,
      sy: 0.85,
      lumpy: 0.12,
      tint: 0.12,
    }),
    part(rock(0.62, 1), V.leaf[1], {
      x: 0.45,
      y: 1.4,
      z: 0.2,
      sy: 0.85,
      lumpy: 0.1,
      tint: 0.12,
    }),
    part(rock(0.58, 1), V.leaf[2], {
      x: -0.4,
      y: 1.5,
      z: -0.25,
      sy: 0.85,
      lumpy: 0.1,
      tint: 0.12,
    }),
  ]);
}

/** A round bush with berries or flowers painted in (the unlit flower heads are in `bulbs`). */
function bush(x: number, z: number, s: number): BufferGeometry[] {
  return [
    part(rock(0.34 * s, 1), V.bush, {
      x,
      z,
      y: 0.24 * s,
      sy: 0.8,
      lumpy: 0.05 * s,
      tint: 0.2,
    }),
    part(rock(0.22 * s, 1), V.pine[2], {
      x: x + 0.22 * s,
      z: z - 0.1 * s,
      y: 0.17 * s,
      sy: 0.8,
      lumpy: 0.04,
      tint: 0.2,
    }),
  ];
}

function floor(w: number, h: number, pad: number): BufferGeometry {
  return merge([
    part(rbox(w + pad * 2, 0.5, h + pad * 2, 0.18), V.margin, {
      y: -0.35,
      tint: 0.2,
    }),
  ]);
}

/**
 * Decor on the margin: a stream with a plank bridge along the front, a split-rail fence and a hay cart at the back,
 * milk cans and a scarecrow at the sides, mushrooms, and a flowering bush in each corner (the flower heads are unlit).
 */
function decor(w: number, h: number, pad: number): DecorParts {
  const p: BufferGeometry[] = [];
  const bulbs: BufferGeometry[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const r = new Rng(hash3(w, h, 0x7a11, 3));
  const frontZ = hh + pad * 0.55;
  const backZ = -hh - pad * 0.55;
  const sideX = hw + pad * 0.55;

  // the stream along the front margin, pebbles on its banks, a plank bridge
  p.push(
    part(box(w + pad * 1.9, 0.05, 0.52), V.stream, {
      z: frontZ,
      y: -0.075,
      tint: 0.1,
    }),
  );
  p.push(
    part(box(w + pad * 1.9, 0.04, 0.2), V.streamDark, {
      z: frontZ + 0.05,
      y: -0.07,
      tint: 0.2,
    }),
  );
  for (let x = -hw - pad * 0.8; x < hw + pad * 0.8; x += 0.7) {
    p.push(
      part(rock(r.range(0.05, 0.1), 0), V.boulderDark, {
        x: x + r.range(-0.2, 0.2),
        z: frontZ + (r.chance(0.5) ? 0.3 : -0.3) + r.range(-0.04, 0.04),
        y: 0.02,
        sy: 0.7,
      }),
    );
  }
  const bx = -hw * 0.4;
  for (let i = 0; i < 5; i++)
    p.push(
      part(box(0.17, 0.05, 0.96), V.fence, {
        x: bx + (i - 2) * 0.19,
        z: frontZ,
        y: 0.0,
        tint: 0.2,
      }),
    );
  for (const dx of [-0.46, 0.46])
    for (const dz of [-0.44, 0.44])
      p.push(
        part(box(0.07, 0.38, 0.07), V.fenceDark, {
          x: bx + dx,
          z: frontZ + dz,
          y: 0.2,
        }),
      );
  for (const dz of [-0.44, 0.44])
    p.push(
      part(box(1.0, 0.05, 0.05), V.fence, { x: bx, z: frontZ + dz, y: 0.36 }),
    );

  // a split-rail fence along the back, open in the middle
  for (let x = -hw - pad * 0.6; x <= hw + pad * 0.6; x += 1.4) {
    if (Math.abs(x) < 1.0) continue;
    p.push(
      part(box(0.1, 0.8, 0.1), V.fenceDark, { x, z: backZ, y: 0.4, tint: 0.2 }),
    );
    if (Math.abs(x + 1.4) >= 1.0 || x > 0)
      for (const y of [0.34, 0.66])
        p.push(
          part(box(1.4, 0.06, 0.06), V.fence, {
            x: x + 0.7,
            z: backZ,
            y,
            tint: 0.2,
          }),
        );
  }

  // a hay cart at the back left: bed, wheels, shafts, a heap of hay
  const cx = -hw * 0.55;
  const cz = backZ + 0.05;
  p.push(
    part(rbox(1.3, 0.14, 0.72, 0.03), V.cart, {
      x: cx,
      z: cz,
      y: 0.38,
      tint: 0.2,
    }),
    part(rbox(1.3, 0.2, 0.06, 0.02), V.fence, { x: cx, z: cz - 0.33, y: 0.52 }),
    part(rbox(1.3, 0.2, 0.06, 0.02), V.fence, { x: cx, z: cz + 0.33, y: 0.52 }),
    part(rock(0.5, 1), V.hay, {
      x: cx,
      z: cz,
      y: 0.62,
      sx: 1.15,
      sy: 0.55,
      sz: 0.7,
      lumpy: 0.07,
      tint: 0.2,
    }),
    part(box(0.9, 0.05, 0.05), V.fenceDark, {
      x: cx + 1.05,
      z: cz - 0.2,
      y: 0.3,
    }),
    part(box(0.9, 0.05, 0.05), V.fenceDark, {
      x: cx + 1.05,
      z: cz + 0.2,
      y: 0.3,
    }),
  );
  for (const dz of [-0.4, 0.4])
    p.push(
      part(
        new CylinderGeometry(0.26, 0.26, 0.06, 12).rotateX(Math.PI / 2),
        V.fenceDark,
        { x: cx + 0.3, z: cz + dz, y: 0.26 },
      ),
    );

  // milk cans on the left margin, a water trough on the right
  for (const [dz, s] of [
    [-0.4, 1],
    [0, 0.9],
    [0.4, 1],
  ] as const)
    p.push(
      part(new CylinderGeometry(0.15 * s, 0.17 * s, 0.5 * s, 10), V.milk, {
        x: -sideX,
        z: hh * 0.3 + dz,
        y: 0.25 * s,
      }),
      part(new CylinderGeometry(0.1 * s, 0.15 * s, 0.1 * s, 10), V.steel, {
        x: -sideX,
        z: hh * 0.3 + dz,
        y: 0.55 * s,
      }),
    );
  p.push(
    part(rbox(1.2, 0.3, 0.45, 0.05), V.fence, {
      x: sideX,
      z: hh * 0.35,
      y: 0.2,
      ry: Math.PI / 2,
      tint: 0.2,
    }),
    part(rbox(1.04, 0.05, 0.3, 0.02), V.streamDark, {
      x: sideX,
      z: hh * 0.35,
      y: 0.34,
      ry: Math.PI / 2,
    }),
  );

  // a scarecrow at the right back corner
  const sx = sideX;
  const sz = -hh * 0.55;
  p.push(
    part(box(0.07, 1.2, 0.07), V.fenceDark, { x: sx, z: sz, y: 0.6 }),
    part(box(0.9, 0.06, 0.06), V.fenceDark, { x: sx, z: sz, y: 0.95 }),
    part(rbox(0.34, 0.4, 0.2, 0.05), V.red, {
      x: sx,
      z: sz,
      y: 0.85,
      tint: 0.2,
    }),
    part(rock(0.13, 1), V.hay, { x: sx, z: sz, y: 1.22 }),
    part(new CylinderGeometry(0.22, 0.22, 0.03, 10), V.fence, {
      x: sx,
      z: sz,
      y: 1.33,
    }),
    part(new CylinderGeometry(0.11, 0.13, 0.14, 10), V.fence, {
      x: sx,
      z: sz,
      y: 1.4,
    }),
  );

  // mushrooms
  for (const [x, z] of [
    [hw * 0.7, backZ + 0.35],
    [-sideX + 0.1, -hh * 0.6],
    [sideX - 0.15, hh * 0.8],
  ])
    for (let i = 0; i < 3; i++) {
      const mx = x + r.range(-0.2, 0.2);
      const mz = z + r.range(-0.2, 0.2);
      const k = r.range(0.7, 1.2);
      p.push(
        part(new CylinderGeometry(0.03 * k, 0.04 * k, 0.12 * k, 6), V.milk, {
          x: mx,
          z: mz,
          y: 0.06 * k,
        }),
        part(
          new SphereGeometry(0.09 * k, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
          V.red,
          { x: mx, z: mz, y: 0.12 * k },
        ),
      );
    }

  // a flowering bush in each corner; the flower heads glow unlit
  const flowers = [0xfff3a8, 0xffffff, 0xff8fb0, 0xc9a2ff, 0xffb347];
  for (const cxs of [-1, 1])
    for (const czs of [-1, 1]) {
      const x = cxs * (hw + pad * 0.5);
      const z = czs * (hh + pad * 0.5);
      p.push(...bush(x, z, 1.5), ...bush(x - cxs * 0.3, z + czs * 0.35, 1.1));
      for (let i = 0; i < 9; i++)
        bulbs.push(
          part(
            new SphereGeometry(0.045, 6, 4),
            flowers[Math.floor(r.range(0, flowers.length))],
            {
              x: x + r.range(-0.4, 0.4),
              z: z + r.range(-0.4, 0.4),
              y: r.range(0.25, 0.55),
              tint: 0,
            },
          ),
        );
    }
  return { body: merge(p), bulbs: merge(bulbs) };
}

// ------------------------------------------------------------------ scenery

const UP = new Vector3(0, 1, 0);

/** Flat meadow level: the ground, the crowd's ground and the hedge all sit on the arena's floor level. */
const GROUND_Y = -0.12;
const HEDGE_H = 0.5;
const HEDGE_W = 0.45;
const meadowNoise = new Noise2D(2077);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The hedge round the pitch: rounded bushes of leaf clusters in two greens along the ring, a few flowers on top and a
 * footing of stones on the pitch side. `low` = fewer faces.
 */
function hedgeGeometry(hx: number, hz: number, low: boolean): BufferGeometry {
  const ring = ringPoints(hx, hz, WALL_D + HEDGE_W / 2);
  const n = ring.length / 2;
  const r = new Rng(hash3(Math.round(hx * 2), Math.round(hz * 2), 0x4ed, 6));
  const p: BufferGeometry[] = [];
  const detail = low ? 0 : 1;
  const STEP = 0.42;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const dx = ring[j * 2] - ax;
    const dz = ring[j * 2 + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    // inward normal (towards the pitch): the ring runs counter-clockwise seen from above
    const ix = -dz / len;
    const iz = dx / len;
    const inx = ix * (ax * ix + az * iz < 0 ? 1 : -1);
    const inz = iz * (ax * ix + az * iz < 0 ? 1 : -1);
    for (let t = carry; t < len; t += STEP) {
      const x = ax + (dx * t) / len;
      const z = az + (dz * t) / len;
      const big = r.range(0.24, 0.31);
      const green = r.chance(0.5) ? V.hedge : V.hedgeSide;
      p.push(
        part(rock(big, detail), green, {
          x: x + r.range(-0.04, 0.04),
          z: z + r.range(-0.04, 0.04),
          y: GROUND_Y + HEDGE_H * 0.5,
          sy: r.range(0.95, 1.15),
          smooth: true,
          lumpy: 0.05,
          tint: 0.2,
          rough: ROUGH.grass,
        }),
      );
      // a smaller, lighter cluster on top
      if (r.chance(0.6))
        p.push(
          part(rock(big * 0.62, detail), V.leaf[r.int(0, 2)], {
            x: x + r.range(-0.1, 0.1),
            z: z + r.range(-0.08, 0.08),
            y: GROUND_Y + HEDGE_H * 0.5 + big * 0.75,
            smooth: true,
            lumpy: 0.03,
            tint: 0.2,
            rough: ROUGH.grass,
          }),
        );
      if (r.chance(0.16)) {
        const flower = [0xf4f0e2, 0xf2d24a, 0xe58fb0][r.int(0, 2)];
        for (let k = 0; k < 3; k++)
          p.push(
            part(rock(0.028, 0), flower, {
              x: x + r.range(-0.15, 0.15),
              z: z + r.range(-0.12, 0.12),
              y: GROUND_Y + HEDGE_H * 0.5 + big * r.range(0.75, 0.95),
              tint: 0,
              rough: ROUGH.grass,
            }),
          );
      }
      // stone footing on the pitch side
      p.push(
        part(
          rock(r.range(0.1, 0.14), 0),
          r.chance(0.5) ? V.cairn : V.cairnDark,
          {
            x: x + inx * (HEDGE_W / 2 + 0.02),
            z: z + inz * (HEDGE_W / 2 + 0.02),
            y: GROUND_Y + 0.04,
            sy: 0.6,
            ry: r.range(0, 3),
            tint: 0.15,
            rough: ROUGH.stone,
          },
        ),
      );
    }
    carry = (((carry - len) % STEP) + STEP) % STEP;
  }
  return merge(p);
}

/**
 * The meadow: one flat plane under everything, the same level all the way out to the haze. The ground round the pitch (where
 * the crowd stands) is trodden lighter; far away it fades towards the sky's colour.
 */
function groundGeometry(hx: number, hz: number, low: boolean): BufferGeometry {
  const seg = low ? 60 : 120;
  const g = new PlaneGeometry(240, 240, seg, seg)
    .rotateX(-Math.PI / 2)
    .translate(0, GROUND_Y, 0);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  const trodden = new Color(V.trodden);
  const haze = new Color(V.haze);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dd = Math.hypot(
      Math.max(Math.abs(x) - hx, 0),
      Math.max(Math.abs(z) - hz, 0),
    );
    const n =
      meadowNoise.noise2(x * 0.09, z * 0.09) * 0.6 +
      meadowNoise.noise2(x * 0.31 + 9, z * 0.31) * 0.4;
    c.set(V.meadow[0]).lerp(c.clone().set(V.meadow[1]), n * 0.5 + 0.5);
    c.lerp(trodden, (1 - smooth(4.8, 7.5, dd)) * 0.75);
    c.lerp(haze, smooth(30, 115, dd) * 0.6);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  const flat = g.toNonIndexed();
  // the attributes `part()` gives, so the hedge and the mill merge into the same draw (matte, no texture)
  const n = flat.getAttribute('position').count;
  flat.setAttribute(
    'aGloss',
    new Float32BufferAttribute(new Float32Array(n), 1),
  );
  flat.setAttribute(
    'uv',
    new Float32BufferAttribute(new Float32Array(n * 2), 2),
  );
  return flat;
}

/** Trees well behind the crowd, in loose clusters; none close to the camera's side (it would stand in the picture). */
/** The windmill stands left of the pitch, behind the crowd, towards the back. */
const MILL_X = (hx: number) => -hx - 5.4;
const MILL_Z = (hz: number) => -hz + 0.5;
const MILL_HUB_Y = 5.6;
const MILL_YAW = 0.6;

/** The story prop: a whitewashed tower mill with a thatch-brown cap, a door and windows (its sails are separate). */
function millGeometry(): BufferGeometry {
  const tower = [
    [1.45, 0],
    [1.38, 1.5],
    [1.22, 3.5],
    [1.08, 5.0],
    [1.1, 5.12],
  ].map(([x, y]) => new Vector2(x, y));
  const cap = [
    [1.28, 0],
    [1.22, 0.3],
    [0.95, 0.85],
    [0.5, 1.25],
    [0.1, 1.42],
    [0, 1.44],
  ].map(([x, y]) => new Vector2(x, y));
  const p: BufferGeometry[] = [
    part(new CylinderGeometry(1.62, 1.7, 0.3, 16), V.cairnDark, {
      y: 0.15,
      tint: 0.15,
      rough: ROUGH.stone,
    }),
    part(new LatheGeometry(tower, 18), V.mill, {
      y: 0.3,
      smooth: true,
      tint: 0.08,
      rough: ROUGH.clay,
    }),
    part(new LatheGeometry(cap, 18), V.millCap, {
      y: 5.4,
      smooth: true,
      tint: 0.16,
      rough: ROUGH.wood,
    }),
    // gallery band under the cap
    part(new CylinderGeometry(1.2, 1.2, 0.12, 18), V.fenceDark, {
      y: 5.36,
      rough: ROUGH.wood,
    }),
    // door and two windows on the side facing the pitch
    part(bbox(0.55, 0.95, 0.12, 0.03), V.fenceDark, {
      y: 0.78,
      z: 1.42,
      rough: ROUGH.wood,
    }),
    part(bbox(0.34, 0.42, 0.1, 0.02), V.millWin, {
      y: 2.6,
      z: 1.32,
      rough: ROUGH.paint,
    }),
    part(bbox(0.3, 0.38, 0.1, 0.02), V.millWin, {
      y: 4.1,
      z: 1.16,
      x: 0.15,
      rough: ROUGH.paint,
    }),
    // the windshaft sticking out of the cap
    part(
      new CylinderGeometry(0.12, 0.14, 0.7, 8).rotateX(Math.PI / 2),
      V.trunk,
      {
        y: MILL_HUB_Y,
        z: 1.2,
        rough: ROUGH.wood,
      },
    ),
  ];
  return merge(p);
}

/** Four lattice sails round a hub, centred on the origin in the x-y plane (they turn round z). */
function millSailsGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(
      new CylinderGeometry(0.2, 0.2, 0.2, 10).rotateX(Math.PI / 2),
      V.fenceDark,
      {
        rough: ROUGH.wood,
      },
    ),
  ];
  for (let i = 0; i < 4; i++) {
    const blade: BufferGeometry[] = [
      part(box(0.1, 3.4, 0.08), V.trunk, { y: 1.75, rough: ROUGH.wood }),
      part(box(0.04, 2.7, 0.04), V.fenceDark, {
        y: 2.1,
        x: 0.5,
        rough: ROUGH.wood,
      }),
      part(box(0.42, 2.6, 0.02), V.sail, {
        y: 2.1,
        x: 0.27,
        z: -0.02,
        tint: 0.08,
        rough: ROUGH.rope,
      }),
    ];
    for (let k = 0; k < 6; k++)
      blade.push(
        part(box(0.56, 0.035, 0.035), V.fenceDark, {
          y: 0.9 + k * 0.48,
          x: 0.25,
          rough: ROUGH.wood,
        }),
      );
    p.push(merge(blade).rotateZ((i * Math.PI) / 2));
  }
  return merge(p);
}

function meadowTrees(
  hx: number,
  hz: number,
  rng: Rng,
  mat: Material,
  low: boolean,
): InstancedMesh[] {
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const pines: [number, number][] = [];
  const oaks: [number, number][] = [];
  for (const d of [7.5, 10, 13, 17, 22, 28, 35]) {
    const pts = ringPoints(hx, hz, d);
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      const z = pts[i + 1];
      if (z > hz + 1 && d < 22) continue;
      if (Math.hypot(x - MILL_X(hx), z - MILL_Z(hz)) < 3.2) continue;
      const cluster = Math.min(
        1,
        Math.max(0, 0.5 + meadowNoise.noise2(x * 0.08 + 3, z * 0.08) * 0.9),
      );
      if (!rng.chance(cluster * (low ? 0.03 : 0.075))) continue;
      (rng.chance(0.5) ? pines : oaks).push([x, z]);
    }
  }
  const make = (
    key: string,
    build: () => BufferGeometry,
    spots: [number, number][],
    lo: number,
    hi: number,
  ): InstancedMesh => {
    const mesh = new InstancedMesh(
      shared(key, build),
      mat,
      Math.max(1, spots.length),
    );
    spots.forEach(([x, z], k) => {
      const sc = rng.range(lo, hi);
      m4.compose(
        pos.set(x + rng.range(-0.6, 0.6), 0, z + rng.range(-0.6, 0.6)),
        quat.setFromAxisAngle(UP, rng.range(0, 6.28)),
        scl.set(
          sc * rng.range(0.85, 1.1),
          sc * rng.range(0.9, 1.3),
          sc * rng.range(0.85, 1.1),
        ),
      );
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, new Color().setScalar(rng.range(0.88, 1.1)));
    });
    mesh.count = spots.length;
    return mesh;
  };
  return [
    make('valley-pine', pineGeometry, pines, 1.3, 2.3),
    make('valley-oak', oakGeometry, oaks, 1.2, 1.9),
  ];
}

/** Grass tufts on the floor that is empty at the start of the round: one instanced mesh, lit by the blasts. */
function tufts({ map, w, h, lit }: SceneryCtx): InstancedMesh {
  const cells: number[] = [];
  const r = new Rng(hash3(map.seed, w, h, 0x7f7f));
  for (let i = 0; i < map.terrain.length; i++)
    if (map.terrain[i] !== Terrain.Hard && r.chance(0.3)) cells.push(i);
  const mesh = new InstancedMesh(
    shared('valley-tuft', tuftGeometry),
    lit,
    Math.max(1, cells.length * 2),
  );
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  let n = 0;
  for (const i of cells) {
    const x = i % w;
    const y = (i - x) / w;
    const k = r.chance(0.5) ? 2 : 1;
    for (let j = 0; j < k; j++) {
      const s = r.range(0.8, 1.5);
      m4.compose(
        pos.set(
          gridToWorldX(w, x + 0.5) + r.range(-0.36, 0.36),
          0,
          gridToWorldZ(h, y + 0.5) + r.range(-0.36, 0.36),
        ),
        quat.setFromAxisAngle(UP, r.range(0, 6.28)),
        scl.set(s, s * r.range(0.8, 1.2), s),
      );
      mesh.setMatrixAt(n++, m4);
    }
  }
  mesh.count = n;
  return mesh;
}

function scenery(ctx: SceneryCtx) {
  const { w, h, hx, hz, rng, flat, quality } = ctx;
  const low = quality.name === 'low';
  // the mill (turned towards the camera and the pitch, so the sails read face on) is baked into the ground's draw;
  // only its sails are a mesh of their own, turning
  const mx = MILL_X(hx);
  const mz = MILL_Z(hz);
  const sails = new Mesh(shared('valley-mill-sails', millSailsGeometry), flat);
  sails.position.set(
    mx + Math.sin(MILL_YAW) * 1.62,
    GROUND_Y + MILL_HUB_Y,
    mz + Math.cos(MILL_YAW) * 1.62,
  );
  sails.rotation.set(0, MILL_YAW, 0, 'YXZ');
  return {
    update(t: number) {
      sails.rotation.z = -t * 0.6;
    },
    objects: [
      sails,
      new Mesh(
        shared(`valley-meadow${w}x${h}${low ? 'l' : ''}`, () =>
          merge([
            groundGeometry(hx, hz, low),
            hedgeGeometry(hx, hz, low),
            millGeometry().rotateY(MILL_YAW).translate(mx, GROUND_Y, mz),
          ]),
        ),
        flat,
      ),
      ...meadowTrees(hx, hz, rng, flat, low),
    ],
  };
}

/** Level 2: a sunny meadow in a wooded valley - green floor and banks, a hedge round the pitch, hay bales, mossy boulders, a stream. */
export const VALLEY_THEME: LevelTheme = {
  id: 'valley',
  sky: [V.skyTop, V.skyMid, V.skyLow],
  light: {
    key: 0xfff1d6,
    keyIntensity: 2.5,
    sky: 0xcfe6ff,
    ground: 0x7ea060,
    fill: 1.2,
    env: 0.2,
  },
  fx: FX,
  warnColor: 0xff4a2a,
  fall: 'wall',
  // the cairn would look wrong dropping out of the sky: only boulders fall
  wallVariants: [0],
  tiles: {
    colors: V.tiles,
    geometry: tileGeometry,
    vertexColors: false,
    rotate: false,
    tint(x, y, r, out) {
      out.set(V.tiles[Math.floor(r.next() * V.tiles.length)]);
      // mown stripes, a few bare patches
      out
        .multiplyScalar((x + y) & 1 ? 1 : 0.92)
        .multiplyScalar(r.range(0.96, 1.05));
      if (r.chance(0.07)) out.set(V.dirt).multiplyScalar(r.range(0.92, 1.05));
    },
  },
  hard: [mossyBoulder, cairn],
  crate: [
    () =>
      woodCrateGeometry({
        crate: V.crate,
        band: V.crateBand,
        dark: V.crateDark,
      }),
    hayBale,
  ],
  floor,
  decor,
  platformExtras: (ctx) => [tufts(ctx)],
  scenery,
  // the crowd stands on the flat meadow: three loose rows right behind the hedge, a thin crowd
  crowd: {
    ring: ringPoints,
    height: () => GROUND_Y,
    tiers: 3,
    rowD: (t) => 0.8 + 1.3 * t,
    fill: 0.62,
  },
};
