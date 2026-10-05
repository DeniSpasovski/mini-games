import type { BuildingDef, PadDef } from '../../shared/types';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import { distance } from '../../../world/pads';
import type { Landmark } from '../../../world/landmarks';
import { SOUTH_OSM, SOUTH_STRIPS } from './footprints';
import {
  NORTH_FENCE,
  ORIGIN,
  ROAD,
  roadLine,
  SIDEWALK_BACK,
  SOUTH_FENCE,
  STREET_X,
  toWorld,
  type Corner,
} from './frame';
import { getYards, PLOTS, SITE } from './layout';
import { buildStartRow } from './build';
import { startRowInstances } from './plantings';
import {
  CURBS_FROM,
  fenceRuns,
  gates,
  poleSpots,
  straighten,
} from './streetwork';

/**
 * The start row of Ajvatovci Hill: the Ilinden industrial street's lots (the Mileks building,
 * its neighbours on both sides, their yards, fences, gates and parked vehicles) modelled by hand
 * in place of the placeholder boxes. Layout in `layout.ts` (positions traced from the satellite
 * image, `trace.ts`), geometry in `build/`, notes and sources in DETAILS.md. Pure data here (pads,
 * colliders, the physical kerb, what it replaces) - safe to load in node.
 */

const flat = (corners: Corner[]): Float64Array =>
  Float64Array.from(corners.flatMap((c) => toWorld(c)));

/** Outlines of the graded pads: every lot's yard. */
const padOutlines = (): {
  name: string;
  polygon: Corner[];
  span?: [number, number];
  side: 'north' | 'south';
}[] =>
  getYards()
    .filter((y) => !y.plot.noPad)
    .map((y) => ({
      name: y.plot.name,
      polygon: y.polygon.map((p): Corner => [p.x, p.y]),
      span: y.plot.padSpan,
      side: y.plot.side,
    }));

/** Knots every ~10 m along the street fence between site x `x0` and `x1`: the pad of a lot behind others. */
const frontageAlong = (
  x0: number,
  x1: number,
  side: 'north' | 'south',
): number[] => {
  const line = roadLine(
    side === 'north' ? NORTH_FENCE + 0.4 : SOUTH_FENCE - 0.4,
    x0,
    x1,
  );
  const knots: Corner[] = [];
  line.forEach((p, i) => {
    const last = knots[knots.length - 1];
    if (!last || i === line.length - 1 || p.x - last[0] >= 10)
      knots.push([p.x, p.y]);
  });
  return knots.flatMap((c) => toWorld(c));
};

/**
 * The frontage points of a lot: the vertices that touch the street fence line, thinned to one
 * every ~10 m (the pad follows the road's height there).
 */
const frontage = (polygon: Corner[]): number[] => {
  const fences = [roadLine(NORTH_FENCE + 0.4), roadLine(SOUTH_FENCE - 0.4)];
  const near = (p: Corner) =>
    Math.min(
      ...fences.map((line) => {
        let best = Infinity;
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          const ex = b.x - a.x;
          const ez = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a.x) * ex + (p[1] - a.y) * ez) / (ex * ex + ez * ez),
            ),
          );
          best = Math.min(
            best,
            Math.hypot(p[0] - a.x - ex * t, p[1] - a.y - ez * t),
          );
        }
        return best;
      }),
    );
  const touching = polygon
    .filter((p) => near(p) < 2)
    .sort((a, b) => a[0] - b[0]);
  const pool =
    touching.length >= 2
      ? touching
      : [...polygon].sort((a, b) => near(a) - near(b)).slice(0, 2);
  // Knots every ~10 m along the frontage, the two ends included.
  const knots: Corner[] = [];
  pool.forEach((p, i) => {
    const last = knots[knots.length - 1];
    if (!last || i === pool.length - 1 || p[0] - last[0] >= 10) knots.push(p);
  });
  return knots.flatMap((c) => toWorld(c));
};

/** Terrain pads for the map file (`terrain.pads`). */
export const startRowPads = (): PadDef[] =>
  padOutlines().map(({ name, polygon, span, side }) => ({
    name,
    polygon: polygon.flatMap((c) => toWorld(c)),
    blend: 4,
    frontage: span ? frontageAlong(span[0], span[1], side) : frontage(polygon),
  }));

/** Footprints of every building and annex (site metres): colliders, placeholder hiding. */
const footprints = (): {
  corners: Corner[];
  height: number;
  name: string;
}[] =>
  PLOTS.flatMap((p) => [
    { name: p.name, corners: p.corners, height: p.height },
    ...(p.annex
      ? [
          {
            name: `${p.name} annex`,
            corners: p.annex.corners,
            height: p.annex.height,
          },
        ]
      : []),
    ...(p.more ?? []).map((m, i) => ({
      name: `${p.name} building ${i + 2}`,
      corners: m.corners,
      height: m.height,
    })),
  ]);

/** Oriented box (centre, half extents, yaw) round a footprint, along its longest edge. */
const orientedBox = (corners: Corner[]) => {
  let best = 0;
  let axis: [number, number] = [1, 0];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) {
      best = len;
      axis = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    }
  });
  const across: [number, number] = [-axis[1], axis[0]];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, z] of corners) {
    const u = x * axis[0] + z * axis[1];
    const v = x * across[0] + z * across[1];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  return {
    x: cu * axis[0] + cv * across[0],
    z: cu * axis[1] + cv * across[1],
    hx: (u1 - u0) / 2,
    hz: (v1 - v0) / 2,
    // three.js yaw maps local +X to (cos t, -sin t); the footprint runs along `axis`.
    rot: -Math.atan2(axis[1], axis[0]),
  };
};

/** OSM outlines the south lots replace (their placeholder buildings are hidden too). */
const replacedOutlines = (): Corner[][] => [
  ...Object.values(SOUTH_OSM),
  ...SOUTH_STRIPS,
];

let cache: { polygons: { pts: Float64Array; bounds: number[] }[] } | undefined;
/** Lots and buildings as world polygons with bounds, for quick point tests. */
const areas = () => {
  if (cache) return cache;
  const outlines = [
    ...getYards().map((y) => y.polygon.map((p): Corner => [p.x, p.y])),
    ...footprints().map((f) => f.corners),
    ...replacedOutlines(),
  ];
  const polygons = outlines.map((c) => {
    const pts = flat(c);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minZ = Math.min(minZ, pts[i + 1]);
      maxZ = Math.max(maxZ, pts[i + 1]);
    }
    return { pts, bounds: [minX, maxX, minZ, maxZ] };
  });
  return (cache = { polygons });
};

const within = (x: number, z: number, margin: number): boolean => {
  for (const { pts, bounds } of areas().polygons) {
    if (
      x < bounds[0] - margin ||
      x > bounds[1] + margin ||
      z < bounds[2] - margin ||
      z > bounds[3] + margin
    )
      continue;
    if (distance(pts, x, z) <= margin) return true;
  }
  return false;
};

/** Height of the kerb top / the sidewalk / a driveway apron above the road centre (m): see build/street.ts. */
const KERB = 0.17;
const SIDEWALK = 0.15;
const APRON = 0.07;

/**
 * The ground the car drives on: the terrain, except where the street has a kerb, a sidewalk or a
 * driveway apron - there it is the same raised surface the street mesh draws (build/street.ts), so
 * the wheels feel the 17 cm kerb and ride up onto the sidewalk. NaN elsewhere.
 */
const kerbGround = (ground: TerrainSampler) => {
  const centre = roadLine(0);
  const heights = centre.map((p) =>
    ground.height(p.x + ORIGIN.x, p.y + ORIGIN.z),
  );
  const g = gates();
  const inGate = (x: number, gaps: [number, number][]) =>
    gaps.some(([a, b]) => x >= a && x <= b);
  return (wx: number, wz: number): number => {
    const x = wx - ORIGIN.x;
    const z = wz - ORIGIN.z;
    if (x < CURBS_FROM || x > STREET_X[1]) return NaN;
    // The road sample whose x is nearest, then the closest of its neighbours.
    let lo = 0;
    let hi = centre.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (centre[mid].x < x) lo = mid;
      else hi = mid;
    }
    let best = -1;
    let bestD = Infinity;
    for (
      let i = Math.max(0, lo - 4);
      i <= Math.min(centre.length - 1, hi + 4);
      i++
    ) {
      const d = Math.hypot(centre[i].x - x, centre[i].y - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 9) return NaN;
    const a = centre[Math.max(0, best - 1)];
    const b = centre[Math.min(centre.length - 1, best + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Left of travel (eastbound) = north = positive lateral.
    const lateral =
      ((z - centre[best].y) * (b.x - a.x) -
        (x - centre[best].x) * (b.y - a.y)) /
      len;
    const north = -lateral; // z grows south; flip so + is the row's side
    const cy = heights[best];
    if (
      north >= ROAD.half &&
      north <= SIDEWALK_BACK + (inGate(x, g.north) ? 0.4 : 0)
    )
      return (
        cy +
        (inGate(x, g.north)
          ? APRON
          : north < ROAD.half + ROAD.curb
            ? KERB
            : SIDEWALK)
      );
    if (north <= -ROAD.half) {
      if (inGate(x, g.south) && north >= SOUTH_FENCE - 0.6) return cy + APRON;
      if (north >= -ROAD.half - ROAD.curb) return cy + KERB;
    }
    return NaN;
  };
};

export const startRowLandmark: Landmark = {
  id: 'ajvatovci-start-row',

  occupies: (x, z, margin) => {
    // Cheap reject: the whole row lies within a few hundred metres of the Mileks site origin.
    if (Math.abs(x - ORIGIN.x) > 520 || Math.abs(z - ORIGIN.z) > 260)
      return false;
    return within(x, z, margin);
  },

  replaces: (b: BuildingDef) => {
    if (Math.abs(b.x - ORIGIN.x) > 520 || Math.abs(b.z - ORIGIN.z) > 260)
      return false;
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    const corners: [number, number][] = [
      [b.x, b.z],
      ...(
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const
      ).map(([u, v]): [number, number] => [
        b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2,
        b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2,
      ]),
    ];
    return corners.some(([x, z]) => within(x, z, 2));
  },

  colliders: (ground: TerrainSampler): StaticCollider[] => {
    const out: StaticCollider[] = footprints().map(({ corners, height }) => {
      const box = orientedBox(corners.map((c) => toWorld(c)));
      let low = Infinity;
      for (const c of corners) {
        const [x, z] = toWorld(c);
        low = Math.min(low, ground.height(x, z));
      }
      return {
        kind: 'box',
        x: box.x,
        z: box.z,
        y: low - 0.15,
        h: height + 0.15,
        hx: box.hx,
        hz: box.hz,
        rot: box.rot,
        r: Math.hypot(box.hx, box.hz),
      };
    });
    // Fences: a thin box per ~5 m of every run (street, lots, the garden wall). They are barriers.
    for (const run of fenceRuns()) {
      // Straight stretches become one box per ~5 m (the run's 2 m samples would be hundreds).
      const line = straighten(run.line, 0.12);
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const len = a.distanceTo(b);
        const n = Math.max(1, Math.ceil(len / 5));
        for (let k = 0; k < n; k++) {
          const p = a.clone().lerp(b, k / n);
          const q = a.clone().lerp(b, (k + 1) / n);
          const mx = (p.x + q.x) / 2 + ORIGIN.x;
          const mz = (p.y + q.y) / 2 + ORIGIN.z;
          const hx = p.distanceTo(q) / 2 + 0.04;
          const hz = run.kind === 'wall' ? 0.15 : 0.08;
          out.push({
            kind: 'box',
            x: mx,
            z: mz,
            y: ground.height(mx, mz) - 0.1,
            h: run.kind === 'wall' ? 1.7 : 1.9,
            hx,
            hz,
            rot: -Math.atan2(q.y - p.y, q.x - p.x),
            r: Math.hypot(hx, hz),
          });
        }
      }
    }
    // The excavator (a box along its heading) and the pile of sand (a cylinder).
    {
      const [ex, ez] = toWorld(SITE.excavator.at);
      out.push({
        kind: 'box',
        x: ex,
        z: ez,
        y: ground.height(ex, ez) - 0.1,
        h: 3.3,
        hx: 1.9,
        hz: 2.4,
        rot: SITE.excavator.heading,
        r: 3,
      });
      const [px, pz] = toWorld(SITE.pile.at);
      out.push({
        kind: 'cylinder',
        x: px,
        z: pz,
        y: ground.height(px, pz) - 0.1,
        r: SITE.pile.radius * 0.8,
        h: SITE.pile.height * 0.8,
      });
    }
    // Power poles.
    for (const { p } of poleSpots()) {
      const x = p.x + ORIGIN.x;
      const z = p.y + ORIGIN.z;
      out.push({
        kind: 'cylinder',
        x,
        z,
        y: ground.height(x, z),
        r: 0.2,
        h: 9,
      });
    }
    return out;
  },

  groundOverride: kerbGround,

  instances: (ground: TerrainSampler) =>
    startRowInstances((x, z) => ground.height(x, z)),

  build: buildStartRow,
};
