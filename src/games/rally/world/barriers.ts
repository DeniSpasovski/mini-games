import type {
  BarrierRule,
  PathBarrierRule,
  SideRoadRail,
} from '../maps/shared/types';
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
  /**
   * Side-road rails: the stretch of the rail line next to `start` (path along) follows this polyline (rail points
   * x, z, cumulative length; `len` m long) out of a stage-road rail end instead of the path.
   */
  bend?: { start: number; dir: 1 | -1; len: number; pts: number[][] };
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
  const b = run.bend;
  const bs = b ? ((along - b.start) * b.dir) / b.len : -1;
  if (b && bs >= 0 && bs <= 1) {
    // On the bend: return the frame whose barrier point (centre + lateral offset) is the polyline point.
    const d = bs * b.len;
    let i = 1;
    while (i < b.pts.length - 1 && b.pts[i][2] < d) i++;
    const [x0, z0, d0] = b.pts[i - 1];
    const [x1, z1, d1] = b.pts[i];
    const k = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    const cx = x0 + (x1 - x0) * k;
    const cz = z0 + (z1 - z0) * k;
    const tl = Math.hypot(x1 - x0, z1 - z0) || 1;
    const tx = ((x1 - x0) / tl) * b.dir;
    const tz = ((z1 - z0) / tl) * b.dir;
    const hw = net.halfWidthAt(run.path, Math.min(L, Math.max(0, along)));
    const lat = run.side * (hw + run.rule.offset);
    return {
      x: cx - tz * lat,
      z: cz + tx * lat,
      tx,
      tz,
      halfWidth: hw,
      curvature: 0,
      deck: false,
      y: NaN,
    };
  }
  // Past an end of the way (a side-road rail's `lead`) the line carries on straight.
  const a = Math.min(L, Math.max(0, along));
  net.pointAt(run.path, Math.max(0, a - 1.5), pa);
  net.pointAt(run.path, Math.min(L, a + 1.5), pb);
  net.pointAt(run.path, a, pc);
  const tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
  const tx = (pb.x - pa.x) / tl;
  const tz = (pb.z - pa.z) / tl;
  return {
    x: pc.x + tx * (along - a),
    z: pc.z + tz * (along - a),
    tx,
    tz,
    halfWidth: net.halfWidthAt(run.path, a),
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

/** How far either side of the crossing a side-road rail's `join` bends (m). */
const JOIN_R = 2.5;

/** Runs of `MapDef.sideRoadRails`: each on the way nearest its `from`, starting where it clears the stage road. */
export function sideRoadRailRuns(
  net: PathNetwork,
  road: Road,
  rules: readonly SideRoadRail[],
): BarrierRun[] {
  const out: BarrierRun[] = [];
  const rq = newRoadQuery();
  const q = newPathQuery();
  const ctx: BarrierContext = { road, net };
  for (const r of rules) {
    net.query(r.from[0], r.from[1], q);
    if (!q.found) continue;
    const path = q.path;
    let a0 = q.along;
    net.query(r.to[0], r.to[1], q, undefined, (p) => p === path);
    const a1 = q.along;
    const dir = a1 >= a0 ? 1 : -1;
    // Left of travel from `from` to `to` = right of the way's own direction when that runs the other way.
    const side: 1 | -1 = (r.side === 'left') === (dir === 1) ? 1 : -1;
    const run: BarrierRun = {
      rule: {
        kind: 'guardrail',
        side: side === 1 ? 'left' : 'right',
        offset: r.offset,
        rusty: r.rusty,
      },
      side,
      from: Math.min(a0, a1),
      to: Math.max(a0, a1),
      path,
    };
    if (r.join) {
      // Curve out of the stage-road rail end: from its end point (along its tangent) to the side rail, over the point
      // where the two rail lines cross; the curve leaves both lines the same distance from that point.
      const rs = r.join.side === 'left' ? 1 : -1;
      const f = road.at(r.join.along);
      const sl = f.halfWidth + r.join.offset;
      const p0: [number, number] = [f.x + f.tz * rs * sl, f.z - f.tx * rs * sl];
      const g = frameAt(ctx, run, a0);
      const gl = side * (g.halfWidth + r.offset);
      const q0 = [g.x + g.tz * gl, g.z - g.tx * gl];
      const tqx = g.tx * dir;
      const tqz = g.tz * dir;
      // p0 + u * (f.tx, f.tz) = q0 + v * tq  (the stage rail runs on in the direction of travel past its end)
      const det = f.tx * -tqz - f.tz * -tqx;
      if (Math.abs(det) < 1e-3) continue;
      const dx = q0[0] - p0[0];
      const dz = q0[1] - p0[1];
      const u = (dx * -tqz - dz * -tqx) / det;
      const v = (f.tx * dz - f.tz * dx) / det;
      // Straight on along the road edge, then a small bend (JOIN_R m either side of the crossing) into the side rail.
      const r0 = Math.min(JOIN_R, Math.abs(u));
      const X = [p0[0] + f.tx * u, p0[1] + f.tz * u];
      const pA = [X[0] - f.tx * r0, X[1] - f.tz * r0];
      const pB = [q0[0] + tqx * (v + r0), q0[1] + tqz * (v + r0)];
      const pts: number[][] = [[p0[0], p0[1], 0]];
      const push = (x: number, z: number) => {
        const [px, pz, pd] = pts[pts.length - 1];
        pts.push([x, z, pd + Math.hypot(x - px, z - pz)]);
      };
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const w = 1 - t;
        push(
          w * w * pA[0] + 2 * w * t * X[0] + t * t * pB[0],
          w * w * pA[1] + 2 * w * t * X[1] + t * t * pB[1],
        );
      }
      const len = pts[pts.length - 1][2];
      a0 = a0 + dir * (v + r0) - dir * len;
      run.bend = { start: a0, dir, len, pts };
    } else
      for (; (a1 - a0) * dir > 0; a0 += 0.5 * dir) {
        const f = frameAt(ctx, run, a0);
        const lat = side * (f.halfWidth + r.offset);
        road.query(f.x + f.tz * lat, f.z - f.tx * lat, rq);
        if (!rq.found || rq.distance > rq.halfWidth + 1.2) break;
      }
    run.from = Math.min(a0, a1);
    run.to = Math.max(a0, a1);
    if (run.to - run.from >= 3) out.push(run);
  }
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
  // On a bridge span the sampler reads the ground under the deck (a parapet collider 1-2 m too low: cars drive over it);
  // under a portal slab it reads the slab top. A stage-road barrier stands on the road in both.
  let y = ground.height(x, z);
  if (run.path === undefined && (s.deck || y > s.y + 1)) y = s.y;
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
    if (run.rule.kind === 'edge' || run.rule.kind === 'gutter') continue;
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
