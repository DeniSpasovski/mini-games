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
  /** The side road runs straight on from the stage road, which turns here (the real road continues straight). */
  through?: boolean;
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
  road_tarmac_plain_kerbed: 'road_tarmac_plain_junction',
};

/** How far a side road end may be from the stage road edge and still be joined (m). */
const MAX_GAP = 20;
/** The ray towards the road is followed this far (shallow junctions need long rays). */
const MAX_RAY = 45;
/** Side-road end direction is measured against a vertex at least this far back (m). */
const REF_BACK = 8;
/** The extended end stops this far past the stage road edge (hidden under its ribbon, m). */
const OVERSHOOT = 1;
/** A junction is straight on when the stage road turns more than THROUGH_TURN between its arms THROUGH_ARM m either
 * side, and the side road leaves within THROUGH_STRAIGHT of one arm's line (radians, m). */
const THROUGH_TURN = (30 * Math.PI) / 180;
const THROUGH_ARM = 15;
const THROUGH_STRAIGHT = (25 * Math.PI) / 180;
/** A straight-on road eases from the line of the stage road's arm onto its own line over this many metres (m). */
const THROUGH_BLEND = 90;
/** A side road joining within this angle of the stage road's line is a merge, not a mouth (radians). */
export const MERGE_ANGLE = (35 * Math.PI) / 180;
/** Length over which a merging road bends onto the stage road's line (m). */
const MERGE_RUN = 12;
/** Way ends closer than this are one node of the street network (m). */
const SHARED_END = 2.5;

/**
 * A road the stage road turns off (`Junction.through`), rebuilt from its end: it carries on the line of the stage road's
 * arm before the junction and eases onto its own line over THROUGH_BLEND m, starting a few metres back down that arm
 * under the stage ribbon. The real road reads as the one running straight on, the stage road as the one turning off
 * (the map's stage line cuts the corner, so the way's own end sat metres off the arm's line, a jog at the junction).
 */
function straightOn(
  pts: number[],
  atEnd: boolean,
  road: Road,
  along: number,
  ex: number,
  ez: number,
): number[] {
  const n = pts.length / 2;
  // The way's points from its end outward.
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const k = atEnd ? n - 1 - i : i;
    out.push([pts[k * 2], pts[k * 2 + 1]]);
  }
  const cum = [0];
  for (let i = 1; i < n; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]),
    );
  const at = (d: number): [number, number] => {
    let i = 1;
    while (i < n - 1 && cum[i] < d) i++;
    const t = Math.min(
      1,
      Math.max(0, (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)),
    );
    return [
      out[i - 1][0] + (out[i][0] - out[i - 1][0]) * t,
      out[i - 1][1] + (out[i][1] - out[i - 1][1]) * t,
    ];
  };
  const a0 = road.at(along - THROUGH_ARM);
  const t0 = (ex - a0.x) * a0.tx + (ez - a0.z) * a0.tz;
  const blend = Math.min(THROUGH_BLEND, cum[n - 1] * 0.5);
  const next: [number, number][] = [
    [a0.x - a0.tx * 3, a0.z - a0.tz * 3],
    [a0.x, a0.z],
  ];
  for (let d = 0; d <= blend + 1e-6; d += 3) {
    const w = d / blend;
    const f = w * w * (3 - 2 * w);
    const [bx, bz] = at(d);
    const lx = a0.x + a0.tx * (t0 + d);
    const lz = a0.z + a0.tz * (t0 + d);
    next.push([lx + (bx - lx) * f, lz + (bz - lz) * f]);
  }
  for (let i = 0; i < n; i++) if (cum[i] > blend + 1.5) next.push(out[i]);
  if (atEnd) next.reverse();
  return next.flat();
}

export function connectPaths(
  paths: PathDef[],
  road: Road,
  /** Widen straight-on roads to the stage road's width (not on city maps: their streets keep kerbs at their own width). */
  widenThrough = true,
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
    let widen: PathDef['widenEnd'];
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
      // Off the stage road's start / finish (the street the stage road carries on from): the way runs on to the stage
      // road's end and a metre under its ribbon, end to end - no junction mouth, kerb returns or barrier.
      const atStart = q.along < 0.5;
      const e0 = road.at(atStart ? 0 : road.length);
      const e1 = road.at(atStart ? 1 : road.length - 1);
      if (
        (atStart || q.along > road.length - 0.5) &&
        Math.hypot(ex - e0.x, ez - e0.z) < MAX_GAP &&
        // heading into the stage road, not past its end
        dx * (e1.x - e0.x) + dz * (e1.z - e0.z) > 0.5
      ) {
        // (widening to the stage road's width: no corner of the stage road's end left over the verge)
        if (p.surface === 'tarmac') widen = { atEnd, width: e0.halfWidth * 2 };
        pts = atEnd
          ? [...pts, e0.x, e0.z, e1.x, e1.z]
          : [e1.x, e1.z, e0.x, e0.z, ...pts];
        continue;
      }
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
      // Straight on: the side road carries on the line the stage road arrives on, and the stage road turns off it there by
      // more than THROUGH_TURN (the rally route leaves the real road; where it joins one from a side road, that road is
      // already the stage road's next arm).
      const s0 = road.at(q.along - THROUGH_ARM);
      const s1 = road.at(q.along + THROUGH_ARM);
      const through =
        s0.tx * s1.tx + s0.tz * s1.tz < Math.cos(THROUGH_TURN) &&
        -dx * s0.tx - dz * s0.tz > Math.cos(THROUGH_STRAIGHT);
      const wide = through && p.surface === 'tarmac' && widenThrough;
      if (wide)
        widen = { atEnd, width: road.at(q.along).halfWidth * 2, over: true };
      // A shallow merge (within MERGE_ANGLE of the stage road's line) bends onto the stage road's line over MERGE_RUN m and
      // ends inside it, its outer edge running into the stage road's edge like a fork, instead of a square cut across the verge.
      const sj = road.at(q.along);
      const cosA = dx * sj.tx + dz * sj.tz;
      let added: number[];
      if (
        !wide &&
        p.surface === 'tarmac' &&
        Math.abs(cosA) > Math.cos(MERGE_ANGLE)
      ) {
        const dir = Math.sign(cosA);
        const side = q.lateral >= 0 ? 1 : -1;
        const inset = Math.max(0, sj.halfWidth - p.width / 2) * side;
        added = [];
        for (const f of [0.5, 1]) {
          const a = road.at(q.along + dir * MERGE_RUN * f);
          const lat = side * a.halfWidth + (inset - side * a.halfWidth) * f;
          // the stage road's normal: (tz, -tx) is +lateral
          added.push(a.x + a.tz * lat, a.z - a.tx * lat);
        }
      } else {
        // (a straight-on road runs on across the stage road, under its ribbon: its full width meets the stage road's edge
        // where that edge bends away, no sliver of verge between them)
        const reach =
          hit + (wide ? road.at(q.along).halfWidth * 0.8 : OVERSHOOT);
        added = [ex + dx * reach, ez + dz * reach];
      }
      if (wide) pts = straightOn(pts, atEnd, road, q.along, ex, ez);
      else if (atEnd) pts = [...pts, ...added];
      else {
        const rev: number[] = [];
        for (let i = added.length - 2; i >= 0; i -= 2)
          rev.push(added[i], added[i + 1]);
        pts = [...rev, ...pts];
      }
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
        through,
      });
    }
    if (widen) return { ...p, pts, widenEnd: widen };
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
  // (straight on: the corner to round is the one into the arm the stage road turns onto, past the junction - the
  // tangent at the junction point is halfway round the turn and put the corner metres off)
  const s0 = road.at(j.along + (j.through ? THROUGH_ARM * 0.7 : 0));
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
