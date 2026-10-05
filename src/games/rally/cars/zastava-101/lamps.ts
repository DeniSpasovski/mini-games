import { Matrix4, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import {
  Soup,
  lerp,
  roundedPoly,
  vtx,
  type P2,
  type V3,
  type Vtx,
} from '../shared/mesh-kit';

/**
 * 3D lamp / grille building blocks for the Zastava body (body.ts), modelled on the close-up
 * references ref-09..13: everything is built on a local plane (a, b = in-plane metres,
 * d = depth along the plane normal, + = towards the viewer) and lifted into model space.
 */
export interface Plane {
  o: V3;
  a: V3;
  b: V3;
  n: V3;
  /** Atlas UV of a model-space point (painted parts only). */
  uv?: (p: V3) => P2;
}

export const plane = (
  o: V3,
  a: V3,
  b: V3,
  n: V3,
  uv?: (p: V3) => P2,
): Plane => ({
  o,
  a,
  b,
  n,
  uv,
});

const mix = (pl: Plane, a: number, b: number, d: number): V3 => [
  pl.o[0] + pl.a[0] * a + pl.b[0] * b + pl.n[0] * d,
  pl.o[1] + pl.a[1] * a + pl.b[1] * b + pl.n[1] * d,
  pl.o[2] + pl.a[2] * a + pl.b[2] * b + pl.n[2] * d,
];
const dir = (pl: Plane, a: number, b: number, d: number): V3 => [
  pl.a[0] * a + pl.b[0] * b + pl.n[0] * d,
  pl.a[1] * a + pl.b[1] * b + pl.n[1] * d,
  pl.a[2] * a + pl.b[2] * b + pl.n[2] * d,
];
const pv = (pl: Plane, a: number, b: number, d: number): Vtx => {
  const p = mix(pl, a, b, d);
  return vtx(p[0], p[1], p[2], pl.uv?.(p));
};

function area(c: P2[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const [x0, y0] = c[i];
    const [x1, y1] = c[(i + 1) % c.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Rectangle (a0, b0) - (a1, b1) as a contour, corners rounded by r. */
export function rrect(
  ca: number,
  cb: number,
  w: number,
  h: number,
  r: number,
  seg = 4,
): P2[] {
  const pts: P2[] = [
    [ca - w / 2, cb - h / 2],
    [ca + w / 2, cb - h / 2],
    [ca + w / 2, cb + h / 2],
    [ca - w / 2, cb + h / 2],
  ];
  return r > 0 ? roundedPoly(pts, r, seg) : pts;
}

/** Side walls of a closed contour from depth d0 to d1, facing away from its inside (or into it). */
export function walls(
  soup: Soup,
  pl: Plane,
  c: P2[],
  d0: number,
  d1: number,
  inward = false,
): void {
  const k = (area(c) > 0 ? 1 : -1) * (inward ? -1 : 1);
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    const q = c[(i + 1) % c.length];
    const ea = q[0] - p[0];
    const eb = q[1] - p[1];
    soup.quad(
      pv(pl, p[0], p[1], d0),
      pv(pl, q[0], q[1], d0),
      pv(pl, q[0], q[1], d1),
      pv(pl, p[0], p[1], d1),
      dir(pl, eb * k, -ea * k, 0),
    );
  }
}

/** Flat face (with holes) at depth d, facing +n (or -n). */
export function face(
  soup: Soup,
  pl: Plane,
  outer: P2[],
  holes: P2[][],
  d: number,
  back = false,
): void {
  soup.polygon(
    outer,
    holes,
    (a, b) => pv(pl, a, b, d),
    dir(pl, 0, 0, back ? -1 : 1),
  );
}

/** Bezel / surround: outer wall dBack -> dFront, front face, inner wall dFront -> dInnerBack. */
export function frame(
  soup: Soup,
  pl: Plane,
  outer: P2[],
  inner: P2[],
  dBack: number,
  dFront: number,
  dInnerBack: number,
): void {
  walls(soup, pl, outer, dBack, dFront);
  face(soup, pl, outer, [inner], dFront);
  walls(soup, pl, inner, dFront, dInnerBack, true);
}

export interface Ribs {
  /** Ridges run along this in-plane axis. */
  along: 'a' | 'b';
  pitch: number;
  amp: number;
}

/** Box-like slab a0..a1 x b0..b1 between two depths; its face can carry ribs (lens flutes, slats). */
export function slab(
  soup: Soup,
  pl: Plane,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  dBack: number,
  dFront: number,
  ribs?: Ribs,
): void {
  const alongA = ribs?.along !== 'b';
  const [c0, c1] = alongA ? [b0, b1] : [a0, a1];
  const n = ribs ? Math.max(2, Math.round((c1 - c0) / (ribs.pitch / 2))) : 1;
  const ds = Array.from({ length: n + 1 }, (_, i) =>
    ribs && i % 2 ? dFront - ribs.amp : dFront,
  );
  const cs = Array.from({ length: n + 1 }, (_, i) => lerp(c0, c1, i / n));
  const at = (c: number, e: number, d: number) =>
    alongA ? pv(pl, e, c, d) : pv(pl, c, e, d);
  const [e0, e1] = alongA ? [a0, a1] : [b0, b1];
  soup.grid(
    cs.map((c, i) => [at(c, e0, ds[i]), at(c, e1, ds[i])]),
    dir(pl, 0, 0, 1),
  );
  // Walls: the two ends of every rib line, and the first / last line.
  for (let i = 0; i < n; i++)
    for (const [e, s] of [
      [e0, -1],
      [e1, 1],
    ] as const)
      soup.quad(
        at(cs[i], e, dBack),
        at(cs[i + 1], e, dBack),
        at(cs[i + 1], e, ds[i + 1]),
        at(cs[i], e, ds[i]),
        alongA ? dir(pl, s, 0, 0) : dir(pl, 0, s, 0),
      );
  for (const [i, s] of [
    [0, -1],
    [n, 1],
  ] as const)
    soup.quad(
      at(cs[i], e0, dBack),
      at(cs[i], e1, dBack),
      at(cs[i], e1, ds[i]),
      at(cs[i], e0, ds[i]),
      alongA ? dir(pl, 0, s, 0) : dir(pl, s, 0, 0),
    );
}

/** Concave reflector bowl in a rounded rectangle: rim at dRim, `depth` deep in the middle. */
export function dish(
  soup: Soup,
  pl: Plane,
  ca: number,
  cb: number,
  w: number,
  h: number,
  r: number,
  dRim: number,
  depth: number,
  rings = 6,
): void {
  const base = rrect(0, 0, w, h, r, 3);
  const rows = Array.from({ length: rings + 1 }, (_, k) => {
    const s = 1 - k / rings;
    const d = dRim - depth * (1 - s * s);
    const row = base.map(([a, b]) => pv(pl, ca + a * s, cb + b * s, d));
    row.push(row[0]);
    return row;
  });
  soup.grid(rows, dir(pl, 0, 0, 1));
}

/** Sphere (bulb) at plane coordinates. */
export function bulb(
  pl: Plane,
  a: number,
  b: number,
  d: number,
  r: number,
): BufferGeometry {
  const g = new SphereGeometry(r, 10, 6);
  const m = new Matrix4().makeBasis(
    new Vector3(...pl.a),
    new Vector3(...pl.b),
    new Vector3(...pl.n),
  );
  m.setPosition(...mix(pl, a, b, d));
  g.applyMatrix4(m);
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

/**
 * Lens on a curved skin (tail lamps wrapping the body corner): `at[c](y, lift)` = point of skin
 * column c at height y lifted `lift` off the skin. Rows y0[c]..y1[c] per column (taper = rounded
 * end), horizontal ribs, walls back to `dBack`.
 */
export function skinLens(
  soup: Soup,
  s: number,
  at: ((y: number, lift: number) => V3)[],
  y0: number[],
  y1: number[],
  dBack: number,
  dFront: number,
  ribs: number,
  amp: number,
): void {
  const R = ribs * 2;
  const lift = (k: number) => (k % 2 ? dFront - amp : dFront);
  const P = (c: number, k: number, l: number): Vtx => {
    const [x, y, z] = at[c](lerp(y0[c], y1[c], k / R), l);
    // UV in metres (across the cluster, up) for fine optic patterns.
    return vtx(s * x, y, z, [x - z, y]);
  };
  // Faces point back and out to the side (the skin wraps from the tail panel onto the wing).
  const out: V3 = [s * 0.5, 0, -1];
  soup.grid(
    at.map((_, c) => Array.from({ length: R + 1 }, (_, k) => P(c, k, lift(k)))),
    out,
  );
  for (let c = 0; c + 1 < at.length; c++) {
    soup.quad(
      P(c, 0, dBack),
      P(c + 1, 0, dBack),
      P(c + 1, 0, dFront),
      P(c, 0, dFront),
      [0, -1, 0],
    );
    soup.quad(
      P(c, R, dBack),
      P(c + 1, R, dBack),
      P(c + 1, R, dFront),
      P(c, R, dFront),
      [0, 1, 0],
    );
  }
  // End walls face away from the neighbouring column.
  for (const [c, nb] of [
    [0, 1],
    [at.length - 1, at.length - 2],
  ])
    for (let k = 0; k < R; k++) {
      const p = P(c, k, dBack).p;
      const q = P(nb, k, dBack).p;
      soup.quad(
        P(c, k, dBack),
        P(c, k + 1, dBack),
        P(c, k + 1, lift(k + 1)),
        P(c, k, lift(k)),
        [p[0] - q[0], 0, p[2] - q[2]],
      );
    }
}
