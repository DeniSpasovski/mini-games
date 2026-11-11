import { type JunctionFillet, mouthFillets, mouthJunctions } from './junctions';
import { newPathQuery, type PathNetwork } from './real-data';
import { newRoadQuery, type Road } from './road';
import { type MapDef, roadSurfaceAt } from '../maps/shared/types';
import type { TerrainGenerator } from './terrain-gen';

/**
 * The road slab: every road ribbon (the stage road, the paved side roads and track ribbons, the paved junction mouths)
 * is a layer laid INTO the ground, not a texture on it. The drawn terrain is cut by `sink` under it
 * (`TerrainGenerator.meshHeight`: the mesh only; physics and placement keep the ground), so it stays 6 cm under an
 * asphalt ribbon and never pokes through. The ribbons keep their own height (~2 cm over the ground at the edge); their
 * skirts are the slab's side, down into the verge, shaded dark (engine/road-surface.ts).
 *
 * Fades to 0 where a road meets a surface without a slab: a bridge deck (stage spans, other roads' decks) and a
 * junction plaza (their paving is its own surface), over SLAB_FADE m.
 *
 * Pure (no DOM / three.js scene): tests run it in node.
 */

/** How far the drawn terrain is cut under a road (m): asphalt (kerbed streets too) 6 cm, gravel and
 * dirt just enough that the terrain stays under it. */
export const SLAB_SINKS = { asphalt: 0.06, flush: 0.02 } as const;
/** A skirt's toe lies this far under its edge (m): the slab's side, never deeper (a deeper skirt stood as a wall over a
 * ditch). Its normal leans out by SKIRT_LEAN (lighting); the road shader darkens it by
 * the face's own slope. */
export const SKIRT_DEPTH = 0.12;
export const SKIRT_LEAN = 0.35;
/** How far past the edge the skirt toe lies (m). Its texture is the road's own edge strip mirrored onto it
 * (`skirtU`): the edge carries on down, no stretched texel. */
export const SKIRT_W = 0.08;
/** The stage ribbon reaches this far past the road's half width (road-mesh.ts ACROSS): the slab edge. */
export const STAGE_EDGE = 1.04;
/** Length over which the cut fades out towards a bridge deck or a junction plaza (m). */
const SLAB_FADE = 6;
const CELL = 32;
/** The slab-reach mask: cell size, sampling step along the roads, and reach past a road's edge (m; covers the step). */
const MASK = 4;
const MASK_STEP = 2;
const MASK_PAD = MASK_STEP;
/** The cut reaches its full depth this far inside the slab's edge (m): one terrain mesh cell (LOD0), so the mesh dips
 * under the ribbon, not beside it. */
const SINK_RAMP = 1;
/** `paved`: a skirt toe this close past another road's edge counts as on it (m). */
const PAVED_PAD = 0.1;

/**
 * The skirt toe's texture u: the edge's `u`, mirrored back inside the road by the skirt's width in u (`perMetre` = u per
 * metre across the road). A foot way's u runs 2..3 (gravel-road.ts).
 */
export function skirtU(u: number, perMetre: number): number {
  const mid = u > 1.5 ? 2.5 : 0.5;
  return u + (u > mid ? -1 : 1) * SKIRT_W * perMetre;
}

/** A paved mouth corner: the polygon corner -> arc and its box. */
interface FilletPoly {
  pts: number[];
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export class RoadSlab {
  private readonly rq = newRoadQuery();
  private readonly pq = newPathQuery();
  private readonly ribbon: (pi: number) => boolean;
  private readonly road: Road;
  private readonly net?: PathNetwork;
  /** End points of other roads' decks (x, z pairs) by grid cell. */
  private readonly deckEnds = new Map<number, number[]>();
  private fillets?: Map<number, FilletPoly[]>;
  private readonly tmp = { x: 0, z: 0 };

  constructor(
    private readonly gen: TerrainGenerator,
    private readonly map: MapDef,
  ) {
    this.road = gen.road;
    this.net = gen.paths;
    const tracks = !!map.trackRibbons;
    const paths = this.net?.paths ?? [];
    // The same roads road-mesh.ts draws as ribbons.
    const isRibbon = paths.map(
      (p) =>
        (p.surface === 'tarmac' || (tracks && p.surface === 'dirt')) &&
        !p.bridge,
    );
    this.ribbon = (pi) => isRibbon[pi];
    // Cells any slab can reach (the corners join them when built): the rest of the land skips the queries.
    const road = this.road;
    for (let a = 0; a <= road.length; a += MASK_STEP) {
      const s = road.at(Math.min(a, road.length));
      this.mark(s.x, s.z, s.halfWidth * STAGE_EDGE + MASK_PAD);
    }
    paths.forEach((_p, pi) => {
      if (!isRibbon[pi] || !this.net) return;
      const L = this.net.lengths[pi];
      for (let a = 0; a <= L + MASK_STEP; a += MASK_STEP) {
        const at = Math.min(a, L);
        this.net.pointAt(pi, at, this.tmp);
        this.mark(
          this.tmp.x,
          this.tmp.z,
          this.net.halfWidthAt(pi, at) + MASK_PAD,
        );
      }
    });
    paths.forEach((p, pi) => {
      if (!p.bridge || !this.net) return;
      for (const along of [0, this.net.lengths[pi]]) {
        this.net.pointAt(pi, along, this.tmp);
        const { x, z } = this.tmp;
        for (const k of this.cellsAround(x, z, SLAB_FADE)) {
          const l = this.deckEnds.get(k);
          if (l) l.push(x, z);
          else this.deckEnds.set(k, [x, z]);
        }
      }
    });
  }

  /** Cells (MASK m) within reach of some slab. */
  private readonly mask = new Set<number>();
  private mark(x: number, z: number, r: number): void {
    for (
      let cx = Math.floor((x - r) / MASK);
      cx <= Math.floor((x + r) / MASK);
      cx++
    )
      for (
        let cz = Math.floor((z - r) / MASK);
        cz <= Math.floor((z + r) / MASK);
        cz++
      )
        this.mask.add(key(cx, cz));
  }

  private *cellsAround(x: number, z: number, r: number): Generator<number> {
    for (
      let cx = Math.floor((x - r) / CELL);
      cx <= Math.floor((x + r) / CELL);
      cx++
    )
      for (
        let cz = Math.floor((z - r) / CELL);
        cz <= Math.floor((z + r) / CELL);
        cz++
      )
        yield key(cx, cz);
  }

  /** The paved mouth corners (built on first use: the junctions need the finished path network). */
  private filletIndex(): Map<number, FilletPoly[]> {
    if (this.fillets) return this.fillets;
    const out = new Map<number, FilletPoly[]>();
    const gen = this.gen;
    this.building = true;
    const mouths = mouthJunctions(
      gen.junctions,
      this.road,
      this.map,
      (pi) => gen.isParkwayLane(pi),
      (x, z) => gen.plazas.inside(x, z, 2),
    );
    for (const j of mouths)
      for (const f of mouthFillets(j, this.road)) {
        const poly = filletPoly(f);
        for (const [px, pz] of [
          [poly.x0, poly.z0],
          [poly.x1, poly.z1],
        ])
          this.mark(px, pz, MASK_PAD);
        for (let mx = poly.x0; mx < poly.x1 + MASK; mx += MASK)
          for (let mz = poly.z0; mz < poly.z1 + MASK; mz += MASK)
            this.mark(Math.min(mx, poly.x1), Math.min(mz, poly.z1), MASK_PAD);
        for (
          let cx = Math.floor(poly.x0 / CELL);
          cx <= Math.floor(poly.x1 / CELL);
          cx++
        )
          for (
            let cz = Math.floor(poly.z0 / CELL);
            cz <= Math.floor(poly.z1 / CELL);
            cz++
          ) {
            const k = key(cx, cz);
            const l = out.get(k);
            if (l) l.push(poly);
            else out.set(k, [poly]);
          }
      }
    this.building = false;
    return (this.fillets = out);
  }

  /** 0..1: the cut fades out towards a junction plaza and the end of another road's deck. */
  private fadeAt(x: number, z: number): number {
    let f = 1;
    const ends = this.deckEnds.get(
      key(Math.floor(x / CELL), Math.floor(z / CELL)),
    );
    if (ends)
      for (let i = 0; i < ends.length; i += 2) {
        const d = Math.hypot(ends[i] - x, ends[i + 1] - z);
        if (d < SLAB_FADE) f = Math.min(f, d / SLAB_FADE);
      }
    const plazas = this.gen.plazas;
    if (f > 0 && !plazas.empty) {
      const d = plazas.distance(x, z);
      if (d < SLAB_FADE) f = Math.min(f, d / SLAB_FADE);
    }
    return f;
  }

  /** How far the drawn terrain is cut under a road at (x, z) (m): eased in from 0 at the slab's edge, 0 off it. */
  sink(x: number, z: number): number {
    if (this.building) return 0;
    // (the corners first: building them reads the ground, which asks for the cut again)
    if (!this.fillets) this.filletIndex();
    if (!this.mask.has(key(Math.floor(x / MASK), Math.floor(z / MASK))))
      return 0;
    // Every slab reaching (x, z) counts, the deepest wins (an asphalt mouth over a gravel stage road's edge).
    // `e`: metres outside the slab edge (negative inside); `f`: a fade (bridge decks).
    let sink = 0;
    const take = (e: number, depth: number, f = 1) => {
      if (e < 0) sink = Math.max(sink, Math.min(1, -e / SINK_RAMP) * f * depth);
    };
    const full = SLAB_SINKS.asphalt;
    // The stage road (out to its ribbon's edge), not past its start / finish, faded onto its bridge decks.
    const road = this.road;
    const q = road.query(x, z, this.rq);
    if (q.found && q.along > 0.01 && q.along < road.length - 0.01) {
      const e = q.distance - q.halfWidth * STAGE_EDGE;
      if (e < 0) {
        let b = 1;
        if (road.bridges.length) {
          let gap = Infinity;
          for (const sp of road.bridges) {
            if (q.along >= sp.from && q.along <= sp.to) {
              gap = 0;
              break;
            }
            gap = Math.min(gap, sp.from - q.along, q.along - sp.to);
          }
          if (gap < SLAB_FADE) b = Math.max(0, gap) / SLAB_FADE;
        }
        take(e, this.stageSink(q.along), b);
      }
    }
    // The other roads drawn as ribbons (out to their edge; past a dead end too, as far as its end skirt).
    const net = this.net;
    if (sink < full && net) {
      const p = net.query(x, z, this.pq, undefined, this.ribbon);
      if (p.found) {
        const L = net.lengths[p.path];
        let e = p.distance - net.halfWidthAt(p.path, p.along);
        if (p.along < 0.01 || p.along > L - 0.01) {
          // Beyond an end: as far out along the way's line as the end skirt reaches (the cap is square).
          const atEnd = p.along > L / 2;
          const t = this.tmp;
          net.pointAt(p.path, atEnd ? L : 0, t);
          const ex = t.x;
          const ez = t.z;
          net.pointAt(p.path, atEnd ? Math.max(0, L - 1) : Math.min(L, 1), t);
          const l = Math.hypot(ex - t.x, ez - t.z) || 1;
          const over = ((x - ex) * (ex - t.x) + (z - ez) * (ez - t.z)) / l;
          const lat = Math.sqrt(
            Math.max(0, p.distance * p.distance - over * over),
          );
          e = Math.max(lat - net.halfWidthAt(p.path, p.along), over);
        }
        take(
          e,
          net.paths[p.path].surface === 'tarmac'
            ? SLAB_SINKS.asphalt
            : SLAB_SINKS.flush,
        );
      }
    }
    // The paved corners of the junction mouths.
    if (sink < full) {
      const l = this.filletIndex().get(
        key(Math.floor(x / CELL), Math.floor(z / CELL)),
      );
      if (l)
        for (const f of l) {
          if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
          if (inPoly(f.pts, x, z))
            take(-arcDistance(f.pts, x, z), SLAB_SINKS.asphalt);
        }
    }
    return sink > 0 ? sink * this.fadeAt(x, z) : 0;
  }

  /**
   * Whether (x, z) lies on another paved surface: the stage road, a ribbon road other than `self`, a paved mouth
   * corner or a junction plaza. A skirt whose toe lands there is left out: two roads meet flush, no side between them.
   * `self`: a path index, or 'stage' (the stage road asks).
   */
  paved(x: number, z: number, self: number | 'stage'): boolean {
    const road = this.road;
    if (self !== 'stage') {
      const q = road.query(x, z, this.rq);
      if (
        q.found &&
        q.along > 0.01 &&
        q.along < road.length - 0.01 &&
        q.distance < q.halfWidth * STAGE_EDGE + PAVED_PAD
      )
        return true;
    }
    const net = this.net;
    if (net) {
      const p = net.query(
        x,
        z,
        this.pq,
        undefined,
        (pi) => pi !== self && this.ribbon(pi),
      );
      if (
        p.found &&
        p.along > 0.01 &&
        p.along < net.lengths[p.path] - 0.01 &&
        p.distance < net.halfWidthAt(p.path, p.along) + PAVED_PAD
      )
        return true;
    }
    const l = this.filletIndex().get(
      key(Math.floor(x / CELL), Math.floor(z / CELL)),
    );
    if (l)
      for (const f of l)
        if (
          x >= f.x0 &&
          x <= f.x1 &&
          z >= f.z0 &&
          z <= f.z1 &&
          inPoly(f.pts, x, z)
        )
          return true;
    return !this.gen.plazas.empty && this.gen.plazas.inside(x, z);
  }

  /** Set while the junction corners are built (they read the ground: no cut yet). */
  private building = false;

  /** The cut under the stage road at `along` (its surface section). */
  private stageSink(along: number): number {
    const { surface } = roadSurfaceAt(this.map.road, along);
    return surface === 'tarmac' || surface === 'tarmac_gravel'
      ? SLAB_SINKS.asphalt
      : SLAB_SINKS.flush;
  }
}

const key = (cx: number, cz: number): number =>
  (cx + 32768) * 65536 + (cz + 32768);

function filletPoly(f: JunctionFillet): FilletPoly {
  const pts = [f.c[0], f.c[1]];
  for (const [x, z] of f.arc) pts.push(x, z);
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    z0 = Math.min(z0, pts[i + 1]);
    z1 = Math.max(z1, pts[i + 1]);
  }
  return { pts, x0, z0, x1, z1 };
}

function inPoly(p: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i];
    const zi = p[i + 1];
    const xj = p[j];
    const zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Distance to the arc of a fillet polygon (its points after the corner). */
function arcDistance(p: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 2; i + 3 < p.length; i += 2) {
    const ax = p[i];
    const az = p[i + 1];
    const ex = p[i + 2] - ax;
    const ez = p[i + 3] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}
