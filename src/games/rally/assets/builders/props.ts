import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  BufferGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  PlaneGeometry,
  Vector2,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { cylindricalUV, merge, paint, planarUV, shade } from '../../engine/geo';
import { GROUND_SCAN } from '../../engine/ground-textures';
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

/**
 * Round straw bale (1.2 m wide, ~1.3 m across) lying on its side: a lathe with rounded rim edges and slightly domed
 * ends that show the rolled layers, on the straw material (the stubble scan at its real scale).
 */
export const hayBale: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const r = rng.range(0.6, 0.7);
  const hw = 0.6;
  const e = 0.09; // rim rounding
  // Profile (radius, axial position) from the centre of one end, over the rim, along the barrel to the other end.
  const prof: [number, number][] = [];
  const rings = lod === 0 ? 3 : 1;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    prof.push([t * (r - e), -hw - 0.02 * (1 - t * t)]);
  }
  const arc = lod === 0 ? 2 : 1;
  for (let i = 1; i <= arc; i++) {
    const a = (i / (arc + 1)) * (Math.PI / 2);
    prof.push([r - e + Math.sin(a) * e, -hw + e - Math.cos(a) * e]);
  }
  const mid = prof.length;
  for (let i = mid - 1; i >= 0; i--) prof.push([prof[i][0], -prof[i][1]]);
  prof.splice(mid, 0, [r, -hw + e], [r, hw - e]);
  const segs = lod === 0 ? 16 : 10;
  const g = new LatheGeometry(
    prof.map(([x, y]) => new Vector2(Math.max(x, 1e-4), y)),
    segs,
  );
  // Straw at its real size: u around the bale (metres / 2 m scan), v along the profile.
  const uv = g.getAttribute('uv');
  let len = 0;
  const along = prof.map((pt, i) => {
    if (i) len += Math.hypot(pt[0] - prof[i - 1][0], pt[1] - prof[i - 1][1]);
    return len;
  });
  for (let i = 0; i < uv.count; i++) {
    const ring = Math.floor(i / prof.length);
    const k = i % prof.length;
    uv.setXY(
      i,
      ((ring / segs) * Math.PI * 2 * r) / GROUND_SCAN.stubble,
      along[k] / GROUND_SCAN.stubble,
    );
  }
  g.rotateZ(Math.PI / 2);
  g.translate(0, r, 0);
  const p = paint(g, '#d9b65e', rng, 0.05);
  // Rolled layers on the ends (rings of light and dark straw), darker underside.
  shade(p, (x, y, z) => {
    const end = Math.abs(x) > hw - 0.01;
    const rr = Math.hypot(y - r, z) / r;
    const layers = end
      ? 0.9 + 0.1 * Math.cos(Math.PI * Math.round((rr * rings * r) / (r - e)))
      : 1;
    return layers * (0.72 + 0.28 * Math.min(1, y / r));
  });
  return { parts: [{ geometry: p, material: getMaterial('hay') }] };
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
  // Hangs in a shallow curve from post to post: lowest (8 cm) half way to the next post, where this stub meets the
  // next post's stub level and flat, so the line runs on without a kink.
  const tp = tape.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const u = Math.abs(tp.getX(i)) / 2.6;
    tp.setY(i, tp.getY(i) + 0.92 - 0.08 * u * (2 - u));
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
 * Fan flag on a pole stuck in the ground (2.3-2.9 m): a rippled cloth in saturated colours, flying along +X (in the game
 * it turns downwind and flutters: the `fan_flag` material).
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
      { geometry: paint(pole, '#d8d8d4'), material: getMaterial('props') },
      { geometry: merge(twoSided(front)), material: getMaterial('fan_flag') },
    ],
  };
};

/**
 * Flagpole with the flag of North Macedonia (a national flag on a 11 m mast, as on the Sredno Vodno car park): the yellow
 * eight-ray sun on red, 2:1, flying along +X. The cloth carries the printed flag (the `flag_mk` texture, official geometry
 * drawn in `engine/textures.ts`), so it ripples as one surface: a separate sun laid over it tore where the wind shader's
 * ripples out-ran the vertex spacing. It is its own part (the `flag` material): in the game it turns downwind and flutters
 * with the wind the foliage sways in.
 */
export const flagpole: AssetBuilder = ({ lod }) => {
  const H = 11;
  const W = 3.6;
  const FH = W / 2;
  const pole = new CylinderGeometry(0.06, 0.1, H, lod === 0 ? 8 : 4);
  pole.translate(0, H / 2, 0);
  const ball = new IcosahedronGeometry(0.11, 0);
  ball.translate(0, H + 0.1, 0);
  const cloth = paint(
    new PlaneGeometry(W, FH, lod === 0 ? 48 : 16, lod === 0 ? 24 : 8),
    '#ffffff',
  );
  const phase = 0.6;
  const p = cloth.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / W + 0.5;
    p.setXYZ(
      i,
      u * W + 0.06,
      p.getY(i) + H - FH / 2 - 0.2 - u * u * 0.15,
      Math.sin(u * 6 + phase) * 0.14 * u,
    );
  }
  return {
    parts: [
      {
        geometry: merge([paint(pole, '#d8d8d4'), paint(ball, '#c9a227')]),
        material: getMaterial('props'),
      },
      { geometry: merge(twoSided(cloth)), material: getMaterial('flag') },
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

/**
 * Road-edge delineator: a white post 1.05 m tall with a rounded-triangle section (apex towards the road, local -X),
 * a top cut sloping down to the road, a black band under it and a reflector set into the band on each sloping face.
 * Placed along the road (scatter.ts `alongRoad`), so the faces look up and down the road.
 */
const POST_PROFILE: [number, number][] = (() => {
  // Corners of the triangle (x across the road, z along it) and their rounding radius.
  const corners: [number, number][] = [
    [-0.07, 0],
    [0.05, 0.055],
    [0.05, -0.055],
  ];
  const r = 0.014;
  const out: [number, number][] = [];
  corners.forEach(([cx, cz], i) => {
    const [px, pz] = corners[(i + 2) % 3];
    const [nx, nz] = corners[(i + 1) % 3];
    // Pull the corner in along both edges and round it with three points.
    const a = Math.atan2(pz - cz, px - cx);
    const b = Math.atan2(nz - cz, nx - cx);
    const pa: [number, number] = [
      cx + Math.cos(a) * r * 1.6,
      cz + Math.sin(a) * r * 1.6,
    ];
    const pb: [number, number] = [
      cx + Math.cos(b) * r * 1.6,
      cz + Math.sin(b) * r * 1.6,
    ];
    const mid: [number, number] = [
      ((pa[0] + pb[0]) / 2) * 0.6 + cx * 0.4,
      ((pa[1] + pb[1]) / 2) * 0.6 + cz * 0.4,
    ];
    out.push(pa, mid, pb);
  });
  return out;
})();

export const markerPost: AssetBuilder = () => {
  const top = (x: number) => 1.0 + (x + 0.07) * 0.42; // 1.0 m at the road side, 1.05 m at the back
  // Heights of the ring bands: white shaft, black band (20 cm under the top), white cap strip.
  const bands: [(x: number) => number, (x: number) => number, string][] = [
    [() => 0, (x) => top(x) - 0.25, '#f4f4f0'],
    [(x) => top(x) - 0.25, (x) => top(x) - 0.04, '#151515'],
    [(x) => top(x) - 0.04, top, '#f4f4f0'],
  ];
  const n = POST_PROFILE.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const normalAt = (i: number): [number, number] => {
    // Smooth normal: average of the two edge normals at a profile point (profile runs clockwise seen from above).
    const [x0, z0] = POST_PROFILE[(i + n - 1) % n];
    const [x1, z1] = POST_PROFILE[i];
    const [x2, z2] = POST_PROFILE[(i + 1) % n];
    const e1 = [z1 - z0, -(x1 - x0)];
    const e2 = [z2 - z1, -(x2 - x1)];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const nx = e1[0] / l1 + e2[0] / l2;
    const nz = e1[1] / l1 + e2[1] / l2;
    const l = Math.hypot(nx, nz) || 1;
    return [nx / l, nz / l];
  };
  // Outward sign: the centroid must sit on the inner side of the first edge.
  const [ax, az] = POST_PROFILE[0];
  const [bx, bz] = POST_PROFILE[1];
  const flip = (bz - az) * (0 - ax) - (bx - ax) * (0 - az) > 0 ? -1 : 1;
  for (const [lo, hi, hex] of bands) {
    const c = new Color(hex);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, z0] = POST_PROFILE[i];
      const [x1, z1] = POST_PROFILE[j];
      const n0 = normalAt(i).map((v) => v * flip);
      const n1 = normalAt(j).map((v) => v * flip);
      const v = [
        [x0, lo(x0), z0, n0],
        [x1, lo(x1), z1, n1],
        [x1, hi(x1), z1, n1],
        [x0, hi(x0), z0, n0],
      ] as [number, number, number, number[]][];
      const quad = flip > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const k of quad) {
        const [x, y, z, nn] = v[k];
        pos.push(x, y, z);
        nor.push(nn[0], 0, nn[1]);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  // Sloping top cap (fan), facing up.
  const capC = new Color('#e8e8e4');
  for (let i = 1; i < n - 1; i++) {
    const tri = flip > 0 ? [0, i + 1, i] : [0, i, i + 1];
    for (const k of tri) {
      const [x, z] = POST_PROFILE[k];
      pos.push(x, top(x), z);
      nor.push(-0.39, 0.92, 0);
      col.push(capC.r, capC.g, capC.b);
    }
  }
  const post = new BufferGeometry();
  post.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  post.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  post.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  post.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  planarUV(post, 1.3);
  // Reflectors: set into the black band on the two sloping faces (their own material, so they light up in the car's
  // low beam at night). Amber faces +Z, red faces -Z.
  const reflector = (side: 1 | -1, hex: string) => {
    const [x0, z0] = [-0.07, 0];
    const [x1, z1] = [0.05, 0.055 * side];
    const g = new BoxGeometry(0.045, 0.1, 0.006);
    // Face normal of the sloping face, pointing out (away from the post's centre).
    const fx = -(z1 - z0) * side;
    const fz = (x1 - x0) * side;
    const fl = Math.hypot(fx, fz);
    g.rotateY(Math.atan2(fx, fz));
    g.translate(
      (x0 + x1) / 2 + (fx / fl) * 0.001,
      top(0) - 0.145,
      (z0 + z1) / 2 + (fz / fl) * 0.001,
    );
    return planarUV(paint(g, hex), 1.3);
  };
  return {
    parts: [
      { geometry: post, material: getMaterial('props') },
      {
        geometry: merge([reflector(1, '#ff8a00'), reflector(-1, '#ff2a00')]),
        material: getMaterial('reflector'),
      },
    ],
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
  // The lens glows at night (its own material, also on the far LOD: a village's lamps show from afar).
  const lens = box(0.24, 0.03, 0.48, 0, H + 0.13, 1.4, '#ffdc9a');
  return {
    parts: [
      { geometry: merge(parts), material: getMaterial('props') },
      { geometry: lens, material: getMaterial('lamp_lens') },
    ],
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

/** Maps a plane's UVs into the texture's top (v0 = 0.5) or bottom (v0 = 0) half. */
function halfUv(g: BufferGeometry, v0: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * 0.5);
}

/** Village name board on two posts (front faces +Z): "Ajvatovci / Ајватовци"; the back plate has the red slash. */
export const villageSign: AssetBuilder = () => {
  const posts = merge([
    box(0.08, 2.4, 0.08, -0.9, 1.2, 0, '#8d9096'),
    box(0.08, 2.4, 0.08, 0.9, 1.2, 0, '#8d9096'),
  ]);
  // Board: 2.1 x 0.79 m, two plates. The front shows the name; the back (seen when leaving)
  // shows it struck through with a red slash. The texture holds the front in its top half,
  // the back in its bottom half.
  const board = new PlaneGeometry(2.1, 0.79).translate(0, 2.0, 0.05);
  const back = new PlaneGeometry(2.1, 0.79)
    .rotateY(Math.PI)
    .translate(0, 2.0, -0.05);
  halfUv(board, 0.5);
  halfUv(back, 0);
  const bg = merge([paint(board, '#ffffff'), paint(back, '#ffffff')]);
  return {
    parts: [
      { geometry: posts, material: getMaterial('props') },
      { geometry: bg, material: getMaterial('village_sign') },
    ],
  };
};
