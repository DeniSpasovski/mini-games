import type { Builder } from './build-small';
import type { Mesher } from './kit';
import {
  S,
  bar,
  barZ,
  beacon,
  cab,
  jib,
  ladder,
  mast,
  railX,
  track,
  wheel,
} from './kit-site';

/**
 * Construction Site: plant, trucks, cranes, mining machines and buildings under construction (tiers 13-25).
 * Metres at the catalog size, pivot at the ground centre, machines run along X with the front at +X.
 * Shared recipes take scale factors (kx along X, ky up, kz across) so one design serves two sizes.
 */

interface K {
  x: number;
  y: number;
  z: number;
}
const ONE: K = { x: 1, y: 1, z: 1 };

/** Mesher proxy that scales every box / cylinder / ball by k (designs are drawn at k = 1). */
function scaled(m: Mesher, k: K) {
  const r = Math.min(k.x, k.z);
  return {
    box: (
      cx: number,
      y0: number,
      cz: number,
      w: number,
      h: number,
      d: number,
      c: number,
      o?: Parameters<Mesher['box']>[7],
    ) => m.box(cx * k.x, y0 * k.y, cz * k.z, w * k.x, h * k.y, d * k.z, c, o),
    track: (
      x: number,
      z: number,
      len: number,
      h: number,
      wd: number,
      c?: number,
    ) => {
      // tracks keep round ends: the height scales with y, the length with x
      track(m, x * k.x, z * k.z, len * k.x, h * k.y, wd * k.z, c);
    },
    wheel: (
      x: number,
      z: number,
      rr: number,
      wd: number,
      o?: Parameters<typeof wheel>[5],
    ) => wheel(m, x * k.x, z * k.z, rr * Math.min(k.x, k.y), wd * k.z, o),
    bar: (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      z: number,
      t: number,
      dz: number,
      c: number,
      o?: { paint?: boolean },
    ) =>
      bar(
        m,
        x0 * k.x,
        y0 * k.y,
        x1 * k.x,
        y1 * k.y,
        z * k.z,
        t * Math.min(k.x, k.y),
        dz * k.z,
        c,
        o,
      ),
    cab: (
      x: number,
      y0: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: number,
      o?: Parameters<typeof cab>[8],
    ) => cab(m, x * k.x, y0 * k.y, z * k.z, w * k.x, h * k.y, d * k.z, c, o),
    ball: (
      cx: number,
      cy: number,
      cz: number,
      rx: number,
      ry: number,
      rz: number,
      c: number,
      o?: Parameters<Mesher['ball']>[7],
    ) =>
      m.ball(cx * k.x, cy * k.y, cz * k.z, rx * k.x, ry * k.y, rz * k.z, c, o),
    cyl: (
      cx: number,
      y0: number,
      cz: number,
      rb: number,
      rt: number,
      h: number,
      sides: number,
      c: number,
      o?: Parameters<Mesher['cyl']>[8],
    ) => {
      const axis = o?.axis ?? 'y';
      const len = axis === 'x' ? h * k.x : axis === 'z' ? h * k.z : h * k.y;
      const rk = axis === 'y' ? r : Math.min(axis === 'x' ? k.z : k.x, k.y);
      m.cyl(cx * k.x, y0 * k.y, cz * k.z, rb * rk, rt * rk, len, sides, c, o);
    },
    beacon: (x: number, y0: number, z: number) =>
      beacon(m, x * k.x, y0 * k.y, z * k.z, 0.1 * Math.min(k.x, k.y)),
  };
}

// ------------------------------------------------------------------------------------------- trucks

/** Truck cab at the front (+X): box, glass band, bumper, grille, lamps, beacon. `x0` = rear of the cab. */
function truckCab(
  m: Mesher,
  x0: number,
  len: number,
  wid: number,
  hgt: number,
  y0: number,
  color: number,
  paint: boolean,
) {
  const cx = x0 + len / 2;
  m.box(cx, y0, 0, len, hgt, wid, color, { paint });
  m.box(
    cx,
    y0 + hgt * 0.55,
    0,
    len + 0.04,
    hgt * 0.36,
    wid + 0.04,
    S.glassDark,
  );
  m.box(x0 + len + 0.05, y0 - 0.45, 0, 0.12, 0.35, wid, S.dark);
  m.box(x0 + len + 0.006, y0 + 0.15, 0, 0.012, hgt * 0.35, wid * 0.5, S.dark);
  for (const s of [-1, 1])
    m.box(
      x0 + len + 0.006,
      y0 + 0.08,
      s * wid * 0.38,
      0.012,
      0.18,
      0.3,
      S.lamp,
      { glow: true },
    );
  beacon(m, cx - len * 0.2, y0 + hgt, 0);
}

/** Rubble heaped in a truck body. */
function load(
  m: Mesher,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  color: number = S.dirt,
) {
  m.ball(x, y, z, rx, ry, rz, color, {
    half: true,
    jitter: 0.15,
    seed: 7,
    seg: 8,
    rings: 5,
  });
}

function dumpTruck(m: Mesher) {
  for (const x of [3.0, -1.6, -3.0])
    for (const s of [-1, 1]) wheel(m, x, s * 1.05, 0.52, 0.42);
  m.box(-0.2, 0.55, 0, 8.2, 0.35, 1.1, S.steelDark);
  truckCab(m, 2.4, 1.9, 2.4, 2.1, 0.9, S.white, true);
  m.box(-0.95, 0.9, 0, 6.3, 1.6, 2.5, S.white, { paint: true });
  for (const x of [-3.2, -1.9, -0.6, 0.7])
    for (const s of [-1, 1])
      m.box(x, 0.95, s * 1.26, 0.12, 1.5, 0.02, S.white, { paint: true });
  m.box(2.2, 2.5, 0, 0.5, 0.35, 2.5, S.white, { paint: true });
  load(m, -1.0, 2.5, 0, 2.6, 0.75, 1.0);
}

function mixerTruck(m: Mesher) {
  for (const x of [3.5, -1.7, -3.1])
    for (const s of [-1, 1]) wheel(m, x, s * 1.05, 0.52, 0.42);
  m.box(-0.1, 0.55, 0, 9.0, 0.35, 1.1, S.steelDark);
  truckCab(m, 2.9, 1.9, 2.4, 2.1, 0.9, S.white, false);
  m.box(1.9, 0.9, 0, 0.4, 1.1, 1.6, S.steelDark);
  m.box(-3.3, 0.9, 0, 0.4, 1.5, 1.6, S.steelDark);
  m.xf(
    -0.6,
    2.1,
    0,
    () => {
      m.cyl(0, 0, 0, 1.15, 1.15, 3.0, 12, S.white, { axis: 'x', paint: true });
      m.cyl(1.9, 0, 0, 1.15, 0.55, 0.8, 12, S.white, {
        axis: 'x',
        paint: true,
      });
      m.cyl(-1.9, 0, 0, 0.55, 1.15, 0.8, 12, S.white, {
        axis: 'x',
        paint: true,
      });
      for (const x of [-0.8, 0.6])
        m.cyl(x, 0, 0, 1.17, 1.17, 0.25, 12, S.hivis, {
          axis: 'x',
          caps: false,
        });
    },
    0,
    0,
    -0.12,
  );
  m.cyl(-3.0, 2.75, 0, 0.3, 0.55, 0.6, 8, S.steelDark);
  bar(m, -3.4, 2.0, -4.6, 1.2, 0, 0.2, 0.5, S.steelDark);
  m.cyl(1.5, 1.3, -0.8, 0.35, 0.35, 0.6, 8, S.blue, { axis: 'x' });
}

function pumpTruck(m: Mesher) {
  for (const x of [4.5, 3.2, -2.5, -3.9])
    for (const s of [-1, 1]) wheel(m, x, s * 1.05, 0.52, 0.42);
  m.box(-0.2, 0.55, 0, 11.0, 0.35, 1.1, S.steelDark);
  truckCab(m, 4.1, 1.8, 2.4, 2.0, 0.9, S.white, true);
  m.box(2.9, 0.9, 0, 1.6, 1.7, 1.8, S.white, { paint: true });
  m.box(-0.6, 0.9, 0, 7.8, 0.5, 2.0, S.steelDark);
  // the folded boom: three sections stacked on the deck
  m.box(-1.0, 2.6, 0.35, 8.8, 0.38, 0.42, S.white, { paint: true });
  m.box(-0.6, 3.0, 0.35, 7.6, 0.34, 0.36, S.white, { paint: true });
  m.box(-1.4, 3.36, 0.35, 6.6, 0.3, 0.32, S.white, { paint: true });
  m.box(3.2, 2.6, 0.35, 0.8, 1.0, 0.6, S.steelDark);
  m.cyl(-3.0, 1.4, -0.6, 0.12, 0.12, 6.0, 8, S.dark, { axis: 'x' });
  for (const x of [2.6, -2.6])
    for (const s of [-1, 1]) m.box(x, 0.4, s * 1.18, 0.5, 0.35, 0.14, S.hivis);
  m.box(-5.4, 0.8, 0, 0.9, 0.9, 1.8, S.steelDark);
}

function lowboy(m: Mesher) {
  for (const x of [7.0, 4.6, 3.4])
    for (const s of [-1, 1]) wheel(m, x, s * 1.1, 0.55, 0.42, { sides: 8 });
  for (const x of [-6.2, -7.3])
    for (const s of [-1, 1]) wheel(m, x, s * 1.1, 0.45, 0.42, { sides: 8 });
  m.box(5.4, 0.55, 0, 5.4, 0.35, 1.1, S.steelDark);
  truckCab(m, 6.0, 2.0, 2.5, 2.3, 0.9, S.red, false);
  for (const s of [-1, 1])
    m.cyl(5.85, 1.6, s * 1.05, 0.08, 0.08, 2.7, 6, S.chrome);
  m.box(2.8, 1.25, 0, 2.6, 0.5, 2.6, S.steelDark);
  m.box(-2.4, 0.55, 0, 8.4, 0.35, 3.0, S.steelDark);
  m.box(-6.8, 0.95, 0, 2.8, 0.4, 3.0, S.steelDark);
  m.box(1.75, 0.55, 0, 0.5, 1.2, 2.4, S.steelDark);
  for (const s of [-1, 1]) m.box(-2.4, 0.9, s * 1.45, 8.4, 0.08, 0.1, S.hivis);
  // a dozer as the load
  m.xf(-2.2, 0.9, 0, () =>
    dozer(m, { x: 0.72, y: 0.72, z: 0.72 }, false, false),
  );
}

function haulTruck(m: Mesher, k: K, paint: boolean, titan: boolean) {
  const q = scaled(m, k);
  const body = S.white;
  for (const s of [-1, 1]) {
    q.wheel(4.6, s * 3.4, 1.75, 1.4, { sides: 12, hub: S.machine });
    q.wheel(-3.4, s * 2.75, 1.75, 1.3, { sides: 12, hub: S.machine });
    q.wheel(-3.4, s * 4.2, 1.75, 1.3, { sides: 12, hub: S.machine });
  }
  q.box(0.5, 1.6, 0, 11.0, 1.2, 3.2, S.steelDark);
  q.box(5.6, 1.6, 0, 2.2, 2.0, 3.0, S.dark);
  q.box(6.73, 2.0, 0, 0.04, 1.4, 2.6, S.steelDark);
  q.box(5.5, 3.6, 0, 2.6, 0.3, 9.0, body, { paint });
  q.cab(5.1, 3.9, 2.9, 2.0, 2.0, 2.4, body, { paint });
  q.bar(7.4, 0.4, 6.6, 3.8, -3.2, 0.25, 0.9, S.steelDark);
  for (const s of [-1, 1])
    q.box(6.82, 3.25, s * 1.6, 0.04, 0.3, 0.6, S.lamp, { glow: true });
  railX(m, 4.3 * k.x, 6.75 * k.x, -4.35 * k.z, 3.9 * k.y, 1.0, S.hivis, 0.06);
  // the dump body with its canopy over the cab and the sloped tail
  q.box(-1.3, 3.0, 0, 11.0, 3.4, 9.0, body, { paint });
  q.box(5.3, 6.4, 0, 3.2, 0.35, 9.0, body, { paint });
  q.bar(-6.8, 3.3, -7.75, 4.6, 0, 0.4, 8.6, body, { paint });
  for (const x of [-5.5, -3.3, -1.1, 1.1, 3.3])
    for (const s of [-1, 1])
      q.box(x, 3.2, s * 4.52, 0.3, 3.0, 0.06, body, { paint });
  if (titan) {
    for (const s of [-1, 1]) q.box(-1.3, 5.0, s * 4.56, 10.6, 0.5, 0.04, S.red);
    q.box(-1.3, 6.38, 0, 9.0, 0.03, 7.0, S.red);
  }
  q.ball(-1.3, 6.4, 0, 5.0, 1.2, 4.0, 0xb0703a, {
    half: true,
    jitter: 0.12,
    seed: 3,
    seg: 10,
    rings: 6,
  });
}

// -------------------------------------------------------------------------------------- earth movers

function dozer(m: Mesher, k: K, paint: boolean, ripper = true) {
  const q = scaled(m, k);
  for (const s of [-1, 1]) q.track(-0.4, s * 1.2, 4.0, 0.9, 0.7);
  q.box(0.1, 0.9, 0, 2.6, 1.2, 1.8, S.machine, { paint });
  q.box(-1.2, 0.9, 0, 1.6, 0.5, 2.2, S.machine, { paint });
  q.cab(-1.2, 1.4, 0, 1.4, 1.9, 1.7, S.machine, { paint, glass0: 0.35 });
  q.box(-1.2, 3.3, 0, 1.6, 0.1, 1.9, S.dark);
  q.cyl(0.8, 2.1, -0.5, 0.08, 0.08, 0.9, 6, S.black);
  q.box(2.75, 0, 0, 0.3, 1.5, 3.4, S.machine, { paint });
  q.box(2.93, 0, 0, 0.06, 0.16, 3.3, S.steelDark);
  for (const s of [-1, 1])
    q.bar(0.6, 0.9, 2.6, 0.5, s * 1.25, 0.25, 0.25, S.steelDark);
  if (ripper) {
    q.box(-2.9, 0, 0, 0.2, 1.2, 0.25, S.steelDark);
    q.bar(-2.2, 0.8, -2.9, 1.1, 0, 0.25, 0.8, S.steelDark);
  }
}

function excavator(m: Mesher, k: K) {
  const q = scaled(m, k);
  for (const s of [-1, 1]) q.track(-1.5, s * 1.2, 4.6, 1.0, 0.75);
  q.box(-1.5, 1.0, 0, 2.4, 0.3, 2.0, S.steelDark);
  q.box(-1.9, 1.3, 0, 3.4, 1.3, 2.6, S.white, { paint: true });
  q.box(-3.85, 1.3, 0, 0.6, 1.2, 2.6, S.dark);
  q.cab(-0.75, 1.3, 0.78, 1.1, 1.8, 0.9, S.white, { paint: true, glass0: 0.3 });
  q.beacon(-0.9, 3.1, 0.78);
  q.bar(-0.4, 2.0, 2.6, 4.25, -0.35, 0.6, 0.55, S.white, { paint: true });
  q.bar(2.6, 4.25, 4.2, 1.05, -0.35, 0.45, 0.4, S.white, { paint: true });
  q.bar(-0.3, 1.6, 1.6, 3.6, -0.35, 0.22, 0.3, S.chrome);
  q.box(4.5, 0.05, -0.35, 0.9, 1.0, 1.2, S.steelDark);
  q.box(-2.4, 2.6, -0.6, 1.2, 0.5, 1.0, S.dark);
}

// -------------------------------------------------------------------------------------------- cranes

interface CraneSpec {
  w: number;
  d: number;
  h: number;
  /** Counter-jib share of the width. */
  cj: number;
}

/** Tower crane: footing, lattice mast, slewing ring, cab, jib (+X) and counter-jib with weights, cat-head ties, hook with a load. */
function towerCrane(m: Mesher, p: CraneSpec) {
  const { w, d, h } = p;
  const cjLen = w * p.cj;
  const x0 = -w / 2 + cjLen;
  const s = Math.min(d * 0.42, 2.4);
  const t = s * 0.1;
  const apex = Math.max(4, h * 0.11);
  const jibH = s * 0.9;
  const yJ = h - apex;
  const mastTop = yJ - 1.0;
  m.box(x0, 0, 0, Math.min(d, s * 2.2), 1.0, Math.min(d, s * 2.2), S.concrete);
  mast(m, x0, 0, 1.0, mastTop - 1.0, s, t, S.white, {
    paint: true,
    step: s * 1.5,
  });
  m.box(x0, mastTop, 0, s + 0.3, 1.0, s + 0.3, S.steelDark);
  cab(
    m,
    x0 + s * 0.5 + 0.7,
    mastTop - 0.4,
    s * 0.5 + 0.55,
    1.4,
    1.6,
    1.0,
    S.white,
    { glass0: 0.3 },
  );
  jib(m, x0, w / 2, yJ, s * 0.85, jibH, t * 0.9, S.white, {
    paint: true,
    step: jibH * 1.8,
  });
  m.box((-w / 2 + x0) / 2, yJ, 0, cjLen, 0.45, s * 0.85, S.white, {
    paint: true,
  });
  for (const sz of [-1, 1])
    m.box(
      (-w / 2 + x0) / 2,
      yJ + 0.45,
      sz * (s * 0.425 - 0.04),
      cjLen - 0.2,
      0.6,
      0.08,
      S.hivis,
    );
  m.box(-w / 2 + 1.3, yJ - 2.4, 0, 2.2, 2.4, s * 0.8, S.concrete);
  m.box(-w / 2 + 3.6, yJ - 2.0, 0, 2.0, 2.0, s * 0.8, S.concreteDark);
  m.box(x0, yJ, 0, s * 0.45, apex, s * 0.45, S.white, { paint: true });
  bar(
    m,
    x0,
    h - 0.2,
    x0 + (w / 2 - x0) * 0.62,
    yJ + jibH - 0.1,
    0,
    0.12,
    0.12,
    S.steelDark,
  );
  bar(m, x0, h - 0.2, -w / 2 + 0.6, yJ + 0.4, 0, 0.12, 0.1, S.steelDark);
  const tx = x0 + (w / 2 - x0) * 0.55;
  const hy = h * 0.28;
  m.box(tx, yJ - 0.45, 0, 1.0, 0.45, s * 0.7, S.dark);
  m.box(tx, hy + 0.9, 0, 0.06, yJ - 0.45 - hy - 0.9, 0.06, S.dark);
  m.box(tx, hy, 0, 0.7, 0.9, 0.5, S.hivis);
  m.box(tx, hy - 1.2, 0, Math.min(5, w * 0.16), 0.5, 0.9, S.primer);
  for (const sz of [-1, 1])
    bar(
      m,
      tx,
      hy,
      tx + sz * 1.6,
      hy - 0.7,
      0,
      0.04,
      sz > 0 ? 0.04 : 0.03,
      S.dark,
    );
}

/** Lattice boom built along X, then raised by `angle` about its foot at (x, y). */
function raisedBoom(
  m: Mesher,
  x: number,
  y: number,
  len: number,
  angle: number,
  s: number,
  hh: number,
  t: number,
  paint: boolean,
) {
  m.xf(
    x,
    y,
    0,
    () => jib(m, 0, len, -hh / 2, s, hh, t, S.white, { paint, step: hh * 1.7 }),
    0,
    0,
    angle,
  );
}

// ------------------------------------------------------------------------------------- buildings

/** Concrete frame: slabs every `fh` m, a grid of columns, optional stair core. */
function frame(
  m: Mesher,
  w: number,
  d: number,
  floors: number,
  fh: number,
  cols: number,
  rows: number,
  y0 = 0,
  slab = 0.3,
) {
  for (let f = 0; f <= floors; f++)
    m.box(0, y0 + f * fh, 0, w, slab, d, S.concrete);
  for (let f = 0; f < floors; f++)
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = -w / 2 + 0.6 + ((w - 1.2) * i) / (cols - 1);
        const z = -d / 2 + 0.6 + ((d - 1.2) * j) / (rows - 1);
        m.box(x, y0 + f * fh + slab, z, 0.45, fh - slab, 0.45, S.concreteLight);
      }
}

/** Climbing screens (orange) round the top floors of a tower under construction. */
function screens(m: Mesher, w: number, d: number, y0: number, h: number) {
  for (const s of [-1, 1]) {
    m.box(0, y0, s * (d / 2 + 0.25), w + 0.6, h, 0.1, S.hivis);
    m.box(s * (w / 2 + 0.25), y0, 0, 0.1, h, d + 0.4, S.hivis);
  }
}

/** High-rise under construction: glazed lower part (window tiles), open frame floors, the core on top. */
function highrise(
  m: Mesher,
  w: number,
  d: number,
  h: number,
  glazedTo: number,
  fh: number,
  color: number,
) {
  const core = Math.min(w, d) * 0.3;
  m.box(0, 0, 0, w - 0.4, glazedTo, d - 0.4, color, { wall: true });
  const floors = Math.floor((h - 2 - glazedTo) / fh);
  const top = glazedTo + floors * fh;
  for (let f = 1; f <= floors; f++)
    m.box(0, glazedTo + f * fh - 0.3, 0, w - 0.4, 0.3, d - 0.4, S.concrete);
  for (let f = 0; f < floors; f++)
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 0, 1]) {
        if (sx === 0 && sz === 0) continue;
        m.box(
          sx * (w / 2 - 0.8),
          glazedTo + f * fh,
          sz * (d / 2 - 0.8),
          0.6,
          fh - 0.3,
          0.6,
          S.concreteLight,
        );
      }
  m.box(0, glazedTo, 0, core, h - glazedTo, core, S.concreteDark);
  screens(m, w - 0.4, d - 0.4, top - fh * 1.5, fh * 1.4);
  return top;
}

/** Brick walls with window gaps: horizontal bands + piers, for one storey. */
function brickWalls(
  m: Mesher,
  w: number,
  d: number,
  y0: number,
  hh: number,
  t: number,
  color: number,
) {
  const sill = y0 + hh * 0.33;
  const lintel = y0 + hh * 0.8;
  for (const s of [-1, 1]) {
    m.box(0, y0, s * (d / 2 - t / 2), w, sill - y0, t, color);
    m.box(0, lintel, s * (d / 2 - t / 2), w, y0 + hh - lintel, t, color);
    m.box(s * (w / 2 - t / 2), y0, 0, t, hh, d - 2 * t, color);
    for (const f of [-0.5, -0.17, 0.17, 0.5]) {
      const x = f * (w - 0.8);
      m.box(x, sill, s * (d / 2 - t / 2), 0.8, lintel - sill, t, color);
    }
  }
}

export const MACHINE_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- tier 13 / 14
  site_van(m) {
    for (const x of [1.6, -1.6])
      for (const s of [-1, 1]) wheel(m, x, s * 0.85, 0.36, 0.24);
    m.box(-0.25, 0.3, 0, 4.4, 1.85, 1.95, S.white, { paint: true });
    m.box(2.15, 0.3, 0, 0.7, 0.8, 1.9, S.white, { paint: true });
    bar(m, 2.45, 1.08, 1.97, 2.1, 0, 0.06, 1.8, S.glassDark);
    m.box(1.4, 1.35, 0, 0.9, 0.55, 1.97, S.glassDark);
    for (const s of [-1, 1])
      m.box(-0.5, 2.15, s * 0.7, 3.0, 0.08, 0.06, S.dark);
    m.box(-0.5, 2.23, 0, 2.6, 0.05, 0.4, S.galv);
    beacon(m, 1.3, 2.15, 0, 0.08);
    for (const s of [-1, 1]) {
      m.box(2.506, 0.75, s * 0.65, 0.012, 0.15, 0.3, S.lamp, { glow: true });
      m.box(-2.456, 0.9, s * 0.8, 0.012, 0.3, 0.2, S.red);
    }
    m.box(-2.456, 0.4, 0, 0.012, 0.35, 1.3, S.hivis);
  },
  site_pickup(m) {
    for (const x of [1.6, -1.55])
      for (const s of [-1, 1]) wheel(m, x, s * 0.85, 0.38, 0.26);
    m.box(0, 0.35, 0, 5.2, 0.65, 1.9, S.white, { paint: true });
    m.box(0.45, 1.0, 0, 1.9, 0.82, 1.85, S.white, { paint: true, taper: 0.86 });
    m.box(0.45, 1.1, 0, 1.94, 0.5, 1.89, S.glassDark, { taper: 0.9 });
    for (const s of [-1, 1])
      m.box(-1.55, 1.0, s * 0.91, 2.1, 0.4, 0.08, S.white, { paint: true });
    m.box(-2.56, 1.0, 0, 0.08, 0.4, 1.9, S.white, { paint: true });
    m.box(-1.0, 1.0, 0, 0.6, 0.3, 1.5, S.steelDark);
    m.box(-1.9, 1.0, 0.2, 1.0, 0.25, 0.8, S.timber);
    beacon(m, 0.45, 1.82, 0, 0.06);
    for (const s of [-1, 1])
      m.box(2.606, 0.7, s * 0.65, 0.012, 0.15, 0.3, S.lamp, { glow: true });
  },
  telehandler(m) {
    for (const x of [1.55, -1.55])
      for (const s of [-1, 1]) wheel(m, x, s * 0.85, 0.6, 0.45);
    m.box(0, 0.45, 0, 3.6, 0.6, 1.2, S.white, { paint: true });
    cab(m, -0.2, 0.75, 0.62, 1.3, 1.6, 0.9, S.white, {
      paint: true,
      glass0: 0.3,
    });
    m.box(-0.5, 1.05, -0.55, 1.6, 0.6, 0.8, S.white, { paint: true });
    bar(m, -1.9, 1.6, 2.3, 1.3, -0.05, 0.42, 0.45, S.white, { paint: true });
    m.box(2.35, 0.08, -0.05, 0.12, 1.2, 1.0, S.steelDark);
    for (const s of [-1, 1])
      m.box(2.6, 0.08, s * 0.3, 0.4, 0.06, 0.12, S.steelDark);
    beacon(m, -0.3, 2.35, 0.62);
  },
  bulldozer(m) {
    dozer(m, ONE, true);
  },
  backhoe(m) {
    wheel(m, 1.5, 0.85, 0.5, 0.35);
    wheel(m, 1.5, -0.85, 0.5, 0.35);
    wheel(m, -0.9, 0.85, 0.75, 0.5);
    wheel(m, -0.9, -0.85, 0.75, 0.5);
    m.box(0.4, 0.55, 0, 3.2, 0.75, 1.3, S.white, { paint: true });
    m.box(1.3, 1.3, 0, 1.4, 0.6, 1.1, S.white, { paint: true });
    cab(m, -0.5, 1.3, 0, 1.5, 1.7, 1.6, S.cab, { glass0: 0.2 });
    m.box(-0.5, 3.0, 0, 1.7, 0.08, 1.8, S.white, { paint: true });
    for (const s of [-1, 1])
      bar(m, 0.0, 2.2, 2.55, 0.8, s * 0.95, 0.2, 0.18, S.white, {
        paint: true,
      });
    m.box(2.75, 0.1, 0, 0.6, 0.8, 2.3, S.steelDark);
    bar(m, -1.3, 1.4, -2.2, 3.62, 0, 0.3, 0.3, S.white, { paint: true });
    bar(m, -2.2, 3.62, -2.9, 1.0, 0, 0.25, 0.25, S.white, { paint: true });
    m.box(-2.95, 0.3, 0, 0.45, 0.7, 0.6, S.steelDark);
    for (const s of [-1, 1]) m.box(-1.5, 0, s * 0.95, 0.3, 0.8, 0.3, S.dark);
  },
  asphalt_paver(m) {
    for (const s of [-1, 1]) track(m, 0.4, s * 1.05, 3.6, 0.7, 0.5);
    m.box(2.3, 0.7, 0, 1.6, 0.25, 2.2, S.steelDark);
    for (const s of [-1, 1])
      barZ(m, s * 1.1, 0.7, s * 1.5, 1.6, 2.3, 0.08, 1.6, S.white);
    m.box(3.12, 0.6, 0, 0.1, 0.8, 2.2, S.white, { paint: true });
    m.box(0.2, 0.7, 0, 2.6, 1.3, 2.4, S.white, { paint: true });
    m.box(-2.6, 0.1, 0, 0.9, 0.6, 3.1, S.white, { paint: true });
    m.box(-1.5, 0.7, 0, 1.4, 0.15, 2.6, S.dark);
    for (const s of [-1, 1]) m.box(-1.3, 0.85, s * 0.7, 0.5, 0.9, 0.5, S.dark);
    for (const x of [-1.9, -0.9])
      for (const s of [-1, 1])
        m.box(x, 0.85, s * 1.2, 0.08, 2.65, 0.08, S.dark);
    m.box(-1.4, 3.5, 0, 1.6, 0.1, 2.8, S.white, { paint: true });
    m.cyl(0.6, 2.0, -0.7, 0.09, 0.09, 1.0, 6, S.black);
    m.box(1.2, 0.6, 0, 0.6, 0.5, 2.0, S.tarmac);
  },
  // ---------------------------------------------------------------- tier 15 / 16
  foundation_slab(m) {
    m.box(0, 0, 0, 7.2, 0.3, 7.2, S.concrete);
    for (const s of [-1, 1]) {
      m.box(0, 0, s * 3.65, 7.4, 0.4, 0.1, S.ply);
      m.box(s * 3.65, 0, 0, 0.1, 0.4, 7.2, S.ply);
    }
    for (const x of [-3, -1, 1, 3])
      for (const z of [-3, -1, 1, 3]) m.box(x, 0.3, z, 0.06, 0.6, 0.06, S.rust);
    m.box(1.8, 0.3, -1.8, 1.2, 0.5, 0.9, S.concreteLight);
  },
  wheel_loader(m) {
    for (const x of [1.4, -1.6])
      for (const s of [-1, 1]) wheel(m, x, s * 1.0, 0.75, 0.6);
    m.box(-1.9, 0.6, 0, 2.6, 1.3, 1.6, S.white, { paint: true });
    m.box(-3.3, 0.5, 0, 0.3, 1.1, 1.8, S.dark);
    cab(m, -0.55, 1.4, 0, 1.4, 1.7, 1.5, S.white, { paint: true, glass0: 0.3 });
    m.box(-0.55, 3.1, 0, 1.6, 0.1, 1.7, S.white, { paint: true });
    beacon(m, -0.8, 3.2, 0);
    m.box(0.9, 0.6, 0, 1.6, 0.8, 1.2, S.white, { paint: true });
    for (const s of [-1, 1])
      bar(m, 0.4, 1.7, 2.9, 1.0, s * 0.7, 0.3, 0.25, S.white, { paint: true });
    m.box(3.3, 0.05, 0, 0.9, 1.2, 2.8, S.steelDark);
    m.cyl(-2.6, 1.9, -0.5, 0.08, 0.08, 0.8, 6, S.black);
  },
  piling_rig(m) {
    for (const s of [-1, 1]) track(m, -0.8, s * 1.6, 5.0, 1.0, 0.9);
    m.box(-1.6, 1.1, 0, 3.6, 1.8, 2.8, S.white, { paint: true });
    m.box(-3.6, 1.0, 0, 0.6, 1.6, 2.8, S.dark);
    cab(m, 0.9, 1.1, 1.0, 1.4, 2.0, 1.2, S.cab, { glass0: 0.3 });
    m.box(3.0, 0, 0, 1.2, 0.6, 1.2, S.dark);
    mast(m, 3.0, 0, 0.6, 29.0, 0.9, 0.14, S.white, { paint: true, step: 2.0 });
    m.box(3.0, 18, 0, 1.2, 4.0, 1.2, S.steelDark);
    m.cyl(3.0, 0.6, 0, 0.3, 0.3, 17.4, 8, S.concrete);
    m.box(3.0, 29.6, 0, 1.0, 0.4, 0.6, S.dark);
    for (const s of [-1, 1])
      bar(m, -0.2, 2.9, 2.55, 15, s * 0.6, 0.2, 0.2, S.steelDark);
  },
  dump_truck(m) {
    dumpTruck(m);
  },
  house_frame(m) {
    m.box(0, 0, 0, 8.8, 0.3, 7.4, S.concrete);
    for (const s of [-1, 1]) {
      for (let x = -4.25; x <= 4.26; x += 0.85)
        m.box(x, 0.3, s * 3.55, 0.1, 2.6, 0.15, S.timber);
      for (let z = -2.8; z <= 2.81; z += 0.8)
        m.box(s * 4.3, 0.3, z, 0.15, 2.6, 0.1, S.timber);
      m.box(0, 2.9, s * 3.55, 8.7, 0.1, 0.2, S.timberDark);
      m.box(s * 4.3, 2.9, 0, 0.2, 0.1, 6.9, S.timberDark);
    }
    for (const x of [-4.0, -2.4, -0.8, 0.8, 2.4, 4.0]) {
      barZ(m, -3.7, 3.0, 0, 6.36, x, 0.15, 0.1, S.timberDark);
      barZ(m, 3.7, 3.0, 0, 6.36, x, 0.15, 0.08, S.timberDark);
      m.box(x, 3.0, 0, 0.14, 0.12, 7.4, S.timberDark);
    }
    m.box(0, 6.3, 0, 8.8, 0.15, 0.15, S.timberDark);
    m.box(-2.5, 0.3, 3.685, 3.0, 2.6, 0.02, S.ply);
    m.box(-4.385, 0.3, 1.5, 0.02, 2.6, 3.0, S.ply);
  },
  motor_grader(m) {
    for (const x of [3.6, -2.2, -3.6])
      for (const s of [-1, 1]) wheel(m, x, s * 0.95, 0.6, 0.4);
    m.box(1.2, 1.3, 0, 5.0, 0.45, 0.6, S.white, { paint: true });
    m.box(3.6, 0.6, 0, 0.5, 1.0, 1.4, S.white, { paint: true });
    m.xf(0.6, 0, 0, () => m.box(0, 0.05, 0, 0.25, 0.7, 2.7, S.steelDark), 0.5);
    m.box(0.8, 0.75, 0, 1.6, 0.15, 1.2, S.steelDark);
    m.box(-3.0, 0.9, 0, 2.6, 1.3, 1.9, S.white, { paint: true });
    cab(m, -1.1, 0.9, 0, 1.6, 2.4, 1.9, S.white, { paint: true, glass0: 0.45 });
    m.box(-1.1, 3.3, 0, 1.8, 0.1, 2.1, S.white, { paint: true });
    m.box(-4.4, 0.0, 0, 0.2, 0.8, 1.6, S.steelDark);
  },
  // ---------------------------------------------------------------- tier 17 / 18
  drill_rig(m) {
    for (const s of [-1, 1]) track(m, -1.2, s * 1.1, 5.0, 0.9, 0.6);
    m.box(-2.2, 0.9, 0, 3.6, 1.6, 2.2, S.machine);
    m.box(-4.2, 0.9, 0, 0.8, 1.2, 1.8, S.steelDark);
    cab(m, 1.0, 0.9, 0.7, 1.4, 1.9, 1.3, S.cab, { glass0: 0.3 });
    bar(m, 0.2, 1.6, 4.0, 1.8, -0.3, 0.4, 0.4, S.machine);
    m.box(4.2, 0, 0, 1.0, 0.25, 1.0, S.dark);
    mast(m, 4.2, 0, 0.25, 8.75, 0.8, 0.12, S.machine, { step: 1.6 });
    m.cyl(4.2, 0.25, 0, 0.12, 0.12, 8.4, 6, S.steel);
    for (const s of [-1, 1])
      m.cyl(-3.0, 2.5, s * 0.5, 0.3, 0.3, 1.2, 8, S.steel, { axis: 'x' });
  },
  mixer_truck(m) {
    mixerTruck(m);
  },
  excavator(m) {
    excavator(m, ONE);
  },
  house_shell(m) {
    m.box(0, 0, 0, 10, 0.25, 8, S.concrete);
    brickWalls(m, 9.6, 7.6, 0.25, 2.6, 0.3, S.brick);
    m.box(0, 2.85, 0, 9.6, 0.25, 7.6, S.concrete);
    brickWalls(m, 9.6, 7.6, 3.1, 2.5, 0.3, 0xc46a3e);
    for (const x of [-4.2, -2.6]) {
      barZ(m, -3.8, 5.6, 0, 6.92, x, 0.15, 0.1, S.timberDark);
      barZ(m, 3.8, 5.6, 0, 6.92, x, 0.15, 0.08, S.timberDark);
    }
    m.box(-3.4, 6.8, 0, 2.0, 0.15, 0.15, S.timberDark);
    // scaffold along the front (+Z)
    for (let x = -4.5; x <= 4.51; x += 1.8)
      m.box(x, 0.25, 4.15, 0.06, 5.9, 0.06, S.galv);
    for (const y of [2.8, 5.6]) {
      m.box(0, y, 4.15, 9.2, 0.05, 0.05, S.galv);
      m.box(0, y + 0.05, 4.0, 9.1, 0.05, 0.3, S.ply);
    }
    m.box(0, 3.0, 4.15, 9.2, 0.04, 0.04, S.galv);
  },
  articulated_hauler(m) {
    wheel(m, 3.8, 1.25, 0.85, 0.7);
    wheel(m, 3.8, -1.25, 0.85, 0.7);
    for (const x of [-1.5, -3.6])
      for (const s of [-1, 1]) wheel(m, x, s * 1.25, 0.85, 0.7);
    m.box(4.0, 0.8, 0, 1.8, 1.4, 1.8, S.white, { paint: true });
    cab(m, 2.6, 1.1, 0, 1.6, 2.2, 1.9, S.white, { paint: true, glass0: 0.35 });
    m.box(2.6, 3.3, 0, 1.8, 0.1, 2.0, S.white, { paint: true });
    beacon(m, 2.4, 3.4, 0);
    m.box(1.6, 0.8, 0, 0.8, 0.8, 1.0, S.dark);
    m.box(-2.4, 0.9, 0, 5.0, 0.5, 1.2, S.steelDark);
    m.box(-2.0, 1.4, 0, 6.0, 1.8, 3.0, S.white, { paint: true });
    load(m, -2.2, 3.2, 0, 2.6, 0.5, 1.2);
  },
  big_excavator(m) {
    excavator(m, { x: 12 / 9.8, y: 5.6 / 4.6, z: 3.8 / 3.2 });
  },
  foundation_pit(m) {
    m.box(0, 0, 0, 12, 0.15, 9, S.concreteDark);
    for (let i = 0; i < 8; i++)
      m.box(0, 0.15, -3.8 + i * 1.08, 11.2, 0.04, 0.04, S.rust);
    for (let i = 0; i < 10; i++)
      m.box(-5.2 + i * 1.15, 0.19, 0, 0.04, 0.04, 8.2, S.rust);
    for (const s of [-1, 1]) {
      m.box(0, 0, s * 4.4, 12, 1.2, 0.2, S.ply);
      m.box(s * 5.9, 0, 0, 0.2, 1.2, 8.6, S.ply);
      m.box(0, 0.5, s * 4.53, 12, 0.12, 0.06, S.timberDark);
    }
    m.box(2, 0.15, 1, 3, 0.012, 2, S.water);
    m.box(-3.5, 0.15, -2.0, 2.2, 0.8, 0.8, 0x8a4a2e);
  },
  pump_truck(m) {
    pumpTruck(m);
  },
  // ---------------------------------------------------------------- tier 19
  mining_dozer(m) {
    dozer(m, { x: 12.8 / 6.2, y: 4.8 / 3.4, z: 6.0 / 3.4 }, false);
  },
  truck_crane(m) {
    for (const x of [4.6, 3.2, -2.6, -4.0])
      for (const s of [-1, 1]) wheel(m, x, s * 1.15, 0.6, 0.45);
    m.box(0, 0.7, 0, 12.4, 0.6, 2.5, S.white, { paint: true });
    cab(m, 5.6, 0.7, 0.55, 1.6, 1.9, 1.3, S.white, {
      paint: true,
      glass0: 0.4,
    });
    m.box(-3.6, 1.3, 0, 3.0, 1.2, 2.4, S.white, { paint: true });
    m.box(-5.6, 1.3, 0, 1.0, 1.4, 2.4, S.dark);
    cab(m, -2.6, 1.3, 0.9, 1.0, 1.4, 0.7, S.white, {
      paint: true,
      glass0: 0.35,
    });
    m.box(1.2, 2.5, -0.35, 10.8, 0.9, 0.9, S.white, { paint: true });
    m.box(6.45, 2.6, -0.35, 0.5, 0.7, 0.7, S.steelDark);
    m.box(6.5, 1.5, -0.35, 0.4, 0.8, 0.4, S.hivis);
    m.box(6.5, 3.4, -0.35, 0.08, 0.6, 0.08, S.dark);
    beacon(m, 5.4, 2.6, 0.55);
  },
  self_erecting_crane(m) {
    m.box(-4.0, 0, 0, 3.2, 0.8, 4.0, S.concrete);
    for (const s of [-1, 1])
      m.box(-4.0, 0, s * 1.2, 3.6, 0.3, 0.4, S.white, { paint: true });
    mast(m, -4.0, 0, 0.8, 20.5, 1.2, 0.14, S.white, { paint: true, step: 1.8 });
    m.box(-4.0, 21.3, 0, 1.4, 0.4, 1.4, S.dark);
    m.box(-4.0, 21.7, 0, 0.25, 0.3, 0.25, S.white, { paint: true });
    jib(m, -4.0, 7.0, 20.6, 0.9, 0.7, 0.1, S.white, { paint: true, step: 1.2 });
    bar(m, -4.0, 21.9, 3.0, 21.3, 0, 0.06, 0.06, S.dark);
    m.box(3.0, 20.25, 0, 0.6, 0.3, 0.8, S.dark);
    m.box(3.0, 8.0, 0, 0.04, 12.25, 0.04, S.dark);
    m.box(3.0, 7.3, 0, 0.4, 0.7, 0.3, S.hivis);
    m.box(-2.0, 0.8, 1.6, 0.6, 1.0, 0.5, S.dark);
  },
  apartment_frame(m) {
    frame(m, 14, 12, 4, 3.4, 3, 3);
    m.box(4.0, 0.3, -3.0, 3.0, 13.6, 3.0, S.concreteDark);
    for (const x of [-6.4, 0, 6.4])
      for (const z of [-5.4, 5.4]) m.box(x, 13.9, z, 0.06, 0.1, 0.06, S.rust);
    railX(m, -6.9, 6.9, 5.95, 13.9, 0.08, S.hivis, 0.05);
  },
  // ---------------------------------------------------------------- tier 20
  haul_truck(m) {
    haulTruck(m, ONE, true, false);
  },
  rock_crusher(m) {
    for (const s of [-1, 1]) track(m, 0, s * 2.2, 9.0, 1.4, 1.2);
    m.box(0, 1.4, 0, 12.0, 1.0, 3.6, S.steelDark);
    m.box(-4.2, 2.4, 0, 2.6, 2.0, 2.6, S.steelDark);
    m.box(-4.2, 4.4, 0, 3.0, 2.4, 3.0, S.machine, { taper: 1.6 });
    m.box(0, 2.4, 0, 3.2, 3.6, 3.0, S.machine);
    for (const s of [-1, 1])
      m.cyl(0.6, 4.6, s * 1.62, 1.3, 1.3, 0.25, 12, S.steelDark, { axis: 'z' });
    m.box(0, 6.0, 0, 3.6, 2.2, 3.4, S.machine);
    railX(m, -1.8, 1.8, 1.7, 8.2, 0.8, S.hivis, 0.06);
    bar(m, 2.0, 1.6, 7.9, 5.0, 0, 0.5, 1.2, S.steelDark);
    bar(m, 2.0, 2.0, 7.9, 5.4, 0, 0.15, 1.0, S.rubber);
    m.cyl(-5.0, 2.4, 0, 0.2, 0.2, 2.0, 6, S.black);
  },
  apartment_shell(m) {
    m.box(0, 0, 0, 15.6, 12.8, 11.6, S.cream, { wall: true });
    frame(m, 15.6, 11.6, 2, 3.2, 4, 3, 12.8);
    m.box(4.5, 12.8, -2.5, 3.0, 6.4, 3.0, S.concreteDark);
    railX(m, -7.6, 7.6, 5.6, 19.4, 0.6, S.hivis, 0.06);
    for (let x = -7.2; x <= 7.21; x += 2.4)
      m.box(x, 0, 6.15, 0.08, 19.2, 0.08, S.galv);
    for (let y = 2.0; y < 19; y += 2.0) {
      m.box(0, y, 6.15, 14.6, 0.05, 0.05, S.galv);
      m.box(0, y + 0.05, 6.0, 14.5, 0.05, 0.3, S.ply);
    }
  },
  lowboy(m) {
    lowboy(m);
  },
  // ---------------------------------------------------------------- tier 21
  mobile_crane(m) {
    for (const x of [-7.2, -5.8, -2.0, -0.6, 1.0])
      for (const s of [-1, 1]) wheel(m, x, s * 1.2, 0.65, 0.45);
    m.box(-2.5, 0.75, 0, 13.0, 0.7, 2.6, S.white, { paint: true });
    cab(m, 3.2, 0.75, 0.6, 1.6, 2.0, 1.3, S.white, {
      paint: true,
      glass0: 0.4,
    });
    m.box(-6.0, 1.45, 0, 4.0, 1.4, 2.6, S.white, { paint: true });
    m.box(-8.3, 1.45, 0, 1.4, 1.6, 2.8, S.dark);
    cab(m, -4.2, 1.45, 1.0, 1.2, 1.8, 0.8, S.white, {
      paint: true,
      glass0: 0.35,
    });
    const ang = (66 * Math.PI) / 180;
    const foot: [number, number] = [-5.0, 2.8];
    const tip = (L: number): [number, number] => [
      foot[0] + Math.cos(ang) * L,
      foot[1] + Math.sin(ang) * L,
    ];
    const [x1, y1] = tip(11);
    const [x2, y2] = tip(21);
    const [x3, y3] = tip(29.4);
    bar(m, foot[0], foot[1], x1, y1, 0, 1.0, 1.0, S.white, { paint: true });
    bar(m, x1 - 0.5, y1 - 1.1, x2, y2, 0, 0.8, 0.8, S.white, { paint: true });
    bar(m, x2 - 0.4, y2 - 0.9, x3, y3, 0, 0.6, 0.6, S.white, { paint: true });
    m.box(x3 + 0.3, 5.9, 0, 0.05, y3 - 6.2, 0.05, S.dark);
    m.box(x3 + 0.3, 5.0, 0, 0.6, 1.0, 0.5, S.hivis);
    bar(m, -6.4, 2.85, -4.6, 6.0, 0, 0.6, 0.6, S.steelDark);
  },
  batching_plant(m) {
    m.box(-4.0, 0, 0, 6.0, 16.0, 6.0, S.white);
    m.box(-4.0, 6.0, 0, 6.06, 0.8, 6.06, S.blue);
    m.box(-4.0, 3.005, 3.0, 3.0, 3.0, 0.02, S.dark);
    m.box(-4.0, 16.0, 0, 5.0, 2.5, 5.0, S.grey);
    railX(m, -6.4, -1.6, 2.4, 18.5, 1.0, S.hivis, 0.08);
    m.box(4.5, 0, -2.5, 8.0, 5.5, 3.6, S.galv);
    m.box(4.5, 5.5, -2.5, 7.4, 3.0, 3.6, S.steel, { taper: 1.15 });
    bar(m, 6.0, 2.0, -1.2, 15.0, 2.0, 0.6, 1.2, S.steelDark);
    for (const z of [-2.4, 2.4]) {
      m.cyl(-7.4, 2.0, z, 0.4, 1.5, 1.0, 10, S.light);
      m.cyl(-7.4, 3.0, z, 1.5, 1.5, 16.0, 10, S.light);
      m.cyl(-7.4, 19.0, z, 1.5, 0.3, 0.5, 10, S.light);
      for (const s of [-1, 1])
        m.box(-7.4 + s * 1.0, 0, z, 0.2, 2.2, 0.2, S.galv);
    }
    m.box(2.0, 0, 3.8, 4.0, 2.8, 2.2, S.white);
    m.box(2.0, 1.2, 4.91, 2.6, 0.8, 0.02, S.glassDark);
  },
  office_frame(m) {
    const xs = [-8.6, -3.4, 3.4, 8.6];
    for (const x of xs)
      for (const z of xs) m.box(x, 0, z, 0.5, 24, 0.5, S.primer);
    for (let f = 1; f <= 5; f++) {
      const y = f * 4;
      for (const z of [-8.6, 8.6])
        m.box(0, y - 0.5, z, 17.6, 0.45, 0.35, S.primer);
      for (const x of [-8.6, 8.6])
        m.box(x, y - 0.5, 0, 0.35, 0.45, 17.6, S.primer);
      for (const z of [-3.4, 3.4])
        m.box(0, y - 0.5, z, 17.4, 0.4, 0.3, S.primer);
      if (f <= 3) m.box(0, y - 0.05, 0, 17.6, 0.2, 17.6, S.concrete);
    }
    for (let f = 0; f < 3; f++) {
      bar(m, -8.6, f * 4 + 0.3, -3.4, f * 4 + 3.4, 8.75, 0.2, 0.12, S.primer);
      barZ(m, -8.6, f * 4 + 0.3, -3.4, f * 4 + 3.4, 8.75, 0.2, 0.12, S.primer);
    }
    m.box(0, 12.15, 0, 3, 1.2, 2, S.steelDark);
  },
  // ---------------------------------------------------------------- tier 22
  highrise_shell(m) {
    highrise(m, 20, 20, 44, 30, 4, S.light);
  },
  mining_shovel(m) {
    for (const s of [-1, 1]) track(m, -2.0, s * 3.6, 9.0, 2.2, 2.4);
    m.box(-2.0, 2.2, 0, 5.0, 1.0, 5.0, S.steelDark);
    m.box(-3.6, 3.2, 0, 8.0, 4.4, 7.6, S.machine);
    m.box(-7.9, 3.0, 0, 1.4, 3.4, 7.0, S.dark);
    m.box(-4.5, 7.6, 0, 5.0, 1.6, 5.0, S.white);
    cab(m, -0.6, 7.6, 2.4, 2.2, 2.4, 2.2, S.white, { glass0: 0.35 });
    railX(m, -7.4, 0.3, -3.7, 7.6, 1.0, S.hivis, 0.08);
    bar(m, 0.4, 5.0, 6.5, 12.2, 0, 1.4, 1.6, S.machine);
    for (const s of [-1, 1])
      bar(m, 0.6, 7.0, 5.6, 15.4, s * 1.2, 0.5, 0.5, S.chrome);
    bar(m, 6.5, 12.2, 8.6, 4.0, 0, 1.2, 1.4, S.machine);
    m.box(9.2, 0.8, 0, 2.6, 4.6, 4.6, S.steelDark);
    for (const z of [-1.6, -0.55, 0.55, 1.6])
      m.box(10.45, 0.8, z, 0.1, 0.5, 0.5, S.steel);
    ladder(m, -5.0, 3.85, 0.3, 3.2);
    for (const s of [-1, 1])
      m.box(-0.2, 6.5, s * 2.0, 0.06, 0.4, 0.8, S.lamp, { glow: true });
  },
  tower_crane_s(m, _v, w, d, h) {
    towerCrane(m, { w, d, h, cj: 0.28 });
  },
  conveyor(m) {
    const y = (x: number) => 1.2 + ((x + 10.6) * (8.4 - 1.2)) / 21;
    bar(m, -10.6, 1.2, 10.4, 8.4, 0, 0.8, 1.6, S.steelDark);
    bar(m, -10.6, 1.75, 10.4, 8.95, 0, 0.15, 1.2, S.rubber);
    for (const x of [-6, -1, 4, 8]) {
      for (const s of [-1, 1])
        m.box(x, 0, s * 1.1, 0.25, y(x) - 0.35, 0.25, S.galv);
      m.box(x, y(x) - 0.6, 0, 0.2, 0.2, 2.4, S.galv);
    }
    m.cyl(-10.6, 1.2, 0, 0.5, 0.5, 1.8, 10, S.steelDark, { axis: 'z' });
    m.box(10.4, 7.6, 0, 1.2, 1.4, 2.0, S.machine);
    m.box(-9.6, 1.2, 0, 1.2, 1.2, 2.0, S.machine, { taper: 1.3 });
    for (const [x, r] of [
      [-6.5, 0.5],
      [-2.0, 0.45],
      [2.5, 0.55],
      [6.5, 0.4],
    ])
      m.ball(x, y(x) + 0.65, 0, r * 1.3, r, r, 0xb0703a, {
        jitter: 0.2,
        seed: 5,
        seg: 6,
        rings: 4,
      });
  },
  // ---------------------------------------------------------------- tier 23
  highrise_tall(m) {
    highrise(m, 24, 24, 60, 44, 4, S.glass);
  },
  titan_truck(m) {
    haulTruck(m, { x: 25 / 15.6, y: 12 / 7.6, z: 15 / 9.8 }, false, true);
  },
  crawler_crane(m) {
    for (const s of [-1, 1]) track(m, -6.0, s * 2.9, 9.0, 1.4, 1.6);
    m.box(-6.0, 1.4, 0, 4.0, 0.8, 4.0, S.steelDark);
    m.box(-7.0, 2.2, 0, 7.0, 3.0, 4.6, S.white, { paint: true });
    m.box(-11.5, 1.8, 0, 2.0, 3.0, 5.0, S.dark);
    cab(m, -3.0, 2.2, 2.0, 1.4, 2.0, 1.2, S.white, {
      paint: true,
      glass0: 0.35,
    });
    const ang = Math.atan2(36, 15.5);
    const L = Math.hypot(36, 15.5);
    raisedBoom(m, -3.5, 3.0, L, ang, 1.8, 1.6, 0.18, true);
    const tx = -3.5 + 15.5;
    const ty = 3.0 + 36;
    m.box(tx, ty - 0.6, 0, 1.2, 1.6, 1.4, S.white, { paint: true });
    for (const s of [-1, 1])
      bar(m, -8.0, 5.2, -6.5, 9.0, s * 1.2, 0.3, 0.3, S.steelDark);
    bar(m, tx, ty, -6.5, 9.0, 0, 0.08, 0.06, S.dark);
    m.box(tx + 0.4, 12.9, 0, 0.06, ty - 0.6 - 12.9, 0.06, S.dark);
    m.box(tx + 0.4, 12.0, 0, 0.8, 0.9, 0.6, S.hivis);
    m.box(tx + 0.4, 10.6, 0, 1.6, 1.4, 1.6, S.concreteLight);
  },
  tower_crane(m, _v, w, d, h) {
    towerCrane(m, { w, d, h, cj: 0.27 });
  },
  // ---------------------------------------------------------------- tier 24
  skyscraper_core(m) {
    highrise(m, 28, 28, 50, 28, 4, S.light);
    m.box(0, 48, 0, 12, 28, 12, S.concreteDark);
    m.box(0, 76, 0, 14, 3.2, 14, S.machine);
    for (const s of [-1, 1]) m.box(0, 77.6, s * 7.15, 14.2, 2.2, 0.1, S.hivis);
    m.box(4, 79.2, 4, 1.5, 0.8, 1.5, S.dark);
  },
  dragline(m) {
    m.cyl(-4.0, 0, 0, 6.5, 6.5, 1.2, 16, S.steelDark);
    for (const s of [-1, 1])
      m.box(-4.0, 0, s * 6.1, 6.0, 1.0, 1.6, S.steelDark);
    m.box(-5.0, 1.2, 0, 12.0, 6.0, 9.0, S.white);
    m.box(-6.0, 7.2, 0, 8.0, 1.6, 7.0, S.machine);
    m.box(-12.5, 1.8, 0, 3.0, 4.0, 8.0, S.dark);
    cab(m, 1.6, 2.0, 3.0, 2.2, 2.4, 2.2, S.white, { glass0: 0.35 });
    for (const s of [-1, 1]) {
      bar(m, -3.0, 7.2, -1.0, 18.0, s * 3.0, 0.5, 0.5, S.machine);
      bar(m, -8.0, 8.8, -1.0, 18.0, s * 3.0, 0.5, 0.4, S.machine);
    }
    m.box(-1.0, 17.8, 0, 0.6, 0.6, 6.6, S.machine);
    m.box(-1.0, 18.4, 0, 1.2, 1.2, 1.2, S.steelDark);
    const ang = (32 * Math.PI) / 180;
    const L = 15.4;
    raisedBoom(m, 1.0, 3.0, L, ang, 2.6, 2.0, 0.22, false);
    const tx = 1.0 + Math.cos(ang) * L;
    const ty = 3.0 + Math.sin(ang) * L;
    bar(m, tx, ty, -1.0, 18.4, 0, 0.1, 0.1, S.dark);
    m.box(12.0, 0.4, 0, 3.6, 2.6, 3.2, S.steelDark);
    for (const z of [-1.1, 0, 1.1])
      m.box(13.85, 0.4, z, 0.1, 0.4, 0.5, S.steel);
    m.box(tx - 0.3, 3.0, 0, 0.06, ty - 3.0, 0.06, S.dark);
    bar(m, 10.2, 1.8, 2.0, 3.0, 0, 0.1, 0.1, S.dark);
  },
  tower_crane_l(m, _v, w, d, h) {
    towerCrane(m, { w, d, h, cj: 0.27 });
  },
  // ---------------------------------------------------------------- tier 25
  tower_topping(m) {
    m.box(0, 0, 0, 31.6, 40, 31.6, S.glass, { wall: true });
    m.box(0, 40, 0, 26, 32, 26, S.glass, { wall: true });
    const top = highrise(m, 20, 20, 88, 72, 4, S.glass);
    m.box(0, top, 0, 6.0, 1.0, 6.0, S.concrete);
    mast(m, 0, 0, 72 + 1, 96 - 73 - 3.5, 1.2, 0.14, S.yellow, { step: 1.8 });
    jib(m, 0, 9.5, 92.6, 0.9, 0.8, 0.1, S.yellow, { step: 1.4 });
    m.box(-2.5, 92.6, 0, 5.0, 0.4, 0.9, S.yellow);
    m.box(-4.0, 91.4, 0, 1.6, 1.2, 0.8, S.concrete);
    m.cyl(-6, top, -6, 0.9, 0.0, 2.6, 6, S.darkGreen);
    m.box(0, 95.4, 0, 0.4, 0.6, 0.4, S.yellow);
  },
  giant_tower_crane(m, _v, w, d, h) {
    towerCrane(m, { w, d, h, cj: 0.26 });
  },
  bucket_wheel(m) {
    for (const s of [-1, 1]) track(m, -2.0, s * 4.2, 10.0, 2.2, 2.8);
    m.box(-2.0, 2.2, 0, 7.0, 1.8, 7.0, S.steelDark);
    m.cyl(-2.0, 4.0, 0, 3.8, 3.8, 1.0, 16, S.steelDark);
    m.box(-3.0, 5.0, 0, 9.0, 4.0, 6.0, S.white);
    m.box(-2.5, 9.0, 0, 2.0, 11.0, 2.0, S.white);
    m.box(-2.5, 20.0, 0, 3.0, 1.0, 3.0, S.dark);
    bar(m, 1.0, 7.5, 12.5, 5.5, 0, 1.6, 2.0, S.machine);
    bar(m, 1.0, 8.4, 12.5, 6.4, 0, 0.15, 1.4, S.rubber);
    m.cyl(13.6, 6.2, 0, 3.6, 3.6, 1.2, 16, S.machine, { axis: 'z' });
    m.cyl(13.6, 6.2, 0.62, 1.0, 1.0, 0.1, 10, S.steelDark, { axis: 'z' });
    for (let i = 0; i < 10; i++)
      m.xf(
        13.6,
        6.2,
        0,
        () => m.box(0, 3.25, 0, 1.3, 0.8, 1.5, S.steelDark),
        0,
        0,
        (i / 10) * Math.PI * 2,
      );
    bar(m, -5.0, 9.6, -15.5, 12.0, 0, 1.2, 1.6, S.white);
    m.box(-16.0, 9.0, 0, 3.0, 4.0, 4.0, S.concrete);
    for (const s of [-1, 1]) {
      bar(m, -2.5, 20.6, 12.0, 6.8, s * 0.8, 0.15, 0.15, S.dark);
      bar(m, -2.5, 20.6, -15.5, 13.0, s * 0.8, 0.15, 0.12, S.dark);
    }
    cab(m, 7.0, 7.4, 1.6, 1.8, 2.0, 1.2, S.white, { glass0: 0.35 });
    railX(m, -7.4, 1.4, -2.9, 9.0, 1.0, S.hivis, 0.08);
  },
};
