import type { BoxOpts, CylOpts, Mesher } from './kit';
import { PAL } from './kit';

/**
 * Toy Emporium building helpers on top of the Mesher. Builders work in
 * **fractions** of the catalog size (w, d, h), so one recipe fits an XS and an
 * XXL item and the built size always matches the catalog.
 *
 * Conventions: vehicles / long items run along X, plush and shelves face +Z.
 */
export const T = {
  ...PAL,
  pink: 0xe86aa6,
  hotPink: 0xff5fa2,
  purple: 0x8b5cd6,
  teal: 0x2fb5a8,
  sky: 0x7cc8f0,
  navy: 0x2a3a7a,
  brown: 0x8a5a3a,
  tan: 0xd9b98c,
  cocoa: 0x6b4128,
  panda: 0xf7f5f0,
  gray: 0xa9adb3,
  grayDark: 0x7e838b,
  rose: 0xf4b6c0,
  lime: 0x9bd44a,
  gold: 0xe8b83a,
  steel: 0x9aa7b3,
  steelDark: 0x5f6b77,
  cardboard: 0xc79a62,
  cardboardDark: 0xa87b45,
  plastic: 0xf0efe8,
  tile: 0xe9e2d0,
} as const;

/** Colours cycled by "mixed stock" parts (boxes on shelves, bricks in bins). */
export const STOCK = [
  T.red,
  T.blue,
  T.yellow,
  T.green,
  T.orange,
  T.purple,
  T.pink,
  T.teal,
];

export interface Frac {
  m: Mesher;
  w: number;
  d: number;
  h: number;
  /** Box in fractions: centre (cx, cz), bottom y0, size (bw, bh, bd). */
  box(
    cx: number,
    y0: number,
    cz: number,
    bw: number,
    bh: number,
    bd: number,
    color: number,
    o?: BoxOpts,
  ): void;
  /** Cylinder: radii as a fraction of min(w, d); y / height as fractions of h (axis x / z: length as fraction of w / d). */
  cyl(
    cx: number,
    y0: number,
    cz: number,
    rb: number,
    rt: number,
    ch: number,
    sides: number,
    color: number,
    o?: CylOpts,
  ): void;
  /** Two crossed boxes that read as a rounded block. */
  puff(
    cx: number,
    y0: number,
    cz: number,
    bw: number,
    bh: number,
    bd: number,
    color: number,
    paint?: boolean,
  ): void;
  at(
    cx: number,
    y0: number,
    cz: number,
    fn: () => void,
    rotY?: number,
    rotX?: number,
    rotZ?: number,
  ): void;
}

export function F(m: Mesher, w: number, d: number, h: number): Frac {
  const mn = Math.min(w, d);
  const f: Frac = {
    m,
    w,
    d,
    h,
    box: (cx, y0, cz, bw, bh, bd, c, o) =>
      m.box(cx * w, y0 * h, cz * d, bw * w, bh * h, bd * d, c, o),
    cyl: (cx, y0, cz, rb, rt, ch, sides, c, o) => {
      const axis = o?.axis ?? 'y';
      const len = axis === 'x' ? ch * w : axis === 'z' ? ch * d : ch * h;
      m.cyl(cx * w, y0 * h, cz * d, rb * mn, rt * mn, len, sides, c, o);
    },
    puff: (cx, y0, cz, bw, bh, bd, c, paint = false) => {
      // core + a taller, narrower block: a rounded silhouette from 2 boxes (no shared planes)
      m.box(
        cx * w,
        (y0 + bh * 0.12) * h,
        cz * d,
        bw * w,
        bh * 0.76 * h,
        bd * d,
        c,
        {
          paint,
        },
      );
      m.box(cx * w, y0 * h, cz * d, bw * 0.8 * w, bh * h, bd * 0.8 * d, c, {
        paint,
      });
    },
    at: (cx, y0, cz, fn, ry, rx, rz) =>
      m.xf(cx * w, y0 * h, cz * d, fn, ry, rx, rz),
  };
  return f;
}

/** Absolute (metre) helpers for small details that must stay a minimum size. */
export const EPS = 0.012;

/** Studs on a brick top: `nx` x `nz` six-sided pegs. */
export function studs(
  f: Frac,
  y0: number,
  nx: number,
  nz: number,
  color: number,
  paint = false,
  spanX = 0.8,
  spanZ = 0.8,
  hFrac = 0.18,
): void {
  const r = Math.min(spanX / nx / 2.8, spanZ / nz / 2.8);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const cx = nx === 1 ? 0 : -spanX / 2 + (spanX / (nx - 1)) * i;
      const cz = nz === 1 ? 0 : -spanZ / 2 + (spanZ / (nz - 1)) * j;
      f.m.cyl(
        cx * f.w,
        y0 * f.h,
        cz * f.d,
        r * Math.min(f.w, f.d),
        r * 0.92 * Math.min(f.w, f.d),
        hFrac * f.h,
        6,
        color,
        { paint },
      );
    }
}

/** Wheel with a tyre and a hub, axis along Z at (x, y) (fractions); `r` = radius fraction of h. */
export function wheel(
  f: Frac,
  x: number,
  yc: number,
  z: number,
  r: number,
  wd: number,
  tyre: number = T.rubber,
  hub: number = T.light,
): void {
  const rr = r * f.h;
  f.m.cyl(x * f.w, yc * f.h, z * f.d, rr, rr, wd * f.d, 8, tyre, { axis: 'z' });
  const sgn = z >= 0 ? 1 : -1;
  const ww = wd * f.d;
  f.m.cyl(
    x * f.w,
    yc * f.h,
    z * f.d + sgn * (ww / 2 + 0.004),
    rr * 0.5,
    rr * 0.5,
    0.012,
    8,
    hub,
    { axis: 'z' },
  );
}

/** A window band (glass box) slightly proud of a side. */
export function glass(
  f: Frac,
  cx: number,
  y0: number,
  cz: number,
  bw: number,
  bh: number,
  bd: number,
): void {
  f.box(cx, y0, cz, bw, bh, bd, T.glassDark);
}
