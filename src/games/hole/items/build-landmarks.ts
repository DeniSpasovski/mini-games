import type { Builder } from './build-small';
import { castle } from './build-toys';
import { plushBuilder } from './build-plush';
import { humanoid } from './build-toyveh';
import { F, STOCK, T, studs, type Frac } from './kit-toy';

/** Toy Emporium landmarks: the atrium centrepieces (tiers 18-25, one or two copies each). */
const mk =
  (fn: (f: Frac, v: number) => void): Builder =>
  (m, v, w, d, h) =>
    fn(F(m, w, d, h), v);

function layers(
  f: Frac,
  n: number,
  color: (i: number) => number,
  inset = 0.03,
): void {
  for (let i = 0; i < n; i++) {
    const k = 1 - (i % 2) * 0.02;
    f.box(
      0,
      (i / n) * 0.94,
      0,
      k - i * inset * 0.1,
      0.94 / n,
      k - i * inset * 0.1,
      color(i),
    );
  }
}

export const LANDMARK_BUILDERS: Record<string, Builder> = {
  brick_tower_display: mk((f) => {
    layers(f, 12, (i) => STOCK[(i >> 1) % 8], 0.2);
    studs(f, 0.94, 3, 3, T.red, false, 0.6, 0.6, 0.06);
    f.box(0, 0.0, 0.5 + 0.01 / f.d, 0.2, 0.12, 0.03, T.yellow);
  }),
  brick_skyscraper_display: mk((f) => {
    f.box(0, 0, 0, 1, 0.45, 1, T.blue);
    f.box(0, 0.45, 0, 0.78, 0.35, 0.78, T.sky);
    f.box(0, 0.8, 0, 0.5, 0.17, 0.5, T.blue);
    f.cyl(0, 0.97, 0, 0.02, 0.01, 0.03, 6, T.red);
    const tiers: [number, number, number, number][] = [
      [0.05, 0.4, 0.5, 0.8],
      [0.47, 0.76, 0.39, 0.6],
      [0.82, 0.95, 0.25, 0.36],
    ];
    for (const [y0, y1, zf, wf] of tiers)
      for (let y = y0; y < y1 - 0.06; y += 0.09)
        for (const sz of [-1, 1])
          f.box(0, y, sz * (zf + 0.012 / f.d), wf, 0.04, 0.02, T.yellow);
  }),
  brick_castle_display: mk((f) => {
    castle(f, T.sand, T.red, 2);
  }),
  giant_gift_box: mk((f) => {
    f.box(0, 0, 0, 1, 0.88, 1, T.red);
    f.box(0, 0.88, 0, 1.04, 0.12, 1.04, T.darkRed);
    f.box(0, 0.0, 0, 0.14, 0.88, 1.03, T.yellow);
    f.box(0, 0.0, 0, 1.03, 0.88, 0.14, T.yellow);
    f.box(0, 0.98, 0, 0.14, 0.02, 1.06, T.yellow);
  }),
  dino_statue_trex: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.stone);
    f.box(0.0, 0.1, 0, 0.55, 0.45, 0.5, T.green);
    f.box(-0.38, 0.14, 0, 0.3, 0.26, 0.3, T.darkGreen, { taper: 0.3 });
    f.box(0.26, 0.45, 0, 0.3, 0.5, 0.4, T.green);
    f.box(0.4, 0.62, 0, 0.2, 0.3, 0.44, T.green);
    for (const z of [-1, 1]) {
      f.box(0.0, 0.1, z * 0.28, 0.2, 0.36, 0.2, T.darkGreen);
      f.box(0.26, 0.46, z * 0.22, 0.1, 0.16, 0.1, T.darkGreen);
    }
    f.box(0.38, 0.88, 0.2 + 0.01 / f.d, 0.04, 0.06, 0.03, T.white);
    for (let i = 0; i < 5; i++)
      f.box(-0.2 + i * 0.12, 0.52, 0, 0.05, 0.14, 0.08, T.orange);
  }),
  dino_statue_brachio: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.stone);
    f.box(-0.08, 0.1, 0, 0.5, 0.3, 0.7, T.darkGreen);
    f.box(0.3, 0.3, 0, 0.12, 0.7, 0.3, T.darkGreen, { taper: 0.5 });
    f.box(0.4, 0.88, 0, 0.18, 0.1, 0.34, T.darkGreen);
    f.box(-0.42, 0.1, 0, 0.3, 0.16, 0.34, T.green, { taper: 0.3 });
    for (const x of [-0.2, 0.15])
      for (const z of [-1, 1]) f.box(x, 0.1, z * 0.3, 0.14, 0.26, 0.2, T.green);
    for (let i = 0; i < 4; i++)
      f.box(-0.2 + i * 0.1, 0.38, 0, 0.05, 0.08, 0.06, T.orange);
  }),
  robot_colossus: mk((f) =>
    humanoid(f, T.blue, T.steelDark, T.yellow, false, 2),
  ),
  robot_titan: mk((f) => {
    humanoid(f, T.red, T.steelDark, T.sky, false, 2);
    for (const sx of [-1, 1])
      f.box(sx * 0.3, 0.9, -0.3, 0.1, 0.1, 0.12, T.yellow);
  }),
  robot_overlord: mk((f) => {
    humanoid(f, T.purple, T.dark, T.lime, false, 2);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.3, 0.7, -0.36, 0.12, 0.28, 0.08, T.steel, { taper: 0.5 });
      f.box(sx * 0.12, 0.96, 0, 0.04, 0.04, 0.04, T.red);
    }
  }),
  landmark_big_ted: (m, _v, w, d, h) => {
    const f = F(m, w, d, h);
    // a stack of colour blocks with Big Ted sitting on top
    f.box(0, 0, 0, 1, 0.14, 1, T.red);
    f.box(0, 0.14, 0, 0.84, 0.12, 0.84, T.blue);
    f.box(0, 0.26, 0, 0.7, 0.1, 0.7, T.yellow);
    const baseH = 0.36 * h;
    m.xf(0, baseH, 0, () =>
      plushBuilder('brown_bear')(m, 0, w * 0.8, d * 0.8, h - baseH),
    );
    f.box(0.0, 0.04, 0.5 + 0.01 / d, 0.4, 0.06, 0.03, T.white);
  },
};
