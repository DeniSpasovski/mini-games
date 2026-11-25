import { rectOutline, type Local, type V3, type Wall } from './common';
import type { Site } from './sites';
import { opening } from './start-blocks';

/**
 * The two blocks of flats south of the start's car park and the glass stair tower between them, built one-off from drive
 * videos: the seven-storey block with its green barrel roof over a glazed top floor (a green-mullioned arch on each end),
 * balconies with glass rails and green fascias, green and maroon cladding on its corner bays, a glass lift drum on its
 * north-west corner; the six-storey block with a maroon bay column, a green-clad west end and a glazed penthouse under a
 * thin roof on posts; the blue glass tower at the six-storey block's north-east corner. Local frames: x east, z south,
 * y up from the ground at the site, metres.
 */
export const ARCH_SITE: Site = { x: 1571.5, z: -1066, yaw: 0 };
export const TERRACE_SITE: Site = { x: 1544.5, z: -1049.5, yaw: 0 };
/** Half sizes of the two blocks' bodies. */
export const ARCH = { hw: 11.5, hd: 19 };
export const TERRACE = { hw: 15.5, hd: 10.5 };
/** The glass tower in the six-storey block's frame: x0, x1, z0, z1. */
export const TOWER = [9.5, 15.5, -14.5, -8.5] as const;
/** Heights over the blocks' feet: the curved-roof block's apex, the six-storey block's roof. */
export const ARCH_TOP = 25.6;
export const TERRACE_TOP = 18.4;

const CREAM = '#f0d9a8';
const SLAB = '#ddd3bf';
const PLINTH = '#b9b0a0';
const GREEN = '#2f6a52';
const CLAD_GREEN = '#3f7a5e';
const ROOF_GREEN = '#355f4b';
const MULLION = '#2b5a45';
const RAIL = '#9aa1a3';
const MAROON = '#7a3036';
const WHITE = '#eeeeea';
const PANE = '#76858c';
const TOWER_GLASS = '#3f93c9';
const LIFT_GLASS = '#d4eee2';

export type Face = 'n' | 's' | 'e' | 'w';
export interface Body {
  hw: number;
  hd: number;
}

const wallOf = (b: Body, f: Face): Wall =>
  f === 'n'
    ? { o: [0, 0, -b.hd], n: [0, 0, -1] }
    : f === 's'
      ? { o: [0, 0, b.hd], n: [0, 0, 1] }
      : f === 'e'
        ? { o: [b.hw, 0, 0], n: [1, 0, 0] }
        : { o: [-b.hw, 0, 0], n: [-1, 0, 0] };

/** The wall's own run (s) of a point `a` along face f (a = x on the north and south faces, z on the east and west). */
const sOf = (f: Face, a: number): number => (f === 'n' || f === 'e' ? -a : a);
const span = (f: Face, a0: number, a1: number): [number, number] => {
  const [p, q] = [sOf(f, a0), sOf(f, a1)];
  return [Math.min(p, q), Math.max(p, q)];
};

/** A box against face f: a0..a1 along it, o0..o1 out of its plane, y0..y1. */
export function fbox(
  l: Local,
  b: Body,
  f: Face,
  key: Parameters<Local['box']>[0],
  a0: number,
  a1: number,
  o0: number,
  o1: number,
  y0: number,
  y1: number,
  c: string,
): void {
  if (f === 'n') l.box(key, [a0, y0, -b.hd - o1], [a1, y1, -b.hd - o0], c);
  else if (f === 's') l.box(key, [a0, y0, b.hd + o0], [a1, y1, b.hd + o1], c);
  else if (f === 'w') l.box(key, [-b.hw - o1, y0, a0], [-b.hw - o0, y1, a1], c);
  else l.box(key, [b.hw + o0, y0, a0], [b.hw + o1, y1, a1], c);
}

/** A flat skin on face f (cladding, a recess), `off` out of the wall. */
export function skin(
  l: Local,
  b: Body,
  f: Face,
  key: Parameters<Local['box']>[0],
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  c: string,
  off = 0.04,
): void {
  const [s0, s1] = span(f, a0, a1);
  l.panel(key, wallOf(b, f), rectOutline(s0, y0, s1, y1), c, { off });
}

/** A window (dark glass in a frame) on face f; `door` splits it down the middle. */
export function win(
  l: Local,
  b: Body,
  f: Face,
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  o: { frame?: string; door?: boolean; off?: number } = {},
): void {
  const [s0, s1] = span(f, a0, a1);
  opening(l, wallOf(b, f), s0, y0, s1, y1, {
    frame: o.frame ?? '#3b3f42',
    mullion: o.door,
    off: o.off ?? 0.06,
  });
}

/** A run of tall glazing (reflective panes, mullions every `pane` m and a transom) on face f. */
function glazing(
  l: Local,
  b: Body,
  f: Face,
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  frame: string,
  pane = 1.3,
  off = 0.06,
): void {
  const [s0, s1] = span(f, a0, a1);
  const w = wallOf(b, f);
  l.panel('glass', w, rectOutline(s0, y0, s1, y1), PANE, { off });
  const n = Math.max(1, Math.round((s1 - s0) / pane));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    l.panel('paint', w, rectOutline(s - 0.05, y0, s + 0.05, y1), frame, {
      off: off + 0.02,
    });
  }
  for (const y of [y0, y1 - 0.08])
    l.panel('paint', w, rectOutline(s0, y, s1, y + 0.08), frame, {
      off: off + 0.02,
    });
}

/** A white air-conditioning unit on face f at (a, y). */
export function ac(l: Local, b: Body, f: Face, a: number, y: number): void {
  fbox(
    l,
    b,
    f,
    'paint',
    a - 0.42,
    a + 0.42,
    0.05,
    0.33,
    y,
    y + 0.55,
    '#e9ebec',
  );
}

/**
 * A balcony on face f over a0..a1, its floor at `y`, `depth` m out: the slab with a coloured fascia on its edge, a glass
 * rail (or a solid clad parapet) round its free sides, a metal handrail on top.
 */
function balcony(
  l: Local,
  b: Body,
  f: Face,
  a0: number,
  a1: number,
  y: number,
  depth: number,
  fascia: string,
  o: {
    solid?: string;
    ends?: 'both' | 'a0' | 'a1' | 'none';
    slab?: boolean;
    rail?: [number, number];
  } = {},
): void {
  const [r0, r1] = o.rail ?? [a0, a1];
  if (o.slab ?? true)
    fbox(l, b, f, 'render', a0, a1, 0, depth, y - 0.24, y, SLAB);
  fbox(
    l,
    b,
    f,
    'paint',
    r0,
    r1,
    depth,
    depth + 0.04,
    y - 0.3,
    y + 0.02,
    fascia,
  );
  const rail = (p0: number, p1: number, q0: number, q1: number): void => {
    if (o.solid) fbox(l, b, f, 'panel', p0, p1, q0, q1, y, y + 1.05, o.solid);
    else {
      fbox(l, b, f, 'railGlass', p0, p1, q0, q1, y, y + 1.0, '#ffffff');
      fbox(
        l,
        b,
        f,
        'metal',
        p0,
        p1,
        q0 - 0.01,
        q1 + 0.01,
        y + 1.0,
        y + 1.05,
        RAIL,
      );
    }
  };
  rail(r0, r1, depth - 0.1, depth - 0.05);
  const ends = o.ends ?? 'both';
  if (ends === 'both' || ends === 'a0') rail(a0, a0 + 0.05, 0, depth - 0.05);
  if (ends === 'both' || ends === 'a1') rail(a1 - 0.05, a1, 0, depth - 0.05);
}

/**
 * A barrel roof over x0..x1 (springing at y), its ridge along z0..z1 rising `rise`: green metal sheet with a pale ceiling
 * under it and a deep green edge, each arched end glazed over -gHalf..gHalf in the plane `inset` m in from the roof's end,
 * green mullions dividing it into three, a transom at the springing.
 */
function barrel(
  l: Local,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  rise: number,
  inset: number,
  gHalf: number,
): void {
  const half = (x1 - x0) / 2;
  const cx = (x0 + x1) / 2;
  const r = (half * half + rise * rise) / (2 * rise);
  const yc = y + rise - r;
  const a = Math.asin(half / r);
  const N = 18;
  const EDGE = 0.45;
  const pt = (t: number, z: number, dy = 0): V3 => [
    cx + r * Math.sin(t),
    yc + r * Math.cos(t) + dy,
    z,
  ];
  const uv = (p: V3): [number, number] => [
    r * (Math.asin(Math.max(-1, Math.min(1, (p[0] - cx) / r))) + a),
    p[2],
  ];
  for (let i = 0; i < N; i++) {
    const t0 = -a + (2 * a * i) / N;
    const t1 = -a + (2 * a * (i + 1)) / N;
    const tm = (t0 + t1) / 2;
    const out: V3 = [Math.sin(tm), Math.cos(tm), 0];
    l.fan(
      'sheet',
      [pt(t0, z0), pt(t1, z0), pt(t1, z1), pt(t0, z1)],
      ROOF_GREEN,
      out,
      uv,
    );
    l.fan(
      'paint',
      [
        pt(t0, z0, -EDGE),
        pt(t1, z0, -EDGE),
        pt(t1, z1, -EDGE),
        pt(t0, z1, -EDGE),
      ],
      '#d6d2c8',
      [-out[0], -out[1], 0],
      uv,
    );
    for (const [z, s] of [
      [z0, -1],
      [z1, 1],
    ] as const)
      l.fan(
        'paint',
        [pt(t0, z), pt(t1, z), pt(t1, z, -EDGE), pt(t0, z, -EDGE)],
        ROOF_GREEN,
        [0, 0, s],
        uv,
      );
  }
  // The sides' eaves (the sheet's long edges).
  for (const s of [-1, 1]) {
    const t = s * a;
    const p = pt(t, z0);
    const q = pt(t, z0, -EDGE);
    l.fan(
      'paint',
      [p, pt(t, z1), pt(t, z1, -EDGE), q],
      ROOF_GREEN,
      [s * Math.sin(a), Math.cos(a) * 0.2, 0],
      (v) => [v[2], v[1]],
    );
  }
  const archAt = (x: number): number =>
    yc + Math.sqrt(Math.max(0, r * r - (x - cx) ** 2)) - EDGE;
  const gx0 = cx - gHalf;
  const gx1 = cx + gHalf;
  for (const [z, s] of [
    [z0 + inset, -1],
    [z1 - inset, 1],
  ] as const) {
    const pts: V3[] = [[gx0, y, z]];
    for (let i = 0; i <= N; i++) {
      const x = gx0 + ((gx1 - gx0) * i) / N;
      pts.push([x, archAt(x), z]);
    }
    pts.push([gx1, y, z]);
    l.fan('glass', pts, '#61727b', [0, 0, s], (p) => [p[0] / 2, p[1] / 2]);
    // Two heavy mullions in thirds, thin ones between, the transom at the springing.
    for (let i = 1; i < 6; i++) {
      const x = gx0 + ((gx1 - gx0) * i) / 6;
      const heavy = i % 2 === 0;
      const hw = heavy ? 0.16 : 0.06;
      l.box(
        'paint',
        [x - hw, y, z - 0.1],
        [x + hw, archAt(x), z + 0.1],
        MULLION,
      );
    }
    l.box('paint', [gx0, y - 0.08, z - 0.1], [gx1, y + 0.12, z + 0.1], MULLION);
    const ty = y + 2.2;
    const xs = Math.sqrt(Math.max(0, r * r - (ty + EDGE - yc) ** 2));
    l.box(
      'paint',
      [Math.max(gx0, cx - xs), ty - 0.06, z - 0.1],
      [Math.min(gx1, cx + xs), ty + 0.06, z + 0.1],
      MULLION,
    );
  }
}

/** A vertical prism over `outline` (x, z pairs, counter-clockwise seen from above), y0..y1, its sides as `key`. */
export function prism(
  l: Local,
  key: Parameters<Local['box']>[0],
  outline: [number, number][],
  y0: number,
  y1: number,
  c: string,
): void {
  const n = outline.length;
  const cx = outline.reduce((s, p) => s + p[0], 0) / n;
  const cz = outline.reduce((s, p) => s + p[1], 0) / n;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [px, pz] = outline[i];
    const [qx, qz] = outline[(i + 1) % n];
    const len = Math.hypot(qx - px, qz - pz);
    const mx = (px + qx) / 2 - cx;
    const mz = (pz + qz) / 2 - cz;
    const u0 = u;
    l.fan(
      key,
      [
        [px, y0, pz],
        [qx, y0, qz],
        [qx, y1, qz],
        [px, y1, pz],
      ],
      c,
      [mx, 0, mz],
      (p) => [u0 + Math.hypot(p[0] - px, p[2] - pz), p[1]],
    );
    u += len;
  }
}

/** Corner points of a rectangle with the given corners rounded (radius r, `seg` steps), counter-clockwise from above. */
function roundedRect(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  r: { nw?: number; ne?: number; se?: number; sw?: number },
  seg = 4,
): [number, number][] {
  const out: [number, number][] = [];
  const corner = (cx: number, cz: number, rad: number, a0: number): void => {
    for (let i = 0; i <= seg; i++) {
      const t = a0 + (Math.PI / 2) * (i / seg);
      out.push([cx + rad * Math.cos(t), cz + rad * Math.sin(t)]);
    }
  };
  // From the north-west corner round by north-east, south-east, south-west (counter-clockwise seen from +y with z south).
  const nw = r.nw ?? 0;
  const ne = r.ne ?? 0;
  const se = r.se ?? 0;
  const sw = r.sw ?? 0;
  if (nw) corner(x0 + nw, z0 + nw, nw, Math.PI);
  else out.push([x0, z0]);
  if (ne) corner(x1 - ne, z0 + ne, ne, -Math.PI / 2);
  else out.push([x1, z0]);
  if (se) corner(x1 - se, z1 - se, se, 0);
  else out.push([x1, z1]);
  if (sw) corner(x0 + sw, z1 - sw, sw, Math.PI / 2);
  else out.push([x0, z1]);
  return out;
}

/** The lowest ground under a body (and `extra` points), local y. */
export function footOf(
  l: Local,
  b: Body,
  ground: (x: number, z: number) => number,
  extra: [number, number][] = [],
): number {
  let lo = Infinity;
  for (const [x, z] of [
    [-b.hw, -b.hd],
    [0, -b.hd],
    [b.hw, -b.hd],
    [b.hw, 0],
    [b.hw, b.hd],
    [0, b.hd],
    [-b.hw, b.hd],
    [-b.hw, 0],
    ...extra,
  ])
    lo = Math.min(lo, ground(l.site.x + x, l.site.z + z) - l.baseY);
  return lo;
}

/** Window sill and head of storey k's ordinary windows, given its floor level. */
const SILL = 0.9;
const HEAD = 2.35;

/** The seven-storey block with the barrel roof. */
export function buildArchBlock(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const b = ARCH;
  const { hw, hd } = b;
  const lo = footOf(l, b, ground);
  const G = 3.4;
  const F = 3;
  const lv = (k: number): number => (k === 0 ? 0 : G + (k - 1) * F);
  const E = lv(6);
  // Body, plinth, the slab bands.
  l.box('render', [-hw, lo - 0.4, -hd], [hw, E - 0.3, hd], CREAM);
  l.box(
    'render',
    [-hw - 0.05, lo - 0.4, -hd - 0.05],
    [hw + 0.05, 0.7, hd + 0.05],
    PLINTH,
  );
  for (let k = 1; k <= 5; k++)
    l.box(
      'render',
      [-hw - 0.1, lv(k) - 0.32, -hd - 0.1],
      [hw + 0.1, lv(k), hd + 0.1],
      SLAB,
    );

  // North face, to the start: the east corner balcony (it wraps round onto the east face), two windows, a wide loggia,
  // a window, the green-clad west bay with its balconies.
  for (let k = 0; k <= 5; k++) {
    const y = lv(k);
    const balconies = k >= 2;
    const fascia = k % 2 ? GREEN : SLAB;
    skin(l, b, 'n', 'panel', -hw, -7, y, y + F, CLAD_GREEN);
    skin(l, b, 'w', 'panel', -hd, -15, y, y + F, CLAD_GREEN);
    if (k === 0) {
      win(l, b, 'n', 4.4, 5.6, 1.0, 2.4);
      glazing(l, b, 'n', -3.4, 2.6, 0.7, 2.7, '#3b3f42');
      win(l, b, 'n', -5.6, -4.4, 1.0, 2.4);
      win(l, b, 'n', 8, 10.6, 1.0, 2.4);
      continue;
    }
    win(l, b, 'n', 4.4, 5.6, y + SILL, y + HEAD);
    win(l, b, 'n', 2.4, 3.4, y + SILL, y + HEAD);
    win(l, b, 'n', -5.6, -4.4, y + SILL, y + HEAD);
    if (balconies) {
      glazing(l, b, 'n', -3.4, 1.6, y + 0.05, y + 2.45, '#3b3f42');
      balcony(l, b, 'n', -3.6, 1.8, y, 0.9, fascia);
      glazing(l, b, 'n', 8, 10.8, y + 0.05, y + 2.45, '#3b3f42');
      balcony(l, b, 'n', 7.4, hw + 1.3, y, 1.3, fascia, { ends: 'a0' });
      balcony(l, b, 'e', -hd, -15, y, 1.3, fascia, {
        ends: 'a1',
        rail: [-hd - 1.3, -15],
      });
      glazing(l, b, 'n', -10.8, -8.2, y + 0.05, y + 2.45, '#3b3f42');
      balcony(l, b, 'n', -hw - 1.4, -7, y, 1.4, GREEN, { ends: 'a1' });
      balcony(l, b, 'w', -hd, -15, y, 1.4, GREEN, {
        ends: 'a1',
        rail: [-hd - 1.4, -15],
      });
    } else {
      win(l, b, 'n', -2.6, 0.8, y + SILL, y + HEAD, { door: true });
      win(l, b, 'n', 8.4, 10.4, y + SILL, y + HEAD, { door: true });
      win(l, b, 'n', -10.4, -8.6, y + SILL, y + HEAD);
    }
    if (k === 3) ac(l, b, 'n', 3.0, y + HEAD + 0.15);
  }
  // West face (to the road's bend), visible as far as the six-storey block (local z 6): the green bay round the corner,
  // a window, a balcony bay, the maroon-clad bay, windows; windows beyond (over the six-storey block's roof).
  for (let k = 0; k <= 5; k++) {
    const y = lv(k);
    const fascia = k % 2 ? GREEN : SLAB;
    skin(l, b, 'w', 'panel', -4.2, -0.8, y, y + F, MAROON);
    win(l, b, 'w', -3.1, -1.9, y + SILL, y + HEAD, { frame: WHITE });
    win(l, b, 'w', -13.4, -12.2, y + SILL, y + HEAD);
    for (const z of [1.2, 3.6, 7.6, 10.6, 13.6, 16.6])
      win(l, b, 'w', z - 0.6, z + 0.6, y + SILL, y + HEAD);
    if (k >= 1) {
      glazing(l, b, 'w', -10.2, -5.8, y + 0.05, y + 2.45, '#3b3f42');
      if (k >= 2) balcony(l, b, 'w', -10.6, -5.4, y, 1.2, fascia);
    }
    if (k === 2 || k === 4) ac(l, b, 'w', 2.4, y + HEAD + 0.15);
  }
  // East face (to the car park): windows on a 3.2 m rhythm, two balcony bays.
  for (let k = 0; k <= 5; k++) {
    const y = lv(k);
    const fascia = k % 2 ? GREEN : SLAB;
    for (const z of [-12.4, -9.2, 3.2, 14.4, 17.2])
      win(l, b, 'e', z - 0.6, z + 0.6, y + SILL, y + HEAD);
    if (k >= 1)
      for (const [z0, z1] of [
        [-6.6, 0.4],
        [5.8, 12.2],
      ]) {
        glazing(l, b, 'e', z0 + 0.4, z1 - 0.4, y + 0.05, y + 2.45, '#3b3f42');
        if (k >= 2) balcony(l, b, 'e', z0, z1, y, 1.2, fascia);
      }
    if (k === 0) win(l, b, 'e', -2.0, 0.2, 0, 2.5, { door: true, frame: RAIL });
  }
  l.box('paint', [hw, 2.6, -2.6], [hw + 1.8, 2.8, 0.8], '#d8d6d0');
  // South face (uphill): windows, a balcony bay in the middle.
  for (let k = 0; k <= 5; k++) {
    const y = lv(k);
    for (const x of [-9, -6, 6, 9])
      win(l, b, 's', x - 0.6, x + 0.6, y + SILL, y + HEAD);
    if (k >= 1) {
      glazing(l, b, 's', -3, 3, y + 0.05, y + 2.45, '#3b3f42');
      if (k >= 2) balcony(l, b, 's', -3.4, 3.4, y, 1.2, SLAB);
    }
  }

  // The top floor: a terrace slab out over the faces (green fascia, glass rail), a glazed storey a little in from them.
  const IN = 0.7;
  l.box(
    'render',
    [-hw - 1.5, E - 0.32, -hd - 1.5],
    [hw + 1.5, E, hd + 0.3],
    SLAB,
  );
  for (const f of ['n', 'e', 'w'] as Face[]) {
    const [a0, a1] = f === 'n' ? [-hw - 1.5, hw + 1.5] : [-hd - 1.5, hd + 0.3];
    balcony(l, b, f, a0, a1, E, 1.5, GREEN, { ends: 'none', slab: false });
  }
  const top: Body = { hw: hw - IN, hd: hd - IN };
  const SPRING = E + 2.7;
  l.box(
    'render',
    [-top.hw + 0.1, E, -top.hd + 0.1],
    [top.hw - 0.1, SPRING, top.hd - 0.1],
    CREAM,
  );
  for (const f of ['n', 's'] as Face[])
    glazing(l, top, f, -top.hw, top.hw, E, SPRING, MULLION, 2.4, 0.02);
  for (const f of ['e', 'w'] as Face[])
    glazing(l, top, f, -top.hd, top.hd, E, SPRING, MULLION, 2.4, 0.02);
  // (the arched ends glazed in the top floor's glass planes)
  barrel(
    l,
    -hw - 0.4,
    hw + 0.4,
    -hd - 1.2,
    hd + 1.2,
    SPRING,
    ARCH_TOP - SPRING,
    1.2 + IN,
    top.hw,
  );
  // The glass lift drum on the north-west corner, from the floor under the terrace to over the roof's eave.
  const drum: [number, number][] = [];
  const R = 1.5;
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    drum.push([-hw + 0.6 + R * Math.cos(t), -hd + 0.6 + R * Math.sin(t)]);
  }
  drum.reverse();
  // (clear pale green glass on a frame: rings at each floor, a post every other facet)
  prism(l, 'railGlass', drum, E - 0.3, SPRING + 2.2, LIFT_GLASS);
  for (const y of [E, E + 1.35, SPRING])
    prism(l, 'paint', drum, y - 0.06, y + 0.06, MULLION);
  drum.forEach(([x, z], i) => {
    if (i % 2 === 0)
      l.box(
        'paint',
        [x - 0.05, E - 0.3, z - 0.05],
        [x + 0.05, SPRING + 2.2, z + 0.05],
        MULLION,
      );
  });
  prism(l, 'paint', drum, SPRING + 2.2, SPRING + 2.45, MULLION);
  l.fan(
    'paint',
    drum.map(([x, z]): V3 => [x, SPRING + 2.45, z]),
    MULLION,
    [0, 1, 0],
    (p) => [p[0], p[2]],
  );
}

/** The six-storey block and the glass stair tower at its north-east corner. */
export function buildTerraceBlock(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const b = TERRACE;
  const { hw, hd } = b;
  const [tx0, tx1, tz0, tz1] = TOWER;
  const lo = footOf(l, b, ground, [
    [tx0, tz0],
    [tx1, tz0],
  ]);
  // Floors count from the north (road-side) foot; the ground rises behind it, burying the back of the lower floors.
  const f0 = Math.min(
    ground(l.site.x, l.site.z - hd) - l.baseY,
    ground(l.site.x - hw, l.site.z - hd) - l.baseY,
  );
  const G = 3.2;
  const F = 3;
  const lv = (k: number): number => f0 + (k === 0 ? 0 : G + (k - 1) * F);
  const P = lv(5);
  const ROOF = P + 2.9;
  l.box('render', [-hw, lo - 0.4, -hd], [hw, P - 0.3, hd], CREAM);
  l.box(
    'render',
    [-hw - 0.05, lo - 0.4, -hd - 0.05],
    [hw + 0.05, f0 + 0.6, hd + 0.05],
    PLINTH,
  );
  for (let k = 1; k <= 4; k++)
    l.box(
      'render',
      [-hw - 0.08, lv(k) - 0.3, -hd - 0.08],
      [hw + 0.08, lv(k), hd + 0.08],
      SLAB,
    );

  // North face: cream with windows from the tower to the maroon bay column, the bay, the green-clad west end with
  // balconies.
  for (let k = 0; k <= 4; k++) {
    const y = lv(k);
    for (const x of [7.4, 0.2])
      win(l, b, 'n', x - 0.65, x + 0.65, y + SILL, y + HEAD);
    win(l, b, 'n', 2.6, 5.0, y + SILL, y + HEAD, { door: true });
    skin(l, b, 'n', 'panel', -hw, -9, y, y + F, CLAD_GREEN);
    for (const x of [-10.6, -13.9])
      win(l, b, 'n', x - 0.6, x + 0.6, y + SILL, y + HEAD, { frame: WHITE });
    if (k >= 2)
      balcony(l, b, 'n', -hw - 1.2, -12.4, y, 1.2, k % 2 ? GREEN : SLAB, {
        ends: 'a1',
      });
    if (k === 1 || k === 3) ac(l, b, 'n', 1.4, y + HEAD + 0.15);
  }
  // The maroon bay column: 0.9 m out over storeys 1-4, a band of white-framed windows on each, narrow ones on its sides.
  l.box('render', [-8.5, lv(1) - 0.3, -hd - 0.9], [-2.5, P - 0.3, -hd], MAROON);
  const bayFront: Wall = { o: [-5.5, 0, -hd - 0.9], n: [0, 0, -1] };
  const baySides: Wall[] = [
    { o: [-8.5, 0, -hd - 0.45], n: [-1, 0, 0] },
    { o: [-2.5, 0, -hd - 0.45], n: [1, 0, 0] },
  ];
  for (let k = 1; k <= 4; k++) {
    const y = lv(k);
    for (const s of [-2.4, -0.8, 0.8])
      opening(l, bayFront, s, y + 0.8, s + 1.6, y + 2.4, {
        frame: WHITE,
        off: 0.04,
      });
    for (const w of baySides)
      opening(l, w, -0.2, y + 0.8, 0.2, y + 2.4, { frame: WHITE, off: 0.04 });
  }
  // West face (to the bend): green round the corner, windows, a balcony bay.
  for (let k = 0; k <= 4; k++) {
    const y = lv(k);
    skin(l, b, 'w', 'panel', -hd, -7.5, y, y + F, CLAD_GREEN);
    win(l, b, 'w', -9.4, -8.2, y + SILL, y + HEAD, { frame: WHITE });
    for (const z of [-5.6, 6.2, 9.0])
      win(l, b, 'w', z - 0.6, z + 0.6, y + SILL, y + HEAD);
    glazing(l, b, 'w', -2.4, 3.6, y + 0.05, y + 2.45, '#3b3f42');
    if (k >= 1) balcony(l, b, 'w', -2.8, 4.0, y, 1.2, k % 2 ? GREEN : SLAB);
  }
  // South face (into the slope; only its upper floors show).
  for (let k = 0; k <= 4; k++)
    for (const x of [-12, -8, -4, 0, 4, 8, 12])
      win(l, b, 's', x - 0.6, x + 0.6, lv(k) + SILL, lv(k) + HEAD);

  // The penthouse: set back 1.4 m on the road faces behind a glass-railed terrace, glazed, under a thin roof on posts.
  const ph: Body = { hw: hw - 1.4, hd: hd - 1.4 };
  l.box('render', [-hw - 0.3, P - 0.32, -hd - 0.3], [hw, P, hd], SLAB);
  balcony(l, b, 'n', -hw - 0.3, tx0, P, 0.3, SLAB, {
    ends: 'none',
    slab: false,
  });
  balcony(l, b, 'w', -hd - 0.3, hd, P, 0.3, SLAB, {
    ends: 'none',
    slab: false,
  });
  l.box('render', [-ph.hw, P, -ph.hd], [hw - 0.3, ROOF, hd - 0.3], CREAM);
  glazing(l, ph, 'n', -ph.hw, ph.hw, P, ROOF - 0.1, '#3b3f42', 1.6, 0.02);
  glazing(l, ph, 'w', -ph.hd, ph.hd, P, ROOF - 0.1, '#3b3f42', 1.6, 0.02);
  l.box(
    'paint',
    [-hw - 0.6, ROOF, -hd - 0.6],
    [hw + 0.2, ROOF + 0.22, hd + 0.2],
    '#e2ded6',
  );
  for (const x of [-hw - 0.2, -hw / 2, 0, hw / 2])
    l.box(
      'metal',
      [x - 0.06, P, -hd - 0.26],
      [x + 0.06, ROOF, -hd - 0.14],
      RAIL,
    );
  for (const z of [0, hd - 1])
    l.box(
      'metal',
      [-hw - 0.26, P, z - 0.06],
      [-hw - 0.14, ROOF, z + 0.06],
      RAIL,
    );
  // A flue and a dish on the roof.
  l.box('metal', [4, ROOF, 2], [4.35, ROOF + 1.6, 2.35], '#8d9296');
  l.box('paint', [7, ROOF + 0.2, 1], [7.1, ROOF + 0.9, 1.1], '#d0d2d2');

  // The stair tower: blue glass with rounded road-side corners, from the ground to a metre over the roof.
  const TT = ROOF + 1.0;
  const outline = roundedRect(tx0, tx1, tz0, tz1, { nw: 1.2, ne: 1.2 }, 5);
  prism(l, 'glass', outline, lo - 0.3, TT, TOWER_GLASS);
  for (const [x, z] of [
    [tx0 + 2, tz0],
    [tx0 + 4, tz0],
    [tx0, tz0 + 3],
    [tx1, tz0 + 3],
  ])
    l.box(
      'paint',
      [x - 0.05, lo, z - 0.05],
      [x + 0.05, TT, z + 0.05],
      '#244e6c',
    );
  for (let y = lv(1); y < TT; y += F)
    prism(
      l,
      'paint',
      roundedRect(
        tx0 - 0.03,
        tx1 + 0.03,
        tz0 - 0.03,
        tz1,
        { nw: 1.23, ne: 1.23 },
        5,
      ),
      y - 0.05,
      y,
      '#2d5f80',
    );
  prism(
    l,
    'render',
    roundedRect(
      tx0 - 0.15,
      tx1 + 0.15,
      tz0 - 0.15,
      tz1,
      { nw: 1.35, ne: 1.35 },
      5,
    ),
    TT,
    TT + 0.35,
    '#e6e2da',
  );
  l.fan(
    'render',
    roundedRect(
      tx0 - 0.15,
      tx1 + 0.15,
      tz0 - 0.15,
      tz1,
      { nw: 1.35, ne: 1.35 },
      5,
    ).map(([x, z]): V3 => [x, TT + 0.35, z]),
    '#e6e2da',
    [0, 1, 0],
    (p) => [p[0], p[2]],
  );
}
