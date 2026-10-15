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

  // End radius = the start radius of the segment continuing the branch (a tip tapers by one more decay).
  const next = new Int32Array(segments.length).fill(-1);
  segments.forEach((s, i) => {
    if (s.parent >= 0 && segments[s.parent].branch === s.branch)
      next[s.parent] = i;
  });
  segments.forEach((s, i) => {
    s.r1 =
      next[i] >= 0
        ? Math.min(s.r0, segments[next[i]].r0)
        : s.r0 * def.radiusDecay;
  });
  // A parent is never thinner than any child leaving it (children come after their parent: walk backwards).
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.parent < 0) continue;
    const p = segments[s.parent];
    p.r1 = Math.max(p.r1, s.r0);
    p.r0 = Math.max(p.r0, p.r1);
  }
  // A continuing segment starts at its parent's end radius (no step in the tube).
  for (const s of segments)
    if (s.parent >= 0 && segments[s.parent].branch === s.branch)
      s.r0 = segments[s.parent].r1;
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
