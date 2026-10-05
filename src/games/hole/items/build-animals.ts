import { getItem } from './catalog';
import type { Builder } from './build-small';
import { Mesher } from './kit';

/**
 * Animal Island animals: a handful of body-plan rigs (quadruped, hopper, bird, insect, reptile, ape,
 * crab, slug) driven by per-family tables. Rigs are designed by proportion in a w x d x h box (+X is
 * forward, animals face +X) and `Mesher.fitted` scales them to the catalog size, so the built size
 * always equals the catalog size. Bodies, heads, shells and wool are low-poly balls / eggs (`ball`),
 * legs, horns and beaks stay boxes / cones. Lab-grown animals (`*_big`, `*_giant`, `lab_*`) wear a
 * glowing green collar. Giants reuse the normal animal's rig.
 */
const DARK = 0x25282b;
const WHITE = 0xf4f1ea;
const PINK = 0xf0a0a8;
const GLOW = 0x5dff8a;
const CREAM = 0xf3e3c3;

const mix = (a: number, b: number, t: number): number => {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
const darker = (c: number, t = 0.25) => mix(c, 0x000000, t);
const lighter = (c: number, t = 0.3) => mix(c, 0xffffff, t);

type F = Mesher;
/** Context every rig gets. */
interface Ctx {
  paint: boolean;
  lab: boolean;
  v: number;
}

/** Egg lying along X (narrow end towards +X): local radii (length, height, width). */
function eggX(
  f: F,
  x: number,
  y: number,
  z: number,
  rl: number,
  rh: number,
  rw: number,
  color: number,
  taper = 0.16,
  paint = false,
  extra: { seg?: number; rings?: number; jitter?: number } = {},
): void {
  f.xf(
    x,
    y,
    z,
    () => f.ball(0, 0, 0, rh, rl, rw, color, { taper, paint, ...extra }),
    0,
    0,
    -Math.PI / 2,
  );
}

function eye(f: F, x: number, y: number, z: number, r: number): void {
  f.ball(x, y, z, r, r, r, DARK, { seg: 6, rings: 3 });
}

/** Glowing green collar of a lab-grown animal around the neck / head base. */
function collar(f: F, x: number, y: number, r: number): void {
  f.ball(x, y, 0, r * 0.34, r * 1.06, r * 1.06, GLOW, {
    glow: true,
    seg: 8,
    rings: 3,
  });
}

// ------------------------------------------------------------------------------------------ quadrupeds
interface Quad {
  c: number;
  c2?: number;
  /** Leg colour (default: body darkened). */
  lc?: number;
  /** Stripe / spot colour. */
  dark?: number;
  /** Lab-grown colour override. */
  cLab?: number;
  lh: number;
  bl?: number;
  bh: number;
  bw?: number;
  hs: number;
  neck?: number;
  lt?: number;
  snout?: 'short' | 'long' | 'pig' | 'trunk';
  ears?: 'round' | 'long' | 'big' | 'pointy' | 'none';
  tail?: 'stub' | 'bushy' | 'long' | 'tuft' | 'curl' | 'flat';
  stripes?: number;
  spots?: number;
  mane?: boolean;
  horns?: 'horns' | 'antlers' | 'palm' | 'rhino' | 'tusks' | 'long';
  hump?: boolean;
  wool?: boolean;
  spikes?: boolean;
  mask?: boolean;
  paint?: boolean;
  /** Lion: only variant 0 has the mane. Cow: variant picks the patch colour. */
  variantMane?: boolean;
  patches?: number[];
}

const SPOT_SPOTS: [number, number][] = [
  [-0.55, 0.9],
  [-0.1, 1.9],
  [0.35, 0.5],
  [0.6, 2.2],
  [-0.35, 2.7],
  [0.1, 0.1],
  [-0.7, 1.5],
  [0.5, 1.4],
];

function quadruped(
  f: F,
  s: Quad,
  w: number,
  d: number,
  h: number,
  cx: Ctx,
): void {
  const L = w;
  const W = d;
  const H = h;
  const body = cx.lab && s.cLab ? s.cLab : s.c;
  const lh = s.lh * H;
  const bh = s.bh * H;
  const bl = (s.bl ?? 0.62) * L;
  const bw = (s.bw ?? 0.8) * W;
  const bodyY0 = lh * 0.9;
  const cy = bodyY0 + bh / 2;
  const bx = -0.05 * L;
  const lc = s.lc ?? darker(body, 0.2);
  const lt = (s.lt ?? 0.16) * W;
  const paint = cx.paint && !!s.paint;
  // legs (tops hidden inside the body)
  const legTop = bodyY0 + bh * 0.4;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(bx + sx * bl * 0.3, 0, sz * bw * 0.3, lt, legTop, lt, lc);
  // body
  if (s.wool) {
    const wc = body;
    eggX(f, bx, cy, 0, bl * 0.5, bh * 0.5, bw * 0.5, wc, 0.05, paint, {
      jitter: 0.06,
    });
    for (const [px, pz, py] of [
      [-0.28, 0.28, 0.25],
      [0.25, -0.28, 0.2],
      [-0.1, -0.3, 0.3],
      [0.3, 0.3, 0.1],
    ] as const)
      f.ball(
        bx + px * bl,
        cy + py * bh,
        pz * bw,
        bh * 0.3,
        bh * 0.28,
        bh * 0.3,
        wc,
        {
          paint,
          jitter: 0.06,
          seed: 3,
        },
      );
  } else {
    eggX(f, bx, cy, 0, bl * 0.5, bh * 0.5, bw * 0.5, body, 0.16, paint);
  }
  if (s.hump)
    f.ball(
      bx + bl * 0.05,
      cy + bh * 0.42,
      0,
      bl * 0.16,
      bh * 0.3,
      bw * 0.3,
      body,
    );
  // head
  const hr = (s.hs * H) / 2;
  const neck = (s.neck ?? 0) * H;
  // the head overlaps the tip of the body (clipping is fine, a gap is not)
  const hx = neck > 0 ? bx + bl * 0.42 + hr * 0.7 : bx + bl * 0.5 - hr * 0.5;
  const hy = cy + bh * (neck > 0 ? 0.3 : 0.28) + neck;
  if (neck > 0)
    f.box(
      hx - hr * 0.55,
      cy + bh * 0.2,
      0,
      hr * 1.7,
      neck + hr * 0.4,
      hr * 1.4,
      body,
      {
        taper: 0.62,
      },
    );
  const headC = s.wool ? (s.c2 ?? DARK) : body;
  f.ball(hx, hy, 0, hr * 1.1, hr, hr * 0.95, headC, { taper: 0.1 });
  // snout
  if (s.snout === 'long')
    eggX(
      f,
      hx + hr * 0.95,
      hy - hr * 0.2,
      0,
      hr * 0.85,
      hr * 0.5,
      hr * 0.5,
      s.c2 ?? lighter(body, 0.15),
      0.1,
    );
  else if (s.snout === 'pig')
    f.ball(
      hx + hr * 1.05,
      hy - hr * 0.2,
      0,
      hr * 0.42,
      hr * 0.38,
      hr * 0.5,
      PINK,
    );
  else if (s.snout === 'short')
    f.ball(
      hx + hr * 0.95,
      hy - hr * 0.25,
      0,
      hr * 0.4,
      hr * 0.38,
      hr * 0.5,
      s.c2 ?? lighter(body, 0.2),
    );
  else if (s.snout === 'trunk')
    f.cyl(
      hx + hr * 0.95,
      hy - hr * 1.9,
      0,
      hr * 0.26,
      hr * 0.46,
      hr * 2.0,
      6,
      body,
    );
  // eyes
  const ez = s.mask ? 0.79 : 0.6;
  eye(f, hx + hr * 0.7, hy + hr * 0.25, hr * ez, hr * 0.14);
  eye(f, hx + hr * 0.7, hy + hr * 0.25, -hr * ez, hr * 0.14);
  if (s.mask) {
    for (const sz of [-1, 1])
      f.ball(
        hx + hr * 0.62,
        hy + hr * 0.25,
        sz * hr * 0.52,
        hr * 0.3,
        hr * 0.28,
        hr * 0.28,
        DARK,
        {
          seg: 6,
          rings: 3,
        },
      );
  }
  // ears
  const ec = s.c2 && s.ears === 'round' && s.wool ? s.c2 : lc;
  for (const sz of [-1, 1]) {
    if (s.ears === 'round')
      f.ball(
        hx - hr * 0.1,
        hy + hr * 0.95,
        sz * hr * 0.62,
        hr * 0.3,
        hr * 0.3,
        hr * 0.28,
        ec,
        { seg: 6, rings: 4 },
      );
    else if (s.ears === 'long' || s.ears === 'pointy')
      f.ball(
        hx - hr * 0.25,
        hy + hr * (s.ears === 'long' ? 1.25 : 1.1),
        sz * hr * 0.5,
        hr * 0.18,
        hr * (s.ears === 'long' ? 0.55 : 0.45),
        hr * 0.22,
        ec,
        { seg: 6, rings: 4 },
      );
    else if (s.ears === 'big')
      f.ball(
        hx - hr * 0.35,
        hy + hr * 0.2,
        sz * hr * 1.35,
        hr * 0.85,
        hr * 0.9,
        hr * 0.12,
        ec,
      );
  }
  // mane
  if (s.mane && !(s.variantMane && cx.v > 0)) {
    const mc = s.dark ?? darker(body, 0.45);
    if (neck > 0) {
      // a crest from the back of the head down the neck to the withers
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        f.ball(
          hx - hr * 0.7 - t * (hx - hr * 0.7 - (bx + bl * 0.15)),
          hy + hr * 0.75 - t * (hy + hr * 0.75 - (cy + bh * 0.55)),
          0,
          hr * 0.36,
          hr * 0.36,
          hr * 0.3,
          mc,
          { seg: 6, rings: 3 },
        );
      }
    } else {
      for (let k = 0; k < 6; k++) {
        if (k === 3) continue; // nothing under the chin
        const a = (k / 6) * Math.PI * 2;
        f.ball(
          hx - hr * 0.3,
          hy + Math.cos(a) * hr * 1.2,
          Math.sin(a) * hr * 1.2,
          hr * 0.5,
          hr * 0.5,
          hr * 0.5,
          mc,
          { seg: 6, rings: 4, jitter: 0.06, seed: k },
        );
      }
    }
  }
  // horns / tusks
  for (const sz of [-1, 1]) {
    if (s.horns === 'horns')
      f.xf(
        hx - hr * 0.1,
        hy + hr * 0.75,
        sz * hr * 0.45,
        () => f.cyl(0, 0, 0, hr * 0.17, 0.01, hr * 0.8, 5, CREAM),
        0,
        sz * 0.35,
      );
    else if (s.horns === 'long')
      f.xf(
        hx - hr * 0.2,
        hy + hr * 0.8,
        sz * hr * 0.4,
        () => f.cyl(0, 0, 0, hr * 0.14, 0.01, hr * 1.7, 5, CREAM),
        0,
        sz * 0.2,
        -0.15,
      );
    else if (s.horns === 'antlers' && cx.v === 1)
      f.xf(
        hx - hr * 0.2,
        hy + hr * 0.85,
        sz * hr * 0.4,
        () => {
          f.cyl(0, 0, 0, hr * 0.1, hr * 0.06, hr * 1.4, 4, CREAM);
          f.xf(
            0,
            hr * 0.9,
            0,
            () => f.cyl(0, 0, 0, hr * 0.07, 0.01, hr * 0.7, 4, CREAM),
            0,
            0,
            -0.9 * sz,
          );
        },
        0,
        sz * 0.3,
      );
    else if (s.horns === 'palm')
      f.ball(
        hx - hr * 0.2,
        hy + hr * 1.25,
        sz * hr * 1.2,
        hr * 0.85,
        hr * 0.12,
        hr * 0.85,
        CREAM,
        { seg: 8, rings: 3 },
      );
    else if (s.horns === 'tusks')
      f.cyl(
        hx + hr * 0.65,
        hy - hr * 0.45,
        sz * hr * 0.55,
        hr * 0.15,
        0.01,
        hr * 0.9,
        5,
        CREAM,
        { axis: 'x' },
      );
  }
  if (s.horns === 'rhino')
    f.cyl(
      hx + hr * 0.78,
      hy + hr * 0.15,
      0,
      hr * 0.3,
      0.01,
      hr * 1.0,
      6,
      CREAM,
    );
  // tail
  const ty = cy + bh * 0.15;
  const tx = bx - bl * 0.5;
  if (s.tail === 'stub')
    f.ball(tx, ty, 0, bh * 0.1, bh * 0.1, bh * 0.1, lc, { seg: 6, rings: 3 });
  else if (s.tail === 'bushy')
    eggX(
      f,
      tx - bl * 0.12,
      ty,
      0,
      bl * 0.2,
      bh * 0.2,
      bh * 0.2,
      s.dark ?? body,
      0.25,
    );
  else if (s.tail === 'long')
    f.cyl(
      tx - bl * 0.18,
      ty - bh * 0.05,
      0,
      lt * 0.22,
      lt * 0.12,
      bl * 0.4,
      5,
      lc,
      { axis: 'x' },
    );
  else if (s.tail === 'tuft') {
    f.cyl(
      tx - bl * 0.12,
      ty - bh * 0.1,
      0,
      lt * 0.22,
      lt * 0.12,
      bl * 0.28,
      5,
      lc,
      { axis: 'x' },
    );
    f.ball(
      tx - bl * 0.3,
      ty - bh * 0.1,
      0,
      bh * 0.1,
      bh * 0.1,
      bh * 0.1,
      s.dark ?? DARK,
      { seg: 6, rings: 3 },
    );
  } else if (s.tail === 'curl')
    eggX(
      f,
      tx - bl * 0.05,
      ty + bh * 0.6,
      0,
      bh * 0.22,
      bh * 0.75,
      bh * 0.22,
      body,
      0.3,
    );
  else if (s.tail === 'flat')
    f.ball(
      tx - bl * 0.22,
      ty - bh * 0.25,
      0,
      bl * 0.3,
      bh * 0.07,
      bh * 0.4,
      darker(body, 0.3),
      { seg: 8, rings: 3 },
    );
  // stripes / spots
  const dk = s.dark ?? DARK;
  const n = s.stripes ?? 0;
  for (let k = 0; k < n; k++) {
    const u = ((k + 0.5) / n - 0.5) * 1.5;
    const sc = Math.sqrt(1 - u * u) * 1.05;
    f.ball(
      bx + u * bl * 0.5,
      cy,
      0,
      bl * 0.025,
      (bh / 2) * sc,
      (bw / 2) * sc,
      dk,
      { seg: 6, rings: 4 },
    );
  }
  const ns = s.patches ? 5 : (s.spots ?? 0);
  for (let k = 0; k < ns; k++) {
    const [u, a] = SPOT_SPOTS[k];
    const sc = Math.sqrt(1 - u * u);
    const px = bx + u * bl * 0.5;
    f.ball(
      px,
      cy + Math.cos(a) * (bh / 2) * sc * 0.98,
      Math.sin(a) * (bw / 2) * sc * 0.98,
      bh * 0.1,
      bh * 0.1,
      bh * 0.1,
      s.patches ? s.patches[cx.v % s.patches.length] : dk,
      { seg: 6, rings: 3 },
    );
  }
  if (s.spikes)
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      f.ball(
        bx + Math.cos(a * 2) * bl * 0.12,
        cy + bh * 0.28 + Math.sin(a) * bh * 0.12,
        Math.sin(a * 2) * bw * 0.3,
        bh * 0.28,
        bh * 0.28,
        bh * 0.28,
        darker(body, 0.3),
        { seg: 6, rings: 3, jitter: 0.1, seed: k },
      );
    }
  if (cx.lab) collar(f, hx - hr * 0.6, hy - hr * 0.3, hr * 1.5);
}

const QUADS: Record<string, Quad> = {
  fox: {
    c: 0xe07a2b,
    c2: WHITE,
    lh: 0.32,
    bh: 0.38,
    hs: 0.34,
    snout: 'long',
    ears: 'pointy',
    tail: 'bushy',
    dark: 0xf0c060,
  },
  raccoon: {
    c: 0x8a8a8e,
    lh: 0.25,
    bh: 0.45,
    hs: 0.3,
    ears: 'round',
    tail: 'long',
    mask: true,
  },
  wolf: {
    c: 0x7d8288,
    c2: lighter(0x7d8288),
    lh: 0.45,
    bh: 0.34,
    hs: 0.28,
    snout: 'long',
    ears: 'pointy',
    tail: 'bushy',
  },
  deer: {
    c: 0xb07a4a,
    lh: 0.5,
    bh: 0.28,
    hs: 0.2,
    neck: 0.1,
    lt: 0.08,
    ears: 'long',
    tail: 'stub',
    horns: 'antlers',
    snout: 'long',
  },
  goat: {
    c: 0xe8e3d8,
    lh: 0.38,
    bh: 0.33,
    hs: 0.26,
    ears: 'long',
    tail: 'stub',
    horns: 'horns',
    snout: 'short',
    lt: 0.1,
  },
  sheep: {
    c: WHITE,
    c2: 0x4b4540,
    lh: 0.25,
    bh: 0.55,
    hs: 0.28,
    ears: 'round',
    wool: true,
    paint: true,
    lt: 0.12,
    lc: 0x4b4540,
  },
  lamb: {
    c: WHITE,
    c2: 0x4b4540,
    lh: 0.25,
    bh: 0.55,
    hs: 0.28,
    ears: 'round',
    wool: true,
    lc: 0x4b4540,
  },
  pig: {
    c: PINK,
    lh: 0.22,
    bh: 0.55,
    hs: 0.38,
    snout: 'pig',
    ears: 'round',
    tail: 'stub',
    lt: 0.14,
  },
  boar: {
    c: 0x5a4a3a,
    lh: 0.3,
    bh: 0.5,
    hs: 0.34,
    snout: 'pig',
    ears: 'pointy',
    tail: 'stub',
    horns: 'tusks',
  },
  cow: {
    c: WHITE,
    dark: DARK,
    lh: 0.38,
    bh: 0.4,
    hs: 0.26,
    snout: 'short',
    c2: PINK,
    ears: 'round',
    tail: 'tuft',
    horns: 'horns',
    patches: [DARK, 0x7a4a2a, WHITE],
    lt: 0.13,
  },
  horse: {
    c: 0x8a5a35,
    paint: true,
    lh: 0.5,
    bh: 0.3,
    hs: 0.18,
    neck: 0.22,
    snout: 'long',
    ears: 'pointy',
    tail: 'tuft',
    mane: true,
    dark: 0x2b2b2e,
    lt: 0.1,
  },
  zebra: {
    c: WHITE,
    dark: DARK,
    lh: 0.45,
    bh: 0.32,
    hs: 0.22,
    neck: 0.1,
    snout: 'long',
    ears: 'round',
    tail: 'tuft',
    mane: true,
    stripes: 6,
    lt: 0.1,
  },
  camel: {
    c: 0xc8a066,
    lh: 0.5,
    bh: 0.28,
    hs: 0.17,
    neck: 0.2,
    hump: true,
    ears: 'round',
    tail: 'stub',
    snout: 'short',
    lt: 0.1,
  },
  lion: {
    c: 0xd9a441,
    dark: 0x6a4020,
    lh: 0.35,
    bh: 0.4,
    hs: 0.3,
    snout: 'short',
    ears: 'round',
    tail: 'tuft',
    mane: true,
    variantMane: true,
  },
  tiger: {
    c: 0xe8892b,
    c2: WHITE,
    dark: DARK,
    lh: 0.35,
    bh: 0.4,
    hs: 0.32,
    snout: 'short',
    ears: 'round',
    tail: 'long',
    stripes: 6,
  },
  leopard: {
    c: 0xe0b050,
    dark: 0x5a3a20,
    lh: 0.3,
    bh: 0.35,
    hs: 0.28,
    snout: 'short',
    ears: 'round',
    tail: 'long',
    spots: 8,
  },
  bear: {
    c: 0x6a4a35,
    c2: 0x8a6a50,
    lh: 0.3,
    bh: 0.55,
    hs: 0.3,
    snout: 'short',
    ears: 'round',
    tail: 'stub',
    lt: 0.2,
  },
  panda: {
    c: WHITE,
    c2: DARK,
    lc: DARK,
    lh: 0.3,
    bh: 0.6,
    hs: 0.3,
    snout: 'short',
    ears: 'round',
    tail: 'stub',
    mask: true,
    lt: 0.2,
  },
  rhino: {
    c: 0x8a8f95,
    lh: 0.3,
    bh: 0.55,
    hs: 0.3,
    snout: 'short',
    ears: 'round',
    tail: 'stub',
    horns: 'rhino',
    lt: 0.26,
  },
  hippo: {
    c: 0x8a7fa0,
    c2: 0x9a8fb0,
    lh: 0.2,
    bh: 0.6,
    hs: 0.34,
    snout: 'short',
    ears: 'round',
    tail: 'stub',
    lt: 0.26,
    bl: 0.7,
  },
  elephant: {
    c: 0x9a9ea5,
    lh: 0.38,
    bh: 0.5,
    hs: 0.34,
    snout: 'trunk',
    ears: 'big',
    tail: 'stub',
    horns: 'tusks',
    lt: 0.3,
  },
  giraffe: {
    c: 0xe0b050,
    dark: 0x6a3a1a,
    lh: 0.48,
    bh: 0.2,
    hs: 0.1,
    neck: 0.5,
    ears: 'round',
    tail: 'tuft',
    horns: 'horns',
    spots: 8,
    lt: 0.12,
    snout: 'short',
  },
  moose: {
    c: 0x6a5038,
    lh: 0.45,
    bh: 0.32,
    hs: 0.22,
    snout: 'long',
    hump: true,
    ears: 'pointy',
    tail: 'stub',
    horns: 'palm',
    lt: 0.1,
  },
  bison: {
    c: 0x5a4030,
    dark: 0x3a2a20,
    lh: 0.3,
    bh: 0.55,
    hs: 0.3,
    hump: true,
    mane: true,
    ears: 'round',
    tail: 'tuft',
    horns: 'horns',
    lt: 0.14,
  },
  antelope: {
    c: 0xc89a60,
    lh: 0.5,
    bh: 0.28,
    hs: 0.2,
    ears: 'long',
    tail: 'stub',
    horns: 'long',
    lt: 0.08,
    snout: 'short',
  },
  alpaca: {
    c: WHITE,
    paint: true,
    lh: 0.5,
    bh: 0.3,
    hs: 0.18,
    neck: 0.22,
    ears: 'long',
    tail: 'stub',
    snout: 'short',
    lt: 0.1,
    lc: 0x5a4a3a,
  },
  warthog: {
    c: 0x8a7a68,
    dark: 0x4a3a30,
    lh: 0.3,
    bh: 0.5,
    hs: 0.35,
    snout: 'pig',
    mane: true,
    tail: 'tuft',
    horns: 'tusks',
    ears: 'pointy',
  },
  otter: {
    c: 0x7a5a3a,
    c2: 0xc8b090,
    lh: 0.2,
    bh: 0.45,
    hs: 0.32,
    bl: 0.75,
    ears: 'round',
    tail: 'long',
    snout: 'short',
    lt: 0.14,
  },
  beaver: {
    c: 0x6a4a2a,
    lh: 0.2,
    bh: 0.5,
    hs: 0.35,
    ears: 'round',
    tail: 'flat',
    snout: 'short',
    lt: 0.16,
  },
  mouse: {
    c: 0x9a9a9a,
    cLab: WHITE,
    paint: true,
    lh: 0.15,
    bh: 0.6,
    hs: 0.38,
    ears: 'big',
    tail: 'long',
    snout: 'long',
    c2: PINK,
    lt: 0.14,
  },
  hedgehog: {
    c: 0x8a6a4a,
    c2: 0xe8c8a0,
    lh: 0.2,
    bh: 0.6,
    hs: 0.35,
    spikes: true,
    snout: 'long',
    ears: 'round',
    lt: 0.14,
  },
  squirrel: {
    c: 0xb06a3a,
    lh: 0.2,
    bh: 0.5,
    hs: 0.3,
    ears: 'pointy',
    tail: 'curl',
    snout: 'short',
    lt: 0.14,
  },
  meerkat: {
    c: 0xc8a878,
    lh: 0.25,
    bh: 0.55,
    hs: 0.28,
    ears: 'round',
    tail: 'long',
    snout: 'long',
    lt: 0.14,
    bw: 0.7,
  },
  seal: {
    c: 0x8a8f95,
    c2: 0xb0b4b8,
    lh: 0.05,
    bh: 0.7,
    hs: 0.38,
    bl: 0.8,
    snout: 'short',
    tail: 'flat',
    lt: 0.2,
  },
};

// ------------------------------------------------------------------------------------------ hoppers
interface Hop {
  c: number;
  c2?: number;
  paint?: boolean;
  ears?: 'long' | 'none' | 'roo';
  tail?: 'puff' | 'long' | 'none';
  frog?: boolean;
  upright?: boolean;
}
function hopper(f: F, s: Hop, w: number, d: number, h: number, cx: Ctx): void {
  const body = s.c;
  const paint = cx.paint && !!s.paint;
  if (s.frog) {
    // low wide body, big eyes on top, folded hind legs
    f.ball(0, h * 0.28, 0, w * 0.34, h * 0.28, d * 0.38, body, {
      paint,
      taper: 0.1,
    });
    f.ball(w * 0.28, h * 0.35, 0, w * 0.2, h * 0.24, d * 0.3, body, { paint });
    for (const sz of [-1, 1]) {
      f.ball(
        w * 0.3,
        h * 0.8,
        sz * d * 0.18,
        h * 0.16,
        h * 0.16,
        h * 0.16,
        WHITE,
        { seg: 6, rings: 4 },
      );
      eye(f, w * 0.38, h * 0.82, sz * d * 0.18, h * 0.07);
      f.ball(
        -w * 0.25,
        h * 0.2,
        sz * d * 0.36,
        w * 0.18,
        h * 0.2,
        d * 0.1,
        darker(body, 0.1),
      );
      f.ball(
        w * 0.3,
        h * 0.1,
        sz * d * 0.34,
        w * 0.12,
        h * 0.1,
        d * 0.07,
        darker(body, 0.1),
        { seg: 6, rings: 3 },
      );
    }
    if (cx.lab) collar(f, w * 0.12, h * 0.4, h * 0.3);
    return;
  }
  const tilt = s.upright ? 0.5 : 0.25;
  // body: an egg leaning back
  f.xf(
    -w * 0.05,
    h * 0.35,
    0,
    () =>
      f.ball(0, 0, 0, h * 0.3, w * 0.3, d * 0.3, body, { paint, taper: 0.2 }),
    0,
    0,
    -Math.PI / 2 + tilt,
  );
  // head
  const hx = w * 0.3;
  const hy = h * 0.62;
  f.ball(hx, hy, 0, w * 0.15, h * 0.17, d * 0.22, body, { taper: 0.1 });
  f.ball(
    hx + w * 0.14,
    hy - h * 0.04,
    0,
    w * 0.07,
    h * 0.06,
    d * 0.1,
    c2(s, lighter(body)),
    { seg: 6, rings: 3 },
  );
  for (const sz of [-1, 1]) {
    eye(f, hx + w * 0.08, hy + h * 0.07, sz * d * 0.18, h * 0.03);
    if (s.ears === 'long')
      f.ball(
        hx - w * 0.04,
        hy + h * 0.28,
        sz * d * 0.12,
        w * 0.04,
        h * 0.2,
        d * 0.07,
        body,
        { seg: 6, rings: 4 },
      );
    else if (s.ears === 'roo')
      f.ball(
        hx - w * 0.04,
        hy + h * 0.2,
        sz * d * 0.14,
        w * 0.04,
        h * 0.14,
        d * 0.07,
        body,
        { seg: 6, rings: 4 },
      );
    // hind leg: big thigh + long foot
    f.ball(
      -w * 0.15,
      h * 0.2,
      sz * d * 0.26,
      w * 0.16,
      h * 0.17,
      d * 0.1,
      darker(body, 0.1),
    );
    f.box(
      -w * 0.02,
      0,
      sz * d * 0.26,
      w * 0.26,
      h * 0.05,
      d * 0.08,
      darker(body, 0.2),
    );
    // front paw
    f.box(
      w * 0.12,
      0,
      sz * d * 0.18,
      w * 0.06,
      h * 0.3,
      d * 0.06,
      darker(body, 0.1),
    );
  }
  if (s.tail === 'puff')
    f.ball(-w * 0.4, h * 0.3, 0, w * 0.08, w * 0.08, w * 0.08, WHITE, {
      seg: 6,
      rings: 4,
    });
  else if (s.tail === 'long')
    f.cyl(
      -w * 0.55,
      h * 0.12,
      0,
      w * 0.05,
      w * 0.02,
      w * 0.4,
      5,
      darker(body, 0.1),
      { axis: 'x' },
    );
  if (cx.lab) collar(f, hx - w * 0.06, hy - h * 0.14, h * 0.2);
}
const c2 = (s: { c2?: number }, fallback: number) => s.c2 ?? fallback;
const HOPS: Record<string, Hop> = {
  rabbit: { c: 0xcdbba0, c2: PINK, ears: 'long', tail: 'puff', upright: true },
  frog: { c: 0x4fa84a, paint: true, frog: true, c2: 0xf3e3c3 },
  kangaroo: { c: 0xc88a5a, ears: 'roo', tail: 'long', upright: true },
};

// ------------------------------------------------------------------------------------------ birds
interface Bird {
  c: number;
  c2?: number;
  /** Head colour. */
  hc?: number;
  beak: number;
  lc: number;
  legH?: number;
  neckH?: number;
  upright?: boolean;
  tail?: 'fan' | 'up' | 'long' | 'none';
  comb?: number;
  paint?: boolean;
  bigEyes?: boolean;
  tufts?: boolean;
  flat?: boolean;
}
function bird(f: F, s: Bird, w: number, d: number, h: number, cx: Ctx): void {
  const paint = cx.paint && !!s.paint;
  const legH = (s.legH ?? 0.18) * h;
  const neckH = (s.neckH ?? 0.0) * h;
  const bodyH = h * (s.upright ? 0.55 : 0.4);
  const cy = legH + bodyH * 0.45;
  // legs
  for (const sz of [-1, 1]) {
    f.box(0, 0, sz * d * 0.14, d * 0.047, legH + bodyH * 0.2, d * 0.047, s.lc);
    if (d > 0.24)
      f.box(w * 0.08, 0, sz * d * 0.14, w * 0.3, h * 0.015, d * 0.0913, s.lc);
  }
  // body
  if (s.upright)
    f.ball(0, cy + bodyH * 0.5, 0, w * 0.3, bodyH * 0.5, d * 0.36, s.c, {
      paint,
      taper: 0.12,
    });
  else
    eggX(
      f,
      -w * 0.03,
      cy + bodyH * 0.25,
      0,
      w * 0.34,
      bodyH * 0.45,
      d * 0.36 * (s.flat ? 1.1 : 1),
      s.c,
      0.12,
      paint,
    );
  if (s.c2 && s.upright)
    f.ball(
      w * 0.12,
      cy + bodyH * 0.45,
      0,
      w * 0.2,
      bodyH * 0.4,
      d * 0.3,
      s.c2,
      { seg: 8, rings: 5 },
    );
  // neck + head
  const headR = Math.min(w, h) * (s.bigEyes ? 0.2 : 0.14);
  const hx = w * (s.upright ? 0.03 : 0.3);
  const top = cy + bodyH * (s.upright ? 1.0 : 0.6);
  const hy = top + neckH + headR * 0.5;
  if (neckH > 0)
    f.box(
      hx - w * 0.02,
      top - bodyH * 0.2,
      0,
      headR * 0.9,
      neckH + bodyH * 0.2,
      headR * 0.9,
      s.hc ?? s.c,
      { taper: 0.7 },
    );
  f.ball(hx, hy, 0, headR, headR, headR * 0.95, s.hc ?? s.c, { taper: 0.05 });
  f.cyl(
    hx + headR * 0.95,
    hy - headR * 0.1,
    0,
    headR * 0.3,
    0.01,
    headR * (neckH > 0 ? 1.6 : 1.0),
    5,
    s.beak,
    { axis: 'x' },
  );
  const er = headR * (s.bigEyes ? 0.36 : 0.18);
  for (const sz of [-1, 1]) {
    if (s.bigEyes)
      f.ball(
        hx + headR * 0.5,
        hy + headR * 0.1,
        sz * headR * 0.5,
        er * 1.3,
        er * 1.3,
        er * 1.3,
        WHITE,
        { seg: 6, rings: 4 },
      );
    eye(
      f,
      hx + headR * (s.bigEyes ? 0.82 : 0.65),
      hy + headR * 0.2,
      sz * headR * (s.bigEyes ? 0.52 : 0.55),
      er,
    );
    if (s.tufts)
      f.ball(
        hx - headR * 0.1,
        hy + headR * 0.95,
        sz * headR * 0.55,
        headR * 0.2,
        headR * 0.4,
        headR * 0.2,
        darker(s.c, 0.2),
        { seg: 6, rings: 4 },
      );
  }
  // wings
  if (!s.upright || s.c2)
    for (const sz of [-1, 1])
      f.ball(
        -w * 0.04,
        cy + bodyH * 0.35,
        sz * d * 0.34,
        w * 0.22,
        bodyH * 0.22,
        d * 0.06,
        darker(s.c, 0.12),
        { seg: 8, rings: 4 },
      );
  // tail
  if (s.tail === 'fan')
    f.ball(
      -w * 0.4,
      cy + bodyH * 0.45,
      0,
      w * 0.1,
      bodyH * 0.3,
      d * 0.2,
      darker(s.c, 0.15),
      { seg: 6, rings: 4 },
    );
  else if (s.tail === 'up')
    f.ball(
      -w * 0.36,
      cy + bodyH * 0.9,
      0,
      w * 0.1,
      bodyH * 0.55,
      d * 0.1,
      darker(s.c, 0.1),
      { seg: 6, rings: 4 },
    );
  else if (s.tail === 'long')
    f.box(
      -w * 0.55,
      cy + bodyH * 0.1,
      0,
      w * 0.4,
      bodyH * 0.08,
      d * 0.12,
      darker(s.c, 0.1),
    );
  // comb + wattle
  for (let k = 0; k < (s.comb ?? 0); k++)
    f.ball(
      hx - headR * 0.1 + k * headR * 0.5,
      hy + headR * (0.95 - 0.1 * k),
      0,
      headR * 0.25,
      headR * 0.35,
      headR * 0.12,
      0xd94a3a,
      { seg: 6, rings: 3 },
    );
  if (cx.lab) collar(f, hx - headR * 0.3, hy - headR * 0.9, headR * 1.2);
}
const BIRDS: Record<string, Bird> = {
  chick: {
    c: 0xf5d84a,
    beak: 0xf08a2b,
    lc: 0xf08a2b,
    legH: 0.12,
    tail: 'none',
  },
  hen: {
    c: 0xb06a3a,
    beak: 0xf2c230,
    lc: 0xf2c230,
    legH: 0.2,
    tail: 'fan',
    comb: 2,
  },
  rooster: {
    c: 0xb0502a,
    c2: 0x2f7a4a,
    beak: 0xf2c230,
    lc: 0xf2c230,
    legH: 0.22,
    tail: 'up',
    comb: 3,
    upright: true,
  },
  duck: {
    c: 0xa88a5a,
    hc: 0x2f7a3a,
    beak: 0xf2c230,
    lc: 0xf08a2b,
    legH: 0.1,
    flat: true,
    tail: 'fan',
  },
  duckling: {
    c: 0xf5d84a,
    beak: 0xf08a2b,
    lc: 0xf08a2b,
    legH: 0.08,
    flat: true,
    tail: 'none',
  },
  seagull: { c: WHITE, beak: 0xf2c230, lc: 0xf08a2b, legH: 0.25, tail: 'fan' },
  penguin: {
    c: 0x25282b,
    c2: WHITE,
    beak: 0xf08a2b,
    lc: 0xf08a2b,
    legH: 0.05,
    upright: true,
    tail: 'none',
  },
  parrot: {
    c: 0xd94a3a,
    paint: true,
    c2: 0x3b82d6,
    beak: 0x25282b,
    lc: 0x8a8f95,
    legH: 0.12,
    upright: true,
    tail: 'long',
  },
  flamingo: {
    c: 0xf08aa8,
    beak: 0x25282b,
    lc: 0xe0708f,
    legH: 0.55,
    neckH: 0.18,
    tail: 'fan',
  },
  ostrich: {
    c: 0x3a3f45,
    hc: 0xe8c8b0,
    beak: 0xe8b090,
    lc: 0xe8b090,
    legH: 0.42,
    neckH: 0.22,
    tail: 'fan',
  },
  heron: {
    c: 0x9aa4ae,
    hc: WHITE,
    beak: 0xf2c230,
    lc: 0x7a6a50,
    legH: 0.45,
    neckH: 0.2,
    tail: 'long',
  },
  owl: {
    c: 0x8a6a4a,
    c2: 0xe8d8b8,
    beak: 0xf2c230,
    lc: 0xe8b090,
    legH: 0.08,
    upright: true,
    bigEyes: true,
    tufts: true,
    tail: 'none',
  },
};

// ------------------------------------------------------------------------------------------ insects etc.
type SimpleRig = (f: F, w: number, d: number, h: number, cx: Ctx) => void;
const bugLegs = (
  f: F,
  n: number,
  x0: number,
  x1: number,
  d: number,
  y: number,
  c: number,
) => {
  for (let k = 0; k < n; k++) {
    const x = x0 + ((x1 - x0) * k) / Math.max(1, n - 1);
    for (const sz of [-1, 1])
      f.box(x, 0, sz * d * 0.5, d * 0.07, y, d * 0.07, c);
  }
};
const antenna = (
  f: F,
  x: number,
  y: number,
  d: number,
  len: number,
  c: number,
) => {
  for (const sz of [-1, 1])
    f.xf(
      x,
      y,
      sz * d * 0.12,
      () => f.cyl(0, 0, 0, d * 0.03, d * 0.02, len, 4, c),
      0,
      sz * 0.5,
      -0.7,
    );
};

const ANT: SimpleRig = (f, w, d, h, cx) => {
  const c = cx.lab ? 0x6a2a2a : 0x3a2a22;
  bugLegs(f, 3, -w * 0.1, w * 0.12, d, h * 0.4, c);
  f.ball(-w * 0.28, h * 0.5, 0, w * 0.2, h * 0.4, d * 0.3, c);
  f.ball(0, h * 0.45, 0, w * 0.13, h * 0.3, d * 0.2, c);
  f.ball(w * 0.28, h * 0.55, 0, w * 0.14, h * 0.34, d * 0.3, c);
  for (const sz of [-1, 1]) eye(f, w * 0.38, h * 0.65, sz * d * 0.2, h * 0.07);
  antenna(f, w * 0.34, h * 0.85, d, d * 0.5, c);
  if (cx.lab) collar(f, w * 0.15, h * 0.35, h * 0.3);
};
const BEETLE: SimpleRig = (f, w, d, h, cx) => {
  bugLegs(f, 3, -w * 0.2, w * 0.2, d, h * 0.4, DARK);
  f.ball(-w * 0.04, 0, 0, w * 0.34, h * 0.8, d * 0.46, 0x4fa84a, {
    half: true,
    paint: cx.paint,
    seg: 10,
    rings: 6,
  });
  f.ball(w * 0.36, h * 0.28, 0, w * 0.13, h * 0.24, d * 0.26, DARK);
  for (const sz of [-1, 1]) {
    eye(f, w * 0.44, h * 0.38, sz * d * 0.16, h * 0.07);
    f.xf(
      w * 0.46,
      h * 0.28,
      sz * d * 0.18,
      () => f.cyl(0, 0, 0, d * 0.05, 0.01, h * 0.4, 4, DARK),
      0,
      sz * 0.4,
      -1.2,
    );
  }
  f.box(-w * 0.04, h * 0.75, 0, w * 0.01, h * 0.1, d * 0.01, DARK);
  if (cx.lab) collar(f, w * 0.3, h * 0.28, h * 0.3);
};
const LADYBUG: SimpleRig = (f, w, d, h, cx) => {
  bugLegs(f, 3, -w * 0.15, w * 0.15, d, h * 0.3, DARK);
  f.ball(0, 0, 0, w * 0.45, h * 0.95, d * 0.5, 0xd94a3a, {
    half: true,
    paint: cx.paint,
    seg: 10,
    rings: 6,
  });
  f.ball(w * 0.42, h * 0.2, 0, w * 0.1, h * 0.2, d * 0.28, DARK);
  for (const [x, z] of [
    [-0.12, 0.28],
    [0.1, -0.25],
    [-0.2, -0.18],
    [0.12, 0.26],
    [0, 0],
  ] as const)
    f.ball(
      x * w,
      h * (0.78 - Math.abs(z) * 0.5),
      z * d,
      w * 0.07,
      h * 0.12,
      d * 0.07,
      DARK,
      { seg: 6, rings: 3 },
    );
};
const GRASSHOPPER: SimpleRig = (f, w, d, h, cx) => {
  const c = 0x7ec850;
  eggX(f, -w * 0.05, h * 0.5, 0, w * 0.4, h * 0.2, d * 0.28, c, 0.2);
  f.ball(w * 0.36, h * 0.6, 0, w * 0.1, h * 0.2, d * 0.3, c);
  for (const sz of [-1, 1]) {
    f.box(
      -w * 0.22,
      0,
      sz * d * 0.4,
      w * 0.3,
      h * 0.08,
      d * 0.08,
      darker(c, 0.2),
    );
    f.box(
      -w * 0.35,
      0,
      sz * d * 0.47,
      d * 0.08,
      h * 0.7,
      d * 0.08,
      darker(c, 0.2),
    );
    f.box(
      w * 0.12,
      0,
      sz * d * 0.4,
      d * 0.07,
      h * 0.4,
      d * 0.07,
      darker(c, 0.2),
    );
    eye(f, w * 0.42, h * 0.7, sz * d * 0.2, h * 0.05);
  }
  antenna(f, w * 0.4, h * 0.85, d, d * 0.6, DARK);
  if (cx.lab) collar(f, w * 0.3, h * 0.5, h * 0.25);
};
const CATERPILLAR: SimpleRig = (f, w, d, h, cx) => {
  const cols = [0x7ec850, 0xb0e060, 0x7ec850, 0xb0e060, 0x7ec850];
  for (let k = 0; k < 5; k++) {
    const r = (k === 4 ? 0.5 : 0.42) * d;
    f.ball(
      -w * 0.4 + k * w * 0.2,
      r * 0.82,
      0,
      w * 0.12,
      r * 0.85,
      r,
      k === 2 ? 0xffffff : cols[k],
      { paint: cx.paint && k === 2, seg: 6, rings: 4 },
    );
  }
  for (const sz of [-1, 1]) eye(f, w * 0.46, h * 0.7, sz * d * 0.25, h * 0.08);
};
const SNAIL: SimpleRig = (f, w, d, h, cx) => {
  // soft body, spiral shell (two balls), eye stalks
  eggX(f, w * 0.05, h * 0.12, 0, w * 0.45, h * 0.13, d * 0.3, 0xd8c8a0, 0.2);
  f.ball(-w * 0.08, h * 0.55, 0, w * 0.26, h * 0.45, d * 0.4, 0xb06a3a, {
    seg: 8,
    rings: 5,
  });
  for (const sz of [-1, 1])
    f.ball(
      -w * 0.08,
      h * 0.58,
      sz * d * 0.37,
      w * 0.17,
      h * 0.3,
      d * 0.06,
      0xd89a5a,
      {
        seg: 8,
        rings: 5,
      },
    );
  for (const sz of [-1, 1]) {
    f.cyl(
      w * 0.38,
      h * 0.2,
      sz * d * 0.12,
      d * 0.04,
      d * 0.03,
      h * 0.45,
      4,
      0xd8c8a0,
    );
    eye(f, w * 0.38, h * 0.68, sz * d * 0.12, h * 0.05);
  }
  if (cx.lab) collar(f, w * 0.28, h * 0.2, h * 0.3);
};
const BUTTERFLY: SimpleRig = (f, w, d, h, cx) => {
  f.ball(0, h * 0.5, 0, w * 0.07, h * 0.35, d * 0.07, 0x3a2a22, {
    seg: 6,
    rings: 4,
  });
  f.ball(w * 0.08, h * 0.88, 0, w * 0.04, h * 0.1, d * 0.06, 0x3a2a22, {
    seg: 6,
    rings: 3,
  });
  for (const sz of [-1, 1]) {
    f.ball(
      w * 0.12,
      h * 0.52,
      sz * d * 0.3,
      w * 0.28,
      h * 0.1,
      d * 0.32,
      0xf08a2b,
      { paint: cx.paint, seg: 8, rings: 4 },
    );
    f.ball(
      -w * 0.2,
      h * 0.5,
      sz * d * 0.26,
      w * 0.22,
      h * 0.08,
      d * 0.26,
      lighter(0xf08a2b, 0.2),
      { seg: 8, rings: 4 },
    );
  }
};
const BEE: SimpleRig = (f, w, d, h) => {
  eggX(f, -w * 0.08, h * 0.45, 0, w * 0.34, h * 0.36, d * 0.34, 0xf2c230, 0.18);
  for (const x of [-0.18, -0.02])
    f.ball(
      w * x,
      h * 0.45,
      0,
      w * 0.03,
      h * 0.36 * 1.04,
      d * 0.34 * 1.04,
      DARK,
      { seg: 6, rings: 4 },
    );
  f.ball(w * 0.3, h * 0.52, 0, w * 0.13, h * 0.3, d * 0.3, 0x3a2a22);
  for (const sz of [-1, 1]) {
    f.ball(
      -w * 0.05,
      h * 0.82,
      sz * d * 0.28,
      w * 0.2,
      h * 0.04,
      d * 0.22,
      0xdff4ff,
      { seg: 6, rings: 3 },
    );
    eye(f, w * 0.38, h * 0.6, sz * d * 0.18, h * 0.07);
  }
};
const SPIDER: SimpleRig = (f, w, d, h) => {
  for (let k = 0; k < 4; k++)
    for (const sz of [-1, 1])
      f.box(
        -w * 0.18 + k * w * 0.12,
        h * 0.37,
        sz * d * 0.33,
        w * 0.05,
        h * 0.05,
        d * 0.3,
        DARK,
      );
  for (let k = 0; k < 4; k++)
    for (const sz of [-1, 1])
      f.box(
        -w * 0.18 + k * w * 0.12,
        0,
        sz * d * 0.52,
        w * 0.04,
        h * 0.4,
        w * 0.04,
        DARK,
      );
  f.ball(-w * 0.12, h * 0.55, 0, w * 0.22, h * 0.34, d * 0.3, 0x5a3a2a);
  f.ball(w * 0.22, h * 0.5, 0, w * 0.13, h * 0.24, d * 0.2, 0x5a3a2a);
  for (const sz of [-1, 1]) eye(f, w * 0.32, h * 0.58, sz * d * 0.1, h * 0.07);
};
const DRAGONFLY: SimpleRig = (f, w, d, h) => {
  eggX(f, -w * 0.1, h * 0.5, 0, w * 0.46, h * 0.1, d * 0.07, 0x3b82d6, 0.1);
  f.ball(w * 0.38, h * 0.5, 0, w * 0.07, h * 0.15, d * 0.12, 0x2a4f8f);
  for (const sz of [-1, 1])
    for (const [x, y, r] of [
      [0.14, 0.64, 0.34],
      [0.02, 0.6, 0.3],
    ] as const) {
      f.ball(w * x, h * y, sz * d * 0.36, w * 0.16, h * 0.04, d * r, 0xdff4ff, {
        seg: 6,
        rings: 3,
      });
    }
};

const SIMPLE: Record<string, SimpleRig> = {
  ant: ANT,
  beetle: BEETLE,
  ladybug: LADYBUG,
  grasshopper: GRASSHOPPER,
  caterpillar: CATERPILLAR,
  snail: SNAIL,
  butterfly: BUTTERFLY,
  bee: BEE,
  spider: SPIDER,
  dragonfly: DRAGONFLY,
};
SIMPLE.ant_soldier = (f, w, d, h, cx) => {
  ANT(f, w, d, h, cx);
  for (const sz of [-1, 1])
    f.cyl(
      w * 0.46,
      h * 0.4,
      sz * d * 0.12,
      d * 0.07,
      0.005,
      w * 0.12,
      4,
      DARK,
      { axis: 'x' },
    );
};

// reptiles / apes / crab ---------------------------------------------------------------------------
const CROC: SimpleRig = (f, w, d, h, cx) => {
  const c = 0x5a8a4a;
  const dk = darker(c, 0.3);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.2 - w * 0.02,
        0,
        sz * d * 0.38,
        w * 0.07,
        h * 0.5,
        d * 0.14,
        dk,
      );
  eggX(f, -w * 0.08, h * 0.45, 0, w * 0.3, h * 0.28, d * 0.4, c, 0.05);
  // tail tapering back
  eggX(f, -w * 0.38, h * 0.38, 0, w * 0.2, h * 0.2, d * 0.2, dk, -0.2);
  // head + long snout
  eggX(f, w * 0.34, h * 0.42, 0, w * 0.18, h * 0.2, d * 0.28, c, 0.1);
  eggX(
    f,
    w * 0.42,
    h * 0.36,
    0,
    w * 0.14,
    h * 0.12,
    d * 0.2,
    lighter(c, 0.12),
    0.1,
  );
  for (const sz of [-1, 1]) {
    f.ball(w * 0.3, h * 0.66, sz * d * 0.14, h * 0.1, h * 0.1, h * 0.1, c, {
      seg: 6,
      rings: 4,
    });
    eye(f, w * 0.33, h * 0.72, sz * d * 0.15, h * 0.05);
  }
  for (let k = 0; k < 4; k++)
    f.ball(
      -w * 0.2 + k * w * 0.14,
      h * 0.7,
      0,
      w * 0.03,
      h * 0.06,
      d * 0.08,
      dk,
      { seg: 6, rings: 3 },
    );
  if (cx.lab) collar(f, w * 0.26, h * 0.45, h * 0.35);
};
const TORTOISE: SimpleRig = (f, w, d, h, cx) => {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.2,
        0,
        sz * d * 0.3,
        w * 0.14,
        h * 0.28,
        d * 0.16,
        0x8a9a5a,
      );
  f.ball(0, h * 0.2, 0, w * 0.42, h * 0.8, d * 0.5, 0x6a8a3a, {
    half: true,
    seg: 10,
    rings: 6,
  });
  f.ball(0, h * 0.88, 0, w * 0.16, h * 0.2, d * 0.2, 0x8a6a3a, {
    half: true,
    seg: 8,
    rings: 4,
  });
  eggX(f, w * 0.4, h * 0.28, 0, w * 0.12, h * 0.14, d * 0.15, 0x8a9a5a, 0.1);
  for (const sz of [-1, 1]) eye(f, w * 0.48, h * 0.36, sz * d * 0.08, h * 0.04);
  f.ball(-w * 0.45, h * 0.15, 0, w * 0.06, h * 0.05, d * 0.05, 0x8a9a5a, {
    seg: 6,
    rings: 3,
  });
  if (cx.lab) collar(f, w * 0.44, h * 0.28, h * 0.17);
};
const APE: SimpleRig = (f, w, d, h, cx) => {
  const c = cx.paint ? 0xffffff : 0x3a3f45;
  const paint = cx.paint;
  const lc = darker(0x3a3f45, 0.1);
  // legs, long arms to the ground
  for (const sz of [-1, 1]) {
    f.box(-w * 0.12, 0, sz * d * 0.22, w * 0.18, h * 0.3, d * 0.2, lc);
    f.box(w * 0.28, 0, sz * d * 0.36, w * 0.16, h * 0.62, d * 0.14, lc);
  }
  f.ball(0, h * 0.56, 0, w * 0.4, h * 0.4, d * 0.4, c, { paint, taper: 0.1 });
  f.ball(w * 0.34, h * 0.74, 0, w * 0.17, h * 0.2, d * 0.2, c, { paint });
  f.ball(w * 0.45, h * 0.7, 0, w * 0.08, h * 0.11, d * 0.14, 0x8a7a68, {
    seg: 6,
    rings: 4,
  });
  for (const sz of [-1, 1]) {
    eye(f, w * 0.5, h * 0.78, sz * d * 0.1, h * 0.03);
    f.ball(w * 0.3, h * 0.92, sz * d * 0.06, w * 0.06, h * 0.04, d * 0.05, c, {
      paint,
      seg: 6,
      rings: 3,
    });
  }
  if (cx.lab) collar(f, w * 0.28, h * 0.66, h * 0.2);
};
const MONKEY: SimpleRig = (f, w, d, h, cx) => {
  const paint = cx.paint;
  const c = 0x7a5230;
  for (const sz of [-1, 1]) {
    f.box(
      -w * 0.1,
      0,
      sz * d * 0.22,
      w * 0.14,
      h * 0.3,
      d * 0.16,
      darker(c, 0.1),
    );
    f.box(
      w * 0.18,
      0,
      sz * d * 0.3,
      w * 0.12,
      h * 0.4,
      d * 0.12,
      darker(c, 0.1),
    );
  }
  f.ball(0, h * 0.45, 0, w * 0.28, h * 0.3, d * 0.3, c, { paint, taper: 0.1 });
  f.ball(w * 0.2, h * 0.78, 0, w * 0.15, h * 0.18, d * 0.22, c, { paint });
  f.ball(w * 0.3, h * 0.74, 0, w * 0.06, h * 0.1, d * 0.14, 0xe8c8a0, {
    seg: 6,
    rings: 4,
  });
  for (const sz of [-1, 1]) {
    eye(f, w * 0.34, h * 0.82, sz * d * 0.12, h * 0.03);
    f.ball(
      w * 0.15,
      h * 0.85,
      sz * d * 0.28,
      w * 0.07,
      h * 0.09,
      d * 0.04,
      0xe8c8a0,
      { seg: 6, rings: 3 },
    );
  }
  f.cyl(-w * 0.5, h * 0.5, 0, d * 0.05, d * 0.03, w * 0.5, 5, darker(c, 0.1), {
    axis: 'x',
  });
  f.ball(-w * 0.7, h * 0.62, 0, d * 0.07, h * 0.15, d * 0.07, darker(c, 0.1), {
    seg: 6,
    rings: 4,
  });
  if (cx.lab) collar(f, w * 0.15, h * 0.7, h * 0.2);
};
const CRAB: SimpleRig = (f, w, d, h) => {
  const c = 0xd9553a;
  for (let k = 0; k < 3; k++)
    for (const sz of [-1, 1])
      f.box(
        -w * 0.15 + k * w * 0.15,
        0,
        sz * d * 0.4,
        w * 0.04,
        h * 0.45,
        d * 0.1,
        darker(c, 0.2),
      );
  f.ball(0, 0.05 * h, 0, w * 0.34, h * 0.85, d * 0.4, c, {
    half: true,
    seg: 8,
    rings: 6,
  });
  for (const sz of [-1, 1]) {
    f.ball(w * 0.3, h * 0.35, sz * d * 0.42, w * 0.15, h * 0.28, d * 0.14, c);
    f.cyl(
      w * 0.2,
      h * 0.7,
      sz * d * 0.1,
      d * 0.03,
      d * 0.03,
      h * 0.3,
      4,
      darker(c, 0.2),
    );
    eye(f, w * 0.2, h * 1.0, sz * d * 0.1, h * 0.07);
  }
};

SIMPLE.crocodile = CROC;
SIMPLE.tortoise = TORTOISE;
SIMPLE.gorilla = APE;
SIMPLE.monkey = MONKEY;
SIMPLE.crab = CRAB;

// --------------------------------------------------------------------------------------- registry
/** Family -> rig. `*_big` / `*_giant` / `lab_*` ids resolve to their base family. */
const FAMILIES: Record<
  string,
  (f: F, w: number, d: number, h: number, cx: Ctx) => void
> = {};
for (const [k, s] of Object.entries(QUADS))
  FAMILIES[k] = (f, w, d, h, cx) => quadruped(f, s, w, d, h, cx);
for (const [k, s] of Object.entries(HOPS))
  FAMILIES[k] = (f, w, d, h, cx) => hopper(f, s, w, d, h, cx);
for (const [k, s] of Object.entries(BIRDS))
  FAMILIES[k] = (f, w, d, h, cx) => bird(f, s, w, d, h, cx);
for (const [k, r] of Object.entries(SIMPLE)) FAMILIES[k] = r;
// aliases of the same body plan
FAMILIES.elephant_calf = FAMILIES.elephant;
FAMILIES.giraffe_calf = FAMILIES.giraffe;
FAMILIES.chicken = FAMILIES.hen;

/** Ids that are not `<family>`, `<family>_big` or `<family>_giant`. */
const ALIAS: Record<string, string> = {
  lab_mouse: 'mouse',
  chicken_giant: 'hen',
  elephant_calf: 'elephant',
  giraffe_calf: 'giraffe',
};

function familyOf(id: string): { family: string; lab: boolean } | null {
  if (ALIAS[id])
    return {
      family: ALIAS[id],
      lab: id.startsWith('lab_') || id.endsWith('_giant'),
    };
  if (FAMILIES[id]) return { family: id, lab: false };
  const m = /^(.*)_(big|giant)$/.exec(id);
  if (m && FAMILIES[m[1]]) return { family: m[1], lab: true };
  return null;
}

export function hasAnimalRig(id: string): boolean {
  return familyOf(id) !== null;
}

/** Builder of an animal item id (undefined when the id is not an animal). */
export function animalBuilder(id: string): Builder | undefined {
  const fam = familyOf(id);
  if (!fam) return undefined;
  const rig = FAMILIES[fam.family];
  return (m, v, w, d, h) => {
    const cx: Ctx = { paint: !!getItem(id).paints?.length, lab: fam.lab, v };
    m.fitted(w, d, h, (f) => rig(f, w, d, h, cx));
  };
}
