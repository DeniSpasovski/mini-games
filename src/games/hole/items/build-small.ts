import { Mesher, PAL as C, roundDetail, type BallOpts } from './kit';

/** Builder: (mesher, variant, w, d, h) in catalog metres. */
export type Builder = (
  m: Mesher,
  v: number,
  w: number,
  d: number,
  h: number,
) => void;

/**
 * Round part by its bounding box (like `box`: (cx, cz) centre, y0 bottom): a ball / egg / dome whose widest
 * ring really reaches w x d (faceted balls with an odd number of rings have no equator row, so the radii
 * are widened to compensate), so the built size equals the catalog size.
 */
function blob(
  m: Mesher,
  cx: number,
  y0: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  color: number,
  o: BallOpts = {},
): void {
  const rings = o.rings ?? roundDetail(Math.max(w, h, d) / 2).rings;
  const k = rings % 2 === 0 ? 1 : 1 / Math.cos(Math.PI / (2 * rings));
  if (o.half) m.ball(cx, y0, cz, (w / 2) * k, h, (d / 2) * k, color, o);
  else m.ball(cx, y0 + h / 2, cz, (w / 2) * k, h / 2, (d / 2) * k, color, o);
}

const tuftBlades: [number, number, number, number][] = [
  [0, 0, 0.3, 0],
  [0.17, 0.08, 0.22, 0.6],
  [-0.18, 0.05, 0.24, 1.2],
  [0.06, -0.18, 0.2, 2.0],
  [-0.1, -0.17, 0.26, 2.6],
];

function cluster(n: number, w: number, fn: (x: number, i: number) => void) {
  const step = w / n;
  for (let i = 0; i < n; i++) fn(-w / 2 + step * (i + 0.5), i);
}

/** Stacked cones (a pine): `n` tiers from `y0`, each `h` tall, spaced `step`, radius shrinking from `r0` by `dr`. */
function pine(
  m: Mesher,
  n: number,
  y0: number,
  step: number,
  h: number,
  r0: number,
  dr: number,
  colors: [number, number],
): void {
  for (let k = 0; k < n; k++)
    m.cyl(0, y0 + k * step, 0, r0 - k * dr, 0.12, h, 8, colors[k % 2]);
}

export const SMALL_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- litter
  soda_can(m) {
    m.cyl(0, 0, 0, 0.06, 0.06, 0.19, 8, C.red, { paint: true });
    m.cyl(0, 0.19, 0, 0.05, 0.05, 0.01, 8, C.chrome);
  },
  litter_paper(m) {
    m.box(0, 0, 0, 0.26, 0.04, 0.24, C.white);
    m.xf(
      0.02,
      0.02,
      0,
      () => m.box(0, 0, 0, 0.22, 0.03, 0.2, C.cream),
      0.7,
      0.12,
    );
    m.xf(-0.05, 0, 0.05, () => m.box(0, 0, 0, 0.1, 0.05, 0.1, C.light), 0.4);
  },
  trash_bag(m) {
    m.box(0, 0, 0, 0.6, 0.42, 0.5, C.black, { paint: true, taper: 0.7 });
    m.box(0, 0.42, 0, 0.3, 0.12, 0.28, C.black, { paint: true, taper: 0.5 });
    m.box(0, 0.54, 0, 0.1, 0.06, 0.1, C.black, { paint: true });
  },
  // ---------------------------------------------------------------- street
  trash_can(m, v) {
    if (v === 0) {
      m.cyl(0, 0, 0, 0.26, 0.29, 0.88, 8, C.green);
      m.cyl(0, 0.88, 0, 0.3, 0.3, 0.12, 8, C.darkGreen);
    } else {
      m.box(0, 0, 0, 0.56, 0.9, 0.56, C.grey, { taper: 1.05 });
      m.box(0, 0.9, 0, 0.6, 0.1, 0.6, C.dark);
      m.box(0, 0.5, 0.285, 0.3, 0.05, 0.02, C.black);
    }
  },
  flower(m) {
    m.cyl(0, 0, 0, 0.02, 0.02, 0.3, 6, C.green);
    m.box(0.07, 0.12, 0, 0.1, 0.03, 0.04, C.green);
    [
      [0.08, 0],
      [-0.08, 0],
      [0, 0.08],
      [0, -0.08],
    ].forEach(([dx, dz], i) =>
      // every petal at its own height so no two tops share a plane
      m.box(dx, 0.3 + i * 0.008, dz, 0.09, 0.07, 0.09, C.white, {
        paint: true,
      }),
    );
    m.box(0, 0.3, 0, 0.08, 0.1, 0.08, C.yellow);
  },
  grass_tuft(m) {
    for (const [x, z, hh, r] of tuftBlades)
      m.xf(
        x,
        0,
        z,
        () => m.box(0, 0, 0, 0.09, hh, 0.04, C.leaf, { taper: 0.4 }),
        r,
      );
    m.box(0, 0, 0, 0.5, 0.04, 0.5, C.leafDark);
  },
  traffic_cone(m) {
    m.box(0, 0, 0, 0.4, 0.04, 0.4, C.dark);
    m.cyl(0, 0.04, 0, 0.16, 0.03, 0.66, 8, C.orange);
    m.cyl(0, 0.29, 0, 0.112, 0.092, 0.12, 8, C.white);
  },
  fire_hydrant(m) {
    m.cyl(0, 0, 0, 0.17, 0.15, 0.1, 8, C.dark);
    m.cyl(0, 0.1, 0, 0.14, 0.12, 0.5, 8, C.red, { paint: true });
    m.cyl(0, 0.6, 0, 0.15, 0.05, 0.14, 8, C.red, { paint: true });
    m.cyl(0, 0.74, 0, 0.04, 0.04, 0.06, 6, C.chrome);
    m.box(0, 0.4, 0, 0.45, 0.1, 0.1, C.chrome);
  },
  parking_meter(m) {
    m.cyl(0, 0, 0, 0.03, 0.03, 1.0, 6, C.dark);
    m.box(0, 1.0, 0, 0.3, 0.3, 0.3, C.grey, { taper: 0.9 });
    m.box(0, 1.08, 0.155, 0.18, 0.14, 0.01, C.glassDark);
  },
  bollard(m) {
    m.cyl(0, 0, 0, 0.15, 0.15, 0.9, 8, C.dark);
    m.cyl(0, 0.62, 0, 0.16, 0.16, 0.1, 8, C.yellow);
  },
  street_sign(m, v) {
    m.box(0, 0, 0, 0.07, 2.2, 0.07, C.grey);
    const plate = [C.red, C.blue, C.dark][v % 3];
    m.box(0, 1.9, 0, 0.6, 0.6, 0.05, plate);
    m.box(
      0,
      2.05,
      0.03,
      v === 0 ? 0.4 : 0.3,
      v === 0 ? 0.1 : 0.3,
      0.02,
      C.white,
    );
    if (v === 2) m.box(0, 2.35, 0, 0.5, 0.1, 0.1, C.green);
  },
  newspaper_box(m) {
    m.box(0, 0, 0, 0.3, 0.35, 0.3, C.dark);
    m.box(0, 0.35, 0, 0.6, 0.7, 0.5, C.red, { paint: true });
    m.box(0, 0.55, 0.255, 0.4, 0.3, 0.02, C.glassDark);
    m.box(0, 1.05, 0, 0.62, 0.05, 0.52, C.dark);
  },
  mailbox(m, v) {
    m.box(0, 0, 0, 0.12, 0.85, 0.12, v === 0 ? C.dark : C.woodDark);
    cluster(3, 0.95, (x, i) => {
      m.box(x, 0.85, 0, 0.3, 0.3, 0.5, [C.blue, C.red, C.green][(i + v) % 3], {
        taper: 0.9,
      });
      m.box(x, 1.12, 0, 0.3, 0.08, 0.5, C.dark);
    });
  },
  planter(m) {
    m.box(0, 0, 0, 1, 0.4, 1, C.brick);
    m.box(0, 0.4, 0, 0.9, 0.06, 0.9, C.woodDark);
    blob(m, 0, 0.46, 0, 0.8, 0.12, 0.8, C.leafDark, {
      half: true,
      seg: 8,
      rings: 4,
    });
    for (const [x, z] of [
      [-0.22, -0.2],
      [0.22, -0.18],
      [-0.2, 0.22],
      [0.2, 0.2],
    ])
      blob(m, x, 0.5, z, 0.3, 0.2, 0.3, C.white, {
        paint: true,
        seg: 5,
        rings: 3,
      });
  },
  shopping_cart(m) {
    m.box(0, 0.3, 0, 1.0, 0.45, 0.6, C.light, { taper: 1.06 });
    m.box(0, 0.25, 0, 0.9, 0.06, 0.55, C.grey);
    m.box(-0.5, 0.75, 0, 0.04, 0.2, 0.62, C.grey);
    m.box(-0.5, 0.95, 0, 0.06, 0.05, 0.62, C.red);
    for (const [x, z] of [
      [-0.4, -0.25],
      [-0.4, 0.25],
      [0.4, -0.25],
      [0.4, 0.25],
    ])
      m.box(x, 0, z, 0.1, 0.12, 0.06, C.rubber);
  },
  wooden_crate(m) {
    m.box(0, 0, 0, 0.94, 0.96, 0.94, C.wood);
    for (const [x, z] of [
      [-0.47, -0.47],
      [0.47, -0.47],
      [0.47, 0.47],
      [-0.47, 0.47],
    ])
      m.box(x, 0, z, 0.08, 1.02, 0.08, C.woodDark);
    m.box(0, 0.92, 0, 1, 0.08, 1, C.woodDark);
    m.box(0, 0, 0, 1, 0.08, 1, C.woodDark);
  },
  lamp_post(m) {
    m.cyl(0, 0, 0, 0.17, 0.12, 0.3, 8, C.dark);
    m.cyl(0, 0.3, 0, 0.07, 0.06, 4.0, 8, C.dark);
    m.box(0, 4.3, 0, 0.35, 0.1, 0.3, C.dark);
    m.box(0, 4.25, 0, 0.3, 0.07, 0.26, C.lamp);
    m.box(0, 4.4, 0, 0.2, 0.1, 0.2, C.dark);
  },
  phone_booth(m) {
    m.box(0, 0, 0, 1.1, 0.1, 1.1, C.dark);
    for (const [x, z] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ])
      m.box(x, 0.1, z, 0.1, 2.15, 0.1, C.red);
    m.box(0, 2.25, 0, 1.1, 0.15, 1.1, C.red);
    m.box(0, 0.1, -0.5, 0.9, 2.1, 0.03, C.glass);
    m.box(-0.5, 0.1, 0, 0.03, 2.1, 0.9, C.glass);
    m.box(0.5, 0.1, 0, 0.03, 2.1, 0.9, C.glass);
    m.box(0, 0.1, 0.5, 0.9, 0.6, 0.03, C.red);
    m.box(0, 1.5, 0.5, 0.9, 0.7, 0.03, C.glass);
    m.box(0, 1.1, -0.42, 0.3, 0.3, 0.1, C.dark);
  },
  vending_machine(m) {
    m.box(0, 0, 0, 1.1, 1.9, 0.8, C.red, { paint: true });
    m.box(-0.1, 0.5, 0.405, 0.8, 1.2, 0.02, C.glassDark);
    for (let i = 0; i < 3; i++)
      m.box(
        -0.1,
        0.62 + i * 0.38,
        0.42,
        0.7,
        0.22,
        0.02,
        [C.yellow, C.blue, C.green][i],
      );
    m.box(0.42, 0.9, 0.405, 0.14, 0.4, 0.02, C.dark);
    m.box(0, 0.1, 0.405, 0.6, 0.18, 0.02, C.black);
  },
  recycling_bins(m) {
    [C.blue, C.green, C.yellow].forEach((c, i) => {
      const x = -0.47 + i * 0.47;
      m.box(x, 0, 0, 0.45, 1.1, 0.7, c, { taper: 0.94 });
      m.box(x, 1.1, 0, 0.48, 0.1 + i * 0.01, 0.72 + i * 0.01, C.dark);
    });
  },
  traffic_light(m) {
    m.cyl(-0.6, 0, 0, 0.1, 0.09, 4.1, 6, C.dark);
    m.box(-0.1, 4.1, 0, 1.3, 0.12, 0.12, C.dark);
    m.box(0.55, 3.35, 0, 0.35, 1.1, 0.4, C.black);
    [C.red, C.yellow, C.green].forEach((c, i) =>
      m.box(0.55, 3.45 + i * 0.32, 0.205, 0.2, 0.2, 0.02, c),
    );
    m.box(-0.6, 3.1, 0.07, 0.2, 0.3, 0.08, C.light);
  },
  bus_stop(m) {
    m.box(0, 2.35, 0, 2.6, 0.1, 1.4, C.dark);
    m.box(0, 0.1, -0.65, 2.5, 2.2, 0.05, C.glass);
    m.box(-1.2, 0.1, 0, 0.05, 2.2, 1.3, C.glass);
    for (const x of [-1.25, 1.25]) m.box(x, 0, -0.65, 0.1, 2.35, 0.1, C.dark);
    m.box(0, 0.45, -0.3, 1.6, 0.08, 0.5, C.wood);
    m.box(-0.7, 0, -0.3, 0.08, 0.45, 0.4, C.dark);
    m.box(0.7, 0, -0.3, 0.08, 0.45, 0.4, C.dark);
    m.box(1.15, 0.2, 0.55, 0.12, 2.2, 0.12, C.grey);
    m.box(1.15, 1.9, 0.55, 0.45, 0.5, 0.06, C.blue);
  },
  dumpster(m) {
    m.box(0, 0.2, 0, 2.1, 0.9, 1.2, C.green, { paint: true, taper: 0.96 });
    m.box(0, 1.1, 0, 2.1, 0.1, 1.2, C.dark);
    m.box(0, 1.2, 0, 2.1, 0.1, 0.5, C.dark);
    for (const x of [-0.8, 0.8]) m.box(x, 0, 0.5, 0.2, 0.2, 0.2, C.rubber);
    m.box(0, 0.5, 0.605, 1.2, 0.08, 0.02, C.chrome);
  },
  hotdog_stand(m) {
    m.box(0, 0.35, 0, 1.4, 0.75, 1.0, C.red, { paint: true });
    m.box(0, 1.1, 0, 1.45, 0.08, 1.05, C.chrome);
    m.cyl(-0.5, 0.35, 0.55, 0.3, 0.3, 0.1, 8, C.rubber, { axis: 'z' });
    m.cyl(0.5, 0.35, 0.55, 0.3, 0.3, 0.1, 8, C.rubber, { axis: 'z' });
    m.box(0.95, 0.3, 0, 0.2, 0.06, 0.8, C.dark);
    for (const x of [-0.8, 0.8]) m.box(x, 1.18, 0, 0.06, 1.0, 0.06, C.chrome);
    m.box(0, 2.0, 0, 2.2, 0.15, 1.2, C.white);
    m.box(0, 2.15, 0, 2.2, 0.15, 0.4, C.red, { paint: true });
    m.box(0.5, 1.18, 0.1, 0.4, 0.15, 0.3, C.orange);
  },
  // ---------------------------------------------------------------- nature
  bush_small(m) {
    blob(m, 0, 0, 0, 1.0, 0.7, 1.0, C.leafDark, { jitter: 0.05, seed: 1 });
    blob(m, 0.18, 0.3, 0.12, 0.6, 0.5, 0.6, C.leaf, {
      seg: 6,
      rings: 4,
      jitter: 0.05,
      seed: 2,
    });
  },
  bush_large(m) {
    blob(m, 0, 0, 0, 1.4, 0.9, 1.4, C.leafDark, { jitter: 0.05, seed: 3 });
    blob(m, 0.05, 0.5, -0.05, 1.0, 0.7, 1.0, C.leaf, { jitter: 0.05, seed: 4 });
    blob(m, -0.4, 0.15, 0.4, 0.6, 0.55, 0.6, C.leaf, {
      seg: 6,
      rings: 4,
      jitter: 0.05,
      seed: 5,
    });
    blob(m, 0.45, 0.2, -0.35, 0.55, 0.5, 0.55, C.leafDark, {
      seg: 6,
      rings: 4,
      jitter: 0.05,
      seed: 6,
    });
  },
  flower_bed(m) {
    m.box(0, 0, 0, 1.2, 0.15, 1.2, C.woodDark);
    m.box(0, 0.15, 0, 1.1, 0.06, 1.1, C.leafDark);
    for (const [x, z, hh] of [
      [-0.35, -0.3, 0.14],
      [0.1, -0.35, 0.1],
      [0.38, -0.05, 0.16],
      [-0.2, 0.1, 0.12],
      [0.25, 0.35, 0.1],
      [-0.4, 0.38, 0.15],
    ])
      blob(m, x, 0.21, z, 0.22, hh + 0.01, 0.22, C.white, {
        paint: true,
        seg: 6,
        rings: 3,
      });
  },
  tree_small(m, v) {
    m.box(0, 0, 0, 0.25, 1.5, 0.25, C.woodDark);
    if (v === 2) {
      // a small pine
      pine(m, 3, 0.9, 0.8, 1.0, 0.8, 0.2, [C.leafDark, C.leaf]);
    } else if (v === 0) {
      // one egg crown
      blob(m, 0, 1.3, 0, 1.6, 2.2, 1.6, C.leaf, {
        taper: 0.22,
        jitter: 0.04,
        seed: 7,
      });
    } else {
      // three balls
      blob(m, 0, 1.2, 0, 1.5, 1.4, 1.5, C.leafDark, { jitter: 0.05, seed: 8 });
      blob(m, 0.2, 2.1, 0.1, 1.2, 1.2, 1.2, C.leaf, { jitter: 0.05, seed: 9 });
      blob(m, -0.25, 2.5, -0.15, 0.9, 1.0, 0.9, C.leaf, {
        seg: 6,
        rings: 4,
        jitter: 0.05,
        seed: 10,
      });
    }
  },
  palm_tree(m) {
    for (let i = 0; i < 4; i++)
      m.cyl(
        i * 0.05,
        i * 1.6,
        0,
        0.18 - i * 0.02,
        0.16 - i * 0.02,
        1.6,
        6,
        i % 2 ? C.woodDark : C.wood,
      );
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      m.xf(
        0.2,
        6.4,
        0,
        () => {
          m.box(0.3, 0, 0, 0.6, 0.07, 0.3, C.leaf);
          m.xf(
            0.6,
            0,
            0,
            () => m.box(0.2, 0, 0, 0.4, 0.06, 0.2, C.leafDark),
            0,
            0,
            -0.6,
          );
        },
        a,
        0,
        0.3,
      );
    }
    for (const [x, z] of [
      [0.06, 0.1],
      [0.34, 0.1],
      [0.2, -0.14],
    ])
      m.ball(x, 6.3, z, 0.13, 0.13, 0.13, C.woodDark, { seg: 6, rings: 3 });
  },
  hedge(m) {
    for (const [x, c, sd] of [
      [-0.55, C.leafDark, 11],
      [0, C.leaf, 12],
      [0.55, C.leafDark, 13],
    ] as const)
      blob(m, x, 0, 0, 1.0, 1.2, 0.8, c, {
        seg: 8,
        rings: 5,
        jitter: 0.04,
        seed: sd,
      });
  },
  tree(m, v) {
    m.box(0, 0, 0, 0.4, 2.4, 0.4, C.woodDark);
    if (v === 2) {
      // a pine: four cones
      pine(m, 4, 1.4, 1.0, 1.6, 1.3, 0.25, [C.leafDark, C.leaf]);
    } else if (v === 0) {
      // stacked balls, big to small
      blob(m, 0, 1.9, 0, 2.6, 2.4, 2.6, C.leaf, { jitter: 0.04, seed: 14 });
      blob(m, 0, 3.4, 0, 2.0, 1.8, 2.0, C.leafDark, { jitter: 0.04, seed: 15 });
      blob(m, 0, 4.7, 0, 1.3, 1.3, 1.3, C.leaf, { jitter: 0.04, seed: 16 });
    } else {
      // a cloud of four
      blob(m, 0, 1.9, 0, 2.2, 2.4, 2.2, C.leafDark, { jitter: 0.05, seed: 17 });
      blob(m, 0.4, 2.6, 0.2, 1.8, 2.2, 1.8, C.leaf, {
        seg: 6,
        rings: 4,
        jitter: 0.05,
        seed: 18,
      });
      blob(m, -0.4, 2.4, -0.25, 1.8, 2.0, 1.8, C.leaf, {
        seg: 6,
        rings: 4,
        jitter: 0.05,
        seed: 19,
      });
      blob(m, 0, 4.3, 0, 1.6, 1.7, 1.6, C.leafDark, { jitter: 0.05, seed: 20 });
    }
  },
  tree_big(m, v) {
    m.box(0, 0, 0, 0.9, 4.2, 0.9, C.woodDark);
    if (v === 1) {
      // a big pine: five cones
      pine(m, 5, 2.2, 1.55, 1.6, 2.75, 0.45, [C.leafDark, C.leaf]);
      return;
    }
    m.box(0, 1.6, 0.45, 0.5, 0.9, 0.3, C.woodDark);
    const o = (seed: number): BallOpts => ({
      seg: 8,
      rings: 5,
      jitter: 0.04,
      seed,
    });
    blob(m, 0, 3.0, 0, 5.5, 3.2, 5.5, C.leafDark, o(21));
    blob(m, 0, 5.2, 0, 4.4, 3.0, 4.4, C.leaf, o(22));
    blob(m, 0, 7.4, 0, 2.8, 2.6, 2.8, C.leafDark, o(23));
    blob(m, 1.9, 3.3, 1.2, 1.7, 1.5, 1.7, C.leaf, {
      seg: 6,
      rings: 4,
      jitter: 0.05,
      seed: 24,
    });
  },
  // ---------------------------------------------------------------- people
  pedestrian(m) {
    m.box(-0.07, 0, 0, 0.13, 0.8, 0.14, C.darkBlue);
    m.box(0.07, 0, 0, 0.13, 0.8, 0.14, C.darkBlue);
    m.box(0, 0.8, 0, 0.34, 0.6, 0.22, C.red, { paint: true });
    m.box(-0.21, 0.82, 0, 0.09, 0.55, 0.13, C.red, { paint: true });
    m.box(0.21, 0.82, 0, 0.09, 0.55, 0.13, C.red, { paint: true });
    m.box(0, 1.4, 0, 0.22, 0.23, 0.22, C.skin);
    m.box(0, 1.6, -0.01, 0.24, 0.15, 0.25, C.hair);
  },
  // ---------------------------------------------------------------- park
  statue(m) {
    m.box(0, 0, 0, 1.3, 0.8, 1.3, C.stone);
    m.box(0, 0.8, 0, 1.0, 0.12, 1.0, C.concrete);
    const bronze = 0x5f8a78;
    m.box(-0.12, 0.92, 0, 0.2, 0.8, 0.22, bronze);
    m.box(0.12, 0.92, 0, 0.2, 0.8, 0.22, bronze);
    m.box(0, 1.72, 0, 0.55, 0.85, 0.32, bronze);
    m.box(-0.38, 1.8, 0, 0.14, 0.7, 0.18, bronze);
    m.box(0.38, 2.15, 0, 0.14, 0.55, 0.18, bronze);
    m.box(0, 2.57, 0, 0.32, 0.34, 0.32, bronze);
    m.box(0.38, 2.7, 0, 0.22, 0.3, 0.22, bronze);
  },
  bench(m) {
    for (let i = 0; i < 3; i++)
      m.box(0, 0.42 + i * 0.001, -0.18 + i * 0.16, 1.8, 0.06, 0.14, C.wood);
    for (let i = 0; i < 2; i++)
      m.box(0, 0.62 + i * 0.14, -0.27, 1.8, 0.1, 0.05, C.wood);
    for (const x of [-0.8, 0.8]) {
      m.box(x, 0, 0, 0.08, 0.45, 0.46, C.dark);
      m.box(x, 0.45, -0.27, 0.08, 0.45, 0.06, C.dark);
    }
  },
  picnic_table(m) {
    m.box(0, 0.72, 0, 1.8, 0.08, 0.8, C.wood);
    for (const z of [-0.6, 0.6]) m.box(0, 0.4, z, 1.8, 0.07, 0.34, C.wood);
    for (const x of [-0.7, 0.7]) {
      m.xf(
        x,
        0,
        -0.32,
        () => m.box(0, 0, 0, 0.08, 0.78, 0.08, C.woodDark),
        0,
        0.5,
      );
      m.xf(
        x + 0.015, // a hair off the other leg so the crossing faces never share a plane
        0,
        0.32,
        () => m.box(0, 0, 0, 0.08, 0.78, 0.08, C.woodDark),
        0,
        -0.5,
      );
    }
  },
  fountain(m) {
    m.cyl(0, 0, 0, 1.5, 1.5, 0.5, 8, C.stone);
    m.cyl(0, 0.46, 0, 1.36, 1.36, 0.06, 8, C.water);
    m.cyl(0, 0.5, 0, 0.3, 0.22, 0.9, 8, C.concrete);
    m.cyl(0, 1.3, 0, 0.55, 0.8, 0.22, 8, C.stone);
    m.cyl(0, 1.5, 0, 0.7, 0.7, 0.03, 8, C.water);
    m.cyl(0, 1.5, 0, 0.1, 0.06, 0.3, 6, C.water);
  },
  playground_slide(m) {
    for (const [x, z] of [
      [-1.4, -0.45],
      [-0.6, -0.45],
      [-0.6, 0.45],
      [-1.4, 0.45],
    ])
      m.box(x, 0, z, 0.1, 2.1, 0.1, C.blue);
    m.box(-1.0, 1.5, 0, 0.95, 0.1, 0.95, C.yellow);
    m.box(-1.0, 2.1, 0, 0.95, 0.1, 0.95, C.red);
    m.xf(
      0.4,
      0.9,
      0,
      () => m.box(0, 0, 0, 2.2, 0.08, 0.7, C.light, { bottom: true }),
      0,
      0,
      -0.65,
    );
    for (const z of [-0.37, 0.37])
      m.xf(
        0.4,
        0.9,
        z,
        () => m.box(0, 0, 0, 2.16, 0.15, 0.06, C.red),
        0,
        0,
        -0.65,
      );
    for (let i = 0; i < 4; i++)
      m.box(-1.45, 0.3 + i * 0.3, 0, 0.06, 0.06, 0.6, C.grey);
  },
  swing_set(m) {
    // A-frame ends: each leg leans from its foot (z = ±0.9) in to the top beam at z = 0;
    // the back leg is a bit thinner so the crossing legs do not share side planes (z-fighting)
    const apex = 2.07;
    const lean = Math.atan2(0.9, apex);
    const leg = Math.hypot(0.9, apex);
    for (const x of [-1.4, 1.4]) {
      for (const s of [-1, 1])
        m.xf(
          x,
          0,
          s * 0.9,
          () => m.box(0, 0, 0, s < 0 ? 0.1 : 0.12, leg, 0.12, C.red),
          0,
          -s * lean,
        );
      m.box(x, 0.8, 0, 0.08, 0.08, 1.1, C.red);
    }
    m.box(0, 2.0, 0, 3.0, 0.14, 0.14, C.red);
    for (const x of [-0.6, 0.6]) {
      m.box(x - 0.2, 0.5, 0, 0.03, 1.5, 0.03, C.dark);
      m.box(x + 0.2, 0.5, 0, 0.03, 1.5, 0.03, C.dark);
      m.box(x, 0.45, 0, 0.5, 0.06, 0.25, C.yellow);
    }
  },
  // ---------------------------------------------------------------- beach
  beach_chair(m) {
    m.box(0.15, 0.2, 0, 0.9, 0.08, 0.6, C.white, { paint: true });
    m.xf(
      -0.54,
      0.47,
      0,
      () => m.box(0, 0, 0, 0.7, 0.08, 0.58, C.white, { paint: true }),
      0,
      0,
      -0.8,
    );
    for (const [x, z] of [
      [0.5, -0.25],
      [0.5, 0.25],
      [-0.1, -0.25],
      [-0.1, 0.25],
    ])
      m.box(x, 0, z, 0.06, 0.22, 0.06, C.dark);
    m.box(0.62, 0.28, 0, 0.35, 0.05, 0.55, C.white);
  },
  beach_umbrella(m) {
    m.cyl(0, 0, 0, 0.04, 0.03, 2.2, 6, C.chrome);
    m.cyl(0, 1.75, 0, 0.95, 0.05, 0.5, 8, C.red, { paint: true });
    m.cyl(0, 2.2, 0, 0.1, 0.02, 0.1, 6, C.white);
    m.cyl(0, 1.7, 0, 0.96, 0.9, 0.06, 8, C.white);
  },
  lifeguard_tower(m) {
    for (const [x, z] of [
      [-1.0, -1.0],
      [1.0, -1.0],
      [1.0, 1.0],
      [-1.0, 1.0],
    ])
      m.box(x, 0, z, 0.2, 2.0, 0.2, C.woodDark);
    m.box(0, 2.0, 0, 2.5, 0.15, 2.5, C.wood);
    m.box(0, 2.15, 0, 1.7, 1.5, 1.7, C.white);
    m.box(0, 2.9, 0.86, 1.2, 0.5, 0.02, C.glassDark);
    m.box(0, 2.15, 0.86, 1.7, 0.4, 0.02, C.red);
    m.box(0, 3.65, 0, 2.5, 0.15, 2.5, C.red);
    m.box(1.1, 3.8, 1.1, 0.05, 0.2, 0.05, C.dark);
    m.box(0, 2.15, 1.2, 1.0, 0.1, 0.6, C.wood);
    m.xf(0, 0, 1.4, () => m.box(0, 0, 0, 0.8, 2.0, 0.08, C.wood), 0, -0.45);
  },
  kiosk_shop(m) {
    m.box(0, 0, 0, 3.6, 2.5, 3.6, C.white, { paint: true });
    m.box(0, 0.9, 1.82, 2.6, 1.1, 0.04, C.glassDark);
    m.box(0, 0.85, 1.9, 2.8, 0.08, 0.6, C.wood);
    m.box(0, 2.5, 0, 4.5, 0.2, 4.5, C.red, { paint: true });
    m.box(0, 2.7, 0, 3.0, 0.4, 3.0, C.white);
    m.box(0, 2.5, 2.25, 4.54, 0.08, 0.1, C.white);
    m.box(0, 2.78, 1.52, 1.6, 0.3, 0.05, C.yellow);
  },
  beach_hut(m) {
    for (const [x, z] of [
      [-2.2, -2.0],
      [2.2, -2.0],
      [2.2, 2.0],
      [-2.2, 2.0],
    ])
      m.box(x, 0, z, 0.25, 0.6, 0.25, C.woodDark);
    m.box(0, 0.6, 0, 5.0, 0.15, 4.6, C.wood);
    for (let i = 0; i < 6; i++)
      m.box(-1.8 + i * 0.72, 0.75, 0, 0.72, 2.1, 3.8, i % 2 ? C.white : C.red, {
        paint: i % 2 === 0,
      });
    m.box(0, 0.75, 1.92, 1.0, 1.6, 0.04, C.woodDark);
    m.box(-1.3, 1.5, 1.92, 0.8, 0.7, 0.04, C.glass);
    m.gable(0, 2.85, 0, 5.5, 5.0, 1.15, C.red, true, C.white);
    m.box(0, 0.75, 2.9, 4.0, 0.08, 1.0, C.wood);
  },
  rowboat(m) {
    m.box(-0.35, 0, 0, 2.7, 0.6, 1.4, C.red, { paint: true });
    m.box(1.4, 0, 0, 0.7, 0.6, 0.8, C.red, { paint: true, taper: 0.4 });
    m.box(-0.35, 0.58, 0, 2.66, 0.06, 1.36, C.white);
    for (const x of [-1.2, -0.3, 0.6])
      m.box(x, 0.64, 0, 0.3, 0.06, 1.3, C.wood);
    for (const z of [-0.6, 0.6]) m.box(0, 0.6, z, 0.1, 0.2, 0.1, C.dark);
  },
};
