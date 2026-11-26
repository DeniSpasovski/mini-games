import { Vector2 } from 'three';
import { line } from '../../ajvatovci/hilltop/build/court';
import { meshFence } from '../../ajvatovci/start-row/build/props';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { PadDef } from '../../shared/types';
import { turnedBoxCollider, type Local, type V2 } from './common';
import { toLocal, toWorld, type Area, type Site } from './sites';

/**
 * The tennis courts round the start of the run-up: the club's two artificial-grass courts and its small clay court behind
 * the Turkish residence's fence (OSM ways 1117610886, 1117610887, 1117610888), the residence's own court (409230476, a dark
 * tartan) and the blue hard court below the sports hall at ~200 m (not in OSM: placed from the aerial reference). Each is
 * a painted slab on a levelled terrace, white lines, a net between two posts and a 3.5 m wire fence round its outline.
 */
interface Court {
  name: string;
  /** Outline (world x, z), the first edge along the court's length. */
  outline: V2[];
  /** The playing area / the run-off round it. */
  inner: string;
  outer: string;
  /** Lines of a full doubles court, or of a short one sized to the outline (the club's mini court). */
  mini?: boolean;
  /** Fence sides (index i = outline[i] -> outline[i + 1]); default all four. */
  fence?: number[];
}

const COURTS: Court[] = [
  {
    name: 'club-court-1',
    outline: [
      [1598.6, -1156.2],
      [1624.5, -1181.8],
      [1611.1, -1194.4],
      [1586.5, -1170.4],
    ],
    inner: '#4b6c3d',
    outer: '#46653a',
    // (the second court shares its north-east side)
    fence: [1, 2, 3],
  },
  {
    name: 'club-court-2',
    outline: [
      [1612.1, -1144.0],
      [1637.8, -1170.4],
      [1624.5, -1181.8],
      [1598.6, -1156.2],
    ],
    inner: '#4b6c3d',
    outer: '#46653a',
  },
  {
    name: 'club-mini',
    outline: [
      [1601.1, -1186.2],
      [1611.0, -1195.5],
      [1604.0, -1202.0],
      [1595.3, -1193.2],
    ],
    inner: '#9a4c3a',
    outer: '#8f4636',
    mini: true,
  },
  {
    name: 'residence-court',
    outline: [
      [1700.4, -1151.3],
      [1687.9, -1172.8],
      [1678.0, -1167.1],
      [1690.5, -1145.6],
    ],
    inner: '#4f6157',
    outer: '#4a5a51',
    mini: true,
  },
  {
    name: 'hall-court',
    outline: [
      [1554, -1030.5],
      [1582, -1030.5],
      [1582, -1013.5],
      [1554, -1013.5],
    ],
    inner: '#2f5f9e',
    outer: '#3f5f73',
  },
];

/** A court's frame: the centre of its outline, local x along its first edge. */
const siteOf = (c: Court): Site => {
  const n = c.outline.length;
  const x = c.outline.reduce((s, p) => s + p[0], 0) / n;
  const z = c.outline.reduce((s, p) => s + p[1], 0) / n;
  const [a, b] = c.outline;
  return { x, z, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) };
};

export const COURT_SITES: Site[] = COURTS.map(siteOf);

/** Scatter stays off the courts (and a metre round the fence). */
export const COURT_AREAS: Area[] = COURTS.map((c, i) => {
  const s = COURT_SITES[i];
  return {
    site: s,
    poly: c.outline.map(([x, z]) => toLocal(s, x, z)),
  };
});

/** The terraces under the courts: the club's three on one level, the other two each on their own. */
const terrace = (name: string, outline: V2[], at: V2): PadDef => ({
  name,
  polygon: outline.flat(),
  blend: 4,
  level: { at, lift: 0.05 },
});
export const COURT_PADS: PadDef[] = [
  terrace(
    'club-courts',
    [
      [1612.1, -1144.0],
      [1637.8, -1170.4],
      [1611.0, -1195.5],
      [1604.0, -1202.0],
      [1595.3, -1193.2],
      [1586.5, -1170.4],
    ],
    [1612, -1170],
  ),
  terrace('residence-court', COURTS[3].outline, [
    COURT_SITES[3].x,
    COURT_SITES[3].z,
  ]),
  terrace('hall-court', COURTS[4].outline, [
    COURT_SITES[4].x,
    COURT_SITES[4].z,
  ]),
];

/** The slab sits this far over the levelled ground (the drawn terrain must not show through it). */
const SLAB = 0.06;
const POST = '#2f3a33';

function buildCourt(
  l: Local,
  c: Court,
  ground: (x: number, z: number) => number,
): void {
  const s = l.site;
  // Local (x, z) -> height above the frame's ground.
  const g = (x: number, z: number): number => {
    const [wx, wz] = toWorld(s, x, z);
    // (`line` lays its paint 6 cm over this: 2 cm over the playing area)
    return ground(wx, wz) - l.baseY + SLAB - 0.04;
  };
  const local = c.outline.map(([x, z]) => toLocal(s, x, z));
  const len = Math.hypot(
    c.outline[1][0] - c.outline[0][0],
    c.outline[1][1] - c.outline[0][1],
  );
  const wid = Math.hypot(
    c.outline[2][0] - c.outline[1][0],
    c.outline[2][1] - c.outline[1][1],
  );
  // Frame polygons take offsets from the site in world axes.
  const offs = (pts: V2[]): Vector2[] =>
    pts.map(([x, z]) => {
      const [wx, wz] = toWorld(s, x, z);
      return new Vector2(wx - s.x, wz - s.z);
    });
  const drape = (sx: number, sz: number) => ground(sx + s.x, sz + s.z);
  l.frame.polygon('concrete', offs(local), SLAB, c.outer, {
    lift: drape,
    step: 2,
  });
  // The playing area: a doubles court (23.77 x 10.97 m) or one sized to a short outline.
  const L = c.mini ? Math.min(23.77, len - 3) / 2 : 23.77 / 2;
  const W = c.mini ? Math.min(10.97, wid - 2.4) / 2 : 10.97 / 2;
  const S = c.mini ? W * 0.75 : 8.23 / 2;
  const SV = c.mini ? L * 0.54 : 6.4;
  const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  l.frame.polygon('concrete', offs(rect(-L, -W, L, W)), SLAB + 0.01, c.inner, {
    lift: drape,
    step: 2,
  });
  // Lines: the outline (baselines, doubles sidelines), the singles sidelines, the service lines and the centre service line.
  line(l, g, [-L, -W], [L, -W]);
  line(l, g, [-L, W], [L, W]);
  line(l, g, [-L, -W], [-L, W]);
  line(l, g, [L, -W], [L, W]);
  line(l, g, [-L, -S], [L, -S]);
  line(l, g, [-L, S], [L, S]);
  line(l, g, [-SV, -S], [-SV, S]);
  line(l, g, [SV, -S], [SV, S]);
  line(l, g, [-SV, 0], [SV, 0]);
  for (const end of [-L, L]) {
    const d = Math.sign(end) * 0.1;
    line(l, g, [end, 0], [end - d, 0]);
  }
  // The net: two posts 0.9 m outside the sidelines, the mesh hanging from a cable (1.07 m at the posts, 0.91 m in the
  // middle), a white band along its top.
  const y0 = g(0, 0);
  const P = W + 0.9;
  for (const side of [-1, 1])
    l.box(
      'paint',
      [-0.04, y0 - 0.3, side * P - 0.04],
      [0.04, y0 + 1.07, side * P + 0.04],
      POST,
    );
  const n = 12;
  for (let i = 0; i < n; i++) {
    const z0 = -P + (2 * P * i) / n;
    const z1 = -P + (2 * P * (i + 1)) / n;
    const sag = (z: number) => 1.07 - 0.16 * (1 - (z / P) ** 2);
    const top = (sag(z0) + sag(z1)) / 2;
    l.box('fence', [-0.01, y0 + 0.02, z0], [0.01, y0 + top, z1], '#3a3f3c');
    l.box(
      'paint',
      [-0.02, y0 + top - 0.06, z0],
      [0.02, y0 + top + 0.01, z1],
      '#eeeeea',
    );
  }
  // The fence round the outline: wire mesh on posts, 3.5 m high.
  const sides = c.fence ?? [0, 1, 2, 3];
  for (const i of sides) {
    const a = c.outline[i];
    const b = c.outline[(i + 1) % c.outline.length];
    meshFence(
      l.frame,
      [
        new Vector2(a[0] - s.x, a[1] - s.z),
        new Vector2(b[0] - s.x, b[1] - s.z),
      ],
      {
        top: 3.5,
        postTop: 3.55,
        post: POST,
        endPost: true,
        lift: (x, z) => drape(x, z) + SLAB,
      },
    );
  }
  // A bench by the net on one side.
  const bz = W + 1.6;
  if (wid / 2 - bz > 0.6) {
    l.box(
      'paint',
      [-0.9, y0 + 0.42, bz - 0.2],
      [0.9, y0 + 0.47, bz + 0.2],
      '#6a4a2e',
    );
    for (const x of [-0.8, 0.8])
      l.box(
        'paint',
        [x - 0.03, y0, bz - 0.18],
        [x + 0.03, y0 + 0.42, bz + 0.18],
        POST,
      );
  }
}

export function buildCourts(
  at: (site: Site, tile: string) => Local,
  ground: (x: number, z: number) => number,
): void {
  COURTS.forEach((c, i) => buildCourt(at(COURT_SITES[i], c.name), c, ground));
}

/** The fences stop the car (thin boxes along each fenced side). */
export function courtColliders(ground: TerrainSampler): StaticCollider[] {
  const out: StaticCollider[] = [];
  COURTS.forEach((c, k) => {
    const s = COURT_SITES[k];
    for (const i of c.fence ?? [0, 1, 2, 3]) {
      const a = toLocal(s, ...c.outline[i]);
      const b = toLocal(s, ...c.outline[(i + 1) % c.outline.length]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push(
        turnedBoxCollider(
          s,
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2,
          Math.atan2(b[1] - a[1], b[0] - a[0]),
          len / 2,
          0.08,
          ground.height(s.x, s.z) - 0.8,
          4.3,
        ),
      );
    }
  });
  return out;
}
