import { Vector2 } from 'three';
import { getAssetMeta } from '../../../assets/catalog';
import { Rng } from '../../../../../shared/rng';
import type { ScatterInstance } from '../../../world/scatter';
import { ORIGIN } from './frame';
import {
  getLayout,
  PLOTS,
  VEHICLE_SIZE,
  type VehicleKind,
  type Yard,
} from './layout';

/** Yards (`Plot.name`) that keep goods outside, and the stacks / drums / tanks each gets (SimReady props). */
const GOODS: Record<string, ('pallets' | 'drums' | 'tank')[]> = {
  'south 8': ['pallets', 'tank', 'drums'],
  'south 9': ['drums', 'pallets'],
  'west 3': ['pallets', 'pallets', 'tank'],
  'trailer park': ['pallets'],
};
/** Clear radius (m) of one cluster: its centre keeps this far from the fence, the building and the parked vehicles. */
const CLUSTER_R = 2.6;

const inside = (poly: Vector2[], p: Vector2): boolean => {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if (
      poly[i].y > p.y !== poly[j].y > p.y &&
      p.x <
        ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) /
          (poly[j].y - poly[i].y) +
          poly[i].x
    )
      in_ = !in_;
  return in_;
};

/** Distance (m) from `p` to the nearest edge of the closed polygon. */
const edgeDistance = (poly: Vector2[], p: Vector2): number => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = b.clone().sub(a);
    const t = Math.max(
      0,
      Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)),
    );
    best = Math.min(best, p.distanceTo(a.clone().addScaledVector(ab, t)));
  }
  return best;
};

/**
 * Pallet stacks, crates, drums, an IBC tank, a pallet jack and a parked stacker on the industrial lots: fixed scatter
 * instances (static, one collider each). A cluster goes where its whole footprint is inside the yard, off the building
 * and the parked vehicles; a lot with no such spot gets none.
 */
export function yardPropInstances(
  ground: (x: number, z: number) => number,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const layout = getLayout();
  /** Every parked vehicle's footprint (a trailer reaches well past a few metres from its middle). */
  const vehicles = (
    Object.entries(layout.vehicles) as [
      VehicleKind,
      typeof layout.vehicles.car,
    ][]
  ).flatMap(([kind, list]) =>
    list.map((v) => {
      const { length, width } = VEHICLE_SIZE[kind];
      const f = new Vector2(Math.cos(v.heading), -Math.sin(v.heading));
      const r = new Vector2(-f.y, f.x);
      return [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ].map(([i, j]) =>
        new Vector2(v.x, v.z)
          .addScaledVector(f, (i * length) / 2)
          .addScaledVector(r, (j * width) / 2),
      );
    }),
  );
  const rng = new Rng(8801);
  /** Every building footprint (main, annex, extra) of every lot. */
  const footprints = PLOTS.flatMap((p) =>
    [p.corners, p.annex?.corners, ...(p.more ?? []).map((m) => m.corners)]
      .filter((c): c is [number, number][] => !!c)
      .map((c) => c.map(([x, z]) => new Vector2(x, z))),
  );
  const put = (
    asset: string,
    variant: number,
    at: Vector2,
    rot: number,
  ): void => {
    const x = at.x + ORIGIN.x;
    const z = at.y + ORIGIN.z;
    out.push({
      asset,
      variant: variant % getAssetMeta(asset).variants,
      x,
      y: ground(x, z),
      z,
      rotY: rot,
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
  };
  const spot = (yard: Yard, taken: Vector2[]): Vector2 | undefined => {
    const poly = yard.polygon;
    for (let tries = 0; tries < 60; tries++) {
      const min = new Vector2(
        Math.min(...poly.map((p) => p.x)),
        Math.min(...poly.map((p) => p.y)),
      );
      const max = new Vector2(
        Math.max(...poly.map((p) => p.x)),
        Math.max(...poly.map((p) => p.y)),
      );
      const p = new Vector2(
        min.x + rng.next() * (max.x - min.x),
        min.y + rng.next() * (max.y - min.y),
      );
      if (!inside(poly, p) || edgeDistance(poly, p) < CLUSTER_R) continue;
      if (
        [...footprints, ...vehicles].some(
          (f) => inside(f, p) || edgeDistance(f, p) < CLUSTER_R,
        )
      )
        continue;
      if (taken.some((v) => v.distanceTo(p) < 5)) continue;
      return p;
    }
    return undefined;
  };
  for (const yard of layout.yards) {
    const kinds = GOODS[yard.plot.name];
    if (!kinds) continue;
    const taken: Vector2[] = [];
    for (const kind of kinds) {
      const c = spot(yard, taken);
      if (!c) continue;
      taken.push(c);
      const turn = rng.next() * Math.PI;
      const along = new Vector2(Math.cos(turn), Math.sin(turn));
      const at = (u: number, v: number): Vector2 =>
        c
          .clone()
          .addScaledVector(along, u)
          .addScaledVector(new Vector2(-along.y, along.x), v);
      if (kind === 'pallets') {
        // Two or three stacks in a row (euro / block / plain, 1-4 high), a crate and a pallet jack beside them.
        const n = 2 + rng.int(0, 1);
        for (let i = 0; i < n; i++)
          put(
            'pallet_stack',
            rng.int(0, 2) + 3 * rng.int(0, 3),
            at((i - (n - 1) / 2) * 1.3, 0),
            -turn + (rng.next() - 0.5) * 0.15,
          );
        put('crate', 0, at(-1.6, 1.5), -turn + rng.next() * 0.4);
        put('pallet_jack', 0, at(0.4, -1.5), -turn + rng.range(-0.6, 0.6));
      } else if (kind === 'drums') {
        // A tight group of steel drums and barrels.
        const n = 4 + rng.int(0, 2);
        for (let i = 0; i < n; i++)
          put(
            'drum',
            rng.int(0, 2),
            at((i % 3) * 0.75 - 0.75, Math.floor(i / 3) * 0.75),
            rng.next() * 6.28,
          );
      } else {
        // An IBC tank by a parked stacker.
        put('ibc_tank', 0, at(0, 0), -turn);
        put('forklift', 0, at(2.2, 0.4), -turn + 1.4);
      }
    }
  }
  return out;
}
