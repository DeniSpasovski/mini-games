import { bodyMesh, RIGS, type BodyModel } from './people-body';
import { cellUV } from './people-parts';
import {
  boundary,
  clip,
  clipAll,
  field,
  join,
  normals,
  offset,
  relax,
  seal,
  solid,
  surfOf,
  vnoise,
  type Surf,
} from './people-surf';

/**
 * Tailoring: clothes are cut from the body mesh itself. A garment is the part of the body surface inside a few
 * scalar fields (hem, neckline, sleeve end ...), pushed out along the normals by its fit, smoothed so it drapes instead
 * of printing the muscles, creased with a little noise, closed at its open edges with a thin wall and unwrapped round the
 * limbs onto a fabric cell of the people atlas. It carries the body's skin weights, so it follows every pose, and the
 * body under it is dropped where it is covered. Patterns (stripes, trims, pads) are the garment cut again along more
 * fields: every piece has its own colour and its edges are exact.
 */

/** A surface of the body with the measures the cuts need: absolute height (m above the soles), distance along the arm. */
export interface View {
  s: Surf;
  Y: Float32Array;
  along: Float32Array;
}

export interface Tailor {
  m: BodyModel;
  lod: number;
  /** The body as modelled (with its skin uv: seams duplicate vertices) and welded without uv (what cloth is cut from). */
  body: View;
  cloth: View;
  /** Arm length shoulder - wrist, torso depth centre and half width / depth of the chest. */
  reach: number;
  torsoZ: number;
  torsoA: number;
  torsoB: number;
}

/** The surface with vertices at the same place merged (the body's uv seams split them: no smoothing across a seam). */
function welded(s: Surf): Surf {
  const key = new Map<string, number>();
  const map = new Int32Array(s.n);
  const rep: number[] = [];
  const q = 1e4;
  for (let i = 0; i < s.n; i++) {
    const k = `${Math.round(s.a.pos[i * 3] * q)},${Math.round(s.a.pos[i * 3 + 1] * q)},${Math.round(s.a.pos[i * 3 + 2] * q)}`;
    let j = key.get(k);
    if (j === undefined) {
      j = rep.length;
      key.set(k, j);
      rep.push(i);
    }
    map[i] = j;
  }
  const a: Record<string, Float32Array> = {};
  for (const name of Object.keys(s.a)) {
    if (name === 'uv') continue;
    const st = s.a[name].length / s.n;
    const out = new Float32Array(rep.length * st);
    for (let j = 0; j < rep.length; j++)
      for (let c = 0; c < st; c++) out[j * st + c] = s.a[name][rep[j] * st + c];
    a[name] = out;
  }
  const w: Surf = { n: rep.length, a, idx: s.idx.map((i) => map[i]) };
  // Smooth normals of the merged mesh (the modelled ones are split along the uv seams).
  w.a.nor = normals(w);
  return w;
}

const tailors = new Map<string, Tailor>();

export function tailor(m: BodyModel, lod: number): Tailor {
  const key = `${m}${lod}`;
  let t = tailors.get(key);
  if (t) return t;
  const mesh = bodyMesh(m, lod);
  const rig = RIGS[m];
  const base = surfOf(mesh);
  const Y = new Float32Array(mesh.n);
  const along = new Float32Array(mesh.n);
  const weldS = welded(base);
  const up = Math.hypot(
    rig.elbow[0] - rig.shoulder[0],
    rig.elbow[1] - rig.shoulder[1],
    rig.elbow[2] - rig.shoulder[2],
  );
  const fore = Math.hypot(
    rig.wrist[0] - rig.elbow[0],
    rig.wrist[1] - rig.elbow[1],
    rig.wrist[2] - rig.elbow[2],
  );
  const reach = up + fore;
  let z0 = 1e9;
  let z1 = -1e9;
  let x1 = 0;
  for (let i = 0; i < mesh.n; i++) {
    Y[i] = mesh.pos[i * 3 + 1] + rig.hip;
    along[i] = mesh.armT[i] * reach;
    if (mesh.arm[i] < 0.05 && Y[i] > rig.hip + 0.15 && Y[i] < rig.chest) {
      z0 = Math.min(z0, mesh.pos[i * 3 + 2]);
      z1 = Math.max(z1, mesh.pos[i * 3 + 2]);
      x1 = Math.max(x1, Math.abs(mesh.pos[i * 3]));
    }
  }
  const view = (s: Surf): View => ({
    s,
    Y: field(s, (i) => s.a.pos[i * 3 + 1] + rig.hip),
    along: field(s, (i) => s.a.armT[i] * reach),
  });
  t = {
    m,
    lod,
    body: { s: base, Y, along },
    cloth: view(weldS),
    reach,
    torsoZ: (z0 + z1) / 2,
    torsoA: x1,
    torsoB: (z1 - z0) / 2,
  };
  tailors.set(key, t);
  return t;
}

/** A part of a garment with its colour and atlas cell(s): one per region (torso, arms, legs) when it is a list. */
export interface Piece {
  s: Surf;
  color: string;
  cell: number | number[];
  /** Trims and pads: later patterns leave them alone. */
  fixed?: boolean;
}

/** A garment cut from the body: its pieces (rest frame, unwrapped) and where it covers the body. */
export interface Cloth {
  pieces: Piece[];
  /** Per base vertex: >= 0 inside the garment, in metres from its edge (the least of its cuts). */
  cover: Float32Array;
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cells for [torso, arm, leg]. */
export const cells = (torso: number, arm: number, leg = torso): number[] => [
  torso,
  arm,
  arm,
  leg,
  leg,
];

/** The piece as a surface with its atlas uv and colour columns. */
export function painted(p: Piece): Surf {
  const { s } = p;
  const uv = new Float32Array(s.n * 2);
  for (let i = 0; i < s.n; i++) {
    const cell = Array.isArray(p.cell)
      ? p.cell[Math.round(s.a.reg[i])]
      : p.cell;
    const [u, v] = cellUV(cell, s.a.fu[i], s.a.fv[i]);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  return { ...s, a: { ...s.a, uv, color: solid(s.n, p.color) } };
}

// --- fields ------------------------------------------------------------------------------------

/** Height above the soles of a vertex of a cut surface. */
const heightOf = (t: Tailor, s: Surf, i: number): number =>
  s.a.pos[i * 3 + 1] + RIGS[t.m].hip;

/** Neck openings. */
export type Neck = 'crew' | 'v' | 'scoop' | 'high';

/** Height of the neck rim at (x, z): the garment stays below it. */
function rim(
  t: Tailor,
  style: Neck,
  drop: number,
): (x: number, z: number) => number {
  const rig = RIGS[t.m];
  const base = rig.neck[0] - 0.05;
  const zc = rig.neck[1];
  const w = style === 'v' ? 0.09 : style === 'scoop' ? 0.1 : 0.08;
  const dip = style === 'v' ? 0.15 : style === 'scoop' ? 0.09 : 0.035;
  const up = style === 'high' ? 0.075 : 0.032;
  return (x, z) => {
    if (style === 'high') return base + up;
    const dx = Math.abs(x) / w;
    const shape =
      style === 'v' ? Math.max(0, 1 - dx) : Math.sqrt(Math.max(0, 1 - dx * dx));
    const front = smooth(zc - 0.005, zc + 0.045, z);
    return base + up - (dip + drop) * shape * front;
  };
}

/** Where the neck opens: positive = the garment stays. */
function neckField(t: Tailor, v: View, style: Neck, drop = 0): Float32Array {
  const r = rim(t, style, drop);
  const pos = v.s.a.pos;
  return field(v.s, (i) => r(pos[i * 3], pos[i * 3 + 2]) - v.Y[i]);
}

/** Sleeve cut: keep an arm as far as `len` metres from the shoulder joint; the torso is untouched. */
function sleeveField(v: View, len: number): Float32Array {
  return field(v.s, (i) => {
    const w = smooth(0.35, 0.65, v.s.a.arm[i]);
    return 1 + (len - v.along[i] - 1) * w;
  });
}

/** Sleeveless: the arm and the shoulder cap are cut away along an armhole round the shoulder joint. */
function armholeField(
  v: View,
  cx: number,
  cy: number,
  r: number,
): Float32Array {
  const pos = v.s.a.pos;
  return field(v.s, (i) => {
    if (v.s.a.arm[i] > 0.5) return -0.05;
    return Math.hypot(Math.abs(pos[i * 3]) - cx, v.Y[i] - cy) - r;
  });
}

// --- the shell -----------------------------------------------------------------------------------

/** How a cut surface is turned into cloth. */
interface Shell {
  /** Stand-off from the body (m) at vertex i of the cut surface. */
  fit: (s: Surf, i: number) => number;
  /** Smoothing passes: 0 = a second skin, 6+ = loose cloth. */
  soft?: number;
  /** Crease amplitude (m). */
  fold?: number;
  seed?: number;
  /** Depth of the wall that closes the open edges (m). */
  wall?: number;
}

/** Offsets, smooths and creases a cut of the body into cloth (normals follow). */
function shell(s: Surf, o: Shell): Surf {
  // Cloth hangs: where the body faces downwards (the underside of the hips, the chest) it stands off sideways, not down.
  let c = offset(s, (i) => o.fit(s, i), 0.2);
  if (o.soft) c = relax(c, o.soft, 0.5);
  c = { ...c, a: { ...c.a, nor: normals(c) } };
  if (o.fold) {
    const { pinned } = boundary(c);
    const nor = c.a.nor;
    const pos = new Float32Array(c.a.pos);
    const seed = (o.seed ?? 0) * 13.7;
    for (let i = 0; i < c.n; i++) {
      if (pinned[i]) continue;
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      // Creases run across a limb, most at the elbows and the knees.
      const knee = c.a.leg[i] * Math.exp(-(((c.a.legT[i] - 0.55) / 0.16) ** 2));
      const elbow =
        c.a.arm[i] * Math.exp(-(((c.a.armT[i] - 0.55) / 0.16) ** 2));
      const d =
        o.fold *
        (vnoise(x * 15 + seed, y * 36, z * 15) +
          0.45 * vnoise(x * 34, y * 80 + seed, z * 34)) *
        (0.35 + 0.65 * Math.max(knee, elbow));
      pos[i * 3] += nor[i * 3] * d;
      pos[i * 3 + 1] += nor[i * 3 + 1] * d;
      pos[i * 3 + 2] += nor[i * 3 + 2] * d;
    }
    c = { ...c, a: { ...c.a, pos } };
    c = { ...c, a: { ...c.a, nor: normals(c) } };
  }
  return seal(c, o.wall ?? 0.02);
}

/** Region of a vertex for the unwrap: 0 torso, 1 / 2 left / right arm, 3 / 4 left / right leg. */
type Region = (s: Surf, i: number) => number;

/** Torso, arms and legs. The torso reaches down to the crotch when legs are covered too. */
const bodyRegion: Region = (s, i) => {
  const x = s.a.pos[i * 3];
  if (s.a.arm[i] > 0.5) return x >= 0 ? 1 : 2;
  if (s.a.leg[i] > 0.5) return x >= 0 ? 3 : 4;
  return 0;
};
/** Below the waist one cylinder per leg, from the waist to the hem: the seam between them is the centre seam. */
const legRegion: Region = (s, i) => (s.a.pos[i * 3] >= 0 ? 3 : 4);

/** Metres of fabric one cell shows along a region (a weave keeps its scale whatever the garment's length). */
const SPAN = [0.8, 0.62, 0.62, 1.0, 1.0];

/**
 * Unwraps a surface: `fu` = round the part's axis (0 at its reference side, 1 opposite, mirrored left / right so nothing
 * tears), `fv` = distance along it from a fixed start (the neck, the shoulder, the waist) in cell lengths, `reg` = the
 * region; a seam between regions keeps both sides.
 */
function unwrap(t: Tailor, s: Surf, region: Region): Surf {
  const rig = RIGS[t.m];
  const hip = rig.hip;
  const rv = new Int8Array(s.n);
  for (let i = 0; i < s.n; i++) rv[i] = region(s, i);
  const key = new Map<number, number>();
  const src: number[] = [];
  const reg: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < s.idx.length; k += 3) {
    const v = [s.idx[k], s.idx[k + 1], s.idx[k + 2]];
    const r = [rv[v[0]], rv[v[1]], rv[v[2]]];
    const pick =
      r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : r[0];
    for (const i of v) {
      const kk = i * 8 + pick;
      let j = key.get(kk);
      if (j === undefined) {
        j = src.length;
        key.set(kk, j);
        src.push(i);
        reg.push(pick);
      }
      idx.push(j);
    }
  }
  const n = src.length;
  const a: Record<string, Float32Array> = {};
  for (const name of Object.keys(s.a)) {
    const st = s.a[name].length / s.n;
    const out = new Float32Array(n * st);
    for (let j = 0; j < n; j++)
      for (let q = 0; q < st; q++) out[j * st + q] = s.a[name][src[j] * st + q];
    a[name] = out;
  }
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  const sh = rig.shoulder;
  const wr = rig.wrist;
  const ax: [number, number, number] = [
    wr[0] - sh[0],
    wr[1] - sh[1],
    wr[2] - sh[2],
  ];
  const al = Math.hypot(...ax);
  const au: [number, number, number] = [ax[0] / al, ax[1] / al, ax[2] / al];
  // Outer side = reference: the horizontal outward direction made square to the arm axis.
  let rx = 1 - au[0] * au[0];
  let ry = -au[0] * au[1];
  let rz = -au[0] * au[2];
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const bx = au[1] * rz - au[2] * ry;
  const by = au[2] * rx - au[0] * rz;
  const bz = au[0] * ry - au[1] * rx;
  for (let j = 0; j < n; j++) {
    const x = a.pos[j * 3];
    const y = a.pos[j * 3 + 1] + hip;
    const z = a.pos[j * 3 + 2];
    const r = reg[j];
    let u: number;
    let v: number;
    if (r === 0) {
      // The torso's parametric angle: even steps round an oval chest.
      u =
        Math.atan2(Math.abs(x) / t.torsoA, (z - t.torsoZ) / t.torsoB) / Math.PI;
      v = rig.neck[0] - y;
    } else if (r <= 2) {
      const px = Math.abs(x) - sh[0];
      const py = y - sh[1];
      const pz = z - sh[2];
      const d = px * au[0] + py * au[1] + pz * au[2];
      const dx = px - au[0] * d;
      const dy = py - au[1] * d;
      const dz = pz - au[2] * d;
      u =
        Math.abs(
          Math.atan2(dx * bx + dy * by + dz * bz, dx * rx + dy * ry + dz * rz),
        ) / Math.PI;
      v = d;
    } else {
      const hj = rig.hipJ;
      const ak = rig.ankleJ;
      const k = (hj[1] - y) / (hj[1] - ak[1]);
      const cx = hj[0] + (ak[0] - hj[0]) * k;
      const cz = hj[2] + (ak[2] - hj[2]) * k;
      // Front (0) through the sides (0.5, inseam and outseam) to the back (1).
      u = Math.atan2(Math.abs(Math.abs(x) - cx), z - cz) / Math.PI;
      v = rig.waist - y;
    }
    fu[j] = Math.min(1, Math.max(0, u));
    fv[j] = Math.min(1, Math.max(0, v / SPAN[r]));
  }
  a.fu = fu;
  a.fv = fv;
  a.reg = Float32Array.from(reg);
  return { n, a, idx };
}

/** Cuts `fields` out of the body, makes cloth of it and unwraps it. */
function make(
  t: Tailor,
  fieldsOf: (v: View) => Float32Array[],
  sh: Shell,
  region: Region,
): { s: Surf; cover: Float32Array } {
  const body = fieldsOf(t.body);
  const cover = field(t.body.s, (i) => Math.min(...body.map((f) => f[i])));
  const s = unwrap(t, shell(clipAll(t.cloth.s, fieldsOf(t.cloth)), sh), region);
  return { s, cover };
}

export type Field = (s: Surf, i: number) => number;

/** Where a cut lives: the arms, the legs, the torso, or everything but the arms. Each is a set of fields (all >= 0 inside). */
export type Where = 'torso' | 'arm' | 'leg' | 'body';

/** Weights run 0..1 along an edge, so these fields are linear and the cut across a seam is a straight line. */
const mask: Record<Where, Field[]> = {
  torso: [
    (s, i) => 0.1 * (0.5 - s.a.arm[i]),
    (s, i) => 0.1 * (0.5 - s.a.leg[i]),
  ],
  arm: [(s, i) => 0.1 * (s.a.arm[i] - 0.5)],
  leg: [(s, i) => 0.1 * (s.a.leg[i] - 0.5)],
  body: [(s, i) => 0.1 * (0.5 - s.a.arm[i])],
};

/**
 * Distance along the arm (m, shoulder joint to wrist = `reach`) of a point of a garment, measured on its own position
 * along the shoulder - wrist line: a cut at one distance is a straight ring, however the cloth drifted from the body.
 */
export const alongOf = (t: Tailor): Field => {
  const rig = RIGS[t.m];
  const [sx, sy, sz] = rig.shoulder;
  const L = Math.hypot(rig.wrist[0] - sx, rig.wrist[1] - sy, rig.wrist[2] - sz);
  const k = t.reach / L / L;
  const d = [rig.wrist[0] - sx, rig.wrist[1] - sy, rig.wrist[2] - sz];
  return (s, i) =>
    ((Math.abs(s.a.pos[i * 3]) - sx) * d[0] +
      (s.a.pos[i * 3 + 1] + rig.hip - sy) * d[1] +
      (s.a.pos[i * 3 + 2] - sz) * d[2]) *
    k;
};

/** The two edges of a band along a measure: >= 0 inside, both linear (a band is cut with two straight cuts). */
export const between = (m: Field, lo: number, hi: number): Field[] => [
  (s, i) => m(s, i) - lo,
  (s, i) => hi - m(s, i),
];

/** Fields per region, for `splitIn`. */
export type Cut = Partial<Record<Where, Field[]>>;

// --- patterns -----------------------------------------------------------------------------------

export interface SplitOpts {
  color?: string;
  cell?: number | number[];
  /** Raise the part (m): it swells inside its edge, so a pad or a cuff stands off the cloth. */
  raise?: number;
  /** Width of the slope of the raise (m). */
  slope?: number;
  /** The new piece is a trim: patterns cut after this one leave it alone. */
  fixed?: boolean;
}

/**
 * Cuts every piece along `f` (>= 0 inside, metres; an array = the inside of all of them): the inside becomes a piece of
 * its own with the given colour / cell, raised where asked, the rest stays. The edge is exact only where a field is
 * linear over a triangle, so a band is two linear fields (`between`), not one |distance|: a narrow band would otherwise
 * fall between the vertices of a coarse triangle.
 */
export function split(
  pieces: Piece[],
  f: Field | Field[],
  o: SplitOpts,
): Piece[] {
  const fs = Array.isArray(f) ? f : [f];
  const out: Piece[] = [];
  for (const p of pieces) {
    if (p.fixed) {
      out.push(p);
      continue;
    }
    let inside: Surf = p.s;
    const rests: Surf[] = [];
    for (const fk of fs) {
      // A vertex left on an earlier cut by rounding is on this one too (else every cut slivers the same triangles).
      const fv = field(inside, (i) => {
        const x = fk(inside, i);
        return Math.abs(x) < 1e-6 ? 0 : x;
      });
      const cut = withField(inside, 'f', fv);
      const rest = clip(
        cut,
        fv.map((x) => -x),
      );
      if (rest.idx.length) rests.push(rest);
      inside = clip(cut, fv);
      if (!inside.idx.length) break;
    }
    if (inside.idx.length) {
      // Distance to the nearest edge: what the raise slopes with.
      const edge = field(inside, (i) =>
        Math.min(...fs.map((fk) => fk(inside, i))),
      );
      inside = withField(inside, 'f', edge);
      if (o.raise) {
        const pos = new Float32Array(inside.a.pos);
        const sl = o.slope ?? 0.012;
        for (let i = 0; i < inside.n; i++) {
          const d = o.raise * smooth(0, sl, inside.a.f[i]);
          pos[i * 3] += inside.a.nor[i * 3] * d;
          pos[i * 3 + 1] += inside.a.nor[i * 3 + 1] * d;
          pos[i * 3 + 2] += inside.a.nor[i * 3 + 2] * d;
        }
        inside = { ...inside, a: { ...inside.a, pos } };
      }
      out.push({
        s: dropField(inside),
        color: o.color ?? p.color,
        cell: o.cell ?? p.cell,
        fixed: o.fixed ?? false,
      });
    }
    if (rests.length)
      out.push({
        ...p,
        s: dropField(rests.length === 1 ? rests[0] : join(rests)),
      });
  }
  return out;
}

/** `split` once per region of `cut`, each with the fields of that region added to the masks of the region. */
export function splitIn(pieces: Piece[], cut: Cut, o: SplitOpts): Piece[] {
  let out = pieces;
  for (const w of Object.keys(cut) as Where[])
    out = split(out, [...mask[w], ...cut[w]!], o);
  return out;
}

const withField = (s: Surf, name: string, v: Float32Array): Surf => ({
  ...s,
  a: { ...s.a, [name]: v },
});

function dropField(s: Surf): Surf {
  const a = { ...s.a };
  delete a.f;
  return { ...s, a };
}

/** Height of a vertex (m above the soles) of a piece, for the fields of patterns. */
export const heightIn =
  (t: Tailor) =>
  (s: Surf, i: number): number =>
    heightOf(t, s, i);

// --- garments -----------------------------------------------------------------------------------

export interface TopOpts {
  color: string;
  /** Sleeve length from the shoulder joint (m): 0 = none (the arm is cut away along an armhole), >= reach = long. */
  sleeve: number;
  neck: Neck;
  neckDrop?: number;
  /** Hem height (m above the soles). */
  hem: number;
  /** Stand-off at the chest and extra towards the hem (m). */
  fit: number;
  ease?: number;
  /** Extra stand-off of the sleeves (m). */
  loose?: number;
  soft?: number;
  fold?: number;
  seed?: number;
  cell: number;
  sleeveCell: number;
  /** Armhole (sleeveless): centre x, height and radius (m). */
  armhole?: [number, number, number];
  /** Trim colour and widths of the collar, cuffs and hem band (m); 0 = none. */
  trim?: string;
  collar?: number;
  cuff?: number;
  hemBand?: number;
  /** A suit: the garment goes on down both legs to this hem (m above the soles). */
  suit?: { hem: number; cell: number; flare: number };
}

/** A top: torso and sleeves, open at the neck, hem round the hips. */
export function top(t: Tailor, o: TopOpts): Cloth {
  const rig = RIGS[t.m];
  const len = Math.min(o.sleeve, t.reach - 0.012);
  const { s, cover } = make(
    t,
    (v) => [
      field(v.s, (i) => v.Y[i] - (o.suit?.hem ?? o.hem)),
      neckField(t, v, o.neck, o.neckDrop ?? 0),
      o.armhole ? armholeField(v, ...o.armhole) : sleeveField(v, len),
    ],
    {
      fit: (c, i) => {
        const y = heightOf(t, c, i);
        const arm = c.a.arm[i];
        const drape = smooth(rig.chest - 0.05, o.hem, y);
        let tor = o.fit + (o.ease ?? 0) * drape;
        if (o.suit) {
          // Legs: stand-off grows towards the hem; the faces turned to the other leg stay close.
          const k = smooth(rig.hipJ[1] - 0.05, o.suit.hem, y);
          const inward = -Math.sign(c.a.pos[i * 3]) * c.a.nor[i * 3];
          const lg = c.a.leg[i];
          tor =
            tor * (1 - lg) +
            (o.fit + o.suit.flare * k) *
              (1 - 0.8 * smooth(0.25, 0.9, inward)) *
              lg;
        }
        const sl = o.fit + (o.loose ?? 0.004) * smooth(0, 0.3, c.a.armT[i]);
        return tor * (1 - arm) + sl * arm;
      },
      soft: o.soft ?? 3,
      fold: o.fold ?? 0.002,
      seed: o.seed,
    },
    bodyRegion,
  );
  let pieces: Piece[] = [
    { s, color: o.color, cell: cells(o.cell, o.sleeveCell, o.suit?.cell) },
  ];
  const trim = o.trim ?? o.color;
  const r = rim(t, o.neck, o.neckDrop ?? 0);
  if (o.collar)
    pieces = splitIn(
      pieces,
      {
        torso: [
          (c, i) =>
            heightOf(t, c, i) -
            (r(c.a.pos[i * 3], c.a.pos[i * 3 + 2]) - o.collar!),
        ],
      },
      { color: trim, cell: 0, raise: 0.003, fixed: true },
    );
  if (o.hemBand)
    pieces = splitIn(
      pieces,
      { body: [(c, i) => o.hem + o.hemBand! - heightOf(t, c, i)] },
      { color: trim, cell: 0, raise: 0.003, fixed: true },
    );
  if (o.cuff && !o.armhole)
    pieces = splitIn(
      pieces,
      { arm: [(c, i) => alongOf(t)(c, i) - (len - o.cuff!)] },
      { color: trim, cell: 0, raise: 0.003, fixed: true },
    );
  return { pieces, cover };
}

export interface GloveOpts {
  color: string;
  cell: number;
  /** Cuff trim colour (m wide) for a work glove; none = a plain glove. */
  trim?: string;
  cuff?: number;
}

/** Gloves: the hands (and a short cuff over the wrist), a second skin a few mm off the body. */
export function gloves(t: Tailor, o: GloveOpts): Cloth {
  const edge = t.reach - 0.03;
  const { s, cover } = make(
    t,
    (v) => [
      field(v.s, (i) => {
        const w = smooth(0.35, 0.65, v.s.a.arm[i]);
        return -1 + (v.along[i] - edge + 1) * w;
      }),
    ],
    { fit: () => 0.004, soft: 1, fold: 0, wall: 0.01 },
    bodyRegion,
  );
  let pieces: Piece[] = [{ s, color: o.color, cell: o.cell }];
  if (o.cuff)
    pieces = splitIn(
      pieces,
      { arm: between(alongOf(t), edge, edge + o.cuff) },
      { color: o.trim ?? o.color, cell: 0, raise: 0.003, fixed: true },
    );
  return { pieces, cover };
}

export interface LegOpts {
  color: string;
  /** Hem height and waistband height (m above the soles). */
  hem: number;
  waist: number;
  /** Stand-off at the thigh, extra towards the hem and extra at the knee (m). */
  fit: number;
  flare: number;
  bag?: number;
  soft?: number;
  fold?: number;
  seed?: number;
  cell: number;
  /** Cuff (elastic, m wide) and waistband colour. */
  cuff?: number;
  trim?: string;
  band?: number;
}

/** Trousers, shorts, leggings: waist to hem, both legs. */
export function legs(t: Tailor, o: LegOpts): Cloth {
  const rig = RIGS[t.m];
  const { s, cover } = make(
    t,
    (v) => [
      field(v.s, (i) => o.waist - v.Y[i]),
      field(v.s, (i) => v.Y[i] - o.hem),
      field(v.s, (i) => 0.5 - v.s.a.arm[i]),
    ],
    {
      fit: (c, i) => {
        const y = heightOf(t, c, i);
        const k = smooth(rig.hipJ[1] - 0.05, o.hem, y);
        const knee = Math.exp(-(((y - rig.kneeJ[1]) / 0.12) ** 2));
        let f = o.fit + o.flare * k + (o.bag ?? 0) * knee;
        // Where a leg faces the other one the cloth stays close: the legs must not cut through each other.
        const x = c.a.pos[i * 3];
        const inward = -Math.sign(x) * c.a.nor[i * 3];
        f *= 1 - 0.8 * smooth(0.25, 0.9, inward);
        return f;
      },
      soft: o.soft ?? 2,
      fold: o.fold ?? 0.002,
      seed: o.seed,
    },
    legRegion,
  );
  let pieces: Piece[] = [{ s, color: o.color, cell: o.cell }];
  const trim = o.trim ?? o.color;
  if (o.band)
    pieces = split(pieces, (c, i) => heightOf(t, c, i) - (o.waist - o.band!), {
      color: trim,
      cell: 0,
      raise: 0.002,
      fixed: true,
    });
  if (o.cuff)
    pieces = split(pieces, (c, i) => o.hem + o.cuff! - heightOf(t, c, i), {
      color: trim,
      cell: 0,
      raise: 0.003,
      fixed: true,
    });
  return { pieces, cover };
}

export interface SkirtOpts {
  color: string;
  /** Waist and hem height (m above the soles). */
  waist: number;
  hem: number;
  /** Stand-off at the hip and how much wider the hem is (m). */
  fit: number;
  flare: number;
  /** Pleats round the skirt (0 = smooth) and their depth at the hem (m). */
  pleats?: number;
  depth?: number;
  cell: number;
  trim?: string;
  band?: number;
  hemBand?: number;
  seed?: number;
}

/**
 * A skirt: a lathe round the pelvis from the waist to the hem, sized by the body's own outline at the waist and the
 * hips, flared below. It rides the pelvis and, towards the hem, the thighs, so it swings with a stride.
 */
export function skirt(t: Tailor, o: SkirtOpts): Cloth {
  const rig = RIGS[t.m];
  const v = t.cloth;
  const pos = v.s.a.pos;
  /** Outline of the torso at a height: centre z and half width / depth. */
  const hull = (y: number): { cz: number; rx: number; rz: number } => {
    let x1 = 0;
    let z0 = 1e9;
    let z1 = -1e9;
    for (let i = 0; i < v.s.n; i++) {
      if (Math.abs(v.Y[i] - y) > 0.025 || v.s.a.arm[i] > 0.4) continue;
      const x = Math.abs(pos[i * 3]);
      if (x > 0.3) continue;
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, pos[i * 3 + 2]);
      z1 = Math.max(z1, pos[i * 3 + 2]);
    }
    return { cz: (z0 + z1) / 2, rx: x1, rz: (z1 - z0) / 2 };
  };
  const hipY = rig.hip + 0.02;
  const hw = hull(o.waist);
  const hh = hull(hipY);
  const J = 48;
  const K = 16;
  const n = (K + 1) * (J + 1);
  const P = new Float32Array(n * 3);
  const W = new Float32Array(n * 13);
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  const side = (x: number): number => smooth(-0.05, 0.05, x);
  const seed = (o.seed ?? 0) * 7.1;
  for (let k = 0; k <= K; k++) {
    const y = o.waist + ((o.hem - o.waist) * k) / K;
    const a = smooth(o.waist, hipY, y);
    const below = smooth(hipY, o.hem, y);
    const cz = hw.cz + (hh.cz - hw.cz) * a;
    const rx = hw.rx + (hh.rx - hw.rx) * a + o.fit + o.flare * below ** 1.15;
    const rz = hw.rz + (hh.rz - hw.rz) * a + o.fit + o.flare * below ** 1.15;
    for (let j = 0; j <= J; j++) {
      const th = (j / J) * Math.PI * 2 - Math.PI;
      let r = 1;
      if (o.pleats) {
        const ph = ((th / (Math.PI * 2)) * o.pleats) % 1;
        const tri = Math.abs(ph - Math.round(ph)) * 2;
        r += ((o.depth ?? 0.01) / rx) * (tri - 0.5) * below;
      }
      // Folds of a soft hem.
      r +=
        0.012 *
        vnoise(Math.cos(th) * 3 + seed, y * 6, Math.sin(th) * 3) *
        below;
      const i = k * (J + 1) + j;
      const x = Math.sin(th) * rx * r;
      const z = cz + Math.cos(th) * rz * r;
      P[i * 3] = x;
      P[i * 3 + 1] = y - rig.hip;
      P[i * 3 + 2] = z;
      const wt = 0.75 * below;
      W[i * 13 + 0] = 1 - wt;
      W[i * 13 + 7] = wt * side(x);
      W[i * 13 + 8] = wt * (1 - side(x));
      fu[i] = Math.abs(th) / Math.PI;
      fv[i] = Math.min(1, (o.waist - y) / SPAN[3]);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < K; k++)
    for (let j = 0; j < J; j++) {
      const a = k * (J + 1) + j;
      const b = a + 1;
      const c = a + J + 1;
      const d = c + 1;
      // Counter-clockwise seen from outside (the angle runs the other way round the y axis).
      idx.push(a, b, c, b, d, c);
    }
  const zero = new Float32Array(n);
  let s: Surf = {
    n,
    a: {
      pos: P,
      nor: new Float32Array(n * 3),
      w: W,
      arm: zero,
      armT: zero,
      leg: zero,
      legT: zero,
      fu,
      fv,
      reg: new Float32Array(n).fill(3),
    },
    idx,
  };
  s.a.nor = normals(s);
  // The lathe's outside faces the way the normals point: flip when the winding turned out inside.
  const probe = idx[0] * 3;
  if (
    s.a.nor[probe] * P[probe] + s.a.nor[probe + 2] * (P[probe + 2] - hw.cz) <
    0
  ) {
    for (let q = 0; q < idx.length; q += 3)
      [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
    s = { ...s, a: { ...s.a, nor: normals(s) } };
  }
  s = seal(s, 0.012);
  let pieces: Piece[] = [{ s, color: o.color, cell: o.cell }];
  const trim = o.trim ?? o.color;
  if (o.band)
    pieces = split(
      pieces,
      (c, i) => o.band! - (o.waist - (c.a.pos[i * 3 + 1] + rig.hip)),
      {
        color: trim,
        cell: 0,
        raise: 0.002,
        fixed: true,
      },
    );
  if (o.hemBand)
    pieces = split(
      pieces,
      (c, i) => o.hem + o.hemBand! - (c.a.pos[i * 3 + 1] + rig.hip),
      { color: trim, cell: 0, raise: 0.002, fixed: true },
    );
  return { pieces, cover: new Float32Array(t.body.s.n).fill(-1) };
}

export { cellUV };
