import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { applyRoadSurface } from '../../../engine/road-surface';
import type { PadDef } from '../../shared/types';
import { KERB_W } from '../../../world/street-detail';
import type { World } from '../../../world/world';
import type { Local, V2, V3 } from './common';
import type { Area, Site } from './sites';

/**
 * The car park between the main street and the side street behind the start of the run-up (OSM way 1394445478, a car
 * every few metres along its west side and its south end, a tree strip by the side street). Plain worn asphalt level with the
 * main street's sidewalk, open to the side street on the north (no kerb there); the strip is a 2 m kerbed lawn along the side
 * street's sidewalk with three trees. World outline below (convex, clockwise from the north-west); the site is its centre, `yaw` 0 (local = world offset).
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

/** Just outside the stage road's edge line, where the asphalt starts (world x, z), from the polygon's north-west corner south. */
const WEST: V2[] = [
  [1573.6, -1146],
  [1573.5, -1137],
  [1572.9, -1129.8],
  [1572.65, -1124.6],
  [1572.1, -1119.4],
  [1570.9, -1114.3],
  [1569.6, -1109.1],
  [1567.75, -1103.9],
  [1565.2, -1097.5],
];

/** Stage road points along the lot's west side (the pad follows its height, level across it). */
const FRONTAGE = [1570.4, -1137.5, 1568.3, -1117.6, 1561.1, -1099.2];

export const START_LOT_PAD: PadDef = {
  name: 'start-lot',
  // The lot's outline, its west side out to the road's edge line (the asphalt strip there lies on level ground too).
  polygon: [...LOT_POLYGON.slice(0, -1), ...[...WEST].reverse()].flat(),
  blend: 3.5,
  frontage: FRONTAGE,
  surface: 'tarmac',
};

/** Where scatter stays off (and the garage footprints on the island go). */
export const START_LOT_AREAS: Area[] = [
  { site: START_LOT, rect: [-16, 18, -26, 24] },
];

/** The lawn strip beside the side street's sidewalk: world z range it covers, its width and the kerb on the lot side (m). */
const STRIP = { z0: -1133.5, z1: -1109.5, x0: 1595, width: 2, kerb: 0.3 };
const LIFT = 0.03;
const KERB_H = 0.15;
/** The lawn lies a little under the sidewalk's top, the kerb level with it. */
const LAWN_H = 0.13;
const LAWN = '#8a9a52';
const CONCRETE = '#c9c6bd';

/**
 * The asphalt lies this far above the analytic ground over the lot's west half: the drawn terrain rises above it in places (it
 * showed through as patches at 3 cm). Towards the side street's sidewalk it eases down to 3 cm, under the sidewalk's top.
 */
const ASPHALT_LIFT = 0.14;
const liftAt = (x: number): number => {
  const t = Math.min(1, Math.max(0, (x - 1588) / 6));
  return ASPHALT_LIFT - (ASPHALT_LIFT - 0.03) * t * t * (3 - 2 * t);
};

/** The cars (variants of `street_car`, local x, z, turn from +x): along the west side nose to tail, a row at the south end. */
export const START_LOT_CARS: {
  variant: number;
  x: number;
  z: number;
  turn: number;
  /** Up on the asphalt, so the tyres stand on it. */
  lift: number;
}[] = [
  ...Array.from({ length: 8 }, (_, k) => {
    const z = -1139.5 + k * 5.2;
    return {
      variant: (k * 7 + 2) % 10,
      x: westEdge(z) + 1.9 - START_LOT.x,
      z: z - START_LOT.z,
      turn: (k * 5) % 3 === 0 ? -Math.PI / 2 : Math.PI / 2,
      lift: liftAt(westEdge(z) + 1.9),
    };
  }),
  ...Array.from({ length: 4 }, (_, k) => ({
    variant: (k * 3 + 5) % 10,
    x: 1581 + k * 5.4 - START_LOT.x,
    z: -1100.9 - START_LOT.z,
    turn: k % 2 ? 0 : Math.PI,
    lift: liftAt(1581 + k * 5.4),
  })),
];

/** Trees / bushes on the lawn strip (local x, z). */
export const START_LOT_PLANTS: {
  asset: string;
  x: number;
  z: number;
  scale: number;
}[] = [
  {
    asset: 'oak_tree',
    x: 1598 - START_LOT.x,
    z: -1127.6 - START_LOT.z,
    scale: 1,
  },
  {
    asset: 'oak_tree',
    x: 1602 - START_LOT.x,
    z: -1121.6 - START_LOT.z,
    scale: 1.1,
  },
  {
    asset: 'oak_tree',
    x: 1603.4 - START_LOT.x,
    z: -1114.5 - START_LOT.z,
    scale: 0.9,
  },
  {
    asset: 'bush',
    x: 1600 - START_LOT.x,
    z: -1124.6 - START_LOT.z,
    scale: 0.7,
  },
  {
    asset: 'bush',
    x: 1603 - START_LOT.x,
    z: -1117.8 - START_LOT.z,
    scale: 0.6,
  },
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
  const tri = (a: V2, b: V2, c: V2): void => {
    const up =
      (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    // Wound to face up (+Y).
    for (const [px, pz] of up ? [a, b, c] : [a, c, b]) {
      pos.push(px, ground(px, pz) + liftAt(px), pz);
      uv.push(px / TILE, pz / TILE);
    }
  };
  for (let x = 1572; x < 1606; x += CELL)
    for (let z = -1147; z < -1097; z += CELL) {
      const piece = clip(LOT_POLYGON, x, z, x + CELL, z + CELL);
      for (let i = 1; i + 1 < piece.length; i++)
        tri(piece[0], piece[i], piece[i + 1]);
    }
  // The strip between the polygon's west side and the stage road (the polygon keeps off the road's edge, and the road
  // curves away from it): laid out to the road's edge line so no terrain shows between.
  for (let k = 0; k + 1 < WEST.length; k++) {
    const [w0, w1] = [WEST[k], WEST[k + 1]];
    const n = Math.ceil((w1[1] - w0[1]) / CELL);
    for (let i = 0; i < n; i++) {
      const [t0, t1] = [i / n, (i + 1) / n];
      const at = (t: number): [V2, V2] => {
        const z = w0[1] + (w1[1] - w0[1]) * t;
        return [
          [w0[0] + (w1[0] - w0[0]) * t, z],
          [westEdge(z) + 0.5, z],
        ];
      };
      const [a0, b0] = at(t0);
      const [a1, b1] = at(t1);
      tri(a0, b0, b1);
      tri(a0, b1, a1);
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

/** Everything else of the lot (the lawn strip), as the landmark's `build`. */
export function buildStartLot(
  at: (site: Site, tile: string) => Local,
  ground: (x: number, z: number) => number,
  world: World,
): void {
  const l = at(START_LOT, 'start-lot');
  const base = ground(START_LOT.x, START_LOT.z);
  /** Local point on the ground `dy` above it. */
  const gp = (x: number, z: number, dy: number): V3 => [
    x - START_LOT.x,
    ground(x, z) - base + dy,
    z - START_LOT.z,
  ];

  // The side street (its way starts at the mouth) and its sidewalk's outer edge: the strip lies against it.
  const net = world.gen.paths;
  const pi = net?.paths.findIndex(
    (p) =>
      p.kind === 'residential' &&
      Math.hypot(p.pts[0] - 1566.2, p.pts[1] + 1150.6) < 0.5,
  );
  if (!net || pi === undefined || pi < 0) return;
  const walk = (world.map.cityStreets?.sidewalk ?? 1.5) + KERB_W;
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  /** Rows of the strip: the street's centre point, its lot-side normal (west of the travel direction) and the sidewalk's outer offset. */
  const rows: { x: number; z: number; nx: number; nz: number; o: number }[] =
    [];
  for (let a = 0; a <= net.lengths[pi]; a += 0.5) {
    net.pointAt(pi, a, pt);
    if (pt.z < STRIP.z0 || pt.z > STRIP.z1 || pt.x < STRIP.x0) continue;
    net.pointAt(pi, Math.max(0, a - 1), nx);
    const [px, pz] = [nx.x, nx.z];
    net.pointAt(pi, a + 1, nx);
    const tl = Math.hypot(nx.x - px, nx.z - pz) || 1;
    const tx = (nx.x - px) / tl;
    const tz = (nx.z - pz) / tl;
    rows.push({
      x: pt.x,
      z: pt.z,
      nx: -tz,
      nz: tx,
      o: net.halfWidthAt(pi, a) + walk + 0.02,
    });
  }
  const edge = (r: (typeof rows)[number], d: number): [number, number] => [
    r.x + r.nx * (r.o + d),
    r.z + r.nz * (r.o + d),
  ];
  const { width, kerb } = STRIP;
  for (let i = 0; i + 1 < rows.length; i++) {
    const [r0, r1] = [rows[i], rows[i + 1]];
    const quad = (
      key: 'lawn' | 'concrete',
      d0: number,
      d1: number,
      h: number,
      color: string,
    ): void =>
      l.fan(
        key,
        [edge(r0, d0), edge(r1, d0), edge(r1, d1), edge(r0, d1)].map(([x, z]) =>
          gp(x, z, h),
        ),
        color,
        UP,
        uv,
      );
    quad('lawn', 0, width, LIFT + LAWN_H, LAWN);
    quad('concrete', width, width + kerb, LIFT + KERB_H, CONCRETE);
    // The kerb's face towards the lot.
    const [a0, a1] = [edge(r0, width + kerb), edge(r1, width + kerb)];
    l.fan(
      'concrete',
      [
        gp(a0[0], a0[1], LIFT),
        gp(a1[0], a1[1], LIFT),
        gp(a1[0], a1[1], LIFT + KERB_H),
        gp(a0[0], a0[1], LIFT + KERB_H),
      ],
      CONCRETE,
      [r0.nx, 0, r0.nz],
      (p) => [p[0] + p[2], p[1]],
    );
  }
  // The strip's two ends: a kerb across, so the lawn does not run off into the lot.
  for (const [r, dir] of [
    [rows[0], -1],
    [rows[rows.length - 1], 1],
  ] as const) {
    const [i0, o0] = [edge(r, 0), edge(r, width + kerb)];
    const along = [-r.nz * dir, r.nx * dir];
    const face = [along[0], 0, along[1]] as V3;
    l.fan(
      'concrete',
      [
        gp(i0[0], i0[1], LIFT),
        gp(o0[0], o0[1], LIFT),
        gp(o0[0], o0[1], LIFT + KERB_H),
        gp(i0[0], i0[1], LIFT + KERB_H),
      ],
      CONCRETE,
      face,
      (p) => [p[0] + p[2], p[1]],
    );
  }
}
