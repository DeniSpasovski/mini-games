import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  type Material,
  RepeatWrapping,
  ClampToEdgeWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import type { TyreId } from '../../physics/tyres';
import { sidewallMaterial } from './tyre-sidewall';

/**
 * Tread patterns per compound: a height map of one pitch (one repeat of the pattern around the tyre), rasterised from
 * block / groove shapes in millimetres on a nominal 180 mm tread. The tyre mesh (tyre-mesh.ts) is a smooth band; the
 * pattern comes from
 *   - a normal map and a groove-shading map made from the height map (crisp block edges, sipes, slots), and
 *   - a mild displacement of the band (the pattern shows in the silhouette, smoothed to the mesh's resolution).
 * The tyre marks print the same pattern (`treadRubber`).
 *
 * Our own patterns, one per compound, each following what the real rally tyres of that kind have in common:
 *   - tarmac (soft dry): nearly slick - a narrow groove near each shoulder, short angled dashes at the shoulders and one
 *     long swept cut across the middle every pitch.
 *   - tarmac_hard: cut slick for long, abrasive stages - two circumferential grooves, rows of angled slots, more cuts.
 *   - tarmac_wet: directional - three circumferential grooves, V grooves sweeping back from the centre out to the
 *     shoulders, fine sipes between them.
 *   - mixed (damp / broken tarmac, hard-packed gravel): three circumferential grooves, the ribs cut into angled blocks.
 *   - gravel_hard: dense interlocking L-shaped blocks in columns, narrow voids, sipes.
 *   - gravel (soft / loose): open, deep blocks in diagonal rows sweeping from the inner shoulder to the outer one, long
 *     shoulder blocks, wide voids.
 */

/** Nominal tread width the shapes are drawn on (mm); the band stretches it to the tyre's own tread width. */
const BW = 180;
/** Height map pixels across the tread; PAD plain pixels either side (the sidewalls map onto them). */
const TW = 256;
const PAD = 16;

type Pt = [number, number];
/** A shape: polygon in mm (x across from the inner shoulder, y along the pitch, wraps), its height (1 = rubber top). */
interface Shape {
  pts: Pt[];
  h: number;
}
interface TreadDef {
  /** Groove depth (m). */
  depth: number;
  /** Pitch length (mm): the pattern repeats every pitch around the tyre. */
  pitch: number;
  /** Height where no shape is drawn: 0 = grooves (block patterns), 1 = rubber (cut slicks). */
  base: number;
  shapes: Shape[];
}

/** Parallelogram block: x0..x1 across, y0..y1 along, its edges across leaning `slant` mm along per mm across. */
const block = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  slant = 0,
  h = 1,
): Shape => ({
  pts: [
    [x0, y0],
    [x1, y0 + slant * (x1 - x0)],
    [x1, y1 + slant * (x1 - x0)],
    [x0, y1],
  ],
  h,
});
/** A cut (groove, slot, sipe) from a to b, `w` mm wide. */
const cut = (a: Pt, b: Pt, w: number, h = 0): Shape => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2);
  const ny = (dx / l) * (w / 2);
  return {
    pts: [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ],
    h,
  };
};
/** A cut along a polyline (a curved slot). */
const path = (pts: Pt[], w: number, h = 0): Shape[] =>
  pts.slice(1).map((p, i) => cut(pts[i], p, w, h));
/** Circumferential groove x0..x1 (runs through every pitch). */
const ring = (x0: number, x1: number, pitch: number, h = 0): Shape =>
  block(x0, x1, -1, pitch + 1, 0, h);
/** Shift shapes along by dy. */
const along = (dy: number, shapes: Shape[]): Shape[] =>
  shapes.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x, y + dy] as Pt) }));
/** Repeat shapes n times along a pitch. */
const repeat = (pitch: number, n: number, f: (y: number) => Shape[]) =>
  Array.from({ length: n }, (_, k) => f((k * pitch) / n)).flat();

const TARMAC_PITCH = 46;
const tarmac: TreadDef = {
  depth: 0.005,
  pitch: TARMAC_PITCH,
  base: 1,
  shapes: [
    ring(24, 28, TARMAC_PITCH),
    ring(154, 158, TARMAC_PITCH),
    // shoulder dashes: two a pitch inside, one outside
    ...repeat(TARMAC_PITCH, 2, (y) => [cut([4, y + 2], [19, y + 7], 3)]),
    cut([162, 30], [177, 25], 3),
    // one long swept cut across the middle
    ...path(
      [
        [40, 4],
        [62, 9],
        [90, 17],
        [118, 28],
        [138, 36],
      ],
      3.5,
    ),
  ],
};

const TARMAC_HARD_PITCH = 40;
const tarmacHard: TreadDef = {
  depth: 0.0055,
  pitch: TARMAC_HARD_PITCH,
  base: 1,
  shapes: [
    ring(46, 53, TARMAC_HARD_PITCH),
    ring(96, 103, TARMAC_HARD_PITCH),
    ...repeat(TARMAC_HARD_PITCH, 2, (y) => [
      // inner shoulder slots, open to the edge
      cut([-2, y + 2], [36, y + 12], 3.5),
    ]),
    // between the grooves
    cut([58, 8], [91, 18], 3),
    // outer half: a long slot and a shoulder dash
    cut([110, 24], [150, 36], 3.5),
    cut([160, 10], [182, 4], 3.5),
  ],
};

const WET_PITCH = 34;
const wet: TreadDef = {
  depth: 0.008,
  pitch: WET_PITCH,
  base: 1,
  shapes: [
    ring(40, 46, WET_PITCH),
    ring(86, 94, WET_PITCH),
    ring(134, 140, WET_PITCH),
    // V grooves sweeping back from the centre, the two halves staggered half a pitch
    cut([88, 0], [-6, 34], 4.5),
    ...along(WET_PITCH / 2, [cut([92, 0], [186, 34], 4.5)]),
    // fine sipes between them
    cut([82, 17], [6, 44.5], 1, 0.15),
    ...along(WET_PITCH / 2, [cut([98, 17], [174, 44.5], 1, 0.15)]),
  ],
};

const MIXED_PITCH = 48;
const mixed: TreadDef = {
  depth: 0.01,
  pitch: MIXED_PITCH,
  base: 1,
  shapes: [
    ring(38, 45, MIXED_PITCH),
    ring(87, 94, MIXED_PITCH),
    ring(136, 143, MIXED_PITCH),
    ...repeat(MIXED_PITCH, 2, (y) => [
      // shoulders: angled slots open to the edge
      cut([-2, y + 4], [32, y + 14], 4),
      cut([148, y + 18], [182, y + 8], 4),
    ]),
    // middle ribs cut right through into angled blocks, a half slot between
    cut([44, 6], [88, 20], 4.5),
    cut([44, 30], [66, 37], 3),
    cut([93, 30], [137, 16], 4.5),
    cut([115, 47], [137, 40], 3),
  ],
};

const GRAVEL_HARD_PITCH = 44;
/** Six columns of L-shaped blocks, every other column mirrored so the blocks interlock across; ~4 mm voids. */
const gravelHard: TreadDef = {
  depth: 0.012,
  pitch: GRAVEL_HARD_PITCH,
  base: 0,
  shapes: [0, 30, 60, 90, 120, 150].flatMap((x0, i) => {
    const w = i === 5 ? 30 : 26;
    const stem = w * 0.6;
    const flip = i % 2 === 1;
    return repeat(GRAVEL_HARD_PITCH, 2, (y0) => {
      const y = y0 + (flip ? 11 : 0);
      return [
        block(x0, x0 + w, y, y + 9),
        flip
          ? block(x0 + w - stem, x0 + w, y + 9, y + 18)
          : block(x0, x0 + stem, y + 9, y + 18),
        cut([x0 + 3, y + 4.5], [x0 + w - 3, y + 4.5], 1.1, 0.12),
      ];
    });
  }),
};

const GRAVEL_PITCH = 56;
/**
 * Inner shoulder blocks, four middle columns and outer shoulder blocks, each column a quarter pitch further along than
 * the one inside it (so the blocks line up in diagonal rows), middle blocks leaning; ~7 mm voids, a sipe in each.
 */
const gravel: TreadDef = {
  depth: 0.012,
  pitch: GRAVEL_PITCH,
  base: 0,
  shapes: (
    [
      [0, 30, 0.12, 0],
      [36, 58, 0.4, 7],
      [64, 86, 0.4, 14],
      [92, 114, 0.4, 21],
      [120, 142, 0.4, 28],
      [148, 180, -0.12, 35],
    ] as [number, number, number, number][]
  ).flatMap(([x0, x1, slant, off]) =>
    repeat(GRAVEL_PITCH, 2, (y0) => {
      const y = y0 + off;
      const len = x1 - x0 > 25 ? 20 : 18;
      const m = y + len / 2;
      return [
        block(x0, x1, y, y + len, slant),
        cut(
          [x0 + 3, m + slant * 3],
          [x1 - 3, m + slant * (x1 - x0 - 3)],
          1.2,
          0.12,
        ),
      ];
    }),
  ),
};

const TREADS: Record<TyreId, TreadDef> = {
  tarmac,
  tarmac_hard: tarmacHard,
  tarmac_wet: wet,
  mixed,
  gravel_hard: gravelHard,
  gravel,
};

/** A compound's tread, rasterised: `height` is TW + 2 PAD px across by `rows` px along one pitch (0 groove, 1 top). */
export interface Tread {
  depth: number;
  /** Nominal pitch length (m). */
  pitch: number;
  cols: number;
  rows: number;
  height: Float32Array;
}

function inside(pts: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      c = !c;
  }
  return c;
}

const SS = 3; // supersamples per pixel and axis

function rasterise(d: TreadDef): Tread {
  const cols = TW + PAD * 2;
  const rows = Math.round((d.pitch / BW) * TW);
  const height = new Float32Array(cols * rows).fill(1);
  const px = BW / TW;
  const py = d.pitch / rows;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < TW; i++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = (i + (sx + 0.5) / SS) * px;
          const y = (j + (sy + 0.5) / SS) * py;
          let h = d.base;
          for (const s of d.shapes)
            if (
              inside(s.pts, x, y) ||
              inside(s.pts, x, y - d.pitch) ||
              inside(s.pts, x, y + d.pitch)
            )
              h = s.h;
          sum += h;
        }
      height[j * cols + PAD + i] = sum / (SS * SS);
    }
  return { depth: d.depth, pitch: d.pitch / 1000, cols, rows, height };
}

const cache = new Map<TyreId, Tread>();
/** The rasterised tread of a compound (cached). */
export function tread(c: TyreId): Tread {
  let t = cache.get(c);
  if (!t) {
    t = rasterise(TREADS[c]);
    cache.set(c, t);
  }
  return t;
}

/** Texture u of a band position b (-1 inner shoulder .. 1 outer shoulder); u = 0 is plain rubber (the sidewalls). */
export const treadU = (b: number): number =>
  (PAD + ((b + 1) / 2) * TW) / (TW + PAD * 2);

/** Whole pitches around a tyre of radius r (m). */
export const pitchesFor = (c: TyreId, r: number): number =>
  Math.max(8, Math.round((Math.PI * 2 * r) / tread(c).pitch));

/** Box blur (radius rx px across, ry px along; wraps along, clamps across). */
export function blurred(t: Tread, rx: number, ry: number): Float32Array {
  const { cols, rows } = t;
  const tmp = new Float32Array(cols * rows);
  const out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let k = -rx; k <= rx; k++)
        s += t.height[j * cols + Math.min(cols - 1, Math.max(0, i + k))];
      tmp[j * cols + i] = s / (rx * 2 + 1);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let k = -ry; k <= ry; k++)
        s += tmp[((((j + k) % rows) + rows) % rows) * cols + i];
      out[j * cols + i] = s / (ry * 2 + 1);
    }
  return out;
}

/** Bilinear sample of a tread field at band position b and pitch phase (any real; 1 = one pitch). */
export function sampleTread(
  t: Tread,
  field: Float32Array,
  b: number,
  phase: number,
): number {
  const x = treadU(Math.max(-1, Math.min(1, b))) * t.cols - 0.5;
  const y = (phase - Math.floor(phase)) * t.rows - 0.5;
  const x0 = Math.max(0, Math.min(t.cols - 1, Math.floor(x)));
  const x1 = Math.min(t.cols - 1, x0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const y0 = ((Math.floor(y) % t.rows) + t.rows) % t.rows;
  const y1 = (y0 + 1) % t.rows;
  const fy = y - Math.floor(y);
  const a = field[y0 * t.cols + x0] * (1 - fx) + field[y0 * t.cols + x1] * fx;
  const c = field[y1 * t.cols + x0] * (1 - fx) + field[y1 * t.cols + x1] * fx;
  return a * (1 - fy) + c * fy;
}

/** Is the tread rubber (not a groove / slot) at band position b (-1..1) and pitch phase? */
export const treadRubber = (c: TyreId, b: number, phase: number): boolean =>
  sampleTread(tread(c), tread(c).height, b, phase) > 0.5;

/** Deepest tread relief (m) of a compound. */
export const treadDepth = (c: TyreId): number => TREADS[c].depth;

function texture(t: Tread, data: Uint8Array): DataTexture {
  const tex = new DataTexture(
    data,
    t.cols,
    t.rows,
    RGBAFormat,
    UnsignedByteType,
  );
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Normal map strength: the slope of a full-depth wall is scaled down to this share (soft, worn block edges). */
const NORMAL_STRENGTH = 0.35;

/** Groove shading (rgb, multiplies the vertex colour) and normal map of a tread. */
function treadMaps(t: Tread): { map: DataTexture; normal: DataTexture } {
  const { cols, rows } = t;
  const h = blurred(t, 1, 1);
  const albedo = new Uint8Array(cols * rows * 4);
  const normal = new Uint8Array(cols * rows * 4);
  const px = BW / TW / 1000;
  const py = t.pitch / rows;
  const at = (i: number, j: number) =>
    h[(((j % rows) + rows) % rows) * cols + Math.max(0, Math.min(cols - 1, i))];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      const v = at(i, j);
      // Groove floors in shadow (darker the deeper the groove: 5 mm slick cuts ~0.42, 14 mm gravel voids ~0.22),
      // block tops scrubbed a touch lighter, a faint grain.
      const floor = Math.max(0.18, 0.53 - t.depth * 22);
      const grain = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const g =
        floor + (1 - floor) * v + 0.05 * v * (grain - Math.floor(grain) - 0.5);
      albedo[o] =
        albedo[o + 1] =
        albedo[o + 2] =
          Math.round(255 * Math.min(1, g));
      albedo[o + 3] = 255;
      const sx =
        ((at(i + 1, j) - at(i - 1, j)) * t.depth * NORMAL_STRENGTH) / (2 * px);
      const sy =
        ((at(i, j + 1) - at(i, j - 1)) * t.depth * NORMAL_STRENGTH) / (2 * py);
      const l = Math.hypot(sx, sy, 1);
      normal[o] = Math.round(255 * (0.5 - (0.5 * sx) / l));
      normal[o + 1] = Math.round(255 * (0.5 - (0.5 * sy) / l));
      normal[o + 2] = Math.round(255 * (0.5 + 0.5 / l));
      normal[o + 3] = 255;
    }
  const map = texture(t, albedo);
  map.name = 'tyre-tread';
  const nrm = texture(t, normal);
  nrm.name = 'tyre-tread-normal';
  return { map, normal: nrm };
}

/** Linear base colour of tyre rubber: the materials carry it (vertex colours are relative to it), dust tints it. */
export const RUBBER = 0.022;
const rubberColor = () => new Color(RUBBER, RUBBER, RUBBER);
const plainMat = new MeshStandardMaterial({
  color: rubberColor(),
  vertexColors: true,
  roughness: 0.95,
});
const materials = new Map<TyreId, MeshStandardMaterial>();

/** The rubber material of a compound: the tread's groove shading and normal map on the band, plain on the sidewalls. */
function rubberMaterial(c: TyreId): MeshStandardMaterial {
  let m = materials.get(c);
  if (!m) {
    const maps = treadMaps(tread(c));
    m = new MeshStandardMaterial({
      color: rubberColor(),
      vertexColors: true,
      roughness: 0.93,
      map: maps.map,
      normalMap: maps.normal,
    });
    m.name = `tyre-${c}`;
    materials.set(c, m);
  }
  return m;
}

/**
 * The materials of a compound's tyre (shared by every car; vertex colours carry the rubber and road dust): the rubber,
 * then the sidewall lettering (the tyre geometry's second group). Null (plain carcass, no groups): plain rubber.
 */
export function tyreMaterial(c: TyreId | null): Material | Material[] {
  return c ? [rubberMaterial(c), sidewallMaterial(c)] : plainMat;
}

/** A car's own copy of its tyre materials, with road dust on them (`set`; the textures stay shared). */
export interface DustyTyre {
  readonly materials: Material | Material[];
  /** Dust level 0..1 (tyre-dust.ts steps) and its linear colour. */
  set(level: number, color: Color): void;
  dispose(): void;
}

/**
 * Dust on the rubber: the base colour blended towards the dust colour and rougher (the groove shading still darkens
 * the voids), the lettering fading under it. No shader changes: only colours, so no extra programs.
 */
export function dustyTyre(c: TyreId | null): DustyTyre {
  const base = tyreMaterial(c);
  const [rubberBase, letterBase] = Array.isArray(base)
    ? (base as MeshStandardMaterial[])
    : [base as MeshStandardMaterial, null];
  const rubber = rubberBase.clone();
  const letters = letterBase?.clone() ?? null;
  const clean = rubberColor();
  const roughness = rubberBase.roughness;
  const white = new Color(1, 1, 1);
  return {
    materials: letters ? [rubber, letters] : rubber,
    set(level, color) {
      rubber.color.copy(clean).lerp(color, level);
      rubber.roughness = roughness + (1 - roughness) * level;
      letters?.color.copy(white).lerp(color, level * 0.6);
    },
    dispose() {
      rubber.dispose();
      letters?.dispose();
    },
  };
}
