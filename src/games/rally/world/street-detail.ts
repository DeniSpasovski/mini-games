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
}

export interface Crossing {
  path: number;
  /** Distance along the path of the crosswalk centre. */
  at: number;
  /** The junction is at the end of the path (else at its start): traffic arrives going towards it. */
  atEnd: boolean;
}

export interface StreetDetail {
  runs: SidewalkRun[];
  crossings: Crossing[];
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
      !p.bridge &&
      p.surface === 'tarmac' &&
      STREET_KINDS.has(p.kind) &&
      net.lengths[pi] >= 14
    );
  };
  net.paths.forEach((p, pi) => {
    if (!eligible(pi)) return;
    const L = net.lengths[pi];
    const hw = p.width / 2;
    for (const side of [1, -1] as const) {
      let start = -1;
      for (let a = 0; a <= L + 1e-6; a += STEP) {
        net.pointAt(pi, Math.max(0, a - 1.5), pt);
        net.pointAt(pi, Math.min(L, a + 1.5), nx);
        const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
        const tx = (nx.x - pt.x) / tl;
        const tz = (nx.z - pt.z) / tl;
        net.pointAt(pi, a, pt);
        let ok =
          ctx.roadDistance(pt.x, pt.z) <= cfg.reach && a > 3 && a < L - 3;
        const below = !!ctx.underpass?.(pi, a);
        if (ok) {
          // Kerb line and the outer edge of the sidewalk must be clear of other roads, the stage road, buildings
          // (not of the roads above an underpass: they pass over it).
          for (const o of [0.3, KERB_W + W]) {
            const lat = side * (hw + o);
            const x = pt.x + tz * lat;
            const z = pt.z - tx * lat;
            road.query(x, z, rq);
            if (!below && rq.found && rq.distance <= rq.halfWidth + 3)
              ok = false;
            net.query(
              x,
              z,
              pq,
              undefined,
              (qi) =>
                qi !== pi &&
                !net.paths[qi].bridge &&
                !continues(pi, qi) &&
                !(below && /^(motorway|trunk)/.test(net.paths[qi].kind)),
            );
            if (pq.found && pq.distance <= pq.halfWidth + 0.4) ok = false;
            if (ctx.blocked(x, z, 0.15)) ok = false;
            if (!ok) break;
          }
        }
        if (ok && start < 0) start = a;
        if ((!ok || a + STEP > L) && start >= 0) {
          const end = ok ? a : a - STEP;
          if (end - start >= MIN_RUN)
            runs.push({ path: pi, side, from: start, to: end });
          start = -1;
        }
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
      // Wide enough street, and room for the crosswalk.
      if (L < CROSS_SETBACK * 2 + 4 || p.width < 4) continue;
      crossings.push({
        path: pi,
        at: atEnd ? L - CROSS_SETBACK : CROSS_SETBACK,
        atEnd,
      });
    }
  });
  return { runs, crossings };
}
