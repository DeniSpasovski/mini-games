import { Matrix4, TorusGeometry, Vector2 } from 'three';
import { COURT_SIZE, toLocal, toWorld } from '../site';
import type { Local, V3 } from './shapes';

/**
 * The village playground court at the hill road junction (OSM leisure=pitch, asphalt; photos ref-57 /
 * ref-58): a light grey asphalt slab the size of the OSM outline (31.3 x 20.9 m) on the levelled
 * terrace, white basketball markings (28 x 15 m FIBA layout) and a black-board hoop at each end.
 *
 * Local frame: x along the long side, z across, y up from the terrace. The terrace is levelled
 * (site.ts HILLTOP_FLATS), but the stage road's bank reaches the east corner, so the slab, its lines and
 * its kerb are draped on the ground (`ground(x, z)` = local metres -> height above the terrace).
 */
type Ground = (x: number, z: number) => number;
const LINE = 0.05;
const PAINT = '#f2f1ec';
const POLE = '#3b4247';

/** Hoop positions (local x of the pole) at both ends: just inside the asphalt. */
export const HOOP_POLES = [-15.0, 15.0];

/** A painted line from a to b (local x, z), in pieces of <= 1 m draped on the slab. */
function line(
  l: Local,
  g: Ground,
  a: [number, number],
  b: [number, number],
): void {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (LINE / 2);
  const nz = (dx / len) * (LINE / 2);
  const n = Math.max(1, Math.ceil(len));
  const at = (t: number): [number, number] => [a[0] + dx * t, a[1] + dz * t];
  const p = (q: [number, number], s: number): V3 => [
    q[0] + nx * s,
    g(q[0], q[1]) + 0.06,
    q[1] + nz * s,
  ];
  for (let i = 0; i < n; i++) {
    const q0 = at(i / n);
    const q1 = at((i + 1) / n);
    l.fan(
      'marking',
      [p(q0, 1), p(q1, 1), p(q1, -1), p(q0, -1)],
      PAINT,
      [0, 1, 0],
      () => [0, 0],
    );
  }
}

/** An arc of radius r round (cx, cz) from angle a0 to a1 (rad, from +x towards +z). */
function arc(
  l: Local,
  g: Ground,
  cx: number,
  cz: number,
  r: number,
  a0: number,
  a1: number,
): void {
  const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r) / 0.5));
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    line(
      l,
      g,
      [cx + Math.cos(t0) * r, cz + Math.sin(t0) * r],
      [cx + Math.cos(t1) * r, cz + Math.sin(t1) * r],
    );
  }
}

/** Site offset (world minus the site's origin) -> local x, z. */
const toLocalOffset = (l: Local, sx: number, sz: number) =>
  toLocal(l.site, sx + l.site.x, sz + l.site.z);

export function buildCourt(l: Local, g: Ground): void {
  // Asphalt: the OSM outline (flat polygon in site metres; the terrace under it is level).
  const L = COURT_SIZE.length / 2;
  const Wd = COURT_SIZE.width / 2;
  const outline = (
    [
      [-L, -Wd],
      [L, -Wd],
      [L, Wd],
      [-L, Wd],
    ] as const
  ).map(([x, z]) => {
    const [wx, wz] = toWorld(l.site, x, z);
    return new Vector2(wx - l.site.x, wz - l.site.z);
  });
  l.frame.polygon('concrete', outline, l.baseY + 0.04, '#e4e1da', {
    lift: (sx, sz) => {
      const [x, z] = toLocalOffset(l, sx, sz);
      return g(x, z);
    },
    step: 1.5,
  });
  // A concrete kerb round it, in 1.5 m pieces on the ground.
  const corners: [number, number][] = [
    [-L, -Wd],
    [L, -Wd],
    [L, Wd],
    [-L, Wd],
  ];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 1.5);
    const along = a[0] === b[0] ? 'z' : 'x';
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const x0 = a[0] + (b[0] - a[0]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1;
      const z0 = a[1] + (b[1] - a[1]) * t0;
      const z1 = a[1] + (b[1] - a[1]) * t1;
      const y = g((x0 + x1) / 2, (z0 + z1) / 2);
      const w = 0.12;
      l.box(
        'paint',
        [
          along === 'x' ? Math.min(x0, x1) : x0 - w,
          y - 0.4,
          along === 'z' ? Math.min(z0, z1) : z0 - w,
        ],
        [
          along === 'x' ? Math.max(x0, x1) : x0 + w,
          y + 0.09,
          along === 'z' ? Math.max(z0, z1) : z0 + w,
        ],
        '#b9b4aa',
      );
    }
  });

  // Markings: 28 x 15 m, centre line + circle, keys, free-throw circles, three-point lines.
  const CL = 14;
  const CW = 7.5;
  line(l, g, [-CL, -CW], [CL, -CW]);
  line(l, g, [-CL, CW], [CL, CW]);
  line(l, g, [-CL, -CW], [-CL, CW]);
  line(l, g, [CL, -CW], [CL, CW]);
  line(l, g, [0, -CW], [0, CW]);
  arc(l, g, 0, 0, 1.8, 0, Math.PI * 2);
  for (const side of [-1, 1]) {
    const end = side * CL;
    const ft = side * (CL - 5.8);
    line(l, g, [end, -2.45], [ft, -2.45]);
    line(l, g, [end, 2.45], [ft, 2.45]);
    line(l, g, [ft, -2.45], [ft, 2.45]);
    arc(
      l,
      g,
      ft,
      0,
      1.8,
      side > 0 ? Math.PI / 2 : -Math.PI / 2,
      side > 0 ? (Math.PI * 3) / 2 : Math.PI / 2,
    );
    // Three-point line: straight from the end line at z = +-6.6, then a 6.75 m arc round the basket.
    const basket = side * (CL - 1.575);
    const flat = Math.sqrt(6.75 ** 2 - 6.6 ** 2);
    line(l, g, [end, -6.6], [basket - side * flat, -6.6]);
    line(l, g, [end, 6.6], [basket - side * flat, 6.6]);
    const t = Math.asin(6.6 / 6.75);
    if (side > 0) arc(l, g, basket, 0, 6.75, Math.PI - t, Math.PI + t);
    else arc(l, g, basket, 0, 6.75, -t, t);
  }

  // Hoops: a square pole off the asphalt end, a gooseneck arm, a black board, an orange ring (the ends
  // are on the level part of the terrace).
  for (const px of HOOP_POLES) {
    const side = Math.sign(px);
    l.box('metal', [px - 0.06, -0.5, -0.06], [px + 0.06, 3.5, 0.06], POLE);
    const board = side * (CL - 1.2);
    l.box(
      'metal',
      [Math.min(px, board), 3.38, -0.05],
      [Math.max(px, board), 3.48, 0.05],
      POLE,
    );
    l.box(
      'metal',
      [Math.min(px, board + side * 0.6), 2.95, -0.04],
      [Math.max(px, board + side * 0.6), 3.02, 0.04],
      POLE,
    );
    l.box(
      'paint',
      [board - 0.025, 2.9, -0.9],
      [board + 0.025, 3.95, 0.9],
      '#1c1c1d',
    );
    l.box(
      'paint',
      [board - side * 0.03 - 0.005, 3.0, -0.3],
      [board - side * 0.03 + 0.005, 3.45, 0.3],
      '#e8e6e0',
    );
    const ring = new TorusGeometry(0.225, 0.012, 4, 16);
    l.add(
      'metal',
      ring,
      '#d8561c',
      new Matrix4()
        .makeTranslation(side * (CL - 1.575), 3.05, 0)
        .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
    );
    l.box(
      'metal',
      [Math.min(board, side * (CL - 1.35)), 3.03, -0.03],
      [Math.max(board, side * (CL - 1.35)), 3.06, 0.03],
      '#d8561c',
    );
  }
}
