import type { Builder } from './build-small';
import { F, T, type Frac } from './kit-toy';

/**
 * One parametric plush rig drives every plush family and size (TOY-STORE.md D9).
 * A plush sits and faces +Z: legs, body, arms, head, ears, muzzle, nose, eyes,
 * plus a few per-family extras. All proportions are fractions of the catalog
 * w x d x h, so XS and XXL share a recipe and the built size equals the catalog.
 */
type EarStyle = 'round' | 'long' | 'point' | 'floppy' | 'big' | 'none';

interface Spec {
  body: number;
  /** Head colour (default = body). */
  head?: number;
  belly?: number;
  /** Arms + legs colour (default = body). */
  limbs?: number;
  ear: number;
  earIn?: number;
  earStyle: EarStyle;
  /** Fraction of h that the ears add above the head. */
  earH?: number;
  snout: number;
  /** Muzzle depth multiplier. */
  snoutLen?: number;
  nose: number;
  /** Panda-style dark eye patches. */
  patch?: number;
  tail?: 'puff' | 'cotton' | 'long' | 'short' | 'none';
  /** One arm raised (waving). */
  wave?: boolean;
  /** Bow tie / scarf in the instance paint colour (default on). */
  bow?: boolean;
  tailC?: number;
  /** Head width as a fraction of w. */
  headW?: number;
  layout?: 'sit' | 'tall' | 'whale' | 'octopus';
  extra?: (f: Frac, c: Ctx) => void;
}

interface Ctx {
  avail: number;
  headY: number;
  headH: number;
  headW: number;
  front: number;
  spec: Spec;
}

const PLUSH: Record<string, Spec> = {
  panda: {
    body: T.panda,
    limbs: T.black,
    ear: T.black,
    earStyle: 'round',
    snout: T.panda,
    nose: T.black,
    patch: T.black,
    tail: 'puff',
    tailC: T.panda,
  },
  brown_bear: {
    body: T.brown,
    belly: T.tan,
    ear: T.cocoa,
    earIn: T.tan,
    earStyle: 'round',
    snout: T.tan,
    nose: T.black,
    tail: 'puff',
    tailC: T.brown,
  },
  gray_rabbit: {
    body: T.gray,
    belly: T.panda,
    ear: T.gray,
    earIn: T.rose,
    earStyle: 'long',
    earH: 0.34,
    snout: T.panda,
    nose: T.rose,
    tail: 'cotton',
    tailC: T.panda,
    headW: 0.66,
  },
  elephant: {
    body: 0x9fb4cf,
    belly: 0xc6d4e6,
    ear: 0x8aa0bd,
    earStyle: 'big',
    earH: 0.04,
    snout: 0x9fb4cf,
    nose: 0x9fb4cf,
    tail: 'long',
    tailC: 0x8aa0bd,
    extra: (f, c) => {
      // trunk + tusks
      f.box(0, c.headY - 0.17, 0.43, 0.2, 0.34, 0.11, 0x9fb4cf);
      f.box(0.13, c.headY - 0.04, 0.45, 0.04, 0.05, 0.06, T.panda);
      f.box(-0.13, c.headY - 0.04, 0.45, 0.04, 0.05, 0.06, T.panda);
    },
  },
  unicorn: {
    body: T.panda,
    belly: 0xffd9ec,
    ear: T.panda,
    earIn: 0xffb8d9,
    earStyle: 'point',
    earH: 0.12,
    snout: 0xffd9ec,
    nose: T.hotPink,
    tail: 'long',
    tailC: T.purple,
    wave: true,
    extra: (f, c) => {
      f.cyl(0, c.avail - 0.04, 0.2, 0.06, 0.005, 0.2, 6, T.gold);
      const rainbow = [T.red, T.orange, T.yellow, T.green, T.blue, T.purple];
      rainbow.forEach((col, i) =>
        f.box(
          0,
          c.headY + 0.05 + (i * (c.headH - 0.1)) / 6,
          -0.34,
          0.1,
          c.headH / 7,
          0.1,
          col,
        ),
      );
    },
  },
  dino: {
    body: T.green,
    belly: 0xe6e9a0,
    ear: T.green,
    earStyle: 'none',
    earH: 0.06,
    snout: T.green,
    snoutLen: 1.7,
    nose: T.darkGreen,
    tail: 'long',
    tailC: T.green,
    extra: (f, c) => {
      for (let i = 0; i < 4; i++)
        f.box(
          0,
          c.avail * (0.5 + i * 0.1),
          -0.34 - i * 0.02,
          0.08,
          0.1,
          0.1,
          T.orange,
        );
    },
  },
  penguin: {
    body: T.black,
    belly: T.panda,
    ear: T.black,
    earStyle: 'none',
    earH: 0.03,
    snout: T.orange,
    nose: T.orange,
    tail: 'short',
    tailC: T.black,
    wave: true,
    extra: (f) => {
      f.box(0.18, 0, 0.3, 0.2, 0.05, 0.3, T.orange);
      f.box(-0.18, 0, 0.3, 0.2, 0.05, 0.3, T.orange);
    },
  },
  giraffe: {
    body: T.gold,
    belly: T.tan,
    ear: T.gold,
    earStyle: 'point',
    earH: 0.06,
    snout: T.tan,
    nose: T.brown,
    tail: 'long',
    tailC: T.brown,
    layout: 'tall',
  },
  puppy: {
    body: 0xe0a64e,
    belly: T.panda,
    ear: T.brown,
    earStyle: 'floppy',
    earH: 0.02,
    snout: T.panda,
    nose: T.black,
    tail: 'long',
    tailC: 0xe0a64e,
    wave: true,
  },
  kitten: {
    body: T.orange,
    belly: T.panda,
    ear: T.orange,
    earIn: T.rose,
    earStyle: 'point',
    earH: 0.14,
    snout: T.panda,
    nose: T.hotPink,
    tail: 'long',
    tailC: T.orange,
    wave: true,
    extra: (f, c) => {
      for (const x of [-0.12, 0, 0.12])
        f.box(x, c.avail * 0.9, 0.2, 0.05, 0.1, 0.16, 0xc96a14);
    },
  },
  lion: {
    body: 0xe3b25a,
    belly: 0xf2d9a0,
    ear: 0xe3b25a,
    earStyle: 'round',
    earH: 0.06,
    snout: 0xf2d9a0,
    nose: T.brown,
    tail: 'long',
    tailC: 0xb4631e,
    wave: true,
    extra: (f, c) => {
      f.puff(0, c.headY - 0.03, -0.06, 0.9, c.headH + 0.06, 0.62, 0xb4631e);
    },
  },
  octopus: {
    body: T.purple,
    belly: 0xc8a4f5,
    ear: T.purple,
    earStyle: 'none',
    earH: 0.02,
    snout: T.purple,
    nose: 0xc8a4f5,
    tail: 'none',
    layout: 'octopus',
  },
  whale: {
    body: T.blue,
    belly: 0xdceaff,
    ear: T.blue,
    earStyle: 'none',
    snout: T.blue,
    nose: T.blue,
    tail: 'none',
    layout: 'whale',
  },
};

/** Minimum protrusion (m) for face details so they never share a plane with the head. */
const PROUD = 0.014;

function plush(f: Frac, s: Spec): void {
  if (s.layout === 'whale') return whale(f, s);
  if (s.layout === 'octopus') return octopus(f, s);
  const tall = s.layout === 'tall';
  const earH = s.earH ?? 0.16;
  const avail = 1 - earH;
  const limbs = s.limbs ?? s.body;
  const headC = s.head ?? s.body;
  const headW = s.headW ?? 0.7;
  const bodyTop = tall ? 0.34 * avail : 0.6 * avail;
  const headH = tall ? 0.22 * avail : 0.54 * avail;
  const headY = avail - headH;
  const front = 0.4;
  const proud = Math.max(0.03, PROUD / f.d);
  const ctx: Ctx = { avail, headY, headH, headW, front, spec: s };

  // legs, body, belly, arms
  const legH = (tall ? 0.34 : 0.2) * avail;
  for (const sx of [-1, 1]) {
    f.puff(sx * (tall ? 0.34 : 0.24), 0, 0.38, 0.3, legH, 0.26, limbs);
    if (s.wave && sx === 1 && !tall) {
      // waving: the right arm goes up beside the head
      f.puff(0.47, 0.3 * avail, 0.1, 0.18, 0.42 * avail, 0.26, limbs);
      continue;
    }
    f.puff(
      sx * (tall ? 0.44 : 0.4),
      tall ? bodyTop * 0.45 : 0.2 * avail,
      tall ? 0.18 : 0.12,
      tall ? 0.16 : 0.2,
      tall ? bodyTop * 0.5 : 0.32 * avail,
      0.3,
      limbs,
    );
  }
  f.puff(
    0,
    0.06 * avail,
    0,
    tall ? 0.92 : 0.64,
    bodyTop - 0.06 * avail,
    0.6,
    s.body,
  );
  if (s.belly)
    f.box(
      0,
      0.14 * avail,
      0.3 + proud * 0.4,
      tall ? 0.34 : 0.4,
      (bodyTop - 0.06 * avail) * 0.7,
      proud,
      s.belly,
    );

  if (tall) {
    // neck + head on top
    f.box(0, bodyTop - 0.04, 0.12, 0.26, headY - bodyTop + 0.1, 0.3, s.body);
    // spots on the neck + body
    for (const [x, y] of [
      [0.08, 0.5],
      [-0.07, 0.62],
      [0.07, 0.72],
    ])
      f.box(x, y, 0.12 + 0.15 + proud * 0.5, 0.1, 0.07, proud, T.brown);
    for (const [x, y] of [
      [0.2, 0.06],
      [-0.18, 0.15],
    ])
      f.box(x, y, 0.37 + proud * 0.5, 0.14, 0.08, proud, T.brown);
  }

  // head
  const headZ = tall ? 0.14 : 0.04;
  const hFront = headZ + 0.34;
  ctx.front = hFront;
  f.puff(0, headY, headZ, headW, headH, 0.68, headC);

  // ears
  const eY = avail * 0.9;
  const eH = 1 - eY;
  switch (s.earStyle) {
    case 'round':
      for (const sx of [-1, 1]) {
        f.box(sx * 0.27, eY, headZ - 0.04, 0.22, eH, 0.2, s.ear);
        if (s.earIn)
          f.box(
            sx * 0.27,
            eY + eH * 0.2,
            headZ - 0.04 + 0.1 + proud * 0.3,
            0.12,
            eH * 0.6,
            proud,
            s.earIn,
          );
      }
      break;
    case 'long':
      for (const sx of [-1, 1]) {
        f.box(
          sx * 0.2,
          avail * 0.92,
          headZ - 0.06,
          0.15,
          1 - avail * 0.92,
          0.14,
          s.ear,
        );
        if (s.earIn)
          f.box(
            sx * 0.2,
            avail * 0.97,
            headZ - 0.06 + 0.07 + proud * 0.3,
            0.08,
            (1 - avail * 0.92) * 0.8,
            proud,
            s.earIn,
          );
      }
      break;
    case 'point':
      for (const sx of [-1, 1]) {
        f.box(sx * 0.24, eY, headZ - 0.04, 0.18, eH, 0.16, s.ear, {
          taper: 0.45,
        });
        if (s.earIn)
          f.box(
            sx * 0.24,
            eY + eH * 0.1,
            headZ - 0.04 + 0.08 + proud * 0.3,
            0.09,
            eH * 0.6,
            proud,
            s.earIn,
          );
      }
      break;
    case 'floppy':
      for (const sx of [-1, 1])
        f.box(
          sx * 0.41,
          headY + headH * 0.12,
          headZ - 0.02,
          0.12,
          headH * 0.7,
          0.3,
          s.ear,
        );
      break;
    case 'big':
      for (const sx of [-1, 1])
        f.box(
          sx * 0.45,
          headY + headH * 0.15,
          headZ - 0.02,
          0.1,
          headH * 0.85,
          0.46,
          s.ear,
        );
      break;
    default:
      break;
  }

  // muzzle, nose, eyes
  const mLen = 0.1 * (s.snoutLen ?? 1);
  f.box(
    0,
    headY + headH * 0.12,
    hFront + mLen / 2 - 0.02,
    0.28,
    headH * 0.34,
    mLen,
    s.snout,
  );
  const mFront = hFront + mLen - 0.02;
  f.box(
    0,
    headY + headH * 0.34,
    mFront + proud * 0.2,
    0.1,
    headH * 0.1,
    proud,
    s.nose,
  );
  if (s.patch) {
    for (const sx of [-1, 1])
      f.box(
        sx * 0.17,
        headY + headH * 0.5,
        hFront + proud * 0.35,
        0.15,
        headH * 0.26,
        proud * 0.7,
        s.patch,
      );
  }
  for (const sx of [-1, 1]) {
    if (s.patch)
      f.box(
        sx * 0.17,
        headY + headH * 0.58,
        hFront + proud * 0.9,
        0.05,
        headH * 0.08,
        proud * 0.7,
        T.white,
      );
    else
      f.box(
        sx * 0.15,
        headY + headH * 0.58,
        hFront + proud * 0.35,
        0.07,
        headH * 0.14,
        proud,
        T.black,
      );
  }

  // tail: lifted so it shows over the back from the game camera (a curl up for 'long', a bigger bobble for puff / cotton)
  if (s.tail && s.tail !== 'none') {
    const c = s.tailC ?? s.body;
    if (s.tail === 'long') {
      f.box(0, 0.06 * avail, -0.43, 0.1, 0.1 * avail, 0.14, c, { taper: 0.7 });
      f.box(0, 0.12 * avail, -0.46, 0.09, 0.5 * avail, 0.1, c, { taper: 0.5 });
    } else if (s.tail === 'short')
      f.box(0, 0.05 * avail, -0.44, 0.2, 0.2 * avail, 0.12, c, { taper: 0.5 });
    else f.puff(0, 0.22 * avail, -0.4, 0.26, 0.2 * avail, 0.22, c);
  }
  // bow tie / scarf: the one painted part, so every plush gets a random colour (`paints` in catalog-toy.ts)
  if (s.bow !== false) {
    const bz = tall ? 0.3 : 0.34;
    const by = tall ? bodyTop - 0.02 : headY - 0.07 * avail;
    const bh = 0.08 * avail;
    for (const sx of [-1, 1])
      f.box(sx * 0.11, by, bz, 0.14, bh, 0.12, T.panda, { paint: true });
    f.box(0, by - 0.005, bz + 0.03, 0.07, bh + 0.01, 0.1, T.panda, {
      paint: true,
    });
  }
  s.extra?.(f, ctx);
}

function octopus(f: Frac, s: Spec): void {
  const proud = Math.max(0.03, PROUD / f.d);
  // dome head, face, eight stubby tentacles
  f.puff(0, 0.2, 0, 0.8, 0.8, 0.8, s.body);
  f.box(0, 0.62, 0.0, 0.58, 0.14, 0.58, s.belly ?? s.body);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    f.box(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 0.2, 0.26, 0.2, s.body);
  }
  for (const sx of [-1, 1]) {
    f.box(sx * 0.16, 0.5, 0.4 + proud * 0.3, 0.12, 0.14, proud, T.white);
    f.box(sx * 0.16, 0.54, 0.4 + proud * 0.9, 0.06, 0.07, proud * 0.7, T.black);
  }
  f.box(0, 0.38, 0.4 + proud * 0.3, 0.14, 0.05, proud, T.rose);
}

function whale(f: Frac, s: Spec): void {
  const proud = Math.max(0.03, PROUD / f.d);
  // long body along X facing +X, belly stripe, tail fin up at the back
  f.puff(-0.04, 0, 0, 0.84, 0.64, 0.9, s.body);
  f.box(0.02, 0, 0, 0.74, 0.3, 0.97, s.belly ?? s.body);
  f.box(-0.4, 0.4, 0, 0.18, 0.58, 0.12, s.body, { taper: 0.6 });
  f.box(-0.42, 0.88, 0, 0.14, 0.12, 0.62, s.body);
  for (const sz of [-1, 1]) {
    f.box(0.12, 0.08, sz * 0.5, 0.2, 0.1, 0.18, s.body, { taper: 0.5 });
    f.box(
      0.42 + 0.01,
      0.46,
      sz * (0.34 + proud * 0.4),
      0.06,
      0.12,
      0.06,
      T.white,
    );
    f.box(
      0.43,
      0.48,
      sz * (0.34 + proud * 0.9),
      0.05,
      0.06,
      proud * 0.8,
      T.black,
    );
  }
  f.box(0.26, 0.62, 0, 0.1, 0.1, 0.1, 0x9cd3ff);
}

/** plush_<family>_<size>: the family comes from the id. */
export function plushBuilder(family: string): Builder {
  const spec = PLUSH[family];
  if (!spec) throw new Error(`no plush family ${family}`);
  return (m, _v, w, d, h) => plush(F(m, w, d, h), spec);
}

/** Fixtures + loose plush (not a single animal). */
function plushPile(f: Frac): void {
  f.box(0, 0, 0, 1, 0.1, 1, T.cardboard);
  const cols = [T.brown, T.panda, T.gray, T.pink, T.blue, T.orange];
  cols.forEach((c, i) => {
    const a = (i / cols.length) * Math.PI * 2;
    f.puff(
      Math.cos(a) * 0.26,
      0.1 + (i % 2) * 0.12,
      Math.sin(a) * 0.26,
      0.36,
      0.5,
      0.36,
      c,
    );
  });
  f.puff(0, 0.5, 0, 0.34, 0.5, 0.34, T.yellow);
}

function plushBin(f: Frac): void {
  f.box(0, 0, 0, 1, 0.5, 1, T.pink);
  f.box(0, 0.08, 0, 0.9, 0.46, 0.9, T.rose);
  const cols = [
    T.brown,
    T.panda,
    T.gray,
    T.orange,
    T.blue,
    T.yellow,
    T.green,
    T.pink,
  ];
  cols.forEach((c, i) => {
    f.puff(
      ((i % 3) - 1) * 0.3,
      0.46 + (i % 2) * 0.1,
      (Math.floor(i / 3) - 1) * 0.3,
      0.3,
      0.54 - (i % 2) * 0.1,
      0.3,
      c,
    );
  });
}

export const PLUSH_BUILDERS: Record<string, Builder> = {
  plush_keychain(m, _v, w, d, h) {
    const f = F(m, w, d, h);
    plush(f, { ...PLUSH.brown_bear });
  },
  plush_pile: (m, _v, w, d, h) => plushPile(F(m, w, d, h)),
  plush_bin: (m, _v, w, d, h) => plushBin(F(m, w, d, h)),
};
