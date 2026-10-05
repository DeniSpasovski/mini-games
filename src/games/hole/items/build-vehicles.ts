import type { Builder } from './build-small';
import { Mesher, PAL as C } from './kit';

interface CarOpts {
  len: number;
  wid: number;
  hei: number;
  /** Wheel radius. */
  wr: number;
  /** Chassis top height. */
  chassis: number;
  cabinLen: number;
  cabinX: number;
  color: number;
  paint?: boolean;
  /** Wheel x offset from the centre. */
  axle?: number;
}

/** How far (m) a wheel sticks out of the body side, so its cap never shares a plane with the body. */
const WHEEL_OUT = 0.04;

/** Wheel: axis along Z, centred on (x, r, z); it is pushed out by WHEEL_OUT. */
function wheel(m: Mesher, x: number, z0: number, r: number, width = 0.22) {
  const z = z0 + Math.sign(z0 || 1) * WHEEL_OUT;
  m.cyl(x, r, z, r, r, width, 8, C.rubber, { axis: 'z' });
  m.cyl(
    x,
    r,
    z + Math.sign(z || 1) * (width / 2 + 0.005),
    r * 0.5,
    r * 0.5,
    0.01,
    6,
    C.chrome,
    { axis: 'z' },
  );
}

function lights(m: Mesher, len: number, wid: number, y: number) {
  for (const s of [-1, 1]) {
    // centred a bit outside the end faces so they stand 1 cm proud of the body
    m.box(len / 2 - 0.03, y, s * wid * 0.3, 0.08, 0.14, 0.3, C.lamp);
    m.box(-len / 2 + 0.03, y, s * wid * 0.3, 0.08, 0.14, 0.3, C.red);
  }
}

/**
 * Glass band that follows a tapered cabin box (same footprint and taper, built
 * with `m.box(..., { taper })`) from fraction f0 to f1 of its height. It is
 * `out` metres bigger than the cabin all around, so it is never buried in it or
 * sharing a plane with it.
 */
function glassBand(
  m: Mesher,
  cx: number,
  y0: number,
  len: number,
  wid: number,
  h: number,
  taper: number,
  f0: number,
  f1: number,
  out = 0.03,
) {
  const s = (f: number) => 1 - (1 - taper) * f;
  const l0 = len * s(f0) + 2 * out;
  const w0 = wid * s(f0) + 2 * out;
  const l1 = len * s(f1) + 2 * out;
  m.box(cx, y0 + h * f0, 0, l0, h * (f1 - f0), w0, C.glassDark, {
    taper: l1 / l0,
  });
}

function car(m: Mesher, o: CarOpts) {
  const { len, wid, wr, chassis } = o;
  const axle = o.axle ?? len * 0.3;
  const wz = wid / 2 - 0.11;
  for (const x of [-axle, axle])
    for (const s of [-1, 1]) wheel(m, x, s * wz, wr);
  m.box(0, wr * 0.55, 0, len, chassis - wr * 0.55, wid, o.color, {
    paint: o.paint,
  });
  const cabinH = o.hei - chassis;
  m.box(o.cabinX, chassis, 0, o.cabinLen, cabinH, wid * 0.9, o.color, {
    paint: o.paint,
    taper: 0.86,
  });
  glassBand(
    m,
    o.cabinX,
    chassis,
    o.cabinLen,
    wid * 0.9,
    cabinH,
    0.86,
    0.12,
    0.74,
  );
  lights(m, len, wid, chassis - 0.22);
}

export const VEHICLE_BUILDERS: Record<string, Builder> = {
  scooter(m) {
    for (const x of [-0.7, 0.7])
      m.cyl(x, 0.22, 0, 0.22, 0.22, 0.1, 8, C.rubber, { axis: 'z' });
    m.box(-0.1, 0.28, 0, 1.2, 0.22, 0.4, C.red, { paint: true });
    m.box(-0.5, 0.5, 0, 0.5, 0.12, 0.3, C.dark);
    m.box(0.55, 0.3, 0, 0.1, 0.65, 0.4, C.red, { paint: true });
    m.box(0.62, 0.95, 0, 0.1, 0.08, 0.6, C.dark);
    m.box(0.68, 0.8, 0, 0.06, 0.12, 0.18, C.lamp);
    m.box(-0.8, 0.4, 0, 0.3, 0.2, 0.32, C.red, { paint: true });
  },
  car_compact(m) {
    car(m, {
      len: 3.5,
      wid: 1.7,
      hei: 1.5,
      wr: 0.3,
      chassis: 0.85,
      cabinLen: 1.9,
      cabinX: -0.15,
      color: C.red,
      paint: true,
    });
  },
  car_sedan(m) {
    car(m, {
      len: 4.2,
      wid: 1.8,
      hei: 1.5,
      wr: 0.32,
      chassis: 0.85,
      cabinLen: 2.2,
      cabinX: -0.2,
      color: C.blue,
      paint: true,
    });
    m.box(-1.9, 0.85, 0, 0.35, 0.06, 1.5, C.dark);
  },
  taxi(m) {
    car(m, {
      len: 4.2,
      wid: 1.8,
      hei: 1.6,
      wr: 0.32,
      chassis: 0.85,
      cabinLen: 2.2,
      cabinX: -0.2,
      color: C.yellow,
    });
    m.box(-0.2, 1.6, 0, 0.5, 0.12, 0.25, C.white);
    m.box(0, 0.9, 0.9, 1.2, 0.08, 0.02, C.black);
  },
  police_car(m) {
    car(m, {
      len: 4.8,
      wid: 1.9,
      hei: 1.7,
      wr: 0.34,
      chassis: 0.9,
      cabinLen: 2.5,
      cabinX: -0.25,
      color: C.white,
    });
    m.box(0, 0.5, 0, 4.2, 0.4, 1.92, C.dark);
    m.box(-0.25, 1.7, -0.3, 0.3, 0.14, 0.4, C.red);
    m.box(-0.25, 1.7, 0.3, 0.3, 0.14, 0.4, C.blue);
  },
  van(m) {
    const o = { len: 5.5, wid: 2.0, hei: 2.3, wr: 0.36, chassis: 1.0 };
    const wz = o.wid / 2 - 0.12;
    for (const x of [-1.8, 1.7])
      for (const s of [-1, 1]) wheel(m, x, s * wz, o.wr, 0.24);
    m.box(0, 0.35, 0, o.len, 0.65, o.wid, C.dark);
    m.box(-0.5, 1.0, 0, 4.4, 1.3, o.wid, C.white, { paint: true });
    m.box(2.1, 1.0, 0, 1.3, 0.7, o.wid, C.white, { paint: true, taper: 0.97 });
    m.box(1.75, 1.45, 0, 0.85, 0.7, o.wid * 0.9, C.glassDark, { taper: 0.9 });
    lights(m, o.len, o.wid, 0.75);
  },
  pickup(m) {
    const wz = 0.88;
    for (const x of [-1.6, 1.6])
      for (const s of [-1, 1]) wheel(m, x, s * wz, 0.37, 0.24);
    m.box(0, 0.4, 0, 5.3, 0.4, 1.96, C.dark);
    m.box(1.35, 0.8, 0, 2.7, 0.5, 2.0, C.red, { paint: true });
    m.box(1.0, 1.3, 0, 1.6, 0.6, 1.8, C.red, { paint: true, taper: 0.88 });
    glassBand(m, 1.0, 1.3, 1.6, 1.8, 0.6, 0.88, 0.1, 0.7);
    m.box(-1.3, 0.8, 0, 2.6, 0.12, 1.9, C.red, { paint: true });
    m.box(-1.29, 0.8, -0.94, 2.58, 0.55, 0.12, C.red, { paint: true });
    m.box(-1.29, 0.8, 0.94, 2.58, 0.55, 0.12, C.red, { paint: true });
    m.box(-2.64, 0.8, 0, 0.12, 0.55, 1.9, C.red, { paint: true });
    lights(m, 5.4, 2.0, 0.78);
  },
  delivery_truck(m) {
    const wz = 1.05;
    for (const x of [-1.9, -0.7, 2.2])
      for (const s of [-1, 1]) wheel(m, x, s * wz, 0.4, 0.26);
    m.box(0, 0.4, 0, 6.5, 0.4, 2.3, C.dark);
    m.box(-0.8, 0.8, 0, 4.9, 2.6, 2.4, C.white, { paint: true });
    m.box(2.5, 0.8, 0, 1.5, 1.6, 2.3, C.white, { paint: true, taper: 0.97 });
    glassBand(m, 2.5, 0.8, 1.5, 2.3, 1.6, 0.97, 0.56, 0.94);
    m.box(-0.8, 1.8, 1.21, 3.2, 0.4, 0.02, C.red);
    lights(m, 6.5, 2.3, 0.8);
  },
  food_truck(m) {
    const wz = 1.0;
    for (const x of [-2.4, 2.4])
      for (const s of [-1, 1]) wheel(m, x, s * wz, 0.4, 0.26);
    m.box(0, 0.4, 0, 7.5, 0.4, 2.3, C.dark);
    m.box(-0.5, 0.8, 0, 6.2, 2.1, 2.4, C.red, { paint: true });
    m.box(3.0, 0.8, 0, 1.5, 1.4, 2.3, C.red, { paint: true, taper: 0.97 });
    glassBand(m, 3.0, 0.8, 1.5, 2.3, 1.4, 0.97, 0.5, 0.89);
    m.box(-0.8, 1.5, 1.21, 2.6, 0.9, 0.04, C.black);
    m.box(-0.8, 1.45, 1.4, 2.8, 0.08, 0.5, C.chrome);
    m.box(-0.8, 2.4, 1.5, 3.0, 0.2, 1.0, C.white, { taper: 0.9 });
    m.box(-1.6, 2.9, 0, 1.0, 0.3, 0.9, C.grey);
    m.box(-0.5, 2.9, 0.3, 2.0, 0.28, 0.6, C.yellow);
    lights(m, 7.5, 2.3, 0.8);
  },
  fire_truck(m) {
    const wz = 1.05;
    for (const x of [-2.9, -1.5, 2.9])
      for (const s of [-1, 1]) wheel(m, x, s * wz, 0.45, 0.28);
    m.box(0, 0.45, 0, 8.5, 0.4, 2.5, C.dark);
    m.box(-0.8, 0.85, 0, 6.2, 1.5, 2.5, C.red);
    m.box(3.2, 0.85, 0, 2.1, 2.0, 2.4, C.red, { taper: 0.98 });
    glassBand(m, 3.2, 0.85, 2.1, 2.4, 2.0, 0.98, 0.525, 0.875);
    m.box(-0.8, 2.35, 0, 5.4, 0.15, 1.2, C.chrome);
    m.box(-0.8, 2.5, -0.4, 5.0, 0.1, 0.1, C.chrome);
    m.box(-0.8, 2.5, 0.4, 5.0, 0.1, 0.1, C.chrome);
    for (let i = 0; i < 6; i++)
      m.box(-2.9 + i * 0.9, 2.46, 0, 0.06, 0.1, 0.8, C.chrome);
    m.box(3.2, 2.85, 0, 0.5, 0.18, 1.6, C.blue);
    m.box(-0.8, 1.2, 1.26, 5.0, 0.15, 0.02, C.yellow);
    lights(m, 8.5, 2.5, 0.9);
  },
  bus(m) {
    const wz = 1.0;
    for (const x of [-3.2, 3.2])
      for (const s of [-1, 1]) wheel(m, x, s * wz, 0.5, 0.3);
    m.box(0, 0.4, 0, 10, 2.8, 2.5, C.blue, { paint: true });
    m.box(0, 1.2, 0, 10.04, 1.0, 2.46, C.glassDark);
    m.box(0, 0.5, 0, 10.04, 0.14, 2.52, C.white);
    m.box(0, 3.2, 0, 8.6, 0.2, 2.2, C.light);
    m.box(4.98, 1.0, 0, 0.06, 1.6, 2.0, C.glass);
    m.box(4.98, 2.6, 0, 0.06, 0.4, 1.4, C.black);
    lights(m, 10, 2.5, 0.8);
  },
  tram(m) {
    for (const x of [-4, 4])
      for (const s of [-1, 1]) wheel(m, x, s * 0.9, 0.3, 0.2);
    m.box(0, 0.45, 0, 12, 2.6, 2.6, C.white, { taper: 0.98 });
    m.box(0, 1.3, 0, 12.04, 1.0, 2.56, C.glassDark);
    m.box(0, 0.6, 0, 12.04, 0.35, 2.6, C.red);
    m.box(0, 3.05, 0, 11.4, 0.25, 2.2, C.light);
    m.box(1.0, 3.3, 0, 0.1, 0.2, 0.1, C.dark);
    m.box(1.0, 3.5, 0, 1.6, 0.1, 1.2, C.dark);
    m.box(5.98, 1.3, 0, 0.06, 1.0, 2.2, C.glass);
  },
  speedboat(m) {
    for (const s of [-1, 1]) wheel(m, -0.5, s * 1.1, 0.4, 0.25);
    m.box(0, 0.55, 0, 6.6, 0.15, 0.7, C.dark);
    m.box(-0.2, 0.7, 0, 5.8, 0.75, 2.4, C.white, { paint: true });
    m.box(3.0, 0.9, 0, 1.4, 0.55, 1.6, C.white, { paint: true, taper: 0.4 });
    m.box(-0.2, 0.98, 0, 5.0, 0.12, 2.44, C.blue);
    m.box(0.2, 1.45, 0, 0.12, 0.55, 1.9, C.glass);
    m.box(0.4, 1.45, -0.95, 1.2, 0.12, 0.1, C.chrome);
    m.box(-1.2, 1.45, 0, 1.0, 0.1, 1.6, C.dark);
    m.box(-3.6, 1.0, 0, 0.5, 1.0, 0.4, C.dark);
  },
  // ---------------------------------------------------------------- street / residential props that are not vehicles
  fence_section(m) {
    for (const x of [-1.0, 1.0]) m.box(x, 0, 0, 0.1, 1.2, 0.1, C.white);
    for (const y of [0.3, 0.8]) m.box(0, y, 0, 2.0, 0.08, 0.06, C.white);
    for (let i = 0; i < 9; i++)
      m.box(-0.9 + i * 0.225, 0, 0.02, 0.14, 1.05, 0.03, C.white, {
        taper: 0.9,
      });
  },
  garden_shed(m) {
    m.box(0, 0, 0, 3.8, 2.2, 2.8, C.cream, { paint: true });
    m.gable(0, 2.2, 0, 4.0, 3.0, 0.6, C.roofGrey, false, C.cream);
    m.box(-0.8, 0, 1.41, 1.0, 1.7, 0.04, C.woodDark);
    m.box(0.9, 1.0, 1.41, 0.9, 0.7, 0.04, C.glass);
    m.box(0.9, 0.95, 1.43, 1.0, 0.06, 0.06, C.white);
    for (let i = 0; i < 6; i++) {
      const x = -1.6 + i * 0.64;
      // battens only where there is bare wall (not behind the door or the window)
      if (Math.abs(x + 0.8) < 0.7 || Math.abs(x - 0.9) < 0.6) continue;
      m.box(x, 0.02, 1.41, 0.04, 2.1, 0.02, C.woodDark);
    }
  },
  billboard(m, v) {
    for (const x of [-1.2, 1.2]) m.box(x, 0, 0, 0.3, 4.2, 0.3, C.dark);
    m.box(0, 4.0, 0.1, 4.0, 2.0, 0.25, C.white);
    const sets = [
      [C.red, C.yellow, C.white],
      [C.blue, C.white, C.green],
      [C.orange, C.dark, C.light],
    ][v % 3];
    m.box(-0.9, 4.1, 0.25, 1.9, 1.8, 0.04, sets[0]);
    m.box(0.8, 4.4, 0.25, 1.4, 0.6, 0.04, sets[1]);
    m.box(0.8, 4.1, 0.25, 1.4, 0.2, 0.04, sets[2]);
    m.box(0, 3.85, 0.3, 4.0, 0.12, 0.6, C.grey);
    m.box(0, 5.95, 0.1, 4.06, 0.08, 0.3, C.dark);
  },
};
