import type { Portal, Portals } from './portals';

/**
 * Junction plazas (`MapDef.junctionPlazas`): the box of a big city intersection on top of a portal slab (Queens
 * Boulevard x Union Turnpike over the finish of the Jackie). OSM draws every carriageway of every street as its own
 * way, so their ribbons and decks cross each other at odd angles there; the real junction is one paved surface
 * without lane lines. Inside a plaza:
 *
 * - the land is levelled to the plaza height (`level`, TerrainGenerator.naturalHeight),
 * - one plain asphalt surface is drawn (plaza-mesh.ts) on a straight grade between the portal's headwall tops,
 * - street ribbons, deck surfaces and their bodies / abutments and the slab parapets are left out
 *   (road-mesh.ts, bridge-mesh.ts), kerbs / sidewalks / crosswalks / lamps stop at its edge (street-detail.ts).
 *
 * The plaza never covers the open trench beyond a portal's span ends. Pure (no scene): node tests run it.
 */

/** The land blends from the plaza height back to its own over this distance beyond the edge (m). */
const BLEND = 8;

interface Poly {
  pts: number[];
  /** The portal it sits on (the nearest to its centre). */
  portal?: Portal;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function inPoly(p: number[], x: number, z: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const zi = p[i * 2 + 1];
    const xj = p[j * 2];
    const zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
}

/** Distance from (x, z) to the outline of `p` (m). */
function edgeDistance(p: number[], x: number, z: number): number {
  let best = Infinity;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2];
    const az = p[j * 2 + 1];
    const ex = p[i * 2] - ax;
    const ez = p[i * 2 + 1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Plazas {
  readonly polys: Poly[];
  constructor(outlines: number[][], portals: Portals) {
    this.polys = outlines.map((pts) => {
      const xs = pts.filter((_, i) => i % 2 === 0);
      const zs = pts.filter((_, i) => i % 2 === 1);
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
      let portal: Portal | undefined;
      let best = Infinity;
      for (const pt of portals.list)
        for (const r of pt.rows) {
          const d = Math.hypot(r.x - cx, r.z - cz);
          if (d < best) {
            best = d;
            portal = pt;
          }
        }
      return {
        pts,
        portal,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
    });
  }

  get empty(): boolean {
    return this.polys.length === 0;
  }

  /**
   * (x, z) in the frame of the plaza's portal, by its rows (not the road query: that only reaches a few tens of metres
   * beside the road): slab top, lateral offset + wall lines of the nearest row, metres beyond the span ends.
   */
  private frame(
    p: Poly,
    x: number,
    z: number,
  ):
    | {
        top: number;
        lateral: number;
        latL: number;
        latR: number;
        outside: number;
      }
    | undefined {
    const rows = p.portal?.rows;
    if (!rows?.length) return undefined;
    const ahead = (i: number) =>
      (x - rows[i].x) * rows[i].tx + (z - rows[i].z) * rows[i].tz;
    const at = (i: number, f: number, outside: number) => {
      const a = rows[i];
      const b = rows[Math.min(rows.length - 1, i + 1)];
      const lerp = (u: number, v: number) => u + (v - u) * f;
      const rx = lerp(a.x, b.x);
      const rz = lerp(a.z, b.z);
      // A straight grade between the headwall tops (the slab top sags with the parkway's profile in between; the
      // street is level over it), never below the slab.
      const t = (i + f) / Math.max(1, rows.length - 1);
      const grade = rows[0].top + (rows[rows.length - 1].top - rows[0].top) * t;
      return {
        top: Math.max(grade, lerp(a.top, b.top)),
        // + = left of travel, as PortalHit.
        lateral: (x - rx) * a.tz - (z - rz) * a.tx,
        latL: lerp(a.latL, b.latL),
        latR: lerp(a.latR, b.latR),
        outside,
      };
    };
    const first = ahead(0);
    if (first < 0) return at(0, 0, -first);
    const last = ahead(rows.length - 1);
    if (last > 0) return at(rows.length - 1, 0, last);
    for (let i = 0; i + 1 < rows.length; i++) {
      const u = ahead(i);
      const v = ahead(i + 1);
      if (u >= 0 && v <= 0) return at(i, u - v > 0 ? u / (u - v) : 0, 0);
    }
    return undefined;
  }

  /** Over the open trench beyond a portal's span ends (never paved). */
  private overTrench(p: Poly, x: number, z: number): boolean {
    const f = this.frame(p, x, z);
    return (
      !!f &&
      f.outside > 0 &&
      f.lateral <= f.latL + 0.5 &&
      f.lateral >= f.latR - 0.5
    );
  }

  /** Index of the plaza (x, z) lies in, -1 = none. */
  indexAt(x: number, z: number, pad = 0): number {
    for (let i = 0; i < this.polys.length; i++) {
      const p = this.polys[i];
      if (
        x < p.minX - pad ||
        x > p.maxX + pad ||
        z < p.minZ - pad ||
        z > p.maxZ + pad
      )
        continue;
      if (inPoly(p.pts, x, z) || (pad > 0 && edgeDistance(p.pts, x, z) <= pad))
        return this.overTrench(p, x, z) ? -1 : i;
    }
    return -1;
  }

  /** On a plaza (optionally within `pad` m beyond its edge). */
  inside(x: number, z: number, pad = 0): boolean {
    return !this.empty && this.indexAt(x, z, pad) >= 0;
  }

  /** Plaza surface height at (x, z): the slab top of the portal it sits on, carried across (undefined off every plaza's portal). */
  height(x: number, z: number): number | undefined {
    let best: Poly | undefined;
    let bd = Infinity;
    for (const p of this.polys) {
      const d = inPoly(p.pts, x, z) ? 0 : edgeDistance(p.pts, x, z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best && this.frame(best, x, z)?.top;
  }

  /** Distance to the nearest plaza (0 inside, Infinity without plazas; the open trench is not excluded). */
  distance(x: number, z: number): number {
    let best = Infinity;
    for (const p of this.polys)
      best = Math.min(
        best,
        inPoly(p.pts, x, z) ? 0 : edgeDistance(p.pts, x, z),
      );
    return best;
  }

  /** The land levelled onto the plaza (blending back over BLEND m beyond its edge unless `blend` is false): `h` -> levelled height. */
  level(x: number, z: number, h: number, blend = true): number {
    const B = blend ? BLEND : 0;
    for (const p of this.polys) {
      if (x < p.minX - B || x > p.maxX + B || z < p.minZ - B || z > p.maxZ + B)
        continue;
      const inside = inPoly(p.pts, x, z);
      const d = inside ? 0 : edgeDistance(p.pts, x, z);
      if ((!inside && d >= B) || this.overTrench(p, x, z)) continue;
      const top = this.frame(p, x, z)?.top;
      if (top === undefined) continue;
      return inside ? top : h + (top - h) * (1 - smoothstep(0, B, d));
    }
    return h;
  }
}
