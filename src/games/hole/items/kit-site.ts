import { PAL, type Mesher } from './kit';

/**
 * Construction City building helpers. The builders run with `Mesher.decoplanar` (builders.ts), so an
 * axis-aligned box face that lies in the plane of an earlier box's face is pulled in a few mm; cylinders,
 * balls and rotated boxes are not handled, keep them off other faces by hand (1-3 cm).
 *
 * Conventions: machines and vehicles run along X (front = +X), workers and signs face +Z, pivot at the
 * ground centre. Builders work in metres at the catalog size (w, d, h).
 */
export const S = {
  ...PAL,
  machine: 0xf2c230,
  machineDark: 0xc99a1e,
  steel: 0x7d8790,
  steelDark: 0x4f5862,
  galv: 0xb9c0c6,
  rust: 0x9a5a3a,
  primer: 0xa8483a,
  timber: 0xc79a62,
  timberDark: 0x9c7445,
  ply: 0xd8b98a,
  concrete: 0xb4b2ab,
  concreteDark: 0x8e8c86,
  concreteLight: 0xcfcdc6,
  dirt: 0x8a6a4a,
  dirtDark: 0x6e543b,
  sand: 0xe0c27a,
  gravel: 0x9a948a,
  rubble: 0x7e7a72,
  tarmac: 0x3a3d42,
  hivis: 0xf08a2b,
  hivisYellow: 0xd7e83a,
  reflect: 0xe8eef2,
  cab: 0x2f3438,
  beacon: 0xffa31a,
  mortar: 0xd8d2c4,
  water: 0x8fc4e8,
  plastic: 0xf0efe8,
} as const;

/** Heap colours per variant: dirt, sand, gravel. */
export const HEAP_COLORS: [number, number, number][] = [
  [S.dirt, S.dirtDark, 0x9b7a55],
  [S.sand, 0xc9a964, 0xeed39a],
  [S.gravel, 0x7f7a72, 0xb2ada4],
];

/** Wheel / roller with its axis along Z at (x, z), centre height `r` (standing on the ground). */
export function wheel(
  m: Mesher,
  x: number,
  z: number,
  r: number,
  width: number,
  o: { hub?: number; sides?: number; y?: number; tyre?: number } = {},
): void {
  const y = o.y ?? r;
  const sides = o.sides ?? 10;
  m.cyl(x, y, z, r, r, width, sides, o.tyre ?? S.rubber, { axis: 'z' });
  const s = z >= 0 ? 1 : -1;
  const hw = Math.max(0.01, width * 0.04);
  m.cyl(
    x,
    y,
    z + s * (width / 2 + hw / 2 + 0.004),
    r * 0.55,
    r * 0.55,
    hw,
    sides,
    o.hub ?? S.light,
    { axis: 'z' },
  );
}

/** Crawler track along X centred on (x, z): a box with round ends, `h` tall, standing on the ground. */
export function track(
  m: Mesher,
  x: number,
  z: number,
  len: number,
  h: number,
  width: number,
  color: number = S.rubber,
): void {
  const r = h / 2;
  m.box(x, 0, z, len - 2 * r, h, width, color);
  for (const s of [-1, 1])
    m.cyl(x + s * (len / 2 - r), r, z, r, r, width + 0.03, 8, color, {
      axis: 'z',
    });
  // a lighter idler hub on the outside of each end
  const zs = z >= 0 ? 1 : -1;
  for (const s of [-1, 1])
    m.cyl(
      x + s * (len / 2 - r),
      r,
      z + zs * (width / 2 + 0.03),
      r * 0.5,
      r * 0.5,
      0.04,
      8,
      S.steelDark,
      { axis: 'z' },
    );
}

/** Cab: a box with a glass band all round it (proud by 2 cm), roof on top. */
export function cab(
  m: Mesher,
  x: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  o: { paint?: boolean; glass0?: number; glass1?: number } = {},
): void {
  m.box(x, y0, z, w, h, d, color, { paint: o.paint });
  const g0 = o.glass0 ?? 0.4;
  const g1 = o.glass1 ?? 0.9;
  m.box(x, y0 + h * g0, z, w + 0.04, h * (g1 - g0), d + 0.04, S.glassDark);
}

/** Rotating amber beacon on a cab roof. */
export function beacon(m: Mesher, x: number, y0: number, z: number, r = 0.1) {
  m.cyl(x, y0, z, r, r * 0.8, r * 1.4, 6, S.beacon, { glow: true });
}

/** Wooden pallet w x d (0.14 m tall): three runners and a deck. Returns the deck top height. */
export function pallet(m: Mesher, w: number, d: number, y0 = 0): number {
  for (const s of [-1, 0, 1])
    m.box(0, y0, (s * (d - 0.1)) / 2, w - 0.02, 0.1, 0.1, S.timberDark);
  m.box(0, y0 + 0.1, 0, w, 0.04, d, S.timber);
  return y0 + 0.14;
}

/** Hand rail along X at height `y` (posts every ~1.5 m). */
export function railX(
  m: Mesher,
  x0: number,
  x1: number,
  z: number,
  y: number,
  h = 1,
  color: number = S.hivis,
  t = 0.05,
): void {
  const n = Math.max(1, Math.round(Math.abs(x1 - x0) / 1.5));
  for (let i = 0; i <= n; i++)
    m.box(x0 + ((x1 - x0) * i) / n, y, z, t, h - t, t, color);
  m.box((x0 + x1) / 2, y + h - t, z, Math.abs(x1 - x0) + t, t, t * 1.2, color);
}

/** Hand rail along Z at height `y`. */
export function railZ(
  m: Mesher,
  x: number,
  z0: number,
  z1: number,
  y: number,
  h = 1,
  color: number = S.hivis,
  t = 0.05,
): void {
  const n = Math.max(1, Math.round(Math.abs(z1 - z0) / 1.5));
  for (let i = 0; i <= n; i++)
    m.box(x, y, z0 + ((z1 - z0) * i) / n, t, h - t, t, color);
  m.box(x, y + h - t, (z0 + z1) / 2, t * 1.2, t, Math.abs(z1 - z0) + t, color);
}

/**
 * A straight bar from (x0, y0) to (x1, y1) in the XZ-plane slice at `z` (a box rotated about Z):
 * booms, braces, ladders. `t` = thickness (y), `dz` = width along Z.
 */
export function bar(
  m: Mesher,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  t: number,
  dz: number,
  color: number,
  o: { paint?: boolean } = {},
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const a = Math.atan2(y1 - y0, x1 - x0);
  m.xf(
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    z,
    () => m.box(0, -t / 2, 0, len, t, dz, color, { paint: o.paint }),
    0,
    0,
    a,
  );
}

/** A bar from (z0, y0) to (z1, y1) in the slice at `x` (a box rotated about X). */
export function barZ(
  m: Mesher,
  z0: number,
  y0: number,
  z1: number,
  y1: number,
  x: number,
  t: number,
  dx: number,
  color: number,
): void {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const a = Math.atan2(y1 - y0, z1 - z0);
  m.xf(
    x,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
    () => m.box(0, -t / 2, 0, dx, t, len, color),
    0,
    -a,
    0,
  );
}

/**
 * Square lattice mast (tower crane, piling leader): four corner posts and zig-zag braces on the
 * +Z / -Z faces, from y0 up `h`, side `s`, post thickness `t`.
 */
export function mast(
  m: Mesher,
  x: number,
  z: number,
  y0: number,
  h: number,
  s: number,
  t: number,
  color: number,
  o: { paint?: boolean; step?: number } = {},
): void {
  const half = s / 2 - t / 2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      m.box(x + sx * half, y0, z + sz * half, t, h, t, color, {
        paint: o.paint,
      });
  const step = o.step ?? s * 1.4;
  const n = Math.max(1, Math.floor(h / step));
  const dy = h / n;
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * dy;
    const flip = i % 2 === 0 ? 1 : -1;
    // alternate the depth of the braces so neighbouring ones never share a plane where they meet
    const inset = i % 2 === 0 ? 0 : t * 0.12;
    for (const sz of [-1, 1])
      bar(
        m,
        x - flip * half,
        ya + t,
        x + flip * half,
        ya + dy,
        z + sz * (half - inset),
        t * 0.7,
        t * (i % 2 === 0 ? 0.8 : 0.5),
        color,
        { paint: o.paint },
      );
  }
}

/** Triangular-section lattice jib along X from x0 to x1 at height y0 (bottom chords), depth `s`, height `hh`. */
export function jib(
  m: Mesher,
  x0: number,
  x1: number,
  y0: number,
  s: number,
  hh: number,
  t: number,
  color: number,
  o: { paint?: boolean; step?: number } = {},
): void {
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  for (const sz of [-1, 1])
    m.box(cx, y0, sz * (s / 2 - t / 2), len, t, t, color, { paint: o.paint });
  m.box(cx, y0 + hh - t, 0, len, t, t * 1.1, color, { paint: o.paint });
  const step = o.step ?? hh * 1.6;
  const n = Math.max(1, Math.floor(len / step));
  const dx = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * dx;
    const flip = i % 2 === 0;
    bar(
      m,
      flip ? xa : xa + dx,
      y0 + t,
      flip ? xa + dx : xa,
      y0 + hh - t,
      0,
      t * 0.6,
      t * (i % 2 === 0 ? 0.7 : 0.45),
      color,
      { paint: o.paint },
    );
  }
}

/** Ladder up the +Z / -Z side of something: two rails and rungs, at (x, z), from y0 to y1. */
export function ladder(
  m: Mesher,
  x: number,
  z: number,
  y0: number,
  y1: number,
  color: number = S.galv,
  wid = 0.45,
): void {
  for (const s of [-1, 1])
    m.box(x + (s * wid) / 2, y0, z, 0.05, y1 - y0, 0.05, color);
  const n = Math.max(2, Math.floor((y1 - y0) / 0.6));
  for (let i = 1; i < n; i++)
    m.box(
      x,
      y0 + ((y1 - y0) * i) / n,
      z + 0.012,
      wid - 0.06,
      0.04,
      0.03,
      color,
    );
}
