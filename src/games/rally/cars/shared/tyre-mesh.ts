import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Vector2,
} from 'three';
import { TYRES, type TyreId } from '../../physics/tyres';
import type { TyreSize } from '../../physics/types';

/**
 * Tyre geometry for every car (wheel space: axis X, outer face towards +X, radius in the YZ plane).
 *
 * The carcass is a lathe: bead -> sidewall (height from the tyre size: a 15" tyre is tall and soft looking, an 18"
 * low profile one is a thin band) -> shoulder -> a tread of `TREAD_COLUMNS` columns across. The tread has real
 * relief: grid vertices (segment x column) sink into grooves, so the pattern shows in the silhouette and in the
 * flat-shaded lighting. Pattern per compound (physics/tyres.ts ids):
 *   - tarmac: near-slick, two circumferential grooves + sipes on the shoulders, ~3 mm deep (hard: blockier shoulder, 3.5 mm)
 *   - mixed : centre rib + staggered blocks, ~6 mm
 *   - gravel: big chunky staggered blocks with wide gaps and notched shoulders, ~11 mm (hard: smaller, tighter blocks, 9 mm)
 *   - null  : plain carcass (tool pages without a tyre)
 * The compound shows as a coloured ring on the outer sidewall (the colour of the menu dot); no text.
 * `dust` greys the sidewall and the grooves (old road cars). Vertex colours + flat normals; ~5.2k triangles per tyre (4 per car).
 */
export const TREAD_SEGMENTS = 96;
const TREAD_COLUMNS = 8;
/** Half width of the tread (fraction of the half section width). */
const TREAD_HALF = 0.66;
const RIM_INCH = 0.0254 / 2; // rim diameter inch -> radius (m)

/** Groove depth (m) at grid cell (i = segment, j = column) per compound; 0 = on the tread surface. */
const PATTERNS: Record<
  TyreId,
  { depth: number; groove: (i: number, j: number) => boolean }
> = {
  tarmac: {
    depth: 0.003,
    // columns 2 and 5 are circumferential grooves; shoulder sipes every 4th segment.
    groove: (i, j) =>
      j === 2 || j === 5 || ((j === 0 || j === 7) && i % 4 === 0),
  },
  tarmac_hard: {
    depth: 0.0035,
    // the same two circumferential grooves, shoulder sipes every 6th segment (a stiffer, blockier shoulder).
    groove: (i, j) =>
      j === 2 || j === 5 || ((j === 0 || j === 7) && i % 6 === 0),
  },
  mixed: {
    depth: 0.006,
    // solid centre rib (columns 3, 4); staggered blocks of 3 with 1-segment gaps either side; coarser shoulders.
    groove: (i, j) => {
      if (j === 3 || j === 4) return false;
      if (j === 0 || j === 7) return (i + (j === 0 ? 0 : 3)) % 6 < 2;
      return (i + (j < 3 ? 0 : 2)) % 4 === 0;
    },
  },
  gravel_hard: {
    depth: 0.009,
    // smaller, tighter blocks (4 of 6 segments), a centre groove: hard-pack tread.
    groove: (i, j) => {
      if (j === 0 || j === 7) return (i + (j === 0 ? 0 : 3)) % 6 < 2;
      const stagger = j < 4 ? 0 : 3;
      return (i + stagger) % 6 >= 4 || j === 3;
    },
  },
  gravel: {
    depth: 0.011,
    // big blocks (5 of 8 segments) staggered between the halves, a centre groove, notched shoulders.
    groove: (i, j) => {
      if (j === 0 || j === 7) return (i + (j === 0 ? 0 : 4)) % 8 < 3;
      const stagger = j < 4 ? 0 : 4;
      return (i + stagger) % 8 >= 5 || j === 3;
    },
  },
};

export interface TyreOptions {
  /** Overall radius (m) - the physics wheel radius; the sidewall fills the gap above the rim. */
  radius: number;
  size: TyreSize;
  compound: TyreId | null;
  /** Road dust on sidewalls and in grooves (old road cars). */
  dust?: boolean;
}

/** Rim bead radius (m) of a size. */
export const rimRadius = (s: TyreSize): number => s.rim * RIM_INCH;

export function buildTyre(o: TyreOptions): BufferGeometry {
  const R = o.radius;
  const hw = o.size.width / 2;
  const bead = rimRadius(o.size);
  const sw = R - bead;
  const pattern = o.compound ? PATTERNS[o.compound] : null;

  // Outer half profile (radius, axial fraction of hw), bead -> shoulder. `stripe` marks the compound ring rows.
  const outer: { r: number; a: number; stripe?: boolean }[] = [
    { r: bead, a: 0.74 },
    { r: bead + sw * 0.1, a: 0.88 },
    { r: bead + sw * 0.31, a: 0.99 },
    { r: bead + sw * 0.36, a: 1, stripe: true },
    { r: bead + sw * 0.42, a: 1, stripe: true },
    { r: bead + sw * 0.47, a: 0.99 },
    { r: bead + sw * 0.75, a: 0.95 },
    { r: bead + sw * 0.92, a: 0.86 },
    { r: R - 0.012, a: 0.8 },
    { r: R - 0.003, a: 0.72 },
  ];
  // Tread columns across (inner -> outer), all at the full radius.
  const treadA = Array.from(
    { length: TREAD_COLUMNS },
    (_, j) =>
      TREAD_HALF * ((j - (TREAD_COLUMNS - 1) / 2) / ((TREAD_COLUMNS - 1) / 2)),
  );
  type P = { r: number; a: number; stripe: boolean; col: number };
  const prof: P[] = [
    ...outer.map((p): P => ({ r: p.r, a: -p.a * hw, stripe: false, col: -1 })),
    ...treadA.map((a, j): P => ({ r: R, a: a * hw, stripe: false, col: j })),
    ...[...outer]
      .reverse()
      .map((p): P => ({ r: p.r, a: p.a * hw, stripe: !!p.stripe, col: -1 })),
  ];

  const lathe = new LatheGeometry(
    prof.map((p) => new Vector2(p.r, p.a)),
    TREAD_SEGMENTS,
  );
  const pos = lathe.getAttribute('position');
  const count = pos.count;
  const P = prof.length;
  const col = new Float32Array(count * 3);
  const stripeColor = o.compound ? new Color(TYRES[o.compound].color) : null;
  for (let v = 0; v < count; v++) {
    const i = Math.floor(v / P) % TREAD_SEGMENTS;
    const k = v % P;
    const p = prof[k];
    let groove = 0;
    if (pattern && p.col >= 0 && pattern.groove(i, p.col))
      groove = pattern.depth;
    if (groove) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const r = Math.hypot(x, z);
      pos.setXYZ(
        v,
        (x * (r - groove)) / r,
        pos.getY(v),
        (z * (r - groove)) / r,
      );
    }
    // Rubber (linear), optionally greyed by dust on the sidewalls and in the grooves.
    const phi = (i / TREAD_SEGMENTS) * Math.PI * 2;
    const n =
      0.5 + 0.3 * Math.sin(phi * 3 + k * 1.7) + 0.2 * Math.sin(phi * 7 - k);
    const dust = o.dust
      ? (p.col < 0 ? 0.55 + 0.45 * n : 0.25 * n) + (groove ? 0.5 : 0)
      : 0;
    let r = 0.014 + 0.028 * dust;
    let g = 0.014 + 0.024 * dust;
    let b = 0.015 + 0.019 * dust;
    if (p.stripe && stripeColor) {
      r = stripeColor.r;
      g = stripeColor.g;
      b = stripeColor.b;
    }
    col[v * 3] = r;
    col[v * 3 + 1] = g;
    col[v * 3 + 2] = b;
  }
  lathe.setAttribute('color', new BufferAttribute(col, 3));
  // Flat shading: the tread blocks need hard edges (the sidewall has 96 facets - not visible).
  const flat = lathe.toNonIndexed();
  lathe.dispose();
  flat.computeVertexNormals();
  // Lathe axis Y -> wheel axis X, positive profile axial = outer face = +X.
  flat.rotateZ(-Math.PI / 2);
  return flat;
}

/** Deepest tread relief (m) of a compound, for tests and the parts bench. */
export const treadDepth = (c: TyreId): number => PATTERNS[c].depth;
