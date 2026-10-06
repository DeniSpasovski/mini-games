import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { cylindricalUV, merge, paint, planarUV, shade } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/** Road-side props. Front of every prop faces +Z. */

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  rng?: Rng,
) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return planarUV(paint(g, color, rng, rng ? 0.04 : 0), 1.3);
};

export const hayBale: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const r = rng.range(0.6, 0.7);
  const g = new CylinderGeometry(r, r, 1.2, lod === 0 ? 16 : 8, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(0, r, 0);
  const p = paint(g, '#c4a050', rng, 0.08);
  cylindricalUV(p, 2, 4);
  // Lighter spiral ends, darker underside.
  shade(
    p,
    (x, y) =>
      (Math.abs(x) > 0.59 ? 1.12 : 1) * (0.7 + 0.3 * Math.min(1, y / r)),
  );
  return { parts: [{ geometry: merge([p]), material: getMaterial('props') }] };
};

/** Mostly saturated: small bright spots make a stage look alive at speed. */
const JACKETS = [
  '#c0302a',
  '#2a5fc0',
  '#e0b020',
  '#2d8a3e',
  '#e6e6e6',
  '#333333',
  '#e06a1a',
  '#7a3ab0',
  '#d4e21c', // hi-vis yellow
  '#e0306e',
  '#1aa6c8',
  '#f05a10', // hi-vis orange
];
const SKIN = ['#e8c4a0', '#c99a72', '#8d5a3b', '#f0d0b0'];

export const spectator: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const jacket = JACKETS[(variant * 5 + rng.int(0, 11)) % JACKETS.length];
  const pants = rng.pick(['#2b2f3a', '#3b3a36', '#25344f', '#4a4a4a']);
  const skin = rng.pick(SKIN);
  const s = rng.range(0.92, 1.08);
  const parts: BufferGeometry[] = [];
  if (lod === 0) {
    parts.push(
      box(0.15, 0.86, 0.17, -0.1, 0.43, 0, pants),
      box(0.15, 0.86, 0.17, 0.1, 0.43, 0, pants),
    );
    parts.push(box(0.44, 0.62, 0.25, 0, 1.17, 0, jacket, rng));
    const armL = new BoxGeometry(0.11, 0.6, 0.13);
    armL.rotateZ(rng.range(-0.25, 0.1));
    armL.translate(0.28, 1.15, 0.02);
    const armR = new BoxGeometry(0.11, 0.6, 0.13);
    // Some fans wave / hold a camera up.
    if (rng.chance(0.35)) {
      armR.rotateZ(2.6);
      armR.translate(-0.33, 1.62, 0.02);
    } else {
      armR.rotateZ(rng.range(-0.1, 0.25));
      armR.translate(-0.28, 1.15, 0.02);
    }
    parts.push(
      planarUV(paint(armL, jacket), 1),
      planarUV(paint(armR, jacket), 1),
    );
    const head = new IcosahedronGeometry(0.12, 1);
    head.translate(0, 1.62, 0);
    parts.push(paint(head, skin));
    if (rng.chance(0.5))
      parts.push(box(0.26, 0.07, 0.28, 0, 1.73, 0.03, rng.pick(JACKETS)));
  } else {
    parts.push(
      box(0.4, 0.9, 0.22, 0, 0.45, 0, pants),
      box(0.46, 0.62, 0.26, 0, 1.18, 0, jacket),
    );
    const head = new IcosahedronGeometry(0.13, 0);
    head.translate(0, 1.62, 0);
    parts.push(paint(head, skin));
  }
  const g = merge(parts);
  g.scale(s, s, s);
  return { parts: [{ geometry: g, material: getMaterial('props') }] };
};

/**
 * Both faces of a one-sided sheet (the props material is front-side): the sheet + a copy with every triangle's
 * winding (position, colour, uv) reversed, normals recomputed. Non-indexed input.
 */
function twoSided(front: BufferGeometry): BufferGeometry[] {
  front.computeVertexNormals();
  const back = front.clone();
  for (const name of ['position', 'color', 'uv']) {
    const attr = back.getAttribute(name);
    const arr = attr.array as Float32Array;
    const n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3)
      for (let k = 0; k < n; k++) {
        const s = arr[(t + 1) * n + k];
        arr[(t + 1) * n + k] = arr[(t + 2) * n + k];
        arr[(t + 2) * n + k] = s;
      }
  }
  back.computeVertexNormals();
  return [front, back];
}

/** Colour every triangle of a non-indexed geometry by its centroid (crisp pattern edges on the mesh grid). */
function colourTriangles(
  g: BufferGeometry,
  f: (x: number, y: number) => Color,
): void {
  const p = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let t = 0; t < p.count; t += 3) {
    const c = f(
      (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3,
      (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3,
    );
    for (let k = 0; k < 3; k++) col.setXYZ(t + k, c.r, c.g, c.b);
  }
}

const TAPE_RED = new Color('#d8231b');
const TAPE_WHITE = new Color('#f2f2ee');

/** Post with red / white tape running 2.6 m either way along local X (posts 5.2 m apart make a continuous line). */
export const tapePost: AssetBuilder = ({ lod }) => {
  const post = new CylinderGeometry(0.025, 0.03, 1.05, 5, 3);
  post.translate(0, 0.52, 0);
  const pp = paint(post, '#f2f2f2');
  shade(pp, (_x, y) => (Math.floor(y * 4) % 2 ? 1 : 0.25));
  // 26 stripes of 20 cm over both stubs (13 at the far LOD: 40 cm, still reads as striped).
  const n = lod === 0 ? 26 : 13;
  const tape = paint(new PlaneGeometry(5.2, 0.08, n, 1), '#ffffff');
  colourTriangles(tape, (x) =>
    Math.floor((x + 2.6) / (5.2 / n)) % 2 ? TAPE_WHITE : TAPE_RED,
  );
  // Sags a little between the posts.
  const tp = tape.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const u = Math.abs(tp.getX(i)) / 2.6;
    tp.setY(i, tp.getY(i) + 0.92 - 0.06 * Math.sin(u * Math.PI));
  }
  return {
    parts: [
      {
        geometry: merge([pp, ...twoSided(tape)]),
        material: getMaterial('props'),
      },
    ],
  };
};

/** Fan flag colours and patterns (generic, no national or club flags): [pattern, colours]. */
const FLAGS: [
  'check' | 'halves' | 'band' | 'stripe' | 'hoist',
  string,
  string,
][] = [
  ['check', '#f2f2ee', '#1a1a1a'],
  ['stripe', '#f2c018', '#1f55c4'],
  ['hoist', '#ee6a12', '#f2f2ee'],
  ['band', '#d62a22', '#f2f2ee'],
  ['halves', '#1f55c4', '#ee6a12'],
  ['stripe', '#2a9a3a', '#f2c018'],
  ['halves', '#d62a22', '#1a1a1a'],
  ['band', '#f2c018', '#d62a22'],
];

/**
 * Fan flag on a pole stuck in the ground (2.3-2.9 m): a rippled cloth in saturated colours, flying along +X.
 * Variant = design (`FLAGS`). The cloth is two one-sided sheets (opposite windings), the props material is front-side.
 */
export const fanFlag: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const [pattern, a, b] = FLAGS[variant % FLAGS.length];
  const H = rng.range(2.3, 2.9);
  const W = 1.15;
  const FH = 0.75;
  const pole = new CylinderGeometry(0.018, 0.024, H, lod === 0 ? 5 : 3);
  pole.translate(0, H / 2, 0);
  const seg = lod === 0 ? 6 : 3;
  const front = paint(new PlaneGeometry(W, FH, seg * 2, seg), '#ffffff');
  const ca = new Color(a);
  const cb = new Color(b);
  const pick = (u: number, v: number): Color => {
    switch (pattern) {
      case 'check':
        return (Math.floor(u * 4) + Math.floor(v * 3)) % 2 ? ca : cb;
      case 'halves':
        return v > 0.5 ? ca : cb;
      case 'band':
        return Math.abs(v - 0.5) < 0.17 ? cb : ca;
      case 'stripe':
        return Math.abs(u - 0.5) < 0.17 ? cb : ca;
      case 'hoist':
        return u < 0.25 ? cb : ca;
    }
  };
  // Colour per triangle (crisp pattern edges on the 12 x 6 / 6 x 3 grid), then ripple: waves grow towards the free
  // end, the tip droops.
  colourTriangles(front, (x, y) => pick(x / W + 0.5, y / FH + 0.5));
  const p = front.getAttribute('position');
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / W + 0.5;
    p.setXYZ(
      i,
      u * W,
      p.getY(i) + H - FH / 2 - 0.04 - u * u * 0.12,
      Math.sin(u * 7 + phase) * 0.09 * u,
    );
  }
  return {
    parts: [
      {
        geometry: merge([paint(pole, '#d8d8d4'), ...twoSided(front)]),
        material: getMaterial('props'),
      },
    ],
  };
};

/**
 * Police / marshal road-closed barrier: two red-white striped rails on A-frame legs.
 * 2.2 m long along local X, front (+Z) faces the stage road.
 */
export const roadBarrier: AssetBuilder = ({ lod }) => {
  const L = 2.2;
  const stripes = lod === 0 ? 8 : 4;
  const w = L / stripes;
  const parts: BufferGeometry[] = [];
  for (const [y, h] of [
    [0.88, 0.2],
    [0.52, 0.2],
  ]) {
    for (let i = 0; i < stripes; i++)
      parts.push(
        box(
          w,
          h,
          0.05,
          -L / 2 + w * (i + 0.5),
          y,
          0,
          i % 2 ? '#f3f3ee' : '#d4261c',
        ),
      );
  }
  for (const x of [-L / 2 + 0.12, L / 2 - 0.12]) {
    parts.push(box(0.06, 1.05, 0.06, x, 0.525, 0, '#3c3f44'));
    parts.push(box(0.06, 0.05, 0.6, x, 0.025, 0, '#3c3f44'));
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};

export const markerPost: AssetBuilder = () => {
  const parts = [
    box(0.1, 1.05, 0.1, 0, 0.52, 0, '#f4f4f0'),
    box(0.105, 0.2, 0.105, 0, 0.82, 0, '#151515'),
    box(0.06, 0.1, 0.02, 0, 0.82, 0.055, '#ff8a00'),
    box(0.06, 0.1, 0.02, 0, 0.82, -0.055, '#ff2a00'),
  ];
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};

export const chevronSign: AssetBuilder = ({ variant }) => {
  const posts = merge([
    box(0.07, 1.6, 0.07, -0.5, 0.8, -0.03, '#2a2a2a'),
    box(0.07, 1.6, 0.07, 0.5, 0.8, -0.03, '#2a2a2a'),
  ]);
  const front = new PlaneGeometry(1.3, 0.62);
  if (variant === 1) {
    const uv = front.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  }
  front.translate(0, 1.3, 0.01);
  const back = new PlaneGeometry(1.3, 0.62);
  back.rotateY(Math.PI);
  back.translate(0, 1.3, -0.01);
  // Back of the board shows a darkened corner of the texture (grey-ish).
  const buv = back.getAttribute('uv');
  for (let i = 0; i < buv.count; i++) buv.setXY(i, 0.005, 0.005);
  const board = merge([front.toNonIndexed(), back.toNonIndexed()]);
  return {
    parts: [
      { geometry: posts, material: getMaterial('props') },
      { geometry: board, material: getMaterial('chevron') },
    ],
  };
};

/** Village street lamp: galvanised pole, short arm, cobra head over the road (+Z = road side). */
export const streetLamp: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(7.5, 8.5);
  const parts: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.06, 0.1, H, lod === 0 ? 8 : 5);
  pole.translate(0, H / 2, 0);
  parts.push(cylindricalUV(paint(pole, '#a9aeb2', rng, 0.03), 0.5, 2));
  const arm = new CylinderGeometry(0.04, 0.04, 1.4, 5);
  arm.rotateX(Math.PI / 2 - 0.2);
  arm.translate(0, H + 0.1, 0.62);
  parts.push(paint(arm, '#a9aeb2'));
  parts.push(box(0.32, 0.12, 0.62, 0, H + 0.2, 1.4, '#8f9599'));
  if (lod === 0) parts.push(box(0.24, 0.03, 0.48, 0, H + 0.13, 1.4, '#f4efd8'));
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};

/**
 * City traffic signal: a grey pole with a mast arm over the road (+Z), two three-lamp heads facing +X (the traffic coming
 * from +X sees them) - one on the arm, one on the pole - and a pedestrian head. Generic, no signs.
 */
export const trafficSignal: AssetBuilder = ({ lod }) => {
  const grey = '#7d8286';
  const parts: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.09, 0.12, 6, lod === 0 ? 10 : 6);
  pole.translate(0, 3, 0);
  parts.push(cylindricalUV(paint(pole, grey), 0.5, 2));
  const arm = new CylinderGeometry(0.06, 0.08, 5, 6);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, 5.6, 2.5);
  parts.push(paint(arm, grey));
  const head = (z: number, y: number) => {
    parts.push(box(0.36, 1.05, 0.36, 0.1, y, z, '#2c3e34'));
    if (lod === 0)
      for (const [dy, c] of [
        [0.33, '#b03024'],
        [0, '#b88a20'],
        [-0.33, '#2f8a4a'],
      ] as const)
        parts.push(box(0.04, 0.22, 0.22, 0.3, y + dy, z, c));
  };
  head(4.4, 5.1);
  head(0, 3.3);
  // Pedestrian head on the pole, facing the crosswalk (+Z side).
  parts.push(box(0.32, 0.5, 0.3, 0, 2.6, 0.3, '#2c3e34'));
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};

/** Underpass wall light: back plate on the retaining wall face (z = 0), short bracket, box luminaire over the sidewalk (+Z). */
export const wallLamp: AssetBuilder = ({ lod }) => {
  const parts: BufferGeometry[] = [
    box(0.3, 0.4, 0.06, 0, 3.6, 0.03, '#8f9599'),
    box(0.06, 0.06, 0.5, 0, 3.7, 0.3, '#a9aeb2'),
    box(0.5, 0.14, 0.32, 0, 3.66, 0.62, '#8f9599'),
  ];
  if (lod === 0) parts.push(box(0.42, 0.02, 0.24, 0, 3.585, 0.62, '#f4efd8'));
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('props') }],
  };
};

/** Village name board on two posts (the board faces +Z): "Ajvatovci / Ајватовци". */
export const villageSign: AssetBuilder = () => {
  const posts = merge([
    box(0.08, 2.4, 0.08, -0.9, 1.2, 0, '#8d9096'),
    box(0.08, 2.4, 0.08, 0.9, 1.2, 0, '#8d9096'),
  ]);
  // Board: 2.1 x 0.79 m, both faces show the texture.
  const board = new PlaneGeometry(2.1, 0.79).translate(0, 2.0, 0.05);
  const back = new PlaneGeometry(2.1, 0.79)
    .rotateY(Math.PI)
    .translate(0, 2.0, 0.04);
  const bg = merge([paint(board, '#ffffff'), paint(back, '#ffffff')]);
  return {
    parts: [
      { geometry: posts, material: getMaterial('props') },
      { geometry: bg, material: getMaterial('village_sign') },
    ],
  };
};
