import type { BarrierRule, PathBarrierRule } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import { newRoadQuery, type Road } from './road';
import { newPathQuery, type PathNetwork } from './real-data';

/**
 * Continuous roadside barriers (MapDef.barriers, MapDef.pathBarriers): where along the road (or along
 * another carriageway, a "path") each rule applies, the centre line of every run (sampled for the swept
 * mesh in barrier-mesh.ts) and its colliders. Pure (no three.js scene) so the world tests can run it.
 */

export interface BarrierRun {
  rule: BarrierRule;
  /** +1 = left of travel, -1 = right. */
  side: 1 | -1;
  /** Distance along the road (or along `path`) at the start / end of the run (m). */
  from: number;
  to: number;
  /** Set: the run follows this path of the network instead of the stage road. */
  path?: number;
}

/** What the barrier code needs to know about the road a run follows. */
export interface BarrierContext {
  road: Road;
  net?: PathNetwork;
}

/** Centre line frame of a run's road at `along`. */
export interface RunFrame {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  tz: number;
  halfWidth: number;
  /** Signed curvature (1/m), 0 for paths. */
  curvature: number;
  /** Stage road only: on a bridge span (the barrier follows the deck). */
  deck: boolean;
  /** Road surface height when known (stage road centre), else NaN. */
  y: number;
}

const pa = { x: 0, z: 0 };
const pb = { x: 0, z: 0 };
const pc = { x: 0, z: 0 };

export function frameAt(
  ctx: BarrierContext,
  run: BarrierRun,
  along: number,
): RunFrame {
  if (run.path === undefined) {
    const s = ctx.road.at(along);
    return {
      x: s.x,
      z: s.z,
      tx: s.tx,
      tz: s.tz,
      halfWidth: s.halfWidth,
      curvature: s.curvature,
      deck: !!ctx.road.bridgeAt(along),
      y: s.y,
    };
  }
  const net = ctx.net!;
  const L = net.lengths[run.path];
  net.pointAt(run.path, Math.max(0, along - 1.5), pa);
  net.pointAt(run.path, Math.min(L, along + 1.5), pb);
  net.pointAt(run.path, along, pc);
  const tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
  return {
    x: pc.x,
    z: pc.z,
    tx: (pb.x - pa.x) / tl,
    tz: (pb.z - pa.z) / tl,
    halfWidth: net.halfWidthAt(run.path, along),
    curvature: 0,
    deck: false,
    y: NaN,
  };
}

/** Length of the run's road (m). */
export function runLength(ctx: BarrierContext, run: BarrierRun): number {
  return run.path === undefined ? ctx.road.length : ctx.net!.lengths[run.path];
}

/** Barrier lateral offset limits: it never sits closer to the road than its own half thickness. */
const STEP = 1;

/** Runs of every rule: unbroken stretches (bridge spans / junction mouths break them). */
export function barrierRuns(
  road: Road,
  rules: readonly BarrierRule[],
  junctions: readonly { along: number; width: number; side: 1 | -1 }[] = [],
  /** The barrier point (x, z) at `along` stands on another road at the road's level (a ramp merging alongside). */
  onRoad?: (x: number, z: number, along: number) => boolean,
): BarrierRun[] {
  const out: BarrierRun[] = [];
  for (const rule of rules) {
    const sides: (1 | -1)[] =
      rule.side === 'both' ? [1, -1] : rule.side === 'left' ? [1] : [-1];
    const lo = Math.max(0, rule.from ?? 0);
    const hi = Math.min(road.length, rule.to ?? road.length);
    for (const side of sides) {
      let start = -1;
      for (let a = lo; a <= hi + 1e-6; a += STEP) {
        let ok = true;
        if (rule.onBridge !== undefined && !!road.bridgeAt(a) !== rule.onBridge)
          ok = false;
        if (
          ok &&
          rule.skipJunctions !== undefined &&
          junctions.some(
            (j) =>
              j.side === side &&
              Math.abs(j.along - a) < rule.skipJunctions! + j.width / 2,
          )
        )
          ok = false;
        if (ok && onRoad) {
          const f = road.at(a);
          const lat = side * (f.halfWidth + rule.offset);
          if (onRoad(f.x + f.tz * lat, f.z - f.tx * lat, a)) ok = false;
        }
        if (ok && start < 0) start = a;
        if ((!ok || a + STEP > hi + 1e-6) && start >= 0) {
          // A run ends AT the first sample it no longer holds: the next rule's run (bridge / open road) starts there.
          const end = ok ? Math.min(hi, a) : a;
          if (end - start >= 3) out.push({ rule, side, from: start, to: end });
          start = -1;
        }
      }
    }
  }
  return out;
}

/** Sample spacing of the path barrier analysis (m). */
const PATH_STEP = 2;
/** Shortest path barrier worth building (m). */
const PATH_MIN_RUN = 8;

/**
 * Barrier runs along the other carriageways (paths of `rule.kinds`, ground level - decks have their own
 * parapets). On each side the barrier is a Jersey wall when another carriageway (the stage road or a
 * second mainline path) lies across the median within `medianReach`, otherwise a guard rail. Runs break
 * where the barrier would stand on the stage road or on another road (ramp mouths, merges, junctions).
 */
export function pathBarrierRuns(
  net: PathNetwork,
  road: Road,
  isDeck: (path: number) => boolean,
  rule: PathBarrierRule,
  /** Paved over (a junction plaza on a portal slab, plazas.ts): no barrier. */
  paved?: (x: number, z: number) => boolean,
  /** Roads in the highway's cut beside the carriageways (MapDef.parkwayLanes): mainline too. */
  isLane?: (path: number) => boolean,
): BarrierRun[] {
  const out: BarrierRun[] = [];
  const reach = rule.medianReach ?? 40;
  const rq = newRoadQuery();
  const pq = newPathQuery();
  const ctx: BarrierContext = { road, net };
  const mainline = (qi: number): boolean => {
    const q = net.paths[qi];
    return (
      !isDeck(qi) &&
      ((rule.kinds.includes(q.kind) && q.width >= (rule.minWidth ?? 0)) ||
        !!isLane?.(qi))
    );
  };
  // Paths that continue path `pi` end to end (one carriageway split into several OSM ways).
  const ends = net.paths.map((p) => {
    const n = p.pts.length;
    return [p.pts[0], p.pts[1], p.pts[n - 2], p.pts[n - 1]];
  });
  const continues = (pi: number, qi: number): boolean => {
    const a = ends[pi];
    const b = ends[qi];
    for (const i of [0, 2])
      for (const j of [0, 2])
        if (Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1]) < 2.5) return true;
    return false;
  };
  const probe = (pi: number, qx: number, qz: number) => {
    // Another road under the barrier (ramp, street, merge) - only the part that really covers it.
    net.query(
      qx,
      qz,
      pq,
      undefined,
      (qi) =>
        qi !== pi &&
        !isDeck(qi) &&
        // Only the same carriageway split into OSM ways is exempt: an exit ramp / entrance forking off at the shared
        // node lies beside the carriageway (the wall belongs between them), not on it.
        (!continues(pi, qi) || net.paths[qi].kind !== net.paths[pi].kind),
    );
    return pq.found && pq.distance <= pq.halfWidth + 0.3;
  };
  net.paths.forEach((p, pi) => {
    if (!mainline(pi) || p.surface !== 'tarmac') return;
    const L = net.lengths[pi];
    if (L < PATH_MIN_RUN) return;
    for (const side of [1, -1] as const) {
      // Per-sample state: 0 = no barrier, 1 = jersey, 2 = guard rail.
      const n = Math.ceil(L / PATH_STEP) + 1;
      const state = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.min(L, i * PATH_STEP);
        const f = frameAt(
          ctx,
          { rule: {} as BarrierRule, side, from: 0, to: L, path: pi },
          a,
        );
        const lx = f.tz * side;
        const lz = -f.tx * side;
        const off = (o: number) => ({
          x: f.x + lx * (f.halfWidth + o),
          z: f.z + lz * (f.halfWidth + o),
        });
        // The barrier would stand on the stage road or on another road: broken here.
        const wallOff = Math.max(rule.median.offset, rule.outer.offset);
        const bp = off(wallOff);
        road.query(bp.x, bp.z, rq);
        if (rq.found && rq.distance <= rq.halfWidth + 1.2) continue;
        if (probe(pi, bp.x, bp.z)) continue;
        if (paved?.(bp.x, bp.z)) continue;
        // Median side: the stage road or another mainline carriageway lies across the median.
        let median = false;
        for (let m = 5; m <= reach && !median; m += 4) {
          const q = off(m);
          road.query(q.x, q.z, rq);
          if (rq.found && rq.distance <= rq.halfWidth) median = true;
          else {
            net.query(
              q.x,
              q.z,
              pq,
              undefined,
              (qi) => qi !== pi && mainline(qi) && !continues(pi, qi),
            );
            if (pq.found && pq.distance <= pq.halfWidth) median = true;
          }
        }
        // A parkway lane's inner side: the roadway beside it (stage road / carriageway) has the wall there.
        if (median && isLane?.(pi)) continue;
        const r = median ? rule.median : rule.outer;
        state[i] = r.kind === 'jersey' ? 1 : 2;
      }
      // One more pass: a lone different sample inside a run takes its neighbours' kind.
      for (let i = 1; i < n - 1; i++)
        if (
          state[i] !== 0 &&
          state[i - 1] === state[i + 1] &&
          state[i] !== state[i - 1] &&
          state[i - 1] !== 0
        )
          state[i] = state[i - 1];
      let start = 0;
      for (let i = 1; i <= n; i++) {
        if (i < n && state[i] === state[start]) continue;
        const k = state[start];
        const from = Math.min(L, start * PATH_STEP);
        const to = Math.min(L, (i - 1) * PATH_STEP);
        if (k !== 0 && to - from >= PATH_MIN_RUN) {
          const r = k === 1 ? 'jersey' : 'guardrail';
          const cfg = [rule.median, rule.outer].find((c) => c.kind === r)!;
          out.push({
            rule: {
              kind: r,
              side: side === 1 ? 'left' : 'right',
              offset: cfg.offset,
            },
            side,
            from,
            to,
            path: pi,
          });
        }
        start = i;
      }
    }
  });
  return out;
}

/** Point on a run's centre line at `along` (x, z, height, unit tangent of the road). */
export function barrierPoint(
  ctx: BarrierContext,
  ground: TerrainSampler,
  run: BarrierRun,
  along: number,
): { x: number; z: number; y: number; tx: number; tz: number } {
  const s = frameAt(ctx, run, along);
  const lat = run.side * (s.halfWidth + run.rule.offset);
  // left = (tz, -tx)
  const x = s.x + s.tz * lat;
  const z = s.z - s.tx * lat;
  // Under a portal slab the surface sampler reads the slab top: a stage-road barrier stands on the road there.
  let y = ground.height(x, z);
  if (run.path === undefined && y > s.y + 1) y = s.y;
  return { x, z, y, tx: s.tx, tz: s.tz };
}

/** Box colliders along every run (one per ~4 m, following the curve). */
export function barrierColliders(
  ctx: BarrierContext,
  ground: TerrainSampler,
  runs: readonly BarrierRun[],
): StaticCollider[] {
  const out: StaticCollider[] = [];
  for (const run of runs) {
    const guard = run.rule.kind === 'guardrail';
    const half = guard ? 0.12 : 0.3;
    for (let a = run.from; a < run.to; a += 4) {
      const b = Math.min(run.to, a + 4);
      const p0 = barrierPoint(ctx, ground, run, a);
      const p1 = barrierPoint(ctx, ground, run, b);
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const hx = len / 2 + 0.05;
      out.push({
        kind: 'box',
        x: (p0.x + p1.x) / 2,
        z: (p0.z + p1.z) / 2,
        y: Math.min(p0.y, p1.y) - 0.1,
        h: guard ? 0.8 : 0.9,
        hx,
        hz: half,
        // three.js yaw maps local +X to (cos t, -sin t); the barrier runs along (dx, dz).
        rot: -Math.atan2(dz, dx),
        r: Math.hypot(hx, half),
      });
    }
  }
  return out;
}
