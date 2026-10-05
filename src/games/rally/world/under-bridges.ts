import type { PathDef } from '../maps/shared/types';
import { newRoadQuery, type Road } from './road';

/**
 * Structures over the stage road. OSM tags a parkway that runs under a street as `layer=-1` on the
 * PARKWAY (a `RoadSpan` of kind `under`); the street above it is an ordinary ground level way, so without
 * help it would cross the sunken parkway at its level. `bridgeOverUnderSpans` turns the part of every
 * such crossing street that lies over the parkway into a bridge deck (`bridge: true, layer: 1`): the deck
 * profile pass lifts it clear of the parkway, bridge-mesh.ts draws girders, abutments and parapets.
 *
 * Pure (no three.js scene): the world tests run it in node.
 */

/** Street kinds that become decks (never ramps / carriageways: those are real parkway parts). */
const STREET_KINDS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);
/** Streets that cross the parkway more steeply than this (|cos| of the angle) count as crossing. */
const MAX_PARALLEL = 0.8;
/** The deck starts / ends this far beyond the outermost carriageway edge (m): room for the abutments. */
const EXTRA = 12;
/** Decks shorter than this are not worth a bridge (m). */
const MIN_DECK = 12;
/** A street within this distance of a parkway carriageway edge is over it (m). */
const REACH = 1.5;

/** Point at `a` metres along a flat polyline. */
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

/** Cut `pts` at `a` and `b` metres along: [0, a], [a, b], [b, end]; the pieces share their cut points. */
function splitAt(
  pts: number[],
  a: number,
  b: number,
): [number[], number[], number[]] {
  const out: [number[], number[], number[]] = [[], [], []];
  const [ax, az] = polyAt(pts, a);
  const [bx, bz] = polyAt(pts, b);
  let along = 0;
  out[0].push(pts[0], pts[1]);
  for (let k = 0; k + 3 < pts.length; k += 2) {
    along += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
    const x = pts[k + 2];
    const z = pts[k + 3];
    if (along < a) out[0].push(x, z);
    else if (along > b) out[2].push(x, z);
    else out[1].push(x, z);
  }
  out[0].push(ax, az);
  out[1].unshift(ax, az);
  out[1].push(bx, bz);
  out[2].unshift(bx, bz);
  return out;
}

/** Halves of one street end this close to the stage road and this far from each other (m). */
const PAIR_ROAD = 30;
const PAIR_GAP = 70;

/**
 * Join streets that were cut by the stage road inside an `under` span: two ways of the same kind whose ends
 * face each other across the road (opposite directions, the gap between them crosses the road).
 */
function rejoinCrossings(
  paths: PathDef[],
  road: Road,
  spans: { from: number; to: number }[],
): PathDef[] {
  const rq = newRoadQuery();
  interface End {
    path: number;
    atEnd: boolean;
    x: number;
    z: number;
    dx: number;
    dz: number;
  }
  const ends: End[] = [];
  paths.forEach((p, i) => {
    if (p.bridge || p.surface !== 'tarmac' || !STREET_KINDS.has(p.kind)) return;
    const n = p.pts.length / 2;
    if (n < 2) return;
    for (const atEnd of [false, true]) {
      const e = atEnd ? n - 1 : 0;
      const q = atEnd ? n - 2 : 1;
      const x = p.pts[e * 2];
      const z = p.pts[e * 2 + 1];
      road.query(x, z, rq);
      if (!rq.found || rq.distance > PAIR_ROAD) continue;
      if (!spans.some((s) => rq.along >= s.from - 10 && rq.along <= s.to + 10))
        continue;
      const dx = x - p.pts[q * 2];
      const dz = z - p.pts[q * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      ends.push({ path: i, atEnd, x, z, dx: dx / l, dz: dz / l });
    }
  });
  const used = new Set<number>();
  const merged = new Map<number, PathDef>();
  for (const a of ends) {
    if (used.has(a.path)) continue;
    let best: End | undefined;
    let bestD = PAIR_GAP;
    for (const b of ends) {
      if (b.path === a.path || used.has(b.path)) continue;
      const pa = paths[a.path];
      const pb = paths[b.path];
      if (pa.kind !== pb.kind || Math.abs(pa.width - pb.width) > 2) continue;
      // Facing each other: heading towards one another, nearly collinear.
      const gx = b.x - a.x;
      const gz = b.z - a.z;
      const g = Math.hypot(gx, gz);
      if (g < 2 || g >= bestD) continue;
      if (a.dx * b.dx + a.dz * b.dz > -0.8) continue;
      if ((gx * a.dx + gz * a.dz) / g < 0.9) continue;
      // The gap must cross the stage road (one end on each side).
      road.query(a.x, a.z, rq);
      const la = rq.lateral;
      road.query(b.x, b.z, rq);
      if (la * rq.lateral >= 0) continue;
      best = b;
      bestD = g;
    }
    if (!best) continue;
    const pa = paths[a.path];
    const pb = paths[best.path];
    // Orient: pa ends at a, pb starts at b.
    const pts = (atEnd: boolean, v: number[]): number[] => {
      if (atEnd) return v;
      const r: number[] = [];
      for (let k = v.length - 2; k >= 0; k -= 2) r.push(v[k], v[k + 1]);
      return r;
    };
    merged.set(a.path, {
      ...pa,
      pts: [...pts(a.atEnd, pa.pts), ...pts(!best.atEnd, pb.pts)],
    });
    used.add(a.path);
    used.add(best.path);
  }
  if (!used.size) return paths;
  return paths
    .map((p, i) => merged.get(i) ?? p)
    .filter((_, i) => !used.has(i) || merged.has(i));
}

export interface UnderBridge {
  /** Index of the street in the input list. */
  path: number;
  /** Stage road stretch (m along) the street crosses. */
  span: number;
  /** Deck length (m). */
  length: number;
}

export function bridgeOverUnderSpans(
  input: PathDef[],
  road: Road,
): { paths: PathDef[]; bridges: UnderBridge[] } {
  let paths = input;
  const spans = (road.def.spans ?? []).filter((s) => s.kind === 'under');
  if (!spans.length) return { paths, bridges: [] };
  const rq = newRoadQuery();
  const bridges: UnderBridge[] = [];
  // Carriageways of the parkway besides the stage road: a street over the stage road passes over them too.
  const carriageways = paths.filter(
    (p) =>
      !p.bridge &&
      p.surface === 'tarmac' &&
      (p.kind === 'motorway' ||
        p.kind === 'motorway_link' ||
        p.kind === 'trunk'),
  );
  const overCarriageway = (x: number, z: number): boolean => {
    for (const c of carriageways) {
      const hw = c.width / 2 + REACH;
      for (let k = 0; k + 3 < c.pts.length; k += 2) {
        const ax = c.pts[k];
        const az = c.pts[k + 1];
        const ex = c.pts[k + 2] - ax;
        const ez = c.pts[k + 3] - az;
        const l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(
          0,
          Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2),
        );
        if (Math.hypot(ax + ex * t - x, az + ez * t - z) <= hw) return true;
      }
    }
    return false;
  };
  // The baker cuts a street where it meets the stage road (both halves end at the road): put the halves of a
  // street that crosses the parkway back together, so it can pass over it as one deck.
  paths = rejoinCrossings(paths, road, spans);
  const out: PathDef[] = [];
  paths.forEach((p, pi) => {
    if (p.bridge || p.surface !== 'tarmac' || !STREET_KINDS.has(p.kind)) {
      out.push(p);
      return;
    }
    // Sample the street every metre: where is it over the stage road (inside an `under` span) or over a carriageway?
    let total = 0;
    for (let k = 0; k + 3 < p.pts.length; k += 2)
      total += Math.hypot(p.pts[k + 2] - p.pts[k], p.pts[k + 3] - p.pts[k + 1]);
    let first = -1;
    let last = -1;
    let spanIdx = -1;
    for (let a = 0; a <= total; a += 1) {
      const [x, z, dx, dz] = polyAt(p.pts, a);
      road.query(x, z, rq);
      if (!rq.found) continue;
      const idx = spans.findIndex(
        (s) => rq.along >= s.from - 6 && rq.along <= s.to + 6,
      );
      if (idx < 0) continue;
      if (rq.distance > rq.halfWidth + REACH && !overCarriageway(x, z))
        continue;
      // Crossing, not running along the parkway.
      const s = road.samples[rq.index];
      if (Math.abs(dx * s.tx + dz * s.tz) > MAX_PARALLEL) continue;
      if (first < 0) first = a;
      last = a;
      spanIdx = idx;
    }
    if (first < 0 || last - first < 1) {
      out.push(p);
      return;
    }
    const a = Math.max(0, first - EXTRA);
    const b = Math.min(total, last + EXTRA);
    if (b - a < MIN_DECK) {
      out.push(p);
      return;
    }
    const [before, deck, after] = splitAt(p.pts, a, b);
    // Not joined to the stage road (junction: false), the deck carries the rest of the street's attributes.
    if (before.length >= 4) out.push({ ...p, pts: before, junction: false });
    out.push({ ...p, pts: deck, junction: false, bridge: true, layer: 1 });
    if (after.length >= 4) out.push({ ...p, pts: after, junction: false });
    bridges.push({ path: pi, span: spanIdx, length: b - a });
  });
  return { paths: out, bridges };
}

/**
 * OSM maps a dual carriageway / a street with a separate way for every lane group, and some of those ways lie on
 * top of each other (two decks with the same line at different heights, the second one fighting the first for the
 * same pixels). A deck that lies (>= 85 % of its length) inside another deck of the same kind and layer is dropped:
 * the road is rendered once, at one height.
 */
export function dropDuplicateDecks(paths: PathDef[]): PathDef[] {
  const pts = (p: PathDef): [number, number][] => {
    const out: [number, number][] = [];
    for (let a = 0; ; a += 3) {
      const [x, z] = polyAt(p.pts, a);
      out.push([x, z]);
      let total = 0;
      for (let k = 0; k + 3 < p.pts.length; k += 2)
        total += Math.hypot(
          p.pts[k + 2] - p.pts[k],
          p.pts[k + 3] - p.pts[k + 1],
        );
      if (a >= total) break;
    }
    return out;
  };
  const decks = paths
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.bridge && p.surface === 'tarmac');
  const drop = new Set<number>();
  const len = (p: PathDef) => {
    let total = 0;
    for (let k = 0; k + 3 < p.pts.length; k += 2)
      total += Math.hypot(p.pts[k + 2] - p.pts[k], p.pts[k + 3] - p.pts[k + 1]);
    return total;
  };
  const distToLine = (x: number, z: number, p: PathDef): number => {
    let best = Infinity;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ex = p.pts[k + 2] - p.pts[k];
      const ez = p.pts[k + 3] - p.pts[k + 1];
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(
        0,
        Math.min(1, ((x - p.pts[k]) * ex + (z - p.pts[k + 1]) * ez) / l2),
      );
      best = Math.min(
        best,
        Math.hypot(p.pts[k] + ex * t - x, p.pts[k + 1] + ez * t - z),
      );
    }
    return best;
  };
  for (const a of decks)
    for (const b of decks) {
      if (a.i === b.i || drop.has(a.i) || drop.has(b.i)) continue;
      if (a.p.kind !== b.p.kind || (a.p.layer ?? 1) !== (b.p.layer ?? 1))
        continue;
      // b inside a: keep the longer / wider one.
      if (len(b.p) > len(a.p) || (len(b.p) === len(a.p) && b.i < a.i)) continue;
      const inside = pts(b.p).filter(
        ([x, z]) => distToLine(x, z, a.p) <= a.p.width / 2 + 1.5,
      );
      if (inside.length >= 0.6 * pts(b.p).length) drop.add(b.i);
    }
  return paths.filter((_, i) => !drop.has(i));
}

/**
 * A ramp / narrower road that merges into a wider deck (OSM draws its last part inside the wider road's footprint)
 * is cut where it enters that footprint: the wider road takes precedence, the merging one ends at its edge (like
 * a ground junction) instead of lying on top of it (two surfaces + two sets of parapets in the same space).
 * Only a run that reaches an END of the narrower deck is cut; a crossing in the middle is a different structure.
 */
export function trimMergingDecks(paths: PathDef[]): PathDef[] {
  const total = (p: PathDef): number => {
    let t = 0;
    for (let k = 0; k + 3 < p.pts.length; k += 2)
      t += Math.hypot(p.pts[k + 2] - p.pts[k], p.pts[k + 3] - p.pts[k + 1]);
    return t;
  };
  const dist = (x: number, z: number, p: PathDef): number => {
    let best = Infinity;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ex = p.pts[k + 2] - p.pts[k];
      const ez = p.pts[k + 3] - p.pts[k + 1];
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(
        0,
        Math.min(1, ((x - p.pts[k]) * ex + (z - p.pts[k + 1]) * ez) / l2),
      );
      best = Math.min(
        best,
        Math.hypot(p.pts[k] + ex * t - x, p.pts[k + 1] + ez * t - z),
      );
    }
    return best;
  };
  const out = paths.map((p) => p);
  const decks = out
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.bridge && p.surface === 'tarmac');
  const gone = new Set<number>();
  for (const b of decks) {
    for (const a of decks) {
      if (a.i === b.i || gone.has(b.i)) continue;
      if (a.p.width < b.p.width + 0.5) continue; // only into a clearly wider road
      const cur = out[b.i];
      const L = total(cur);
      if (L < 6) continue;
      const inside: boolean[] = [];
      const along: number[] = [];
      for (let s = 0; s <= L; s += 2) {
        const [x, z] = polyAt(cur.pts, s);
        along.push(s);
        inside.push(dist(x, z, a.p) <= a.p.width / 2 - 0.2);
      }
      const n = inside.length;
      let head = 0;
      while (head < n && inside[head]) head++;
      let tail = 0;
      while (tail < n && inside[n - 1 - tail]) tail++;
      if (head >= n) {
        gone.add(b.i); // entirely inside the wider road: it is part of it
        continue;
      }
      if (head > 0) {
        const cut = along[head];
        out[b.i] = { ...cur, pts: splitAt(cur.pts, cut, cut)[2] };
      } else if (tail > 0) {
        const cut = along[n - 1 - tail];
        out[b.i] = { ...cur, pts: splitAt(cur.pts, cut, cut)[0] };
      }
      if (out[b.i].pts.length < 4 || total(out[b.i]) < 6) gone.add(b.i);
    }
  }
  return out.filter((_, i) => !gone.has(i));
}
