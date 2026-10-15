/**
 * Deterministic arithmetic owned by the tree code (spec: trees/Grammar.md#determinism). Every random choice of a
 * tree comes from `TreeRng`, and the turtle turns with `tsin` / `tcos`: integer ops and + - * / sqrt only, which
 * IEEE 754 rounds the same everywhere (`Math.sin` / `Math.random` are engine-specific), so a species and a seed give
 * the same skeleton on every platform and every run.
 */

/** Seeded 32-bit integer PRNG (splitmix32). Never the engine's random source. */
export class TreeRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next 32-bit unsigned integer. */
  u32(): number {
    this.s = (this.s + 0x9e3779b9) | 0;
    let z = this.s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** 32-bit integer mix of two values (placement / variant / phase hashes). */
export function mix32(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (b | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/** FNV-1a 32-bit hash of a string (species content hash, stage ids). */
export function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 0..1 from a 32-bit hash. */
export function unit(h: number): number {
  return (h >>> 0) / 4294967296;
}

const TWO_PI_HI = 6.28318530717958623;
const TWO_PI_LO = 2.44929359829470641e-16;
const HALF_PI = 1.5707963267948966;
const PI = 3.141592653589793;

/** sin(x), a fixed polynomial (|error| < 1e-9): bit-identical on every JS engine. */
export function tsin(x: number): number {
  const k = Math.round(x / (TWO_PI_HI + TWO_PI_LO));
  x = x - k * TWO_PI_HI - k * TWO_PI_LO;
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  );
}

export function tcos(x: number): number {
  return tsin(x + HALF_PI);
}

export const DEG = PI / 180;
/** The golden angle (rad), ~137.5 degrees: clusters and cards turn by it from their neighbour. */
export const GOLDEN = PI * (3 - Math.sqrt(5));

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: V3, b: V3): V3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export function norm(a: V3): V3 {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 1, 0];
}
export const madd = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];

/** Rotate `v` about the unit `axis` by `angle` (Rodrigues). */
export function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = tcos(angle);
  const s = tsin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [
    v[0] * c + x[0] * s + axis[0] * k,
    v[1] * c + x[1] * s + axis[1] * k,
    v[2] * c + x[2] * s + axis[2] * k,
  ];
}

/** sRGB hex colour -> linear RGB 0..1 (vertex colours are linear, like three's `Color`). */
export function hexToLinear(hex: string): V3 {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
