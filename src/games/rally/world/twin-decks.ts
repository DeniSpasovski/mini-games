import { newPathQuery, type PathNetwork } from './real-data';

/**
 * Twin decks: OSM draws a dual carriageway street as one way per direction, so an overpass is two parallel decks
 * side by side (a metre or two apart) that were lifted independently - at different heights, with a slot and two
 * parapets between them. Real bridges are one structure: the twins share a height line (terrain-gen
 * `matchTwinDecks`) and the gap between them is closed when they are drawn (bridge-mesh `pathDecks`).
 *
 * Pure (no three.js scene): the world tests run it in node.
 */

/** Free gap (m) between the road edges of two decks that still count as one bridge. */
export const TWIN_GAP = 3;
/** Overlap of the two roadways once the gap is closed (m). */
export const TWIN_OVERLAP = 0.3;
/** Twin decks run this parallel (|cos| of the angle between their directions). */
const TWIN_COS = 0.9;

export interface Twin {
  /** The deck beside this one. */
  other: number;
  /** Metres along `other` of the nearest point. */
  along: number;
  /** Free gap between the two road edges (m, can be slightly negative when they overlap). */
  gap: number;
}

const pq = newPathQuery();
const pa = { x: 0, z: 0 };
const pb = { x: 0, z: 0 };
const pc = { x: 0, z: 0 };

/** Unit direction of path `pi` at `a` metres into `out`. */
function dirAt(net: PathNetwork, pi: number, a: number, out: number[]): void {
  const L = net.lengths[pi];
  net.pointAt(pi, Math.max(0, a - 1.5), pa);
  net.pointAt(pi, Math.min(L, a + 1.5), pb);
  const l = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
  out[0] = (pb.x - pa.x) / l;
  out[1] = (pb.z - pa.z) / l;
}

const d0 = [0, 0];
const d1 = [0, 0];

/**
 * The twin of deck `pi` at `a` metres (half width `hw` there), when another deck of `isTwin` runs parallel beside it
 * with a free gap of at most TWIN_GAP between the road edges. Decks that continue each other end to end (the other
 * one is ahead, not beside) are not twins.
 */
export function twinAt(
  net: PathNetwork,
  isTwin: (path: number) => boolean,
  pi: number,
  a: number,
  hw: number,
): Twin | undefined {
  net.pointAt(pi, a, pc);
  const x = pc.x;
  const z = pc.z;
  dirAt(net, pi, a, d0);
  net.query(x, z, pq, undefined, (qi) => qi !== pi && isTwin(qi));
  if (!pq.found) return undefined;
  const gap = pq.distance - hw - pq.halfWidth;
  if (gap > TWIN_GAP || gap < -0.5) return undefined;
  const other = pq.path;
  const along = pq.along;
  dirAt(net, other, along, d1);
  if (Math.abs(d0[0] * d1[0] + d0[1] * d1[1]) < TWIN_COS) return undefined;
  // Beside, not ahead: the offset to the other deck is mostly across this one.
  net.pointAt(other, along, pb);
  const lateral = Math.abs((pb.x - x) * d0[1] - (pb.z - z) * d0[0]);
  if (lateral < pq.distance * 0.8) return undefined;
  return { other, along, gap };
}
