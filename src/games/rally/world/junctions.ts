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
      });
    }
    return pts === p.pts ? p : { ...p, pts };
  });
  junctions.sort((a, b) => a.along - b.along);
  return { paths: out, junctions };
}
