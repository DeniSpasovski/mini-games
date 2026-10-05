import type { TrenchFill } from '../maps/shared/types';
import type { PathNetwork } from './real-data';
import { newPathQuery } from './real-data';
import { newRoadQuery, type Road, type RoadQuery } from './road';

/**
 * Portals: the structures a sunken parkway runs UNDER (`RoadSpan` kind `under`, OSM `tunnel=yes layer=-1`
 * on the route): a cut-and-cover slab between the retaining walls of the cut, carrying the street grid
 * on top (Queens Boulevard over the finish of the Jackie, Myrtle Avenue, the Union Turnpike overlook).
 *
 * - The slab is one structure per span: footprint = the span's length x wall to wall (the far wall of the
 *   opposite carriageway included), top = road + clearance. bridge-mesh.ts draws the soffit with its
 *   beams, the stone headwalls at both ends with name / clearance plates, the parapets along the long
 *   edges, the piers in the median; world.ts makes the piers solid.
 * - The land around the structure is a pad at the slab top (`padRaise`, applied in
 *   TerrainGenerator.naturalHeight): the lidar DEM holds the trench floor there, the street grid on top
 *   of the structure is the real ground. Streets inside the trench footprint (a service lane beside the
 *   carriageways) and the carriageways themselves are not raised.
 * - Decks of streets crossing the slab (under-bridges.ts makes them) are lifted to the slab top and drawn
 *   without their own fascia / parapets / abutments inside the footprint (the slab is the structure).
 *
 * Pure (no three.js scene): the world tests run it in node.
 */

/** Row spacing along the span (m). */
export const PORTAL_STEP = 2;
/** Slab thickness (m): the soffit sits this far below the slab top, the beams hang below it. */
export const SLAB_T = 0.55;
/** Pier spacing along a portal's median (m). */
export const PIER_GAP = 6;
/** Deck slab overhang beyond the road edge, parapet height and thickness (m) - bridge-mesh.ts draws them, world.ts makes them solid. */
export const DECK_OVERHANG = 0.45;
export const PARAPET_H = 1.0;
export const PARAPET_T = 0.4;
/** The pad fades out over this distance beyond the span ends (m along the road)... */
const PAD_ALONG = 30;
/** ... and over this distance beyond its lateral reach (m). */
const PAD_LAT = 25;
/** The pad reaches this far beyond the outer wall lines (the top of the structure: streets, plazas) (m). */
const PAD_OVER = 40;
/** How far beside the stage road a carriageway is looked for (m). */
const CARRIAGEWAY_REACH = 30;

export interface PortalRow {
  along: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Stage road height. */
  y: number;
  /** Slab top (street level). */
  top: number;
  /** Lateral extent of the slab (wall lines): left (> 0) and right (< 0), + = left of travel. */
  latL: number;
  latR: number;
}

export interface Portal {
  from: number;
  to: number;
  rows: PortalRow[];
  /** Street name on the headwall plate (the widest named deck crossing it), if known. */
  name?: string;
}

export interface PortalHit {
  portal: Portal;
  along: number;
  /** Signed lateral offset from the stage road centre (+ = left). */
  lateral: number;
  /** Metres beyond the span ends along the road (0 inside). */
  outside: number;
  top: number;
  latL: number;
  latR: number;
  /** Inside the slab footprint (between the walls, within the span). */
  inside: boolean;
}

export interface PortalOptions {
  /** Free height between the road and the slab top (m). */
  clearance: number;
  /** Wall line beyond a carriageway edge: verge + retaining wall offset (m). */
  wallOffset: number;
  /** Carriageways of the divided highway (the far wall stands beyond them). */
  isCarriageway?: (pi: number) => boolean;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildPortals(
  road: Road,
  net: PathNetwork | undefined,
  opts: PortalOptions,
): Portal[] {
  const out: Portal[] = [];
  const pq = newPathQuery();
  for (const sp of road.def.spans ?? []) {
    if (sp.kind !== 'under') continue;
    const rows: PortalRow[] = [];
    for (let a = sp.from; ; a += PORTAL_STEP) {
      const along = Math.min(a, sp.to);
      const s = road.at(along);
      const own = s.halfWidth + opts.wallOffset;
      // Outermost carriageway edge on each side within reach, else the stage road's own wall line.
      const extent = (side: 1 | -1): number => {
        if (!net || !opts.isCarriageway) return own;
        let far = 0;
        for (let l = s.halfWidth; l <= CARRIAGEWAY_REACH; l += 1) {
          const x = s.x + s.tz * l * side;
          const z = s.z - s.tx * l * side;
          net.query(x, z, pq, 'tarmac', opts.isCarriageway);
          if (pq.found && pq.distance <= pq.halfWidth + 0.3) far = l;
        }
        return far > 0 ? far + 0.5 + opts.wallOffset : own;
      };
      rows.push({
        along,
        x: s.x,
        z: s.z,
        tx: s.tx,
        tz: s.tz,
        y: s.y,
        top: s.y + opts.clearance,
        latL: Math.max(own, extent(1)),
        latR: -Math.max(own, extent(-1)),
      });
      if (along >= sp.to) break;
    }
    if (rows.length < 2) continue;
    // Smooth the extents (the carriageway probe is coarse) and the top.
    for (const key of ['latL', 'latR', 'top'] as const) {
      const v = rows.map((r) => r[key]);
      rows.forEach((r, i) => {
        let sum = 0;
        let n = 0;
        for (let k = -3; k <= 3; k++) {
          const j = i + k;
          if (j < 0 || j >= v.length) continue;
          sum += v[j];
          n++;
        }
        r[key] = sum / n;
      });
    }
    // The smoothing never takes the top below the clearance.
    for (const r of rows) r.top = Math.max(r.top, r.y + opts.clearance);
    // Name on the headwall: the widest named deck that crosses the slab.
    let name: string | undefined;
    if (net) {
      let best = 0;
      const pt = { x: 0, z: 0 };
      const q = newRoadQuery();
      net.paths.forEach((p, pi) => {
        if (!p.bridge || !p.name || p.width <= best) return;
        const L = net.lengths[pi];
        for (let a = 0; a <= L; a += 3) {
          net.pointAt(pi, a, pt);
          road.query(pt.x, pt.z, q);
          if (
            q.found &&
            q.along >= sp.from &&
            q.along <= sp.to &&
            q.distance <= q.halfWidth + 2
          ) {
            best = p.width;
            name = p.name;
            break;
          }
        }
      });
    }
    out.push({ from: sp.from, to: sp.to, rows, name });
  }
  return out;
}

/** Spatial lookup of the portals of a map (and of the trench fills, `RoadDef.trenchFills`, which pad the land the same way). */
export class Portals {
  private q: RoadQuery = newRoadQuery();
  private readonly fills: TrenchFill[];
  constructor(
    readonly list: Portal[],
    private readonly road: Road,
  ) {
    this.fills = road.def.trenchFills ?? [];
  }

  get empty(): boolean {
    return this.list.length === 0 && this.fills.length === 0;
  }

  /** Portal row data at (x, z) when within `margin` m along of a span, else undefined. */
  at(x: number, z: number, margin = 0): PortalHit | undefined {
    if (!this.list.length) return undefined;
    const q = this.road.query(x, z, this.q);
    if (!q.found) return undefined;
    for (const p of this.list) {
      if (q.along < p.from - margin || q.along > p.to + margin) continue;
      const outside = Math.max(0, p.from - q.along, q.along - p.to);
      const t = Math.min(
        p.rows.length - 1,
        Math.max(0, (q.along - p.from) / PORTAL_STEP),
      );
      const i = Math.floor(t);
      const f = t - i;
      const a = p.rows[i];
      const b = p.rows[Math.min(p.rows.length - 1, i + 1)];
      const lerp = (u: number, v: number) => u + (v - u) * f;
      const latL = lerp(a.latL, b.latL);
      const latR = lerp(a.latR, b.latR);
      return {
        portal: p,
        along: q.along,
        lateral: q.lateral,
        outside,
        top: lerp(a.top, b.top),
        latL,
        latR,
        inside: outside === 0 && q.lateral <= latL && q.lateral >= latR,
      };
    }
    return undefined;
  }

  /** The land raised onto the structure's top around a portal / along a trench fill (never lowered): `h` -> pad height. */
  padRaise(x: number, z: number, h: number): number {
    if (this.fills.length) {
      const q = this.road.query(x, z, this.q);
      if (q.found)
        for (const f of this.fills) {
          const outside = Math.max(0, f.from - q.along, q.along - f.to);
          if (outside > PAD_LAT) continue;
          const t = Math.min(
            1,
            Math.max(0, (q.along - f.from) / (f.to - f.from)),
          );
          const top = q.height + f.depth[0] + (f.depth[1] - f.depth[0]) * t;
          const w =
            (1 - smoothstep(0, PAD_LAT, outside)) *
            (1 - smoothstep(f.halfWidth, f.halfWidth + PAD_LAT, q.distance));
          if (w > 0 && top > h) h += (top - h) * w;
        }
    }
    const hit = this.at(x, z, PAD_ALONG);
    if (!hit) return h;
    const wa = 1 - smoothstep(0, PAD_ALONG, hit.outside);
    const outer = Math.max(hit.latL, -hit.latR) + PAD_OVER;
    const wl = 1 - smoothstep(outer, outer + PAD_LAT, Math.abs(hit.lateral));
    const w = wa * wl;
    if (w <= 0 || hit.top <= h) return h;
    return h + (hit.top - h) * w;
  }

  /** True when (x, z) lies on a slab (inside the footprint). */
  inside(x: number, z: number): boolean {
    return !!this.at(x, z)?.inside;
  }
}
