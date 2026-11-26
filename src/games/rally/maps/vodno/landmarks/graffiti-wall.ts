import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import type { StaticCollider } from '../../../physics/types';
import wordmarkUrl from '../../../wordmark.svg';
import type { Local, V3 } from './common';
import { turnedBoxCollider } from './common';
import {
  ATLAS_H,
  ATLAS_W,
  drawGraffiti,
  MURAL_PX,
  MURAL_Y,
  ROW5_Y,
  ROW_PX,
} from './graffiti-art';
import type { Site } from './sites';

/**
 * The concrete retaining wall on the right of the road at 296-386 m, from the drive videos: about 3 m of grey cast
 * concrete in panels, close behind the road's edge, covered in graffiti (graffiti-art.ts). Its face line runs 0.8 m past
 * the road edge (sampled every 2 m along the road), its base on the ground there.
 */
export const WALL_LINE: number[] = [
  1616.32, -942.67, 1618.22, -942.03, 1620.12, -941.39, 1622.01, -940.76,
  1623.91, -940.13, 1625.81, -939.5, 1627.71, -938.87, 1629.61, -938.24,
  1631.51, -937.61, 1633.41, -936.98, 1635.31, -936.35, 1637.2, -935.72, 1639.1,
  -935.09, 1641.0, -934.45, 1642.9, -933.81, 1644.79, -933.16, 1646.68, -932.5,
  1648.57, -931.83, 1650.46, -931.15, 1652.35, -930.48, 1654.23, -929.8,
  1656.12, -929.12, 1658.0, -928.43, 1659.89, -927.75, 1661.77, -927.07,
  1663.65, -926.38, 1665.53, -925.69, 1667.41, -925.0, 1669.28, -924.29,
  1671.13, -923.53, 1672.97, -922.73, 1674.79, -921.89, 1676.59, -921.0,
  1678.36, -920.07, 1680.11, -919.09, 1681.82, -918.06, 1683.5, -916.98,
  1685.13, -915.85, 1686.72, -914.68, 1688.27, -913.46, 1689.77, -912.19,
  1691.22, -910.88, 1692.62, -909.53, 1693.96, -908.13, 1695.25, -906.69,
];

const HEIGHT = 2.9;
const THICK = 0.35;
const FOOT = 0.4;
const CONCRETE = '#e6ddcc';

const pts = (): [number, number][] =>
  Array.from({ length: WALL_LINE.length / 2 }, (_, i) => [
    WALL_LINE[2 * i],
    WALL_LINE[2 * i + 1],
  ]);

/** Unit normal away from the road at point i (the road is on the wall line's left). */
function awayAt(p: [number, number][], i: number): [number, number] {
  const a = p[Math.max(0, i - 1)];
  const b = p[Math.min(p.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

/** The wall in 10 m stretches: a site at each stretch's start, x along it, +z away from the road. */
export function wallStretches(): { site: Site; len: number }[] {
  const p = pts();
  const out: { site: Site; len: number }[] = [];
  for (let i = 0; i + 1 < p.length; i += 5) {
    const j = Math.min(p.length - 1, i + 5);
    const dx = p[j][0] - p[i][0];
    const dz = p[j][1] - p[i][1];
    out.push({
      site: { x: p[i][0], z: p[i][1], yaw: Math.atan2(dz, dx) },
      len: Math.hypot(dx, dz),
    });
  }
  return out;
}

/** Thin boxes along the wall, one per 4 m of its line (the line bends with the road). */
export function graffitiWallColliders(
  ground: (x: number, z: number) => number,
): StaticCollider[] {
  const p = pts();
  const out: StaticCollider[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const j = Math.min(p.length - 1, i + 2);
    const dx = p[j][0] - p[i][0];
    const dz = p[j][1] - p[i][1];
    const len = Math.hypot(dx, dz);
    const site: Site = { x: p[i][0], z: p[i][1], yaw: Math.atan2(dz, dx) };
    out.push(
      turnedBoxCollider(
        site,
        len / 2,
        THICK / 2,
        0,
        len / 2,
        THICK / 2,
        Math.min(ground(p[i][0], p[i][1]), ground(p[j][0], p[j][1])) - FOOT,
        HEIGHT + FOOT + 1,
      ),
    );
  }
  return out;
}

/** The wall's own frame: its first point, unturned (the wall is drawn from world points). */
export const WALL_SITE: Site = { x: WALL_LINE[0], z: WALL_LINE[1], yaw: 0 };

/** The concrete: face, top and back between the line's points, the ends closed, a panel joint every 4 m. */
export function buildGraffitiWall(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const p = pts();
  const at = (x: number, z: number, dy: number): V3 => [
    x - l.site.x,
    ground(x, z) - l.baseY + dy,
    z - l.site.z,
  ];
  const back = (i: number): [number, number] => {
    const [nx, nz] = awayAt(p, i);
    return [p[i][0] + nx * THICK, p[i][1] + nz * THICK];
  };
  let s = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [a, b] = [p[i], p[i + 1]];
    const [ba, bb] = [back(i), back(i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, nz] = awayAt(p, i);
    const uv = (q: V3): [number, number] => [
      s + Math.hypot(q[0] + l.site.x - a[0], q[2] + l.site.z - a[1]),
      q[1],
    ];
    // Face (to the road), top, back.
    l.fan(
      'wall',
      [
        at(a[0], a[1], -FOOT),
        at(b[0], b[1], -FOOT),
        at(b[0], b[1], HEIGHT),
        at(a[0], a[1], HEIGHT),
      ],
      CONCRETE,
      [-nx, 0, -nz],
      uv,
    );
    l.fan(
      'wall',
      [
        at(a[0], a[1], HEIGHT),
        at(b[0], b[1], HEIGHT),
        [bb[0] - l.site.x, at(b[0], b[1], HEIGHT)[1], bb[1] - l.site.z],
        [ba[0] - l.site.x, at(a[0], a[1], HEIGHT)[1], ba[1] - l.site.z],
      ],
      CONCRETE,
      [0, 1, 0],
      (q) => [q[0], q[2]],
    );
    l.fan(
      'wall',
      [
        [ba[0] - l.site.x, at(a[0], a[1], -FOOT)[1], ba[1] - l.site.z],
        [bb[0] - l.site.x, at(b[0], b[1], -FOOT)[1], bb[1] - l.site.z],
        [bb[0] - l.site.x, at(b[0], b[1], HEIGHT)[1], bb[1] - l.site.z],
        [ba[0] - l.site.x, at(a[0], a[1], HEIGHT)[1], ba[1] - l.site.z],
      ],
      CONCRETE,
      [nx, 0, nz],
      uv,
    );
    // Joints between the cast panels: a dark line down the face every other point (4 m).
    if (i % 2 === 0 && i > 0) {
      const o = 0.012;
      const [x0, z0] = [a[0] - nx * o, a[1] - nz * o];
      const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      l.fan(
        'paint',
        [
          at(x0 - t[0] * 0.02, z0 - t[1] * 0.02, -FOOT),
          at(x0 + t[0] * 0.02, z0 + t[1] * 0.02, -FOOT),
          at(x0 + t[0] * 0.02, z0 + t[1] * 0.02, HEIGHT),
          at(x0 - t[0] * 0.02, z0 - t[1] * 0.02, HEIGHT),
        ],
        '#6f6c66',
        [-nx, 0, -nz],
        (q) => [q[0], q[1]],
      );
    }
    s += len;
  }
  for (const i of [0, p.length - 1]) {
    const bk = back(i);
    const [nx, nz] = awayAt(p, i);
    const tside = i === 0 ? -1 : 1;
    l.fan(
      'wall',
      [
        at(p[i][0], p[i][1], -FOOT),
        [bk[0] - l.site.x, at(p[i][0], p[i][1], -FOOT)[1], bk[1] - l.site.z],
        [bk[0] - l.site.x, at(p[i][0], p[i][1], HEIGHT)[1], bk[1] - l.site.z],
        at(p[i][0], p[i][1], HEIGHT),
      ],
      CONCRETE,
      [tside * nz, 0, -tside * nx],
      (q) => [q[0] + q[2], q[1]],
    );
  }
}

/**
 * Where the pieces go: the atlas row (0 at its top, 4 = the mural, 5 = the row under it) and the span u0..u1 m of it (12 m a row), painted
 * from `s` m along the wall, their bottom `y` m over its foot, at `k` times the atlas size (smaller repeats fill the gaps
 * between the big pieces, the way tags pile up on a real wall).
 */
const PIECES: {
  row: number;
  u0: number;
  u1: number;
  s: number;
  y: number;
  k?: number;
}[] = [
  { row: 0, u0: 0.3, u1: 11.7, s: 3, y: 0.7 },
  { row: 1, u0: 0.3, u1: 5.8, s: 18, y: 0.8 },
  { row: 3, u0: 6.0, u1: 11.9, s: 24, y: 0.4, k: 0.6 },
  { row: 2, u0: 0.6, u1: 11.4, s: 28, y: 0.6 },
  { row: 4, u0: 0.05, u1: 11.95, s: 43.2, y: 0.2, k: 0.82 },
  { row: 3, u0: 0.4, u1: 5.6, s: 56, y: 0.5 },
  { row: 5, u0: 1.0, u1: 5.0, s: 62.4, y: 0.6, k: 1.15 },
  { row: 3, u0: 6.0, u1: 11.9, s: 68, y: 0.9 },
  { row: 1, u0: 6.1, u1: 11.9, s: 74.6, y: 0.7 },
  { row: 3, u0: 6.0, u1: 11.9, s: 80.6, y: 1.5, k: 0.55 },
  { row: 1, u0: 0.3, u1: 5.8, s: 83.8, y: 0.5, k: 0.45 },
];
/** Atlas metres: 12 m across its width, the same scale down. */
const PX_M = ATLAS_W / 12;
const ATLAS_M = 12;

let texture: CanvasTexture | undefined;

/** The atlas texture: drawn now without the wordmark, again once it has loaded. */
function graffitiTexture(): CanvasTexture {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const LOGO_ASPECT = 5237 / 1020; // wordmark.svg viewBox
  drawGraffiti(ctx, null, LOGO_ASPECT);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  const img = new Image();
  img.onload = () => {
    drawGraffiti(ctx, img, LOGO_ASPECT);
    t.needsUpdate = true;
  };
  img.src = wordmarkUrl;
  texture = t;
  return t;
}

/** The paint over the wall's face: one strip of quads per piece, following the wall and its foot. */
export function graffitiMesh(ground: (x: number, z: number) => number): Mesh {
  const p = pts();
  const cum = [0];
  for (let i = 1; i < p.length; i++)
    cum.push(
      cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]),
    );
  /** The face point `s` m along (pushed 2 cm towards the road). */
  const along = (s: number): [number, number] => {
    let i = 0;
    while (i + 2 < p.length && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / (cum[i + 1] - cum[i]);
    const [nx, nz] = awayAt(p, i);
    return [
      p[i][0] + (p[i + 1][0] - p[i][0]) * t - nx * 0.02,
      p[i][1] + (p[i + 1][1] - p[i][1]) * t - nz * 0.02,
    ];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  for (const pc of PIECES) {
    const k = pc.k ?? 1;
    const len = (pc.u1 - pc.u0) * k;
    const [top, tall] =
      pc.row < 4
        ? [pc.row * ROW_PX, ROW_PX]
        : pc.row === 4
          ? [MURAL_Y, MURAL_PX]
          : [ROW5_Y, ROW_PX];
    const h = (tall / PX_M) * k;
    const n = Math.ceil(len / 1);
    for (let i = 0; i < n; i++) {
      const s0 = pc.s + (len * i) / n;
      const s1 = pc.s + (len * (i + 1)) / n;
      const [ax, az] = along(s0);
      const [bx, bz] = along(s1);
      const ya = ground(ax, az) + pc.y;
      const yb = ground(bx, bz) + pc.y;
      // Seen from the road the wall runs from right to left: the piece's start is at its far end.
      const ua = (pc.u1 - (s0 - pc.s) / k) / ATLAS_M;
      const ub = (pc.u1 - (s1 - pc.s) / k) / ATLAS_M;
      const va = 1 - (top + tall) / ATLAS_H;
      const vb = 1 - top / ATLAS_H;
      // Two triangles facing the road (the wall line's left).
      const quad: [number, number, number, number, number][] = [
        [ax, ya, az, ua, va],
        [bx, yb, bz, ub, va],
        [bx, yb + h, bz, ub, vb],
        [ax, ya + h, az, ua, vb],
      ];
      for (const idx of [0, 2, 1, 0, 3, 2]) {
        const q = quad[idx];
        pos.push(q[0], q[1], q[2]);
        uv.push(q[3], q[4]);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: typeof document === 'undefined' ? null : graffitiTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
  );
  m.name = 'vodno graffiti';
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}
