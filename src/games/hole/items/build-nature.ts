import type { Builder } from './build-small';
import { Mesher, PAL as C } from './kit';

/**
 * Animal Island scenery: flora, rocks and hills. Every builder is `fitted` to its catalog box, so the
 * recipes only need the right proportions. Round parts are low-poly balls (`ball`): crowns, bushes,
 * boulders (jittered), hills (domes). Trunks, reeds and bamboo stay cylinders / boxes.
 */
const GRASS = 0x6fbf55;

const EARTH = 0x8a6a4a;
const ROCK = 0x9a9a96;
const ROCK_DARK = 0x7a7a78;
const SAND = 0xe6d29a;

/** Builder from a recipe designed in a w x d x h box; the result is scaled to exactly that box. */
const fit =
  (
    fn: (f: Mesher, v: number, w: number, d: number, h: number) => void,
  ): Builder =>
  (m, v, w, d, h) =>
    m.fitted(w, d, h, (f) => fn(f, v, w, d, h));

type F = Mesher;
const blob = (
  f: F,
  x: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  o: Parameters<Mesher['ball']>[7] = {},
) => f.ball(x, y0 + h / 2, z, w / 2, h / 2, d / 2, color, o);

function crown(
  f: F,
  w: number,
  y0: number,
  h: number,
  c1: number,
  c2: number,
  seed = 1,
) {
  blob(f, 0, y0, 0, w, h * 0.62, w, c1, { jitter: 0.06, seed });
  blob(f, w * 0.2, y0 + h * 0.3, w * 0.12, w * 0.62, h * 0.55, w * 0.62, c2, {
    jitter: 0.06,
    seed: seed + 1,
    seg: 8,
    rings: 5,
  });
  blob(
    f,
    -w * 0.18,
    y0 + h * 0.32,
    -w * 0.15,
    w * 0.58,
    h * 0.5,
    w * 0.58,
    c1,
    { jitter: 0.06, seed: seed + 2, seg: 8, rings: 5 },
  );
  blob(f, 0, y0 + h * 0.55, 0, w * 0.5, h * 0.45, w * 0.5, c2, {
    jitter: 0.06,
    seed: seed + 3,
    seg: 8,
    rings: 5,
  });
}

/** Small tree for hill tops: trunk + 1-2 crown balls, sized by `s`. */
function miniTree(f: F, x: number, y: number, z: number, s: number) {
  f.cyl(x, y - s * 0.3, z, s * 0.1, s * 0.07, s * 1.5, 5, C.woodDark);
  f.ball(x, y + s * 1.35, z, s * 0.5, s * 0.55, s * 0.5, C.leaf, {
    jitter: 0.06,
    seed: 5,
    seg: 8,
    rings: 5,
  });
}

const B: Record<string, Builder> = {};

// ------------------------------------------------------------------------------------------ small flora
B.mushroom = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.1, w * 0.13, h * 0.55, 6, 0xf3e3c3);
  f.ball(0, h * 0.42, 0, w * 0.5, h * 0.58, d * 0.5, 0xd94a3a, {
    half: true,
    paint: true,
    seg: 8,
    rings: 6,
  });
  for (const [x, z] of [
    [0.14, 0.1],
    [-0.12, 0.16],
    [0.02, -0.2],
  ] as const)
    f.ball(x * w, h * 0.86, z * d, w * 0.06, h * 0.06, w * 0.06, C.white, {
      seg: 6,
      rings: 3,
    });
});
B.dandelion = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.03, w * 0.025, h * 0.75, 5, C.leaf);
  f.ball(0, h * 0.85, 0, w * 0.3, h * 0.15, d * 0.3, 0xf6f6ee, {
    jitter: 0.1,
    seed: 2,
  });
  f.ball(w * 0.18, h * 0.06, 0, w * 0.18, h * 0.06, d * 0.07, C.leaf, {
    seg: 6,
    rings: 3,
  });
  f.ball(
    -w * 0.16,
    h * 0.1,
    w * 0.04,
    w * 0.16,
    h * 0.05,
    d * 0.06,
    C.leafDark,
    { seg: 6, rings: 3 },
  );
});
B.clover = fit((f, _v, w, d, h) => {
  for (const [x, z, y] of [
    [0.2, 0.0, 0.0],
    [-0.1, 0.18, 0.012],
    [-0.1, -0.18, 0.024],
    [0.3, -0.25, 0.008],
    [-0.3, 0.05, 0.02],
  ] as const)
    f.ball(
      x * w,
      (0.2 + y * 4) * h,
      z * d,
      w * 0.14,
      h * 0.2,
      d * 0.14,
      C.leaf,
      { half: true, seg: 6, rings: 4 },
    );
  f.ball(0.02 * w, h * 0.7, 0.02 * d, w * 0.06, h * 0.3, d * 0.06, 0xf6f6ee, {
    seg: 6,
    rings: 4,
  });
});
B.fern = fit((f, _v, w, d, h) => {
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    f.xf(
      Math.cos(a) * w * 0.12,
      h * 0.1,
      Math.sin(a) * d * 0.12,
      () =>
        f.ball(
          w * 0.2,
          h * (0.12 + (k % 2) * 0.04),
          0,
          w * 0.26,
          h * 0.06,
          d * 0.07,
          k % 2 ? C.leaf : C.leafDark,
          { seg: 6, rings: 3 },
        ),
      -a,
      0,
      0.35 + (k % 3) * 0.12,
    );
  }
  f.ball(0, h * 0.08, 0, w * 0.1, h * 0.08, d * 0.1, C.leafDark, {
    seg: 6,
    rings: 3,
  });
});
B.reeds = fit((f, _v, w, d, h) => {
  for (const [x, z, hh] of [
    [0, 0, 1],
    [0.2, 0.1, 0.8],
    [-0.2, 0.05, 0.9],
    [0.1, -0.22, 0.7],
    [-0.12, -0.2, 0.85],
  ] as const)
    f.cyl(
      x * w,
      0,
      z * d,
      w * 0.03,
      w * 0.012,
      h * hh,
      5,
      hh > 0.85 ? 0x8aa84a : 0x6a9a3a,
    );
});
B.cattail = fit((f, _v, w, d, h) => {
  for (const [x, z, hh] of [
    [0, 0, 1],
    [0.25, 0.1, 0.8],
    [-0.2, -0.1, 0.9],
  ] as const) {
    f.cyl(x * w, 0, z * d, w * 0.03, w * 0.02, h * hh, 5, 0x6a9a3a);
    f.ball(x * w, h * hh * 0.9, z * d, w * 0.07, h * 0.1, w * 0.07, 0x6a4a2a, {
      seg: 6,
      rings: 4,
    });
  }
});
B.lily_pad = fit((f, _v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h * 1.0, d * 0.5, 0x58b04c, {
    half: true,
    paint: true,
    seg: 10,
    rings: 4,
  });
  f.ball(w * 0.12, h * 0.9, 0, w * 0.1, h * 0.9, d * 0.1, 0xf08aa8, {
    seg: 6,
    rings: 4,
  });
});
B.pebble = fit((f, _v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h, d * 0.5, ROCK, {
    half: true,
    jitter: 0.1,
    seed: 3,
    seg: 6,
    rings: 4,
  });
});
B.seashell = fit((f, _v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h * 0.9, d * 0.5, 0xf5d9c8, {
    half: true,
    paint: true,
    seg: 8,
    rings: 4,
  });
  f.ball(w * 0.12, h * 0.55, 0, w * 0.22, h * 0.5, d * 0.22, 0xffffff, {
    seg: 6,
    rings: 4,
  });
});
B.starfish = fit((f, _v, w, d, h) => {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    f.xf(
      Math.cos(a) * w * 0.28,
      0,
      Math.sin(a) * d * 0.28,
      () =>
        f.ball(0, h * 0.3, 0, w * 0.2, h * 0.3, d * 0.07, 0xf08a2b, {
          half: true,
          paint: true,
          seg: 6,
          rings: 4,
        }),
      -a,
    );
  }
  f.ball(0, 0, 0, w * 0.18, h * 0.9, d * 0.18, 0xf08a2b, {
    half: true,
    paint: true,
    seg: 8,
    rings: 4,
  });
});
B.egg_nest = fit((f, _v, w, d, h) => {
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    f.ball(
      Math.cos(a) * w * 0.38,
      h * 0.2,
      Math.sin(a) * d * 0.38,
      w * 0.14,
      h * 0.18,
      d * 0.12,
      k % 2 ? 0x8a6a4a : 0xa8845a,
      { seg: 6, rings: 3, jitter: 0.1, seed: k },
    );
  }
  f.ball(0, 0, 0, w * 0.3, h * 0.4, d * 0.3, 0x8a6a4a, {
    half: true,
    seg: 8,
    rings: 4,
  });
  for (const [x, z, c] of [
    [-0.12, -0.05, 0xf4f1ea],
    [0.1, -0.08, 0xcfe8f0],
    [0, 0.14, 0xf4f1ea],
  ] as const)
    f.ball(x * w, h * 0.65, z * d, w * 0.1, h * 0.28, d * 0.1, c, {
      seg: 6,
      rings: 4,
    });
});
B.flower_patch = fit((f, _v, w, d, h) => {
  const cols = [
    0xff5a7a, 0xffd23f, 0xffffff, 0xb06cf5, 0xff8a3d, 0xffd23f, 0xff5a7a,
  ];
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4;
    const r = 0.1 + (k % 4) * 0.09;
    const x = Math.cos(a) * r * w;
    const z = Math.sin(a) * r * d;
    const hh = 0.55 + (k % 3) * 0.15;
    f.cyl(x, 0, z, w * 0.02, w * 0.015, h * hh, 4, C.leaf);
    f.ball(x, h * hh, z, w * 0.07, h * 0.16, w * 0.07, cols[k], {
      seg: 6,
      rings: 4,
    });
  }
  f.ball(0, 0, 0, w * 0.46, h * 0.2, d * 0.46, C.leafDark, {
    half: true,
    seg: 8,
    rings: 4,
  });
});
B.berry_bush = fit((f, _v, w, d, h) => {
  blob(f, 0, 0, 0, w, h * 0.75, d, C.leafDark, {
    jitter: 0.06,
    seed: 6,
    seg: 8,
    rings: 5,
  });
  blob(f, w * 0.12, h * 0.3, -w * 0.08, w * 0.62, h * 0.7, d * 0.62, C.leaf, {
    jitter: 0.06,
    seed: 7,
    seg: 8,
    rings: 5,
  });
  for (const [x, y, z] of [
    [0.38, 0.5, 0.2],
    [-0.35, 0.45, 0.25],
    [0.1, 0.8, 0.3],
    [-0.2, 0.7, -0.3],
    [0.3, 0.6, -0.3],
    [-0.4, 0.3, -0.1],
  ] as const)
    f.ball(x * w, y * h, z * d, w * 0.06, w * 0.06, w * 0.06, 0xd94a3a, {
      paint: true,
      seg: 6,
      rings: 3,
    });
});
B.jungle_plant = fit((f, _v, w, d, h) => {
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    f.xf(
      0,
      h * 0.05,
      0,
      () =>
        f.ball(
          w * 0.28,
          h * (0.25 + (k % 2) * 0.1),
          0,
          w * 0.3,
          h * 0.07,
          d * 0.14,
          k % 2 ? C.leaf : C.leafDark,
          { seg: 8, rings: 4 },
        ),
      -a,
      0,
      0.5 + (k % 3) * 0.12,
    );
  }
  f.cyl(0, 0, 0, w * 0.05, w * 0.04, h * 0.3, 5, C.leafDark);
});
B.bamboo_grove = fit((f, _v, w, d, h) => {
  const stalks: [number, number, number][] = [
    [0, 0, 1],
    [0.25, 0.1, 0.85],
    [-0.22, 0.15, 0.95],
    [0.1, -0.25, 0.8],
    [-0.2, -0.22, 0.9],
    [0.32, -0.2, 0.7],
    [-0.35, 0.0, 0.75],
  ];
  for (const [x, z, hh] of stalks) {
    f.cyl(x * w, 0, z * d, w * 0.035, w * 0.03, h * hh, 6, 0x8ab84a);
    f.cyl(
      x * w,
      h * hh * 0.5,
      z * d,
      w * 0.042,
      w * 0.042,
      h * 0.012,
      6,
      0x6a9a3a,
    );
  }
  blob(f, 0, h * 0.78, 0, w * 0.5, h * 0.22, d * 0.5, C.leaf, {
    jitter: 0.08,
    seed: 9,
    seg: 8,
    rings: 5,
  });
});

// ------------------------------------------------------------------------------------------ logs, stumps, rocks
B.log = fit((f, _v, w, _d, h) => {
  f.cyl(0, h * 0.5, 0, h * 0.5, h * 0.5, w, 7, C.woodDark, { axis: 'x' });
  for (const sx of [-1, 1])
    f.cyl(
      sx * (w / 2 + h * 0.03),
      h * 0.5,
      0,
      h * 0.4,
      h * 0.4,
      h * 0.06,
      7,
      0xd9b27a,
      { axis: 'x' },
    );
});
B.fallen_log = fit((f, _v, w, _d, h) => {
  f.cyl(0, h * 0.5, 0, h * 0.5, h * 0.5, w, 7, C.woodDark, { axis: 'x' });
  for (const sx of [-1, 1])
    f.cyl(
      sx * (w / 2 + h * 0.03),
      h * 0.5,
      0,
      h * 0.4,
      h * 0.4,
      h * 0.06,
      7,
      0xd9b27a,
      { axis: 'x' },
    );
  f.ball(w * 0.1, h * 0.95, 0, w * 0.18, h * 0.12, h * 0.3, 0x5a9a3a, {
    half: true,
    seg: 8,
    rings: 4,
  });
  f.cyl(
    -w * 0.2,
    h * 0.5,
    h * 0.55,
    h * 0.12,
    h * 0.09,
    h * 0.5,
    5,
    C.woodDark,
    { axis: 'z' },
  );
});
B.tree_stump = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.48, w * 0.4, h, 8, C.woodDark);
  f.cyl(0, h * 0.99, 0, w * 0.34, w * 0.34, h * 0.02, 8, 0xd9b27a);
  for (const a of [0.3, 2.3, 4.2])
    f.ball(
      Math.cos(a) * w * 0.42,
      h * 0.1,
      Math.sin(a) * w * 0.42,
      w * 0.12,
      h * 0.14,
      w * 0.1,
      C.woodDark,
      { seg: 6, rings: 3 },
    );
});
const rock = (
  parts: [number, number, number, number, number, number, number][],
  tint = 0,
): Builder =>
  fit((f) => {
    parts.forEach(([x, y, z, rw, rh, rd, k], i) =>
      f.ball(x, y, z, rw, rh, rd, k ? ROCK_DARK : ROCK + tint, {
        jitter: 0.12,
        seed: 10 + i,
        half: false,
        seg: 8,
        rings: 5,
      }),
    );
  });
B.boulder_small = rock([
  [0, 0.34, 0, 0.5, 0.36, 0.45, 0],
  [0.4, 0.15, 0.2, 0.2, 0.16, 0.2, 1],
]);
B.boulder = rock([
  [0, 0.5, 0, 0.7, 0.5, 0.6, 0],
  [-0.45, 0.2, 0.3, 0.3, 0.22, 0.28, 1],
  [0.5, 0.25, -0.3, 0.3, 0.25, 0.3, 0],
]);
B.boulder_big = rock([
  [0, 0.7, 0, 0.95, 0.7, 0.8, 0],
  [0.6, 0.4, 0.35, 0.5, 0.4, 0.45, 1],
  [-0.7, 0.3, -0.3, 0.4, 0.3, 0.4, 0],
]);
B.boulder_huge = rock([
  [0, 1.9, 0, 3, 2.0, 2.5, 0],
  [2, 1.0, 1.2, 1.5, 1.0, 1.4, 1],
  [-2.1, 0.9, -1, 1.4, 0.9, 1.3, 0],
  [0.6, 3.4, -0.3, 1.5, 1.0, 1.3, 1],
]);
B.boulder_pile = rock([
  [-0.7, 0.7, 0, 1.0, 0.7, 0.9, 0],
  [0.9, 0.6, 0.4, 0.9, 0.6, 0.8, 1],
  [0.1, 1.2, -0.2, 0.9, 0.6, 0.8, 0],
  [0.3, 0.4, -1.0, 0.7, 0.4, 0.6, 1],
]);
B.rock_arch = fit((f, _v, w, d, h) => {
  for (const [sx, k] of [
    [-1, 0],
    [1, 1],
  ] as const) {
    blob(
      f,
      sx * w * 0.36,
      0,
      0,
      w * 0.3,
      h * 0.55,
      d * 0.9,
      k ? ROCK_DARK : ROCK,
      { jitter: 0.1, seed: 20 + k, seg: 8, rings: 5 },
    );
    blob(
      f,
      sx * w * 0.32,
      h * 0.4,
      0,
      w * 0.26,
      h * 0.4,
      d * 0.8,
      k ? ROCK : ROCK_DARK,
      { jitter: 0.1, seed: 22 + k, seg: 8, rings: 5 },
    );
  }
  blob(f, 0, h * 0.62, 0, w * 0.9, h * 0.38, d * 0.7, ROCK, {
    jitter: 0.08,
    seed: 24,
    seg: 10,
    rings: 5,
  });
});

// ------------------------------------------------------------------------------------------ big trees
B.oak = fit((f, v, w, _d, h) => {
  f.box(0, 0, 0, w * 0.14, h * 0.5, w * 0.14, C.woodDark, { taper: 0.75 });
  f.box(w * 0.1, h * 0.28, 0, w * 0.2, h * 0.04, w * 0.05, C.woodDark);
  crown(
    f,
    w,
    h * 0.34,
    h * 0.66,
    v ? 0x8ab84a : C.leafDark,
    v ? 0xb0c84a : C.leaf,
    30 + v,
  );
});
B.acacia = fit((f, _v, w, _d, h) => {
  f.box(0, 0, 0, w * 0.1, h * 0.7, w * 0.1, 0x7a5a3a, { taper: 0.7 });
  f.box(w * 0.14, h * 0.5, 0, w * 0.3, h * 0.04, w * 0.05, 0x7a5a3a);
  blob(f, 0, h * 0.64, 0, w, h * 0.22, w, 0x8aa84a, {
    jitter: 0.06,
    seed: 40,
    seg: 10,
    rings: 5,
  });
  blob(f, w * 0.18, h * 0.8, w * 0.1, w * 0.62, h * 0.2, w * 0.62, 0x9ab85a, {
    jitter: 0.06,
    seed: 41,
    seg: 8,
    rings: 5,
  });
});
B.baobab = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.34, w * 0.2, h * 0.7, 8, 0x9a8a7a);
  f.cyl(0, 0, 0, w * 0.39, w * 0.3, h * 0.12, 8, 0x8a7a6a);
  for (const a of [0.4, 2.2, 3.9, 5.3])
    f.xf(
      Math.cos(a) * w * 0.12,
      h * 0.62,
      Math.sin(a) * w * 0.12,
      () => f.box(0, 0, 0, w * 0.07, h * 0.25, w * 0.07, 0x8a7a6a),
      0,
      Math.sin(a) * 0.5,
      -Math.cos(a) * 0.5,
    );
  blob(f, 0, h * 0.78, 0, w * 0.9, h * 0.22, w * 0.9, 0x6a9a3a, {
    jitter: 0.08,
    seed: 50,
    seg: 10,
    rings: 5,
  });
  blob(f, w * 0.3, h * 0.7, w * 0.1, w * 0.4, h * 0.14, w * 0.4, 0x7aaa4a, {
    jitter: 0.08,
    seed: 51,
    seg: 8,
    rings: 5,
  });
});
B.jungle_tree = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.1, w * 0.06, h * 0.7, 7, 0x6a4a2a);
  for (const a of [0, 2.1, 4.2])
    f.xf(
      Math.cos(a) * w * 0.06,
      0,
      Math.sin(a) * w * 0.06,
      () =>
        f.box(0, 0, 0, w * 0.3, h * 0.2, w * 0.03, 0x6a4a2a, { taper: 0.2 }),
      -a,
    );
  blob(f, 0, h * 0.5, 0, w, h * 0.35, w, 0x2f7a3a, {
    jitter: 0.06,
    seed: 60,
    seg: 10,
    rings: 6,
  });
  blob(f, w * 0.12, h * 0.68, w * 0.1, w * 0.7, h * 0.3, w * 0.7, 0x3c8a3e, {
    jitter: 0.06,
    seed: 61,
    seg: 8,
    rings: 5,
  });
  blob(
    f,
    -w * 0.15,
    h * 0.62,
    -w * 0.15,
    w * 0.55,
    h * 0.26,
    w * 0.55,
    0x2f7a3a,
    { jitter: 0.06, seed: 62, seg: 8, rings: 5 },
  );
});
B.redwood = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.5, w * 0.12, h * 0.85, 8, 0x8a4a2a);
  const tiers: [number, number, number][] = [
    [0.9, 0.2, 0.3],
    [0.72, 0.22, 0.5],
    [0.52, 0.2, 0.68],
    [0.32, 0.18, 0.84],
  ];
  tiers.forEach(([rw, th, y], i) =>
    blob(
      f,
      0,
      h * y * 0.9,
      0,
      w * rw * 1.3,
      h * th * 0.9,
      w * rw * 1.3,
      i % 2 ? 0x2f6a3a : 0x3a7a42,
      { jitter: 0.06, seed: 70 + i, seg: 8, rings: 5 },
    ),
  );
});

// ------------------------------------------------------------------------------------------ water things
B.beaver_dam = fit((f, _v, w, d, h) => {
  const logs: [number, number, number][] = [
    [0, 0.25, 0.0],
    [0, 0.25, 0.34],
    [0, 0.25, -0.34],
    [0.02, 0.62, 0.17],
    [-0.02, 0.62, -0.17],
    [0, 0.95, 0.0],
  ];
  logs.forEach(([x, y, z], i) =>
    f.cyl(
      x * w,
      y * h,
      z * d,
      h * 0.2,
      h * 0.2,
      w * (0.96 - (i > 2 ? 0.1 : 0)),
      6,
      i % 2 ? C.woodDark : C.wood,
      { axis: 'x' },
    ),
  );
  f.ball(0, h * 0.7, 0, w * 0.3, h * 0.3, d * 0.3, 0x6a5a3a, {
    half: true,
    jitter: 0.1,
    seed: 80,
    seg: 8,
    rings: 4,
  });
});
B.log_bridge = fit((f, _v, w, d, h) => {
  for (const sz of [-1, 1])
    f.cyl(0, h * 0.2, sz * d * 0.34, h * 0.18, h * 0.18, w, 6, C.woodDark, {
      axis: 'x',
    });
  for (let k = 0; k < 10; k++)
    f.box(
      -w * 0.45 + k * w * 0.1,
      h * 0.3,
      0,
      w * 0.085,
      h * 0.2,
      d * 0.9,
      k % 2 ? C.wood : 0xb8844f,
    );
});

// ------------------------------------------------------------------------------------------ hills
/** Soft dome with a darker earth apron; v1 adds little trees, v2 rocks and flowers. */
function hill(f: F, v: number, w: number, d: number, h: number, seed: number) {
  f.ball(0, 0, 0, w * 0.6, h * 0.2, d * 0.6, EARTH, {
    half: true,
    seg: 10,
    rings: 4,
  });
  f.ball(0, 0, 0, w * 0.5, h, d * 0.5, GRASS, {
    half: true,
    jitter: 0.03,
    seed,
    seg: 12,
    rings: 8,
  });
  const s = Math.min(w, d) * 0.05;
  /** Height of the dome surface at (x, z) (a little under, so things sit in it). */
  const top = (x: number, z: number) => {
    const u = (2 * x) / w;
    const t = (2 * z) / d;
    return h * Math.sqrt(Math.max(0, 1 - u * u - t * t)) * 0.96;
  };
  if (v === 1) {
    for (const [x, z, k] of [
      [0.1, 0.05, 1],
      [-0.17, -0.1, 0.8],
      [0.02, 0.22, 0.7],
    ] as const)
      miniTree(f, w * x, top(w * x, d * z), d * z, s * k);
  } else if (v === 2) {
    const put = (
      x: number,
      z: number,
      rw: number,
      rh: number,
      c: number,
      sd: number,
    ) =>
      f.ball(w * x, top(w * x, d * z) + rh * 0.3, d * z, rw, rh, rw * 0.9, c, {
        jitter: 0.1,
        seed: sd,
        seg: 8,
        rings: 4,
      });
    put(-0.1, 0.04, s * 0.9, s * 0.6, ROCK, 5);
    put(0.14, -0.08, s * 0.6, s * 0.45, ROCK_DARK, 6);
    for (const [x, z, c] of [
      [0.0, 0.14, 0xffd23f],
      [0.16, 0.1, 0xff5a7a],
      [-0.2, -0.05, 0xffffff],
      [0.05, -0.2, 0xb06cf5],
    ] as const)
      f.ball(
        w * x,
        top(w * x, d * z) + s * 0.1,
        d * z,
        s * 0.28,
        s * 0.28,
        s * 0.28,
        c,
        { seg: 6, rings: 3 },
      );
  }
}
const hillB = (seed: number): Builder =>
  fit((f, v, w, d, h) => hill(f, v, w, d, h, seed));
for (const [id, seed] of [
  ['hill_5', 101],
  ['hill_7', 102],
  ['hill_9', 103],
  ['hill_10', 104],
  ['hill_12', 105],
  ['hill_14', 106],
  ['hill_16', 107],
  ['hill_19', 108],
  ['hill_22', 109],
  ['hill_26', 110],
  ['hill_30', 111],
  ['hill_great', 112],
  ['hillock', 113],
  ['knoll', 114],
] as const)
  B[id] = hillB(seed);

B.molehill = fit((f, v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h, d * 0.5, 0x7a5a3a, {
    half: true,
    jitter: 0.08,
    seed: 120,
    seg: 8,
    rings: 5,
  });
  f.ball(w * 0.42, 0, d * 0.1, w * 0.12, h * 0.4, d * 0.1, 0x6a4a2a, {
    half: true,
    seg: 6,
    rings: 4,
  });
  if (v === 1)
    f.ball(-w * 0.1, h * 0.9, 0, w * 0.1, h * 0.25, d * 0.1, C.leaf, {
      seg: 6,
      rings: 3,
    });
  if (v === 2)
    f.ball(0.02 * w, h * 0.97, 0, w * 0.13, h * 0.09, d * 0.13, 0x2a1a10, {
      seg: 6,
      rings: 3,
    });
});
B.anthill = fit((f, _v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h * 0.55, d * 0.5, SAND, {
    half: true,
    jitter: 0.06,
    seed: 121,
    seg: 8,
    rings: 5,
  });
  f.ball(0, h * 0.4, 0, w * 0.32, h * 0.6, d * 0.32, 0xd8c288, {
    half: true,
    jitter: 0.06,
    seed: 122,
    seg: 8,
    rings: 5,
  });
  f.ball(0, h * 0.97, 0, w * 0.08, h * 0.06, w * 0.08, 0x2a1a10, {
    seg: 6,
    rings: 3,
  });
});
B.dirt_mound = fit((f, _v, w, d, h) => {
  f.ball(0, 0, 0, w * 0.5, h, d * 0.5, 0x8a6a4a, {
    half: true,
    jitter: 0.08,
    seed: 123,
    seg: 8,
    rings: 5,
  });
  for (const [x, z, k] of [
    [0.56, 0.2, 0],
    [-0.55, 0.28, 1],
    [-0.1, -0.58, 0],
  ] as const)
    f.ball(
      w * x,
      h * 0.03,
      d * z,
      w * 0.08,
      h * 0.25,
      w * 0.08,
      k ? ROCK_DARK : ROCK,
      { half: true, seg: 6, rings: 3 },
    );
});
B.termite_mound = fit((f, _v, w, _d, h) => {
  const tiers: [number, number, number][] = [
    [0.5, 0.0, 0.42],
    [0.38, 0.3, 0.3],
    [0.26, 0.55, 0.28],
    [0.15, 0.78, 0.22],
  ];
  tiers.forEach(([r, y, th], i) =>
    f.cyl(
      0,
      y * h,
      0,
      w * r,
      w * r * 0.7,
      th * h,
      8,
      i % 2 ? 0xc07a4a : 0xa8643a,
    ),
  );
  f.ball(w * 0.12, h * 0.25, w * 0.3, w * 0.1, w * 0.1, w * 0.1, 0x8a5a30, {
    seg: 6,
    rings: 3,
  });
  f.ball(0, h * 0.98, 0, w * 0.1, h * 0.06, w * 0.1, 0xa8643a, {
    seg: 6,
    rings: 3,
  });
});

export const NATURE_BUILDERS: Record<string, Builder> = B;
