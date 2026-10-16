import {
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Color,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { Rng, hash3 } from '../../../../shared/rng';
import { gridToWorldX, gridToWorldZ } from '../../sim/grid';
import { Terrain } from '../../sim/types';
import {
  RIM_D,
  RIM_H,
  bowlGeometry,
  treadHeight,
  warpedRing,
  type BowlColors,
} from '../bowl';
import {
  box,
  merge,
  part,
  rbox,
  rock,
  tileGeometry,
  woodCrateGeometry,
  type DecorParts,
} from '../parts';
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
  skyTop: '#8fc4ee',
  skyMid: '#d8ecf7',
  skyLow: '#f4f0d6',
} as const;

const VALLEY_BOWL: BowlColors = {
  // a clipped hedge round the pitch, grassy banks for the stands, an earth bank under the pines
  wall: new Color(0x4d8a3a),
  treads: [0x8dbd5f, 0x82b358, 0x78a950].map((c) => new Color(c)),
  riser: new Color(0x8a6a45),
  strata: [0x6faa4c, 0x8d6c45, 0x7a5a38, 0x5f4630].map((c) => new Color(c)),
  rim: new Color(0x6fae4a),
};

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
    part(rock(0.55, 2), V.boulder, {
      y: 0.46,
      sy: 0.92,
      lumpy: 0.09,
      tint: 0.12,
    }),
    part(rock(0.3, 1), V.moss, {
      x: -0.12,
      y: 0.84,
      z: 0.08,
      sy: 0.4,
      sx: 1.15,
      lumpy: 0.06,
      tint: 0.18,
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

/** Crate 1: a round-edged hay bale with two twine bands and a few straws sticking out. */
function hayBale(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(rbox(0.92, 0.72, 0.8, 0.1, 2), V.hay, { y: 0.38, tint: 0.14 }),
    part(rbox(0.07, 0.76, 0.84, 0.02), V.hayBand, { x: -0.22, y: 0.38 }),
    part(rbox(0.07, 0.76, 0.84, 0.02), V.hayBand, { x: 0.22, y: 0.38 }),
    part(rbox(0.8, 0.1, 0.66, 0.04), V.hayDark, { y: 0.76, tint: 0.2 }),
  ];
  const r = new Rng(2210);
  for (let i = 0; i < 9; i++)
    p.push(
      part(new ConeGeometry(0.025, 0.2, 3), V.hayDark, {
        x: r.range(-0.4, 0.4),
        z: r.range(-0.36, 0.36),
        y: r.range(0.15, 0.7),
        ry: r.range(0, 3),
        tint: 0.2,
      }),
    );
  return merge(p);
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

function rimTrees(
  hx: number,
  hz: number,
  rng: Rng,
  mat: Material,
  low: boolean,
): InstancedMesh {
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const spots: [number, number][] = [];
  for (const d of [3.2, 4.6, 6.4, 8.6, 11]) {
    const pts = warpedRing(hx, hz, RIM_D + d);
    for (let i = 0; i < pts.length; i += 2)
      if (rng.chance(low ? 0.4 : 0.78)) spots.push([pts[i], pts[i + 1]]);
  }
  const mesh = new InstancedMesh(
    shared('valley-pine', pineGeometry),
    mat,
    Math.max(1, spots.length),
  );
  spots.forEach(([x, z], k) => {
    const sc = rng.range(1.3, 2.6);
    m4.compose(
      pos.set(x + rng.range(-0.5, 0.5), RIM_H - 0.2, z + rng.range(-0.5, 0.5)),
      quat.setFromAxisAngle(UP, rng.range(0, 6.28)),
      scl.set(
        sc * rng.range(0.85, 1.1),
        sc * rng.range(0.9, 1.35),
        sc * rng.range(0.85, 1.1),
      ),
    );
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, new Color().setScalar(rng.range(0.85, 1.1)));
  });
  return mesh;
}

/** Mossy boulders among the trees on the rim. */
function rimBoulders(
  hx: number,
  hz: number,
  rng: Rng,
  mat: Material,
): InstancedMesh {
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const spots: [number, number][] = [];
  for (const d of [1.2, 3.6])
    for (let i = 0, pts = warpedRing(hx, hz, RIM_D + d); i < pts.length; i += 2)
      if (rng.chance(0.12)) spots.push([pts[i], pts[i + 1]]);
  const mesh = new InstancedMesh(
    shared('valley-boulder', mossyBoulder),
    mat,
    Math.max(1, spots.length),
  );
  spots.forEach(([x, z], k) => {
    const sc = rng.range(1.2, 2.4);
    m4.compose(
      pos.set(x, RIM_H - 0.2, z),
      quat.setFromAxisAngle(UP, rng.range(0, 6.28)),
      scl.set(sc, sc * rng.range(0.8, 1.3), sc),
    );
    mesh.setMatrixAt(k, m4);
  });
  return mesh;
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
  return {
    objects: [
      new Mesh(
        shared(`valley-bowl${w}x${h}`, () => bowlGeometry(hx, hz, VALLEY_BOWL)),
        flat,
      ),
      rimTrees(hx, hz, rng, flat, quality.name === 'low'),
      rimBoulders(hx, hz, rng, flat),
    ],
  };
}

/** Level 2: a sunny meadow in a wooded valley - green floor and banks, a hedge round the pitch, hay bales, mossy boulders, a stream. */
export const VALLEY_THEME: LevelTheme = {
  id: 'valley',
  sky: [V.skyTop, V.skyMid, V.skyLow],
  light: {
    key: 0xfff1d6,
    keyIntensity: 2.4,
    sky: 0xcfe6ff,
    ground: 0x7ea060,
    fill: 1.2,
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
  crowd: { ring: warpedRing, height: treadHeight },
};
