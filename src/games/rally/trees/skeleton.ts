import type { Module } from './grammar';
import {
  cross,
  DEG,
  len,
  madd,
  norm,
  rotate,
  scale,
  sub,
  type V3,
} from './math';
import type { SpeciesDef } from './species';

/**
 * Stage 2, skeleton (spec: trees/Grammar.md#turtle, #skeleton): a 3D turtle reads the module string into a tree of
 * branch segments and leaf points. Pure: the one source every LOD, the foliage, the wind data and the colliders are
 * built from.
 */

export interface Segment {
  start: V3;
  end: V3;
  r0: number;
  r1: number;
  /** Branch order: 0 = trunk, +1 per `[`. */
  order: number;
  /** Segment this one grows from (-1 = a root). */
  parent: number;
  /** Distance from the root along the branch path, at `start` (m). */
  dist: number;
  /** Branch this segment belongs to (a new one per `[`) and the distance along it at `start` (wind data). */
  branch: number;
  branchDist: number;
  /** Length x radius of the whole subtree: the finest twigs have the lowest (LOD pruning). */
  priority: number;
}

export interface LeafPoint {
  pos: V3;
  /** Turtle heading and up at the leaf. */
  heading: V3;
  up: V3;
  order: number;
  /** Segment it hangs from (-1 = none drawn yet). */
  segment: number;
  branch: number;
  /** Position among the leaves of its branch (phyllotaxis: each turns by the golden angle). */
  index: number;
}

export interface Skeleton {
  segments: Segment[];
  leaves: LeafPoint[];
  /** Highest point of the wood (m). */
  height: number;
}

interface Turtle {
  pos: V3;
  h: V3;
  l: V3;
  u: V3;
  radius: number;
  order: number;
  seg: number;
  dist: number;
  branch: number;
  branchDist: number;
  /** Tropism strength from here on (`T(e)`; starts at the species' `tropismStrength`, inherited by sub-branches). */
  e: number;
}

export function buildSkeleton(modules: Module[], def: SpeciesDef): Skeleton {
  const segments: Segment[] = [];
  const leaves: LeafPoint[] = [];
  const leafCount = new Map<number, number>();
  const tropism = norm(def.tropism);
  let branches = 0;
  let t: Turtle = {
    pos: [0, 0, 0],
    h: [0, 1, 0],
    l: [-1, 0, 0],
    u: [0, 0, 1],
    radius: def.baseRadius,
    order: 0,
    seg: -1,
    dist: 0,
    branch: branches++,
    branchDist: 0,
    e: def.tropismStrength,
  };
  const stack: Turtle[] = [];
  const turn = (axis: V3, a: number) => {
    t.h = rotate(t.h, axis, a);
    t.l = rotate(t.l, axis, a);
    t.u = rotate(t.u, axis, a);
  };
  const angle = (m: Module) => (m.a.length ? m.a[0] : def.angle) * DEG;

  for (const m of modules) {
    switch (m.s) {
      case 'F':
      case 'f': {
        const length = (m.a.length ? m.a[0] : 1) * def.lengthScale;
        const end = madd(t.pos, t.h, length);
        if (m.s === 'F') {
          segments.push({
            start: t.pos,
            end,
            r0: t.radius,
            r1: t.radius,
            order: t.order,
            parent: t.seg,
            dist: t.dist,
            branch: t.branch,
            branchDist: t.branchDist,
            priority: 0,
          });
          t.seg = segments.length - 1;
          t.dist += length;
          t.branchDist += length;
        }
        t.pos = end;
        // Tropism: bend the heading towards the tropism vector by e * |h x T|.
        const axis = cross(t.h, tropism);
        const s = len(axis);
        if (t.e > 0 && s > 1e-6) turn(scale(axis, 1 / s), t.e * s);
        break;
      }
      case '+':
        turn(t.u, angle(m));
        break;
      case '-':
        turn(t.u, -angle(m));
        break;
      case '&':
        turn(t.l, angle(m));
        break;
      case '^':
        turn(t.l, -angle(m));
        break;
      case '<':
        turn(t.h, -angle(m));
        break;
      case '>':
        turn(t.h, angle(m));
        break;
      case '|':
        turn(t.u, Math.PI);
        break;
      case '!':
        t.radius *= def.radiusDecay;
        break;
      case 'T':
        // Weeping shoots hang, a columnar crown's limbs stay upright: this branch's own tropism strength.
        t.e = m.a.length ? m.a[0] : def.tropismStrength;
        break;
      case '[':
        stack.push(t);
        t = { ...t, order: t.order + 1, branch: branches++, branchDist: 0 };
        break;
      case ']':
        t = stack.pop() ?? t;
        break;
      case 'L': {
        const index = leafCount.get(t.branch) ?? 0;
        leafCount.set(t.branch, index + 1);
        leaves.push({
          pos: t.pos,
          heading: t.h,
          up: t.u,
          order: t.order,
          segment: t.seg,
          branch: t.branch,
          index,
        });
        break;
      }
      // A, B: apices, draw nothing.
    }
  }

  pipeRadii(segments, leaves, def);
  // Prune priority: length x mean radius summed over the subtree.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    s.priority += len(sub(s.end, s.start)) * (s.r0 + s.r1) * 0.5;
    if (s.parent >= 0) segments[s.parent].priority += s.priority;
  }
  let height = 0;
  for (const s of segments) height = Math.max(height, s.end[1]);
  return { segments, leaves, height };
}

/** A shoot's radius where it ends in a leaf spray (m), unless the species sets its own `tipRadius`. */
export const TIP_RADIUS = 0.006;
/** Bounds of the pipe model exponent (botany: 2 to 3; lower keeps a sparse skeleton's trunk thick). */
const PIPE_EXP: [number, number] = [1.6, 3];

/**
 * Pipe model radii (trees/Grammar.md#turtle): a segment is as thick as the leaves it carries, r = tip * w^(1/e), w the
 * leaf points on it and beyond (a bare tip counts one). e is fitted so the trunk keeps its turtle radius and the shoots
 * end at the species' tip radius, so every branch tapers along its length and to a thin tip, and a parent is never
 * thinner than a child. A segment ends at the radius of the one continuing its branch (no step), a tip at half.
 */
function pipeRadii(
  segments: Segment[],
  leaves: LeafPoint[],
  def: SpeciesDef,
): void {
  if (!segments.length) return;
  const w = new Float64Array(segments.length);
  for (const l of leaves) if (l.segment >= 0) w[l.segment]++;
  const next = new Int32Array(segments.length).fill(-1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    w[i] = Math.max(w[i], 1);
    if (s.parent < 0) continue;
    w[s.parent] += w[i];
    if (segments[s.parent].branch === s.branch) next[s.parent] = i;
  }
  const tip = def.tipRadius ?? TIP_RADIUS;
  const base = segments[0].r0;
  const e = Math.min(
    PIPE_EXP[1],
    Math.max(PIPE_EXP[0], Math.log(w[0]) / Math.log(base / tip)),
  );
  const k = base / (tip * w[0] ** (1 / e));
  const r = (i: number) => k * tip * w[i] ** (1 / e);
  segments.forEach((s, i) => {
    s.r0 = r(i);
    s.r1 = next[i] >= 0 ? r(next[i]) : s.r0 * 0.5;
  });
  // A side shoot thicker than the continuation (a fork) widens its parent's end; the continuation starts there.
  for (let i = segments.length - 1; i > 0; i--) {
    const s = segments[i];
    if (s.parent >= 0)
      segments[s.parent].r1 = Math.max(segments[s.parent].r1, s.r0);
  }
  for (let i = 0; i < segments.length; i++)
    if (next[i] >= 0) segments[next[i]].r0 = segments[i].r1;
}

/** Is `seg` (or an ancestor of it) `root`? */
export function inSubtree(sk: Skeleton, seg: number, root: number): boolean {
  for (let i = seg; i >= 0; i = sk.segments[i].parent)
    if (i === root) return true;
  return false;
}

/** Unit direction of a segment. */
export function segmentDir(s: Segment): V3 {
  return norm(sub(s.end, s.start));
}
