import type { Local, V2, V3 } from './common';

/** The unit vector of (x, z). */
export const unitV = (x: number, z: number): V2 => {
  const k = Math.hypot(x, z) || 1;
  return [x / k, z / k];
};

/** A run of rock wall: its line, the heights along it and where its faces lie. */
export interface WallRun {
  /** The line (local x, z) and the unit normal to the outer side at each vertex. */
  p: V2[];
  n: V2[];
  /** Height of the top and of the foot at each vertex (local frame, y over the site's base). */
  hi: number[];
  lo: number[];
  /** Where the inner and the outer face lie, m from the line along the normal. */
  inner: number;
  outer: number;
}

/**
 * A continuous rock wall along a run: an outer face, an inner face, a top and the two end faces, all sloping with the
 * heights given per vertex - no steps, no cracks at curves (one ribbon, not a row of boxes). Material `rubble`.
 */
export function wallRibbon(l: Local, run: WallRun, color = '#ddd7ca'): void {
  const m = run.p.length;
  if (m < 2) return;
  const at = (k: number, o: number): V2 => [
    run.p[k][0] + run.n[k][0] * o,
    run.p[k][1] + run.n[k][1] * o,
  ];
  const tan = unitV(
    run.p[m - 1][0] - run.p[0][0],
    run.p[m - 1][1] - run.p[0][1],
  );
  const face = (pts: V3[], want: V3, top = false): void =>
    l.fan(
      'rubble',
      pts,
      color,
      want,
      top ? (q) => [q[0], q[2]] : (q) => [q[0] * tan[0] + q[2] * tan[1], q[1]],
    );
  const v3 = (q: V2, y: number): V3 => [q[0], y, q[1]];
  const { hi, lo, inner, outer } = run;
  for (let k = 0; k + 1 < m; k++) {
    const [nx, nz] = unitV(
      run.n[k][0] + run.n[k + 1][0],
      run.n[k][1] + run.n[k + 1][1],
    );
    const [a0, a1, b0, b1] = [
      at(k, inner),
      at(k + 1, inner),
      at(k, outer),
      at(k + 1, outer),
    ];
    face(
      [v3(b0, lo[k]), v3(b1, lo[k + 1]), v3(b1, hi[k + 1]), v3(b0, hi[k])],
      [nx, 0, nz],
    );
    face(
      [v3(a0, lo[k]), v3(a1, lo[k + 1]), v3(a1, hi[k + 1]), v3(a0, hi[k])],
      [-nx, 0, -nz],
    );
    face(
      [v3(a0, hi[k]), v3(a1, hi[k + 1]), v3(b1, hi[k + 1]), v3(b0, hi[k])],
      [0, 1, 0],
      true,
    );
  }
  for (const [k, sgn] of [
    [0, -1],
    [m - 1, 1],
  ] as const)
    face(
      [
        v3(at(k, inner), lo[k]),
        v3(at(k, outer), lo[k]),
        v3(at(k, outer), hi[k]),
        v3(at(k, inner), hi[k]),
      ],
      [tan[0] * sgn, 0, tan[1] * sgn],
    );
}

/** Averages each interior value with its neighbours (1-2-1), `times` times: a smoother top. */
export function smoothHeights(v: number[], times = 2): number[] {
  let out = v;
  for (let t = 0; t < times; t++)
    out = out.map((x, k) =>
      k === 0 || k === out.length - 1
        ? x
        : (out[k - 1] + 2 * x + out[k + 1]) / 4,
    );
  return out;
}
