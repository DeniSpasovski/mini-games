import type { Builder } from './build-small';
import { F, STOCK, T, wheel, type Frac } from './kit-toy';

/**
 * Toy Emporium builders, part 2: toy vehicles and rides, fairground, robots,
 * rockets, outdoor / inflatables and the big store trucks. Fractions of w x d x h;
 * vehicles run along X and face +X, robots and floats face +Z (floats along X).
 */
const mk =
  (fn: (f: Frac, v: number) => void): Builder =>
  (m, v, w, d, h) =>
    fn(F(m, w, d, h), v);

interface CarOpts {
  body: number;
  paint?: boolean;
  roof?: number;
  g?: number;
  bodyH?: number;
  cabX?: number;
  cabW?: number;
  cabH?: number;
  r?: number;
  wheelX?: number;
  width?: number;
}

/** Generic toy car: chassis, glass band, roof, four wheels, lights. */
function car(f: Frac, o: CarOpts): void {
  const g = o.g ?? 0.14;
  const bh = o.bodyH ?? 0.32;
  const wd = o.width ?? 0.9;
  const cabX = o.cabX ?? -0.08;
  const cw = o.cabW ?? 0.5;
  const ch = o.cabH ?? 0.3;
  const pa = { paint: o.paint };
  f.box(0, g, 0, 1, bh, wd, o.body, pa);
  f.box(cabX, g + bh, 0, cw, ch, wd * 0.88, T.glassDark);
  f.box(
    cabX,
    g + bh + ch,
    0,
    cw * 0.96,
    1 - (g + bh + ch),
    wd * 0.8,
    o.roof ?? o.body,
    pa,
  );
  const wx = o.wheelX ?? 0.32;
  const r = o.r ?? 0.14;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      wheel(f, sx * wx, r, sz * (wd / 2 - 0.02), r, 0.1);
  for (const sz of [-1, 1])
    f.box(0.5, g + 0.06, sz * wd * 0.3, 0.04, 0.08, 0.14, T.lamp);
  f.box(-0.5, g + 0.06, 0, 0.03, 0.08, wd * 0.6, T.red);
}

function truckBox(
  f: Frac,
  cab: number,
  boxC: number,
  paint = false,
  long = 0.62,
): void {
  const cabW = 1 - long;
  f.box(0.5 - cabW / 2, 0.16, 0, cabW, 0.5, 0.92, cab, { paint });
  f.box(0.5 - cabW * 0.7, 0.4, 0, cabW * 0.5, 0.26, 0.96, T.glassDark);
  f.box(-0.5 + long / 2, 0.16, 0, long, 0.84, 0.96, boxC);
  f.box(-0.5 + long / 2, 0.1, 0, long, 0.08, 0.9, T.dark);
  const wx = [0.5 - cabW * 0.4, -0.5 + long * 0.22];
  for (const x of wx)
    for (const sz of [-1, 1]) wheel(f, x, 0.13, sz * 0.46, 0.13, 0.07);
}

export function humanoid(
  f: Frac,
  body: number,
  trim: number,
  eye: number,
  paint: boolean,
  detail = 0,
): void {
  const pa = { paint };
  for (const sx of [-1, 1]) {
    f.box(sx * 0.2, 0.06, 0, 0.3, 0.32, 0.4, trim);
    f.box(sx * 0.2, 0, 0.1, 0.34, 0.07, 0.62, T.dark);
  }
  f.box(0, 0.36, 0, 0.62, 0.32, 0.7, body, pa);
  f.box(0, 0.4, 0.35 + 0.012 / f.d, 0.3, 0.16, 0.03, T.glass);
  f.box(0, 0.5, 0.35 + 0.012 / f.d, 0.12, 0.08, 0.04, eye, { glow: true });
  for (const sx of [-1, 1]) {
    f.box(sx * 0.4, 0.4, 0, 0.2, 0.26, 0.3, trim);
    f.box(sx * 0.4, 0.2, 0.04, 0.16, 0.2, 0.26, body, pa);
  }
  f.box(0, 0.66, 0, 0.3, 0.1, 0.34, trim);
  f.box(0, 0.74, 0, 0.4, 0.2, 0.42, body, pa);
  f.box(0, 0.8, 0.21 + 0.012 / f.d, 0.3, 0.06, 0.03, eye, { glow: true });
  f.box(0, 0.94, 0, 0.04, 0.06, 0.04, T.red);
  if (detail >= 1) {
    for (const sx of [-1, 1])
      f.box(sx * 0.46, 0.64, -0.08, 0.1, 0.1, 0.2, trim);
    f.box(0, 0.5, -0.4, 0.5, 0.2, 0.1, trim);
  }
  if (detail >= 2) {
    for (const sx of [-1, 1]) {
      f.box(sx * 0.47, 0.5, 0.2, 0.06, 0.1, 0.34, T.dark);
      f.box(sx * 0.2, 0.3, 0.26, 0.14, 0.04, 0.2, eye, { glow: true });
    }
  }
}

function inflatableRing(
  f: Frac,
  color: number,
  paint: boolean,
  hole = 0.5,
): void {
  const t = (1 - hole) / 2;
  f.puff(0, 0, 0.5 - t / 2, 1, 1, t, color, paint);
  f.puff(0, 0, -0.5 + t / 2, 1, 1, t, color, paint);
  f.puff(0.5 - t / 2, 0, 0, t, 1, hole, color, paint);
  f.puff(-0.5 + t / 2, 0, 0, t, 1, hole, color, paint);
}

function floatAnimal(
  f: Frac,
  body: number,
  neck: number,
  head: number,
  beak: number,
  tall: number,
  legs = false,
): void {
  f.puff(-0.05, 0, 0, 0.7, 0.4 * tall, 0.9, body);
  f.puff(0.28, 0.05, 0, 0.34, 0.6, 0.6, neck);
  f.box(-0.4, 0.1, 0, 0.2, 0.3, 0.5, body, { taper: 0.6 });
  f.puff(0.38, 0.5 * tall + 0.25, 0, 0.3, 0.3, 0.46, head);
  f.box(0.5 - 0.06, 0.5 * tall + 0.3, 0, 0.14, 0.1, 0.24, beak);
  f.box(0.34, 0.5 * tall + 0.4, 0.23 + 0.012 / f.d, 0.06, 0.08, 0.03, T.black);
  if (legs)
    for (const z of [-0.2, 0.2]) f.box(0.0, 0, z, 0.06, 0.2, 0.06, T.pink);
}

export const TOYVEH_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- toy vehicles
  toy_car_mini: mk((f) =>
    car(f, {
      body: T.red,
      paint: true,
      g: 0.2,
      bodyH: 0.3,
      cabW: 0.5,
      cabH: 0.2,
      r: 0.2,
      wheelX: 0.3,
    }),
  ),
  toy_truck: mk((f) => truckBox(f, T.red, T.yellow, true)),
  toy_fire_truck: mk((f) => {
    truckBox(f, T.red, T.red, false, 0.7);
    f.box(-0.1, 0.84, 0, 0.7, 0.16, 0.14, T.light);
    f.box(-0.1, 0.4, 0.48 + 0.01 / f.d, 0.4, 0.2, 0.03, T.white);
  }),
  train_engine: mk((f) => {
    f.box(0.2, 0.16, 0, 0.5, 0.42, 0.76, T.blue);
    f.cyl(0.2, 0.58, 0, 0.17, 0.17, 0.3, 8, T.navy, { axis: 'x' });
    f.box(0.4, 0.58, 0, 0.12, 0.3, 0.2, T.dark);
    f.box(-0.12, 0.16, 0, 0.2, 0.54, 0.8, T.red);
    f.box(-0.12, 0.7, 0, 0.26, 0.3, 0.84, T.red);
    f.box(-0.36, 0.16, 0, 0.28, 0.3, 0.8, T.green);
    f.box(-0.4, 0.16, 0, 0.18, 0.5, 0.7, T.yellow, { taper: 0.9 });
    for (const x of [0.32, 0.1, -0.12, -0.38])
      for (const sz of [-1, 1]) wheel(f, x, 0.12, sz * 0.42, 0.12, 0.08);
  }),
  rc_car: mk((f) =>
    car(f, {
      body: T.red,
      paint: true,
      g: 0.18,
      bodyH: 0.26,
      cabX: -0.1,
      cabW: 0.4,
      cabH: 0.26,
      r: 0.2,
    }),
  ),
  rc_monster_truck: mk((f) => {
    f.box(0, 0.3, 0, 0.84, 0.22, 0.7, T.green);
    f.box(-0.06, 0.52, 0, 0.44, 0.2, 0.64, T.glassDark);
    f.box(-0.06, 0.72, 0, 0.42, 0.28, 0.58, T.green);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) wheel(f, sx * 0.34, 0.24, sz * 0.4, 0.24, 0.16);
    f.box(0.42, 0.34, 0, 0.1, 0.12, 0.5, T.yellow);
  }),
  drone: mk((f) => {
    f.box(0, 0.1, 0, 0.3, 0.6, 0.3, T.dark);
    f.box(0, 0.4, 0, 0.2, 0.3, 0.2, T.red);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        f.at(
          sx * 0.2,
          0.2,
          sz * 0.2,
          () =>
            f.m.box(
              0,
              0,
              0,
              0.55 * f.w,
              (sx * sz > 0 ? 0.12 : 0.14) * f.h,
              (sx * sz > 0 ? 0.08 : 0.1) * f.d,
              T.steel,
            ),
          (Math.PI / 4) * sx * sz,
        );
        f.cyl(sx * 0.4, 0.4, sz * 0.4, 0.1, 0.1, 0.2, 8, T.steelDark);
        f.box(sx * 0.4, 0.62, sz * 0.4, 0.18, 0.12, 0.18 + 0.08, T.light);
        f.box(sx * 0.4, 0.74, sz * 0.4, 0.04, 0.26, 0.04, T.dark);
      }
  }),
  rc_helicopter: mk((f) => {
    f.box(0, 0.2, 0, 0.5, 0.4, 0.8, T.red);
    f.box(0.25, 0.28, 0, 0.2, 0.26, 0.7, T.glassDark);
    f.box(-0.42, 0.34, 0, 0.5, 0.16, 0.14, T.red, { taper: 0.5 });
    f.box(-0.65 + 0.2, 0.5, 0, 0.06, 0.26, 0.4, T.red);
    f.cyl(0, 0.6, 0, 0.05, 0.05, 0.16, 6, T.dark);
    f.box(0, 0.96, 0, 0.84, 0.04, 0.1, T.dark);
    f.box(0, 0.8, 0, 0.1, 0.16, 0.1, T.dark);
    for (const sz of [-1, 1]) f.box(0, 0, sz * 0.4, 0.6, 0.08, 0.1, T.dark);
  }),
  toy_plane: mk((f) => {
    f.box(0, 0.2, 0, 0.9, 0.5, 0.22, T.white, { taper: 0.9 });
    f.box(0.1, 0.32, 0, 0.3, 0.3, 0.14, T.glassDark);
    f.box(0.06, 0.28, 0, 0.3, 0.1, 1, T.red, { taper: 0.9 });
    f.box(-0.4, 0.3, 0, 0.18, 0.1, 0.4, T.red);
    f.box(-0.4, 0.45, 0, 0.18, 0.5, 0.06, T.red);
    f.cyl(0.46, 0.35, 0, 0.1, 0.1, 0.1, 6, T.dark, { axis: 'x' });
    f.box(0.4, 0, 0, 0.08, 0.2, 0.06, T.dark);
  }),
  train_set_loop: mk((f) => {
    f.box(0, 0, 0, 1, 0.5, 1, T.green);
    f.box(0, 0.5, 0, 0.8, 0.04, 0.8, T.brown);
    for (const [x, z, w, d] of [
      [0, -0.4, 0.8, 0.06],
      [0, 0.4, 0.8, 0.06],
      [-0.4, 0, 0.06, 0.8],
      [0.4, 0, 0.06, 0.8],
    ])
      f.box(x, 0.54, z, w, 0.04, d, T.steel);
    f.box(-0.1, 0.58, 0.4, 0.3, 0.3, 0.12, T.red);
    f.box(0.18, 0.58, 0.4, 0.2, 0.2, 0.12, T.blue);
    f.puff(-0.2, 0.54, -0.1, 0.2, 0.45, 0.2, T.leaf);
    f.box(0.15, 0.54, -0.12, 0.2, 0.3, 0.2, T.cream);
    f.box(0.15, 0.84, -0.12, 0.22, 0.16, 0.22, T.red, { taper: 0.4 });
  }),
  race_track_set: mk((f) => {
    f.box(0, 0, 0, 1, 0.1, 1, T.dark);
    f.box(0, 0.1, 0.2, 0.9, 0.08, 0.3, T.orange);
    for (let i = 0; i < 5; i++)
      f.box(0.34 - i * 0.17, 0.18, 0.2, 0.06, 0.04, 0.3, T.white);
    f.box(-0.2, 0.18, -0.3, 0.1, 0.4, 0.1, T.yellow);
    f.box(0.15, 0.18, -0.3, 0.1, 0.8, 0.1, T.yellow);
    f.box(-0.02, 0.58, -0.3, 0.5, 0.06, 0.26, T.orange);
    f.box(0.15, 0.94, -0.3, 0.3, 0.06, 0.26, T.orange);
    f.box(-0.3, 0.18, 0.2, 0.2, 0.16, 0.12, T.blue);
  }),
  ride_on_car: mk((f) =>
    car(f, {
      body: T.red,
      paint: true,
      g: 0.16,
      bodyH: 0.32,
      cabX: -0.05,
      cabW: 0.48,
      cabH: 0.26,
      r: 0.16,
    }),
  ),
  ride_on_jeep: mk((f) => {
    f.box(0, 0.2, 0, 1, 0.3, 0.9, T.green, { paint: true });
    f.box(-0.1, 0.5, 0, 0.1, 0.25, 0.86, T.glassDark);
    f.box(0.0, 0.75, 0, 0.6, 0.06, 0.8, T.dark);
    for (const sx of [-0.28, 0.3])
      for (const sz of [-1, 1])
        f.box(sx, 0.5, sz * 0.4, 0.05, 0.5, 0.05, T.dark);
    f.box(-0.26, 0.5, 0, 0.14, 0.18, 0.6, T.dark);
    f.box(0.22, 0.5, 0, 0.1, 0.18, 0.7, T.dark);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) wheel(f, sx * 0.32, 0.16, sz * 0.46, 0.16, 0.1);
    f.box(0.5, 0.26, 0, 0.04, 0.12, 0.5, T.lamp);
    f.box(0.0, 0.8, 0.0, 0.5, 0.2, 0.7, T.yellow, { paint: true, taper: 0.6 });
  }),
  go_kart: mk((f) => {
    f.box(0, 0.12, 0, 1, 0.14, 0.9, T.red, { paint: true });
    f.box(0.38, 0.26, 0, 0.24, 0.12, 0.7, T.red, { paint: true, taper: 0.7 });
    f.box(-0.2, 0.26, 0, 0.3, 0.5, 0.5, T.dark);
    f.box(-0.4, 0.26, 0, 0.1, 0.74, 0.5, T.dark);
    f.box(0.05, 0.4, 0, 0.04, 0.4, 0.04, T.steel);
    f.box(0.02, 0.8, 0, 0.1, 0.2, 0.3, T.steel);
    f.box(-0.45, 0.4, 0, 0.1, 0.12, 0.96, T.dark);
    for (const sx of [-0.34, 0.32])
      for (const sz of [-1, 1]) wheel(f, sx, 0.1, sz * 0.46, 0.1, 0.12);
  }),
  ride_on_fire_engine: mk((f) => {
    truckBox(f, T.red, T.red, false, 0.62);
    f.box(-0.2, 0.84, 0, 0.5, 0.1, 0.2, T.light);
    f.box(-0.2, 0.94, 0, 0.5, 0.06, 0.2, T.steel);
    f.box(0.36, 0.7, 0, 0.12, 0.3, 0.3, T.yellow);
  }),
  ride_on_helicopter: mk((f) => {
    f.box(0, 0.14, 0, 0.5, 0.4, 0.9, T.blue);
    f.box(0.24, 0.24, 0, 0.2, 0.3, 0.8, T.glassDark);
    f.box(-0.4, 0.34, 0, 0.5, 0.16, 0.2, T.blue, { taper: 0.5 });
    f.box(-0.62 + 0.2, 0.5, 0, 0.06, 0.3, 0.4, T.blue);
    f.cyl(0, 0.54, 0, 0.06, 0.06, 0.2, 6, T.dark);
    f.box(0, 0.94, 0, 1, 0.06, 0.12, T.dark);
    f.box(0, 0.74, 0, 0.1, 0.2, 0.1, T.dark);
    for (const sz of [-1, 1]) f.box(0, 0, sz * 0.4, 0.6, 0.08, 0.1, T.dark);
    for (const sz of [-1, 1])
      for (const x of [-0.12, 0.12])
        f.box(x, 0.06, sz * 0.4, 0.04, 0.1, 0.06, T.dark);
  }),
  kiddie_train_ride: mk((f) => {
    f.box(0.34, 0.2, 0, 0.34, 0.4, 0.88, T.red);
    f.cyl(0.4, 0.6, 0, 0.18, 0.18, 0.3, 8, T.darkRed, { axis: 'x' });
    f.box(0.3, 0.6, 0, 0.16, 0.4, 0.4, T.dark);
    f.box(0.2, 0.6, 0, 0.18, 0.4, 0.2, T.yellow);
    for (const x of [-0.05, -0.38]) {
      f.box(x, 0.2, 0, 0.3, 0.36, 0.86, x > -0.2 ? T.blue : T.green);
      f.box(x, 0.56, 0, 0.26, 0.12, 0.84, T.yellow);
    }
    for (const x of [0.4, 0.24, -0.05, -0.38])
      for (const sz of [-1, 1]) wheel(f, x, 0.13, sz * 0.44, 0.13, 0.06);
  }),
  carousel_mini: carousel,
  carousel_big: carousel,
  ferris_wheel_mini: ferris,
  ferris_wheel_giant: ferris,
  railway_table: mk((f) => railway(f, 3)),
  model_railway: mk((f) => railway(f, 6)),
  railway_world: mk((f) => railway(f, 9)),
  // ---------------------------------------------------------------- robots
  wind_up_robot: mk((f) => {
    for (const sx of [-1, 1]) f.box(sx * 0.2, 0, 0, 0.3, 0.18, 0.5, T.steel);
    f.box(0, 0.18, 0, 0.8, 0.38, 0.8, T.steel);
    f.box(0, 0.3, 0.4 + 0.012 / f.d, 0.4, 0.12, 0.03, T.red);
    f.box(0, 0.56, 0, 0.6, 0.3, 0.6, T.steelDark);
    f.box(0, 0.62, 0.3 + 0.012 / f.d, 0.4, 0.1, 0.03, T.yellow);
    f.box(0, 0.86, 0, 0.08, 0.14, 0.08, T.red);
    f.box(-0.52 + 0.1, 0.34, 0, 0.1, 0.5, 0.1, T.gold);
    f.box(-0.45, 0.6, 0, 0.1, 0.1, 0.4, T.gold);
    for (const sx of [-1, 1])
      f.box(sx * 0.48, 0.28, 0, 0.1, 0.3, 0.26, T.steel);
  }),
  robot_toy: mk((f) => humanoid(f, T.red, T.steel, T.yellow, true)),
  robot_action: mk((f) => humanoid(f, T.blue, T.light, T.lime, false, 1)),
  robot_big: mk((f) => humanoid(f, T.orange, T.steelDark, T.sky, true, 2)),
  robot_giant: mk((f) => humanoid(f, T.teal, T.steelDark, T.yellow, false, 2)),
  robot_mech_walker: mk((f) => {
    for (const sx of [-1, 1]) {
      f.box(sx * 0.28, 0.0, 0.05, 0.3, 0.1, 0.6, T.dark);
      f.box(sx * 0.28, 0.1, 0, 0.12, 0.4, 0.14, T.steel);
      f.box(sx * 0.28, 0.4, 0.1, 0.14, 0.1, 0.34, T.steelDark);
    }
    f.box(0, 0.5, 0, 0.8, 0.28, 0.9, T.green);
    f.box(0, 0.78, 0, 0.5, 0.22, 0.6, T.glassDark);
    f.box(0, 0.98, 0, 0.56, 0.02, 0.66, T.green);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.46, 0.6, 0.1, 0.1, 0.1, 0.5, T.dark);
      f.box(sx * 0.46, 0.54, 0.3, 0.08, 0.2, 0.08, T.yellow);
    }
  }),
  robot_dog: mk((f) => {
    f.box(0, 0.35, 0, 0.7, 0.3, 0.6, T.steel);
    f.box(0.32, 0.5, 0, 0.28, 0.45, 0.46, T.steelDark);
    f.box(0.46, 0.7, 0, 0.18, 0.1, 0.4, T.red);
    f.box(0.4, 0.82, 0.22 + 0.01 / f.d, 0.06, 0.08, 0.03, T.lime);
    f.box(-0.5 + 0.1, 0.5, 0, 0.1, 0.5, 0.06, T.dark);
    for (const x of [-0.25, 0.25])
      for (const sz of [-1, 1]) {
        f.box(x, 0, sz * 0.2, 0.12, 0.36, 0.12, T.dark);
        f.box(x + 0.04, 0, sz * 0.2, 0.18, 0.06, 0.18, T.red);
      }
  }),
  robo_truck: mk((f) => {
    truckBox(f, T.blue, T.red, false, 0.55);
    f.box(0.0, 0.8, 0, 0.5, 0.14, 0.7, T.steelDark);
    f.box(-0.1, 0.94, 0, 0.16, 0.06, 0.2, T.yellow);
    for (const sz of [-1, 1])
      f.box(-0.2, 0.7, sz * 0.5, 0.14, 0.2, 0.08, T.steel);
    f.box(0.44, 0.7, 0.0, 0.1, 0.26, 0.5, T.glass);
  }),
  rocket_display: rocket,
  rocket_big: rocket,
  rocket_giant: rocket,
  spaceship_display: mk((f) => {
    f.box(0, 0.1, 0, 0.9, 0.3, 0.5, T.light, { taper: 0.8 });
    f.box(0.38, 0.2, 0, 0.3, 0.2, 0.3, T.light, { taper: 0.5 });
    f.box(0, 0.4, 0, 0.5, 0.3, 0.3, T.glassDark);
    f.box(0, 0.7, 0, 0.4, 0.3, 0.24, T.light);
    for (const sz of [-1, 1]) {
      f.box(-0.2, 0.15, sz * 0.4, 0.5, 0.1, 0.2, T.red, { taper: 0.5 });
      f.box(-0.45, 0, sz * 0.2, 0.1, 0.5, 0.1, T.steel);
    }
    f.box(-0.4, 0.2, 0, 0.2, 0.18, 0.4, T.orange);
    f.box(0, 0.98, 0, 0.04, 0.02, 0.04, T.red);
  }),
  // ---------------------------------------------------------------- outdoor / inflatables
  beach_ball: mk((f) => {
    f.puff(0, 0, 0, 1, 1, 1, T.red, true);
    f.box(0, 0.38, 0, 1.02, 0.24, 0.6, T.white);
    f.box(0, 0.1, 0, 0.5, 0.8, 1.02, T.yellow);
  }),
  water_gun: mk((f) => {
    f.box(0, 0.4, 0, 1, 0.34, 0.5, T.sky);
    f.box(0.4, 0.5, 0, 0.2, 0.14, 0.3, T.blue);
    f.box(-0.3, 0, 0, 0.2, 0.4, 0.44, T.blue);
    f.box(0, 0.74, 0, 0.5, 0.26, 0.4, T.yellow);
    f.box(0.1, 0.2, 0, 0.1, 0.2, 0.1, T.dark);
  }),
  sand_bucket: mk((f) => {
    f.cyl(0, 0, 0, 0.36, 0.5, 0.8, 8, T.red);
    f.cyl(0, 0.8, 0, 0.5, 0.5, 0.06, 8, T.darkRed, { caps: false });
    f.box(0, 0.86, 0, 0.9, 0.14, 0.04, T.yellow);
    f.box(0.4, 0.2, 0.0, 0.2, 0.55, 0.04, T.blue);
  }),
  skateboard: mk((f) => {
    f.box(0, 0.3, 0, 1, 0.3, 0.4, T.purple);
    f.box(0, 0.6, 0, 0.7, 0.36, 0.34, T.orange);
    for (const x of [-0.32, 0.32]) {
      f.box(x, 0.1, 0, 0.14, 0.2, 0.7, T.steel);
      for (const sz of [-1, 1]) wheel(f, x, 0.1, sz * 0.5, 0.1, 0.16);
    }
    f.box(0, 0.96, 0, 0.5, 0.04, 0.2, T.white);
  }),
  soccer_ball: mk((f) => {
    f.puff(0, 0, 0, 1, 1, 1, T.white);
    for (const [x, y, z] of [
      [0, 0.8, 0],
      [0.3, 0.4, 0.5],
      [-0.3, 0.3, 0.5],
      [0.5, 0.5, -0.2],
    ])
      f.box(x, y, z, 0.24, 0.2, 0.24, T.black);
  }),
  tricycle: mk((f) => {
    f.box(-0.2, 0.4, 0, 0.14, 0.2, 0.2, T.red);
    f.box(0, 0.4, 0, 0.5, 0.1, 0.12, T.red);
    f.box(0.3, 0.4, 0, 0.1, 0.6, 0.14, T.red);
    f.box(0.3, 0.9, 0, 0.12, 0.1, 0.8, T.dark);
    f.box(-0.28, 0.6, 0, 0.3, 0.1, 0.3, T.dark);
    wheel(f, 0.4, 0.2, 0, 0.2, 0.1);
    for (const sz of [-1, 1]) wheel(f, -0.4, 0.14, sz * 0.4, 0.14, 0.1);
    f.box(-0.4, 0.14, 0, 0.04, 0.04, 0.8, T.steel);
  }),
  kick_scooter: mk((f) => {
    f.box(-0.1, 0.1, 0, 0.8, 0.08, 0.5, T.blue);
    f.box(0.42, 0.18, 0, 0.06, 0.62, 0.1, T.steel);
    f.box(0.42, 0.9, 0, 0.1, 0.1, 0.9, T.dark);
    wheel(f, 0.44, 0.08, 0, 0.08, 0.4);
    wheel(f, -0.46, 0.08, 0, 0.08, 0.4);
  }),
  swim_ring: mk((f) => {
    inflatableRing(f, T.red, true);
    for (const [x, z] of [
      [0, 0.4],
      [0, -0.4],
      [0.4, 0],
      [-0.4, 0],
    ])
      f.box(x, 0.98, z, 0.14, 0.02, 0.14, T.white);
  }),
  ball_bin: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.5, 8, T.blue);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      f.puff(
        Math.cos(a) * 0.25,
        0.4,
        Math.sin(a) * 0.25,
        0.3,
        0.6,
        0.3,
        STOCK[i],
      );
    }
    f.puff(0, 0.6, 0, 0.3, 0.4, 0.3, T.yellow);
  }),
  bike_kids: mk((f) => {
    wheel(f, 0.36, 0.22, 0, 0.22, 0.2, T.rubber, T.light);
    wheel(f, -0.36, 0.22, 0, 0.22, 0.2, T.rubber, T.light);
    f.box(0, 0.4, 0, 0.7, 0.08, 0.1, T.red, { paint: true });
    f.box(0.3, 0.4, 0, 0.06, 0.4, 0.1, T.red, { paint: true });
    f.box(-0.12, 0.4, 0, 0.06, 0.34, 0.1, T.red, { paint: true });
    f.box(-0.16, 0.74, 0, 0.2, 0.08, 0.3, T.dark);
    f.box(0.32, 0.86, 0, 0.1, 0.1, 0.9, T.dark);
  }),
  pool_float_duck: mk((f) =>
    floatAnimal(f, T.yellow, T.yellow, T.yellow, T.orange, 1),
  ),
  pool_float_swan: mk((f) => {
    f.puff(-0.1, 0, 0, 0.7, 0.34, 0.9, T.white);
    f.box(-0.45, 0.1, 0, 0.14, 0.3, 0.6, T.white, { taper: 0.6 });
    f.puff(0.2, 0.2, 0, 0.18, 0.7, 0.24, T.white);
    f.puff(0.38, 0.72, 0, 0.3, 0.28, 0.3, T.white);
    f.box(0.5 - 0.06, 0.78, 0, 0.12, 0.08, 0.14, T.orange);
    f.box(0.4, 0.84, 0.15 + 0.01 / f.d, 0.04, 0.06, 0.03, T.black);
  }),
  pool_float_flamingo: mk((f) => {
    f.puff(-0.1, 0, 0, 0.7, 0.34, 0.9, T.hotPink);
    f.box(-0.45, 0.08, 0, 0.14, 0.26, 0.5, T.hotPink, { taper: 0.6 });
    f.puff(0.22, 0.2, 0, 0.16, 0.64, 0.22, T.hotPink);
    f.puff(0.36, 0.68, 0, 0.28, 0.24, 0.28, T.hotPink);
    f.box(0.5 - 0.07, 0.72, 0, 0.14, 0.08, 0.12, T.black);
    f.box(0.4, 0.8, 0.14 + 0.01 / f.d, 0.04, 0.06, 0.03, T.black);
    f.box(0.36, 0.92, 0, 0.08, 0.08, 0.08, T.rose);
  }),
  pool_float_donut: mk((f) => {
    inflatableRing(f, T.pink, true, 0.34);
    for (const [x, z, c] of [
      [0, 0.4, T.yellow],
      [0, -0.4, T.sky],
      [0.4, 0, T.lime],
      [-0.4, 0, T.white],
      [0.3, 0.3, T.orange],
    ] as [number, number, number][])
      f.box(x, 0.98, z, 0.1, 0.02, 0.07, c);
  }),
  pool_float_unicorn: mk((f) => {
    f.puff(-0.1, 0, 0, 0.7, 0.34, 0.9, T.white);
    f.box(-0.45, 0.08, 0, 0.14, 0.26, 0.5, T.purple, { taper: 0.6 });
    f.puff(0.24, 0.2, 0, 0.2, 0.6, 0.26, T.white);
    f.puff(0.38, 0.55, 0, 0.3, 0.26, 0.4, T.white);
    f.cyl(0.4, 0.78, 0, 0.05, 0.005, 0.22, 6, T.gold);
    f.box(0.22, 0.56, 0, 0.1, 0.38, 0.14, T.hotPink);
    f.box(0.32, 0.64, 0.2 + 0.01 / f.d, 0.04, 0.06, 0.03, T.black);
  }),
  paddling_pool: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.9, 8, T.sky);
    f.cyl(0, 0.9, 0, 0.5, 0.5, 0.1, 8, T.blue, { caps: false });
    f.cyl(0, 0.4, 0, 0.44, 0.44, 0.3, 8, T.water);
  }),
  kids_goal: mk((f) => {
    for (const sx of [-1, 1]) f.box(sx * 0.48, 0, 0, 0.04, 1, 0.1, T.white);
    f.box(0, 0.94, 0, 1, 0.06, 0.1, T.white);
    f.box(0, 0.5, -0.4, 0.9, 0.44, 0.06, T.light);
    for (const sx of [-1, 1])
      f.box(sx * 0.48, 0, -0.45, 0.04, 0.9, 0.1, T.light);
    f.box(0, 0, -0.45, 1, 0.04, 0.1, T.light);
  }),
  inflatable_raft: mk((f) => raft(f, true)),
  raft_family: mk((f) => raft(f, false)),
  inflatable_kayak: mk((f) => {
    f.puff(0, 0, 0, 0.7, 1, 0.9, T.yellow);
    for (const sx of [-1, 1])
      f.box(sx * 0.4, 0, 0, 0.2, 0.7, 0.6, T.yellow, { taper: 0.4 });
    f.box(0, 0.6, 0, 0.3, 0.2, 0.5, T.dark);
    f.box(0.04, 0.78, 0, 0.04, 0.2, 1.0, T.steel);
  }),
  trampoline: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.5, 8, T.dark, { caps: false });
    f.cyl(0, 0.5, 0, 0.5, 0.5, 0.1, 8, T.blue);
    f.cyl(0, 0.6, 0, 0.42, 0.42, 0.04, 8, T.black);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      f.box(
        Math.cos(a) * 0.46,
        0.6,
        Math.sin(a) * 0.46,
        0.04,
        0.4,
        0.04,
        T.steel,
      );
    }
  }),
  backyard_slide: mk((f) => {
    f.box(-0.38, 0, 0, 0.24, 1, 0.8, T.yellow);
    f.box(-0.38, 0.9, 0, 0.3, 0.1, 0.9, T.red);
    f.box(0.05, 0.3, 0, 0.8, 0.1, 0.5, T.blue, { taper: 0.9 });
    f.box(0.4, 0.08, 0, 0.2, 0.2, 0.5, T.blue);
    for (const sz of [-1, 1])
      f.box(0.0, 0.4, sz * 0.27, 0.8, 0.06, 0.05, T.red);
  }),
  bounce_house: mk((f) => {
    f.puff(0, 0, 0, 0.9, 0.5, 0.9, T.red, true);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        f.puff(sx * 0.4, 0, sz * 0.4, 0.3, 0.9, 0.3, T.yellow);
        f.box(sx * 0.4, 0.8, sz * 0.4, 0.34, 0.2, 0.34, T.blue, { taper: 0.4 });
      }
    f.box(0, 0.5, 0.0, 0.9, 0.34, 0.7, T.sky, { taper: 0.9 });
    f.box(0, 0.1, 0.5 + 0.01 / f.d, 0.3, 0.3, 0.03, T.dark);
  }),
  pool_float_whale: mk((f) => {
    f.puff(-0.04, 0, 0, 0.84, 0.64, 0.9, T.blue);
    f.box(0.02, 0, 0, 0.74, 0.3, 0.97, 0xdceaff);
    f.box(-0.4, 0.4, 0, 0.18, 0.58, 0.12, T.blue, { taper: 0.6 });
    f.box(-0.42, 0.88, 0, 0.14, 0.12, 0.62, T.blue);
    for (const sz of [-1, 1])
      f.box(0.43, 0.46, sz * 0.4, 0.06, 0.1, 0.06, T.white);
    f.box(0.26, 0.62, 0, 0.1, 0.3, 0.1, 0x9cd3ff);
  }),
  inflatable_pool_big: mk((f) => {
    f.cyl(0, 0, 0, 0.5, 0.5, 0.8, 8, T.sky);
    f.cyl(0, 0.8, 0, 0.5, 0.5, 0.2, 8, T.blue, { caps: false });
    f.cyl(0, 0.5, 0, 0.44, 0.44, 0.2, 8, T.water);
  }),
  giant_inflatable_slide: mk((f) => {
    f.puff(-0.3, 0, 0, 0.4, 1, 0.9, T.red);
    f.puff(-0.34, 0.8, 0, 0.5, 0.2, 0.96, T.yellow);
    f.box(0.12, 0.2, 0, 0.8, 0.14, 0.5, T.blue, { taper: 0.9 });
    for (const sz of [-1, 1])
      f.puff(0.12, 0.2, sz * 0.3, 0.8, 0.4, 0.14, T.yellow);
    f.puff(0.44, 0, 0, 0.18, 0.2, 0.7, T.yellow);
  }),
  // ---------------------------------------------------------------- store trucks
  delivery_truck_box: mk((f) => {
    truckBox(f, T.blue, T.white, false, 0.72);
    f.box(-0.14, 0.4, 0.48 + 0.012 / f.d, 0.5, 0.3, 0.03, T.red);
    f.box(-0.14, 0.4, -0.48 - 0.012 / f.d, 0.5, 0.3, 0.03, T.red);
  }),
  shipping_container: mk((f) => {
    f.box(0, 0, 0, 1, 1, 1, T.blue);
    for (let i = 0; i < 8; i++)
      for (const sz of [-1, 1])
        f.box(
          -0.44 + i * 0.125,
          0.04,
          sz * (0.5 + 0.008),
          0.06,
          0.92,
          0.016,
          T.navy,
        );
    for (const sx of [-1, 1]) f.box(sx * 0.5, 0, 0, 0.03, 1, 0.96, T.navy);
  }),
  semi_trailer: mk((f) => {
    f.box(0.4, 0.14, 0, 0.2, 0.5, 0.9, T.red);
    f.box(0.36, 0.4, 0, 0.1, 0.26, 0.94, T.glassDark);
    f.box(-0.1, 0.14, 0, 0.78, 0.86, 0.96, T.white);
    f.box(-0.1, 0.08, 0, 0.78, 0.06, 0.9, T.dark);
    for (const x of [0.38, -0.34, -0.2])
      for (const sz of [-1, 1]) wheel(f, x, 0.12, sz * 0.46, 0.12, 0.06);
    f.box(-0.1, 0.4, 0.49 + 0.01 / f.d, 0.5, 0.3, 0.03, T.red);
  }),
};

function carousel(
  m: Parameters<Builder>[0],
  _v: number,
  w: number,
  d: number,
  h: number,
): void {
  const f = F(m, w, d, h);
  f.cyl(0, 0, 0, 0.5, 0.5, 0.1, 8, T.pink);
  f.cyl(0, 0.1, 0, 0.46, 0.46, 0.04, 8, T.gold);
  f.cyl(0, 0.14, 0, 0.12, 0.12, 0.7, 6, T.gold);
  f.cyl(0, 0.74, 0, 0.5, 0, 0.26, 8, T.red);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.34;
    const z = Math.sin(a) * 0.34;
    f.box(x, 0.14, z, 0.04, 0.6, 0.04, T.gold);
    f.at(
      x,
      0.26,
      z,
      () => {
        f.m.box(0, 0, 0, 0.18 * f.w, 0.18 * f.h, 0.07 * f.d, STOCK[i], {});
        f.m.box(
          0.07 * f.w,
          0.1 * f.h,
          0,
          0.08 * f.w,
          0.12 * f.h,
          0.06 * f.d,
          STOCK[i],
        );
      },
      a + Math.PI / 2,
    );
  }
}

function ferris(
  m: Parameters<Builder>[0],
  _v: number,
  w: number,
  d: number,
  h: number,
): void {
  const R = Math.min(w * 0.48, h * 0.42);
  const hub = h - R - 0.02 * h;
  const f = F(m, w, d, h);
  const tz = (z: number) => z * d;
  // base + A-frame legs
  f.box(0, 0, 0, 0.9, 0.04, 0.8, T.steelDark);
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1])
      m.xf(
        sx * 0.2 * w,
        0.01 * w,
        tz(sz * 0.42),
        () => m.box(0, 0, 0, 0.04 * w, hub, 0.05 * d, T.steel),
        0,
        0,
        -sx * 0.22,
      );
  }
  // wheel: two rims of 12 segments + spokes + gondolas
  const seg = 12;
  for (const sz of [-0.42, 0.42]) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = Math.cos(a) * R;
      const cy = Math.sin(a) * R;
      m.xf(
        cx,
        hub + cy,
        tz(sz),
        () =>
          m.box(
            0,
            0,
            0,
            ((2 * R * Math.PI) / seg) * 0.99,
            (0.05 + (i % 2) * 0.004) * R,
            (0.06 + (i % 2) * 0.012) * d,
            T.pink,
          ),
        0,
        0,
        a + Math.PI / 2,
      );
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    m.xf(
      0,
      hub,
      0,
      () =>
        m.box(
          0,
          0,
          0,
          2 * R,
          (0.03 + i * 0.003) * R,
          (0.05 + i * 0.008) * d,
          T.light,
        ),
      0,
      0,
      a,
    );
  }
  m.cyl(0, hub, 0, 0.08 * R, 0.08 * R, 0.9 * d, 8, T.gold, { axis: 'z' });
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2 + 0.2;
    const gx = Math.cos(a) * R;
    const gy = Math.sin(a) * R;
    m.box(
      gx,
      hub + gy - 0.16 * R,
      0,
      0.16 * R,
      0.14 * R,
      0.76 * d,
      STOCK[i % 8],
    );
  }
}

function rocket(
  m: Parameters<Builder>[0],
  _v: number,
  w: number,
  d: number,
  h: number,
): void {
  const f = F(m, w, d, h);
  f.cyl(0, 0.04, 0, 0.3, 0.26, 0.5, 8, T.white);
  f.cyl(0, 0.54, 0, 0.26, 0.22, 0.24, 8, T.red);
  f.cyl(0, 0.78, 0, 0.22, 0, 0.22, 8, T.red);
  f.cyl(0, 0.3, 0, 0.31, 0.31, 0.06, 8, T.steel);
  f.cyl(0, 0.44, 0, 0.1, 0.1, 0.08, 8, T.glassDark);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    m.xf(
      Math.cos(a) * 0.4 * w,
      0.04 * h,
      Math.sin(a) * 0.4 * d,
      () =>
        m.box(
          0,
          0,
          0,
          0.2 * Math.min(w, d),
          0.3 * h,
          0.06 * Math.min(w, d),
          T.red,
          { taper: 0.4 },
        ),
      -a,
    );
  }
  f.cyl(0, 0, 0, 0.2, 0.3, 0.06, 8, T.dark);
}

function raft(f: Frac, paint: boolean): void {
  const pa = paint;
  f.box(0, 0, 0, 0.8, 0.3, 0.7, T.sky);
  f.puff(0, 0, 0.42, 1, 1, 0.16, T.yellow, true);
  f.puff(0, 0, -0.42, 1, 1, 0.16, T.yellow, true);
  f.puff(0.44, 0, 0, 0.14, 0.9, 0.7, T.yellow, true);
  f.puff(-0.44, 0, 0, 0.14, 0.9, 0.7, T.yellow, true);
  if (!pa)
    for (const x of [-0.2, 0.2])
      f.puff(x, 0.2, 0, 0.12, 0.7, 0.66, T.orange, true);
  else f.box(0.08, 0.5, 0, 0.04, 0.04, 1.0, T.woodDark);
}

function railway(f: Frac, density: number): void {
  f.box(0, 0, 0, 1, 0.5, 1, T.woodDark);
  f.box(0, 0.5, 0, 0.96, 0.1, 0.96, T.green);
  const tracks: [number, number, number, number][] = [
    [0, -0.34, 0.7, 0.03],
    [0, 0.34, 0.7, 0.03],
    [-0.34, 0, 0.03, 0.7],
    [0.34, 0, 0.03, 0.7],
  ];
  for (const [x, z, a, b] of tracks) f.box(x, 0.6, z, a, 0.05, b, T.steelDark);
  f.box(0.08, 0.65, 0.34, 0.2, 0.2, 0.06, T.red);
  f.box(-0.12, 0.65, 0.34, 0.1, 0.16, 0.06, T.blue);
  for (let i = 0; i < density; i++) {
    const x = ((i * 37) % 7) / 7 - 0.43;
    const z = ((i * 23) % 5) / 5 - 0.3;
    if (Math.abs(x) > 0.38 && Math.abs(z) > 0.38) continue;
    const inner = Math.abs(x) < 0.3 && Math.abs(z) < 0.3;
    if (!inner) continue;
    f.box(
      x * 0.7,
      0.6,
      z * 0.7,
      0.12,
      0.14 + (i % 3) * 0.06,
      0.12,
      STOCK[i % 8],
    );
    f.box(x * 0.7, 0.74 + (i % 3) * 0.06, z * 0.7, 0.14, 0.06, 0.14, T.red, {
      taper: 0.4,
    });
  }
  f.box(0, 0.6, 0.0, 0.3, 0.28, 0.3, T.stone, { taper: 0.5 });
  if (density >= 6) {
    f.cyl(-0.3, 0.6, -0.3, 0.1, 0.1, 0.34, 6, T.stone);
    f.box(0.3, 0.6, 0.3, 0.1, 0.36, 0.1, T.cocoa, { taper: 0.5 });
  }
}
