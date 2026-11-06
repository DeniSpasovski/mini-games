import type { Group } from 'three';
import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { ScatterInstance } from '../../../world/scatter';
import type { World } from '../../../world/world';
import { newRoadQuery, Road } from '../../../world/road';
import { Local } from '../../ajvatovci/hilltop/build/shapes';
import { Bucket } from '../../ajvatovci/start-row/build/kit';
import type { MapDef, MapFeaturePoint } from '../../shared/types';
import {
  cylinderCollider,
  placeAt,
  turnedBoxCollider,
  type V2,
} from './common';
import {
  bench,
  bin,
  bollard,
  gazebo,
  logRail,
  picnicTable,
  post,
  wallSeg,
  WOOD,
  woodBoard,
} from './park';
import type { Site } from './sites';

/**
 * Park furniture and barriers OSM maps along the stage (`MapDef.features`, baked by scripts/realmap/features.py): picnic
 * tables, benches and viewpoint benches, timber shelters, notice boards, guideposts, drinking
 * fountains, springs, bins, lift gates / gates / blocks / bollards across the ways, fences and walls (the Vodno park kit,
 * merged per 200 m tile). Whatever a hand-built landmark already models is skipped (`others` occupy it). Seats face
 * downhill (the view), boards the nearest road, gates lie across the way they close. Gates, blocks, shelters and walls
 * near the stage road are solid; seats and tables get the library colliders; nothing stands on a road.
 */

/** Colliders only within this distance of the stage road (m). */
const REACH = 40;
/** Merged mesh tiles (m). */
const TILE = 200;
const GATE_RED = '#c8262a';
const GATE_WHITE = '#ecebe6';
const STEEL = '#6d7378';
const STONE = '#cfc6b4';
const CONCRETE = '#c9c6bf';
/** Half width of a way a gate / block closes (m): the side roads and tracks here are 3-4 m wide. */
const WAY_HALF = 2.2;

interface Placed {
  kind: string;
  x: number;
  z: number;
  /** Piece yaw (three.js, about Y). */
  yaw: number;
  /** Area kept clear of scatter (m). */
  r: number;
}

/** Downhill direction at (x, z) as a piece yaw facing it (+z of the piece). */
function downhillYaw(
  g: (x: number, z: number) => number,
  x: number,
  z: number,
): number {
  const dx = g(x - 2, z) - g(x + 2, z);
  const dz = g(x, z - 2) - g(x, z + 2);
  return Math.atan2(dx, dz);
}

const RADIUS: Record<string, number> = {
  picnic_table: 2,
  bench: 1.4,
  viewpoint: 1.6,
  shelter: 3.4,
  board: 1.2,
  guidepost: 0.6,
  drinking_water: 0.9,
  spring: 1,
  waste_basket: 0.5,
  lift_gate: 0.6,
  gate: 0.6,
  block: 1,
  bollard: 0.3,
  tree: 0.5,
};

export function osmFeaturesLandmark(map: MapDef, others: Landmark[]): Landmark {
  const f = map.features ?? { points: [], lines: [] };
  const taken = (x: number, z: number): boolean =>
    others.some((l) => l.occupies(x, z, 2));
  const points = f.points.filter(
    ([kind, x, z]) => RADIUS[kind] !== undefined && !taken(x, z),
  );
  const lines = f.lines.filter(
    (l) =>
      (l.kind === 'fence' || l.kind === 'wall') &&
      !taken(l.pts[0], l.pts[1]) &&
      !taken(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]),
  );
  // The stage road (plan only: lateral queries need no heights): boards face it, colliders stay near it, and a
  // feature OSM puts on its verge steps back off it.
  let road: Road | undefined;
  const rq = newRoadQuery();
  const edge = (x: number, z: number) => {
    road ??= new Road(map.road, () => 0);
    road.query(x, z, rq);
    return rq;
  };
  const nearest = (
    x: number,
    z: number,
  ): { x: number; z: number; d: number } => {
    const q = edge(x, z);
    if (!q.found) return { x, z, d: Infinity };
    const p = road!.at(q.along);
    return { x: p.x, z: p.z, d: Math.abs(q.distance) - q.halfWidth };
  };
  // Where each feature stands: off the verge, at least 1.5 m clear of the road edge (a point mapped on its line).
  let spotList: [number, number][] | undefined;
  const spots = (): [number, number][] =>
    (spotList ??= points.map(([kind, x, z]) => {
      const clear = map.road.shoulder + 1.5 + RADIUS[kind];
      const n = nearest(x, z);
      if (!(n.d < clear && n.d > -10)) return [x, z];
      const L = Math.hypot(x - n.x, z - n.z) || 1;
      const push = clear - n.d;
      return [x + ((x - n.x) / L) * push, z + ((z - n.z) / L) * push];
    }));
  // A spot pushed off the verge, or a road-side board, that lands on a cut face or fill bank steps back to the level
  // ground at the verge (never onto the road); one that finds none, or a board under a cut face, is left out.
  const level = (
    g: (x: number, z: number) => number,
    i: number,
  ): [number, number] | undefined => {
    const [kind, ox, oz] = points[i];
    let [x, z] = spots()[i];
    const n = nearest(x, z);
    const roadside = (kind === 'board' || kind === 'guidepost') && n.d < 12;
    if (x === ox && z === oz && !roadside) return [x, z];
    const y0 = g(n.x, n.z);
    const L = Math.hypot(x - n.x, z - n.z) || 1;
    const [ux, uz] = [(x - n.x) / L, (z - n.z) / L];
    for (let d = n.d; Math.abs(g(x, z) - y0) > 0.8; d -= 0.25) {
      if (d < map.road.shoulder + 0.3 + RADIUS[kind] * 0.5) return undefined;
      x -= ux * 0.25;
      z -= uz * 0.25;
    }
    // a board at the foot of a cut face would stand in the rock
    if (roadside && g(x + ux * 1.5, z + uz * 1.5) - g(x, z) > 0.8)
      return undefined;
    return [x, z];
  };
  // Yaws need the ground: set on first use (pure: the analytic ground every caller passes is the same).
  let placed: Placed[] | undefined;
  const place = (g: (x: number, z: number) => number): Placed[] =>
    (placed ??= points.flatMap(([kind, , , wayYaw]: MapFeaturePoint, i) => {
      const spot = level(g, i);
      if (!spot) return [];
      const [x, z] = spot;
      let yaw = downhillYaw(g, x, z);
      if (kind === 'lift_gate' || kind === 'gate' || kind === 'block')
        // across the way: the piece's +x runs across it
        yaw = -(wayYaw + Math.PI / 2);
      else if (kind === 'board' || kind === 'guidepost') {
        const p = nearest(x, z);
        yaw = Math.atan2(p.x - x, p.z - z);
      }
      return [{ kind, x, z, yaw, r: RADIUS[kind] }];
    }));

  return {
    id: 'vodno-osm-features',
    occupies: (x, z, margin) =>
      spots().some(
        ([px, pz], i) =>
          Math.hypot(x - px, z - pz) < RADIUS[points[i][0]] + margin,
      ),
    replaces: () => false,
    colliders(ground: TerrainSampler): StaticCollider[] {
      const out: StaticCollider[] = [];
      for (const p of place((x, z) => ground.height(x, z))) {
        if (nearest(p.x, p.z).d > REACH) continue;
        const site: Site = { x: p.x, z: p.z, yaw: 0 };
        const y = ground.height(p.x, p.z) - 0.5;
        if (p.kind === 'lift_gate' || p.kind === 'gate' || p.kind === 'block')
          out.push(
            turnedBoxCollider(site, 0, 0, -p.yaw, WAY_HALF + 0.3, 0.25, y, 1.6),
          );
        else if (p.kind === 'shelter')
          out.push(cylinderCollider(site, 0, 0, y, 2.3, 3));
        else if (p.kind === 'drinking_water' || p.kind === 'spring')
          out.push(cylinderCollider(site, 0, 0, y, 0.5, 1.4));
        else if (p.kind === 'board')
          out.push(cylinderCollider(site, 0, 0, y, 0.9, 3));
        else if (p.kind === 'picnic_table')
          out.push(cylinderCollider(site, 0, 0, y, 1.05, 1.3));
        else if (p.kind === 'bench' || p.kind === 'viewpoint')
          out.push(cylinderCollider(site, 0, 0, y, 0.85, 1.1));
      }
      return out;
    },
    // Single trees OSM maps that the canopy height model's real trees miss (seats and tables are the park kit's,
    // merged like the rest: the library's need the `village` model chunk). The tree stage sets variant and size.
    instances: (ground: TerrainSampler): ScatterInstance[] =>
      points
        .map((p, i) => [p[0], ...spots()[i]] as const)
        .filter(([kind]) => kind === 'tree')
        .map(([, x, z]) => ({
          asset: 'oak_tree',
          variant: 0,
          x,
          y: ground.height(x, z),
          z,
          rotY: 0,
          scale: 1,
          tiltX: 0,
          tiltZ: 0,
        })),
    *build(world: World): Generator<void, Group> {
      const g = (x: number, z: number) => world.analytic.height(x, z);
      const bucket = new Bucket();
      const at = (x: number, z: number): Local =>
        new Local(
          bucket,
          `f${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`,
          { x, z, yaw: 0 },
          g(x, z),
        );
      for (const p of place(g)) {
        const l = at(p.x, p.z);
        piece(l, p, g);
      }
      yield;
      for (const line of lines) {
        const pts: V2[] = [];
        for (let i = 0; i + 1 < line.pts.length; i += 2)
          pts.push([line.pts[i], line.pts[i + 1]]);
        const l = at(pts[0][0], pts[0][1]);
        const loc = pts.map(([x, z]) => [x - l.site.x, z - l.site.z] as V2);
        const yAt = (x: number, z: number) =>
          g(x + l.site.x, z + l.site.z) - l.baseY;
        if (line.kind === 'wall') {
          for (let i = 0; i + 1 < loc.length; i++) {
            const [a, b] = [loc[i], loc[i + 1]];
            const y = Math.min(yAt(...a), yAt(...b));
            wallSeg(l, a, b, y - 0.3, y + 0.85, 0.5, 'drystone', STONE);
          }
        } else if (line.type === 'metal') fenceRun(l, loc, yAt);
        else logRail(l, loc, yAt);
      }
      yield;
      return bucket.build('vodno-osm-features');
    },
  };
}

/** A post-and-tube steel fence along a polyline (local): posts every 2.5 m, top and middle tubes. */
function fenceRun(
  l: Local,
  pts: V2[],
  yAt: (x: number, z: number) => number,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.5));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const p0: V2 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
      const p1: V2 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
      const y0 = yAt(...p0);
      const y1 = yAt(...p1);
      post(l, p0[0], p0[1], y0 - 0.3, y0 + 1.3, 0.06, 'metal', STEEL);
      for (const h of [0.55, 1.25]) {
        const y = Math.min(y0, y1) + h;
        wallSeg(l, p0, p1, y, y + 0.04, 0.04, 'metal', STEEL);
      }
    }
    const [ex, ez] = pts[i + 1];
    if (i + 2 === pts.length)
      post(
        l,
        ex,
        ez,
        yAt(ex, ez) - 0.3,
        yAt(ex, ez) + 1.3,
        0.06,
        'metal',
        STEEL,
      );
  }
}

/** One feature's structure at the frame's origin (`l.site`), base on the lowest ground of its footprint. */
function piece(l: Local, p: Placed, g: (x: number, z: number) => number): void {
  const low = (r: number) =>
    Math.min(
      g(p.x, p.z),
      ...[0, 1, 2, 3, 4, 5].map((k) =>
        g(p.x + r * Math.cos(k * 1.047), p.z + r * Math.sin(k * 1.047)),
      ),
    ) - l.baseY;
  const m = placeAt(0, 0, 0, p.yaw);
  const h = hash3(Math.round(p.x * 10), Math.round(p.z * 10), 3, 977);
  switch (p.kind) {
    case 'shelter':
      gazebo(l, 0, low(2.4) - 0.05, 0, p.yaw, {
        apothem: 2.1,
        roof: h % 2 ? '#4f3423' : '#5d4030',
        tables: 1,
        open: [2, 6],
      });
      break;
    case 'board':
      woodBoard(l, 0, low(0.8), 0, p.yaw, 1.6);
      break;
    case 'picnic_table':
      picnicTable(l, 0, low(1.1), 0, p.yaw);
      break;
    case 'bench':
      // seat facing downhill (+z of the piece), timber like the tables
      bench(l, 0, low(0.9), 0, p.yaw, WOOD);
      break;
    case 'viewpoint':
      // a bench facing the view, a small wooden view board beside it
      bench(l, 0, low(0.9), 0, p.yaw, WOOD);
      woodBoard(l, 1.6, low(1.8), 0, p.yaw, 1);
      break;
    case 'guidepost': {
      const y = low(0.2);
      l.box(
        'paint',
        [-0.06, y - 0.3, -0.06],
        [0.06, y + 2.3, 0.06],
        '#5e3a20',
        m,
      );
      // two blank finger boards (no text), red-white trail stripe
      for (const [k, dir] of [
        [0, 1],
        [1, -1],
      ] as const) {
        const y0 = y + 1.75 - k * 0.3;
        l.box(
          'paint',
          [dir > 0 ? 0.06 : -0.66, y0, -0.02],
          [dir > 0 ? 0.66 : -0.06, y0 + 0.18, 0.02],
          GATE_WHITE,
          m,
        );
        l.box(
          'paint',
          [dir > 0 ? 0.5 : -0.66, y0, -0.025],
          [dir > 0 ? 0.66 : -0.5, y0 + 0.18, 0.025],
          GATE_RED,
          m,
        );
      }
      break;
    }
    case 'drinking_water': {
      const y = low(0.5);
      l.box('drystone', [-0.3, y - 0.2, -0.3], [0.3, y + 1.0, 0.3], STONE, m);
      l.box('drystone', [-0.55, y - 0.2, 0.3], [0.55, y + 0.35, 0.8], STONE, m);
      l.box('metal', [-0.02, y + 0.75, 0.3], [0.02, y + 0.79, 0.5], STEEL, m);
      break;
    }
    case 'spring': {
      // a dry-stone headwall in the bank with a pipe and a trough below
      const y = low(0.8);
      l.box('drystone', [-0.8, y - 0.3, -0.5], [0.8, y + 0.9, -0.1], STONE, m);
      l.box('metal', [-0.03, y + 0.45, -0.1], [0.03, y + 0.5, 0.25], STEEL, m);
      l.box('drystone', [-0.5, y - 0.2, 0.1], [0.5, y + 0.25, 0.6], STONE, m);
      break;
    }
    case 'waste_basket':
      bin(l, 0, low(0.3), 0, p.yaw);
      break;
    case 'lift_gate': {
      // a post with the counterweight on one side, a red-white boom across the way, a fork rest on the far side
      const y = low(WAY_HALF);
      l.box(
        'metal',
        [-WAY_HALF - 0.12, y - 0.3, -0.12],
        [-WAY_HALF + 0.12, y + 1.05, 0.12],
        STEEL,
        m,
      );
      l.box(
        'metal',
        [-WAY_HALF - 0.7, y + 0.85, -0.08],
        [-WAY_HALF - 0.12, y + 1.05, 0.08],
        '#3a3d3f',
        m,
      );
      for (let k = 0; k < 6; k++) {
        const x0 = -WAY_HALF + (k * 2 * WAY_HALF + 0.3) / 6;
        const x1 = -WAY_HALF + ((k + 1) * 2 * WAY_HALF + 0.3) / 6;
        l.box(
          'paint',
          [x0, y + 0.9, -0.05],
          [x1, y + 1.0, 0.05],
          k % 2 ? GATE_WHITE : GATE_RED,
          m,
        );
      }
      l.box(
        'metal',
        [WAY_HALF + 0.2, y - 0.3, -0.05],
        [WAY_HALF + 0.3, y + 0.9, 0.05],
        STEEL,
        m,
      );
      break;
    }
    case 'gate': {
      // two steel posts and two tube-frame leaves, closed
      const y = low(WAY_HALF);
      for (const s of [-1, 1])
        l.box(
          'metal',
          [s * WAY_HALF - 0.08, y - 0.3, -0.08],
          [s * WAY_HALF + 0.08, y + 1.4, 0.08],
          STEEL,
          m,
        );
      for (const [x0, x1] of [
        [-WAY_HALF + 0.1, -0.02],
        [0.02, WAY_HALF - 0.1],
      ])
        for (const yy of [0.15, 0.7, 1.25])
          l.box(
            'metal',
            [x0, y + yy, -0.03],
            [x1, y + yy + 0.05, 0.03],
            STEEL,
            m,
          );
      for (const x of [-WAY_HALF + 0.1, -0.05, 0.02, WAY_HALF - 0.15])
        l.box(
          'metal',
          [x, y + 0.15, -0.03],
          [x + 0.05, y + 1.3, 0.03],
          STEEL,
          m,
        );
      break;
    }
    case 'block': {
      // two cast concrete blocks across the way, a gap between them for walkers
      const y = low(WAY_HALF);
      for (const s of [-1, 1])
        l.box(
          'wall',
          [s * 1.3 - 0.6, y - 0.2, -0.4],
          [s * 1.3 + 0.6, y + 0.6, 0.4],
          CONCRETE,
          m,
        );
      break;
    }
    case 'bollard':
      bollard(l, 0, low(0.2), 0, 0, 0);
      break;
  }
}
