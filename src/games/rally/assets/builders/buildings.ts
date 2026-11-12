import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import { HOUSE_WALL_FRACTION } from '../catalog';
import {
  FIX,
  HOUSE_LAYER,
  houseSlot,
  SLOT,
  SLOT_COLUMNS,
} from '../../engine/house-walls';
import type { AssetBuilder, BuiltAsset } from '../types';

/**
 * Placeholder buildings for real-world maps. UNIT footprint: x (long side / width) and
 * z (depth) in [-0.5, 0.5], y in [0, 1]. Instances are scaled per axis to the real
 * footprint and height (ScatterInstance sx / sy / sz): the walls and the roof shape stretch with it,
 * everything of a fixed real size (windows, door, eaves, chimney, plinth, roof edge) is given in metres
 * and placed by the house shader (`fix` attribute, engine/house-walls.ts) - windows repeat along the wall.
 *
 * Variants: v % 4 = style, v >= 4 = two floors of windows (else one).
 * Buildings get detailed one by one later ("stage 1 - building N - lat, lon").
 */

/** Wall top of the sloped-roof house as a fraction of its total height (roof = the rest). */
const HOUSE_WALL = HOUSE_WALL_FRACTION;

type V3 = [number, number, number];
/** A vertex: unit position, then (optional) its `fix` - metres x, y, z and the code. */
type Pt = number[];

/** Texture-array layer of every vertex (-1 = detail map x vertex colour; see engine/house-walls.ts). */
function setLayer(g: BufferGeometry, layer: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute(
    'layer',
    new BufferAttribute(new Float32Array(n).fill(layer), 1),
  );
  return g;
}

/** `fix` of every vertex (default: none). */
function setFix(
  g: BufferGeometry,
  at?: (i: number) => [number, number, number, number],
): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 4);
  if (at) for (let i = 0; i < n; i++) a.set(at(i), i * 4);
  g.setAttribute('fix', new BufferAttribute(a, 4));
  return g;
}

/** Unit-space box (stretches with the building). */
const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  rng?: Rng,
  layer = -1,
) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const out = planarUV(paint(g, color, rng, rng ? 0.03 : 0), 0.3);
  // Tops and bottoms on x / z: the wall mapping has a constant v there, which smeared one line of the detail noise
  // into diagonal streaks across big flat roofs.
  const p = out.getAttribute('position');
  const n = out.getAttribute('normal');
  const uv = out.getAttribute('uv');
  for (let i = 0; i < p.count; i++)
    if (Math.abs(n.getY(i)) > 0.5)
      uv.setXY(i, p.getX(i) * 0.3, p.getZ(i) * 0.3);
  return setFix(setLayer(out, layer));
};

/** Faces of a BoxGeometry in its vertex order. */
const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;
type Face = keyof typeof FACE;

/**
 * A box in METRES (w x h x d, centre `off`) at the unit point `anchor`; `only` / `skip` pick its faces (the one against
 * the wall is never seen). `code` = what the shader does with the anchor (`FIX.plain`, a window / door slot).
 */
function mbox(
  anchor: V3,
  size: V3,
  off: V3,
  color: string,
  o: { code?: number; layer?: number; skip?: Face[]; only?: Face[] } = {},
): BufferGeometry {
  let g: BufferGeometry = new BoxGeometry(...size)
    .translate(...off)
    .toNonIndexed();
  const keep = (Object.keys(FACE) as Face[]).filter(
    (f) => (o.only ? o.only.includes(f) : true) && !o.skip?.includes(f),
  );
  if (keep.length < 6) {
    const cut = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const src = g.getAttribute(name);
      const n = src.itemSize;
      const a = new Float32Array(keep.length * 6 * n);
      keep.forEach((f, k) =>
        a.set(
          (src.array as Float32Array).subarray(
            FACE[f] * 6 * n,
            (FACE[f] + 1) * 6 * n,
          ),
          k * 6 * n,
        ),
      );
      cut.setAttribute(name, new BufferAttribute(a, n));
    }
    g.dispose();
    g = cut;
  }
  planarUV(paint(g, color), 0.3);
  const p = g.getAttribute('position');
  const code = o.code ?? FIX.plain;
  setFix(g, (i) => [p.getX(i), p.getY(i), p.getZ(i), code]);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...anchor);
  return setLayer(g, o.layer ?? -1);
}

/**
 * A slab over the whole footprint at unit height `y`: `out` metres past the walls, from `lo` to `hi` metres about `y`.
 */
function slab(
  y: number,
  lo: number,
  hi: number,
  out: number,
  color: string,
  layer = -1,
): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1).toNonIndexed();
  planarUV(paint(g, color), 0.3);
  const p = g.getAttribute('position');
  setFix(g, (i) => [
    Math.sign(p.getX(i)) * out,
    p.getY(i) > 0 ? hi : lo,
    Math.sign(p.getZ(i)) * out,
    FIX.plain,
  ]);
  for (let i = 0; i < p.count; i++) p.setY(i, y);
  return setLayer(g, layer);
}

/**
 * Triangles (flat shaded) from a flat list of vertices. `normal`: for faces whose shape is only in the metres of their
 * `fix` (their unit positions coincide, no normal to compute).
 */
function tris(
  points: Pt[],
  color: string,
  layer = -1,
  normal?: number[],
): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array(points.flatMap((p) => p.slice(0, 3))),
      3,
    ),
  );
  if (normal)
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(points.flatMap(() => normal)), 3),
    );
  else g.computeVertexNormals();
  setFix(g, (i) => [
    points[i][3] ?? 0,
    points[i][4] ?? 0,
    points[i][5] ?? 0,
    points[i][6] ?? 0,
  ]);
  return setLayer(planarUV(paint(g, color), 0.3), layer);
}

/**
 * A flat quad a-b-c-d facing along the axis `normal`, wound to match (the metres of the `fix` stand in for the shape
 * where the unit positions coincide).
 */
function quad(
  a: Pt,
  b: Pt,
  c: Pt,
  d: Pt,
  normal: number[],
  color: string,
): BufferGeometry {
  const m = (p: Pt): number[] => [
    p[0] + (p[3] ?? 0) * 0.05,
    p[1] + (p[4] ?? 0) * 0.05,
    p[2] + (p[5] ?? 0) * 0.05,
  ];
  const [p0, p1, p2] = [m(a), m(b), m(c)];
  const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const dot = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2];
  return tris(
    dot >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c],
    color,
    -1,
    normal,
  );
}

const GLASS = '#2c3238';
/** Window (m): the glass, the frame round it, how far the frame stands out of the wall. */
const WIN_W = 1.0;
const WIN_H = 1.3;
const FRAME = 0.07;
const PROUD = 0.035;
/** Ground level on the wall of a building standing on flat ground (m above its base: world/buildings.ts sinks it). */
const GROUND = 0.15;

/** One window at a wall anchor; `out` = the wall's outward axis and sign. */
function windowAt(
  parts: BufferGeometry[],
  anchor: V3,
  axis: 'x' | 'z',
  sign: number,
  code: number,
  frame: string,
  sillColor: string,
): void {
  const face: Face =
    axis === 'z' ? (sign > 0 ? 'pz' : 'nz') : sign > 0 ? 'px' : 'nx';
  const back: Face =
    axis === 'z' ? (sign > 0 ? 'nz' : 'pz') : sign > 0 ? 'nx' : 'px';
  // (along the wall, up, out of the wall) -> x, y, z.
  const v = (a: number, y: number, o: number): V3 =>
    axis === 'z' ? [a, y, o * sign] : [o * sign, y, a];
  const piece = (
    size: [number, number, number],
    off: [number, number, number],
    color: string,
    only?: Face[],
  ) =>
    parts.push(
      mbox(anchor, v(...size).map(Math.abs) as V3, v(...off), color, {
        code,
        only,
        skip: only ? undefined : [back],
      }),
    );
  piece([WIN_W + 2 * FRAME, WIN_H + 2 * FRAME, PROUD * 2], [0, 0, 0], frame);
  piece([WIN_W, WIN_H, 0.02], [0, 0, PROUD + 0.004], GLASS, [face]);
  // Mullion and transom: a two-leaf window with a top light.
  piece([0.05, WIN_H, 0.03], [0, 0, PROUD + 0.01], frame);
  piece([WIN_W, 0.045, 0.03], [0, WIN_H * 0.24, PROUD + 0.01], frame);
  // Sill.
  piece(
    [WIN_W + 2 * FRAME + 0.12, 0.05, 0.16],
    [0, -WIN_H / 2 - FRAME - 0.025, 0.07],
    sillColor,
  );
}

/**
 * Windows on the four walls (fixed size, repeated along the wall by the shader) and the front door with its step,
 * `rows` floors of them up to the wall top (unit height `wallTop`).
 */
function openings(
  parts: BufferGeometry[],
  rows: number,
  wallTop: number,
  frame: string,
  door: string,
): void {
  const sill = '#b9b6ae';
  for (let r = 0; r < rows; r++) {
    const y = (wallTop / rows) * (r + 0.56);
    for (let col = 0; col < SLOT_COLUMNS.long; col++) {
      windowAt(
        parts,
        [0, y, 0.5],
        'z',
        1,
        houseSlot(r === 0 ? SLOT.frontGround : SLOT.alongX, col),
        frame,
        sill,
      );
      windowAt(
        parts,
        [0, y, -0.5],
        'z',
        -1,
        houseSlot(SLOT.alongX, col),
        frame,
        sill,
      );
    }
    for (let col = 0; col < SLOT_COLUMNS.short; col++)
      for (const s of [1, -1])
        windowAt(
          parts,
          [0.5 * s, y, 0],
          'x',
          s,
          houseSlot(SLOT.alongZ, col),
          frame,
          sill,
        );
  }
  // Front door: frame, leaf with a light in its top, a concrete step.
  const code = houseSlot(SLOT.door);
  const at: V3 = [0, 0, 0.5];
  const DW = 0.95;
  const DH = 2.05;
  const y0 = GROUND + 0.18;
  const opt = { code, skip: ['nz'] as Face[] };
  parts.push(
    mbox(
      at,
      [DW + 0.16, DH + 0.08, 0.07],
      [0, y0 + (DH + 0.08) / 2, 0],
      frame,
      opt,
    ),
    mbox(at, [DW, DH, 0.03], [0, y0 + DH / 2, 0.035], door, opt),
    mbox(at, [DW - 0.3, 0.42, 0.01], [0, y0 + DH - 0.42, 0.052], GLASS, {
      code,
      only: ['pz'],
    }),
    mbox(
      at,
      [0.035, 0.12, 0.05],
      [DW / 2 - 0.1, y0 + 1.0, 0.06],
      '#c9c6bd',
      opt,
    ),
    mbox(at, [1.5, y0, 0.55], [0, y0 / 2, 0.275], sill, opt),
  );
}

// Styles: 0-2 render in three paints, 3 unfinished red clay brick, 4 / 5 lime-plastered rubble stone (hip / gable).
const WALLS = [
  '#f0ece2',
  '#e6d6a6',
  '#e0b49a',
  '#f4f0ea',
  '#f4f0ea',
  '#f4f0ea',
];
const WALL_LAYER = [
  HOUSE_LAYER.render,
  HOUSE_LAYER.render,
  HOUSE_LAYER.render,
  HOUSE_LAYER.clay,
  HOUSE_LAYER.rubble,
  HOUSE_LAYER.rubble,
];
// Multiplied onto the roof-tile scan: near white keeps the terracotta, the rest weathers it.
const ROOFS = ['#ffffff', '#f1e3da', '#e2cfc2', '#f7ebe3'];

/** Roof (m): overhang at the eaves, at a gable end, slab thickness, gutter. */
const EAVE = 0.5;
const VERGE = 0.3;
const ROOF_T = 0.09;

/** House with a sloped red-tile roof: hip (even styles) or gable (odd styles). Variants 0-3 one floor, 4-7 two. */
export const housePitched: AssetBuilder = ({ seed, variant, lod }) =>
  houseBuilder(seed, variant % 4, variant >= 4 ? 2 : 1, lod);

/** Lime-plastered rubble stone house (hip, gable), its own asset so the render houses' variant set stays small. */
export const houseStone: AssetBuilder = ({ seed, variant, lod }) =>
  houseBuilder(seed, 4 + (variant % 2), variant >= 2 ? 2 : 1, lod);

function houseBuilder(
  seed: number,
  style: number,
  rows: number,
  lod: number,
): BuiltAsset {
  const rng = new Rng(seed);
  const wall = WALLS[style];
  const roof = rng.pick(ROOFS);
  const W = HOUSE_WALL;
  const parts: BufferGeometry[] = [];
  parts.push(box(1, W, 1, 0, W / 2, 0, wall, rng, WALL_LAYER[style]));
  if (lod === 0) {
    parts.push(slab(0, 0, GROUND + 0.4, 0.03, '#8e8a82'));
    // Unfinished brick houses: grey concrete slabs at the floor lines.
    if (style === 3)
      for (let r = 1; r <= rows; r++)
        parts.push(slab((W / rows) * r, -0.24, 0, 0.025, '#b9b6ae'));
    openings(parts, rows, W, style === 3 ? '#9a9890' : '#f2f0ea', '#5b3b28');
  }
  // Roof: a slab with a top, an underside and edges (tile thickness `ROOF_T`), so it holds up from below and from the
  // side. The eaves stand `EAVE` metres out and drop with the pitch; a hip's ends slope like its sides (the shader
  // places the ridge ends, `FIX.hipEnd`).
  const hip = style % 2 === 0;
  /** Eave corner on a side plane (`end`: on a hip's end plane). */
  const corner = (sx: number, sz: number, end = false): Pt => [
    0.5 * sx,
    W,
    0.5 * sz,
    (hip ? EAVE : VERGE) * sx,
    0,
    EAVE * sz,
    end ? FIX.hipEndEave : FIX.eave,
  ];
  const ridge = (sx: number, end = false): Pt =>
    hip
      ? [0.25 * sx, 1, 0, 0, 0, 0, end ? FIX.hipEndRidge : FIX.hipRidge]
      : [0.5 * sx, 1, 0, VERGE * sx, 0, 0, FIX.eave];
  // Roof planes (polygons) and the outer edges of the slab (the ridge and the hip lines are shared, no edge there).
  const planes: Pt[][] = [
    [corner(-1, 1), corner(1, 1), ridge(1), ridge(-1)],
    [corner(1, -1), corner(-1, -1), ridge(-1), ridge(1)],
  ];
  const outline: Pt[][] = [
    [corner(-1, 1), corner(1, 1)],
    [corner(1, -1), corner(-1, -1)],
  ];
  if (hip) {
    planes.push(
      [corner(1, 1, true), corner(1, -1, true), ridge(1, true)],
      [corner(-1, -1, true), corner(-1, 1, true), ridge(-1, true)],
    );
    outline.push(
      [corner(1, 1), corner(1, -1)],
      [corner(-1, -1), corner(-1, 1)],
    );
  } else {
    // Gable: triangular gable walls at the ends; the roof overhangs them.
    outline.push(
      [corner(1, 1), ridge(1)],
      [ridge(1), corner(1, -1)],
      [corner(-1, -1), ridge(-1)],
      [ridge(-1), corner(-1, 1)],
    );
    parts.push(
      tris(
        [
          [0.5, W, 0.5],
          [0.5, W, -0.5],
          [0.5, 1, 0, 0, -0.02],
          [-0.5, W, -0.5],
          [-0.5, W, 0.5],
          [-0.5, 1, 0, 0, -0.02],
        ],
        wall,
        WALL_LAYER[style],
      ),
    );
  }
  const down = (p: Pt): Pt => [
    p[0],
    p[1],
    p[2],
    p[3],
    p[4] - ROOF_T,
    p[5],
    p[6],
  ];
  const fan = (poly: Pt[], facing: number[]): Pt[] => {
    // Triangle fan of a convex polygon, wound so its normal points along `facing`.
    const out: Pt[] = [];
    for (let k = 1; k < poly.length - 1; k++)
      out.push(poly[0], poly[k], poly[k + 1]);
    const [p0, p1, p2] = out;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const dot = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2];
    if (dot >= 0) return out;
    // Reverse every triangle.
    const rev: Pt[] = [];
    for (let k = 0; k < out.length; k += 3)
      rev.push(out[k], out[k + 2], out[k + 1]);
    return rev;
  };
  const top: Pt[] = [];
  const under: Pt[] = [];
  for (const poly of planes) {
    top.push(...fan(poly, [0, 1, 0]));
    under.push(...fan(poly.map(down), [0, -1, 0]));
  }
  /** The way an edge of the roof faces: out along z for an edge that runs along x, else out along x. */
  const outward = (p: Pt, q: Pt): number[] =>
    p[2] === q[2] && p[5] === q[5]
      ? [0, 0, Math.sign(p[2])]
      : [Math.sign(p[0]), 0, 0];
  const rg = tris(top, roof, HOUSE_LAYER.roof);
  shade(rg, (_x, y) => 0.85 + 0.15 * ((y - W) / (1 - W)));
  parts.push(rg);
  // Chimney: up through the back slope to above the ridge, rendered like the walls (brick on a brick house).
  const cx = rng.chance(0.5) ? 0.2 : -0.2;
  const cz = -0.12;
  const stack = new BoxGeometry(0.5, 1, 0.5).toNonIndexed();
  planarUV(paint(stack, style === 3 ? wall : '#e4dfd4'), 0.3);
  {
    const p = stack.getAttribute('position');
    setFix(stack, (i) => [
      p.getX(i),
      p.getY(i) > 0 ? 0.55 : 0,
      p.getZ(i),
      FIX.plain,
    ]);
    for (let i = 0; i < p.count; i++)
      p.setXYZ(i, cx, p.getY(i) > 0 ? 1 : W, cz);
  }
  parts.push(
    setLayer(stack, style === 3 ? HOUSE_LAYER.clay : HOUSE_LAYER.render),
  );
  // Underside (rafters, in shadow), the thin edge of the tiles, gutters and the chimney cap: only near, the far
  // houses stay as light as before.
  if (lod === 0) {
    parts.push(tris(under, '#8a7666'));
    for (const [p, q] of outline)
      parts.push(quad(p, q, down(q), down(p), outward(p, q), '#8c6650'));
    parts.push(
      mbox([cx, 1, cz], [0.68, 0.07, 0.68], [0, 0.585, 0], '#a9a59c'),
      mbox([cx, 1, cz], [0.3, 0.1, 0.3], [0, 0.67, 0], '#3a3633', {
        skip: ['ny'],
      }),
    );
    // Gutter under the eaves (every side of a hip roof): its outer face, bottom and rim.
    const GUTTER = '#6a625c';
    const gutter = (a: Pt, b: Pt): void => {
      const n = outward(a, b);
      const at = (p: Pt, k: number, y: number): Pt => [
        p[0],
        p[1],
        p[2],
        p[3] + n[0] * k,
        p[4] - ROOF_T + y,
        p[5] + n[2] * k,
        FIX.eave,
      ];
      const W_G = 0.11;
      parts.push(
        quad(
          at(a, W_G, 0.02),
          at(b, W_G, 0.02),
          at(b, W_G, -0.09),
          at(a, W_G, -0.09),
          n,
          GUTTER,
        ),
        quad(
          at(a, -0.02, -0.09),
          at(b, -0.02, -0.09),
          at(b, W_G, -0.09),
          at(a, W_G, -0.09),
          [0, -1, 0],
          GUTTER,
        ),
        quad(
          at(a, 0, 0.02),
          at(b, 0, 0.02),
          at(b, W_G, 0.02),
          at(a, W_G, 0.02),
          [0, 1, 0],
          '#3f3a36',
        ),
      );
    };
    gutter(corner(-1, 1), corner(1, 1));
    gutter(corner(1, -1), corner(-1, -1));
    if (hip) {
      gutter(corner(1, 1), corner(1, -1));
      gutter(corner(-1, -1), corner(-1, 1));
    }
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('house') }],
  };
}

/**
 * Flat-roofed building. Styles: 0/1 industrial hall (no windows, band, roller door),
 * 2 unfinished brick block, 3 rendered block (shop / flat-roof house).
 */
export const buildingFlat: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const style = variant % 4;
  const rows = variant >= 4 ? 2 : 1;
  const parts: BufferGeometry[] = [];
  const body = ['#f0f2f2', '#d6dadb', '#f4f0ea', '#f0e9da'][style];
  const layer = [
    HOUSE_LAYER.sheet,
    HOUSE_LAYER.sheet,
    HOUSE_LAYER.clay,
    HOUSE_LAYER.render,
  ][style];
  parts.push(box(1, 1, 1, 0, 0.5, 0, body, rng, layer));
  const cap = style < 2 ? '#7d8287' : style === 2 ? '#8f8c86' : '#a7a29a';
  if (style < 2) {
    // Hall: a sheet-metal fascia round the roof edge, the membrane inside it.
    parts.push(slab(1, -0.45, 0.2, 0.05, cap));
    parts.push(slab(1, 0, 0.05, -0.12, '#6d6f70'));
  } else {
    // Block: the concrete roof slab stands out over the walls, a kerb round its edge.
    parts.push(slab(1, -0.22, 0, 0.4, cap));
    parts.push(slab(1, 0, 0.12, 0.4, cap));
    parts.push(slab(1, 0, 0.14, 0.22, '#6d6f70'));
  }
  if (lod === 0) {
    parts.push(slab(0, 0, GROUND + 0.35, 0.03, '#8a8780'));
    if (style < 2) {
      const accent = style === 0 ? '#5d7591' : '#8a4a3a';
      parts.push(box(1.006, 0.08, 1.006, 0, 0.8, 0, accent));
      // Roller door and a personnel door, real size.
      const skip: Face[] = ['nz'];
      parts.push(
        mbox(
          [0.22, 0, 0.5],
          [3.4, 3.3, 0.08],
          [0, GROUND + 1.65, 0],
          '#8d9296',
          { skip },
        ),
        mbox(
          [0.22, 0, 0.5],
          [3.1, 3.1, 0.03],
          [0, GROUND + 1.55, 0.045],
          '#a4a9ad',
          { skip },
        ),
        mbox(
          [-0.3, 0, 0.5],
          [1.05, 2.15, 0.07],
          [0, GROUND + 1.075, 0],
          '#4b5157',
          { skip },
        ),
      );
      for (let k = 1; k < 9; k++)
        parts.push(
          mbox(
            [0.22, 0, 0.5],
            [3.1, 0.03, 0.02],
            [0, GROUND + k * 0.34, 0.065],
            '#8d9296',
            { skip },
          ),
        );
    } else {
      if (style === 2)
        for (let r = 1; r < rows; r++)
          parts.push(slab((1 / rows) * r, -0.24, 0, 0.025, '#b9b6ae'));
      openings(parts, rows, 1, style === 2 ? '#9a9890' : '#f2f0ea', '#4a3a30');
    }
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('house') }],
  };
};
