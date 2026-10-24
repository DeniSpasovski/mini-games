import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { applyRoadSurface } from '../../../engine/road-surface';
import type { PadDef } from '../../shared/types';
import type { Local, V2, V3 } from './common';
import type { Area, Site } from './sites';

/**
 * The car park between the main street and the side street behind the start of the run-up (OSM way 1394445478, a car
 * every few metres along its west side and its south end, a tree island by the side street). Plain worn asphalt level with the
 * main street's sidewalk, open to the side street on the north (no kerb there); the island is a kerbed oval of lawn with
 * three trees. World outline below (convex, clockwise from the north-west); the site is its centre, `yaw` 0 (local = world offset).
 */
export const START_LOT: Site = { x: 1587, z: -1121, yaw: 0 };

/** Outline (world x, z): the west side keeps 0.6 m off the main street's edge, the east side the side street's. */
export const LOT_POLYGON: V2[] = [
  [1575.2, -1146],
  [1590.5, -1145.5],
  [1596.5, -1141],
  [1601, -1133],
  [1604, -1124],
  [1604.8, -1114],
  [1604, -1104],
  [1602, -1097.5],
  [1571.7, -1097.5],
];

/** The lot's west side (world x for a z along it): the outline's last edge. */
const westEdge = (z: number): number =>
  1575.2 + ((z + 1146) / (1146 - 1097.5)) * (1571.7 - 1575.2);

/** Stage road points along the lot's west side (the pad follows its height, level across it). */
const FRONTAGE = [1570.4, -1137.5, 1568.3, -1117.6, 1561.1, -1099.2];

export const START_LOT_PAD: PadDef = {
  name: 'start-lot',
  polygon: LOT_POLYGON.flat(),
  blend: 3.5,
  frontage: FRONTAGE,
  surface: 'tarmac',
};

/** Where scatter stays off (and the garage footprints on the island go). */
export const START_LOT_AREAS: Area[] = [
  { site: START_LOT, rect: [-16, 18, -26, 24] },
];

/** The tree island (world centre, semi-axes x / z). */
const ISLAND = { x: 1597.6, z: -1121, a: 4, b: 9.5 };
const ISLAND_KERB = 0.35;
const KERB_H = 0.15;
const LAWN = '#8a9a52';
const CONCRETE = '#c9c6bd';

/** The cars (variants of `street_car`, local x, z, turn from +x): along the west side nose to tail, a row at the south end. */
export const START_LOT_CARS: {
  variant: number;
  x: number;
  z: number;
  turn: number;
}[] = [
  ...Array.from({ length: 8 }, (_, k) => {
    const z = -1139.5 + k * 5.2;
    return {
      variant: (k * 7 + 2) % 10,
      x: westEdge(z) + 1.9 - START_LOT.x,
      z: z - START_LOT.z,
      turn: (k * 5) % 3 === 0 ? -Math.PI / 2 : Math.PI / 2,
    };
  }),
  ...Array.from({ length: 4 }, (_, k) => ({
    variant: (k * 3 + 5) % 10,
    x: 1581 + k * 5.4 - START_LOT.x,
    z: -1100.9 - START_LOT.z,
    turn: k % 2 ? 0 : Math.PI,
  })),
];

/** Island trees / bushes (local x, z). */
export const START_LOT_PLANTS: {
  asset: string;
  x: number;
  z: number;
  scale: number;
}[] = [
  { asset: 'oak_tree', x: ISLAND.x - START_LOT.x, z: -6.2, scale: 1 },
  { asset: 'oak_tree', x: ISLAND.x - START_LOT.x + 0.4, z: 0.3, scale: 1.1 },
  { asset: 'oak_tree', x: ISLAND.x - START_LOT.x - 0.3, z: 6.4, scale: 0.9 },
  { asset: 'bush', x: ISLAND.x - START_LOT.x + 1.6, z: -3, scale: 0.7 },
  { asset: 'bush', x: ISLAND.x - START_LOT.x - 1.4, z: 3.4, scale: 0.6 },
];

/** A convex polygon clipped to an axis-aligned cell (Sutherland-Hodgman). */
function clip(
  poly: V2[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): V2[] {
  const sides: ((p: V2) => number)[] = [
    (p) => p[0] - x0,
    (p) => x1 - p[0],
    (p) => p[1] - z0,
    (p) => z1 - p[1],
  ];
  let out = poly;
  for (const d of sides) {
    const next: V2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      const da = d(a);
      const db = d(b);
      if (da >= 0) next.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out = next;
    if (out.length < 3) return [];
  }
  return out;
}

const UP: V3 = [0, 1, 0];
const uv = (p: V3): V2 => [p[0], p[2]];

/** Metres per repeat of the asphalt (`road_tarmac_plain_junction`, sampled by world XZ like the plazas'). */
const TILE = 7;

/**
 * The lot's asphalt: the stage road's junction asphalt laid flat over the pad (world-aligned, so it carries on into the
 * street mouth without a seam), in 2 m cells so it follows the ground.
 */
export function startLotAsphalt(
  ground: (x: number, z: number) => number,
): Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const CELL = 2;
  for (let x = 1572; x < 1606; x += CELL)
    for (let z = -1147; z < -1097; z += CELL) {
      const piece = clip(LOT_POLYGON, x, z, x + CELL, z + CELL);
      for (let i = 1; i + 1 < piece.length; i++) {
        const a = piece[0];
        const up =
          (piece[i][1] - a[1]) * (piece[i + 1][0] - a[0]) -
            (piece[i][0] - a[0]) * (piece[i + 1][1] - a[1]) >
          0;
        // Wound to face up (+Y).
        const tri = up
          ? [a, piece[i], piece[i + 1]]
          : [a, piece[i + 1], piece[i]];
        for (const [px, pz] of tri) {
          pos.push(px, ground(px, pz) + 0.03, pz);
          uv.push(px / TILE, pz / TILE);
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
      // Under the street ribbons that reach in at its edge, over the terrain (as the plazas).
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -1,
    }),
  );
  m.material.defines = { RALLY_GROUND: 1 };
  applyRoadSurface(m.material, 'road_tarmac_plain_junction');
  m.name = 'start-lot asphalt';
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** Everything else of the lot (the island), as the landmark's `build`. */
export function buildStartLot(
  at: (site: Site, tile: string) => Local,
  ground: (x: number, z: number) => number,
): void {
  const l = at(START_LOT, 'start-lot');
  const base = ground(START_LOT.x, START_LOT.z);
  /** Local point on the ground `dy` above it. */
  const gp = (x: number, z: number, dy: number): V3 => [
    x - START_LOT.x,
    ground(x, z) - base + dy,
    z - START_LOT.z,
  ];

  // The island: a kerb ring and its lawn.
  const N = 28;
  const ring = (a: number, b: number, i: number): V2 => {
    const t = (i / N) * Math.PI * 2;
    return [ISLAND.x + Math.cos(t) * a, ISLAND.z + Math.sin(t) * b];
  };
  const out = (i: number): V2 =>
    ring(ISLAND.a + ISLAND_KERB, ISLAND.b + ISLAND_KERB, i);
  const inn = (i: number): V2 => ring(ISLAND.a, ISLAND.b, i);
  for (let i = 0; i < N; i++) {
    const [o0, o1, i0, i1] = [out(i), out(i + 1), inn(i), inn(i + 1)];
    l.fan(
      'concrete',
      [o0, o1, i1, i0].map(([x, z]) => gp(x, z, 0.03 + KERB_H)),
      CONCRETE,
      UP,
      uv,
    );
    // The road-side face of the kerb.
    const mid = ring(1, 1, i + 0.5);
    l.fan(
      'concrete',
      [
        gp(o0[0], o0[1], 0.03),
        gp(o1[0], o1[1], 0.03),
        gp(o1[0], o1[1], 0.03 + KERB_H),
        gp(o0[0], o0[1], 0.03 + KERB_H),
      ],
      CONCRETE,
      [mid[0] - ISLAND.x, 0, mid[1] - ISLAND.z],
      (p) => [p[0] + p[2], p[1]],
    );
  }
  l.fan(
    'lawn',
    Array.from({ length: N }, (_, i) => {
      const [x, z] = inn(i);
      return gp(x, z, 0.03 + KERB_H - 0.02);
    }),
    LAWN,
    UP,
    uv,
  );
}
