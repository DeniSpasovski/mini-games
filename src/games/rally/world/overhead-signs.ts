import type {
  MapDef,
  OverheadSignDef,
  SignBoardDef,
} from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import type { Junction } from './junctions';
import { newPathQuery, type PathNetwork } from './real-data';
import type { Road } from './road';

/**
 * Overhead guide signs of a highway map (MapDef.overheadSigns): steel gantries over the stage road carrying
 * green boards. Two sources: the exits (every one-way ramp leaving the stage road gets "EXIT n" + the name
 * of the street it leads to, on a cantilever 130 m before the gore) and hand-placed signs from the map
 * (the finish of the Jackie: the real sequence of boards, generic text). Pure (no three.js scene);
 * gantry-mesh.ts draws them.
 */

export interface GantryPlan {
  along: number;
  /** A gantry over another road (an interchange split): its own frame instead of the stage road at `along`. */
  frame?: { x: number; y: number; z: number; tx: number; tz: number };
  /** 'cantilever' = one post on the right, the arm over the right lane; 'portal' = posts both sides, a beam across. */
  span: 'cantilever' | 'portal';
  /** Posts: lateral distance from the road centre (+ = left) and how far the ground there is below the road centre. */
  posts: { lateral: number; drop: number }[];
  /** Boards along the beam: lateral centre (+ = left) and content. */
  boards: { lateral: number; def: SignBoardDef }[];
}

export interface OverheadSigns {
  gantries: GantryPlan[];
  colliders: StaticCollider[];
}

/** Posts stand this far beyond the road edge (behind the barrier and the lamp posts), m. */
const POST_CLEAR = 2.1;
/** Exit sign ahead of the ramp mouth (m). */
const EXIT_AHEAD = 130;
export const POST_RADIUS = 0.25;
export const GANTRY_CLEARANCE = 5.6;

function distTo(pts: number[], x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ex = pts[k + 2] - pts[k];
    const ez = pts[k + 3] - pts[k + 1];
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(
      0,
      Math.min(1, ((x - pts[k]) * ex + (z - pts[k + 1]) * ez) / l2),
    );
    best = Math.min(
      best,
      Math.hypot(pts[k] + ex * t - x, pts[k + 1] + ez * t - z),
    );
  }
  return best;
}

/**
 * The far end of an exit ramp: the ramp continues through further `*_link` ways (a ramp split into several OSM ways,
 * a loop) until it meets a street.
 */
function rampEnd(net: PathNetwork, link: number): { x: number; z: number } {
  const seen = new Set([link]);
  let cur = link;
  for (;;) {
    const pts = net.paths[cur].pts;
    const ex = pts[pts.length - 2];
    const ez = pts[pts.length - 1];
    let next = -1;
    net.paths.forEach((p, pi) => {
      if (seen.has(pi) || !p.kind.endsWith('_link') || p.bridge) return;
      if (Math.hypot(p.pts[0] - ex, p.pts[1] - ez) < 3) next = pi;
    });
    if (next < 0) return { x: ex, z: ez };
    seen.add(next);
    cur = next;
  }
}

/** Name of the nearest named street to (x, z) within `reach` m (what an exit ramp leads to). */
function streetNameNear(
  net: PathNetwork,
  x: number,
  z: number,
  reach = 40,
): string | undefined {
  let best = reach;
  let name: string | undefined;
  net.paths.forEach((p) => {
    if (!p.name || p.surface !== 'tarmac' || /motorway|trunk/.test(p.kind))
      return;
    const d = distTo(p.pts, x, z);
    if (d < best) {
      best = d;
      name = p.name;
    }
  });
  return name;
}

export function overheadSigns(
  map: MapDef,
  road: Road,
  ground: TerrainSampler,
  net: PathNetwork | undefined,
  junctions: readonly Junction[],
): OverheadSigns {
  const out: OverheadSigns = { gantries: [], colliders: [] };
  const def = map.overheadSigns;
  if (!def) return out;
  const plans: {
    along: number;
    span: 'cantilever' | 'portal';
    boards: SignBoardDef[];
    frame?: SplitFrame;
  }[] = [];

  if (def.exits && net) {
    // Exit ramps: one-way links whose START lies at a junction with the stage road (they leave it).
    let n = def.firstExit ?? 1;
    const exits: { along: number; name?: string }[] = [];
    for (const j of junctions) {
      if (j.kind !== 'motorway_link' || j.side !== -1) continue;
      let link = -1;
      net.paths.forEach((p, pi) => {
        if (p.kind !== 'motorway_link' || !p.oneway) return;
        if (Math.hypot(p.pts[0] - j.x, p.pts[1] - j.z) < 3) link = pi;
      });
      if (link < 0) continue;
      const end = rampEnd(net, link);
      // The ramp's end usually meets the street; a slip road a little short of it is still that street's.
      const name =
        streetNameNear(net, end.x, end.z) ??
        streetNameNear(net, end.x, end.z, 90);
      exits.push({ along: j.along, name });
    }
    exits.sort((a, b) => a.along - b.along);
    let last = -Infinity;
    for (const e of exits) {
      // One sign per exit (a ramp split into two ways gives two junctions close together).
      if (e.along - last < 60) continue;
      last = e.along;
      const along = e.along - EXIT_AHEAD;
      if (along < 60) continue;
      plans.push({
        along,
        span: 'cantilever',
        boards: [
          {
            tab: `EXIT ${n}`,
            lines: [e.name ?? 'NEXT RIGHT'],
            small: e.name ? 'NEXT RIGHT' : undefined,
            arrow: 'right',
          },
        ],
      });
      n++;
    }
  }
  for (const s of def.signs ?? [])
    plans.push({ along: s.along, span: s.span ?? 'portal', boards: s.boards });
  if (def.splits && net)
    for (const sp of splitSigns(net, ground, def.splits))
      plans.push({ along: 0, span: 'portal', ...sp });

  const postQ = newPathQuery();
  for (const p of plans) {
    const s = p.frame
      ? { ...p.frame, halfWidth: p.frame.hw }
      : road.at(p.along);
    const drop = (lat: number): number => {
      const x = s.x + s.tz * lat;
      const z = s.z - s.tx * lat;
      return s.y - ground.height(x, z);
    };
    const edge = s.halfWidth + POST_CLEAR;
    // A post never stands on another road (the opposite carriageway, a ramp, a service road beside the parkway):
    // it steps outward until it is clear of every road surface.
    const clear = (side: 1 | -1): number => {
      let lat = side * edge;
      for (let k = 0; net && k < 200; k++) {
        const x = s.x + s.tz * lat;
        const z = s.z - s.tx * lat;
        net.query(x, z, postQ, 'tarmac');
        // 0.5 m: a post fits the barrier gap between two roads.
        if (!postQ.found || postQ.distance > postQ.halfWidth + 0.5) break;
        lat += side * 0.1;
      }
      return lat;
    };
    const posts =
      p.span === 'portal'
        ? [clear(1), clear(-1)].map((lateral) => ({
            lateral,
            drop: drop(lateral),
          }))
        : [{ lateral: clear(-1), drop: drop(clear(-1)) }];
    // Boards: a cantilever hangs its boards over the right half of the road; a portal spreads them across.
    const boards = p.boards.map((def2, i) => {
      const k = p.boards.length;
      const lateral =
        p.span === 'portal'
          ? ((k - 1) / 2 - i) * (s.halfWidth * 1.1)
          : -s.halfWidth * 0.5 - i * 3.9;
      return { lateral, def: def2 };
    });
    out.gantries.push({
      along: p.along,
      span: p.span,
      posts,
      boards,
      ...(p.frame ? { frame: p.frame } : {}),
    });
    for (const post of posts) {
      const x = s.x + s.tz * post.lateral;
      const z = s.z - s.tx * post.lateral;
      out.colliders.push({
        kind: 'cylinder',
        x,
        y: ground.height(x, z) - 0.2,
        z,
        r: POST_RADIUS,
        h: GANTRY_CLEARANCE + 2.5 + post.drop,
      });
    }
  }
  out.gantries.sort((a, b) => a.along - b.along);
  return out;
}

const CARRIAGEWAY = /^(motorway|trunk)(_link)?$/;

/** A one-way carriageway / ramp way and its end points. */
interface Way {
  pi: number;
  sx: number;
  sz: number;
  ex: number;
  ez: number;
}

/**
 * The motorway a way leads to: its own name if it is a named mainline, else the first named mainline reached going on
 * (the straightest way at each node, up to 3 km), else the street at the end of the ramp.
 */
function destination(
  net: PathNetwork,
  ways: Way[],
  start: number,
): string | undefined {
  let cur = start;
  const seen = new Set<number>();
  let dist = 0;
  while (dist < 3000 && !seen.has(cur)) {
    seen.add(cur);
    const p = net.paths[cur];
    if (p.name && /^(motorway|trunk)$/.test(p.kind)) return p.name;
    dist += net.lengths[cur];
    const w = ways.find((x) => x.pi === cur)!;
    const pts = p.pts;
    const n = pts.length;
    const dx = pts[n - 2] - pts[n - 4];
    const dz = pts[n - 1] - pts[n - 3];
    const dl = Math.hypot(dx, dz) || 1;
    let best = -2;
    let next = -1;
    for (const o of ways) {
      if (seen.has(o.pi) || Math.hypot(o.sx - w.ex, o.sz - w.ez) > 2.5)
        continue;
      const q = net.paths[o.pi].pts;
      const ox = q[2] - q[0];
      const oz = q[3] - q[1];
      const dot = (ox * dx + oz * dz) / ((Math.hypot(ox, oz) || 1) * dl);
      if (dot > best) {
        best = dot;
        next = o.pi;
      }
    }
    if (next < 0) return streetNameNear(net, w.ex, w.ez, 60);
    cur = next;
  }
  return undefined;
}

/** Short road names for a sign board ("Grand Central Parkway" -> "Grand Central Pkwy"). */
const signName = (n: string): string =>
  n
    .replace(/\bParkway\b/, 'Pkwy')
    .replace(/\bExpressway\b/, 'Expwy')
    .replace(/\bBoulevard\b/, 'Blvd')
    .replace(/\bAvenue\b/, 'Ave');

type SplitFrame = NonNullable<GantryPlan['frame']> & { hw: number };

/**
 * Guide signs before the diverges of the carriageways / ramps east of `minX` (MapDef.overheadSigns.splits): a way whose
 * end splits into two one-way ways (both leaving the node, nothing else arriving) gets a portal gantry `ahead` m before
 * the node, a board per direction (straight on pointing down, the branch to its side).
 */
function splitSigns(
  net: PathNetwork,
  ground: TerrainSampler,
  o: { minX?: number; ahead?: number },
): { boards: SignBoardDef[]; frame: SplitFrame }[] {
  const minX = o.minX ?? -Infinity;
  const ahead = o.ahead ?? 110;
  const ways: Way[] = [];
  net.paths.forEach((p, pi) => {
    if (
      !CARRIAGEWAY.test(p.kind) ||
      p.surface !== 'tarmac' ||
      !p.oneway ||
      p.pts.length < 4
    )
      return;
    const n = p.pts.length;
    ways.push({
      pi,
      sx: p.pts[0],
      sz: p.pts[1],
      ex: p.pts[n - 2],
      ez: p.pts[n - 1],
    });
  });
  const out: { boards: SignBoardDef[]; frame: SplitFrame }[] = [];
  const pt = { x: 0, z: 0 };
  const nx = { x: 0, z: 0 };
  const dirOf = (w: Way): [number, number] => {
    const q = net.paths[w.pi].pts;
    const l = Math.hypot(q[2] - q[0], q[3] - q[1]) || 1;
    return [(q[2] - q[0]) / l, (q[3] - q[1]) / l];
  };
  for (const w of ways) {
    if (w.ex < minX) continue;
    const p = net.paths[w.pi];
    if (p.bridge) continue;
    const leave = ways.filter(
      (q) => q.pi !== w.pi && Math.hypot(q.sx - w.ex, q.sz - w.ez) <= 2.5,
    );
    const arrive = ways.filter(
      (q) => q.pi !== w.pi && Math.hypot(q.ex - w.ex, q.ez - w.ez) <= 2.5,
    );
    if (leave.length !== 2 || arrive.length) continue;
    const L = net.lengths[w.pi];
    if (L < 40) continue;
    const at = Math.max(10, L - ahead);
    net.pointAt(w.pi, at, pt);
    net.pointAt(w.pi, Math.min(L, at + 2), nx);
    const tl = Math.hypot(nx.x - pt.x, nx.z - pt.z) || 1;
    const n = p.pts.length;
    const ix = p.pts[n - 2] - p.pts[n - 4];
    const iz = p.pts[n - 1] - p.pts[n - 3];
    const il = Math.hypot(ix, iz) || 1;
    const dots = leave.map((q) => {
      const [dx, dz] = dirOf(q);
      return (dx * ix + dz * iz) / il;
    });
    const thru = dots[0] >= dots[1] ? 0 : 1;
    const br = 1 - thru;
    const [bx, bz] = dirOf(leave[br]);
    // left of travel = (tz, -tx)
    const side: 'left' | 'right' =
      bx * (iz / il) - bz * (ix / il) > 0 ? 'left' : 'right';
    const names = [thru, br].map((k) => destination(net, ways, leave[k].pi));
    if (!names[0] || !names[1] || names[0] === names[1]) continue;
    const thruBoard: SignBoardDef = {
      lines: [signName(names[0])],
      arrow: 'down',
    };
    const brBoard: SignBoardDef = { lines: [signName(names[1])], arrow: side };
    out.push({
      // boards left to right across the road
      boards: side === 'left' ? [brBoard, thruBoard] : [thruBoard, brBoard],
      frame: {
        x: pt.x,
        y: ground.height(pt.x, pt.z),
        z: pt.z,
        tx: (nx.x - pt.x) / tl,
        tz: (nx.z - pt.z) / tl,
        hw: p.width / 2,
      },
    });
  }
  return out;
}

export type { OverheadSignDef };
