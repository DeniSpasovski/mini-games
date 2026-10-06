import type { Builder } from './build-small';
import { Mesher, PAL as C } from './kit';

/** Window box on a facade facing +Z (at depth z). */
function win(
  m: Mesher,
  x: number,
  y: number,
  z: number,
  w = 0.9,
  h = 1.1,
  c: number = C.glassDark,
) {
  m.box(x, y, z, w, h, 0.06, c);
  m.box(x, y - 0.06, z + 0.02, w + 0.2, 0.08, 0.1, C.white);
}

function door(
  m: Mesher,
  x: number,
  z: number,
  w = 1.0,
  h = 2.0,
  c: number = C.woodDark,
) {
  m.box(x, 0, z, w, h, 0.08, c);
  m.box(x, h, z, w + 0.3, 0.1, 0.3, C.dark);
}

interface TowerOpts {
  wall: number;
  /** Plinth (ground floor) height and colour. */
  base?: number;
  baseColor?: number;
  paint?: boolean;
  roofColor?: number;
  /** Skip the roof cap (something bigger sits on top of it). */
  noCap?: boolean;
}

/** Window-tiled tower: plinth + shaft + roof cap. (cx, cz) centre, y0 start. */
function tower(
  m: Mesher,
  cx: number,
  cz: number,
  w: number,
  d: number,
  y0: number,
  h: number,
  o: TowerOpts,
) {
  const base = o.base ?? 0;
  if (base > 0)
    m.box(cx, y0, cz, w + 0.4, base, d + 0.4, o.baseColor ?? C.dark);
  m.box(cx, y0 + base, cz, w, h - base, d, o.wall, {
    wall: true,
    paint: o.paint,
  });
  if (!o.noCap)
    m.box(cx, y0 + h, cz, w + 0.3, 0.35, d + 0.3, o.roofColor ?? C.concrete);
}

export const BUILDING_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- harbour
  water_tower(m) {
    for (const [x, z] of [
      [-2.2, -2.2],
      [2.2, -2.2],
      [2.2, 2.2],
      [-2.2, 2.2],
    ])
      m.box(x, 0, z, 0.4, 8.2, 0.4, C.dark);
    for (const y of [2.5, 5.2]) {
      m.box(0, y, -2.2, 4.4, 0.18, 0.18, C.dark);
      m.box(0, y, 2.2, 4.4, 0.18, 0.18, C.dark);
      // the Z-direction rails are a hair lower so their tops/bottoms never share a plane with the X rails
      m.box(-2.2, y + 0.01, 0, 0.18, 0.16, 4.4, C.dark);
      m.box(2.2, y + 0.01, 0, 0.18, 0.16, 4.4, C.dark);
    }
    m.box(0, 8.0, 0, 5.2, 0.4, 5.2, C.woodDark);
    m.cyl(0, 8.4, 0, 3.0, 3.0, 3.6, 8, C.red);
    m.cyl(0, 10.2, 0, 3.05, 3.05, 0.3, 8, C.darkRed);
    m.cyl(0, 12.0, 0, 3.1, 0.2, 1.8, 8, C.roofGrey);
    m.box(0, 13.8, 0, 0.2, 0.2, 0.2, C.dark);
    m.box(2.5, 0.2, 0, 0.12, 8.0, 0.5, C.chrome);
  },
  lighthouse(m) {
    const bands = [C.white, C.red, C.white, C.red];
    bands.forEach((c, i) =>
      m.cyl(0, i * 4, 0, 3.0 - i * 0.28, 3.0 - (i + 1) * 0.28, 4, 8, c),
    );
    m.cyl(0, 16, 0, 2.4, 2.4, 0.4, 8, C.dark);
    m.cyl(0, 16.4, 0, 1.2, 1.2, 2.2, 8, C.lamp);
    m.cyl(0, 18.6, 0, 1.6, 0, 1.4, 8, C.red);
    m.box(0, 17.2, 0, 0.7, 0.5, 2.6, C.dark);
    m.box(0, 0.4, 2.95, 0.9, 1.6, 0.1, C.woodDark);
  },
  // ---------------------------------------------------------------- houses
  house_small(m, v) {
    m.box(0, 0, 0, 7.6, 3.2, 6.6, C.cream, { paint: true });
    m.box(0, 0, 0, 8.0, 0.3, 7.0, C.stone);
    // variant 1: a gable roof (ridge along X) and the chimney on the other side
    if (v === 1) m.gable(0, 3.2, 0, 8.0, 7.0, 2.8, C.roof, false, C.cream);
    else m.hip(0, 3.2, 0, 8.0, 7.0, 2.8, 0.18, C.roof);
    m.box(v === 1 ? -2.2 : 2.2, 4.5, -1.2, 0.8, 2.0, 0.8, C.brick);
    door(m, -1.4, 3.31);
    win(m, 1.4, 1.1, 3.31);
    win(m, -3.0, 1.1, 3.31, 0.9, 1.1);
    win(m, 3.0, 1.1, 3.31, 0.9, 1.1);
    m.box(-1.4, 0, 3.8, 2.0, 0.25, 1.0, C.concrete);
  },
  house(m, v) {
    m.box(-1.0, 0, 0, 7.5, 5.0, 9.0, C.cream, { paint: true });
    m.box(-1.0, 0, 0, 7.9, 0.3, 9.2, C.stone);
    m.box(3.75, 0, 0.5, 2.0, 2.8, 8.0, C.cream, { paint: true });
    m.box(3.75, 0, 4.6, 1.8, 2.3, 0.1, C.light);
    // variant 1: a gable roof (ridge along X) instead of the hip
    if (v === 1) m.gable(-1.0, 5.0, 0, 8.0, 9.4, 3.0, C.roof, false, C.cream);
    else m.hip(-1.0, 5.0, 0, 8.0, 9.4, 3.0, 0.2, C.roof);
    m.box(3.75, 2.8, 0.5, 2.3, 0.3, 8.3, C.roofGrey);
    m.box(0.5, 6.5, -2.0, 0.9, 2.2, 0.9, C.brick);
    door(m, -2.0, 4.51);
    win(m, 0.8, 1.3, 4.51);
    win(m, -3.8, 1.3, 4.51);
    win(m, -2.0, 3.2, 4.51);
    win(m, 0.8, 3.2, 4.51);
    win(m, -3.8, 3.2, 4.51);
  },
  corner_shop(m) {
    m.box(0, 0, 0, 10, 4.2, 8, C.cream, { paint: true });
    m.box(0, 4.2, 0, 10.3, 0.45, 8.3, C.concrete);
    m.box(-0.5, 0.5, 4.02, 6.0, 2.2, 0.06, C.glassDark);
    door(m, 3.6, 4.04, 1.2, 2.2, C.dark);
    m.box(-0.5, 2.75, 4.5, 6.6, 0.18, 1.6, C.red);
    m.box(-0.5, 2.55, 4.5, 6.6, 0.2, 1.6, C.white, { taper: 0.9 });
    m.box(-0.5, 3.1, 4.04, 4.0, 0.7, 0.1, C.yellow);
    win(m, -4.0, 1.1, 4.02, 0.8, 1.4);
    m.box(2.8, 4.65, -2.0, 1.2, 0.35, 1.2, C.grey);
  },
  townhouse_row(m) {
    const cols = [C.brick, 0xe9c06a, 0x6fa5c7];
    cols.forEach((c, i) => {
      const x = -4 + i * 4;
      // each house a bit taller than the last, so neighbouring roof caps never share a plane
      const h = 7 + i * 0.25;
      const d = 7.6 + i * 0.25; // and a bit deeper, so no two caps share a side plane either
      tower(m, x, 0, 3.9, d, 0, h, { wall: c, roofColor: c });
      m.gable(x, h + 0.35, 0, 4.0, d + 0.2, 1.65, C.roofGrey, false, c);
      door(m, x - 0.8, d / 2 + 0.15, 0.9, 1.9);
    });
  },
  gas_station(m) {
    for (const [x, z] of [
      [-5.2, -3.4],
      [5.2, -3.4],
      [5.2, 3.4],
      [-5.2, 3.4],
    ])
      m.box(x, 0, z, 0.35, 4.4, 0.35, C.white);
    m.box(0, 4.4, 0, 12, 0.6, 9, C.white);
    m.box(0, 4.45, 4.52, 12.04, 0.25, 0.04, C.red);
    for (const x of [-2.5, 2.5]) {
      m.box(x, 0, 0, 0.9, 0.2, 1.8, C.concrete);
      m.box(x, 0.2, 0, 0.5, 1.4, 0.4, C.red);
      m.box(x, 1.0, 0.21, 0.3, 0.3, 0.02, C.glass);
    }
    m.box(0, 0, -3.2, 4.5, 3.0, 3.0, C.cream);
    m.box(0, 0, -3.2, 4.8, 0.2, 3.3, C.stone);
    m.box(0, 0.8, -1.68, 3.2, 1.4, 0.04, C.glassDark);
    m.box(0, 3.0, -3.2, 4.8, 0.3, 3.3, C.red);
  },
  // ---------------------------------------------------------------- mid buildings
  apartment_block(m) {
    tower(m, 0, 0, 14, 12, 0, 13.2, {
      wall: C.brick,
      base: 3.2,
      baseColor: C.dark,
      paint: true,
    });
    m.box(0, 3.2, 6.1, 14.2, 0.3, 0.6, C.concrete);
    door(m, 0, 6.23, 2.0, 2.6, C.dark); // in front of the 0.2 m plinth (z = 6.2)
    m.box(-4, 13.55, -2, 2.5, 1.45, 2.5, C.grey);
    m.box(3.5, 13.55, 2.5, 1.6, 1.0, 1.6, C.grey);
  },
  shop_row(m) {
    tower(m, 0, 0, 14, 10, 0, 7, {
      wall: 0xdcc9a3,
      base: 3.6,
      baseColor: C.dark,
      roofColor: C.stone,
      paint: true,
    });
    const cols = [C.red, C.blue, C.green];
    cols.forEach((c, i) => {
      const x = -4.6 + i * 4.6;
      // the plinth front is at z = 5.2: shop glass and doors go in front of it
      m.box(x, 0.4, 5.23, 3.8, 2.6, 0.06, C.glass);
      m.box(x, 3.0, 5.3, 4.2, 0.3, 0.8, c);
      door(m, x + 1.2, 5.27, 0.9, 2.2, C.dark);
    });
    m.box(0, 7.35, 0, 3.0, 0.65, 3.0, C.grey);
  },
  office_lowrise(m) {
    tower(m, 0, 0, 16, 16, 0, 19.5, {
      wall: C.light,
      base: 4.0,
      baseColor: C.dark,
    });
    m.box(0, 4.0, 8.0, 16.4, 0.4, 1.0, C.white);
    m.box(-4, 19.85, -3, 4.0, 1.6, 4.0, C.grey);
    m.box(4, 19.85, 3, 3.0, 1.2, 3.0, C.grey);
    m.box(0, 19.85, 0, 1.2, 2.15, 1.2, C.dark);
  },
  school(m) {
    tower(m, 0, 0, 16, 12, 0, 5.5, {
      wall: C.brick,
      base: 0.9,
      baseColor: C.stone,
      roofColor: C.stone,
    });
    m.box(0, 5.85, 0, 16.2, 0.2, 12.2, C.roofGrey);
    m.box(0, 5.85, 0, 4.0, 3.15, 4.0, C.brick, { wall: true });
    m.box(0, 6.4, 2.02, 1.8, 1.8, 0.06, C.white);
    m.box(0, 6.45, 2.06, 1.5, 1.5, 0.04, C.lamp);
    door(m, 0, 6.05, 2.4, 2.6, C.dark);
    m.box(0, 8.6, 0, 4.4, 0.45, 4.4, C.concrete);
  },
  parking_garage(m) {
    for (let f = 0; f < 4; f++) {
      m.box(0, f * 3, 0, 19, 0.4, 18, C.light);
      for (const z of [-8.8, 8.8])
        m.box(0, f * 3 + 0.4, z, 19, 0.9, 0.4, C.concrete);
      for (const x of [-9.3, 9.3])
        m.box(x, f * 3 + 0.4, 0, 0.4, 0.9, 17.2, C.concrete);
    }
    m.box(0, 11.6, 0, 19, 0.4, 18, C.light);
    m.box(7, 0, 8.7, 4.0, 3.0, 0.5, C.dark);
    m.box(0, 9.6, 8.95, 7, 1.2, 0.08, C.blue);
    m.box(-6, 4.0, -8.9, 4, 1.4, 0.08, C.yellow);
  },
  apartment_tower(m) {
    tower(m, 0, 0, 18, 18, 0, 34, {
      wall: C.cream,
      base: 4.0,
      baseColor: C.dark,
      paint: true,
    });
    tower(m, 0, 0, 12, 12, 34.35, 5.3, { wall: C.cream, paint: true });
    m.box(0, 40, 0, 0.3, 1.5, 0.3, C.dark);
    m.box(-3, 39.95, -3, 2.5, 0.1, 2.5, C.grey);
  },
  // ---------------------------------------------------------------- skyscrapers
  hotel(m) {
    tower(m, 0, 0, 22, 18, 0, 46, {
      wall: 0xe8d9bf,
      base: 5.0,
      baseColor: C.dark,
    });
    m.box(0, 5.0, 9.4, 22.4, 0.5, 3.0, C.red);
    m.box(0, 46.35, 0, 18, 2.5, 14, C.concrete);
    m.box(0, 48.85, 0, 14, 1.15, 10, C.grey);
    m.box(0, 49.99, 6.2, 12, 0.01, 0.1, C.red);
    m.box(-8.9, 40, 9.1, 0.4, 5.0, 0.4, C.red);
  },
  skyscraper_slim(m) {
    tower(m, 0, 0, 20, 20, 0, 70, {
      wall: 0x9fc4e0,
      base: 4.0,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 14, 14, 70.35, 8, { wall: 0x9fc4e0 });
    m.cyl(0, 78.7, 0, 0.5, 0.2, 1.3, 6, C.chrome);
  },
  skyscraper_glass(m) {
    tower(m, 0, 0, 26, 24, 0, 62, {
      wall: 0x8fb8d8,
      base: 5.0,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 20, 18, 62.35, 22, { wall: 0x8fb8d8 });
    tower(m, 0, 0, 12, 10, 84.7, 5, { wall: 0x8fb8d8 });
    m.cyl(0, 90, 0, 0.4, 0.15, 0.1, 6, C.chrome);
  },
  skyscraper_stepped(m) {
    tower(m, 0, 0, 24, 24, 0, 40, {
      wall: 0xd9c9a8,
      base: 5,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 19, 19, 40.35, 28, { wall: 0xd9c9a8 });
    tower(m, 0, 0, 14, 14, 68.7, 20, { wall: 0xd9c9a8 });
    tower(m, 0, 0, 9, 9, 89.05, 8, { wall: 0xd9c9a8 });
    m.cyl(0, 97.7, 0, 0.8, 0.1, 2.3, 6, C.lamp);
  },
  skyscraper_tall(m) {
    tower(m, 0, 0, 28, 28, 0, 96, {
      wall: C.light,
      base: 6,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 22, 22, 96.35, 16, { wall: C.light });
    tower(m, 0, 0, 14, 14, 112.7, 4, { wall: C.dark });
    m.cyl(0, 116.4, 0, 0.7, 0.2, 3.6, 6, C.chrome);
    m.box(10, 96.35, 10, 3, 2, 3, C.grey);
  },
  skyscraper_twin(m) {
    for (const x of [-9, 9]) {
      tower(m, x, 0, 12, 22, 0, 98, {
        wall: 0x9fc4e0,
        base: 4,
        baseColor: C.dark,
      });
      tower(m, x, 0, 8, 16, 98.35, 8, { wall: 0x9fc4e0 });
    }
    m.box(0, 62, 0, 12, 7, 12, C.chrome);
    m.box(0, 62.2, 0, 12, 6.6, 12.06, C.glassDark);
    m.cyl(-9, 106.7, 0, 0.5, 0.15, 3.3, 6, C.chrome);
    m.cyl(9, 106.7, 0, 0.5, 0.15, 3.3, 6, C.chrome);
  },
  skyscraper_needle(m) {
    tower(m, 0, 0, 22, 22, 0, 12, {
      wall: 0x9fc4e0,
      base: 4,
      baseColor: C.dark,
    });
    m.box(0, 12.35, 0, 20, 70, 20, 0x9fc4e0, { wall: true, taper: 0.7 });
    m.box(0, 82.35, 0, 14, 12, 14, 0x9fc4e0, { wall: true, taper: 0.55 });
    m.cyl(0, 94.35, 0, 3.4, 3.2, 3.0, 8, C.glassDark);
    m.cyl(0, 97.35, 0, 3.4, 0.4, 2.0, 8, C.chrome);
    m.cyl(0, 99.35, 0, 0.5, 0.1, 28.6, 6, C.chrome);
  },
  skyscraper_mega(m) {
    tower(m, 0, 0, 32, 32, 0, 100, {
      wall: 0xb9bfc7,
      base: 6,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 26, 26, 100.35, 24, { wall: 0xb9bfc7 });
    tower(m, 0, 0, 18, 18, 124.7, 10, { wall: C.dark });
    m.cyl(0, 135.05, 0, 5, 5, 0.3, 8, C.yellow);
    m.cyl(0, 135.35, 0, 0.5, 0.2, 4.6, 6, C.chrome);
    m.box(12, 100.35, 12, 4, 3, 4, C.grey);
  },
  landmark_tower(m) {
    tower(m, 0, 0, 34, 30, 0, 14, {
      wall: 0xdad3c3,
      base: 3,
      baseColor: C.dark,
    });
    tower(m, 0, 0, 24, 22, 14.35, 70, { wall: 0xdad3c3 });
    tower(m, 0, 0, 18, 16, 84.7, 26, { wall: 0xdad3c3, noCap: true });
    m.box(0, 110.7, 0, 20, 2, 18, C.red);
    tower(m, 0, 0, 10, 10, 112.9, 12, { wall: 0xdad3c3 });
    m.cyl(0, 125.5, 0, 4.5, 0, 4, 8, C.red);
    m.cyl(0, 129.5, 0, 0.5, 0.1, 5.5, 6, C.chrome);
    m.box(0, 14, 15.1, 30, 0.6, 0.6, C.red);
    m.box(0, 3.2, 15.05, 8, 5.0, 0.2, C.glass);
  },
};
