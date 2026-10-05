import {
  CircleGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
} from 'three';
import { TENT_HALF } from '../yard';
import type { Local, V3 } from './shapes';

/**
 * Courtyard furniture of the hilltop (photos ref-60..63): park benches, the event marquees with trestle
 * tables, round flower beds. Each builder draws one item in its own `Local` (origin at the item, y up from
 * its ground; local +z = the front).
 */
const WOOD = '#8a5a33';
const IRON = '#2a2b2d';
const CANVAS = '#f5f5f1';
const CANVAS_UNDER = '#d9dad6';

/** Park bench: iron side frames, three seat slats, a two-slat backrest at -z; 1.8 m long. */
export function buildBench(l: Local): void {
  const L = 0.9;
  for (const x of [-L + 0.12, L - 0.12]) {
    l.box('metal', [x - 0.03, 0, -0.05], [x + 0.03, 0.43, 0.05], IRON);
    l.box('metal', [x - 0.03, 0.38, -0.24], [x + 0.03, 0.43, 0.22], IRON);
    l.box('metal', [x - 0.03, 0.43, -0.24], [x + 0.03, 0.85, -0.19], IRON);
    l.box('metal', [x - 0.03, 0, -0.2], [x + 0.03, 0.05, 0.2], IRON);
  }
  for (const z of [-0.16, -0.02, 0.12])
    l.box('paint', [-L, 0.43, z - 0.06], [L, 0.47, z + 0.06], WOOD);
  for (const y of [0.56, 0.72])
    l.box('paint', [-L, y - 0.05, -0.235], [L, y + 0.05, -0.2], WOOD);
}

/** A trestle table (2.4 x 0.8 m, top at 0.75 m) with a bench either side, along local x at z = `z`. */
function tableSet(l: Local, z: number): void {
  const L = 1.2;
  l.box('paint', [-L, 0.71, z - 0.4], [L, 0.75, z + 0.4], WOOD);
  for (const x of [-L + 0.25, L - 0.25]) {
    l.box('paint', [x - 0.04, 0, z - 0.32], [x + 0.04, 0.71, z - 0.26], WOOD);
    l.box('paint', [x - 0.04, 0, z + 0.26], [x + 0.04, 0.71, z + 0.32], WOOD);
  }
  for (const side of [-1, 1]) {
    const bz = z + side * 0.68;
    l.box('paint', [-L, 0.42, bz - 0.13], [L, 0.46, bz + 0.13], WOOD);
    for (const x of [-L + 0.2, L - 0.2])
      l.box(
        'paint',
        [x - 0.04, 0, bz - 0.04],
        [x + 0.04, 0.42, bz + 0.04],
        WOOD,
      );
  }
}

/**
 * Pagoda marquee (5 x 5 m, white): four poles, a scalloped valance, a roof that sweeps up from the eaves
 * to a peak (two slopes per side), open sides; two table sets under it.
 */
export function buildTent(l: Local): void {
  const H = TENT_HALF;
  const eave = 2.35;
  const kinkR = 1.05;
  const kinkY = 3.25;
  const peak = 4.3;
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    l.box(
      'metal',
      [sx * H - 0.035, -0.5, sz * H - 0.035],
      [sx * H + 0.035, eave, sz * H + 0.035],
      '#e8e8e4',
    );
  // Roof: per side a lower trapezoid (eave -> kink) and an upper triangle (kink -> peak), both faces.
  const sides: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (const [nx, nz] of sides) {
    const r: [number, number] = [nz, -nx];
    const p = (half: number, s: number, y: number): V3 => [
      nx * half + r[0] * s,
      y,
      nz * half + r[1] * s,
    ];
    const lower = [
      p(H + 0.05, -H - 0.05, eave),
      p(H + 0.05, H + 0.05, eave),
      p(kinkR, kinkR, kinkY),
      p(kinkR, -kinkR, kinkY),
    ];
    const upper = [
      p(kinkR, -kinkR, kinkY),
      p(kinkR, kinkR, kinkY),
      [0, peak, 0] as V3,
    ];
    for (const pts of [lower, upper]) {
      const a = pts[0];
      const b = pts[1];
      const c = pts[2];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const up: V3 = n[1] >= 0 ? n : [-n[0], -n[1], -n[2]];
      l.fan('paint', pts, CANVAS, up, () => [0, 0]);
      l.fan('paint', pts, CANVAS_UNDER, [-up[0], -up[1], -up[2]], () => [0, 0]);
    }
    // Valance: a 0.28 m skirt under the eave, scalloped (a row of shallow V's), both faces.
    const n = 8;
    for (let i = 0; i < n; i++) {
      const s0 = -H - 0.05 + ((2 * H + 0.1) * i) / n;
      const s1 = -H - 0.05 + ((2 * H + 0.1) * (i + 1)) / n;
      const pts = [
        p(H + 0.06, s0, eave),
        p(H + 0.06, s1, eave),
        p(H + 0.06, s1, eave - 0.2),
        p(H + 0.06, (s0 + s1) / 2, eave - 0.3),
        p(H + 0.06, s0, eave - 0.2),
      ];
      l.fan('paint', pts, CANVAS, [nx, 0, nz], () => [0, 0]);
      l.fan('paint', pts, CANVAS_UNDER, [-nx, 0, -nz], () => [0, 0]);
    }
  }
  l.box(
    'metal',
    [-0.03, peak - 0.05, -0.03],
    [0.03, peak + 0.35, 0.03],
    '#cfcfcb',
  );
  tableSet(l, -1.15);
  tableSet(l, 1.15);
}

/** Round flower bed: a ring of stones (0.7 m), soil, a mound of flowers in a few colours. */
export function buildBed(l: Local, seed: number): void {
  const ring = new CylinderGeometry(0.72, 0.75, 0.3, 14, 1, true);
  l.add('paint', ring, '#a79f92', new Matrix4().makeTranslation(0, 0.1, 0));
  const top = new CylinderGeometry(0.72, 0.72, 0.04, 14, 1, true);
  l.add('paint', top, '#bdb6aa', new Matrix4().makeTranslation(0, 0.25, 0));
  const soil = new CircleGeometry(0.7, 14);
  l.add(
    'leaf',
    soil,
    '#5a4330',
    new Matrix4()
      .makeTranslation(0, 0.2, 0)
      .multiply(new Matrix4().makeRotationX(-Math.PI / 2)),
  );
  const colors = ['#d8407a', '#f0f0f0', '#e8c23a', '#b04ad0', '#e85a3a'];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + seed;
    const r = i === 0 ? 0 : 0.42;
    const blob = new IcosahedronGeometry(i === 0 ? 0.3 : 0.2, 0);
    l.add(
      'leaf',
      blob,
      i % 3 === 0 ? '#4c7a2e' : colors[(i + seed) % colors.length],
      new Matrix4().makeTranslation(
        Math.cos(a) * r,
        0.3 + (i === 0 ? 0.12 : 0),
        Math.sin(a) * r,
      ),
    );
  }
}
