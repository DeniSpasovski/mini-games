import type { PathDef } from '../maps/shared/types';
import type { PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';

/**
 * Junctions between the stage road and the other roads / tracks of a real-world map.
 *
 * The baker cuts every other road a few metres short of the stage road (so its ribbon never
 * lies under it), which leaves each side road ending in a hard edge in the middle of a field.
 * `connectPaths` extends those ends along their own direction until they reach the stage road
 * (the stage ribbon is drawn on top), and reports where, so the map can close the mouth with
 * barriers.
 *
 * Pure (no DOM / three.js scene): the world tests run it in node.
 */

export interface Junction {
  /** Where the side road meets the edge of the stage road. */
  x: number;
  z: number;
  /** Unit direction pointing away from the stage road along the side road. */
  dx: number;
  dz: number;
  /** Side road width (m). */
  width: number;
  surface: PathDef['surface'];
  kind: string;
  /** Distance along the stage road (m). */
  along: number;
  /** Side of the stage road it joins: +1 left of travel, -1 right. */
  side: 1 | -1;
  /** Index of the side road in the path list. */
  path: number;
}

/**
 * The world-aligned junction asphalt (sampled by world XZ, engine/road-surface.ts) each stage road surface blends into
 * at side road mouths: the same asphalt as the road, laid flat. A stage road without one (a parkway) has no mouths.
 */
export const JUNCTION_ASPHALT: Readonly<Record<string, string>> = {
  road_tarmac: 'road_tarmac_junction',
  road_tarmac_kerbed: 'road_tarmac_junction',
  road_tarmac_lines: 'road_tarmac_plain_junction',
  road_tarmac_plain: 'road_tarmac_plain_junction',
};

/** How far a side road end may be from the stage road edge and still be joined (m). */
const MAX_GAP = 20;
/** The ray towards the road is followed this far (shallow junctions need long rays). */
const MAX_RAY = 45;
/** Side-road end direction is measured against a vertex at least this far back (m). */
const REF_BACK = 8;
/** The extended end stops this far past the stage road edge (hidden under its ribbon, m). */
const OVERSHOOT = 1;
/** Way ends closer than this are one node of the street network (m). */
const SHARED_END = 2.5;

export function connectPaths(
  paths: PathDef[],
  road: Road,
): { paths: PathDef[]; junctions: Junction[] } {
  const junctions: Junction[] = [];
  const q = newRoadQuery();
  const spans = road.def.spans ?? [];
  // Ends of every way. An end shared with another way (a node of the street network: a street continuing onto a
  // bridge deck, a T of several streets) is no loose end - the baker only leaves those where it cut a side road
  // short of the stage road. Extending shared ends put a junction mouth, its barrier row and gaps in the parkway
  // barriers under every overpass.
  const ends: { x: number; z: number; path: number }[] = [];
  paths.forEach((p, pi) => {
    const n = p.pts.length;
    if (n >= 4) {
      ends.push({ x: p.pts[0], z: p.pts[1], path: pi });
      ends.push({ x: p.pts[n - 2], z: p.pts[n - 1], path: pi });
    }
  });
  // Grid of the ends (cell = SHARED_END): a 3 x 3 cell lookup instead of a scan of every end (a town has thousands).
  const cellKey = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
  const grid = new Map<number, number[]>();
  ends.forEach((e, k) => {
    const key = cellKey(
      Math.floor(e.x / SHARED_END),
      Math.floor(e.z / SHARED_END),
    );
    const list = grid.get(key);
    if (list) list.push(k);
    else grid.set(key, [k]);
  });
  const sharedEnd = (pi: number, x: number, z: number): boolean => {
    const cx = Math.floor(x / SHARED_END);
    const cz = Math.floor(z / SHARED_END);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++)
        for (const k of grid.get(cellKey(gx, gz)) ?? []) {
          const e = ends[k];
          if (e.path !== pi && Math.hypot(e.x - x, e.z - z) < SHARED_END)
            return true;
        }
    return false;
  };
  const out = paths.map((p, pi) => {
    // Water, roads the baker marked as passing over / under the stage road (no junction), bridge decks.
    if (p.surface === 'water' || p.junction === false || p.bridge) return p;
    // A parallel carriageway of a divided highway is not a side road: it is never joined to the stage road
    // (that would put a junction barrier across its lanes). Ramps (`*_link`) still are.
    if (p.kind === 'motorway' || p.kind === 'trunk') return p;
    let pts = p.pts;
    for (const atEnd of [false, true]) {
      const n = pts.length / 2;
      if (n < 2) continue;
      const vx = (i: number) => pts[(atEnd ? n - 1 - i : i) * 2];
      const vz = (i: number) => pts[(atEnd ? n - 1 - i : i) * 2 + 1];
      const ex = vx(0);
      const ez = vz(0);
      if (sharedEnd(pi, ex, ez)) continue;
      let k = 1;
      while (k < n - 1 && Math.hypot(ex - vx(k), ez - vz(k)) < REF_BACK) k++;
      const len = Math.hypot(ex - vx(k), ez - vz(k));
      if (len < 2) continue;
      // Direction of travel towards the end of the path.
      const dx = (ex - vx(k)) / len;
      const dz = (ez - vz(k)) / len;
      road.query(ex, ez, q);
      if (!q.found || q.distance <= q.halfWidth) continue;
      const start = q.distance;
      if (start - q.halfWidth > MAX_GAP) continue;
      let hit = -1;
      for (let t = 1; t <= MAX_RAY; t++) {
        road.query(ex + dx * t, ez + dz * t, q);
        // Heading away from the road: not a junction.
        if (!q.found || q.distance > start + 2) break;
        if (q.distance <= q.halfWidth) {
          hit = t;
          break;
        }
      }
      if (hit < 0) continue;
      // No junction where the stage road is on a bridge or under a structure (a street cannot join a deck or a
      // sunken parkway inside its portal): the way ends where it ends.
      if (spans.some((sp) => q.along >= sp.from - 8 && q.along <= sp.to + 8))
        continue;
      const reach = hit + OVERSHOOT;
      const added = [ex + dx * reach, ez + dz * reach];
      pts = atEnd ? [...pts, ...added] : [...added, ...pts];
      junctions.push({
        x: ex + dx * hit,
        z: ez + dz * hit,
        dx: -dx,
        dz: -dz,
        width: p.width,
        surface: p.surface,
        kind: p.kind,
        along: q.along,
        side: q.lateral >= 0 ? 1 : -1,
        path: pi,
      });
    }
    return pts === p.pts ? p : { ...p, pts };
  });
  junctions.sort((a, b) => a.along - b.along);
  return { paths: out, junctions };
}

/** One rounded corner of a junction mouth: tarmac between the corner `c` and the concave `arc` (A on the stage road edge -> B on the side road edge). */
export interface JunctionFillet {
  c: [number, number];
  arc: [number, number][];
}

/** Arc points of a fillet (incl. both ends). */
const FILLET_STEPS = 6;

/**
 * The two rounded corners of a junction mouth (a real junction flares out instead of meeting the stage road as a
 * square T). For each side: C = where the side road's edge meets the stage road's edge, A / B = `radius` back from C
 * along the stage edge / the side road edge, and the arc A -> B a quadratic curve bowing towards C (close to a
 * circle tangent to both edges). `tx, tz` = stage road tangent at the junction; `edge(d)` = the stage road edge on
 * the junction's side `d` metres further along (C and A sit on the real, possibly curved, edge; default: the
 * tangent line). A side whose edges meet at a very acute angle (the corner far from the mouth) or almost straight on
 * (over 130 degrees) gets no fillet.
 */
export function junctionFillets(
  j: Junction,
  tx: number,
  tz: number,
  edge: (d: number) => [number, number] = (d) => [j.x + tx * d, j.z + tz * d],
  radius = Math.min(8, Math.max(4, j.width * 1.4)),
): JunctionFillet[] {
  const out: JunctionFillet[] = [];
  const w = j.width / 2;
  // Perpendicular to the side road.
  const nx = -j.dz;
  const nz = j.dx;
  for (const s of [1, -1]) {
    // Side road edge: E + d u; stage edge: J + t v. Solve s w n + d u = t v.
    const ex = s * w * nx;
    const ez = s * w * nz;
    const det = j.dx * -tz - j.dz * -tx;
    if (Math.abs(det) < 0.35) continue; // nearly parallel: no clean corner
    const u = (-ex * -tz + ez * -tx) / det;
    const v = (j.dx * -ez + j.dz * ex) / det;
    if (Math.abs(u) > 2 * j.width || Math.abs(v) > 3 * j.width) continue;
    // C on the side road's edge (where it meets the stage edge's tangent), so the arc ends on the side road's real edge
    // even where the stage road bends away from its tangent; A on the real stage edge.
    const cx = j.x + ex + j.dx * u;
    const cz = j.z + ez + j.dz * u;
    // Away from the side road along the stage edge, away from the stage road along the side edge.
    const sv = Math.sign(v) || s;
    const [ax, az] = edge(v + sv * radius);
    // Nearly straight on (the far side of a shallow, slanted junction): no corner to round, and the fan would be a
    // thin sliver poking out along the side road.
    const al = Math.hypot(ax - cx, az - cz) || 1;
    if (((ax - cx) * j.dx + (az - cz) * j.dz) / al < -0.64) continue;
    const bx = cx + j.dx * radius;
    const bz = cz + j.dz * radius;
    const arc: [number, number][] = [];
    for (let k = 0; k <= FILLET_STEPS; k++) {
      const t = k / FILLET_STEPS;
      const a = (1 - t) * (1 - t);
      const m = 2 * (1 - t) * t;
      const b = t * t;
      arc.push([a * ax + m * cx + b * bx, a * az + m * cz + b * bz]);
    }
    out.push({ c: [cx, cz], arc });
  }
  return out;
}

/** A junction's fillets on the real stage road edge (the curved edge, not its tangent at the junction). */
export function mouthFillets(j: Junction, road: Road): JunctionFillet[] {
  const s0 = road.at(j.along);
  const edge = (d: number): [number, number] => {
    const s = road.at(j.along + d);
    const lat = j.side * s.halfWidth;
    return [s.x + s.tz * lat, s.z - s.tx * lat];
  };
  return junctionFillets(j, s0.tx, s0.tz, edge);
}

/**
 * A rounded corner seen from the side road's sidewalk on that side: the kerb leaves the street edge at `along` (B)
 * and follows `arc` (B -> A, ending on the stage road edge) round the corner `c`.
 */
export interface MouthCorner {
  path: number;
  /** Side of the path (+1 = left of its direction). */
  side: 1 | -1;
  /** The junction is at the path's end (else at its start). */
  atEnd: boolean;
  along: number;
  c: [number, number];
  arc: [number, number][];
}

/** The rounded corners of every junction, per side road side (kerb returns for the sidewalks, street-detail.ts). */
export function mouthCorners(
  junctions: readonly Junction[],
  road: Road,
  net: PathNetwork,
): MouthCorner[] {
  const out: MouthCorner[] = [];
  const q = newRoadQuery();
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  for (const j of junctions) {
    const L = net.lengths[j.path];
    if (L === undefined) continue;
    net.pointAt(j.path, 0, pt);
    net.pointAt(j.path, L, nx);
    const atEnd =
      Math.hypot(nx.x - j.x, nx.z - j.z) < Math.hypot(pt.x - j.x, pt.z - j.z);
    const fillets = mouthFillets(j, road);
    const corners = fillets.map((f) => ({ c: f.c, arc: [...f.arc].reverse() }));
    // A side without a rounded corner (the open side of a slanted junction): the kerb runs on straight along the side
    // road's edge to the stage road edge.
    const w = j.width / 2;
    const radius = Math.min(8, Math.max(4, j.width * 1.4));
    for (const sd of [1, -1]) {
      const has = fillets.some(
        (f) => (f.c[0] - j.x) * -j.dz + (f.c[1] - j.z) * j.dx >= 0 === sd > 0,
      );
      if (has) continue;
      const ex = j.x - j.dz * sd * w;
      const ez = j.z + j.dx * sd * w;
      let t = radius;
      while (t > -6) {
        road.query(ex + j.dx * t, ez + j.dz * t, q);
        if (q.found && q.distance <= q.halfWidth) break;
        t -= 0.25;
      }
      if (t <= -6 || t >= radius - 1) continue;
      const arc: [number, number][] = [];
      for (let k = 0; k <= 4; k++) {
        const d = radius + ((t - radius) * k) / 4;
        arc.push([ex + j.dx * d, ez + j.dz * d]);
      }
      corners.push({ c: [j.x + j.dx * radius, j.z + j.dz * radius], arc });
    }
    for (const f of corners) {
      const arc = f.arc;
      const [bx, bz] = arc[0];
      // Along of B: the side road's way runs into the stage road along -(dx, dz) at its end, (dx, dz) from its start.
      const end = atEnd ? L : 0;
      net.pointAt(j.path, end, pt);
      const back = (bx - pt.x) * j.dx + (bz - pt.z) * j.dz;
      const along = atEnd ? L - back : back;
      if (along <= 0 || along >= L) continue;
      // Path direction (start -> end) at the junction: -(dx, dz) at its end, (dx, dz) at its start.
      const tx = atEnd ? -j.dx : j.dx;
      const tz = atEnd ? -j.dz : j.dz;
      // left = (tz, -tx)
      const side = (bx - pt.x) * tz - (bz - pt.z) * tx >= 0 ? 1 : -1;
      out.push({ path: j.path, side, atEnd, along, c: f.c, arc });
    }
  }
  return out;
}
