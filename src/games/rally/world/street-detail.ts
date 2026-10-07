import type { CityStreets } from '../maps/shared/types';
import { newPathQuery, type PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';

/**
 * Street detail of city maps (MapDef.cityStreets): where the streets near the stage road have kerbs and
 * sidewalks, where crosswalks go and where the lamps stand. Pure (no scene), the world tests run it;
 * `street-detail-mesh.ts` builds the meshes, `street-dressing.ts` places the lamps from the same runs.
 */

/** OSM kinds of the streets that get detail. */
export const STREET_KINDS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
]);

/** Kerb return radius (m) by street class: a residential corner is tight, an avenue's wide. */
const CORNER_R: Record<string, number> = {
  primary: 6.5,
  secondary: 5,
  tertiary: 5,
};
const CORNER_R_DEFAULT = 3.2;
/** Corner pairing: the two run ends lie within this of the corner point (m) and the streets meet at 55-150 deg. */
const CORNER_REACH = 7;
const MIN_RUN_AFTER = 4;

export const KERB_W = 0.17;
export const KERB_H = 0.15;
/** Sample spacing of the analysis (m). */
const STEP = 2;
const MIN_RUN = 6;
/** Crosswalk distance from the junction (m) and length along the street. */
export const CROSS_SETBACK = 5.2;
export const CROSS_LEN = 2.6;

export interface SidewalkRun {
  path: number;
  side: 1 | -1;
  from: number;
  to: number;
  /** Sidewalk width (m): the measured one of a modelled street (`PathDef.sidewalk`), else the map's. */
  width: number;
  /** Driveway kerb cuts: [from, to] m along the street where a driveway crosses the sidewalk (the kerb drops flush). */
  cuts?: [number, number][];
}

/** A service way at most this wide that ends at a street is a driveway: the sidewalk runs across it (kerb cut). */
const DRIVEWAY_W = 5;
/** ... crossing the sidewalk (|cos| to the street below this); one running along the street ends the sidewalk. */
const DRIVEWAY_COS = 0.8;

export interface Crossing {
  path: number;
  /** Distance along the path of the crosswalk centre. */
  at: number;
  /** The junction is at the end of the path (else at its start): traffic arrives going towards it. */
  atEnd: boolean;
}

/**
 * A rounded kerb corner where two streets meet: both sidewalk runs end at the fillet's tangent points (`ax, az` on the first
 * street's kerb line, `bx, bz` on the second's), the kerb runs round the arc (centre `cx, cz`, `radius`, from angle `a0`
 * through `sweep`) and the sliver between the arc and the corner point `px, pz` (where the two kerb lines meet) is paved.
 */
export interface Corner {
  /** Sidewalk width round the corner (m). */
  width: number;
  cx: number;
  cz: number;
  radius: number;
  a0: number;
  sweep: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  px: number;
  pz: number;
}

export interface StreetDetail {
  runs: SidewalkRun[];
  crossings: Crossing[];
  /** Rounded kerb corners at the street-to-street junctions (runs already shortened to them). */
  corners: Corner[];
}

export interface StreetContext {
  road: Road;
  net: PathNetwork;
  /** Distance to the stage road centre line (m), any range. */
  roadDistance: (x: number, z: number) => number;
  /** A building within `r` m of the point. */
  blocked: (x: number, z: number, r: number) => boolean;
  /** The street lies down in an underpass trench at `a` m: the roads above it (stage road, carriageways) are no obstacle. */
  underpass?: (path: number, along: number) => boolean;
  /** No kerbs / sidewalks / crosswalks on this street (a lane in the highway's cut). */
  skip?: (path: number) => boolean;
  /** On a junction plaza (plazas.ts), or within `pad` m of it: no sidewalks there, crosswalks at its edge. */
  plaza?: (x: number, z: number, pad?: number) => boolean;
  /** The plazas have their own crosswalks (MapDef.plazaCrosswalks): none per street mouth at their edge... */
  plazaCrosswalks?: boolean;
  /** ... except at a junction core's edge (a junction area without ribbons, `Plazas.insideCore`): the streets' own crosswalks. */
  core?: (x: number, z: number, pad?: number) => boolean;
  /**
   * A street deck on a portal slab (the street at the structure's level): it has sidewalks like the ground street,
   * the roads beneath it are no obstacle.
   */
  deck?: (path: number) => boolean;
}

export function streetDetail(
  cfg: CityStreets,
  ctx: StreetContext,
): StreetDetail {
  const { net, road } = ctx;
  const W = cfg.sidewalk ?? 1.5;
  const runs: SidewalkRun[] = [];
  const crossings: Crossing[] = [];
  const rq = newRoadQuery();
  const pq = newPathQuery();
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  // Paths that continue another end to end (one street split into OSM ways) are not junctions.
  const ends = net.paths.map((p) => {
    const n = p.pts.length;
    return [p.pts[0], p.pts[1], p.pts[n - 2], p.pts[n - 1]];
  });
  const continues = (a: number, b: number): boolean => {
    const ea = ends[a];
    const eb = ends[b];
    for (const i of [0, 2])
      for (const j of [0, 2])
        if (Math.hypot(ea[i] - eb[j], ea[i + 1] - eb[j + 1]) < 2.5) return true;
    return false;
  };
  const eligible = (pi: number) => {
    const p = net.paths[pi];
    return (
      (!p.bridge || !!ctx.deck?.(pi)) &&
      !ctx.skip?.(pi) &&
      p.surface === 'tarmac' &&
      STREET_KINDS.has(p.kind) &&
      net.lengths[pi] >= 14
    );
  };
  // An end where exactly one other street way continues (an OSM joint, no junction): the sidewalk runs on.
  const joint = (pi: number, atEnd: boolean): boolean => {
    const k = atEnd ? 2 : 0;
    const x = ends[pi][k];
    const z = ends[pi][k + 1];
    let n = 0;
    let street = true;
    ends.forEach((e, qi) => {
      if (qi === pi) return;
      for (const j of [0, 2])
        if (Math.hypot(e[j] - x, e[j + 1] - z) < 2.5) {
          n++;
          street &&= eligible(qi);
        }
    });
    return n === 1 && street;
  };
  /** Driveway `qi` meets street `pi` (one of its ends lies on the street or just beside it). */
  const drivewayOf = (qi: number, pi: number): boolean => {
    const q = net.paths[qi];
    if (q.kind !== 'service' || q.width > DRIVEWAY_W || q.bridge) return false;
    const e = ends[qi];
    for (const k of [0, 2]) {
      net.query(e[k], e[k + 1], pq, undefined, (i) => i === pi);
      if (pq.found && pq.distance <= pq.halfWidth + 1.5) return true;
    }
    return false;
  };
  const dq = newPathQuery();
  const d0 = { x: 0, z: 0 };
  const d1 = { x: 0, z: 0 };
  /** Way `qi` at `along` crosses a street heading (tx, tz) rather than running beside it. */
  const crossing = (qi: number, along: number, tx: number, tz: number) => {
    net.pointAt(qi, Math.max(0, along - 1.5), d0);
    net.pointAt(qi, Math.min(net.lengths[qi], along + 1.5), d1);
    const l = Math.hypot(d1.x - d0.x, d1.z - d0.z) || 1;
    return (
      Math.abs(((d1.x - d0.x) * tx + (d1.z - d0.z) * tz) / l) < DRIVEWAY_COS
    );
  };
  net.paths.forEach((p, pi) => {
    if (!eligible(pi)) return;
    const L = net.lengths[pi];
    const hw = p.width / 2;
    const lo = joint(pi, false) ? -1 : 3;
    const hi = joint(pi, true) ? L + 1 : L - 3;
    for (const side of [1, -1] as const) {
      // Modelled streets: the measured sidewalk (none where the real street has none), clamped to a believable range.
      const own = p.sidewalk?.[side > 0 ? 0 : 1];
      if (own !== undefined && own < 0.8) continue;
      const Wd = own === undefined ? W : Math.min(4.5, Math.max(1.2, own));
      let start = -1;
      let cuts: [number, number][] = [];
      for (let a = 0; a <= L + 1e-6; a += STEP) {
        net.pointAt(pi, Math.max(0, a - 1.5), pt);
        net.pointAt(pi, Math.min(L, a + 1.5), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, a, pt);
        let ok = ctx.roadDistance(pt.x, pt.z) <= cfg.reach && a > lo && a < hi;
        const below = !!ctx.underpass?.(pi, a);
        const over = !!ctx.deck?.(pi);
        let cut = false;
        if (ok) {
          // Kerb line and the outer edge of the sidewalk must be clear of other roads, the stage road, buildings
          // (not of the roads above an underpass: they pass over it).
          for (const o of [0.3, KERB_W + Wd]) {
            const lat = side * (hw + o);
            const x = pt.x + tz * lat;
            const z = pt.z - tx * lat;
            road.query(x, z, rq);
            if (!below && !over && rq.found && rq.distance <= rq.halfWidth + 3)
              ok = false;
            net.query(
              x,
              z,
              dq,
              undefined,
              (qi) =>
                qi !== pi &&
                !net.paths[qi].bridge &&
                !continues(pi, qi) &&
                !(below && /^(motorway|trunk)/.test(net.paths[qi].kind)),
            );
            if (!over && dq.found && dq.distance <= dq.halfWidth + 0.4) {
              // a driveway crossing the sidewalk: it runs on across it with the kerb dropped (one running along the
              // street ends it like any other road)
              if (
                drivewayOf(dq.path, pi) &&
                crossing(dq.path, dq.along, tx, tz)
              )
                cut = true;
              else ok = false;
            }
            if (ctx.blocked(x, z, 0.15)) ok = false;
            if (ctx.plaza?.(x, z, 1)) ok = false;
            if (!ok) break;
          }
        }
        if (ok && start < 0) start = a;
        if (ok && cut) {
          const last = cuts[cuts.length - 1];
          if (last && a - last[1] <= STEP + 0.01) last[1] = a;
          else cuts.push([a, a]);
        }
        if ((!ok || a + STEP > L) && start >= 0) {
          // Through a joint the run reaches the way's very end (the 2 m samples stopped short: a hole at the joint).
          const end = ok ? (hi > L && a + STEP > L ? L : a) : a - STEP;
          // (a cut is widened by half a sample each way: the driveway's edges lie between the samples)
          const own = cuts
            .filter(([c0, c1]) => c1 >= start && c0 <= end)
            .map(
              ([c0, c1]) => [c0 - STEP / 2, c1 + STEP / 2] as [number, number],
            );
          if (end - start >= MIN_RUN)
            runs.push({
              path: pi,
              side,
              from: start,
              to: end,
              width: Wd,
              ...(own.length ? { cuts: own } : {}),
            });
          start = -1;
          cuts = [];
        }
      }
    }
    // Crosswalks where the street enters a junction plaza: just outside its edge (the plaza is the junction box).
    const box = ctx.plazaCrosswalks ? ctx.core : ctx.plaza;
    if (box) {
      let prev = false;
      for (let a = 0; a <= L + 1e-6; a += 1) {
        net.pointAt(pi, Math.min(a, L), pt);
        const inside = box(pt.x, pt.z);
        if (a > 0 && inside !== prev) {
          // Entering (inside now): the crosswalk before it; leaving: after it.
          const at = inside
            ? a - 1 - CROSS_LEN / 2 - 0.5
            : a + CROSS_LEN / 2 + 0.5;
          if (at > CROSS_LEN && at < L - CROSS_LEN && p.width >= 4)
            crossings.push({ path: pi, at, atEnd: inside });
        }
        prev = inside;
      }
    }
    // Crosswalks where this street ends at another street (T junction), a few metres before the junction.
    for (const atEnd of [false, true]) {
      const e = atEnd ? L : 0;
      net.pointAt(pi, e, pt);
      if (ctx.roadDistance(pt.x, pt.z) > cfg.reach) continue;
      road.query(pt.x, pt.z, rq);
      if (rq.found && rq.distance <= rq.halfWidth + 25) continue; // a stage-road junction: closed by barriers
      net.query(
        pt.x,
        pt.z,
        pq,
        undefined,
        (qi) => qi !== pi && !net.paths[qi].bridge && !continues(pi, qi),
      );
      if (!pq.found || pq.distance > pq.halfWidth + 1) continue;
      if (ctx.plaza?.(pt.x, pt.z, CROSS_SETBACK + CROSS_LEN)) continue; // the plaza edge has its own
      // Wide enough street, and room for the crosswalk.
      if (L < CROSS_SETBACK * 2 + 4 || p.width < 4) continue;
      crossings.push({
        path: pi,
        at: atEnd ? L - CROSS_SETBACK : CROSS_SETBACK,
        atEnd,
      });
    }
  });
  const corners = roundCorners(cfg, net, runs, road);
  return { runs, crossings, corners };
}

/**
 * Kerb return radii: sidewalk runs of two different streets that end at the same corner (cut where the other street's
 * roadway begins) are pulled back to the tangent points of a fillet arc between their kerb lines. Mutates `runs`.
 */
function roundCorners(
  _cfg: CityStreets,
  net: PathNetwork,
  runs: SidewalkRun[],
  road: Road,
): Corner[] {
  const pqc = newPathQuery();
  const rqc = newRoadQuery();
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  interface End {
    ri: number;
    atEnd: boolean;
    /** Kerb line point at the run end, unit direction towards the junction, unit outward (towards the sidewalk). */
    kx: number;
    kz: number;
    dx: number;
    dz: number;
    ox: number;
    oz: number;
    along: number;
    used: boolean;
  }
  const ends: End[] = [];
  const endOf = (ri: number, atEnd: boolean): End | undefined => {
    const r = runs[ri];
    const L = net.lengths[r.path];
    const s0 = atEnd ? r.to : r.from;
    // A run that reaches the very end of its way continues into the next way (an OSM joint) or leaves the map: no corner.
    if (s0 <= 0.5 || s0 >= L - 0.5) return undefined;
    net.pointAt(r.path, Math.max(0, s0 - 1.5), a);
    net.pointAt(r.path, Math.min(L, s0 + 1.5), b);
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / tl;
    const tz = (b.z - a.z) / tl;
    net.pointAt(r.path, s0, a);
    const hw = net.halfWidthAt(r.path, s0);
    const lx = tz * r.side; // outward (away from the street centre)
    const lz = -tx * r.side;
    const sgn = atEnd ? 1 : -1;
    return {
      ri,
      atEnd,
      kx: a.x + lx * hw,
      kz: a.z + lz * hw,
      dx: tx * sgn,
      dz: tz * sgn,
      ox: lx,
      oz: lz,
      along: s0,
      used: false,
    };
  };
  runs.forEach((_r, ri) => {
    for (const atEnd of [false, true]) {
      const e = endOf(ri, atEnd);
      if (e) ends.push(e);
    }
  });
  const corners: Corner[] = [];
  const rOf = (path: number) =>
    CORNER_R[net.paths[path].kind] ?? CORNER_R_DEFAULT;
  for (let i = 0; i < ends.length; i++) {
    const e1 = ends[i];
    if (e1.used) continue;
    let best:
      | { e2: End; s: number; u: number; px: number; pz: number; score: number }
      | undefined;
    for (let j = 0; j < ends.length; j++) {
      const e2 = ends[j];
      if (j === i || e2.used) continue;
      if (runs[e1.ri].path === runs[e2.ri].path) continue;
      if (Math.hypot(e1.kx - e2.kx, e1.kz - e2.kz) > 14) continue;
      // Kerb lines k1 + s d1 and k2 + u d2 meet at the corner point.
      const det = e1.dx * e2.dz - e1.dz * e2.dx;
      if (Math.abs(det) < 0.4) continue;
      const rx = e2.kx - e1.kx;
      const rz = e2.kz - e1.kz;
      const s = (rx * e2.dz - rz * e2.dx) / det;
      const u = (rx * e1.dz - rz * e1.dx) / det;
      if (s < -1 || s > CORNER_REACH || u < -1 || u > CORNER_REACH) continue;
      // The wedge between the two sidewalks: each run's outward side faces the other street's sidewalk.
      const ax = -e1.dx;
      const az = -e1.dz;
      const bx = -e2.dx;
      const bz = -e2.dz;
      if (e1.ox * bx + e1.oz * bz <= 0.1 || e2.ox * ax + e2.oz * az <= 0.1)
        continue;
      const score = Math.abs(s) + Math.abs(u);
      if (!best || score < best.score)
        best = {
          e2,
          s,
          u,
          px: e1.kx + e1.dx * s,
          pz: e1.kz + e1.dz * s,
          score,
        };
    }
    if (!best) continue;
    const e2 = best.e2;
    const ax = -e1.dx;
    const az = -e1.dz;
    const bx = -e2.dx;
    const bz = -e2.dz;
    const cosPhi = ax * bx + az * bz;
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
    if (phi < 0.96 || phi > 2.62) continue; // 55 - 150 deg
    const r1 = runs[e1.ri];
    const r2 = runs[e2.ri];
    const cw = (r1.width + r2.width) / 2;
    const R = Math.max(
      rOf(r1.path),
      rOf(r2.path),
      KERB_W + Math.max(r1.width, r2.width) + 0.8,
    );
    const t = R / Math.tan(phi / 2);
    // pull each run end back to its tangent point (t from the corner along its kerb line); the end now sits `s` / `u` before it
    const move1 = t - best.s;
    const move2 = t - best.u;
    const len = (r: SidewalkRun) => r.to - r.from;
    if (len(r1) - move1 < MIN_RUN_AFTER || len(r2) - move2 < MIN_RUN_AFTER)
      continue;
    const L1 = net.lengths[r1.path];
    const L2 = net.lengths[r2.path];
    const n1 = e1.atEnd ? r1.to - move1 : r1.from + move1;
    const n2 = e2.atEnd ? r2.to - move2 : r2.from + move2;
    if (n1 < 0 || n1 > L1 || n2 < 0 || n2 > L2) continue;
    // the fillet circle: inside the block, on the bisector
    const mx = ax + bx;
    const mz = az + bz;
    const ml = Math.hypot(mx, mz) || 1;
    const dist = R / Math.sin(phi / 2);
    const cx = best.px + (mx / ml) * dist;
    const cz = best.pz + (mz / ml) * dist;
    const tax = best.px + ax * t;
    const taz = best.pz + az * t;
    const tbx = best.px + bx * t;
    const tbz = best.pz + bz * t;
    const a0 = Math.atan2(taz - cz, tax - cx);
    let sweep = Math.atan2(tbz - cz, tbx - cx) - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    // the arc (and its sidewalk) must lie off every street's lanes and off the stage road
    let clear = true;
    const steps = Math.max(8, Math.ceil((Math.abs(sweep) * R) / 0.5));
    for (let k = 0; k <= steps && clear; k++) {
      const al = a0 + (sweep * k) / steps;
      const x = cx + Math.cos(al) * R;
      const z = cz + Math.sin(al) * R;
      net.query(x, z, pqc, 'tarmac', (qi) => !net.paths[qi].bridge);
      if (pqc.found && pqc.distance < pqc.halfWidth - 0.2) clear = false;
      road.query(x, z, rqc);
      if (rqc.found && rqc.distance < rqc.halfWidth + 0.5) clear = false;
    }
    if (!clear) continue;
    if (e1.atEnd) r1.to = n1;
    else r1.from = n1;
    if (e2.atEnd) r2.to = n2;
    else r2.from = n2;
    e1.used = e2.used = true;
    corners.push({
      width: cw,
      cx,
      cz,
      radius: R,
      a0,
      sweep,
      ax: tax,
      az: taz,
      bx: tbx,
      bz: tbz,
      px: best.px,
      pz: best.pz,
    });
  }
  return corners;
}
