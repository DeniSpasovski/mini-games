import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { CrewLivery } from '../../cars/shared/livery';
import { clip, join, normals, seal, type Surf } from './people-surf';

/**
 * A full-face helmet with its visor down (a dark shield over the eye port, hinged at the temples), built round a head.
 * Head frame: the origin is the centre of the head, +Z the face, +Y up, metres. The shell is a loft of plan outlines (a
 * dome over a waisted lower half); the visor's outline is cut exactly (people-surf.ts `clip`), and the paint is cut the
 * same way, so every edge is sharp at any mesh density. Nothing of the head shows.
 */

export interface HelmetParts {
  /** The painted shell and the visor: vertex colours, for a glossy material. */
  shell: BufferGeometry;
  /** Rubber edges: vertex colours, matt. */
  trim: BufferGeometry;
}

/** Top of the shell above the centre of the head (m): the room a helmet needs under a roof. */
export const HELMET_TOP = 0.162;
/** The back of the shell behind the centre of the head, at the height of the neck restraint's collar (m). */
export const HELMET_BACK = 0.146;
/** Where the head restraint's tethers clip on, either side at the back (the left one; mirror x). */
export const HELMET_POST: [number, number, number] = [0.098, -0.07, -0.085];

const RUBBER = '#141518';
/** A dark smoke visor. */
const VISOR = '#0b0d12';
const DOME_Y = 0.03;
const DOME_H = HELMET_TOP - DOME_Y;
const BOTTOM = -0.148;
/** Lower half, top to bottom: height, front, back, half width. */
const WAIST: [number, number, number, number][] = [
  [DOME_Y, 0.14, 0.154, 0.131],
  [-0.01, 0.145, 0.153, 0.132],
  [-0.05, 0.153, 0.146, 0.13],
  [-0.09, 0.158, 0.132, 0.124],
  [-0.125, 0.15, 0.114, 0.114],
  [BOTTOM, 0.134, 0.1, 0.104],
];
/** Plan outline: a superellipse a little squarer than an oval. */
const PLAN = 2.25;
/** Metres per radian round the shell at the height of the visor (outlines are drawn in this unrolled plane). */
const WRAP = 0.14;
/** The visor: a rounded shield from temple to temple, its lower edge rising to the hinges. */
const SHIELD = { y: 0.001, w: 0.18, h: 0.053, r: 0.044, hinge: 0.152 };

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  );
}

/** Front, back and half width of the shell at a height. */
function section(y: number): [number, number, number] {
  if (y >= DOME_Y) {
    const k = Math.min(1, (y - DOME_Y) / DOME_H);
    const s = Math.pow(Math.max(0, 1 - k * k), 0.425);
    return [WAIST[0][1] * s, WAIST[0][2] * s, WAIST[0][3] * s];
  }
  let i = 0;
  while (i < WAIST.length - 2 && y < WAIST[i + 1][0]) i++;
  const a = WAIST[Math.max(0, i - 1)];
  const b = WAIST[i];
  const c = WAIST[i + 1];
  const d = WAIST[Math.min(WAIST.length - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (y - b[0]) / (c[0] - b[0])));
  return [1, 2, 3].map((q) => catmull(a[q], b[q], c[q], d[q], t)) as [
    number,
    number,
    number,
  ];
}

const pw = (v: number): number =>
  Math.sign(v) * Math.pow(Math.abs(v), 2 / PLAN);

/** A point of the shell: `phi` round it (0 = the front, + = the left), at height `y`, `out` m off the surface. */
function shellAt(phi: number, y: number, out = 0): [number, number, number] {
  const [f, b, w] = section(y);
  const sx = Math.sin(phi);
  const cz = Math.cos(phi);
  const x = w * pw(sx);
  const z = (cz >= 0 ? f : b) * pw(cz);
  if (!out) return [x, y, z];
  const l = Math.hypot(x, z) || 1;
  return [x + (x / l) * out, y, z + (z / l) * out];
}

/** Signed distance to a rounded box (negative inside). */
function roundBox(x: number, y: number, w: number, h: number, r: number) {
  const dx = Math.abs(x) - (w - r);
  const dy = Math.abs(y) - (h - r);
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
    Math.min(Math.max(dx, dy), 0) -
    r
  );
}

type At = (x: number, y: number, z: number) => number;

const fieldOf = (s: Surf, f: At): Float32Array => {
  const out = new Float32Array(s.n);
  const p = s.a.pos;
  for (let i = 0; i < s.n; i++) {
    const v = f(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    // A vertex an earlier cut left on this line by rounding is on it (else every cut slivers the same triangles).
    out[i] = Math.abs(v) < 1e-6 ? 0 : v;
  }
  return out;
};

/** The two sides of a cut: where `f` >= 0 and where it is < 0. */
function cut(s: Surf, f: At): [Surf, Surf] {
  const v = fieldOf(s, f);
  return [
    clip(s, v),
    clip(
      s,
      v.map((x) => -x),
    ),
  ];
}

interface Painted {
  s: Surf;
  color: string;
}

/**
 * Paints the part of every piece where `f` >= 0 (a list: where all of them are, cut one after the other, so each edge
 * is as exact as a single cut and a band narrower than a triangle is not lost).
 */
function tint(pieces: Painted[], f: At | At[], color: string): Painted[] {
  const fs = Array.isArray(f) ? f : [f];
  const out: Painted[] = [];
  for (const p of pieces) {
    let inside = p.s;
    for (const fk of fs) {
      const [a, rest] = cut(inside, fk);
      if (rest.idx.length) out.push({ s: rest, color: p.color });
      inside = a;
      if (!inside.idx.length) break;
    }
    if (inside.idx.length) out.push({ s: inside, color });
  }
  return out;
}

/** Distance round the shell from the front centre (m, signed), for outlines drawn on it. */
const round = (x: number, z: number): number => Math.atan2(x, z) * WRAP;

/** Distance outside the visor's outline (negative inside it). */
const shieldField: At = (x, y, z) => {
  const u = Math.abs(round(x, z));
  return Math.max(
    roundBox(u, y - SHIELD.y, SHIELD.w, SHIELD.h, SHIELD.r),
    SHIELD.y - SHIELD.h + 0.22 * Math.max(0, u - 0.09) - y,
  );
};

/** A grid surface: `rows` of `cols` points, closed round when `loop`. */
function grid(
  rows: [number, number, number][][],
  loop: boolean,
  flip = false,
): Surf {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos = new Float32Array(nr * nc * 3);
  rows.forEach((r, j) => r.forEach((p, i) => pos.set(p, (j * nc + i) * 3)));
  const idx: number[] = [];
  for (let j = 0; j < nr - 1; j++)
    for (let i = 0; i < (loop ? nc : nc - 1); i++) {
      const a = j * nc + i;
      const b = j * nc + ((i + 1) % nc);
      const c = a + nc;
      const d = b + nc;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  const s: Surf = { n: nr * nc, a: { pos, nor: new Float32Array(0) }, idx };
  s.a.nor = normals(s);
  return s;
}

function geometry(pieces: Painted[]): BufferGeometry {
  const s = join(
    pieces.map((p) => {
      const c = new Color(p.color);
      const color = new Float32Array(p.s.n * 3);
      for (let i = 0; i < p.s.n; i++) color.set([c.r, c.g, c.b], i * 3);
      return {
        n: p.s.n,
        a: { pos: p.s.a.pos, nor: p.s.a.nor, color },
        idx: p.s.idx,
      };
    }),
  );
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(s.a.pos, 3));
  g.setAttribute('normal', new BufferAttribute(s.a.nor, 3));
  g.setAttribute('color', new BufferAttribute(s.a.color, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(s.n * 2), 2));
  g.setIndex(s.idx);
  return g;
}

/**
 * The paint of a shell, as layers over its base colour (a later one covers an earlier one). Layouts after the classic
 * ones of racing helmets - bands round the shell, stripes over the crown, a block of leaning stripes, a two-colour
 * split, a wedge rising from the chin to the back, a crown cap with its pin ring - each carrying the motif of the
 * livery in its colours; `strip` is the sun strip along the top of the visor. Shapes only: no lettering or emblems.
 * Drawn in the unrolled plane (`u` = distance round the shell from the front centre, y = height) and, on the crown, in
 * plan.
 */
function design(
  { main, second, third, motif }: CrewLivery,
  hi: boolean,
): {
  base: string;
  layers: [At[], string][];
  strip: string;
} {
  const layers: [At[], string][] = [];
  const u = (x: number, z: number): number => Math.abs(round(x, z));
  /** A band of a measure of the unrolled plane. */
  const band = (
    m: (u: number, y: number) => number,
    lo: number,
    hi: number,
  ): At[] => [(x, y, z) => m(u(x, z), y) - lo, (x, y, z) => hi - m(u(x, z), y)];
  const paint = (f: At[], color: string): void => {
    layers.push([f, color]);
  };
  /** Pin lines and the thinnest stripes: on the close-up mesh only. */
  const fine = (f: At[], color: string): void => {
    if (hi) layers.push([f, color]);
  };
  /** A crown cap with a pin ring under it. */
  const cap = (color: string, ring: string, y0 = 0.146): void => {
    paint([(_x, y) => y - y0], color);
    fine([(_x, y) => y - (y0 - 0.009), (_x, y) => y0 - 0.004 - y], ring);
  };
  /** A wedge from under the chin rising to the back, a pin line along its edge. */
  const wedge = (color: string, line: string, y0 = -0.088, k = 0.3): void => {
    const w = (uu: number, y: number): number => y0 + k * uu - y;
    paint([(x, y, z) => w(u(x, z), y)], color);
    fine(band(w, -0.016, -0.009), line);
  };

  switch (motif) {
    case 'plain': {
      // Bands round the shell: a broad one above the port between two pin lines, the wedge under it.
      paint(
        band((_u, y) => y, 0.066, 0.1),
        main,
      );
      fine(
        band((_u, y) => y, 0.106, 0.112),
        third,
      );
      wedge(main, third);
      cap(main, third);
      return { base: second, layers, strip: main };
    }
    case 'stripes': {
      // Twin stripes over the crown from brow to nape between pin lines, two straight lines back from the port.
      paint(
        band((_u, y) => y, -0.034, -0.01),
        second,
      );
      fine(
        band((_u, y) => y, -0.046, -0.04),
        third,
      );
      paint([(_x, y) => -0.12 - y], third);
      const twin: [number, number, string][] = [
        [0.009, 0.036, second],
        [0.043, 0.048, third],
      ];
      for (const [lo, hi2, c] of twin)
        (c === third ? fine : paint)(
          [(x) => Math.abs(x) - lo, (x) => hi2 - Math.abs(x)],
          c,
        );
      return { base: main, layers, strip: main };
    }
    case 'slant': {
      // A block of leaning stripes on each side that thin out to the back, under a crown cap.
      const lean = (uu: number, y: number): number => uu + 0.5 * y;
      const stripes: [number, number, string][] = [
        [0.2, 0.262, second],
        [0.277, 0.314, third],
        [0.329, 0.352, second],
        [0.364, 0.376, third],
        [0.388, 0.395, second],
      ];
      stripes.forEach(([lo, hi2, c], k) =>
        (k < 3 ? paint : fine)(band(lean, lo, hi2), c),
      );
      paint([(_x, y) => y - 0.112], main);
      // The chin the other way: a bib that runs out towards the sides.
      const bib = (uu: number, y: number): number => -0.064 - 0.3 * uu - y;
      paint([(x, y, z) => bib(u(x, z), y)], second);
      fine(band(bib, -0.015, -0.008), third);
      cap(second, third, 0.132);
      return { base: main, layers, strip: second };
    }
    case 'split': {
      // Two colours on a leaning line with a band of the third between: the face one, the back the other; a square in
      // a square on the crown.
      const lean = (uu: number, y: number): number => uu + 0.45 * y;
      paint([(x, y, z) => 0.212 - lean(u(x, z), y)], second);
      paint(band(lean, 0.19, 0.212), third);
      fine(band(lean, 0.226, 0.233), third);
      paint([(_x, y) => -0.126 - y], third);
      const square = (w: number, z0: number, z1: number): At[] => [
        (x) => w - Math.abs(x),
        (_x, _y, z) => z - z0,
        (_x, _y, z) => z1 - z,
        (_x, y) => y - 0.1,
      ];
      paint(square(0.052, -0.075, 0.029), third);
      paint(square(0.028, -0.051, 0.005), main);
      return { base: main, layers, strip: second };
    }
    case 'peaks': {
      // A mountain range round the shell: the far one in the third colour, the near one in the second over it.
      const peak = (u0: number, y0: number, k: number): At[] => [
        (x, y, z) => y0 - y - k * (u(x, z) - u0),
        (x, y, z) => y0 - y + k * (u(x, z) - u0),
      ];
      for (const [u0, y0] of [
        [0.28, 0.04],
        [0.39, 0.066],
      ])
        paint(peak(u0, y0, 1.25), third);
      paint([(_x, y) => -0.098 - y], second);
      fine(peak(0.105, -0.066, 0.7), second);
      for (const [u0, y0] of [
        [0.225, -0.028],
        [0.335, 0.004],
        [0.44, -0.02],
      ])
        paint(peak(u0, y0, 1.15), second);
      // A chevron over the crown, pointing ahead.
      const v = (x: number, z: number): number => z + 0.9 * Math.abs(x);
      paint(
        [
          (x, _y, z) => v(x, z) + 0.065,
          (x, _y, z) => -0.03 - v(x, z),
          (_x, y) => y - 0.09,
        ],
        third,
      );
      fine(
        [
          (x, _y, z) => v(x, z) + 0.02,
          (x, _y, z) => -0.008 - v(x, z),
          (_x, y) => y - 0.09,
        ],
        second,
      );
      return { base: main, layers, strip: second };
    }
    case 'swoosh': {
      // A swoosh of three crescents on each side, from the chin up to the back.
      const arcs = (deep: number, flat: number): At[] => {
        const p = [0.02, -0.122];
        const q = [0.44, 0.07];
        const c = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const n = [(q[1] - p[1]) / c, -(q[0] - p[0]) / c];
        const arc = (sag: number): number[] => {
          const r = (c * c) / (8 * sag) + sag / 2;
          return [mid[0] + n[0] * (sag - r), mid[1] + n[1] * (sag - r), r];
        };
        const a = arc(deep);
        const b = arc(flat);
        return [
          (x, y, z) => a[2] - Math.hypot(u(x, z) - a[0], y - a[1]),
          (x, y, z) => Math.hypot(u(x, z) - b[0], y - b[1]) - b[2],
        ];
      };
      paint(arcs(0.05, 0.012), second);
      fine(arcs(0.066, 0.058), third);
      fine(arcs(0.082, 0.076), second);
      cap(second, third);
      return { base: main, layers, strip: second };
    }
    case 'checker': {
      // A band of checkers round the shell above the port, between pin lines; the wedge under it.
      const n = 15;
      const du = (Math.PI * WRAP) / n;
      const rows = [0.058, 0.084, 0.11];
      for (let r = 0; r < 2; r++)
        for (let k = 0; k < n; k++)
          if ((k + r) % 2 === 0)
            // The row first: only that is then cut along the cell's edges.
            paint(
              [
                (_x, y) => y - rows[r],
                (_x, y) => rows[r + 1] - y,
                ...band((uu) => uu, k * du, (k + 1) * du),
              ],
              second,
            );
      fine(
        band((_u, y) => y, 0.048, 0.054),
        third,
      );
      fine(
        band((_u, y) => y, 0.114, 0.12),
        third,
      );
      wedge(second, third);
      cap(second, third);
      return { base: main, layers, strip: second };
    }
  }
}

/** The helmet round a head (its centre at the origin). `hi` = the close-up mesh. */
export function helmet(paint: CrewLivery, hi: boolean): HelmetParts {
  const around = hi ? 64 : 32;
  const domeRows = hi ? 11 : 6;
  const waistRows = hi ? 14 : 7;
  const rows: [number, number, number][][] = [];
  const ring = (y: number): [number, number, number][] =>
    Array.from({ length: around }, (_, i) =>
      // Start at the back, so the seam of the grid is not in the face.
      shellAt(Math.PI + (i / around) * Math.PI * 2, y),
    );
  for (let j = 0; j < domeRows; j++) {
    const th = ((j + 0.35) / (domeRows - 0.65 + 0.35)) * (Math.PI / 2);
    rows.push(ring(DOME_Y + DOME_H * Math.cos(Math.min(th, Math.PI / 2))));
  }
  for (let j = 1; j <= waistRows; j++)
    rows.push(ring(DOME_Y + ((BOTTOM - DOME_Y) * j) / waistRows));
  let shell = grid(rows, true);
  // The crown: a fan over the first ring.
  {
    const n = shell.n;
    const pos = new Float32Array((n + 1) * 3);
    pos.set(shell.a.pos);
    pos.set([0, HELMET_TOP, 0], n * 3);
    const idx = shell.idx.slice();
    for (let i = 0; i < around; i++) idx.push(n, i, (i + 1) % around);
    shell = { n: n + 1, a: { pos, nor: new Float32Array(0) }, idx };
    shell.a.nor = normals(shell);
  }
  // A wall at the bottom edge (a shell has a thickness); under the visor there is nothing to draw.
  shell = seal(shell, 0.03);
  shell = clip(
    shell,
    fieldOf(shell, (x, y, z) => shieldField(x, y, z) + 0.005),
  );

  const look = design(paint, hi);
  let gloss: Painted[] = [{ s: shell, color: look.base }];
  const matt: Painted[] = [];
  const take = (f: At, color: string, to: Painted[]): void => {
    const rest: Painted[] = [];
    for (const p of gloss) {
      const [inside, out] = cut(p.s, f);
      if (out.idx.length) rest.push({ s: out, color: p.color });
      if (inside.idx.length) to.push({ s: inside, color });
    }
    gloss = rest;
  };
  // The rubber the visor closes on, the rolled edge at the bottom.
  take((x, y, z) => 0.005 - shieldField(x, y, z), RUBBER, matt);
  take((_x, y) => BOTTOM + 0.011 - y, RUBBER, matt);

  for (const [f, color] of look.layers) gloss = tint(gloss, f, color);
  // Vents: two slots in the chin bar, two on the brow.
  gloss = tint(
    gloss,
    (x, y, z) =>
      z > 0
        ? -roundBox(
            Math.abs(round(x, z)) - 0.034,
            y + 0.097,
            0.017,
            0.0055,
            0.005,
          )
        : -1,
    RUBBER,
  );
  gloss = tint(
    gloss,
    (x, y, z) =>
      z > 0
        ? -roundBox(Math.abs(x) - 0.052, y - 0.098, 0.013, 0.006, 0.005)
        : -1,
    RUBBER,
  );

  // The visor: a shield a little proud of the shell, with an edge, its sun strip along the top.
  {
    const span = (SHIELD.w + 0.012) / WRAP;
    const cols = hi ? 28 : 14;
    const lines = hi ? 6 : 3;
    const y0 = SHIELD.y + SHIELD.h + 0.008;
    const y1 = SHIELD.y - SHIELD.h - 0.008;
    let shield = grid(
      Array.from({ length: lines + 1 }, (_r, j) =>
        Array.from({ length: cols + 1 }, (_c, i) =>
          shellAt(
            span - (2 * span * i) / cols,
            y0 + ((y1 - y0) * j) / lines,
            0.004,
          ),
        ),
      ),
      false,
      true,
    );
    shield = clip(
      shield,
      fieldOf(shield, (x, y, z) => -shieldField(x, y, z)),
    );
    // Its edge rolls in to the rubber it closes on.
    const [flat, edge] = cut(
      shield,
      (x, y, z) => -shieldField(x, y, z) - 0.005,
    );
    const pos = new Float32Array(edge.a.pos);
    for (let i = 0; i < edge.n; i++) {
      const f = shieldField(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const d = 0.0055 * Math.min(1, Math.max(0, 1 + f / 0.005));
      for (let q = 0; q < 3; q++) pos[i * 3 + q] -= edge.a.nor[i * 3 + q] * d;
    }
    const rolled: Surf = { n: edge.n, a: { ...edge.a, pos }, idx: edge.idx };
    let glass: Painted[] = [
      { s: flat, color: VISOR },
      { s: rolled, color: VISOR },
    ];
    glass = tint(
      glass,
      (_x, y) => y - (SHIELD.y + SHIELD.h - 0.019),
      look.strip,
    );
    gloss.push(...glass);
  }

  // Tether posts of the head restraint: a small boss either side at the back.
  for (const sd of [1, -1]) {
    const [px, py, pz] = HELMET_POST;
    const at = shellAt(Math.atan2(px * sd, pz), py);
    const l = Math.hypot(at[0], at[2]);
    const n: [number, number, number] = [at[0] / l, 0, at[2] / l];
    const t: [number, number, number] = [-n[2], 0, n[0]];
    const disc = (r: number, out: number) =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return [
          at[0] + n[0] * out + t[0] * Math.cos(a) * r,
          at[1] + Math.sin(a) * r,
          at[2] + n[2] * out + t[2] * Math.cos(a) * r,
        ] as [number, number, number];
      });
    gloss.push({
      s: grid(
        [disc(0.012, 0), disc(0.011, 0.006), disc(0.0005, 0.0065)],
        true,
        sd < 0,
      ),
      color: '#b9bcc2',
    });
  }

  // The visor's hinges: a round cover at each temple.
  for (const sd of [1, -1]) {
    const at = shellAt((sd * SHIELD.hinge) / WRAP, SHIELD.y, 0.004);
    const l = Math.hypot(at[0], at[2]);
    const n: [number, number, number] = [at[0] / l, 0, at[2] / l];
    const t: [number, number, number] = [-n[2], 0, n[0]];
    const sides = hi ? 12 : 8;
    const disc = (r: number, out: number) =>
      Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        return [
          at[0] + n[0] * out + t[0] * Math.cos(a) * r,
          at[1] + Math.sin(a) * r,
          at[2] + n[2] * out + t[2] * Math.cos(a) * r,
        ] as [number, number, number];
      });
    gloss.push({
      s: grid(
        [disc(0.019, -0.002), disc(0.017, 0.004), disc(0.0005, 0.0045)],
        true,
        sd < 0,
      ),
      color: '#17191d',
    });
  }

  return { shell: geometry(gloss), trim: geometry(matt) };
}
