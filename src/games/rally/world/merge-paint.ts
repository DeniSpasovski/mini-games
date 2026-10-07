import type { PathDef } from '../maps/shared/types';

/**
 * Paint at the splits and merges of the carriageways and ramps (OSM: a node where three ways of `motorway*` / `trunk*`
 * meet). The two ways that run straight through the node are the through road, the third is the branch (the ramp):
 *  - the branch's lines stop where its ribbon starts to overlap the through road's (the gore wedge, gore.ts, fills the V
 *    before that, and the through road's lines govern the shared asphalt);
 *  - the through road's lines run on across the node (no END_GAP there), and its edge line on the branch's side is a
 *    dotted extension line (NYC: short wide dashes) where the branch's ribbon overlaps it.
 * Pure (no scene): road-mesh.ts / bridge-mesh.ts call it per way, the tests run it.
 */

/** Ends closer than this meet at one node (m). */
const NODE = 2.5;
/** Longest overlap measured from a node (m). */
const MAX_OVERLAP = 150;
/** The ribbons count as overlapping while their edges are closer than this (m; < 0 = a real overlap). */
const OVERLAP_SLACK = -0.3;
/** Dotted extension line: on / off (m). */
export const DOTTED: [number, number] = [1, 3];

const CARRIAGEWAY = /^(motorway|trunk)(_link)?$/;

export interface EndPaint {
  /** The end continues as the through road: paint runs on to it (no gap). */
  through: boolean;
  /** The branch of a split / merge: paint stops this many metres short of the end (the overlap). */
  trim: number;
  /** Through road: the side (+1 left / -1 right) and length (m, from this end) of the dotted edge line. */
  dotted?: { side: 1 | -1; length: number };
}

interface Leg {
  p: PathDef;
  atEnd: boolean;
  /** Unit direction leaving the node. */
  dx: number;
  dz: number;
}

const endPoint = (p: PathDef, atEnd: boolean): [number, number] => {
  const n = p.pts.length;
  return atEnd ? [p.pts[n - 2], p.pts[n - 1]] : [p.pts[0], p.pts[1]];
};

function leg(p: PathDef, atEnd: boolean): Leg {
  const n = p.pts.length;
  const [ex, ez] = endPoint(p, atEnd);
  const ox = (atEnd ? p.pts[n - 4] : p.pts[2]) - ex;
  const oz = (atEnd ? p.pts[n - 3] : p.pts[3]) - ez;
  const l = Math.hypot(ox, oz) || 1;
  return { p, atEnd, dx: ox / l, dz: oz / l };
}

const polyLength = (pts: number[]): number => {
  let L = 0;
  for (let k = 0; k + 3 < pts.length; k += 2)
    L += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return L;
};

/** Point at `a` m from the start of a flat polyline. */
function pointAt(pts: number[], a: number): [number, number] {
  let along = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const dx = pts[k + 2] - pts[k];
    const dz = pts[k + 3] - pts[k + 1];
    const L = Math.hypot(dx, dz);
    if (a <= along + L || k + 5 >= pts.length) {
      const t = L > 0 ? Math.min(1, Math.max(0, (a - along) / L)) : 0;
      return [pts[k] + dx * t, pts[k + 1] + dz * t];
    }
    along += L;
  }
  return [pts[pts.length - 2], pts[pts.length - 1]];
}

/** Distance from (x, z) to a flat polyline. */
function distance(pts: number[], x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k];
    const az = pts[k + 1];
    const ex = pts[k + 2] - ax;
    const ez = pts[k + 3] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

/** Metres from the node end of `p` over which its ribbon overlaps `q`'s (contiguous from the node). */
function overlap(p: PathDef, atEnd: boolean, q: PathDef): number {
  const L = polyLength(p.pts);
  let o = 0;
  for (let s = 0; s <= Math.min(MAX_OVERLAP, L); s += 1) {
    const [x, z] = pointAt(p.pts, atEnd ? L - s : s);
    if (distance(q.pts, x, z) - p.width / 2 - q.width / 2 > OVERLAP_SLACK)
      break;
    o = s;
  }
  return o;
}

/** How the paint of carriageway / ramp `p` treats its start and end (see the file comment). */
export function mergePaint(
  paths: readonly PathDef[],
  p: PathDef,
): [EndPaint, EndPaint] {
  const out: [EndPaint, EndPaint] = [
    { through: false, trim: 0 },
    { through: false, trim: 0 },
  ];
  if (!CARRIAGEWAY.test(p.kind) || p.pts.length < 4) return out;
  for (const atEnd of [false, true]) {
    const [ex, ez] = endPoint(p, atEnd);
    const legs: Leg[] = [leg(p, atEnd)];
    for (const q of paths) {
      if (q === p || q.surface !== 'tarmac' || q.pts.length < 4) continue;
      if (!CARRIAGEWAY.test(q.kind)) continue;
      for (const qEnd of [false, true]) {
        const [qx, qz] = endPoint(q, qEnd);
        if (Math.hypot(qx - ex, qz - ez) <= NODE) legs.push(leg(q, qEnd));
      }
    }
    if (legs.length !== 3) continue;
    // the through pair: the two legs leaving the node most nearly opposite - the mainline before a ramp when both run
    // on nearly straight (an exit ramp may run on straighter than a carriageway that bends away)
    let best = Infinity;
    let pair: [number, number] = [0, 1];
    let bestMain = Infinity;
    let pairMain: [number, number] | undefined;
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const dot = legs[i].dx * legs[j].dx + legs[i].dz * legs[j].dz;
        if (dot < best) {
          best = dot;
          pair = [i, j];
        }
        if (
          dot < bestMain &&
          !legs[i].p.kind.endsWith('_link') &&
          !legs[j].p.kind.endsWith('_link')
        ) {
          bestMain = dot;
          pairMain = [i, j];
        }
      }
    if (best > -0.8) continue; // no straight through road: an ordinary junction
    if (pairMain && bestMain <= -0.8) pair = pairMain;
    const branch = [0, 1, 2].find((k) => !pair.includes(k))!;
    const k = atEnd ? 1 : 0;
    if (branch === 0) {
      // p is the ramp: its lines stop where its ribbon meets the through road
      const o = Math.max(
        overlap(p, atEnd, legs[pair[0]].p),
        overlap(p, atEnd, legs[pair[1]].p),
      );
      out[k] = { through: false, trim: o > 0 ? o + 1 : 0 };
    } else {
      // p is the through road: the branch leaves on its left or right
      const b = legs[branch];
      const me = legs[0];
      // left of p's travel = (tz, -tx); p's travel direction at this end = into the node at the end, out of it at the start
      const tx = atEnd ? -me.dx : me.dx;
      const tz = atEnd ? -me.dz : me.dz;
      const side: 1 | -1 = b.dx * tz - b.dz * tx > 0 ? 1 : -1;
      const o = overlap(b.p, b.atEnd, p);
      out[k] = {
        through: true,
        trim: 0,
        dotted: o > 0 ? { side, length: o + 1 } : undefined,
      };
    }
  }
  return out;
}
