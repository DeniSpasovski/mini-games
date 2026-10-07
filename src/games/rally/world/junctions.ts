import type { PathDef } from '../maps/shared/types';
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
}

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
  // The other carriageways of the highway (and the lanes beside them in the cut): a street end never reaches the stage
  // road across them (a dead end at the rim of the cut was extended over the opposite lanes, 2.5 m above them).
  const lanes: number[] = [];
  for (const p of paths)
    if (
      !p.bridge &&
      p.surface === 'tarmac' &&
      (/^(motorway|trunk)$/.test(p.kind) || p.parkwayLane)
    )
      for (let k = 0; k + 3 < p.pts.length; k += 2)
        lanes.push(
          p.pts[k],
          p.pts[k + 1],
          p.pts[k + 2],
          p.pts[k + 3],
          p.width / 2,
        );
  const LCELL = 16;
  const laneGrid = new Map<number, number[]>();
  for (let s = 0; s < lanes.length; s += 5) {
    const r = lanes[s + 4];
    const x0 = Math.floor((Math.min(lanes[s], lanes[s + 2]) - r) / LCELL);
    const x1 = Math.floor((Math.max(lanes[s], lanes[s + 2]) + r) / LCELL);
    const z0 = Math.floor((Math.min(lanes[s + 1], lanes[s + 3]) - r) / LCELL);
    const z1 = Math.floor((Math.max(lanes[s + 1], lanes[s + 3]) + r) / LCELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const key = cellKey(cx, cz);
        const list = laneGrid.get(key);
        if (list) list.push(s);
        else laneGrid.set(key, [s]);
      }
  }
  const onLane = (x: number, z: number): boolean => {
    for (const s of laneGrid.get(
      cellKey(Math.floor(x / LCELL), Math.floor(z / LCELL)),
    ) ?? []) {
      const ax = lanes[s];
      const az = lanes[s + 1];
      const ex = lanes[s + 2] - ax;
      const ez = lanes[s + 3] - az;
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      if (Math.hypot(ax + ex * t - x, az + ez * t - z) <= lanes[s + 4])
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
        // Across another carriageway: not a junction of the stage road.
        if (onLane(ex + dx * t, ez + dz * t)) break;
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
 * tangent line). A side whose edges meet at a very acute angle (the corner far from the mouth) gets no fillet.
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
    const [cx, cz] = edge(v);
    // Away from the side road along the stage edge, away from the stage road along the side edge.
    const sv = Math.sign(v) || s;
    const [ax, az] = edge(v + sv * radius);
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
