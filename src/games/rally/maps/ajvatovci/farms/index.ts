import { Vector2 } from 'three';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import { newRoadQuery, type RoadQuery } from '../../../world/road';
import type { BuildingDef, PadDef } from '../../shared/types';
import { Local } from '../hilltop/build/shapes';
import { Bucket, tileKey } from '../start-row/build/kit';
import { meshFence } from '../start-row/build/props';
import { buildFarm } from './build';
import { FARMS, roofOf, roofRise } from './models';

/**
 * The village farms and houses the footprint data missed (../village.ts `ADD`): each its own model (models.ts,
 * build.ts) in place of the placeholder box, on its footprint.
 */

const IDS = new Set(FARMS.map((f) => f.b.id));

/** Corners of the footprint grown by `m` (m), world x, z. */
function cornersOf(b: BuildingDef, m: number): [number, number][] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const hw = b.w / 2 + m;
  const hd = b.d / 2 + m;
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as const
  ).map(([u, v]) => [b.x + u * c - v * s, b.z + u * s + v * c]);
}

/** Points round the footprint's edge, about 1 m apart. */
function rimOf(b: BuildingDef): [number, number][] {
  const k = cornersOf(b, 0);
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = k[i];
    const [x1, z1] = k[(i + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
    for (let j = 0; j < n; j++)
      out.push([x0 + ((x1 - x0) * j) / n, z0 + ((z1 - z0) * j) / n]);
  }
  return out;
}

/**
 * Where each building's terrace takes its level: its middle, or (`FarmModel.yard`) its yard's street building or the
 * area-weighted middle of the yard; `road` = at the stage road's height there (a building right beside it).
 */
const LEVEL: { at: [number, number]; road: boolean }[] = FARMS.map(
  ({ b, m }) => {
    const yard = m.yard ? FARMS.filter((f) => f.m.yard === m.yard) : [{ b, m }];
    const st = yard.find((f) => f.m.street);
    if (st) return { at: [st.b.x, st.b.z], road: true };
    if (m.levelAt) return { at: m.levelAt, road: false };
    let x = 0;
    let z = 0;
    let a = 0;
    for (const f of yard) {
      x += f.b.x * f.b.w * f.b.d;
      z += f.b.z * f.b.w * f.b.d;
      a += f.b.w * f.b.d;
    }
    return { at: [x / a, z / a], road: false };
  },
);

/**
 * The building's floor and the foot of its plinth (y): on its terrace, but never below the ground at its edge (the
 * stage road's embankment or a lane's bank can still rise there), and the plinth down to the lowest ground under it.
 */
export function fitOf(
  b: BuildingDef,
  ground: TerrainSampler,
): { base: number; foot: number } {
  const hs = rimOf(b).map(([x, z]) => ground.height(x, z));
  hs.push(ground.height(b.x, b.z));
  const base = Math.max(ground.height(b.x, b.z), Math.max(...hs) - 0.15);
  return { base, foot: Math.min(...hs) - base - 0.4 };
}

/**
 * The terrace each farm building stands on (`MapDef.terrain.pads`): its footprint and 1.5 m round it levelled (at
 * `LEVEL`), blended back into the land - cut into the slope uphill and banked
 * up downhill, as the real farms are. Firm: a neighbour's bank never runs into it.
 */
export function villageFarmPads(): PadDef[] {
  return FARMS.map(({ b }, i) => {
    const pad = {
      name: `farm_${b.id}`,
      polygon: cornersOf(b, 1.5).flat(),
      blend: 6,
      firm: true,
    };
    const { at, road } = LEVEL[i];
    return { ...pad, level: { at, road, lift: road ? 0.12 : 0.05 } };
  });
}

/** A wire-mesh fence round the plot (`FarmModel.fence`), draped on the ground, a 4 m gate in its side nearest the road. */
function plotFence(
  l: Local,
  b: BuildingDef,
  [x0, x1, z0, z1]: [number, number, number, number],
  road: (x: number, z: number) => RoadQuery,
  /** Ground height at a frame point. */
  lift: (x: number, z: number) => number,
): void {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  // Local corner -> offset from the site (the frame's x, z).
  const at = (u: number, v: number) =>
    new Vector2(u * c - v * s, u * s + v * c);
  const corners = [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)];
  const sides = corners.map((p, i) => [p, corners[(i + 1) % 4]]);
  const gap = (side: Vector2[]) => {
    const mid = side[0].clone().lerp(side[1], 0.5);
    const q = road(b.x + mid.x, b.z + mid.y);
    return q.found ? q.distance : Infinity;
  };
  const gate = sides.reduce(
    (g, side, i) => (gap(side) < gap(sides[g]) ? i : g),
    0,
  );
  sides.forEach(([a, e], i) => {
    if (i !== gate) return meshFence(l.frame, [a, e], { lift, endPost: true });
    const len = a.distanceTo(e);
    const t = (len / 2 - 2) / len;
    meshFence(l.frame, [a, a.clone().lerp(e, t)], { lift, gatePost: true });
    meshFence(l.frame, [a.clone().lerp(e, 1 - t), e], {
      lift,
      gatePost: true,
      endPost: true,
    });
  });
}

/** Inside the footprint grown by `m` (m)? */
function inside(b: BuildingDef, x: number, z: number, m: number): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return (
    Math.abs(dx * c + dz * s) < b.w / 2 + m &&
    Math.abs(-dx * s + dz * c) < b.d / 2 + m
  );
}

export const villageFarmsLandmark: Landmark = {
  id: 'ajvatovci-village-farms',

  occupies: (x, z, m) =>
    FARMS.some(({ b, m: model }) => inside(b, x, z, m + roofOf(model).over)),

  replaces: (b) => IDS.has(b.id),

  colliders: (ground) =>
    FARMS.map(({ b, m }): StaticCollider => {
      const hx = b.w / 2;
      const hz = b.d / 2;
      return {
        kind: 'box',
        x: b.x,
        z: b.z,
        y: fitOf(b, ground).base - 0.5,
        h: b.h + roofRise(b, m) + 0.5,
        hx,
        hz,
        rot: -b.angle,
        r: Math.hypot(hx, hz),
      };
    }),

  instances: () => [],

  *build(world) {
    const bucket = new Bucket();
    for (const { b, m } of FARMS) {
      // The doors face the road (the stage road's point nearest the building, on local +z or -z).
      const q = world.road.query(b.x, b.z, newRoadQuery());
      const p = q.found ? world.road.at(q.along) : { x: b.x, z: b.z + 1 };
      const toRoad =
        -(p.x - b.x) * Math.sin(b.angle) + (p.z - b.z) * Math.cos(b.angle) < 0
          ? -1
          : 1;
      // (Some face their yard instead: the model says which.)
      const front = m.back ? -toRoad : toRoad;
      const { base, foot } = fitOf(b, world.analytic);
      const l = new Local(
        bucket,
        tileKey(b.x, b.z),
        { x: b.x, z: b.z, yaw: b.angle },
        base,
      );
      // Local (x, z) to world.
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const wx = (x: number, z: number) => b.x + x * c - z * s;
      const wz = (x: number, z: number) => b.z + x * s + z * c;
      buildFarm(l, b, m, {
        front,
        foot,
        ground: (x, z) => world.analytic.height(wx(x, z), wz(x, z)) - base,
        free: (x, z) =>
          !FARMS.some((o) => o.b !== b && inside(o.b, wx(x, z), wz(x, z), 0.2)),
      });
      if (m.fence)
        plotFence(
          l,
          b,
          m.fence,
          (x, z) => world.road.query(x, z, newRoadQuery()),
          (x, z) => world.analytic.height(b.x + x, b.z + z),
        );
      yield;
    }
    return bucket.build('village-farms');
  },
};
