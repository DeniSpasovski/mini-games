import { BufferAttribute, BufferGeometry, Color } from 'three';
import { clip, join, normals, seal, type Surf } from './people-surf';

/**
 * A full-face rally helmet (closed-car type: open eye port without a visor, a long peak over it, the chin bar ahead of
 * the mouth), built round a head. Head frame: the origin is the centre of the head, +Z the face, +Y up, metres. The
 * shell is a loft of plan outlines (a dome over a waisted lower half), the eye port is cut along an exact outline
 * (people-surf.ts `clip`), and the paint is cut the same way, so every edge is sharp at any mesh density.
 */

export interface HelmetPaint {
  /** Shell colour, the band over the crown and the flash on the sides, the pin lines beside them. */
  base: string;
  stripe: string;
  line: string;
}

export interface HelmetParts {
  /** The painted shell and peak: vertex colours, for a glossy material. */
  shell: BufferGeometry;
  /** Rubber edges, the lining in the port and the balaclava: vertex colours, matt. */
  trim: BufferGeometry;
}

/** Top of the shell above the centre of the head (m): the room a helmet needs under a roof. */
export const HELMET_TOP = 0.162;
/** The back of the shell behind the centre of the head, at the height of the neck restraint's collar (m). */
export const HELMET_BACK = 0.146;
/** Where the head restraint's tethers clip on, either side at the back (the left one; mirror x). */
export const HELMET_POST: [number, number, number] = [0.098, -0.07, -0.085];

const RUBBER = '#141518';
const LINING = '#1d1e22';
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
/** Metres per radian round the shell at the height of the port (its outline is drawn in this unrolled plane). */
const WRAP = 0.14;
const PORT = { y: -0.002, w: 0.106, h: 0.047, r: 0.034 };

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
  for (let i = 0; i < s.n; i++)
    out[i] = f(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
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

/** Paints the part of every piece where `f` >= 0. */
function tint(pieces: Painted[], f: At, color: string): Painted[] {
  const out: Painted[] = [];
  for (const p of pieces) {
    const [inside, rest] = cut(p.s, f);
    if (rest.idx.length) out.push({ s: rest, color: p.color });
    if (inside.idx.length) out.push({ s: inside, color });
  }
  return out;
}

/** Distance round the shell from the front centre (m, signed), for outlines drawn on it. */
const round = (x: number, z: number): number => Math.atan2(x, z) * WRAP;

const portField: At = (x, y, z) =>
  roundBox(round(x, z), y - PORT.y, PORT.w, PORT.h, PORT.r);

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
 * The helmet round a head whose eyes are `eyeY` above its centre and whose face reaches `faceZ` ahead of it.
 * `hi` = the close-up mesh.
 */
export function helmet(
  paint: HelmetPaint,
  hi: boolean,
  eyeY = 0.01,
  faceZ = 0.086,
): HelmetParts {
  const around = hi ? 64 : 32;
  const domeRows = hi ? 11 : 6;
  const waistRows = hi ? 14 : 7;
  const rows: [number, number, number][][] = [];
  const ring = (y: number, shrink = 1): [number, number, number][] =>
    Array.from({ length: around }, (_, i) => {
      // Start at the back, so the seam of the grid is not in the port.
      const phi = Math.PI + (i / around) * Math.PI * 2;
      const [x, , z] = shellAt(phi, y);
      return [x * shrink, y, z * shrink];
    });
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
  // The eye port, then walls at its edge and at the bottom edge: a shell has a thickness.
  shell = clip(shell, fieldOf(shell, portField));
  shell = seal(shell, 0.03);

  let gloss: Painted[] = [{ s: shell, color: paint.base }];
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
  // Rubber round the port (and the wall behind it), the rolled edge at the bottom.
  take((x, y, z) => 0.0065 - portField(x, y, z), RUBBER, matt);
  take((_x, y) => BOTTOM + 0.011 - y, RUBBER, matt);

  // Paint: a band over the crown from brow to nape with pin lines, a flash low on each side rising to the back.
  gloss = tint(gloss, (x) => 0.026 - Math.abs(x), paint.stripe);
  gloss = tint(
    gloss,
    (x) => Math.min(Math.abs(x) - 0.033, 0.039 - Math.abs(x)),
    paint.line,
  );
  const flash = (y: number, z: number): number => y - (-0.022 - 0.5 * z);
  gloss = tint(
    gloss,
    (x, y, z) =>
      Math.min(Math.abs(x) - 0.05, 0.02 - Math.abs(flash(y, z)), 0.06 - y),
    paint.stripe,
  );
  gloss = tint(
    gloss,
    (x, y, z) =>
      Math.min(
        Math.abs(x) - 0.05,
        flash(y, z) + 0.035,
        -0.027 - flash(y, z),
        0.06 - y,
      ),
    paint.line,
  );
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

  // The peak: a curved blade from temple to temple over the port, longest in the middle.
  {
    const span = 1.32;
    const seg = hi ? 20 : 10;
    const lip = 0.004;
    const dir: [number, number, number] = [0, -0.16, 0.987];
    const edge = (k: number, len: number, drop: number) =>
      Array.from({ length: seg + 1 }, (_, i) => {
        const phi = -span + (2 * span * i) / seg;
        const c = Math.cos((phi / span) * (Math.PI / 2));
        const [x, y, z] = shellAt(phi, 0.062 + 0.008 * (1 - c), 0.002);
        const l = len * k * Math.pow(Math.max(c, 0), 0.55);
        return [
          x + dir[0] * l,
          y + dir[1] * l - drop + 0.006 * k * c,
          z + dir[2] * l,
        ] as [number, number, number];
      });
    const L = 0.072;
    const top = grid(
      [edge(-0.12, L, 0), edge(0.5, L, 0), edge(1, L, 0)],
      false,
    );
    const under = grid(
      [edge(-0.12, L, lip), edge(0.5, L, lip), edge(1, L, lip)],
      false,
      true,
    );
    const rim = grid([edge(1, L, 0), edge(1, L, lip)], false);
    let peak: Painted[] = [{ s: top, color: paint.base }];
    peak = tint(peak, (x) => 0.026 - Math.abs(x), paint.stripe);
    gloss.push(...peak, { s: rim, color: RUBBER });
    matt.push({ s: under, color: RUBBER });
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

  // Inside the port: the balaclava over the face with its eye opening.
  {
    const r: [number, number, number] = [0.103, 0.132, faceZ + 0.014];
    const lat = hi ? 12 : 6;
    const lon = hi ? 24 : 12;
    const rowsB: [number, number, number][][] = [];
    for (let j = 0; j <= lat; j++) {
      const y = -0.115 + (0.215 * j) / lat;
      const k = Math.sqrt(Math.max(0.05, 1 - (y / r[1]) ** 2));
      rowsB.push(
        Array.from({ length: lon + 1 }, (_, i) => {
          const phi = -1.9 + (3.8 * i) / lon;
          return [
            r[0] * k * Math.sin(phi),
            y,
            r[2] * k * Math.cos(phi) * (Math.cos(phi) < 0 ? 0.9 : 1),
          ] as [number, number, number];
        }),
      );
    }
    let bal = grid(rowsB, false, true);
    bal = clip(
      bal,
      fieldOf(bal, (x, y, z) =>
        z > 0
          ? roundBox(Math.atan2(x, z) * 0.105, y - eyeY, 0.064, 0.021, 0.019)
          : 1,
      ),
    );
    matt.push({ s: bal, color: '#e9e7e0' });
    // The lining between shell and balaclava, seen past the port's edge: a dark band behind the opening.
    const pad = (out: number, zs: number) =>
      Array.from({ length: lon + 1 }, (_, i) => {
        const phi = -1.5 + (3 * i) / lon;
        return [-0.075, 0.075].map((y) => {
          const [x, , z] = shellAt(phi, y, -out);
          return [x, y, z * zs] as [number, number, number];
        });
      });
    const cols = pad(0.028, 0.96);
    let lining = grid(
      [cols.map((c) => c[1]), cols.map((c) => c[0])],
      false,
      true,
    );
    lining = clip(
      lining,
      fieldOf(lining, (x, y, z) =>
        roundBox(
          round(x, z),
          y - PORT.y,
          PORT.w - 0.016,
          PORT.h - 0.012,
          0.024,
        ),
      ),
    );
    matt.push({ s: lining, color: LINING });
  }

  return { shell: geometry(gloss), trim: geometry(matt) };
}
