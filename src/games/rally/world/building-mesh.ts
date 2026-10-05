import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import { hash3 } from '../../../shared/rng';
import { getTexture } from '../engine/textures';
import type { FacadeId } from '../engine/facade-textures';
import type { BuildingDef } from '../maps/shared/types';
import type { World } from './world';

/**
 * Mesh buildings (BuildingDef.kind set - real-world maps whose footprints carry OSM heights):
 * the real footprint outline extruded to the real height, a facade texture tinted per building
 * (windows repeat every 3.2 m x 3.2 m floor), flat roofs with a parapet + rooftop clutter (stair
 * bulkheads, NYC water tanks) or pitched gable roofs on houses / churches / tombs.
 *
 * Merged per 128 m tile and facade style, so a whole district costs a few dozen draw calls.
 * Colliders are the footprint boxes (world.ts); the scatter keeps trees out via BuildingIndex.
 */

const TILE = 192;
const BAY = 3.2;
const PARAPET = 0.6;

const FACADE: Record<NonNullable<BuildingDef['kind']>, FacadeId> = {
  house: 'facade_stucco',
  row: 'facade_brick',
  apartment: 'facade_concrete',
  commercial: 'facade_commercial',
  industrial: 'facade_industrial',
  garage: 'facade_garage',
  church: 'facade_stone',
  tomb: 'facade_plainstone',
};

const BRICK = [
  '#b5654a',
  '#a0523a',
  '#c27b5a',
  '#8e4632',
  '#b8704f',
  '#9d5b43',
  '#c58d6a',
  '#7f4a3a',
];
const TAN = ['#d8c29a', '#cdb48a', '#e0d0b0', '#c9b896', '#d9c7a3'];
const SIDING = [
  '#e9e3d3',
  '#d7cfb8',
  '#c5d0c8',
  '#d9b9a6',
  '#e2d8c0',
  '#bfc9d6',
];
const CONCRETE = ['#c9c5bb', '#d8cfb9', '#bdb7a8', '#cfa97e', '#a97d62'];
const COMMERCIAL = ['#d2d0c8', '#c8ccd0', '#d6cfc0', '#b9bfc4'];
const STONE = ['#c9c5bb', '#bcb8ae', '#d0ccc2'];
const PALETTE: Record<NonNullable<BuildingDef['kind']>, string[]> = {
  house: [...SIDING, ...SIDING, ...BRICK.slice(0, 4)],
  row: [...BRICK, ...BRICK, ...TAN],
  apartment: [...BRICK, ...TAN, ...CONCRETE],
  commercial: COMMERCIAL,
  industrial: COMMERCIAL,
  garage: CONCRETE,
  church: [...STONE, '#a9694f'],
  tomb: STONE,
};
const FLAT_ROOF = ['#585a5b', '#666664', '#4b4d50', '#70706c'];
const GABLE_ROOF = ['#6a5a52', '#7a4a3a', '#555a60', '#8a6a52', '#4f4a48'];
const EXTRA = '#8a8780';

interface Acc {
  pos: number[];
  nor: number[];
  col: number[];
  uv: number[];
  idx: number[];
}
const newAcc = (): Acc => ({ pos: [], nor: [], col: [], uv: [], idx: [] });

const _c = new Color();
function rgb(hex: string, k = 1): [number, number, number] {
  _c.set(hex);
  return [_c.r * k, _c.g * k, _c.b * k];
}

function tri(
  a: Acc,
  p: [number, number, number][],
  n: [number, number, number],
  c: [number, number, number][],
  uv?: [number, number][],
): void {
  const v0 = a.pos.length / 3;
  p.forEach((q, i) => {
    a.pos.push(...q);
    a.nor.push(...n);
    a.col.push(...c[i]);
    a.uv.push(...(uv ? uv[i] : [0, 0]));
  });
  for (let i = 0; i < p.length - 2; i++) a.idx.push(v0, v0 + i + 1, v0 + i + 2);
}

/** Facade wall quad a-b-c-d (outward normal (nx, nz)); bottom edge darker (fake AO). */
function wall(
  a: Acc,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  yb: number,
  yt: number,
  bays: number,
  floors: number,
  tint: string,
): void {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const nx = -(z1 - z0) / len;
  const nz = (x1 - x0) / len;
  const lo = rgb(tint, 0.74);
  const hi = rgb(tint, 1);
  tri(
    a,
    [
      [x0, yb, z0],
      [x1, yb, z1],
      [x1, yt, z1],
      [x0, yt, z0],
    ],
    [nx, 0, nz],
    [lo, lo, hi, hi],
    [
      [0, 0],
      [bays, 0],
      [bays, floors],
      [0, floors],
    ],
  );
}

/** Ring orientation: negative area (see wall(): outward normal (-dz, dx)). */
function signedArea(r: number[][]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % r.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

function footprint(b: BuildingDef): number[][] {
  const ring: number[][] = [];
  if (b.poly && b.poly.length >= 6) {
    for (let i = 0; i < b.poly.length; i += 2)
      ring.push([b.x + b.poly[i], b.z + b.poly[i + 1]]);
  } else {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      ring.push([
        b.x + (u * b.w * ca) / 2 - (v * b.d * sa) / 2,
        b.z + (u * b.w * sa) / 2 + (v * b.d * ca) / 2,
      ]);
  }
  if (signedArea(ring) > 0) ring.reverse();
  return ring;
}

const pick = (list: string[], h: number): string => list[h % list.length];

export function* buildingMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const list = world.buildings.buildings.filter((b) => b.kind);
  if (!list.length) return undefined;
  const tiles = new Map<string, { walls: Map<FacadeId, Acc>; roof: Acc }>();
  const ground = world.analytic;
  let n = 0;
  for (const b of list) {
    const kind = b.kind!;
    const h = hash3(b.id, 5, 11, world.map.seed) >>> 0;
    const ring = footprint(b);
    let lo = ground.height(b.x, b.z);
    let hi = lo;
    for (const [x, z] of ring) {
      const g = ground.height(x, z);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    const yb = lo - 0.25;
    const yw = hi + b.h; // eaves / flat roof level
    const tk = `${Math.floor(b.x / TILE)},${Math.floor(b.z / TILE)}`;
    let tile = tiles.get(tk);
    if (!tile) tiles.set(tk, (tile = { walls: new Map(), roof: newAcc() }));
    // Tall slab blocks read as glass-and-concrete towers.
    const style: FacadeId =
      kind === 'apartment' && b.h > 30 && h % 3 === 0
        ? 'facade_commercial'
        : FACADE[kind];
    let acc = tile.walls.get(style);
    if (!acc) tile.walls.set(style, (acc = newAcc()));
    const tint = pick(PALETTE[kind], h >>> 4);
    const floors = Math.max(1, b.floors);
    const gable = b.roof === 'gable' && !b.poly;
    const flatTop = yw - (gable ? 0 : PARAPET);
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i];
      const [x1, z1] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      // Floors stay 3 m high on sloping ground (the wall also reaches down to the lowest corner).
      const v = ((yw - yb) * floors) / b.h;
      wall(
        acc,
        x0,
        z0,
        x1,
        z1,
        yb,
        yw,
        Math.max(1, Math.round(len / BAY)),
        v,
        tint,
      );
    }
    const roof = tile.roof;
    if (gable) {
      // Ridge along the long side; gable walls plain, roof planes with a small overhang.
      const rise = b.h * 0.351;
      const ca = Math.cos(b.angle);
      const sa = Math.sin(b.angle);
      const P = (u: number, v: number, y: number): [number, number, number] => [
        b.x + u * ca - v * sa,
        y,
        b.z + u * sa + v * ca,
      ];
      const U = b.w / 2 + 0.3;
      const V = b.d / 2 + 0.3;
      const yE = yw - 0.12;
      const yR = yw + rise;
      const rc = rgb(pick(GABLE_ROOF, h >>> 9));
      const rc2 = rgb(pick(GABLE_ROOF, h >>> 9), 0.82);
      for (const side of [1, -1]) {
        const a = P(-U, side * V, yE);
        const bb = P(U, side * V, yE);
        const c = P(U, 0, yR);
        const d = P(-U, 0, yR);
        const e1 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nn: [number, number, number] = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const l = Math.hypot(...nn) || 1;
        nn = [nn[0] / l, nn[1] / l, nn[2] / l];
        const flip = nn[1] < 0;
        if (flip) nn = [-nn[0], -nn[1], -nn[2]];
        const col = side > 0 ? rc : rc2;
        const quad = flip ? [a, d, c, bb] : [a, bb, c, d];
        tri(roof, quad, nn, [col, col, col, col]);
      }
      // Gable end triangles (wall colour).
      const wc = rgb(tint, 0.9);
      for (const end of [-1, 1]) {
        const a = P((end * b.w) / 2, -b.d / 2, yw);
        const bb = P((end * b.w) / 2, b.d / 2, yw);
        const c = P((end * b.w) / 2, 0, yR);
        const nx = end * ca;
        const nz = end * sa;
        // Wind so the outward side faces the camera (+/- end).
        const pts = end > 0 ? [bb, a, c] : [a, bb, c];
        tri(roof, pts, [nx, 0, nz], [wc, wc, wc]);
      }
    } else {
      // Flat roof (polygon) a parapet below the wall tops.
      const rcol = rgb(pick(FLAT_ROOF, h >>> 9));
      const contour = ring.map(([x, z]) => new Vector2(x, z));
      const faces = ShapeUtils.triangulateShape(contour, []);
      for (const f of faces) {
        const [a, bb, c] = f.map((i) => ring[i]);
        const ny =
          (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
        // y component of (b - a) x (c - a) in x-z: positive -> facing down.
        const order = ny > 0 ? [f[0], f[2], f[1]] : f;
        tri(
          roof,
          order.map(
            (i) =>
              [ring[i][0], flatTop, ring[i][1]] as [number, number, number],
          ),
          [0, 1, 0],
          [rcol, rcol, rcol],
        );
      }
      // Parapet inner faces.
      const pc = rgb(EXTRA, 0.8);
      for (let i = 0; i < ring.length; i++) {
        const [x0, z0] = ring[i];
        const [x1, z1] = ring[(i + 1) % ring.length];
        const len = Math.hypot(x1 - x0, z1 - z0) || 1;
        const nx = (z1 - z0) / len;
        const nz = -(x1 - x0) / len;
        tri(
          roof,
          [
            [x1, flatTop, z1],
            [x0, flatTop, z0],
            [x0, yw, z0],
            [x1, yw, z1],
          ],
          [nx, 0, nz],
          [pc, pc, pc, pc],
        );
        // Coping on top.
        tri(
          roof,
          [
            [x0, yw + 0.001, z0],
            [x1, yw + 0.001, z1],
            [x1 + nx * 0.25, yw + 0.001, z1 + nz * 0.25],
            [x0 + nx * 0.25, yw + 0.001, z0 + nz * 0.25],
          ],
          [0, 1, 0],
          [pc, pc, pc, pc],
        ); // fmt: skip
      }
      // Rooftop clutter: stair bulkhead on mid-rises, a wooden water tank on tall row / apartment roofs.
      if (b.w * b.d > 60 && b.h > 8) {
        const ca = Math.cos(b.angle);
        const sa = Math.sin(b.angle);
        const ox = ((h & 15) / 15 - 0.5) * b.w * 0.4;
        const oz = (((h >> 4) & 15) / 15 - 0.5) * b.d * 0.4;
        const cx = b.x + ox * ca - oz * sa;
        const cz = b.z + ox * sa + oz * ca;
        box(
          roof,
          cx,
          cz,
          1.3,
          1.3,
          flatTop,
          flatTop + 2.4,
          b.angle,
          rgb(EXTRA, 1.05),
        );
        if (
          (kind === 'row' || kind === 'apartment') &&
          b.h > 9 &&
          (h >> 9) % 2 === 0
        ) {
          const tx = b.x - ox * ca * 1.2 + oz * sa;
          const tz = b.z - ox * sa * 1.2 - oz * ca;
          // Four legs + cylinder (octagon) + cone cap.
          for (const [lx, lz] of [
            [-0.9, -0.9],
            [0.9, -0.9],
            [0.9, 0.9],
            [-0.9, 0.9],
          ])
            box(
              roof,
              tx + lx * ca - lz * sa,
              tz + lx * sa + lz * ca,
              0.12,
              0.12,
              flatTop,
              flatTop + 1.8,
              b.angle,
              rgb('#5d5148'),
            ); // fmt: skip
          cyl(roof, tx, tz, 1.4, flatTop + 1.8, flatTop + 4.0, rgb('#7b5e43'));
          cone(roof, tx, tz, 1.5, flatTop + 4.0, flatTop + 4.9, rgb('#4d4038'));
        }
      }
    }
    if (++n % 120 === 0) yield;
  }
  const group = new Group();
  group.name = 'buildings';
  const roofMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  });
  const mats = new Map<FacadeId, MeshStandardMaterial>();
  const wallMat = (id: FacadeId) => {
    let m = mats.get(id);
    if (!m)
      mats.set(
        id,
        (m = new MeshStandardMaterial({
          map: getTexture(id),
          vertexColors: true,
          roughness: 0.9,
          metalness: 0,
        })),
      );
    return m;
  };
  for (const tile of tiles.values()) {
    for (const [id, acc] of tile.walls) group.add(toMesh(acc, wallMat(id)));
    if (tile.roof.idx.length) group.add(toMesh(tile.roof, roofMat));
    yield;
  }
  return group;
}

function toMesh(a: Acc, mat: MeshStandardMaterial): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(a.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(a.nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(a.col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(a.uv), 2));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  const m = new Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** Axis-aligned box (rotated about Y by `angle` like the footprints) as plain coloured faces. */
function box(
  a: Acc,
  cx: number,
  cz: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
  angle: number,
  c: [number, number, number],
): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const P = (u: number, v: number, y: number): [number, number, number] => [
    cx + u * ca - v * sa,
    y,
    cz + u * sa + v * ca,
  ];
  const hw = w / 2;
  const hd = d / 2;
  // Four sides (outward), then the top.
  const corners: [number, number][] = [
    [-hw, -hd],
    [-hw, hd],
    [hw, hd],
    [hw, -hd],
  ];
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = corners[i];
    const [u1, v1] = corners[(i + 1) % 4];
    const p0 = P(u0, v0, y0);
    const p1 = P(u1, v1, y0);
    const e = [p1[0] - p0[0], p1[2] - p0[2]];
    const l = Math.hypot(e[0], e[1]) || 1;
    tri(
      a,
      [p0, p1, P(u1, v1, y1), P(u0, v0, y1)],
      [-e[1] / l, 0, e[0] / l],
      [c, c, c, c],
    );
  }
  tri(
    a,
    [P(-hw, -hd, y1), P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1)],
    [0, 1, 0],
    [c, c, c, c],
  );
}

function ring8(
  cx: number,
  cz: number,
  r: number,
  y: number,
): [number, number, number][] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2;
    return [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r] as [
      number,
      number,
      number,
    ];
  });
}

function cyl(
  a: Acc,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
  c: [number, number, number],
): void {
  const lo = ring8(cx, cz, r, y0);
  const hi = ring8(cx, cz, r, y1);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const nx = Math.cos(((i + 0.5) / 8) * Math.PI * 2);
    const nz = Math.sin(((i + 0.5) / 8) * Math.PI * 2);
    tri(a, [lo[j], lo[i], hi[i], hi[j]], [nx, 0, nz], [c, c, c, c]);
  }
}

function cone(
  a: Acc,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
  c: [number, number, number],
): void {
  const lo = ring8(cx, cz, r, y0);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const nx = Math.cos(((i + 0.5) / 8) * Math.PI * 2) * 0.7;
    const nz = Math.sin(((i + 0.5) / 8) * Math.PI * 2) * 0.7;
    tri(a, [lo[j], lo[i], [cx, y1, cz]], [nx, 0.7, nz], [c, c, c]);
  }
}
