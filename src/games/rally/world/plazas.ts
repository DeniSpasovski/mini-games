import type { PlazaIsland } from '../maps/shared/types';
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
 *
 * Junction areas (`MapDef.junctionAreas`) are plazas over the whole street space around a junction (the slab and the
 * arms beyond it): their surface is a height field (`buildFields`) - the slab top on the slab, the street heights where
 * the streets leave the area, smooth (Laplace) in between - and the open cut is told by `openCut` (the carriageways'
 * real cut lines), not the portal frame.
 */

/** Height of a raised island's kerb above the plaza paving (m). */
export const ISLAND_KERB = 0.15;

/** The land blends from the plaza height back to its own over this distance beyond the edge (m). */
const BLEND = 8;

/** Weight of a street's own height on its edge cell of a junction area's field (4 neighbours weigh 1 each). */
const STREET_PIN = 3;
/** Cell size of a junction area's height field (m). */
const FIELD_CELL = 1;

interface Field {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float32Array;
}

interface Poly {
  pts: number[];
  /** A junction area: height field + open cut by `openCut` (undefined field until `buildFields`). */
  area: boolean;
  /** The street ribbons stay drawn over it (MapDef.ribbonAreas). */
  ribbons: boolean;
  field?: Field;
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
  /** Islands on the plazas (MapDef.plazaIslands) with their bounding boxes. */
  readonly islands: (PlazaIsland & {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  })[];
  constructor(
    outlines: number[][],
    private readonly portals: Portals,
    islands: PlazaIsland[] = [],
    areas: number[][] = [],
    ribbonAreas: number[][] = [],
    /** (x, z) lies in the open cut of the highway (off a portal slab): never paved (junction areas). */
    private readonly openCut?: (x: number, z: number) => boolean,
  ) {
    this.islands = islands.map((il) => {
      const xs = il.pts.filter((_, i) => i % 2 === 0);
      const zs = il.pts.filter((_, i) => i % 2 === 1);
      return {
        ...il,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
    });
    const all = [
      ...outlines.map((pts) => ({ pts, area: false, ribbons: false })),
      ...areas.map((pts) => ({ pts, area: true, ribbons: false })),
      ...ribbonAreas.map((pts) => ({ pts, area: true, ribbons: true })),
    ];
    this.polys = all.map(({ pts, area, ribbons }) => {
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
        area,
        ribbons,
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
    if (p.area && this.openCut) return this.openCut(x, z);
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

  /** The island at (x, z), if any (painted ones included). */
  islandAt(x: number, z: number): PlazaIsland | undefined {
    for (const il of this.islands) {
      if (x < il.minX || x > il.maxX || z < il.minZ || z > il.maxZ) continue;
      if (inPoly(il.pts, x, z)) return il;
    }
    return undefined;
  }

  /** Top of the paving at (x, z): the plaza height, + the kerb on a raised island (undefined off the plazas' portals). */
  surface(x: number, z: number): number | undefined {
    const h = this.height(x, z);
    if (h === undefined) return h;
    const il = this.islandAt(x, z);
    return il && il.kind !== 'painted' ? h + ISLAND_KERB : h;
  }

  /** On a plaza whose street ribbons stay drawn (MapDef.ribbonAreas). */
  keepsRibbons(x: number, z: number): boolean {
    const i = this.empty ? -1 : this.indexAt(x, z);
    return i >= 0 && this.polys[i].ribbons;
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
    if (best?.field) return sampleField(best.field, x, z);
    return best && this.frame(best, x, z)?.top;
  }

  /**
   * Height fields of the junction areas: the slab top on a portal slab, `streetHeight` where a street leaves the area
   * (cells on its edge), a smooth surface between (successive over-relaxation, free edges elsewhere); spread a few
   * metres outside for the blend back to the land.
   */
  buildFields(
    streetHeight: (x: number, z: number) => number | undefined,
  ): void {
    for (const p of this.polys) {
      if (!p.area) continue;
      const pad = BLEND + 2;
      const x0 = p.minX - pad;
      const z0 = p.minZ - pad;
      const nx = Math.ceil((p.maxX - p.minX + 2 * pad) / FIELD_CELL) + 1;
      const nz = Math.ceil((p.maxZ - p.minZ + 2 * pad) / FIELD_CELL) + 1;
      const h = new Float32Array(nx * nz);
      // 0 = outside, 1 = free, 2 = fixed (slab), 3 = fixed (street leaving), 4 = in the open cut (free edge).
      const state = new Uint8Array(nx * nz);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * FIELD_CELL;
          const z = z0 + j * FIELD_CELL;
          if (!inPoly(p.pts, x, z)) continue;
          const k = j * nx + i;
          if (this.overTrench(p, x, z)) {
            state[k] = 4;
            continue;
          }
          state[k] = 1;
          if (this.portals.inside(x, z)) {
            const top = this.frame(p, x, z)?.top;
            if (top !== undefined) {
              h[k] = top;
              state[k] = 2;
            }
          }
        }
      let sum = 0;
      let n = 0;
      for (let j = 1; j < nz - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          if (state[k] !== 1) continue;
          // Only the outer edge (the streets leave there); beside the open cut the edge is free.
          const edge =
            !state[k - 1] || !state[k + 1] || !state[k - nx] || !state[k + nx];
          if (!edge) continue;
          const sh = streetHeight(x0 + i * FIELD_CELL, z0 + j * FIELD_CELL);
          if (sh === undefined) continue;
          h[k] = sh;
          state[k] = 3;
        }
      // A street edge right beside the slab stays free: the surface needs room to ramp between the two.
      for (let j = 3; j < nz - 3; j++)
        for (let i = 3; i < nx - 3; i++) {
          const k = j * nx + i;
          if (state[k] !== 3) continue;
          let near = false;
          for (let dj = -3; dj <= 3 && !near; dj++)
            for (let di = -3; di <= 3; di++)
              if (state[(j + dj) * nx + i + di] === 2) {
                near = true;
                break;
              }
          if (near) state[k] = 1;
        }
      // Smooth the street heights along the edge (two streets leaving side by side at different heights pinned
      // neighbouring cells a metre apart: a 40 % step in the surface).
      for (let pass = 0; pass < 6; pass++) {
        const next = h.slice();
        for (let k = 0; k < h.length; k++) {
          if (state[k] !== 3) continue;
          let sum = h[k];
          let c = 1;
          for (const q of [
            k - 1,
            k + 1,
            k - nx,
            k + nx,
            k - nx - 1,
            k - nx + 1,
            k + nx - 1,
            k + nx + 1,
          ])
            if (q >= 0 && q < h.length && state[q] === 3) {
              sum += h[q];
              c++;
            }
          next[k] = sum / c;
        }
        h.set(next);
      }
      for (let k = 0; k < h.length; k++)
        if (state[k] >= 2 && state[k] !== 4) {
          sum += h[k];
          n++;
        }
      const mean = n ? sum / n : 0;
      for (let k = 0; k < h.length; k++) if (state[k] === 1) h[k] = mean;
      // Street edge cells are soft: pulled to their street's height (weight STREET_PIN) and to their neighbours.
      const street = h.slice();
      for (let it = 0; it < 2000; it++) {
        let worst = 0;
        for (let j = 1; j < nz - 1; j++)
          for (let i = 1; i < nx - 1; i++) {
            const k = j * nx + i;
            if (state[k] !== 1 && state[k] !== 3) continue;
            let s = 0;
            let c = 0;
            for (const q of [k - 1, k + 1, k - nx, k + nx])
              if (state[q] && state[q] !== 4) {
                s += h[q];
                c++;
              }
            if (state[k] === 3) {
              s += street[k] * STREET_PIN;
              c += STREET_PIN;
            }
            if (!c) continue;
            const d = (state[k] === 3 ? 1 : 1.9) * (s / c - h[k]);
            h[k] += d;
            worst = Math.max(worst, Math.abs(d));
          }
        if (worst < 1e-4) break;
      }
      // Spread outward (nearest inside values) for sampling just beyond the edge.
      const known = state.map((v) => (v && v !== 4 ? 1 : 0));
      // Every cell (sampling clamps to the grid: a street eased to the area from further out reads its edge).
      for (let pass = 0; pass < nx + nz; pass++) {
        let grown = false;
        const next = known.slice();
        for (let j = 0; j < nz; j++)
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (known[k]) continue;
            let s = 0;
            let c = 0;
            for (const [di, dj] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ]) {
              const a = i + di;
              const b = j + dj;
              if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
              const q = b * nx + a;
              if (known[q]) {
                s += h[q];
                c++;
              }
            }
            if (c) {
              h[k] = s / c;
              next[k] = 1;
              grown = true;
            }
          }
        known.set(next);
        if (!grown) break;
      }
      p.field = { x0, z0, nx, nz, h };
    }
  }

  /** Distance to the nearest plaza (0 inside, Infinity without plazas; the open trench is not excluded). */
  distance(x: number, z: number): number {
    let best = Infinity;
    for (const p of this.polys) {
      // A junction area's outline reaches into the open cut: no distance there (nothing is eased to it).
      if (
        p.area &&
        this.openCut &&
        x >= p.minX &&
        x <= p.maxX &&
        z >= p.minZ &&
        z <= p.maxZ &&
        this.openCut(x, z)
      )
        continue;
      best = Math.min(
        best,
        inPoly(p.pts, x, z) ? 0 : edgeDistance(p.pts, x, z),
      );
    }
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
      // A junction area before its field is built: only the slab is levelled (the streets' own lines come first).
      if (p.area && !p.field && !this.portals.inside(x, z)) continue;
      const top = p.field
        ? sampleField(p.field, x, z)
        : this.frame(p, x, z)?.top;
      if (top === undefined) continue;
      return inside ? top : h + (top - h) * (1 - smoothstep(0, B, d));
    }
    return h;
  }
}

/** Bilinear sample of a height field (clamped to its grid). */
function sampleField(f: Field, x: number, z: number): number {
  const u = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / FIELD_CELL));
  const v = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / FIELD_CELL));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = u - i;
  const b = v - j;
  const k = j * f.nx + i;
  const h = f.h;
  return (
    (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) +
    (h[k + f.nx] * (1 - a) + h[k + f.nx + 1] * a) * b
  );
}
