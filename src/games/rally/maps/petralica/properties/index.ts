import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { ScatterInstance } from '../../../world/scatter';
import { buildProperties, FENCE_TOP } from './build';
import {
  distToLine,
  fenceRuns,
  GATES,
  gateEnds,
  inBounds,
  onTanks,
  pairToWorld,
  TANK,
  TANK_PAIRS,
  tankBase,
  ROAD_TREES,
  YARD_TREES,
  type P,
} from './layout';

/**
 * Hazelnut farm (see layout.ts): chain-link fences on small concrete posts round the plantation and the yard across
 * the road, wooden plank gates on concrete pillars, tall trees lining the road through the hedge, young fruit trees
 * in the yard, two pairs of copper water tanks on concrete sleepers in the plantation. The hazelnut bushes themselves are map scatter on the `hazelnut` cover (bake config manualCover).
 */

const RUNS = fenceRuns();

/** Box collider along a->b (thin wall), base `y`, height `h`. */
function wall(a: P, b: P, y: number, h: number, half = 0.08): StaticCollider {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  return {
    kind: 'box',
    x: (a[0] + b[0]) / 2,
    z: (a[1] + b[1]) / 2,
    y,
    h,
    hx: len / 2,
    hz: half,
    rot: Math.atan2(-dz, dx),
    r: len / 2 + half,
  };
}

export const propertiesLandmark: Landmark = {
  id: 'petralica-properties',

  // Only the fence lines: the plantation keeps its bushes and grass.
  occupies: (x, z, m) =>
    inBounds(x, z) &&
    (onTanks(x, z, m + 0.3) ||
      RUNS.some((run) => distToLine(x, z, run) < 0.6 + m)),

  replaces: () => false,

  colliders: (ground) => {
    const out: StaticCollider[] = [];
    // Fence in pieces of <= 4 m (the ground under a long straight piece varies).
    for (const run of RUNS)
      for (let i = 1; i < run.length; i++) {
        const [ax, az] = run[i - 1];
        const [bx, bz] = run[i];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k < n; k++) {
          const a: P = [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n];
          const b: P = [
            ax + ((bx - ax) * (k + 1)) / n,
            az + ((bz - az) * (k + 1)) / n,
          ];
          const y = Math.min(ground.height(...a), ground.height(...b)) - 0.3;
          out.push(wall(a, b, y, FENCE_TOP + 0.5));
        }
      }
    // Gates (closed) between their pillars.
    for (const g of GATES) {
      const [a, b] = gateEnds(g);
      const y = Math.min(ground.height(...a), ground.height(...b)) - 0.3;
      out.push(wall(a, b, y, 2.2, 0.2));
    }
    // Water tanks (sleepers included: the box starts below the ground).
    for (const pair of TANK_PAIRS) {
      const base = tankBase(pair, (x, z) => ground.height(x, z));
      for (const side of [-1, 1]) {
        const [x, z] = pairToWorld(
          pair,
          0,
          side * ((TANK.width + TANK.gap) / 2),
        );
        const y = base - 1;
        out.push({
          kind: 'box',
          x,
          z,
          y,
          h: base + TANK.height - y,
          hx: TANK.length / 2,
          hz: TANK.width / 2,
          rot: -pair.yaw,
          r: Math.hypot(TANK.length / 2, TANK.width / 2),
        });
      }
    }
    return out;
  },

  instances: (ground: TerrainSampler) => {
    const out: ScatterInstance[] = [];
    const tree = (
      asset: string,
      [x, z]: P,
      i: number,
      scale: number,
      variants = 4,
    ): void => {
      // Deterministic per tree: variant, yaw and size from its index.
      const r = Math.abs(Math.sin(i * 12.9898 + x * 0.1) * 43758.5453) % 1;
      out.push({
        asset,
        variant: i % variants,
        x,
        y: ground.height(x, z) - 0.2,
        z,
        rotY: r * Math.PI * 2,
        scale: scale * (0.9 + r * 0.25),
        tiltX: 0,
        tiltZ: 0,
      });
    };
    // Oaks and tall pale-barked trees (as in Street View).
    ROAD_TREES.forEach((p, i) =>
      tree(
        i % 3 === 1 ? 'pale_tree' : 'oak_tree',
        p,
        i,
        i % 3 === 1 ? 1 : 1.15,
      ),
    );
    YARD_TREES.forEach((p, i) => tree('fruit_tree', p, i, 0.55));
    return out;
  },

  build: buildProperties,
};
