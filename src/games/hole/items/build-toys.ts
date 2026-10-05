import type { Builder } from './build-small';
import { F, STOCK, T, studs, wheel, type Frac } from './kit-toy';

/**
 * Toy Emporium builders, part 1: bricks, figures, small toys, games, dolls and
 * playhouses, store fixtures. Every recipe works in fractions of w x d x h (see
 * kit-toy.ts), so the built size equals the catalog size.
 */
const mk =
  (fn: (f: Frac, v: number) => void): Builder =>
  (m, v, w, d, h) =>
    fn(F(m, w, d, h), v);

/** Shelf unit facing +Z: back panel, uprights, boards, and stock blocks on each board. */
function shelf(
  f: Frac,
  rows: number,
  kind: 'box' | 'tall' | 'plush' | 'flat',
  palette: number[],
  frame: number = T.light,
  cap: number = T.steel,
): void {
  const n = Math.max(
    2,
    Math.min(10, Math.round(f.w / (kind === 'plush' ? 0.7 : 0.4))),
  );
  f.box(0, 0.02, -0.43, 0.98, 0.98, 0.1, frame);
  f.box(0, 0, 0, 0.96, 0.07, 0.94, T.dark);
  for (const sx of [-1, 1]) f.box(sx * 0.48, 0, 0, 0.04, 1, 1, frame);
  f.box(0, 0.96, 0, 0.92, 0.04, 0.98, cap);
  const usable = 0.86;
  for (let r = 0; r < rows; r++) {
    const y0 = 0.09 + (r * usable) / rows;
    const rh = usable / rows;
    f.box(
      0,
      y0 + (r === 0 ? 0 : 0.0),
      0.02,
      0.92,
      0.03,
      0.9 - r * 0.01,
      T.white,
    );
    for (let i = 0; i < n; i++) {
      const cx = -0.44 + ((i + 0.5) * 0.88) / n;
      const col = palette[(i * 3 + r) % palette.length];
      const bh = rh * (kind === 'tall' ? 0.78 : 0.5 + ((i + r) % 3) * 0.12);
      const bw = (0.88 / n) * (kind === 'plush' ? 0.9 : 0.78);
      const dd = 0.4 + ((i + r) % 3) * 0.05;
      if (kind === 'plush')
        f.puff(cx, y0 + 0.03, -0.05, bw, rh * 0.8, 0.5, col);
      else if (kind === 'flat')
        f.box(cx, y0 + 0.03, 0.0, bw, bh, dd * 0.4, col);
      else f.box(cx, y0 + 0.03, -0.05, bw, bh, dd, col);
    }
  }
}

function openCrate(f: Frac, wall: number, inner: number): void {
  f.box(0, 0, 0, 1, 0.08, 1, wall);
  f.box(0, 0.08, 0.46, 1, 0.5, 0.08, wall);
  f.box(0, 0.08, -0.46, 1, 0.5, 0.08, wall);
  f.box(-0.46, 0.08, 0, 0.08, 0.5, 0.84, wall);
  f.box(0.46, 0.08, 0, 0.08, 0.5, 0.84, wall);
  f.box(0, 0.08, 0, 0.82, 0.4, 0.82, inner);
}

function brickPiece(
  f: Frac,
  nx: number,
  nz: number,
  hasPaint = true,
  bh = 0.78,
): void {
  f.box(0, 0, 0, 1, bh, 1, T.red, { paint: hasPaint });
  studs(
    f,
    bh,
    nx,
    nz,
    T.red,
    hasPaint,
    nx > 1 ? 0.62 : 0,
    nz > 1 ? 0.62 : 0,
    1 - bh,
  );
}

function house(
  f: Frac,
  wall: number,
  roof: number,
  door: number,
  open = false,
): void {
  f.box(0, 0, 0, 1, 0.58, 1, wall);
  f.m.gable(0, 0.58 * f.h, 0, f.w, f.d, 0.42 * f.h, roof);
  f.box(0.05, 0, 0.5 + 0.012 / f.d, 0.2, 0.34, 0.03, door);
  for (const sx of [-1, 1])
    f.box(sx * 0.3, 0.26, 0.5 + 0.012 / f.d, 0.2, 0.22, 0.03, T.sky);
  void open;
}

export const TOY_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- bricks
  brick_2x2: mk((f) => brickPiece(f, 2, 2)),
  brick_2x4: mk((f) => brickPiece(f, 4, 2)),
  brick_plate: mk((f) => {
    f.box(0, 0, 0, 1, 0.5, 1, T.blue, { paint: true });
    studs(f, 0.5, 3, 3, T.blue, true, 0.62, 0.62, 0.5);
  }),
  brick_pile: mk((f) => {
    f.box(0, 0, 0, 1, 0.16, 1, T.cardboardDark);
    const spots: [number, number, number, number, number][] = [
      [-0.25, -0.2, 0.34, 0.5, 0.3],
      [0.25, -0.18, 0.3, 0.36, 0.9],
      [0, 0.22, 0.4, 0.28, 2.0],
      [-0.28, 0.25, 0.26, 0.5, 2.6],
      [0.3, 0.25, 0.26, 0.64, 1.2],
    ];
    spots.forEach(([x, z, s, , r], i) =>
      f.at(
        x,
        0.16,
        z,
        () =>
          f.m.box(
            0,
            0,
            0,
            s * f.w,
            (0.84 - i * 0.07) * f.h,
            s * 0.6 * f.d,
            STOCK[(i * 2) % 8],
          ),
        r,
      ),
    );
  }),
  brick_tub: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.45, 0.82, 8, T.blue);
    f.cyl(0, 0.82, 0, 0.5, 0.5, 0.06, 8, T.yellow);
    for (let i = 0; i < 4; i++)
      f.box(
        ((i % 2) - 0.5) * 0.4,
        0.88,
        (Math.floor(i / 2) - 0.5) * 0.4,
        0.26,
        0.12 - (i % 2) * 0.02,
        0.26,
        STOCK[i + 1],
      );
  }),
  brick_set_box: mk((f, v) => {
    void v;
    f.box(0, 0, 0, 1, 0.8, 1, T.red);
    f.box(0, 0.8, 0, 0.8, 0.2, 0.8, T.yellow);
    f.box(-0.18, 0.8, 0.1, 0.26, 0.2, 0.3, T.blue);
    f.box(0.18, 0.8, -0.1, 0.3, 0.2, 0.26, T.green);
  }),
  brick_set_box_big: mk((f) => {
    f.box(0, 0, 0, 1, 0.78, 1, T.blue);
    f.box(0, 0.78, 0, 0.84, 0.22, 0.84, T.orange);
    f.box(-0.2, 0.78, 0.15, 0.24, 0.22, 0.24, T.red);
    f.box(0.2, 0.78, -0.12, 0.3, 0.22, 0.28, T.yellow);
    f.box(0, 0.78, -0.3, 0.2, 0.22, 0.14, T.green);
  }),
  brick_bin: mk((f) => {
    openCrate(f, T.yellow, T.dark);
    for (let i = 0; i < 9; i++)
      f.box(
        ((i % 3) - 1) * 0.27,
        0.46 + (i % 3) * 0.1,
        (Math.floor(i / 3) - 1) * 0.27,
        0.22,
        0.54 - (i % 3) * 0.1,
        0.22,
        STOCK[i % 8],
      );
  }),
  brick_baseplate_big: mk((f) => {
    f.box(0, 0, 0, 1, 0.4, 1, T.green);
    studs(f, 0.4, 5, 5, T.green, false, 0.84, 0.84, 0.18);
    f.box(-0.22, 0.4, -0.2, 0.34, 0.6, 0.3, T.red);
    f.box(0.2, 0.4, 0.2, 0.3, 0.45, 0.34, T.yellow);
    f.box(0.22, 0.4, -0.25, 0.2, 0.7, 0.2, T.blue);
  }),
  brick_car_small: mk((f) => {
    f.box(0, 0.18, 0, 1, 0.34, 0.9, T.red);
    f.box(-0.06, 0.52, 0, 0.5, 0.36, 0.78, T.sky);
    f.box(-0.06, 0.88, 0, 0.44, 0.12, 0.72, T.red);
    for (const x of [-0.32, 0.32])
      for (const z of [-1, 1]) wheel(f, x, 0.18, z * 0.42, 0.18, 0.12);
  }),
  brick_house_small: mk((f) => {
    for (let i = 0; i < 5; i++)
      f.box(
        0,
        i * 0.1,
        0,
        1 - (i % 2) * 0.02,
        0.1,
        1 - (i % 2) * 0.02,
        i % 2 ? T.brick : T.cream,
      );
    f.box(0, 0.5, 0, 0.98, 0.08, 0.98, T.white);
    f.m.gable(0, 0.58 * f.h, 0, f.w * 1.0, f.d * 1.0, 0.36 * f.h, T.blue);
    studs(f, 0.94, 6, 1, T.blue, false, 0.84, 0, 0.06);
    f.box(0.05, 0, 0.5 + 0.012 / f.d, 0.2, 0.34, 0.03, T.yellow);
  }),
  brick_dragon: mk((f) => {
    f.box(0, 0.08, 0, 0.5, 0.34, 0.7, T.green);
    f.box(-0.32, 0.1, 0, 0.3, 0.2, 0.46, T.darkGreen, { taper: 0.5 });
    f.box(0.32, 0.38, 0, 0.3, 0.3, 0.4, T.green);
    f.box(0.44, 0.5, 0, 0.18, 0.18, 0.3, T.green);
    for (const z of [-1, 1])
      f.box(0.0, 0.44, z * 0.62, 0.34, 0.56, 0.04, T.red, { taper: 0.6 });
    for (let i = 0; i < 4; i++)
      f.box(
        -0.1 + i * 0.12,
        0.42,
        0,
        0.06,
        0.1 + (i % 2) * 0.08,
        0.08,
        T.orange,
      );
    for (const z of [-1, 1])
      for (const x of [-0.2, 0.2])
        f.box(x, 0, z * 0.3, 0.14, 0.12, 0.14, T.darkGreen);
  }),
  brick_car_big: mk((f) => {
    f.box(0, 0.18, 0, 1, 0.3, 0.9, T.yellow);
    f.box(-0.08, 0.48, 0, 0.5, 0.3, 0.76, T.glassDark);
    f.box(-0.08, 0.78, 0, 0.46, 0.22, 0.7, T.yellow);
    f.box(0.38, 0.48, 0, 0.2, 0.12, 0.84, T.orange);
    studs(f, 0.48, 6, 2, T.yellow, false, 0.8, 0.5, 0.1);
    for (const x of [-0.3, 0.32])
      for (const z of [-1, 1]) wheel(f, x, 0.18, z * 0.46, 0.18, 0.1);
  }),
  // ---------------------------------------------------------------- figures
  minifigure: mk((f) => {
    for (const sx of [-1, 1]) f.box(sx * 0.2, 0, 0, 0.36, 0.32, 0.8, T.navy);
    f.box(0, 0.32, 0, 0.84, 0.3, 0.8, T.white, { paint: true });
    for (const sx of [-1, 1])
      f.box(sx * 0.46, 0.34, 0, 0.12, 0.28, 0.5, T.white, { paint: true });
    f.cyl(0, 0.62, 0, 0.36, 0.34, 0.2, 8, T.yellow);
    f.box(0, 0.8, 0, 0.7, 0.14, 0.7, T.hair);
    f.cyl(0, 0.94, 0, 0.12, 0.1, 0.06, 6, T.hair);
  }),
  action_figure: mk((f) => {
    for (const sx of [-1, 1]) f.box(sx * 0.18, 0, 0, 0.3, 0.42, 0.6, T.navy);
    f.box(0, 0.42, 0, 0.7, 0.28, 0.7, T.red);
    for (const sx of [-1, 1]) f.box(sx * 0.42, 0.4, 0, 0.16, 0.3, 0.5, T.skin);
    f.box(0, 0.7, 0, 0.3, 0.22, 0.4, T.skin);
    f.box(0, 0.82, 0.0, 0.34, 0.18, 0.5, T.hair);
    f.box(0, 0.6, -0.4, 0.8, 0.4, 0.08, T.blue);
  }),
  blind_bag: mk((f) => {
    f.box(0, 0, 0, 1, 1, 1, T.purple, { paint: true });
    f.box(0, 0.88, 0.0, 0.9, 0.12, 0.8, T.gold);
    f.box(0, 0.35, 0.5 + 0.1, 0.5, 0.3, 0.2, T.white);
  }),
  dino_figure: mk((f) => {
    f.box(0, 0.12, 0, 0.7, 0.4, 0.7, T.green, { taper: 0.9 });
    f.box(-0.4, 0.14, 0, 0.3, 0.18, 0.3, T.darkGreen, { taper: 0.4 });
    f.box(0.3, 0.45, 0, 0.36, 0.55, 0.5, T.green);
    for (const z of [-1, 1])
      f.box(0.1, 0, z * 0.22, 0.2, 0.24, 0.2, T.darkGreen);
    f.box(0.38, 0.72, 0.26, 0.08, 0.08, 0.04, T.white);
  }),
  animal_figure: mk((f, v) => {
    const body = [T.white, T.rose, T.panda][v % 3];
    f.box(0, 0.25, 0, 0.8, 0.45, 0.6, body);
    f.box(0.4, 0.4, 0, 0.3, 0.6, 0.5, body);
    for (const x of [-0.3, 0.3])
      for (const z of [-1, 1]) f.box(x, 0, z * 0.2, 0.14, 0.26, 0.16, T.dark);
    if (v === 0) f.box(-0.1, 0.5, 0.33, 0.3, 0.2, 0.08, T.black);
    if (v === 1) f.box(0.55, 0.45, 0, 0.1, 0.1, 0.3, T.hotPink);
  }),
  figure_blister_pack: mk((f) => {
    f.box(0, 0, 0, 1, 1, 0.35, T.red);
    f.box(0, 0.14, 0.2, 0.74, 0.72, 0.1, T.plastic);
    f.box(0, 0.2, 0.28, 0.3, 0.55, 0.05, T.navy);
    f.box(0, 0.76, 0.3, 0.8, 0.2, 0.05, T.yellow);
  }),
  figure_display_case: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.wood);
    f.box(0, 0.1, -0.4, 0.96, 0.84, 0.16, T.woodDark);
    for (const sx of [-1, 1])
      f.box(sx * 0.46, 0.1, 0, 0.08, 0.84, 0.9, T.woodDark);
    f.box(0, 0.94, -0.4, 1, 0.06, 0.2, T.wood);
    for (let i = 0; i < 3; i++) {
      f.box(0, 0.28 + i * 0.22, 0.02, 0.84, 0.03, 0.76, T.light);
      for (let k = 0; k < 3; k++)
        f.box(
          -0.28 + k * 0.28,
          0.31 + i * 0.22 + (k % 2) * 0.01,
          0.1 + (k % 2) * 0.1,
          0.14,
          0.16 + (k % 2) * 0.02,
          0.14,
          STOCK[(i * 3 + k) % 8],
        );
    }
  }),
  figure_shelf: mk((f) =>
    shelf(
      f,
      3,
      'tall',
      [T.red, T.blue, T.yellow, T.green, T.orange],
      T.woodDark,
    ),
  ),
  dino_figure_big: mk((f) => {
    f.box(0, 0.12, 0, 0.5, 0.38, 0.6, T.green);
    f.box(-0.38, 0.14, 0, 0.26, 0.16, 0.26, T.darkGreen, { taper: 0.4 });
    f.box(0.26, 0.42, 0, 0.3, 0.55, 0.42, T.green);
    f.box(0.4, 0.62, 0, 0.2, 0.3, 0.36, T.green);
    for (const z of [-1, 1])
      f.box(0.06, 0, z * 0.2, 0.18, 0.18, 0.2, T.darkGreen);
    for (let i = 0; i < 4; i++)
      f.box(
        -0.12 + i * 0.1,
        0.5,
        0,
        0.05,
        0.16 + (i % 2) * 0.1,
        0.07,
        T.orange,
      );
  }),
  figure_gondola: mk((f) =>
    shelf(
      f,
      4,
      'tall',
      [T.red, T.blue, T.yellow, T.green, T.purple, T.orange],
      T.light,
      T.red,
    ),
  ),
  figure_pyramid: mk((f) => {
    f.box(0, 0, 0, 1, 0.3, 1, T.blue);
    f.box(0, 0.3, 0, 0.72, 0.3, 0.72, T.red);
    f.box(0, 0.6, 0, 0.44, 0.3, 0.44, T.yellow);
    f.box(0, 0.9, 0, 0.18, 0.1, 0.18, T.green);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      f.box(
        Math.cos(a) * 0.4,
        0.3,
        Math.sin(a) * 0.4,
        0.1,
        0.2 + (i % 2) * 0.06,
        0.1,
        STOCK[i],
      );
    }
  }),
  dino_diorama: mk((f) => {
    f.box(0, 0, 0, 1, 0.14, 1, T.sand);
    f.box(-0.3, 0.14, -0.2, 0.3, 0.3, 0.3, T.stone);
    f.box(0.3, 0.14, 0.1, 0.34, 0.8, 0.34, T.cocoa, { taper: 0.5 });
    f.puff(0.3, 0.7, 0.1, 0.5, 0.3, 0.5, T.leaf);
    f.box(-0.1, 0.14, 0.25, 0.4, 0.4, 0.5, T.green);
    f.box(0.02, 0.45, 0.25, 0.14, 0.4, 0.18, T.green);
    f.box(-0.32, 0.14, 0.3, 0.3, 0.2, 0.12, T.darkGreen, { taper: 0.4 });
  }),
  // ---------------------------------------------------------------- small toys
  bouncy_ball: mk((f) => {
    f.puff(0, 0, 0, 1, 1, 1, T.red, true);
    f.box(0, 0.4, 0, 1.02, 0.18, 0.7, T.white);
  }),
  alphabet_block: mk((f) => {
    f.box(0, 0, 0, 1, 1, 1, T.yellow);
    f.box(0, 0.3, 0.5 + 0.012 / f.d, 0.4, 0.4, 0.03, T.red);
    f.box(0.5 + 0.012 / f.w, 0.3, 0, 0.03, 0.4, 0.4, T.blue);
  }),
  rubber_duck: mk((f) => {
    f.puff(0, 0, 0, 0.9, 0.5, 1, T.yellow);
    f.puff(0.25, 0.42, 0, 0.5, 0.58, 0.56, T.yellow);
    f.box(0.4, 0.58, 0, 0.2, 0.1, 0.3, T.orange);
    f.box(0.38, 0.74, 0.3 + 0.01 / f.d, 0.08, 0.1, 0.04, T.black);
    f.box(-0.45, 0.2, 0, 0.1, 0.2, 0.4, T.yellow, { taper: 0.6 });
  }),
  packing_peanuts: mk((f) => {
    f.box(0, 0, 0, 1, 0.3, 1, T.cream);
    for (let i = 0; i < 9; i++)
      f.at(
        ((i % 3) - 1) * 0.3,
        0.3,
        (Math.floor(i / 3) - 1) * 0.3,
        () =>
          f.m.box(
            0,
            0,
            0,
            0.22 * f.w,
            (0.5 + (i % 3) * 0.1) * f.h,
            0.12 * f.d,
            i % 2 ? T.white : T.light,
          ),
        i * 0.7,
      );
  }),
  confetti_pile: mk((f) => {
    f.box(0, 0, 0, 1, 0.2, 1, T.pink);
    for (let i = 0; i < 6; i++)
      f.at(
        ((i % 3) - 1) * 0.3,
        0.2,
        (Math.floor(i / 3) - 0.5) * 0.5,
        () => f.m.box(0, 0, 0, 0.22 * f.w, 0.8 * f.h, 0.22 * f.d, STOCK[i]),
        i,
      );
  }),
  balloon_bunch: mk((f) => {
    f.box(0, 0, 0, 0.3, 0.1, 0.3, T.dark);
    f.box(0, 0.1, 0, 0.04, 0.4, 0.04, T.light);
    const pos: [number, number, number][] = [
      [-0.25, 0.5, 0],
      [0.25, 0.52, 0.05],
      [0, 0.62, -0.2],
      [0.02, 0.5, 0.25],
    ];
    pos.forEach(([x, y, z], i) =>
      f.puff(
        x,
        y,
        z,
        0.42,
        0.45 - (i === 2 ? 0.07 : 0),
        0.42,
        i === 0 ? T.red : STOCK[i * 2],
        i === 0,
      ),
    );
  }),
  candy_jar: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.5, 8, T.glass);
    f.cyl(0, 0.5, 0, 0.5, 0.5, 0.05, 8, T.red, { caps: false });
    for (let i = 0; i < 7; i++)
      f.box(
        ((i % 3) - 1) * 0.24,
        0.5 + (i % 3) * 0.08,
        (Math.floor(i / 3) - 0.8) * 0.34,
        0.22,
        0.34 - (i % 3) * 0.08,
        0.22,
        STOCK[i],
      );
    f.cyl(0, 0.92, 0.0, 0.2, 0.2, 0.08, 8, T.red);
  }),
  gumball_machine: mk((f) => {
    f.box(0, 0, 0, 0.8, 0.3, 0.8, T.red);
    f.box(0.02, 0.3, 0.1, 0.4, 0.18, 0.62, T.dark);
    f.cyl(0, 0.48, 0, 0.5, 0.5, 0.12, 8, T.red, { caps: false });
    for (let i = 0; i < 9; i++)
      f.puff(
        ((i % 3) - 1) * 0.28,
        0.5 + (i % 2) * 0.1,
        (Math.floor(i / 3) - 1) * 0.28,
        0.26,
        0.32 - (i % 2) * 0.06,
        0.26,
        STOCK[i % 8],
      );
    f.cyl(0, 0.9, 0, 0.14, 0.12, 0.1, 8, T.red);
  }),
  toy_basket: mk((f) => {
    f.box(0, 0, 0, 1, 0.4, 0.8, T.red, { taper: 1.1 });
    f.box(0, 0.4, 0, 0.12, 0.6, 0.04, T.dark);
    f.box(0, 0.94, 0, 0.9, 0.06, 0.1, T.dark);
    f.box(-0.2, 0.4, 0, 0.3, 0.3, 0.4, T.blue);
    f.puff(0.2, 0.4, 0, 0.3, 0.3, 0.4, T.pink);
  }),
  price_standee: mk((f) => {
    f.box(0, 0, 0, 0.8, 0.06, 1, T.dark);
    f.box(0, 0.06, -0.2, 0.1, 0.4, 0.14, T.steel);
    f.box(0, 0.4, -0.2, 1, 0.6, 0.12, T.yellow);
    f.box(0, 0.5, -0.2 + 0.07 + 0.01 / f.d, 0.7, 0.34, 0.03, T.red);
  }),
  spinner_rack: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.06, 8, T.dark);
    f.cyl(0, 0.06, 0, 0.06, 0.06, 0.84, 6, T.steel);
    for (let i = 0; i < 4; i++) {
      const y = 0.15 + i * 0.2;
      f.box(0, y, 0, 0.9 - i * 0.1, 0.16, 0.9 - i * 0.1, STOCK[(i * 2) % 8]);
      f.box(0, y + 0.16, 0, 0.7 - i * 0.1, 0.03, 0.7 - i * 0.1, T.white);
    }
    f.cyl(0, 0.94, 0, 0.12, 0.12, 0.06, 6, T.red);
  }),
  mascot_standee: mk((f) => {
    f.box(0, 0, 0, 0.9, 0.05, 0.7, T.dark);
    f.box(0, 0.05, 0, 0.7, 0.6, 0.12, T.brown);
    f.box(0, 0.62, 0, 0.8, 0.38, 0.1, T.brown);
    for (const sx of [-1, 1]) f.box(sx * 0.36, 0.9, 0, 0.26, 0.1, 0.1, T.cocoa);
    for (const sx of [-1, 1])
      f.box(sx * 0.2, 0.74, 0.1, 0.1, 0.08, 0.03, T.black);
    f.box(0, 0.64, 0.1, 0.3, 0.12, 0.03, T.tan);
  }),
  // ---------------------------------------------------------------- games
  puzzle_piece: mk((f) => {
    f.box(-0.05, 0, -0.05, 0.7, 1, 0.7, T.blue);
    f.box(0.35, 0, 0, 0.3, 1, 0.3, T.blue);
    f.box(-0.05, 0, 0.35, 0.3, 0.9, 0.3, T.blue);
    f.box(-0.42, 0, -0.1, 0.16, 0.8, 0.26, T.blue);
  }),
  spinning_top: mk((f) => {
    f.cyl(0, 0, 0, 0.04, 0.4, 0.3, 8, T.red);
    f.cyl(0, 0.3, 0, 0.5, 0.5, 0.3, 8, T.yellow);
    f.cyl(0, 0.6, 0, 0.3, 0.1, 0.4, 8, T.blue);
  }),
  jack_in_box: mk((f) => {
    f.box(0, 0, 0, 1, 0.6, 1, T.red);
    f.box(0, 0.6, 0, 0.9, 0.05, 0.9, T.yellow);
    f.box(0, 0.65, 0, 0.1, 0.2, 0.1, T.steel);
    f.puff(0, 0.8, 0, 0.5, 0.2, 0.5, T.yellow);
    f.box(0.0, 0.62, 0.5 + 0.012 / f.d, 0.5, 0.3, 0.03, T.blue);
  }),
  puzzle_box: mk((f) => {
    f.box(0, 0, 0, 1, 0.82, 1, T.blue);
    f.box(-0.2, 0.82, -0.1, 0.4, 0.18, 0.5, T.red);
    f.box(0.22, 0.82, 0.1, 0.4, 0.18, 0.5, T.yellow);
    f.box(0, 0.82, 0.38, 0.5, 0.18, 0.16, T.green);
  }),
  board_game_box: mk((f) => {
    f.box(0, 0, 0, 1, 0.84, 1, T.green);
    f.box(0, 0.84, 0, 0.82, 0.16, 0.84, T.yellow);
    f.box(0.1, 0.84, 0.0, 0.3, 0.16, 0.3, T.red);
  }),
  board_game_stack: mk((f) => {
    const cols = [T.red, T.blue, T.green, T.yellow, T.purple];
    cols.forEach((c, i) =>
      f.box(
        (i % 2) * 0.04,
        i * 0.2,
        0,
        1 - i * 0.05,
        0.19,
        1 - i * 0.07 + (i % 2) * 0.03,
        c,
      ),
    );
  }),
  arcade_cabinet: mk((f) => {
    f.box(0, 0, 0, 1, 0.36, 1, T.navy);
    f.box(0, 0.36, -0.08, 0.96, 0.58, 0.8, T.navy);
    f.box(0, 0.5, 0.3, 0.7, 0.3, 0.1, 0x57d3ff, { glow: true });
    f.box(0, 0.36, 0.34, 0.8, 0.08, 0.34, T.dark);
    f.box(-0.12, 0.44, 0.38, 0.1, 0.05, 0.1, T.red);
    f.box(0.14, 0.44, 0.38, 0.1, 0.05, 0.1, T.yellow);
    f.box(0, 0.94, -0.1, 0.9, 0.06, 0.7, T.pink);
  }),
  giant_dice: mk((f) => {
    f.box(0, 0, 0, 1, 1, 1, T.white);
    for (const [x, z] of [
      [-0.25, -0.25],
      [0.25, 0.25],
      [0, 0],
      [-0.25, 0.25],
      [0.25, -0.25],
    ])
      f.box(x, 1, z, 0.16, 0.01, 0.16, T.red);
    for (const y of [0.25, 0.65])
      f.box(0.25, y, 0.5 + 0.012 / f.d, 0.16, 0.16, 0.03, T.black);
  }),
  chess_table: mk((f) => {
    f.box(0, 0.7, 0, 1, 0.1, 1, T.woodDark);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.42, 0, sz * 0.42, 0.1, 0.7, 0.1, T.woodDark);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        if ((i + j) % 2 === 0)
          f.box(
            -0.36 + i * 0.24,
            0.8,
            -0.36 + j * 0.24,
            0.24,
            0.01,
            0.24,
            T.black,
          );
    f.box(-0.2, 0.81, 0.1, 0.1, 0.19, 0.1, T.white);
    f.box(0.15, 0.81, -0.2, 0.1, 0.19, 0.1, T.black);
  }),
  claw_machine: mk((f) => {
    f.box(0, 0, 0, 1, 0.34, 1, T.purple);
    f.box(0, 0.34, -0.42, 0.9, 0.58, 0.06, 0xcfeaf7);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.46, 0.34, sz * 0.46, 0.08, 0.62, 0.08, T.purple);
    for (const sz of [-1, 1]) f.box(0, 0.92, sz * 0.46, 1, 0.08, 0.08, T.pink);
    for (const sx of [-1, 1])
      f.box(sx * 0.46, 0.92, 0, 0.08, 0.08, 0.84, T.pink);
    for (let i = 0; i < 9; i++)
      f.puff(
        ((i % 3) - 1) * 0.28,
        0.34 + (i % 2) * 0.08,
        (Math.floor(i / 3) - 1) * 0.28,
        0.26,
        0.34 - (i % 2) * 0.06,
        0.26,
        [T.brown, T.panda, T.pink][i % 3],
      );
    f.box(0.1, 0.7, 0, 0.04, 0.2, 0.04, T.steel);
    f.box(0, 0.12, 0.5 + 0.012 / f.d, 0.5, 0.1, 0.03, T.yellow, { glow: true });
    f.box(0, 0.93, 0, 0.3, 0.05, 0.3, 0xfff1a0, { glow: true });
  }),
  pinball_machine: mk((f) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.42, 0, sz * 0.4, 0.12, 0.4, 0.12, T.steel);
    f.box(0, 0.4, 0, 1, 0.24, 1, T.red);
    f.box(0, 0.64, 0.1, 0.9, 0.04, 0.7, T.sky);
    f.box(0, 0.64, -0.5 + 0.1, 0.98, 0.36, 0.2, T.navy, { taper: 0.9 });
    f.box(0, 0.8, -0.38, 0.7, 0.14, 0.04, T.yellow, { glow: true });
    f.box(0, 0.68, 0.0, 0.14, 0.04, 0.14, T.white, { glow: true });
  }),
  foosball_table: mk((f) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.44, 0, sz * 0.4, 0.1, 0.4, 0.14, T.dark);
    f.box(0, 0.4, 0, 1, 0.5, 0.96, T.woodDark);
    f.box(0, 0.9, 0, 0.9, 0.04, 0.84, T.green);
    for (const x of [-0.3, 0, 0.3]) {
      f.box(x, 0.94, 0, 0.03, 0.04, 1.0, T.steel);
      for (const z of [-0.25, 0.25])
        f.box(x, 0.8, z, 0.06, 0.2, 0.1, x < 0 ? T.red : T.blue);
    }
  }),
  floor_puzzle_mat: mk((f) => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++)
        f.box(
          -0.375 + i * 0.25,
          0,
          -0.333 + j * 0.333,
          0.24,
          1,
          0.32,
          STOCK[(i + j * 2) % 8],
        );
  }),
  air_hockey_table: mk((f) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.44, 0, sz * 0.38, 0.1, 0.5, 0.14, T.steel);
    f.box(0, 0.5, 0, 1, 0.34, 0.96, T.navy);
    f.box(0, 0.84, 0, 0.88, 0.04, 0.8, T.sky);
    f.box(0, 0.88, 0, 0.02, 0.08, 0.8, T.white);
    f.box(-0.3, 0.88, 0.1, 0.1, 0.12, 0.1, T.red);
    f.box(0.3, 0.88, -0.1, 0.1, 0.12, 0.1, T.yellow);
  }),
  game_shelf: mk((f) =>
    shelf(
      f,
      4,
      'flat',
      [T.red, T.blue, T.green, T.yellow, T.purple],
      T.woodDark,
      T.wood,
    ),
  ),
  ball_pit: mk((f) => {
    f.box(0, 0, 0, 1, 0.44, 1, T.blue);
    f.box(0, 0.1, 0, 0.9, 0.5, 0.9, T.sky);
    for (let i = 0; i < 16; i++) {
      const x = ((i % 4) - 1.5) * 0.22;
      const z = (Math.floor(i / 4) - 1.5) * 0.22;
      f.puff(
        x,
        0.5 + ((i * 7) % 3) * 0.1,
        z,
        0.2,
        0.5 - ((i * 7) % 3) * 0.1,
        0.2,
        STOCK[i % 8],
      );
    }
    f.box(0, 0.94, 0.48, 0.3, 0.06, 0.04, T.yellow);
  }),
  giant_board_game: mk((f) => {
    f.box(0, 0, 0, 1, 0.6, 1, T.white);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        if ((i + j) % 2 === 0)
          f.box(
            -0.375 + i * 0.25,
            0.6,
            -0.375 + j * 0.25,
            0.24,
            0.4,
            0.24,
            STOCK[(i * 3 + j) % 8],
          );
  }),
  // ---------------------------------------------------------------- dolls
  doll_fashion: mk((f) => {
    f.box(0, 0, 0, 0.7, 0.05, 0.7, T.dark);
    f.box(0, 0.05, 0, 0.18, 0.4, 0.2, T.skin);
    f.box(0, 0.3, 0, 0.7, 0.4, 0.6, T.hotPink, { paint: true, taper: 0.5 });
    f.box(0, 0.6, 0, 0.3, 0.14, 0.26, T.hotPink, { paint: true });
    f.box(0, 0.74, 0, 0.3, 0.14, 0.3, T.skin);
    f.box(0, 0.84, -0.05, 0.4, 0.16, 0.4, T.gold);
    for (const sx of [-1, 1])
      f.box(sx * 0.42, 0.55, 0, 0.1, 0.22, 0.14, T.skin);
  }),
  baby_doll: mk((f) => {
    f.puff(0, 0, 0, 0.8, 0.5, 0.6, T.rose);
    f.puff(0, 0.42, 0.05, 0.6, 0.58, 0.7, T.skin);
    f.box(0, 0.5, 0.4, 0.4, 0.1, 0.03, T.black);
    for (const sx of [-1, 1]) f.box(sx * 0.5, 0.3, 0, 0.1, 0.2, 0.2, T.skin);
  }),
  doll_stroller: mk((f) => {
    f.box(0, 0.3, 0, 0.9, 0.3, 0.7, T.pink);
    f.box(-0.3, 0.6, 0, 0.4, 0.3, 0.7, T.hotPink, { taper: 0.8 });
    f.box(-0.46, 0.6, 0, 0.04, 0.4, 0.8, T.steel);
    f.box(0.45, 0.6, 0.0, 0.1, 0.02, 0.8, T.steel);
    for (const x of [-0.38, 0.38])
      for (const z of [-1, 1]) wheel(f, x, 0.14, z * 0.4, 0.14, 0.08);
  }),
  tea_party_table: mk((f) => {
    f.cyl(0, 0.62, 0, 0.5, 0.5, 0.08, 8, T.pink);
    f.cyl(0, 0, 0, 0.12, 0.2, 0.62, 6, T.white);
    for (const a of [0, 1, 2, 3]) {
      const x = Math.cos(a * 1.57) * 0.34;
      const z = Math.sin(a * 1.57) * 0.34;
      f.box(x, 0.7, z, 0.14, 0.12, 0.14, T.white);
    }
    f.box(0, 0.7, 0, 0.2, 0.3, 0.2, T.hotPink);
    for (const sx of [-1, 1]) f.box(sx * 0.48, 0, 0, 0.12, 0.5, 0.12, T.pink);
  }),
  dollhouse_small: mk((f) => {
    f.box(0, 0, -0.44, 1, 0.58, 0.1, T.cream);
    for (const sx of [-1, 1]) f.box(sx * 0.46, 0, 0, 0.08, 0.58, 1, T.rose);
    f.box(0, 0, 0, 0.84, 0.05, 0.9, T.wood);
    f.m.gable(0, 0.58 * f.h, 0, f.w, f.d, 0.42 * f.h, T.hotPink);
    f.box(-0.2, 0.05, -0.2, 0.3, 0.18, 0.2, T.blue);
    f.box(0.2, 0.05, -0.1, 0.24, 0.26, 0.2, T.green);
    f.box(0, 0.05, 0.5 + 0.01 / f.d, 0.2, 0.3, 0.03, T.yellow);
  }),
  toy_kitchen: mk((f) => {
    f.box(0, 0, 0, 1, 0.5, 0.9, T.teal);
    f.box(0, 0.5, 0, 1.0, 0.04, 0.92, T.white);
    f.box(0, 0.54, -0.4, 1, 0.46, 0.12, T.teal);
    f.box(-0.2, 0.54, 0.0, 0.3, 0.1, 0.3, T.steel);
    f.box(0.2, 0.3, 0.46, 0.4, 0.16, 0.03, T.dark);
    f.box(0, 0.74, -0.34 + 0.02, 0.3, 0.2, 0.03, T.yellow);
    f.box(0.3, 0.54, -0.1, 0.16, 0.12, 0.16, T.red);
  }),
  play_tent: mk((f) => {
    f.box(0, 0, 0, 1, 0.5, 1, T.red, { paint: true, taper: 0.8 });
    f.box(0, 0.5, 0, 0.8, 0.46, 0.8, T.red, { paint: true, taper: 0.1 });
    f.box(0, 0.0, 0.4 + 0.1, 0.3, 0.5, 0.1, T.dark);
    f.box(0, 0.96, 0, 0.04, 0.04, 0.04, T.yellow);
  }),
  dollhouse_large: mk((f) => {
    f.box(0, 0, -0.44, 1, 0.6, 0.1, T.cream);
    for (const sx of [-1, 1]) f.box(sx * 0.46, 0, 0, 0.08, 0.6, 1, T.rose);
    f.box(0, 0.3, 0, 0.84, 0.05, 0.9, T.wood);
    f.box(0, 0, 0, 0.84, 0.05, 0.9, T.wood);
    f.m.gable(0, 0.6 * f.h, 0, f.w, f.d, 0.4 * f.h, T.purple);
    for (const [x, y] of [
      [-0.22, 0.05],
      [0.2, 0.05],
      [-0.2, 0.36],
      [0.22, 0.36],
    ])
      f.box(
        x,
        y,
        -0.2,
        0.26,
        0.12,
        0.2,
        STOCK[(((x + 1) * 10 + y * 5) % 8) | 0],
      );
    f.box(0.0, 0, 0.5 + 0.01 / f.d, 0.2, 0.26, 0.03, T.yellow);
  }),
  toy_castle: mk((f) => castle(f, T.stone, T.red, 1)),
  playhouse_cottage: mk((f) => {
    house(f, T.cream, T.red, T.blue);
    f.box(0.38, 0.5, 0.0, 0.1, 0.3, 0.1, T.brick);
    f.box(0, 0, 0.5 + 0.12, 0.7, 0.04, 0.2, T.wood);
  }),
  dollhouse_mansion: mk((f) => {
    f.box(0, 0, -0.44, 1, 0.64, 0.1, T.cream);
    for (const sx of [-1, 1]) f.box(sx * 0.46, 0, 0, 0.08, 0.64, 1, T.rose);
    for (const y of [0, 0.3]) f.box(0, y, 0, 0.84, 0.05, 0.9, T.wood);
    f.m.gable(0, 0.64 * f.h, 0, f.w, f.d * 0.8, 0.36 * f.h, T.navy);
    for (const sx of [-1, 1])
      f.box(sx * 0.3, 0.64, 0.4, 0.22, 0.2, 0.2, T.cream);
    for (const x of [-0.25, 0.1, 0.3])
      f.box(x, 0.05, -0.2, 0.2, 0.16, 0.2, STOCK[x > 0 ? 2 : 5]);
    f.box(0, 0, 0.5 - 0.01, 0.3, 0.3, 0.03, T.gold);
  }),
  play_castle_big: mk((f) => castle(f, T.sand, T.blue, 2)),
  // ---------------------------------------------------------------- store fixtures
  cardboard_box: mk((f) => {
    f.box(0, 0, 0, 1, 0.9, 1, T.cardboard);
    f.box(0, 0.9, 0, 1, 0.1, 0.4, T.cardboardDark);
    f.box(0, 0.4, 0.5 + 0.01 / f.d, 0.4, 0.2, 0.03, T.white);
  }),
  hand_truck: mk((f) => {
    f.box(0, 0.1, 0.3, 0.9, 0.04, 0.4, T.steel);
    f.box(0, 0.14, -0.4, 0.9, 0.86, 0.08, T.blue);
    for (const sx of [-1, 1])
      f.box(sx * 0.4, 0.14, -0.38, 0.06, 0.86, 0.06, T.steel);
    wheel(f, 0, 0.1, 0.0, 0.1, 0.6, T.rubber, T.steel);
  }),
  shopping_cart_toys: mk((f) => {
    f.box(0, 0.35, 0, 1, 0.4, 0.8, T.steel, { taper: 1.1 });
    f.box(0, 0.35, 0, 0.9, 0.42, 0.7, T.light, { taper: 1.1 });
    f.box(-0.44, 0.75, 0, 0.06, 0.25, 0.8, T.red);
    f.box(0.0, 0.1, 0, 0.8, 0.05, 0.6, T.steel);
    f.puff(-0.15, 0.7, 0, 0.3, 0.2, 0.4, T.brown);
    f.box(0.2, 0.7, 0.05, 0.3, 0.14, 0.3, T.blue);
    for (const x of [-0.35, 0.35])
      for (const z of [-1, 1]) f.box(x, 0, z * 0.32, 0.12, 0.12, 0.12, T.dark);
  }),
  box_stack: mk((f) => {
    f.box(0, 0, 0, 1, 0.34, 1, T.cardboard);
    f.box(0.02, 0.34, 0.02, 0.9, 0.33, 0.9, T.cardboardDark);
    f.box(-0.06, 0.67, -0.03, 0.8, 0.3, 0.76, T.cardboard);
    f.box(0.1, 0.97, 0.1, 0.4, 0.03, 0.4, T.white);
  }),
  pallet_boxes: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.woodDark);
    f.box(0, 0.1, 0, 0.96, 0.05, 0.96, T.wood);
    f.box(-0.02, 0.15, 0, 0.94, 0.5, 0.94, T.cardboard);
    f.box(0.04, 0.65, 0.02, 0.8, 0.35, 0.8, T.cardboardDark);
    f.box(0.3, 0.65, 0.5, 0.2, 0.2, 0.03, T.white);
  }),
  end_cap_display: mk((f) => shelf(f, 3, 'box', STOCK, T.red, T.yellow)),
  display_table: mk((f) => {
    f.box(0, 0.4, 0, 1, 0.1, 1, T.woodDark);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.44, 0, sz * 0.44, 0.1, 0.4, 0.1, T.dark);
    f.box(0, 0.5, 0, 0.96, 0.06, 0.96, T.red);
    for (let i = 0; i < 6; i++)
      f.box(
        ((i % 3) - 1) * 0.3,
        0.56,
        (Math.floor(i / 3) - 0.5) * 0.4,
        0.22,
        0.28 + (i % 3) * 0.1,
        0.22,
        STOCK[i],
      );
  }),
  shipping_crate: mk((f) => {
    f.box(0, 0, 0, 1, 1, 1, T.wood);
    for (const y of [0.0, 0.88]) f.box(0, y, 0, 1.04, 0.12, 1.04, T.woodDark);
    for (const sx of [-1, 1]) f.box(sx * 0.48, 0, 0, 0.1, 1, 1.04, T.woodDark);
    f.box(0, 0.3, 0.5 + 0.03, 0.5, 0.3, 0.02, T.white);
  }),
  gondola_shelf: mk((f, v) => {
    const sets: ['box' | 'tall' | 'plush' | 'flat', number[]][] = [
      ['box', [T.red, T.blue, T.yellow, T.green, T.orange, T.purple]],
      ['tall', [T.green, T.navy, T.red, T.yellow, T.teal]],
      ['plush', [T.brown, T.panda, T.gray, T.pink, T.orange]],
      ['flat', [T.blue, T.red, T.green, T.yellow, T.purple]],
      ['tall', [T.hotPink, T.purple, T.pink, T.sky, T.white]],
    ];
    const [kind, pal] = sets[v % sets.length];
    shelf(f, 4, kind, pal);
  }),
  checkout_counter: mk((f) => {
    f.box(0, 0, 0, 1, 0.8, 0.9, T.blue);
    f.box(0, 0.8, 0, 1.02, 0.06, 0.94, T.white);
    f.box(0.25, 0.86, -0.1, 0.24, 0.14, 0.26, T.dark);
    f.box(0.25, 0.9, 0.04, 0.2, 0.1, 0.03, T.glass);
    f.box(-0.28, 0.86, 0.0, 0.3, 0.1, 0.4, T.red);
    f.box(0.3, 0.2, 0.46, 0.3, 0.26, 0.03, T.yellow);
  }),
  box_pyramid: mk((f) => {
    f.box(0, 0, 0, 1, 0.34, 1, T.cardboard);
    f.box(-0.02, 0.34, 0.02, 0.7, 0.33, 0.7, T.cardboardDark);
    f.box(0.02, 0.67, -0.02, 0.4, 0.33, 0.4, T.cardboard);
    f.box(0.36, 0.34, 0.3, 0.14, 0.2, 0.16, T.cardboardDark);
  }),
  forklift: mk((f) => {
    f.box(-0.1, 0.14, 0, 0.6, 0.3, 0.8, T.yellow);
    f.box(-0.16, 0.44, 0, 0.36, 0.5, 0.74, T.glassDark);
    f.box(-0.16, 0.94, 0, 0.44, 0.06, 0.8, T.yellow);
    f.box(0.36, 0.0, 0, 0.1, 1, 0.7, T.steel);
    for (const z of [-0.24, 0.24]) f.box(0.5, 0, z, 0.3, 0.06, 0.1, T.steel);
    for (const z of [-1, 1]) {
      wheel(f, -0.28, 0.15, z * 0.44, 0.15, 0.12);
      wheel(f, 0.2, 0.12, z * 0.44, 0.12, 0.12);
    }
  }),
  storefront_kiosk: mk((f) => {
    f.box(0, 0, 0, 0.96, 0.46, 0.9, T.yellow);
    f.box(0, 0.46, 0, 0.86, 0.04, 0.8, T.white);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(sx * 0.4, 0.46, sz * 0.36, 0.06, 0.34, 0.06, T.steel);
    f.box(0, 0.8, 0, 1, 0.2, 1, T.red, { taper: 0.9 });
    f.box(0, 0.5, 0.2, 0.7, 0.14, 0.3, T.hotPink);
    f.box(0.3, 0.5, -0.2, 0.2, 0.2, 0.2, T.blue);
  }),
  shelf_run: mk((f) => shelf(f, 3, 'box', STOCK, T.light, T.blue)),
  aisle_shelf_double: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.dark);
    for (const sz of [-1, 1]) {
      f.box(0, 0.1, sz * 0.46, 1, 0.9, 0.06, T.light);
      for (let r = 0; r < 4; r++) {
        f.box(0, 0.18 + r * 0.2, sz * 0.3, 0.98, 0.03, 0.34, T.white);
        for (let i = 0; i < 8; i++)
          f.box(
            -0.44 + i * 0.125,
            0.21 + r * 0.2,
            sz * 0.32,
            0.1,
            0.12 + ((i + r) % 3) * 0.02,
            0.2,
            STOCK[(i + r * 3 + (sz > 0 ? 1 : 0)) % 8],
          );
      }
    }
    f.box(0, 0.94, 0, 0.9, 0.06, 0.4, T.red);
    f.box(0, 0.1, 0, 0.1, 0.84, 0.3, T.steel);
  }),
  // plush fixtures
  plush_wall_shelf: mk((f) =>
    shelf(
      f,
      3,
      'plush',
      [T.brown, T.panda, T.gray, T.pink, T.orange, T.blue],
      T.pink,
      T.hotPink,
    ),
  ),
  plush_pyramid: mk((f) => {
    f.box(0, 0, 0, 1, 0.18, 1, T.pink);
    f.box(0, 0.18, 0, 0.66, 0.1, 0.66, T.hotPink);
    const cols = [
      T.brown,
      T.panda,
      T.gray,
      T.orange,
      T.pink,
      T.blue,
      T.yellow,
      T.green,
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      f.puff(
        Math.cos(a) * 0.34,
        0.18,
        Math.sin(a) * 0.34,
        0.3,
        0.4,
        0.3,
        cols[i],
      );
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      f.puff(
        Math.cos(a) * 0.15,
        0.4,
        Math.sin(a) * 0.15,
        0.28,
        0.34,
        0.28,
        cols[(i + 3) % 8],
      );
    }
    f.puff(0, 0.62, 0, 0.3, 0.38, 0.3, T.panda);
  }),
  plush_throne: mk((f) => {
    f.box(0, 0, 0.08, 0.96, 0.34, 0.8, T.purple);
    f.box(0, 0.34, -0.36, 1, 0.66, 0.26, T.purple);
    for (const sx of [-1, 1])
      f.box(sx * 0.44, 0.34, 0.1, 0.12, 0.3, 0.7, T.hotPink);
    f.box(0, 0.34, 0.08, 0.68, 0.12, 0.6, T.rose);
    f.puff(0, 0.46, 0.0, 0.5, 0.45, 0.4, T.brown);
    f.puff(0, 0.8, 0.0, 0.34, 0.2, 0.3, T.brown);
    f.box(0, 0.94, -0.36, 0.5, 0.06, 0.16, T.gold);
  }),
};

export function castle(
  f: Frac,
  wall: number,
  roof: number,
  kind: number,
): void {
  f.box(0, 0, 0, 0.7, 0.4, 0.7, wall);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      f.box(sx * 0.4, 0, sz * 0.4, 0.2, 0.72, 0.2, wall, { taper: 0.9 });
      f.box(sx * 0.4, 0.72, sz * 0.4, 0.26, 0.16, 0.26, roof, { taper: 0.5 });
      f.box(sx * 0.4, 0.88, sz * 0.4, 0.12, 0.12, 0.12, roof, { taper: 0.1 });
    }
  f.box(0, 0.4, 0, 0.5, 0.3, 0.5, wall);
  f.box(0, 0.7, 0, 0.56, 0.06, 0.56, roof);
  for (let i = 0; i < 4; i++)
    f.box(-0.18 + i * 0.12, 0.76, 0.2, 0.07, 0.06, 0.07, roof);
  f.box(0, 0, 0.35 + 0.012 / f.d, 0.2, 0.26, 0.03, T.woodDark);
  for (const sx of [-1, 1])
    f.box(sx * 0.18, 0.2, 0.35 + 0.012 / f.d, 0.1, 0.12, 0.03, T.glassDark);
  if (kind === 2) {
    f.box(0, 0.4, 0.45, 0.14, 0.02, 0.2, T.wood);
    f.box(0, 0.76, -0.1, 0.1, 0.24, 0.1, wall);
    f.box(0, 0.94, -0.1, 0.16, 0.06, 0.16, roof);
  }
}
