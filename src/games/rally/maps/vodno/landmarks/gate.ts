import { FOOT, LIFT, strut, type Local, type V3 } from './common';
import type { PadDef } from '../../shared/types';
import { toWorld, type Area, type Site } from './sites';

/**
 * The wooden gate where the Vodno road leaves the suburb, a short way past the first crossroad: two lattice log towers with pyramid roofs stand either side of the
 * road, with a timber notice board and a log shelter on the gravel beside the right one and an orange information board
 * a little way up the road. Rough shapes, no lettering. `GATE` is the road's centre line at the gate: local x along the
 * road (up the climb), z to its right; every structure has its own site (its own ground height).
 */
export const GATE: Site = { x: 1803.9, z: -764.5, yaw: 1.169 };
const near = (x: number, z: number): Site => {
  const [wx, wz] = toWorld(GATE, x, z);
  return { x: wx, z: wz, yaw: GATE.yaw };
};
export const TOWER_LEFT = near(0, -6.4);
export const TOWER_RIGHT = near(0, 7.3);
export const BOARD = near(1.6, 10.6);
export const SHELTER = near(5.5, 17.2);
export const SIGN = near(24, 5.6);

export const GATE_AREAS: Area[] = [
  { site: TOWER_LEFT, rect: [-1.3, 1.3, -1.3, 1.3] },
  { site: TOWER_RIGHT, rect: [-1.3, 1.3, -1.3, 1.3] },
  { site: BOARD, rect: [-0.8, 0.8, -2.1, 2.1] },
  { site: SHELTER, rect: [-3.2, 3.2, -2.6, 2.6] },
  { site: SIGN, rect: [-0.8, 0.8, -1.4, 1.4] },
];

/** The gravel beside the right tower (the notice board, the shelter): level with the road, cut into the slope above it. */
export const GATE_PAD: PadDef = {
  name: 'gate_gravel',
  polygon: (
    [
      [-5, 7.5],
      [13, 7.5],
      [13, 22],
      [-5, 22],
    ] as const
  ).flatMap(([x, z]) => toWorld(GATE, x, z)),
  blend: 4,
  frontage: [...toWorld(GATE, -6, 0), ...toWorld(GATE, 14, 0)],
  lift: 0.15,
};

const LOGS = ['#8c5c38', '#7d5031', '#97653b', '#74492d'];
const PLANK = ['#6a4529', '#74492c', '#5f3d24', '#6d4527'];
const TOWER_H = 6.4;

/** A lattice tower: four slightly leaning log legs, three bays of cross braces, a pyramid roof of dark shingles. */
export function buildTower(l: Local, seed: number): void {
  const base = 0.82;
  const top = 0.52;
  const half = (y: number): number => base + (top - base) * (y / TOWER_H);
  const corner = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  const at = (i: number, y: number): V3 => [
    corner[i][0] * half(y),
    y,
    corner[i][1] * half(y),
  ];
  const log = (k: number): string => LOGS[(k + seed) % LOGS.length];
  // A concrete plinth.
  l.box('wall', [-1.05, FOOT, -1.05], [1.05, 0.32, 1.05], '#b4b1a8');
  for (let i = 0; i < 4; i++)
    strut(l, at(i, 0.3), at(i, TOWER_H), 0.26, log(i), 'paint');
  const levels = [0.3, 2.5, 4.5, TOWER_H];
  let k = 0;
  for (let b = 0; b < levels.length; b++)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      strut(l, at(i, levels[b]), at(j, levels[b]), 0.16, log(k++), 'paint');
      if (b + 1 < levels.length) {
        strut(
          l,
          at(i, levels[b]),
          at(j, levels[b + 1]),
          0.12,
          log(k++),
          'paint',
        );
        strut(
          l,
          at(j, levels[b]),
          at(i, levels[b + 1]),
          0.12,
          log(k++),
          'paint',
        );
      }
    }
  // The ceiling under the roof, the roof with a wide overhang, a short finial.
  const h = top + 0.22;
  l.box('paint', [-h, TOWER_H, -h], [h, TOWER_H + 0.16, h], '#4b3322');
  const o = 1.3;
  const eave = TOWER_H + 0.16 + LIFT;
  const c: [number, number][] = [
    [-o, -o],
    [o, -o],
    [o, o],
    [-o, o],
  ];
  for (let i = 0; i < 4; i++)
    l.roof(
      [
        [c[i][0], eave, c[i][1]],
        [c[(i + 1) % 4][0], eave, c[(i + 1) % 4][1]],
        [0, eave + 2.0, 0],
      ],
      { color: '#7d6048', trim: [0], fascia: '#3f2a1d' },
    );
  l.box(
    'paint',
    [-0.06, eave + 1.9, -0.06],
    [0.06, eave + 2.45, 0.06],
    '#3f2a1d',
  );
}

/**
 * The notice board: two posts and a plank board facing the traffic coming up the road (-x), a small roof over it.
 * Local x along the road, the board spans z.
 */
export function buildBoard(l: Local): void {
  for (const s of [-1.2, 1.2])
    l.box('paint', [-0.07, FOOT, s - 0.07], [0.07, 2.55, s + 0.07], '#4b3322');
  l.box('paint', [-0.1, 1.0, -1.45], [0.06, 2.35, 1.45], '#5b3a22');
  for (let i = 0; i < 6; i++)
    l.box(
      'paint',
      [-0.14, 1.08 + i * 0.2, -1.38],
      [-0.09, 1.08 + (i + 1) * 0.2 - 0.02, 1.38],
      i % 2 ? '#8d5a33' : '#7c4d2b',
    );
  l.box('paint', [-0.32, 2.35, -1.62], [0.22, 2.45, 1.62], '#4b5849');
}

/**
 * The log shelter: a slab, four log posts, plank walls on the back and the sides, the front open to the road (-z), a
 * bench and table inside, a green hip roof. Local x along the road, z across (the front at -z).
 */
export function buildShelter(l: Local): void {
  const hx = 2.4;
  const hz = 1.7;
  const eave = 2.5;
  l.box(
    'wall',
    [-hx - 0.15, FOOT, -hz - 0.15],
    [hx + 0.15, 0.2, hz + 0.15],
    '#a09d94',
  );
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      strut(
        l,
        [sx * (hx - 0.1), 0.2, sz * (hz - 0.1)],
        [sx * (hx - 0.1), eave, sz * (hz - 0.1)],
        0.22,
        LOGS[(sx + sz + 2) % 4],
        'paint',
      );
  // Plank walls: back (+z) and both sides, laid in rows.
  for (let y = 0.2, i = 0; y < eave - 0.05; y += 0.27, i++) {
    const c = PLANK[i % PLANK.length];
    l.box('paint', [-hx, y, hz - 0.14], [hx, y + 0.25, hz], c);
    for (const sx of [-1, 1])
      l.box(
        'paint',
        [sx > 0 ? hx - 0.14 : -hx, y, -hz],
        [sx > 0 ? hx : -hx + 0.14, y + 0.25, hz],
        c,
      );
  }
  // Front rail, a bench along the back and a table in the middle.
  l.box('paint', [-hx, 0.85, -hz - 0.04], [hx, 0.95, -hz + 0.08], '#4d311d');
  l.box(
    'paint',
    [-hx + 0.15, 0.45, hz - 0.7],
    [hx - 0.15, 0.52, hz - 0.15],
    '#6b4429',
  );
  l.box('paint', [-1.1, 0.72, -0.5], [1.1, 0.78, 0.5], '#7a4d2b');
  for (const sx of [-0.9, 0.9])
    for (const sz of [-0.35, 0.35])
      l.box(
        'paint',
        [sx - 0.04, 0.2, sz - 0.04],
        [sx + 0.04, 0.72, sz + 0.04],
        '#4d311d',
      );
  // The hip roof.
  const X = hx + 0.65;
  const Z = hz + 0.65;
  const ye = eave + LIFT;
  const yr = eave + 1.35;
  const R = 1.3;
  const green = { color: '#4f6b4c', trim: [0], fascia: '#2f3d2e' };
  l.roof(
    [
      [-X, ye, -Z],
      [X, ye, -Z],
      [R, yr, 0],
      [-R, yr, 0],
    ],
    green,
  );
  l.roof(
    [
      [X, ye, Z],
      [-X, ye, Z],
      [-R, yr, 0],
      [R, yr, 0],
    ],
    green,
  );
  l.roof(
    [
      [-X, ye, Z],
      [-X, ye, -Z],
      [-R, yr, 0],
    ],
    green,
  );
  l.roof(
    [
      [X, ye, -Z],
      [X, ye, Z],
      [R, yr, 0],
    ],
    green,
  );
}

/** The orange information board on two posts, its face to the traffic coming up the road (-x). */
export function buildSign(l: Local): void {
  for (const s of [-0.6, 0.6])
    l.box('paint', [-0.04, FOOT, s - 0.04], [0.04, 2.7, s + 0.04], '#6b6f72');
  l.box('paint', [-0.12, 0.95, -0.9], [-0.04, 2.7, 0.9], '#e08a2a');
  l.box('paint', [-0.15, 1.9, -0.72], [-0.12, 2.55, 0.72], '#efe7d3');
  l.box('paint', [-0.15, 1.15, -0.72], [-0.12, 1.8, -0.05], '#3d4a58');
  l.box('paint', [-0.15, 1.15, 0.1], [-0.12, 1.8, 0.72], '#c9742a');
}
