import { BufferGeometry, Float32BufferAttribute, SphereGeometry } from 'three';
import { BONE, BONES, RIGS } from './people-body';
import { cellUV, HAIR, HAT, KNIT } from './people-parts';
import {
  clipAll,
  field,
  join,
  normals,
  offset,
  relax,
  rigid,
  seal,
  solid,
  vnoise,
  type Surf,
} from './people-surf';
import { smooth, type Tailor } from './people-tailor';
import type { HairStyle } from './people-looks';

/**
 * Hair and hats: a scalp cut from the head of the body (so it follows the skull exactly), thickened by the style
 * (crop, quiff, curls, afro ...), plus what hangs or sits on it (a curtain of long hair, a bun, a ponytail, a braid).
 * Every part rides the head bone. Hats are the same cut at another hairline, with a brim or a roll.
 */

/** The columns every part of the head gear has, so they join into one surface. */
const slim = (
  s: Surf,
  color: string,
  cell: number,
  fu: Float32Array,
  fv: Float32Array,
  wCells = 1,
): Surf => {
  const uv = new Float32Array(s.n * 2);
  for (let i = 0; i < s.n; i++) {
    const [u, v] = cellUV(cell, fu[i], fv[i], wCells);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  return {
    n: s.n,
    idx: s.idx,
    a: {
      pos: s.a.pos,
      nor: s.a.nor,
      w: s.a.w,
      arm: new Float32Array(s.n),
      uv,
      color: solid(s.n, color),
    },
  };
};

interface Spec {
  /** Hairline height above the eyes at the front / the back (m, head centre = 0). */
  front: number;
  back: number;
  /** Thickness over the scalp (m) and extra bulk at the crown / the front. */
  thick: number;
  crown?: number;
  quiff?: number;
  /** Curls: amplitude (m) and frequency (1/m) of the bumps. */
  curl?: number;
  freq?: number;
  /** Only a strip along the middle (mohawk): half width (m). */
  strip?: number;
  /** Longer hair at the sides and the back: how far down (m below the head centre). */
  drop?: number;
  /** Over how many metres of height above the hairline the hair reaches full thickness. */
  taper?: number;
  /** Sideburn: lowest point of the hairline in front of the ear (m, head centre = 0). */
  sideburn?: number;
  /** Hangs over the forehead (bangs). */
  fringe?: boolean;
  /** What sits on it. */
  extra?: 'bun' | 'lowbun' | 'pony' | 'braid' | 'buns' | 'manbun';
  /** Both sides combed to one: side-swept parting. */
  part?: number;
}

const STYLES: Record<HairStyle, Spec | undefined> = {
  bald: undefined,
  buzz: { front: 0.07, back: -0.02, thick: 0.005, sideburn: 0.02 },
  crop: {
    front: 0.065,
    back: -0.04,
    thick: 0.014,
    crown: 0.006,
    sideburn: -0.01,
  },
  sidepart: { front: 0.065, back: -0.045, thick: 0.02, crown: 0.01, part: 1 },
  quiff: { front: 0.06, back: -0.05, thick: 0.02, crown: 0.01, quiff: 0.045 },
  slick: { front: 0.06, back: -0.06, thick: 0.016, crown: 0.004, drop: -0.06 },
  messy: {
    front: 0.04,
    back: -0.06,
    thick: 0.024,
    crown: 0.01,
    curl: 0.012,
    freq: 60,
  },
  curly: {
    front: 0.045,
    back: -0.06,
    thick: 0.034,
    crown: 0.012,
    curl: 0.016,
    freq: 110,
  },
  afro: {
    front: 0.055,
    back: -0.02,
    thick: 0.075,
    crown: 0.02,
    curl: 0.018,
    freq: 80,
    taper: 0.12,
  },
  mohawk: { front: 0.07, back: -0.05, thick: 0.05, strip: 0.026, taper: 0.1 },
  manbun: {
    front: 0.07,
    back: -0.05,
    thick: 0.016,
    crown: 0.006,
    extra: 'manbun',
  },
  long: {
    front: 0.05,
    back: -0.07,
    thick: 0.018,
    crown: 0.006,
    drop: -0.42,
    part: 1,
  },
  wavy: {
    front: 0.05,
    back: -0.07,
    thick: 0.022,
    crown: 0.01,
    drop: -0.4,
    curl: 0.01,
    freq: 40,
    part: 1,
  },
  bob: {
    front: 0.05,
    back: -0.06,
    thick: 0.02,
    crown: 0.008,
    drop: -0.13,
    part: 1,
  },
  bobbang: {
    front: 0.03,
    back: -0.06,
    thick: 0.02,
    crown: 0.008,
    drop: -0.13,
    fringe: true,
  },
  pony: {
    front: 0.055,
    back: -0.03,
    thick: 0.015,
    crown: 0.004,
    extra: 'pony',
  },
  bun: { front: 0.055, back: -0.03, thick: 0.015, crown: 0.004, extra: 'bun' },
  lowbun: {
    front: 0.055,
    back: -0.04,
    thick: 0.015,
    crown: 0.004,
    extra: 'lowbun',
  },
  braid: {
    front: 0.055,
    back: -0.05,
    thick: 0.017,
    crown: 0.006,
    extra: 'braid',
  },
  pixie: { front: 0.04, back: -0.03, thick: 0.016, crown: 0.008, fringe: true },
  buns: {
    front: 0.055,
    back: -0.02,
    thick: 0.015,
    crown: 0.004,
    extra: 'buns',
  },
};

export const HAIR_STYLES = Object.keys(STYLES) as HairStyle[];

interface Frame {
  /** Head centre (rest frame, pelvis origin) and radii. */
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
}

function frame(t: Tailor): Frame {
  const rig = RIGS[t.m];
  return {
    cx: 0,
    cy: rig.head[1] - rig.hip,
    cz: rig.head[2],
    rx: rig.headR[0],
    ry: rig.headR[1],
    rz: rig.headR[2],
  };
}

/** Hairline height (m above the head centre) by azimuth (0 = front, pi = back): a front line, temples, sideburns, above the ear, nape. */
function hairline(
  front: number,
  back: number,
  sideburn: number,
): (phi: number) => number {
  const pts: [number, number][] = [
    [0, front],
    [0.75, front - 0.012],
    [1.15, sideburn],
    [1.42, 0.03],
    [1.95, 0.0],
    [2.5, back * 0.5],
    [Math.PI, back],
  ];
  return (phi) => {
    const a = Math.abs(phi);
    for (let k = 1; k < pts.length; k++)
      if (a <= pts[k][0]) {
        const t = (a - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]);
        const e = t * t * (3 - 2 * t);
        return pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * e;
      }
    return back;
  };
}

/** The head of the body above a hairline, without the ears; `above` = how far over the hairline (m) per vertex. */
function head(
  t: Tailor,
  f: Frame,
  H: (phi: number) => number,
  radius = 0.17,
  bareEars = true,
): Surf {
  const s = t.cloth.s;
  const above = field(s, (i) => {
    const dx = s.a.pos[i * 3] - f.cx;
    const dy = s.a.pos[i * 3 + 1] - f.cy;
    const dz = s.a.pos[i * 3 + 2] - f.cz;
    return dy - H(Math.atan2(dx, dz));
  });
  const near = field(
    s,
    (i) =>
      radius -
      Math.hypot(
        s.a.pos[i * 3] - f.cx,
        s.a.pos[i * 3 + 1] - f.cy,
        s.a.pos[i * 3 + 2] - f.cz,
      ),
  );
  // The ears stay bare.
  const ear = field(s, (i) => {
    const dx = Math.abs(s.a.pos[i * 3] - f.cx);
    const dy = s.a.pos[i * 3 + 1] - f.cy + 0.02;
    const dz = s.a.pos[i * 3 + 2] - f.cz + 0.005;
    if (dx < 0.07 || !bareEars) return 1;
    return Math.hypot(dz / 0.034, dy / 0.05) - 1;
  });
  const cut = clipAll(s, [above, near, ear]);
  return cut;
}

/** Azimuth (0 = front, 1 = back, mirrored) and polar (0 = crown, 1 = hairline) of a point on the head, for the strands. */
function strands(s: Surf, f: Frame): [Float32Array, Float32Array] {
  const fu = new Float32Array(s.n);
  const fv = new Float32Array(s.n);
  for (let i = 0; i < s.n; i++) {
    const dx = s.a.pos[i * 3] - f.cx;
    const dy = s.a.pos[i * 3 + 1] - f.cy;
    const dz = s.a.pos[i * 3 + 2] - f.cz;
    fu[i] = Math.abs(Math.atan2(dx, dz)) / Math.PI;
    fv[i] = Math.min(
      1,
      Math.max(
        0,
        Math.acos(
          Math.min(1, Math.max(-1, dy / (Math.hypot(dx, dy, dz) || 1))),
        ) / 1.9,
      ),
    );
  }
  return [fu, fv];
}

/** Hair on the scalp: thickness by the style, curls, closed at the hairline. */
function scalp(
  t: Tailor,
  f: Frame,
  sp: Spec,
  color: string,
  seed: number,
): Surf | undefined {
  const H = hairline(sp.front, sp.back, sp.sideburn ?? 0.0);
  let s = head(t, f, H);
  if (sp.strip) {
    const keep = field(s, (i) => sp.strip! - Math.abs(s.a.pos[i * 3]));
    s = clipAll(s, [keep]);
  }
  if (!s.idx.length) return undefined;
  const sd = seed * 3.7;
  s = offset(s, (i) => {
    const x = s.a.pos[i * 3] - f.cx;
    const y = s.a.pos[i * 3 + 1] - f.cy;
    const z = s.a.pos[i * 3 + 2] - f.cz;
    const top = smooth(0.0, 0.1, y);
    const rise = y - H(Math.atan2(x, z));
    let d =
      0.003 +
      (sp.thick - 0.003) * smooth(0, sp.taper ?? 0.04, rise) +
      (sp.crown ?? 0) * top;
    if (sp.quiff)
      d +=
        sp.quiff *
        smooth(0.03, 0.09, z) *
        smooth(0.04, 0.1, y) *
        (1 - smooth(0.0, 0.07, Math.abs(x)));
    if (sp.part)
      d += 0.006 * Math.sign(x + 0.03) * smooth(0, 0.08, y) * sp.part;
    if (sp.curl)
      d +=
        sp.curl *
        (0.5 + 0.5 * vnoise(x * sp.freq! + sd, y * sp.freq!, z * sp.freq!));
    return d;
  });
  s = relax(s, sp.curl ? 1 : 3, 0.4);
  s = { ...s, a: { ...s.a, nor: normals(s) } };
  s = seal(s, sp.strip ? sp.thick * 0.9 : 0.01);
  const [fu, fv] = strands(s, f);
  return slim(s, color, HAIR, fu, fv);
}

/** A lathe: rings of radius r(k) (x, z scaled) at heights from y0 down to y1, an arc of `from`..`to` radians around +z. */
function sheet(
  rows: number,
  cols: number,
  at: (k: number, j: number) => [number, number, number],
): Surf {
  const n = (rows + 1) * (cols + 1);
  const pos = new Float32Array(n * 3);
  const w = new Float32Array(n * BONES);
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  for (let k = 0; k <= rows; k++)
    for (let j = 0; j <= cols; j++) {
      const i = k * (cols + 1) + j;
      const p = at(k / rows, j / cols);
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];
      w[i * BONES + BONE.head] = 1;
      fu[i] = j / cols;
      fv[i] = k / rows;
    }
  const idx: number[] = [];
  for (let k = 0; k < rows; k++)
    for (let j = 0; j < cols; j++) {
      const a = k * (cols + 1) + j;
      idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  const s: Surf = {
    n,
    idx,
    a: {
      pos,
      nor: new Float32Array(n * 3),
      w,
      arm: new Float32Array(n),
      fu,
      fv,
    },
  };
  s.a.nor = normals(s);
  return s;
}

/** Turns the winding round when the normals of a lathe-like sheet point at the axis (x, z) instead of away from it. */
function facing(s: Surf, ax: number, az: number): Surf {
  let sum = 0;
  for (let i = 0; i < s.n; i++)
    sum +=
      s.a.nor[i * 3] * (s.a.pos[i * 3] - ax) +
      s.a.nor[i * 3 + 2] * (s.a.pos[i * 3 + 2] - az);
  if (sum >= 0) return s;
  const idx = s.idx.slice();
  for (let q = 0; q < idx.length; q += 3)
    [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
  const out = { ...s, idx };
  out.a = { ...out.a, nor: normals(out) };
  return out;
}

/** The sheet and an inner copy `d` inside it, back to front: a lock of hair with a thickness, seen from both sides. */
function thick(s: Surf, d: number): Surf {
  const inner = join([s]);
  const pos = new Float32Array(inner.a.pos);
  const nor = new Float32Array(inner.a.nor);
  for (let i = 0; i < inner.n; i++) {
    pos[i * 3] -= nor[i * 3] * d;
    pos[i * 3 + 1] -= nor[i * 3 + 1] * d;
    pos[i * 3 + 2] -= nor[i * 3 + 2] * d;
    nor[i * 3] *= -1;
    nor[i * 3 + 1] *= -1;
    nor[i * 3 + 2] *= -1;
  }
  const idx = inner.idx.slice();
  for (let q = 0; q < idx.length; q += 3)
    [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
  return join([s, { ...inner, a: { ...inner.a, pos, nor }, idx }]);
}

/** Outline of the body at a height (m, pelvis frame): back z and half width, from the vertices that are not arms. */
function outline(
  t: Tailor,
  y: number,
): { back: number; front: number; half: number } {
  const s = t.cloth.s;
  let back = 1e9;
  let front = -1e9;
  let half = 0;
  for (let i = 0; i < s.n; i++) {
    if (Math.abs(s.a.pos[i * 3 + 1] - y) > 0.02 || s.a.arm[i] > 0.4) continue;
    const x = Math.abs(s.a.pos[i * 3]);
    if (x > 0.26) continue;
    half = Math.max(half, x);
    back = Math.min(back, s.a.pos[i * 3 + 2]);
    front = Math.max(front, s.a.pos[i * 3 + 2]);
  }
  return { back, front, half };
}

/** Long hair: a curtain over the back from the crown to `drop`, locks over the shoulders. */
function curtain(
  t: Tailor,
  f: Frame,
  sp: Spec,
  color: string,
  seed: number,
): Surf[] {
  const rig = RIGS[t.m];
  const bottom = f.cy + sp.drop!;
  const top = f.cy + 0.05;
  const rows = 14;
  const cols = 28;
  const waves = sp.curl ?? 0;
  const profile = (v: number): { rx: number; zc: number; zr: number } => {
    const y = top + (bottom - top) * v;
    const dy = y - f.cy;
    // Head shell down to the neck, then the outline of the shoulders and the back.
    // Below the head's middle the shell keeps most of its size: the hair falls from the skull over the nape.
    const e = Math.max(
      Math.sqrt(Math.max(0, 1 - (dy / (f.ry * 1.05)) ** 2)),
      dy < 0 ? 0.8 : 0,
    );
    const hx = (f.rx + sp.thick) * e;
    const hz = (f.rz + sp.thick) * e;
    const o = outline(t, y);
    const neckY = rig.neck[0] - rig.hip;
    const body = y < neckY + 0.05 ? smooth(neckY + 0.05, neckY - 0.04, y) : 0;
    // Below the neck the hair hangs about as wide as the head, on the back (the body is wider: it is not a cape).
    const rx = Math.max(hx, body * (f.rx + sp.thick) * 1.12);
    const back = (1 - body) * (f.cz - hz) + body * (o.back - 0.05);
    const front = (1 - body) * (f.cz + hz) + body * (o.back + 0.07);
    const zr = Math.max(0.03, (front - back) / 2);
    const zc = (front + back) / 2;
    return { rx: Math.max(rx, 0.03), zc, zr: Math.max(zr, 0.03) };
  };
  const arc = 1.65;
  const back = sheet(rows, cols, (v0, u) => {
    // The hem is rounded: the middle of the back hangs longest, the sides end higher.
    const side = Math.abs(u - 0.5) * 2;
    const v = v0 * (1 - 0.2 * side * side);
    const p = profile(v);
    const th = (u - 0.5) * 2 * arc;
    const wob = waves * Math.sin(v * 24 + u * 9 + seed);
    const r = 1 + wob;
    return [
      Math.sin(th) * p.rx * r,
      top +
        (bottom - top) * v +
        (v0 > 0.9 ? 0.004 * Math.sin(u * 40 + seed) : 0),
      p.zc - Math.cos(th) * p.zr * r,
    ];
  });
  // Ends of the arc fall back in: keep the sheet closed off with its own thickness by doubling it slightly inward.
  const [fu, fv] = [back.a.fu, back.a.fv];
  void fu;
  void fv;
  const front = thick(facing(back, f.cx, f.cz), 0.01);
  return [slim(front, color, HAIR, front.a.fu, front.a.fv)];
}

/** A sphere on the head (bun) at a point relative to the head centre. */
function ball(
  f: Frame,
  color: string,
  at: [number, number, number],
  r: number,
  sy = 1,
): Surf {
  const g = new SphereGeometry(r, 12, 9);
  g.scale(1, sy, 1);
  g.translate(f.cx + at[0], f.cy + at[1], f.cz + at[2]);
  const nb = g.toNonIndexed();
  const n = nb.getAttribute('position').count;
  const s = rigid(nb, BONE.head, color);
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  const uv = nb.getAttribute('uv');
  for (let i = 0; i < n; i++) {
    fu[i] = uv.getX(i);
    fv[i] = 1 - uv.getY(i);
  }
  return {
    ...slim(
      { ...s, a: { ...s.a, arm: new Float32Array(n) } },
      color,
      HAIR,
      fu,
      fv,
    ),
  };
}

/** A tapered tube from `a` to `b` (head frame offsets), radius r0 -> r1, with a little sway. */
function tube(
  f: Frame,
  color: string,
  pts: [number, number, number][],
  r0: number,
  r1: number,
): Surf {
  const rows = pts.length - 1;
  const cols = 10;
  const s = sheet(rows * 3, cols, (v, u) => {
    const x = v * rows;
    const k = Math.min(rows - 1, Math.floor(x));
    const q = x - k;
    const a = pts[k];
    const b = pts[k + 1];
    const c = [
      a[0] + (b[0] - a[0]) * q,
      a[1] + (b[1] - a[1]) * q,
      a[2] + (b[2] - a[2]) * q,
    ];
    const r = r0 + (r1 - r0) * v;
    const th = u * Math.PI * 2;
    // Rings stay horizontal: the tubes here hang or stand.
    return [
      f.cx + c[0] + Math.sin(th) * r,
      f.cy + c[1],
      f.cz + c[2] + Math.cos(th) * r,
    ];
  });
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < s.n; i++) {
    mx += s.a.pos[i * 3];
    mz += s.a.pos[i * 3 + 2];
  }
  const closed = facing(s, mx / s.n, mz / s.n);
  return slim(closed, color, HAIR, closed.a.fu, closed.a.fv);
}

/** What the style puts on the scalp: buns, a ponytail, a braid. */
function extras(
  t: Tailor,
  f: Frame,
  sp: Spec,
  color: string,
  seed: number,
): Surf[] {
  void t;
  void seed;
  switch (sp.extra) {
    case 'bun':
      return [ball(f, color, [0, f.ry * 0.95, -0.04], 0.052, 0.9)];
    case 'manbun':
      return [ball(f, color, [0, f.ry * 0.92, -0.075], 0.05, 0.9)];
    case 'lowbun':
      return [ball(f, color, [0, -f.ry * 0.5, -f.rz - 0.03], 0.05, 0.9)];
    case 'buns':
      return [
        ball(f, color, [f.rx * 0.9, f.ry * 0.85, -0.02], 0.046),
        ball(f, color, [-f.rx * 0.9, f.ry * 0.85, -0.02], 0.046),
      ];
    case 'pony':
      return [
        tube(
          f,
          color,
          [
            [0, f.ry * 0.35, -f.rz - 0.015],
            [0, f.ry * 0.05, -f.rz - 0.05],
            [0, -f.ry * 0.7, -f.rz - 0.055],
            [0, -f.ry * 1.9, -f.rz - 0.035],
          ],
          0.03,
          0.014,
        ),
      ];
    case 'braid':
      return [
        tube(
          f,
          color,
          [
            [0, f.ry * 0.0, -f.rz - 0.02],
            [0, -f.ry * 0.9, -f.rz - 0.04],
            [0, -f.ry * 2.0, -f.rz - 0.05],
            [0, -f.ry * 3.1, -f.rz - 0.045],
          ],
          0.028,
          0.01,
        ),
      ];
    default:
      return [];
  }
}

/** The hair of a style, as surfaces on the head bone. */
export function hairOf(
  t: Tailor,
  style: HairStyle,
  color: string,
  seed: number,
): Surf[] {
  const sp = STYLES[style];
  if (!sp) return [];
  const f = frame(t);
  const out: Surf[] = [];
  const sc = scalp(t, f, sp, color, seed);
  if (sc) out.push(sc);
  if (sp.drop !== undefined && sp.drop < -0.1)
    out.push(...curtain(t, f, sp, color, seed));
  out.push(...extras(t, f, sp, color, seed));
  return out;
}

export type HatShape = 'cap' | 'beanie' | 'helmet' | 'hood';

/** A hat's lower edge by azimuth: over the brow, down the temples to `side`, to `back` at the nape. */
function hatLine(
  front: number,
  side: number,
  back: number,
): (phi: number) => number {
  const pts: [number, number][] = [
    [0, front],
    [0.7, front - 0.01],
    [1.1, side],
    [1.9, side],
    [2.5, (side + back) / 2],
    [Math.PI, back],
  ];
  return (phi) => {
    const a = Math.abs(phi);
    for (let k = 1; k < pts.length; k++)
      if (a <= pts[k][0]) {
        const t = (a - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]);
        const e = t * t * (3 - 2 * t);
        return pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * e;
      }
    return back;
  };
}

interface Hat {
  line: (phi: number) => number;
  thick: number;
  /** Ears under the hat; a rolled edge (extra thickness, m) over this height (m) of the edge. */
  ears: boolean;
  roll?: [number, number];
  /** Cell and the fabric of the hat. */
  cell: number;
}

/** A hat: the same head cut at its own edge, thicker, with its brim / roll / hood. */
export function hatOf(t: Tailor, kind: HatShape, color: string): Surf[] {
  const f = frame(t);
  const out: Surf[] = [];
  const hats: Record<HatShape, Hat> = {
    cap: {
      line: hatLine(0.035, 0.03, -0.01),
      thick: 0.014,
      ears: false,
      cell: HAT,
    },
    beanie: {
      line: hatLine(0.03, -0.005, -0.05),
      thick: 0.016,
      ears: false,
      roll: [0.011, 0.045],
      cell: KNIT,
    },
    helmet: {
      line: hatLine(0.025, -0.02, -0.07),
      thick: 0.026,
      ears: true,
      cell: HAT,
    },
    hood: {
      line: hatLine(0.04, -0.05, -0.1),
      thick: 0.02,
      ears: true,
      roll: [0.01, 0.025],
      cell: KNIT,
    },
  };
  const h = hats[kind];
  let s = head(t, f, h.line, 0.19, !h.ears);
  if (!s.idx.length) return out;
  if (h.ears) {
    // The ears are under it: a smooth bulge over them instead of their folds.
    const pos = new Float32Array(s.a.pos);
    for (let i = 0; i < s.n; i++) {
      const x = pos[i * 3] - f.cx;
      const dy = pos[i * 3 + 1] - f.cy + 0.02;
      const phi = Math.abs(Math.atan2(x, pos[i * 3 + 2] - f.cz));
      const rise =
        pos[i * 3 + 1] - f.cy - h.line(Math.atan2(x, pos[i * 3 + 2] - f.cz));
      // Snug at the edge, the bulge only above it.
      const w =
        smooth(0, 0.035, rise) *
        smooth(0.9, 1.35, phi) *
        (1 - smooth(2.0, 2.6, phi)) *
        Math.exp(-((dy / 0.07) ** 2));
      const out = f.rx + 0.014 - Math.abs(x);
      if (out > 0) pos[i * 3] += Math.sign(x) * out * w;
    }
    s = relax({ ...s, a: { ...s.a, pos } }, 3, 0.5);
  }
  s = offset(s, (i) => {
    const x = s.a.pos[i * 3] - f.cx;
    const y = s.a.pos[i * 3 + 1] - f.cy;
    const z = s.a.pos[i * 3 + 2] - f.cz;
    const rise = y - h.line(Math.atan2(x, z));
    let d = h.thick + 0.008 * smooth(0, 0.1, y);
    // Snug at the edge, a rolled edge or cuff there.
    if (h.roll) d += h.roll[0] * (1 - smooth(0, h.roll[1], rise));
    return d;
  });
  s = relax(s, 2, 0.4);
  s = { ...s, a: { ...s.a, nor: normals(s) } };
  s = seal(s, 0.01);
  const [fu, fv] = strands(s, f);
  out.push(slim(s, color, h.cell, fu, fv));
  if (kind === 'cap' || kind === 'helmet') {
    // A peak: a thick curved plate over the brow, wider than the head, curling down at the tip.
    const g = new BufferGeometry();
    const seg = 16;
    const pos: number[] = [];
    const idx: number[] = [];
    const reach = kind === 'cap' ? 0.075 : 0.05;
    const th0 = kind === 'cap' ? 1.0 : 0.9;
    const top = h.line(0) - 0.004;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg - 0.5) * 2 * th0;
      const c = Math.cos(th * 0.9);
      // Rows: root, tip; layers: top, underside. The plan is rounded: the tip reaches least at the sides.
      for (const [r, drop] of [
        [-0.006, 0],
        [reach * Math.pow(Math.max(0, c), 0.7), 0.016],
      ] as const)
        for (const dy of [0.0035, -0.0035])
          pos.push(
            f.cx + Math.sin(th) * (f.rx + h.thick + (r > 0 ? 0.01 : 0)),
            f.cy + top - drop + dy,
            f.cz + Math.cos(th) * (f.rz + h.thick + r),
          );
    }
    // Vertex (j, row, layer) = j * 4 + row * 2 + layer.
    const q = (j: number, row: number, layer: number): number =>
      j * 4 + row * 2 + layer;
    for (let j = 0; j < seg; j++) {
      // Top layer (0) facing up, underside (1) facing down, a rim round the tip and the sides.
      idx.push(
        q(j, 0, 0),
        q(j, 1, 0),
        q(j + 1, 0, 0),
        q(j + 1, 0, 0),
        q(j, 1, 0),
        q(j + 1, 1, 0),
      );
      idx.push(
        q(j, 0, 1),
        q(j + 1, 0, 1),
        q(j, 1, 1),
        q(j + 1, 0, 1),
        q(j + 1, 1, 1),
        q(j, 1, 1),
      );
      idx.push(
        q(j, 1, 0),
        q(j, 1, 1),
        q(j + 1, 1, 0),
        q(j + 1, 1, 0),
        q(j, 1, 1),
        q(j + 1, 1, 1),
      );
    }
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ng = g.toNonIndexed();
    const peak = rigid(ng, BONE.head, color);
    const n = peak.n;
    out.push(
      slim(
        { ...peak, a: { ...peak.a, arm: new Float32Array(n) } },
        color,
        HAT,
        new Float32Array(n).fill(0.5),
        new Float32Array(n).fill(0.5),
      ),
    );
  }
  return out;
}
