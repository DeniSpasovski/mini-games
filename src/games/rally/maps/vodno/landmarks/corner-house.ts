import { type Local, type V3 } from './common';
import { post, strut } from './park';
import type { Site } from './sites';
import { CORNER_HOUSE } from './start-blocks';
import { ac, fbox, footOf, win, type Body } from './start-towers';

/**
 * The house on the bank at the corner before the blocks (baked building 9's footprint), from the drive videos: two
 * storeys of pale yellow render under a low grey roof, barred windows in grey-blue frames, air-conditioning units and
 * downpipes on its road face, a chain-link fence on posts along the foot of that face and a rusty ladder up to the roof.
 * Local frame: x along the house (towards its north end), z across it (-z = the road side), y up from the ground at its
 * centre.
 */
export const CORNER_SITE: Site = {
  x: CORNER_HOUSE.x,
  z: CORNER_HOUSE.z,
  yaw: CORNER_HOUSE.angle,
};
export const CORNER: Body = { hw: CORNER_HOUSE.w / 2, hd: CORNER_HOUSE.d / 2 };
export const CORNER_TOP = 7.4;

const RENDER = '#f6ebc4';
const FRAME = '#5d7890';
const STEEL = '#8d9397';
const POST = '#3f6d52';

export function buildCornerHouse(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const b = CORNER;
  const { hw, hd } = b;
  const lo = footOf(l, b, ground);
  const E = 6.2;
  l.box('render', [-hw, lo - 0.3, -hd], [hw, E, hd], RENDER);
  l.box(
    'render',
    [-hw - 0.03, lo - 0.3, -hd - 0.03],
    [hw + 0.03, 0.45, hd + 0.03],
    '#b9b09d',
  );
  l.box(
    'render',
    [-hw - 0.06, 3.0, -hd - 0.06],
    [hw + 0.06, 3.15, hd + 0.06],
    '#e2d3a0',
  );
  // Windows: ground floor barred, the upper floor plain; both long faces, a pair on each end.
  const bars = (f: 'n' | 's', a: number, y0: number, y1: number): void => {
    for (let i = 1; i <= 4; i++) {
      const x = a - 0.6 + i * 0.24;
      fbox(
        l,
        b,
        f,
        'metal',
        x - 0.015,
        x + 0.015,
        0.1,
        0.13,
        y0,
        y1,
        '#e6e6e2',
      );
    }
    for (const y of [y0 + 0.05, y1 - 0.08])
      fbox(
        l,
        b,
        f,
        'metal',
        a - 0.65,
        a + 0.65,
        0.1,
        0.13,
        y,
        y + 0.03,
        '#e6e6e2',
      );
  };
  for (const f of ['n', 's'] as const)
    for (const a of [-9.2, -5.6, -2, 1.6, 5.2, 8.8]) {
      win(l, b, f, a - 0.6, a + 0.6, 1.0, 2.3, { frame: FRAME });
      bars(f, a, 1.0, 2.3);
      win(l, b, f, a - 0.6, a + 0.6, 4.0, 5.4, { frame: FRAME });
    }
  for (const f of ['e', 'w'] as const)
    for (const a of [-2.4, 2.4]) {
      win(l, b, f, a - 0.6, a + 0.6, 4.0, 5.4, { frame: FRAME });
      if (f === 'w') win(l, b, f, a - 0.6, a + 0.6, 1.0, 2.3, { frame: FRAME });
    }
  // The door on the north end (to the corner the street comes round), a small canopy over it.
  win(l, b, 'e', -0.8, 0.8, 0, 2.3, { frame: '#4b4f52', door: true });
  fbox(l, b, 'e', 'paint', -1.2, 1.2, 0, 0.9, 2.5, 2.6, '#d8d6d0');
  // Units, downpipes.
  ac(l, b, 'n', -3.8, 5.55);
  ac(l, b, 'n', 7.0, 5.55);
  ac(l, b, 'n', 3.4, 2.45);
  for (const a of [-hw + 0.25, 0.3, hw - 0.25])
    fbox(
      l,
      b,
      'n',
      'metal',
      a - 0.05,
      a + 0.05,
      0.03,
      0.13,
      lo,
      E + 0.1,
      STEEL,
    );

  // The low grey roof: a shallow gable along the house, its eaves out 0.4 m.
  const O = 0.4;
  const R = 1.0;
  const eave = (s: number): V3[] => [
    [-hw - O, E, s * (hd + O)],
    [hw + O, E, s * (hd + O)],
    [hw + O, E + R, 0],
    [-hw - O, E + R, 0],
  ];
  for (const s of [-1, 1]) {
    l.fan('sheet', eave(s), '#8e9193', [0, 1, s * 0.15], (p) => [p[0], p[2]]);
    l.fan(
      'paint',
      eave(s).map(([x, y, z]): V3 => [x, y - 0.08, z]),
      '#d8d4c8',
      [0, -1, 0],
      (p) => [p[0], p[2]],
    );
    l.box(
      'paint',
      [-hw - O, E - 0.18, s > 0 ? hd + O - 0.04 : -hd - O],
      [hw + O, E, s > 0 ? hd + O : -hd - O + 0.04],
      '#6f7376',
    );
  }
  for (const x of [-hw, hw])
    l.fan(
      'render',
      [
        [x, E, -hd],
        [x, E, hd],
        [x, E + R - 0.05, 0],
      ],
      RENDER,
      [Math.sign(x), 0, 0],
      (p) => [p[2], p[1]],
    );

  // The chain-link fence along the foot of the road face, 0.8 m out, on green posts.
  const fz = -hd - 0.8;
  const gy = (x: number): number => {
    const c = Math.cos(l.site.yaw);
    const s = Math.sin(l.site.yaw);
    return (
      ground(l.site.x + x * c - fz * s, l.site.z + x * s + fz * c) - l.baseY
    );
  };
  for (let x = -hw - 0.5; x <= hw + 0.5 + 1e-6; x += (2 * hw + 1) / 10) {
    const y = gy(x);
    post(l, x, fz, y - 0.3, y + 2.0, 0.06, 'metal', POST);
    const x1 = x + (2 * hw + 1) / 10;
    if (x1 > hw + 0.6) break;
    const y1 = gy(x1);
    const ylo = Math.min(y, y1);
    l.box(
      'fence',
      [x, ylo + 0.05, fz - 0.01],
      [x1, ylo + 1.95, fz + 0.01],
      STEEL,
    );
    strut(l, [x, y + 1.96, fz], [x1, y1 + 1.96, fz], 0.02, 'metal', STEEL);
  }
  // The ladder up to the roof, inside the fence.
  const lx = 7.6;
  const lz = -hd - 0.3;
  for (const dx of [-0.22, 0.22])
    l.box(
      'metal',
      [lx + dx - 0.025, lo, lz - 0.025],
      [lx + dx + 0.025, E + 1.0, lz + 0.025],
      '#7a4a2e',
    );
  for (let y = lo + 0.3; y < E + 0.8; y += 0.3)
    l.box(
      'metal',
      [lx - 0.22, y - 0.012, lz - 0.012],
      [lx + 0.22, y + 0.012, lz + 0.012],
      '#7a4a2e',
    );
}
