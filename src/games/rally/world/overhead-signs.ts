import type {
  MapDef,
  OverheadSignDef,
  SignBoardDef,
} from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import type { Junction } from './junctions';
import type { PathNetwork } from './real-data';
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

  for (const p of plans) {
    const s = road.at(p.along);
    const drop = (lat: number): number => {
      const x = s.x + s.tz * lat;
      const z = s.z - s.tx * lat;
      return s.y - ground.height(x, z);
    };
    const edge = s.halfWidth + POST_CLEAR;
    const posts =
      p.span === 'portal'
        ? [
            { lateral: edge, drop: drop(edge) },
            { lateral: -edge, drop: drop(-edge) },
          ]
        : [{ lateral: -edge, drop: drop(-edge) }];
    // Boards: a cantilever hangs its boards over the right half of the road; a portal spreads them across.
    const boards = p.boards.map((def2, i) => {
      const k = p.boards.length;
      const lateral =
        p.span === 'portal'
          ? ((k - 1) / 2 - i) * (s.halfWidth * 1.1)
          : -s.halfWidth * 0.5 - i * 3.9;
      return { lateral, def: def2 };
    });
    out.gantries.push({ along: p.along, span: p.span, posts, boards });
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

export type { OverheadSignDef };
