import type { PathDef } from '../maps/shared/types';
import { newRoadQuery, type Road } from './road';
import { CUT_RISE, CUT_SETBACK, UNDERPASS_WALL } from './terrain-gen';

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
        p.kind === 'trunk' ||
        // a lane in the parkway's cut (parkway-lanes.ts) runs in its own bore under the slab
        !!p.parkwayLane),
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
    if (
      p.bridge ||
      p.parkwayLane ||
      p.surface !== 'tarmac' ||
      !STREET_KINDS.has(p.kind)
    ) {
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

/** A carriageway deck beside the stage road is aligned to its span when it lies within this lateral reach (m). */
const ALIGN_LATERAL = 30;
/** ... and its ends may move at most this far along the road (m). */
const ALIGN_MAX_SHIFT = 45;

/** Metres of polyline `pts`. */
function polyLength(pts: number[]): number {
  let t = 0;
  for (let k = 0; k + 3 < pts.length; k += 2)
    t += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return t;
}

/** `pts` without its first (`atEnd` false) / last `len` metres. */
function cutEnd(pts: number[], atEnd: boolean, len: number): number[] {
  const L = polyLength(pts);
  const [a, , c] = splitAt(pts, atEnd ? L - len : len, atEnd ? L - len : len);
  return atEnd ? a : c;
}

/**
 * Bridges of the stage road and of the carriageway beside it are one structure: the opposite carriageway's deck
 * (OSM `bridge=yes` way, its own end nodes) starts and ends on the same lines across the road as the stage road's
 * span, up to 10 m off in the baked data (abutments that did not line up, one carriageway "broken" at every
 * crossing). The deck is cut back where it is longer (the rest becomes ground carriageway) or extended where it is
 * shorter (the ground ways that met its old end are shortened to meet the new one).
 */
export function alignParallelDecks(paths: PathDef[], road: Road): PathDef[] {
  const spans = (road.def.spans ?? []).filter((s) => s.kind === 'bridge');
  if (!spans.length) return paths;
  const rq = newRoadQuery();
  const out = paths.slice();
  const extra: PathDef[] = [];
  const trimmed = new Map<number, number[]>();
  const ptsOf = (i: number) => trimmed.get(i) ?? out[i].pts;
  paths.forEach((p, pi) => {
    if (!p.bridge || p.surface !== 'tarmac') return;
    if (p.kind !== 'motorway' && p.kind !== 'trunk') return;
    const L = polyLength(p.pts);
    if (L < 6) return;
    // Along-road coordinate of the deck every metre (and how parallel / near it runs).
    const f: number[] = [];
    let near = 0;
    for (let a = 0; a <= L; a++) {
      const [x, z, dx, dz] = polyAt(p.pts, a);
      road.query(x, z, rq);
      f.push(rq.found ? rq.along : NaN);
      if (rq.found && rq.distance <= ALIGN_LATERAL) {
        const s = road.samples[rq.index];
        if (Math.abs(dx * s.tx + dz * s.tz) > 0.9) near++;
      }
    }
    if (near < f.length * 0.8) return;
    const inc = f[f.length - 1] >= f[0];
    const lo = Math.min(f[0], f[f.length - 1]);
    const hi = Math.max(f[0], f[f.length - 1]);
    // The span this deck overlaps most.
    let best: { from: number; to: number } | undefined;
    let bestOv = 0;
    for (const s of spans) {
      const ov = Math.min(hi, s.to) - Math.max(lo, s.from);
      if (ov > bestOv) {
        bestOv = ov;
        best = s;
      }
    }
    if (
      !best ||
      bestOv <= 0 ||
      Math.abs((lo + hi) / 2 - (best.from + best.to) / 2) > ALIGN_MAX_SHIFT
    )
      return;
    const tStart = inc ? best.from : best.to; // along-road target at the deck's start / end
    const tEnd = inc ? best.to : best.from;
    const shift0 = Math.abs(f[0] - tStart);
    const shift1 = Math.abs(f[f.length - 1] - tEnd);
    if (shift0 > ALIGN_MAX_SHIFT || shift1 > ALIGN_MAX_SHIFT) return;
    // Arc positions of the targets on the deck (nearest sample), or beyond its ends (negative / > L).
    const arc = (target: number, atEnd: boolean): number => {
      const sign = inc ? 1 : -1;
      const end = atEnd ? f.length - 1 : 0;
      const beyond = sign * (atEnd ? target - f[end] : f[end] - target); // > 0: target lies outside the deck
      if (beyond > 0) return atEnd ? L + beyond : -beyond;
      let bi = atEnd ? f.length - 1 : 0;
      let bd = Infinity;
      for (let i = 0; i < f.length; i++) {
        const d = Math.abs(f[i] - target);
        if (d < bd) [bi, bd] = [i, d];
      }
      return bi;
    };
    let a0 = arc(tStart, false);
    let a1 = arc(tEnd, true);
    // A street crossing at a skew passes under this carriageway at another place along the road than under the
    // stage road: the deck must cover it too (+ its trench walls, across the deck's whole width), else the carriageway's
    // ground sits on top of the street (the B2 rock face). Crossings within 25 m beyond either end count.
    {
      const [sx0, sz0, sdx0, sdz0] = polyAt(p.pts, 0);
      const [ex0, ez0, edx0, edz0] = polyAt(p.pts, L);
      const ext = [
        sx0 - sdx0 * 25,
        sz0 - sdz0 * 25,
        ...p.pts,
        ex0 + edx0 * 25,
        ez0 + edz0 * 25,
      ];
      const segs: [number, number, number, number, number][] = []; // ax, az, bx, bz, arc at a (from -25)
      let acc = -25;
      for (let k = 0; k + 3 < ext.length; k += 2) {
        const l = Math.hypot(ext[k + 2] - ext[k], ext[k + 3] - ext[k + 1]);
        segs.push([ext[k], ext[k + 1], ext[k + 2], ext[k + 3], acc]);
        acc += l;
      }
      for (const q of paths) {
        if (q.bridge || q.surface !== 'tarmac' || !STREET_KINDS.has(q.kind))
          continue;
        for (let k = 0; k + 3 < q.pts.length; k += 2) {
          const qx = q.pts[k];
          const qz = q.pts[k + 1];
          const rx = q.pts[k + 2] - qx;
          const rz = q.pts[k + 3] - qz;
          const rl = Math.hypot(rx, rz) || 1;
          for (const [ax, az, bx, bz, arc0] of segs) {
            const dx = bx - ax;
            const dz = bz - az;
            const dl = Math.hypot(dx, dz) || 1;
            const den = dx * rz - dz * rx;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((qx - ax) * rz - (qz - az) * rx) / den;
            const u = ((qx - ax) * dz - (qz - az) * dx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const sin = Math.abs(den) / (dl * rl);
            if (sin < 0.5) continue; // running along, not crossing
            const at = arc0 + t * dl;
            // The trench (street + walls + the sheer step behind them) along the deck's centre line, plus the shift of
            // its edges across the deck's own half width at this skew.
            const cos = Math.sqrt(1 - sin * sin);
            const need =
              (q.width / 2 + UNDERPASS_WALL + CUT_SETBACK + CUT_RISE) / sin +
              ((p.width / 2) * cos) / sin +
              2;
            if (at - need < a0) a0 = Math.max(-25, at - need);
            if (at + need > a1) a1 = Math.min(L + 25, at + need);
          }
        }
      }
    }
    if (a1 - a0 < 6) return;
    if (Math.abs(a0) < 0.5 && Math.abs(a1 - L) < 0.5) return; // already aligned
    // Deck polyline: [a0, a1] clamped to the deck, extended along the end tangents where the target is outside.
    const c0 = Math.max(0, a0);
    const c1 = Math.min(L, a1);
    const [, deck] = c0 > 0 || c1 < L ? splitAt(p.pts, c0, c1) : [[], p.pts];
    let pts = deck.slice();
    const [sx, sz, sdx, sdz] = polyAt(p.pts, 0);
    const [ex, ez, edx, edz] = polyAt(p.pts, L);
    // A grown end takes over the first metres of the ground way that continues it (its own line: a straight
    // tangent stood up to 1 m beside the lane it joins); with no such way, along the end tangent.
    const takeOver = (
      ox: number,
      oz: number,
      grow: number,
    ): number[] | undefined => {
      for (const [qi, q] of paths.entries()) {
        if (qi === pi || q.bridge || q.kind !== p.kind) continue;
        const cur = ptsOf(qi);
        const n = cur.length;
        for (const qEnd of [false, true]) {
          const x = qEnd ? cur[n - 2] : cur[0];
          const z = qEnd ? cur[n - 1] : cur[1];
          if (Math.hypot(x - ox, z - oz) > 2.5) continue;
          const QL = polyLength(cur);
          if (QL < grow + 3) continue;
          const piece = splitAt(cur, qEnd ? QL - grow : 0, qEnd ? QL : grow)[1];
          if (!qEnd) return piece; // from the joint outward
          const rev: number[] = [];
          for (let k = piece.length - 2; k >= 0; k -= 2)
            rev.push(piece[k], piece[k + 1]);
          return rev;
        }
      }
      return undefined;
    };
    if (a0 < 0) {
      const t = takeOver(sx, sz, -a0);
      const head: number[] = [];
      if (t)
        for (let k = t.length - 2; k >= 2; k -= 2) head.push(t[k], t[k + 1]);
      pts = t ? [...head, ...pts] : [sx + sdx * a0, sz + sdz * a0, ...pts];
    }
    if (a1 > L) {
      const t = takeOver(ex, ez, a1 - L);
      pts = t
        ? [...pts, ...t.slice(2)]
        : [...pts, ex + edx * (a1 - L), ez + edz * (a1 - L)];
    }
    // Pieces cut off the deck stay as ground carriageway.
    const ground = (g: number[]) => {
      const q: PathDef = { ...p, pts: g };
      delete q.bridge;
      delete q.layer;
      return q;
    };
    if (a0 > 0.5) extra.push(ground(splitAt(p.pts, a0, a0)[0]));
    if (a1 < L - 0.5) extra.push(ground(splitAt(p.pts, a1, a1)[2]));
    // Ground ways that met an end the deck now overshoots are shortened to the new end.
    const trim = (atEnd: boolean, ox: number, oz: number, grow: number) => {
      if (grow < 0.5) return;
      paths.forEach((q, qi) => {
        if (qi === pi || q.bridge) return;
        const n = q.pts.length;
        for (const qEnd of [false, true]) {
          const x = qEnd ? q.pts[n - 2] : q.pts[0];
          const z = qEnd ? q.pts[n - 1] : q.pts[1];
          if (Math.hypot(x - ox, z - oz) > 2.5) continue;
          const cur = ptsOf(qi);
          if (polyLength(cur) < grow + 3) continue;
          trimmed.set(qi, cutEnd(cur, qEnd, grow));
        }
      });
      void atEnd;
    };
    trim(false, sx, sz, a0 < 0 ? -a0 : 0);
    trim(true, ex, ez, a1 > L ? a1 - L : 0);
    out[pi] = { ...p, pts };
  });
  return [
    ...out.map((p, i) => (trimmed.has(i) ? { ...p, pts: trimmed.get(i)! } : p)),
    ...extra,
  ];
}

/** Twin decks: free lateral distance between their centre lines (m), see `alignTwinDeckEnds`. */
const TWIN_SEP: [number, number] = [3, 14];
/** Largest end correction of a twin deck (m). */
const TWIN_MAX_GROW = 10;

/** Another deck than `skip` has an end at (ox, oz). */
function deckEndAt(
  paths: PathDef[],
  skip: number,
  ox: number,
  oz: number,
): boolean {
  return paths.some((q, qi) => {
    if (qi === skip || !q.bridge || q.surface !== 'tarmac') return false;
    const n = q.pts.length;
    return (
      Math.hypot(q.pts[0] - ox, q.pts[1] - oz) < 1 ||
      Math.hypot(q.pts[n - 2] - ox, q.pts[n - 1] - oz) < 1
    );
  });
}

/** Ground ways with an end at (ox, oz) lose `grow` metres there (they now meet the grown deck end). */
function trimNeighbours(
  paths: PathDef[],
  trimmed: Map<number, number[]>,
  skip: number,
  ox: number,
  oz: number,
  grow: number,
): void {
  paths.forEach((q, qi) => {
    if (qi === skip || q.bridge) return;
    const n = q.pts.length;
    for (const qEnd of [false, true]) {
      const x = qEnd ? q.pts[n - 2] : q.pts[0];
      const z = qEnd ? q.pts[n - 1] : q.pts[1];
      if (Math.hypot(x - ox, z - oz) > 2.5) continue;
      const cur = trimmed.get(qi) ?? q.pts;
      if (polyLength(cur) < grow + 3) continue;
      trimmed.set(qi, cutEnd(cur, qEnd, grow));
    }
  });
}

/**
 * The two directions of an overpass street are two decks side by side (OSM: a way per direction) whose end nodes sit
 * a few metres apart along the street. Drawn as one slab (twin-decks.ts) that leaves a stepped end: the shorter
 * deck is extended so both end on the same cross line (the union of their extents).
 */
export function alignTwinDeckEnds(paths: PathDef[]): PathDef[] {
  const isStreetDeck = (p: PathDef) =>
    !!p.bridge &&
    p.surface === 'tarmac' &&
    (STREET_KINDS.has(p.kind) || p.kind === 'motorway_link');
  const out = paths.slice();
  const trimmed = new Map<number, number[]>();
  const ends = (p: PathDef) => {
    const L = polyLength(p.pts);
    const [sx, sz, sdx, sdz] = polyAt(p.pts, 0);
    const [ex, ez, edx, edz] = polyAt(p.pts, L);
    return { L, sx, sz, sdx, sdz, ex, ez, edx, edz };
  };
  for (let i = 0; i < paths.length; i++) {
    if (!isStreetDeck(paths[i])) continue;
    for (let j = i + 1; j < paths.length; j++) {
      if (!isStreetDeck(paths[j])) continue;
      const a = out[i];
      const b = out[j];
      if ((a.layer ?? 1) !== (b.layer ?? 1)) continue;
      const ea = ends(a);
      const eb = ends(b);
      const cx = ea.ex - ea.sx;
      const cz = ea.ez - ea.sz;
      const cl = Math.hypot(cx, cz);
      if (cl < 6) continue;
      const dx = cx / cl;
      const dz = cz / cl;
      // b's chord in a's frame (t along a's chord, u across).
      const bt0 = (eb.sx - ea.sx) * dx + (eb.sz - ea.sz) * dz;
      const bt1 = (eb.ex - ea.sx) * dx + (eb.ez - ea.sz) * dz;
      const bu0 = (eb.sx - ea.sx) * dz - (eb.sz - ea.sz) * dx;
      const bu1 = (eb.ex - ea.sx) * dz - (eb.ez - ea.sz) * dx;
      const bcl = Math.abs(bt1 - bt0);
      if (bcl < 6 || Math.abs(bu1 - bu0) > 0.25 * bcl) continue; // not parallel
      if (Math.min(cl, bcl) < 0.6 * Math.max(cl, bcl)) continue; // a short deck beside a long one: another structure
      const sep = Math.abs((bu0 + bu1) / 2);
      if (sep < TWIN_SEP[0] || sep > TWIN_SEP[1]) continue;
      const lo = Math.min(bt0, bt1);
      const hi = Math.max(bt0, bt1);
      const overlap = Math.min(cl, hi) - Math.max(0, lo);
      if (overlap < 0.7 * Math.min(cl, hi - lo)) continue;
      const T0 = Math.min(0, lo);
      const T1 = Math.max(cl, hi);
      // Extend an end of deck `k` by `grow` m along its end tangent.
      const extend = (k: number, atEnd: boolean, grow: number) => {
        if (grow < 0.3 || grow > TWIN_MAX_GROW) return;
        const p = out[k];
        const e = ends(p);
        const [ox, oz, tx, tz] = atEnd
          ? [e.ex, e.ez, e.edx, e.edz]
          : [e.sx, e.sz, -e.sdx, -e.sdz]; // outward tangent
        // A deck that continues into another deck there (one structure in several ways) has no free end to grow.
        if (deckEndAt(out, k, ox, oz)) return;
        const nxp = [ox + tx * grow, oz + tz * grow];
        out[k] = { ...p, pts: atEnd ? [...p.pts, ...nxp] : [...nxp, ...p.pts] };
        trimNeighbours(paths, trimmed, k, ox, oz, grow);
      };
      // a: start at t = 0, end at cl.  b: its low-t / high-t ends.
      extend(i, false, -T0);
      extend(i, true, T1 - cl);
      const bLowIsStart = bt0 <= bt1;
      extend(j, !bLowIsStart, lo - T0); // the end with the lower t
      extend(j, bLowIsStart, T1 - hi); // the end with the higher t
    }
  }
  return out.map((p, i) =>
    trimmed.has(i) ? { ...p, pts: trimmed.get(i)! } : p,
  );
}

/** Median left between the stage road and the opposite carriageway when its width is matched (m). */
const MIN_MEDIAN = 0.5;
/** The opposite carriageway is at most this far from the stage road (centre to centre, m). */
const CARRIAGEWAY_REACH = 16;

/**
 * The opposite carriageway of the divided highway looks like the stage road: the stage road's width beside it (OSM lane
 * counts and the baker's room limit gave it other widths, so its lane markings, edge lines and barriers did not match),
 * as far as the median allows (a median of at least MIN_MEDIAN). Only two-lane mainline ways that run parallel beside the
 * stage road; wider / narrower ways (lane gains, ramps) keep their width.
 */
export function matchCarriagewayWidth(paths: PathDef[], road: Road): PathDef[] {
  const rq = newRoadQuery();
  return paths.map((p) => {
    if (p.kind !== 'motorway' || p.surface !== 'tarmac') return p;
    if (p.lanes !== undefined && p.lanes > 2) return p;
    const L = polyLength(p.pts);
    if (L < 6) return p;
    // gap to the stage road's edge, and the stage road's width, at each sample beside it
    const d: number[] = [];
    let wSum = 0;
    let near = 0;
    let total = 0;
    for (let a = 0; a <= L; a += 2) {
      const [x, z, dx, dz] = polyAt(p.pts, a);
      road.query(x, z, rq);
      total++;
      if (!rq.found || rq.distance > CARRIAGEWAY_REACH) continue;
      const s = road.samples[rq.index];
      if (Math.abs(dx * s.tx + dz * s.tz) < 0.9) continue;
      near++;
      d.push(rq.distance - rq.halfWidth);
      wSum += 2 * rq.halfWidth;
    }
    if (near < total * 0.8) return p;
    d.sort((u, v) => u - v);
    const target = Math.round((wSum / near) * 20) / 20;
    const room = 2 * (d[Math.floor(d.length * 0.1)] - MIN_MEDIAN);
    const width = Math.min(target, Math.max(Math.min(6, target), room));
    return Math.abs(width - p.width) < 0.05 ? p : { ...p, width };
  });
}

/** Free gap kept between a street and a carriageway it runs beside (m): room for the barrier between them. */
const SEPARATE_GAP = 1.2;

/**
 * A street drawn alongside a carriageway of the parkway (a service road, an avenue beside it) never overlaps its
 * lanes: OSM centre lines with real widths overlapped by up to 2.5 m (the north lane looked broken and the barrier
 * between them could not stand anywhere). The street's nodes move sideways, away from the carriageway, until the
 * road edges are SEPARATE_GAP apart. Only where the two run parallel (crossings and junctions stay as they are).
 */
export function separateStreets(paths: PathDef[], road: Road): PathDef[] {
  const portals = (road.def.spans ?? []).filter((sp) => sp.kind === 'under');
  const rq = newRoadQuery();
  const lanes = paths.filter(
    (p) =>
      !p.bridge && p.surface === 'tarmac' && /^(motorway|trunk)$/.test(p.kind),
  );
  if (!lanes.length) return paths;
  // Moved nodes: other ways that share them (a cross street at a junction) move with them.
  const moves: [number, number, number, number][] = [];
  const out = paths.map((p) => {
    if (p.bridge || p.surface !== 'tarmac' || !STREET_KINDS.has(p.kind))
      return p;
    const pts = p.pts.slice();
    let moved = false;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k];
      const z = pts[k + 1];
      // Not on / next to a portal slab: the street grid there is the plaza on top of it.
      road.query(x, z, rq);
      if (
        rq.found &&
        portals.some((sp) => rq.along > sp.from - 30 && rq.along < sp.to + 30)
      )
        continue;
      // Street direction at this node.
      const k0 = Math.max(0, k - 2);
      const k1 = Math.min(pts.length - 2, k + 2);
      const sl = Math.hypot(pts[k1] - pts[k0], pts[k1 + 1] - pts[k0 + 1]) || 1;
      const sx = (pts[k1] - pts[k0]) / sl;
      const sz = (pts[k1 + 1] - pts[k0 + 1]) / sl;
      for (const c of lanes) {
        const need = p.width / 2 + c.width / 2 + SEPARATE_GAP;
        for (let j = 0; j + 3 < c.pts.length; j += 2) {
          const ax = c.pts[j];
          const az = c.pts[j + 1];
          const ex = c.pts[j + 2] - ax;
          const ez = c.pts[j + 3] - az;
          const l2 = ex * ex + ez * ez;
          if (l2 < 1e-6) continue;
          const t = ((x - ax) * ex + (z - az) * ez) / l2;
          if (t < 0 || t > 1) continue;
          const px = ax + ex * t;
          const pz = az + ez * t;
          const d = Math.hypot(x - px, z - pz);
          if (d >= need || d < 0.5) continue;
          const l = Math.sqrt(l2);
          if (Math.abs((sx * ex + sz * ez) / l) < 0.9) continue; // crossing / joining, not alongside
          pts[k] = px + ((x - px) / d) * need;
          pts[k + 1] = pz + ((z - pz) / d) * need;
          moves.push([x, z, pts[k], pts[k + 1]]);
          moved = true;
        }
      }
    }
    return moved ? { ...p, pts } : p;
  });
  if (!moves.length) return out;
  return out.map((p, i) => {
    if (p !== paths[i] || p.bridge) return p;
    let pts: number[] | undefined;
    for (let k = 0; k < p.pts.length; k += 2)
      for (const [ox, oz, nx, nz] of moves)
        if (
          Math.abs(p.pts[k] - ox) < 0.3 &&
          Math.abs(p.pts[k + 1] - oz) < 0.3
        ) {
          pts ??= p.pts.slice();
          pts[k] = nx;
          pts[k + 1] = nz;
        }
    return pts ? { ...p, pts } : p;
  });
}
