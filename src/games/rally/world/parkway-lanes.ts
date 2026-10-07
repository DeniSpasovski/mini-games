import type { MapDef, PathDef } from '../maps/shared/types';
import { newRoadQuery, type Road } from './road';

/**
 * Parkway lanes (`MapDef.parkwayLanes`): roads that run down in the divided highway's cut beside its carriageways,
 * parallel to the stage road (the inner Union Turnpike lanes beside the Jackie). OSM maps them as ordinary streets,
 * so they are found here by kind / name + running parallel within `reach` m of the stage road, flagged
 * `parkwayLane` (TerrainGenerator.isCarriageway then treats them as carriageways) and moved sideways so the road edges
 * end up GAP apart, room for the barrier: out where OSM draws them overlapping the stage road or a carriageway, in (at
 * most PULL m, eased in from the lane's ends) where a gap is wider - the cut closes up on a narrow stage road.
 *
 * Pure (no scene): node tests run it.
 */

/** Free gap between a parkway lane and the roadway beside it (m): the barrier stands in it. */
const GAP = 1.2;
/** Free gap between a lane and the at-grade street outside it (m): the retaining wall + its footing. */
const WALL_GAP = 1.8;
/** Furthest a lane is pulled in towards the stage road (m), and the length over which the pull eases in from its ends. */
const PULL = 1;
const PULL_EASE = 25;
/** Share of a road's length that must run parallel within reach. */
const MIN_SHARE = 0.7;

function polyLength(pts: number[]): number {
  let L = 0;
  for (let k = 0; k + 3 < pts.length; k += 2)
    L += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return L;
}

/** Point + unit direction at `a` m along a flat polyline. */
function polyAt(pts: number[], a: number): [number, number, number, number] {
  let along = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const dx = pts[k + 2] - pts[k];
    const dz = pts[k + 3] - pts[k + 1];
    const L = Math.hypot(dx, dz);
    if (a <= along + L || k + 5 >= pts.length) {
      const t = L > 0 ? Math.min(1, Math.max(0, (a - along) / L)) : 0;
      return [
        pts[k] + dx * t,
        pts[k + 1] + dz * t,
        dx / (L || 1),
        dz / (L || 1),
      ];
    }
    along += L;
  }
  return [pts[pts.length - 2], pts[pts.length - 1], 1, 0];
}

/** Nearest point of polyline `pts` to (x, z): distance and the point. */
function nearest(
  pts: number[],
  x: number,
  z: number,
): [number, number, number] {
  let best: [number, number, number] = [Infinity, 0, 0];
  for (let j = 0; j + 3 < pts.length; j += 2) {
    const ax = pts[j];
    const az = pts[j + 1];
    const ex = pts[j + 2] - ax;
    const ez = pts[j + 3] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const px = ax + ex * t;
    const pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best[0]) best = [d, px, pz];
  }
  return best;
}

export function markParkwayLanes(
  paths: PathDef[],
  road: Road,
  rule: MapDef['parkwayLanes'],
): PathDef[] {
  if (!rule) return paths;
  const rq = newRoadQuery();
  const isLane = paths.map((p) => {
    if (p.bridge || p.surface !== 'tarmac' || !rule.kinds.includes(p.kind))
      return false;
    if (rule.names && !rule.names.includes(p.name ?? '')) return false;
    // Parallel to the stage road within reach along most of its length.
    const L = polyLength(p.pts);
    let n = 0;
    let ok = 0;
    for (let a = 0; a <= L; a += 4) {
      n++;
      const [x, z, dx, dz] = polyAt(p.pts, a);
      road.query(x, z, rq);
      if (!rq.found || rq.distance > rule.reach) continue;
      const s = road.samples[rq.index];
      if (Math.abs(dx * s.tx + dz * s.tz) > 0.9) ok++;
    }
    return n > 0 && ok / n >= MIN_SHARE;
  });
  const lanes = paths.filter((_, i) => isLane[i]);
  if (!lanes.length) return paths;
  /**
   * Move the nodes of `p` outward (away from the stage road) by what `need` asks for at each node; `pull(along)` > 0
   * lets a negative need move the node inward, by at most that much.
   */
  const push = (
    p: PathDef,
    need: (x: number, z: number, ox: number, oz: number) => number,
    pull?: (along: number) => number,
  ): PathDef => {
    const pts = p.pts.slice();
    let moved = false;
    let along = 0;
    for (let k = 0; k < pts.length; k += 2) {
      if (k > 0)
        along += Math.hypot(
          p.pts[k] - p.pts[k - 2],
          p.pts[k + 1] - p.pts[k - 1],
        );
      road.query(pts[k], pts[k + 1], rq);
      if (!rq.found || rq.distance > rule.reach || rq.distance < 1) continue;
      const s = road.samples[rq.index];
      const side = rq.lateral >= 0 ? 1 : -1;
      // Outward = away from the stage road: left (tz, -tx) times the side.
      const ox = s.tz * side;
      const oz = -s.tx * side;
      let m = need(pts[k], pts[k + 1], ox, oz);
      if (m < 0 && pull) m = Math.max(m, -pull(along));
      else if (m <= 0) continue;
      if (Math.abs(m) < 0.01) continue;
      pts[k] += ox * m;
      pts[k + 1] += oz * m;
      moved = true;
    }
    return moved ? { ...p, pts } : p;
  };
  // 1. A carriageway with a parkway lane beside it keeps a median gap to the stage road (OSM draws the two parkway
  //    carriageways edge to edge there: the median wall had nowhere to stand). Only where a lane runs alongside.
  const out = paths.map((p) => {
    if (
      p.bridge ||
      p.surface !== 'tarmac' ||
      !/^(motorway|trunk)$/.test(p.kind)
    )
      return p;
    const hw = p.width / 2;
    return push(p, (x, z, ox, oz) => {
      const beside = lanes.some((l) => {
        const [d, px, pz] = nearest(l.pts, x, z);
        return d < hw + l.width / 2 + 6 && (px - x) * ox + (pz - z) * oz > 0;
      });
      return beside ? rq.halfWidth + hw + GAP - rq.distance : 0;
    });
  });
  const carriageways = out.filter(
    (p) =>
      !p.bridge && p.surface === 'tarmac' && /^(motorway|trunk)$/.test(p.kind),
  );
  // 2. The lanes: edges GAP clear of the stage road and of the carriageway between (pulled in where wider).
  const done = out.map((p, i) => {
    if (!isLane[i]) return p;
    const hw = p.width / 2;
    const L = polyLength(p.pts);
    const pull = (a: number): number =>
      PULL * Math.min(1, Math.max(0, Math.min(a, L - a) / PULL_EASE));
    const moved = push(
      p,
      (x, z, ox, oz) => {
        let need = rq.halfWidth + hw + GAP - rq.distance;
        for (const c of carriageways) {
          const [d, px, pz] = nearest(c.pts, x, z);
          if (d >= c.width / 2 + hw + GAP) continue;
          // Only a carriageway between the lane and the stage road (it lies on the inner side of this node).
          if ((x - px) * ox + (z - pz) * oz < 0) continue;
          need = Math.max(need, c.width / 2 + hw + GAP - d);
        }
        return need;
      },
      pull,
    );
    // Never joined to the stage road as a side road (it runs beside it, separated by a barrier).
    return { ...moved, parkwayLane: true, junction: false };
  });
  // 3. A street running alongside outside a lane (the at-grade service road) keeps WALL_GAP from it: the cut's
  //    retaining wall stands between them.
  const moved = done.filter((p) => p.parkwayLane);
  return done.map((p) => {
    if (p.parkwayLane || p.bridge || p.surface !== 'tarmac') return p;
    if (/^(motorway|trunk)/.test(p.kind)) return p;
    const hw = p.width / 2;
    return push(p, (x, z, ox, oz) => {
      let need = 0;
      for (const l of moved) {
        const [d, px, pz] = nearest(l.pts, x, z);
        if (d >= l.width / 2 + hw + WALL_GAP) continue;
        // Only a street outside the lane (the lane lies on its inner side).
        if ((x - px) * ox + (z - pz) * oz <= 0) continue;
        need = Math.max(need, l.width / 2 + hw + WALL_GAP - d);
      }
      return need;
    });
  });
}
