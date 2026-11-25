import type { SurfaceId } from '../../physics/surfaces';
import {
  Grid,
  inPolygon,
  polygonDistance,
  type Projection,
  projectOnSegment,
  valueAt,
} from './alignment';
import {
  DECK_DEPTH,
  goreAt,
  type Junction,
  type NaturalHeight,
  type Plaza,
  type Network,
  ST_DECK,
  ST_GROUND,
  scaleAt,
  sectionT,
  ST_TUNNEL,
  WALL_CUT,
  WALL_FILL,
  fillBedFrom,
  maxVerge,
  wallOff,
  type Way,
} from './network';
import { SINK_RAMP, SLAB_SINKS } from '../road-slab';

/**
 * Terrain and surface queries of a solved v2 network (`Network`): the roads own the ground under them.
 *
 * - `ground(x, z)`: the terrain. Inside a way's section (or a junction polygon / sidewalk corner) it IS the section's
 *   surface (a few cm under a meshed element); where sections overlap the lower one wins (BeamNG's rule - the upper one
 *   is a deck); beside a way the daylight rule caps a cut (slope up from the edge) and floors a fill (slope down) until
 *   they meet the land; at a wall the step is sheer behind the wall line. Decks leave the ground alone, a tunnel puts
 *   its slab (the street level) over it.
 * - `top(x, z, maxY)`: the drivable surface at (x, z) at or below maxY (decks, tunnels, kerbs, sidewalks exact).
 *
 * Pure (node tests run it); the heightfield and physics call it per sample, so it uses a segment grid.
 */

/** Terrain under a meshed element sits this far below it (the mesh is the surface). */
const SINK = 0.04;

interface PlazaField {
  pl: Plaza;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float32Array;
  state: Uint8Array;
  /** 1 = a structure's cell the paving meets (a slab top, a junction's paving). */
  struct: Uint8Array;
}
/** Just past a kerbless pavement edge the drawn verge lies this much lower (m), easing back over EDGE_EASE m: the slab's
 * side (the skirt) shows, as on main's road slab. */
const EDGE_DROP = 0.04;
const EDGE_EASE = 0.6;
/** `meshSink`: within this of a pavement edge (past its kerb) the drawn land stays EDGE_UNDER under the edge (m). */
const EDGE_HOLD = 1;
const EDGE_UNDER = 0.02;
/**
 * ... and beyond a survey plaza's edge: held under its rim out past a 1 m cell (the street ends on its rim stop up to a
 * sample, 2 m, short of it), eased back up to the land out to this far (m, `meshSink`).
 */
const PLAZA_EASE = 5;
/** A plaza's free paving follows its spots (`plazaResidual`): Gaussian sigma, reach and the fade off fixed cells (m). */
const PLAZA_SPOT_SIGMA = 8;
const PLAZA_SPOT_REACH = 20;
const PLAZA_SPOT_TAPER = 6;
/** `ground`: a point within this past the sides of two bores facing each other lies at their floor (m). */
const BORE_GAP = 1.5;
/** Under a tunnel slab, land this far past a bore's side (and in no bore) lies at that bore's floor (m). */
const TRENCH_FLOOR = 6;
/** A way this much under another way's footprint at (x, z) passes beneath it: it does not cut the drawn ground (m). */
const UNDER_DROP = 1.5;
/** A junction plaza this far under a road's own pavement at (x, z) lies under it (a street tucked under a bridge end), not on it (m). */
const UNDER_PLAZA = 3.5;
/**
 * The land rises behind a cut wall this far behind its face (hidden by the wall body + its coping, mesh.ts WALL_BACK):
 * no wider than the coping, or a trench opens behind it; more than a coarse terrain cell, so no far-LOD triangle spans
 * from the road level to the retained earth in front of the face (green spikes at the wall foot).
 */
const WALL_SETBACK = 2.2;
/** A road on the ground up to this far above a wall's road is the land that wall holds (`sectionHeightOther`). */
const ABOVE_MAX = 12;
/**
 * The retained earth behind a cut wall is graded to its coping: level with the coping out to WALL_GRADE_FLAT m past the
 * setback (past the coping's back edge and a 1 m cell's diagonal: the concrete meets the grass on one straight line),
 * then falling WALL_GRADE_FALL per m to the land, out to WALL_HOLD m from the wall line.
 */
const WALL_HOLD = 12;
const WALL_GRADE_FLAT = 2.5;
const WALL_GRADE_FALL = 0.5;
/** Two roads this close together (gap between their sections, m) share the land between them: it stays within
 * BETWEEN_HUMP of the higher edge (the streets dipping under a bridge take the land with them; no mound of old land). */
const BETWEEN_MAX = 26;
const BETWEEN_HUMP = 0.4;
/** An island: roads within BETWEEN_MAX all round it (no gap wider than this between their directions, rad) - it lies
 * level with them like the land between two (v1: the islands of a junction at kerb height, no mound of old land). */
const ISLAND_GAP = 2.6;
/** An island's top over its edges (a kerb). */
const ISLAND_RISE = 0.15;
/** A tunnel's roof slab reaches this far beyond its wall line (m): it rests on the walls. */
export const SLAB_REACH = 0.9;
/** Footprint index margin beyond the section for daylight slopes (m). */
const REACH = 16;
/**
 * The drawn terrain's band on the high side of a wall face (m): its points drop to the low side's level (`meshSink`), so
 * no triangle of the 1 m mesh (or a coarser LOD's, which takes its cell's lowest point) bridges the face and pokes out
 * through it in teeth; the slope lies behind the wall. More than a 1 m cell's diagonal.
 */
const WALL_CELL = 1.6;
/**
 * A strip between two roads' verges is a plane edge to edge up to this slope (rise over width); steeper, with more
 * than STEP_MIN between the edges, it lies level with the lower edge (the 1 m mesh would draw the slope as waves).
 */
const STEP_SLOPE = 0.5;
const STEP_MIN = 0.3;

/** A strip steeper than this (1:5) lies level with its lower edge: a flat strip, the higher road's side a face. */
const STRIP_FLAT = 0.2;

/** `stepCut`: the band inside a step's face whose drawn terrain drops (m; under the slab's full sink further in). */
const STEP_CELL = 1.4;

/** `stepCut`: the deepest drop (m), the depth of the face over it (mesh.ts `FACE_MAX`). */
const STEP_FACE = 4;

/**
 * The land across a strip between two pavement edges (heights aE / bE, the point da / db from each): the plane edge to
 * edge, eased to level with the lower edge as the strip gets steeper than a gentle bank (`STRIP_FLAT`, `STEP_MIN`). Eased,
 * not switched, so a strip whose width or drop changes along the roads has no crease across it. A drop taller than the
 * face the higher slab side can draw (`STEP_FACE`) keeps the plane: a bank, never a hole under the higher road.
 */
function stripHeight(aE: number, bE: number, da: number, db: number): number {
  const dh = Math.abs(aE - bE);
  const plane = aE + ((bE - aE) * da) / (da + db);
  const k = Math.min(
    sat((dh - STEP_MIN) / STEP_MIN),
    sat((dh / (da + db) - STRIP_FLAT) / 0.1),
    sat((STEP_FACE + 0.5 - dh) / 0.5),
  );
  return plane + (Math.min(aE, bE) - plane) * k;
}

function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** A strip between two roads narrower than this (m, verge to verge) is one plane from edge to edge. */
const STRIP_MAX = 8;

interface ArmH {
  px: number;
  pz: number;
  dx: number;
  dz: number;
  y: number;
  g: number;
  hw: number;
}

export interface TopHit {
  h: number;
  surface: SurfaceId;
  /** Normal (unit). */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * A cut wall's top at a projection along its way, between the two samples as the wall mesh draws its coping (the
 * nearest sample's would stand up to half a step's fall above the coping where the wall steps down to its end: grass
 * over the concrete).
 */
function retainedTop(w: Way, side: 0 | 1, p: Projection): number {
  const t = w.wallTop[side];
  const b = Math.min(w.al.n - 1, p.i + 1);
  const a = w.wall[side][p.i] === WALL_CUT ? p.i : b;
  const c = w.wall[side][b] === WALL_CUT ? b : a;
  return t[a] + (t[c] - t[a]) * (c === a ? 0 : p.f);
}

export class NetField {
  private segs = new Grid<number>(16);
  /** The same segments indexed by their sections only (no daylight reach): footprint queries. */
  private fsegs = new Grid<number>(8);
  private fbest = new Map<number, Projection>();
  private jgrid = new Grid<number>(32);
  /** The junctions again, by their outline + BETWEEN_MAX: an island's sides (`ISLAND_GAP`). */
  private jnear = new Grid<number>(32);
  private armH: ArmH[][] = [];
  private best = new Map<number, Projection>();

  constructor(
    readonly net: Network,
    private readonly natural: NaturalHeight,
  ) {
    for (const w of net.ways) {
      if (w.internal) continue;
      const { n, x, z } = w.al;
      const r = Math.max(w.sec.footL, w.sec.footR) + REACH;
      let gu = 0;
      if (w.gore)
        for (const t of w.gore.t)
          if (!Number.isNaN(t)) gu = Math.max(gu, Math.abs(t));
      // (a way with walls: out past its wall faces, the drawn terrain's wall cut reads them in `meshSink`)
      const walled = w.wall.some((a) =>
        a.some((v) => v === WALL_CUT || v === WALL_FILL),
      );
      const rf =
        Math.max(
          w.sec.footL,
          w.sec.footR,
          gu,
          walled
            ? Math.max(w.sec.footL, w.sec.footR) +
                w.tpl.daylight.wallOffset +
                maxVerge(w) +
                WALL_CELL
            : 0,
        ) + 1.5;
      for (let i = 0; i + 1 < n; i++) {
        this.segs.add(
          w.index * 65536 + i,
          Math.min(x[i], x[i + 1]) - r,
          Math.min(z[i], z[i + 1]) - r,
          Math.max(x[i], x[i + 1]) + r,
          Math.max(z[i], z[i + 1]) + r,
        );
        this.fsegs.add(
          w.index * 65536 + i,
          Math.min(x[i], x[i + 1]) - rf,
          Math.min(z[i], z[i + 1]) - rf,
          Math.max(x[i], x[i + 1]) + rf,
          Math.max(z[i], z[i + 1]) + rf,
        );
      }
    }
    // (a junction inside a survey plaza is the plaza's: no paving or ground of its own)
    for (const j of net.junctions)
      if (!j.plaza)
        this.jgrid.add(j.index, j.minX - 1, j.minZ - 1, j.maxX + 1, j.maxZ + 1);
    const B = BETWEEN_MAX;
    for (const j of net.junctions)
      if (!j.plaza)
        this.jnear.add(j.index, j.minX - B, j.minZ - B, j.maxX + B, j.maxZ + B);
    const nw = net.ways.length;
    this.qstamp = new Int32Array(nw);
    this.qd2 = new Float64Array(nw);
    this.qseg = new Int32Array(nw);
    this.buildArmHeights();
    this.plazaFields = net.plazas.map((pl) => this.plazaField(pl));
  }

  /** Survey plazas' height fields (`plazaField`), one per `net.plazas`. */
  private readonly plazaFields: PlazaField[];

  /**
   * A survey plaza's surface: one height field over its area (v1 plazas.ts `buildFields`) - the slab top on a tunnel
   * slab, the streets' heights where they end on the rim, smooth (Laplace) in between; the open cut of the roads in
   * the trench below (`Network.trench`, at ground level there) is never paved.
   */
  private plazaField(pl: Plaza): PlazaField {
    const x0 = Math.floor(pl.minX) - 1;
    const z0 = Math.floor(pl.minZ) - 1;
    const nx = Math.ceil(pl.maxX - x0) + 2;
    const nz = Math.ceil(pl.maxZ - z0) + 2;
    const h = new Float32Array(nx * nz);
    // 0 = outside, 1 = free, 2 = fixed (slab / rim), 3 = open cut, 4 = a trench road at grade (fixed, not paved)
    const state = new Uint8Array(nx * nz);
    // (the cells of a structure the paving meets: a slab top, a junction's paving)
    const struct = new Uint8Array(nx * nz);
    let sum = 0;
    let cnt = 0;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i;
        const z = z0 + j;
        if (!inPolygon(pl.area, x, z)) continue;
        const k = j * nx + i;
        // (a junction of its own on the plaza, at the plaza's level: the paving meets its edge, never a step)
        const jh = this.junctionPaving(x, z);
        if (
          jh !== undefined &&
          !(pl.level && Math.abs(jh - pl.level(x, z)) > 1)
        ) {
          h[k] = jh;
          state[k] = 4;
          struct[k] = 1;
          sum += jh;
          cnt++;
          continue;
        }
        if (this.openCut(x, z)) {
          // (a road of the trench set running at grade through the plaza at its level, not down in the cut: the
          // paving meets its edge)
          const g = this.atGrade(x, z);
          if (g === undefined || (pl.level && Math.abs(g - pl.level(x, z)) > 1))
            state[k] = 3;
          else if (!this.drawnFoot(x, z)) {
            // (past its foot out to the wall line, or on a stretch the plaza leaves out, it is the plaza's paving, at
            // the pavement edge's height)
            h[k] = g;
            state[k] = 2;
            sum += g;
            cnt++;
          } else {
            h[k] = g;
            state[k] = 4;
            sum += g;
            cnt++;
          }
          continue;
        }
        state[k] = 1;
        const slab = this.slabAt(x, z);
        if (slab !== undefined) {
          h[k] = slab;
          state[k] = 2;
          struct[k] = 1;
          sum += slab;
          cnt++;
        }
      }
    for (const r of pl.rim) {
      const i = Math.round(r.x - x0);
      const j = Math.round(r.z - z0);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const k = jj * nx + ii;
          if (state[k] !== 1) continue;
          h[k] = r.y;
          state[k] = 2;
        }
      sum += r.y;
      cnt++;
    }
    // (the paving meets a slab top or a junction's paving at its level: the paving cells along that shared edge - a
    // street end's too - are held at it, the field blends away from them; no step at the edge)
    const ring: [number, number][] = [];
    for (let k = 0; k < h.length; k++) {
      if ((state[k] !== 1 && state[k] !== 2) || struct[k]) continue;
      const i = k % nx;
      let a = 0;
      let c = 0;
      for (const kk of [
        i > 0 ? k - 1 : -1,
        i + 1 < nx ? k + 1 : -1,
        k - nx,
        k + nx,
      ]) {
        if (kk < 0 || kk >= h.length || !struct[kk]) continue;
        a += h[kk];
        c++;
      }
      if (c) ring.push([k, a / c]);
    }
    for (const [k, y] of ring) {
      h[k] = y;
      state[k] = 2;
    }
    const mean = cnt ? sum / cnt : 0;
    for (let k = 0; k < h.length; k++) if (state[k] === 1) h[k] = mean;
    for (let it = 0; it < 600; it++)
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (state[k] !== 1) continue;
          let a = 0;
          let c = 0;
          for (const kk of [k - 1, k + 1, k - nx, k + nx]) {
            if (kk < 0 || kk >= h.length) continue;
            const st = state[kk];
            if (st === 1 || st === 2 || st === 4) {
              a += h[kk];
              c++;
            }
          }
          if (c) h[k] = a / c;
        }
    this.plazaResidual(pl, x0, z0, nx, nz, h, state);
    return { pl, x0, z0, nx, nz, h, state, struct };
  }

  /**
   * The survey on a plaza's free paving: the spots' residuals (survey - solved field) at free cells, spread by a
   * Gaussian (PLAZA_SPOT_SIGMA, to 0 past PLAZA_SPOT_REACH and where the spots are few), added to the free cells and
   * faded to 0 within PLAZA_SPOT_TAPER m of a fixed cell (a slab top, a junction's paving, a street end): those keep their
   * own heights and the paving meets their edges without a step.
   */
  private plazaResidual(
    pl: Plaza,
    x0: number,
    z0: number,
    nx: number,
    nz: number,
    h: Float32Array,
    state: Uint8Array,
  ): void {
    const res: [number, number, number][] = [];
    for (const [x, z, y] of pl.spots ?? []) {
      const i = Math.round(x - x0);
      const j = Math.round(z - z0);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (state[k] === 1) res.push([x, z, y - h[k]]);
    }
    if (!res.length) return;
    // cells from the nearest fixed cell (4-neighbour steps, 1 m)
    const far = new Float32Array(nx * nz).fill(Infinity);
    const queue: number[] = [];
    for (let k = 0; k < far.length; k++)
      if (state[k] === 2 || state[k] === 4) {
        far[k] = 0;
        queue.push(k);
      }
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const i = k % nx;
      for (const kk of [
        i > 0 ? k - 1 : -1,
        i + 1 < nx ? k + 1 : -1,
        k - nx,
        k + nx,
      ]) {
        if (kk < 0 || kk >= far.length || state[kk] !== 1) continue;
        if (far[kk] <= far[k] + 1) continue;
        far[kk] = far[k] + 1;
        queue.push(kk);
      }
    }
    const s2 = 2 * PLAZA_SPOT_SIGMA ** 2;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (state[k] !== 1) continue;
        const x = x0 + i;
        const z = z0 + j;
        let a = 0;
        let ws = 0;
        for (const [px, pz, r] of res) {
          const d2 = (px - x) ** 2 + (pz - z) ** 2;
          if (d2 > PLAZA_SPOT_REACH ** 2) continue;
          const g = Math.exp(-d2 / s2);
          a += g * r;
          ws += g;
        }
        if (!ws) continue;
        h[k] += (a / Math.max(1, ws)) * Math.min(1, far[k] / PLAZA_SPOT_TAPER);
      }
  }

  /**
   * Every edge where a plaza's paving meets a slab top or a junction's paving (cell sides, 1 m): the step there - the
   * paving drawn 0.2 m outside against the structure 0.2 m inside - and whether the paving cell lies between two
   * structures (of the 3 x 3 cells round it) more than 0.1 m apart (they disagree: no paving level meets both).
   */
  plazaEdgeSteps(): { x: number; z: number; step: number; between: boolean }[] {
    const out: { x: number; z: number; step: number; between: boolean }[] = [];
    for (const { nx, nz, x0, z0, h, state, struct } of this.plazaFields)
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if ((state[k] !== 1 && state[k] !== 2) || struct[k]) continue;
          const near: number[] = [];
          const edges: [number, number][] = [];
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              const jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
              const kk = jj * nx + ii;
              if (!struct[kk]) continue;
              // (diagonal ones too: the drawn paving blends the cells round it)
              near.push(h[kk]);
              if (!di !== !dj) edges.push([di, dj]);
            }
          const between =
            near.length > 1 && Math.max(...near) - Math.min(...near) > 0.1;
          for (const [di, dj] of edges) {
            const mx = x0 + i + di / 2;
            const mz = z0 + j + dj / 2;
            const fixed =
              this.junctionPaving(mx + di * 0.2, mz + dj * 0.2) ??
              this.slabAt(mx + di * 0.2, mz + dj * 0.2);
            const drawn = this.plazaDrawn(mx - di * 0.2, mz - dj * 0.2, 0);
            if (fixed === undefined || drawn === undefined) continue;
            out.push({ x: mx, z: mz, step: Math.abs(drawn - fixed), between });
          }
        }
    return out;
  }

  /** The pavement height of a street (not in the trench) at (x, z) where it runs onto a survey plaza, else undefined. */
  streetOnPlaza(x: number, z: number): number | undefined {
    let best: number | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.net.trench.has(w) || this.beyondEnds(w, p, x, z))
        continue;
      // (only its paved length: a street wholly inside the plaza is the plaza's)
      if (p.s < w.cut0 || p.s > w.al.length - w.cut1) continue;
      if (Math.abs(p.t) > (p.t >= 0 ? w.sec.paveL : w.sec.paveR)) continue;
      const h = this.net.surfaceAt(w, p.i, p.f, p.t);
      if (best === undefined || h < best) best = h;
    }
    return best;
  }

  /** (x, z) lies over the open cut of a road in the trench below a plaza (on it or out to its wall line). */
  private openCut(x: number, z: number): boolean {
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (!this.net.trench.has(w) || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : Math.min(w.al.n - 1, p.i + 1);
      if (w.st[k] === ST_TUNNEL) continue;
      const footW = p.t >= 0 ? w.sec.footL : w.sec.footR;
      if (Math.abs(p.t) <= footW + wallOff(w, k, p.t >= 0 ? 0 : 1) + 0.5)
        return true;
    }
    return false;
  }

  /** (x, z) within a drawn way's foot (pavement + kerb / sidewalk / shoulder): not internal, not on a cut-back end. */
  private drawnFoot(x: number, z: number): boolean {
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.beyondEnds(w, p, x, z)) continue;
      if (p.s < w.cut0 || p.s > w.al.length - w.cut1) continue;
      const footW = Math.max(
        p.t >= 0 ? w.sec.footL : w.sec.footR,
        goreAt(w, p.i, p.f, p.t >= 0)?.u ?? 0,
      );
      if (Math.abs(p.t) <= footW) return true;
    }
    return false;
  }

  /** The paving height of a (non-plaza) junction whose polygon holds (x, z), else undefined. */
  private junctionPaving(x: number, z: number): number | undefined {
    for (const ji of this.jgrid.at(x, z)) {
      const j = this.net.junctions[ji];
      if (x < j.minX || x > j.maxX || z < j.minZ || z > j.maxZ) continue;
      if (inPolygon(j.poly, x, z)) return this.junctionHeight(j, x, z);
    }
    return undefined;
  }

  /**
   * The pavement height of a trench road (`openCut`) at (x, z) where it runs on the ground (not in a tunnel), clamped
   * to its pavement edge (the walls are not decided yet: the caller keeps it only near the plaza's level).
   */
  private atGrade(x: number, z: number): number | undefined {
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (!this.net.trench.has(w) || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : Math.min(w.al.n - 1, p.i + 1);
      if (w.st[k] !== ST_GROUND) continue;
      const pave = p.t >= 0 ? w.sec.paveL : w.sec.paveR;
      return this.net.surfaceAt(
        w,
        p.i,
        p.f,
        Math.sign(p.t) * Math.min(Math.abs(p.t), pave),
      );
    }
    return undefined;
  }

  /** The lowest paved cell of a plaza within 2 m of (x, z) (its rim height just outside the area). */
  private plazaRim(f: PlazaField, x: number, z: number): number | undefined {
    const ci = Math.round(x - f.x0);
    const cj = Math.round(z - f.z0);
    let best: number | undefined;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) continue;
        const k = j * f.nx + i;
        if (f.state[k] !== 1 && f.state[k] !== 2) continue;
        if (best === undefined || f.h[k] < best) best = f.h[k];
      }
    return best;
  }

  /** A survey plaza's paving at (x, z), or its rim within 2 m outside (a wall at its edge holds it). */
  plazaNear(x: number, z: number): number | undefined {
    const h = this.plazaHeight(x, z);
    if (h !== undefined) return h;
    for (const f of this.plazaFields) {
      const pl = f.pl;
      if (
        x < pl.minX - 2 ||
        x > pl.maxX + 2 ||
        z < pl.minZ - 2 ||
        z > pl.maxZ + 2
      )
        continue;
      const r = this.plazaRim(f, x, z);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  /** A survey plaza's paving height at (x, z), undefined off every plaza (or over its open cut). */
  plazaHeight(x: number, z: number): number | undefined {
    return this.plazaAt(x, z, false);
  }

  /**
   * The plaza's drawn surface at (x, z): its paving, and also `under` m below the road / junction paving it leaves to
   * them (so it runs on under their edge, no saw-tooth gap along the 1 m grid).
   */
  plazaDrawn(x: number, z: number, under: number): number | undefined {
    return this.plazaAt(x, z, true, under);
  }

  private plazaAt(
    x: number,
    z: number,
    roads: boolean,
    under = 0,
  ): number | undefined {
    for (const f of this.plazaFields) {
      const pl = f.pl;
      if (x < pl.minX || x > pl.maxX || z < pl.minZ || z > pl.maxZ) continue;
      if (!inPolygon(pl.area, x, z)) continue;
      const fx = x - f.x0;
      const fz = z - f.z0;
      const i = Math.min(f.nx - 2, Math.max(0, Math.floor(fx)));
      const j = Math.min(f.nz - 2, Math.max(0, Math.floor(fz)));
      const u = fx - i;
      const v = fz - j;
      let a = 0;
      let wsum = 0;
      for (const [di, dj, wt] of [
        [0, 0, (1 - u) * (1 - v)],
        [1, 0, u * (1 - v)],
        [0, 1, (1 - u) * v],
        [1, 1, u * v],
      ]) {
        const k = (j + dj) * f.nx + i + di;
        const st = f.state[k];
        if (st === 4 && roads) {
          a += (f.h[k] - under) * wt;
          wsum += wt;
          continue;
        }
        if (st !== 1 && st !== 2) continue;
        a += f.h[k] * wt;
        wsum += wt;
      }
      if (wsum < 0.3) return undefined;
      return a / wsum;
    }
    return undefined;
  }

  /** Junction surfaces: each arm's plane at its cut line (centre height + grade), blended by inverse distance. */
  buildArmHeights(): void {
    this.armH = this.net.junctions.map((j) =>
      j.arms.map((a) => {
        const w = a.way;
        const L = w.al.length;
        const s = a.atEnd ? L - a.cut : a.cut;
        const y = valueAt(w.al, w.y, s);
        const y2 = valueAt(
          w.al,
          w.y,
          Math.min(L, Math.max(0, s + (a.atEnd ? -2 : 2))),
        );
        return {
          px: a.ox + a.dx * a.cut,
          pz: a.oz + a.dz * a.cut,
          dx: a.dx,
          dz: a.dz,
          y,
          g: (y2 - y) / 2,
          hw: Math.max(a.hwL, a.hwR),
        };
      }),
    );
  }

  /** Junction paving height at (x, z) (extrapolated outside the polygon too: the corners use it). */
  junctionHeight(j: Junction, x: number, z: number): number {
    let sw = 0;
    let sh = 0;
    for (const a of this.armH[j.index]) {
      const ux = x - a.px;
      const uz = z - a.pz;
      const u = ux * a.dx + uz * a.dz;
      const t = ux * a.dz - uz * a.dx;
      const lat = Math.max(0, Math.abs(t) - a.hw);
      const d = Math.hypot(u, lat);
      const w = 1 / (d * d + 0.25);
      sw += w;
      sh += w * (a.y + a.g * u);
    }
    return sw ? sh / sw : 0;
  }

  /** Nearest segment per way near (x, z): fills `best` (way index -> projection). */
  private nearest(x: number, z: number): Map<number, Projection> {
    return this.closest(this.segs, this.best, x, z);
  }

  /** Nearest segment per way whose section (+ 1.5 m) may hold (x, z): the footprint queries. */
  private nearestFoot(x: number, z: number): Map<number, Projection> {
    return this.closest(this.fsegs, this.fbest, x, z);
  }

  /**
   * The nearest segment of each way listed in `grid` at (x, z), fully projected (a fresh object each: callers keep
   * them across nested queries). Segments are compared by squared distance first, only each way's winner is projected.
   */
  private closest(
    grid: Grid<number>,
    best: Map<number, Projection>,
    x: number,
    z: number,
  ): Map<number, Projection> {
    best.clear();
    const ways = this.net.ways;
    const d2s = this.qd2;
    const segOf = this.qseg;
    const stamp = this.qstamp;
    const q = ++this.qid;
    const hit = this.qhit;
    hit.length = 0;
    for (const key of grid.at(x, z)) {
      const wi = Math.floor(key / 65536);
      const i = key % 65536;
      const al = ways[wi].al;
      const ax = al.x[i];
      const az = al.z[i];
      const ex = al.x[i + 1] - ax;
      const ez = al.z[i + 1] - az;
      const l2 = ex * ex + ez * ez || 1e-9;
      let f = ((x - ax) * ex + (z - az) * ez) / l2;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const dx = x - ax - ex * f;
      const dz = z - az - ez * f;
      const d2 = dx * dx + dz * dz;
      if (stamp[wi] !== q) {
        stamp[wi] = q;
        d2s[wi] = d2;
        segOf[wi] = i;
        hit.push(wi);
      } else if (d2 < d2s[wi]) {
        d2s[wi] = d2;
        segOf[wi] = i;
      }
    }
    for (const wi of hit) {
      const w = ways[wi];
      const pr = projectOnSegment(w.al, segOf[wi], x, z, {
        s: 0,
        t: 0,
        i: 0,
        f: 0,
        d: 0,
      });
      if (w.k) pr.t = sectionT(w, pr.i, pr.f, pr.t);
      best.set(wi, pr);
    }
    return best;
  }

  /** `closest` scratch, per way index: query stamp, best squared distance, best segment; the ways hit. */
  private qid = 0;
  private qstamp = new Int32Array(0);
  private qd2 = new Float64Array(0);
  private qseg = new Int32Array(0);
  private qhit: number[] = [];

  /** (x, z) projects past the start / end of the way (beyond its end cap). */
  private beyondEnds(w: Way, p: Projection, x: number, z: number): boolean {
    const al = w.al;
    if (p.i === 0 && p.f <= 0) {
      return (x - al.x[0]) * al.tx[0] + (z - al.z[0]) * al.tz[0] < -0.3;
    }
    if (p.i === al.n - 2 && p.f >= 1) {
      const k = al.n - 1;
      return (x - al.x[k]) * al.tx[k] + (z - al.z[k]) * al.tz[k] > 0.3;
    }
    return false;
  }

  /** Height of way `w`'s gore wedge at projection p: its pavement edge eased onto the host's edge (as the mesh). */
  private goreH(w: Way, p: Projection, g: { u: number; h: number }): number {
    const pave = p.t >= 0 ? w.sec.paveL : w.sec.paveR;
    const he = this.net.surfaceAt(w, p.i, p.f, Math.sign(p.t) * pave);
    const f = Math.min(1, (Math.abs(p.t) - pave) / Math.max(0.01, g.u - pave));
    return he + (g.h - he) * f;
  }

  /** Terrain height at (x, z) with the roads in it (`skip`: without that way's own shaping - its wall decision). */
  ground(x: number, z: number, skip?: Way): number {
    // (a vertex asks for its own point several times - height, wall / step cuts: a few exact-argument entries)
    const memo = this.groundMemo;
    for (let k = 0; k < memo.length; k += 4)
      if (memo[k] === x && memo[k + 1] === z && memo[k + 2] === (skip ?? null))
        return memo[k + 3] as number;
    const h = this.groundAt(x, z, skip);
    memo.splice(0, 4);
    memo.push(x, z, skip ?? null, h);
    return h;
  }

  /** Last `ground` results, 4 entries of (x, z, skip, height). */
  private readonly groundMemo: (number | Way | null)[] = new Array(16).fill(
    NaN,
  );

  private groundAt(x: number, z: number, skip?: Way): number {
    const net = this.net;
    let foot = Infinity;
    let cap = Infinity;
    let floor = -Infinity;
    // (each road's own cut / fill slope from its foot: dropped inside a narrow strip, whose plane runs edge to edge)
    let dayCap = Infinity;
    let dayFloor = -Infinity;
    let strip = false;
    // a cut wall carrying a street's edge: the land right behind it drops to the wall's road (hidden under the coping),
    // so no terrain triangle of the street can poke through the wall's face
    let hard = Infinity;
    // under a deck (its soffit, less the margin) / behind a cut wall carrying a road's edge: the deck rests on that fill
    let deckUnder = Infinity;
    let behindCarried = false;
    // the two nearest road edges with the point between them (land between neighbouring roads follows their edges)
    const side: {
      d: number;
      E: number;
      dp: number;
      Ep: number;
      vx: number;
      vz: number;
    }[] = [];
    // the drawn verges holding the point (a strip between two roads whose verges overlap: a plane edge to edge)
    // every road edge within BETWEEN_MAX (an island between three or more roads, `ISLAND_GAP`)
    const around: { d: number; E: number; vx: number; vz: number }[] = [];
    const verge: {
      w: Way;
      d: number;
      E: number;
      h: number;
      vx: number;
      vz: number;
    }[] = [];
    // every paved way's pavement edge (a kerb's back) the point lies outside of, and whether the point is drawn by a
    // mesh (pavement, kerb, sidewalk, gore, junction): a narrow strip between two edges is one plane (`STRIP_MAX`)
    const edges: { w: Way; d: number; E: number; vx: number; vz: number }[] =
      [];
    let onMesh = false;
    const bores: { w: Way; E: number; vx: number; vz: number }[] = [];
    let inBore = false;
    let trench = Infinity;
    // in front of a higher road's fill wall (`wallFaced`): the lower road's level, unless the point is some road's own
    let facedHard = Infinity;
    let owned = false;
    let ownedTop = -Infinity;
    // carriageway decks the point lies beside (not over): a decked median between two of them
    const medDecks: {
      w: Way;
      soffit: number;
      st: number;
      vx: number;
      vz: number;
    }[] = [];
    // (beside a cut wall: its retained earth, never a junction's daylight)
    let held = false;
    for (const [wi, p] of this.nearest(x, z)) {
      const w = net.ways[wi];
      if (w === skip || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      const st = w.st[k];
      if (
        st !== ST_DECK &&
        st !== ST_TUNNEL &&
        w.tpl.pave !== 'terrain' &&
        p.s >= w.cut0 - 0.01 &&
        p.s <= w.al.length - w.cut1 + 0.01
      ) {
        const lf = p.t >= 0;
        const els = lf ? w.sec.left : w.sec.right;
        const pe =
          Math.max(
            lf ? w.sec.paveL : w.sec.paveR,
            goreAt(w, p.i, p.f, lf)?.u ?? 0,
          ) + (els[0]?.kind === 'kerb' ? els[0].w : 0);
        const ue = Math.abs(p.t);
        // (not across a cut wall: the earth behind it is held at its top, the strip ends at the wall)
        if (
          ue > pe &&
          ue - pe < STRIP_MAX &&
          w.wall[lf ? 0 : 1][k] !== WALL_CUT
        ) {
          const sg = lf ? -1 : 1;
          edges.push({
            w,
            d: ue - pe,
            E: net.surfaceAt(w, p.i, p.f, lf ? pe : -pe),
            vx: w.al.tz[k] * sg,
            vz: -w.al.tx[k] * sg,
          });
        }
      }
      if (st === ST_DECK) {
        // the land under a deck stays under its soffit (at an abutment the approach fill ends at the deck end)
        const footD = p.t >= 0 ? w.sec.footL : w.sec.footR;
        const soffit = this.net.surfaceAt(w, p.i, p.f, 0) - DECK_DEPTH - 0.15;
        if (Math.abs(p.t) <= footD + 0.6) {
          cap = Math.min(cap, soffit);
          deckUnder = Math.min(deckUnder, soffit);
        } else if (w.stage || w.corr) {
          // (beside a carriageway's deck: maybe in a decked median, `Network.medianDecks`)
          const sg = p.t >= 0 ? -1 : 1;
          medDecks.push({
            w,
            soffit,
            st: w.stage ? p.s : (w.corr?.[k] ?? NaN),
            vx: w.al.tz[k] * sg,
            vz: -w.al.tx[k] * sg,
          });
        }
        continue;
      }
      const left = p.t >= 0;
      const sec = w.sec;
      const gore = goreAt(w, p.i, p.f, left);
      const footW = Math.max(left ? sec.footL : sec.footR, gore?.u ?? 0);
      const u = Math.abs(p.t);
      // (within a road on the ground out to its wall line: that road's land, never another road's faced strip, nor a
      // junction plaza far below it - a street junction tucked under a bridge end)
      if (
        st === ST_GROUND &&
        u <= footW + wallOff(w, k, left ? 0 : 1) &&
        w.tpl.pave !== 'terrain' &&
        p.s >= w.cut0 &&
        p.s <= w.al.length - w.cut1
      ) {
        owned = true;
        if (u <= footW)
          ownedTop = Math.max(ownedTop, net.surfaceAt(w, p.i, p.f, p.t));
      }
      // (inside a bore: its own floor, whatever streets run on the slab above - their strips / verges never reach down)
      if (st === ST_TUNNEL && u <= footW)
        hard = Math.min(hard, net.surfaceAt(w, p.i, p.f, p.t));
      // (past a bore's side - shoulder, gutter, the strip to a wall foot, the gap to the next bore: under the slab, the
      // trench floor, below)
      if (st === ST_TUNNEL) {
        if (u <= footW) inBore = true;
        else if (u - footW < TRENCH_FLOOR) {
          const E = net.surfaceAt(w, p.i, p.f, left ? footW : -footW);
          trench = Math.min(trench, E);
          // (the strip out to the wall line and the slab's bearing: this bore's floor, whatever bore it overlaps)
          if (u <= footW + w.tpl.daylight.wallOffset + SLAB_REACH)
            hard = Math.min(hard, E);
        }
      }
      if (st === ST_TUNNEL && u > footW && u - footW < BORE_GAP) {
        // (just past a bore's side: the median between two bores under one slab is held at their floor below)
        const sg = left ? -1 : 1;
        const vx = w.al.tz[k] * sg;
        const vz = -w.al.tx[k] * sg;
        const E = net.surfaceAt(w, p.i, p.f, left ? footW : -footW);
        for (const o of bores)
          if (o.w !== w && o.vx * vx + o.vz * vz < -0.3)
            hard = Math.min(hard, o.E, E);
        bores.push({ w, E, vx, vz });
      }
      const L = w.al.length;
      const inJ = p.s < w.cut0 - 0.01 || p.s > L - w.cut1 + 0.01;
      // (a tunnel is an open trench under its roof slab - the slab is a mesh, the terrain can not overhang: the road's
      // own ground out to its walls)
      if (u <= footW) {
        if (inJ) continue;
        // (the gore wedge: paved from this way's edge to its host's, the land under it)
        const g =
          gore && u > (left ? sec.paveL : sec.paveR)
            ? this.goreH(w, p, gore)
            : undefined;
        const h = g ?? net.surfaceAt(w, p.i, p.f, p.t);
        const pv = Math.max(left ? sec.paveL : sec.paveR, gore?.u ?? 0);
        if (g === undefined && u > pv && !this.meshed(w, u, left)) {
          const sg = left ? -1 : 1;
          verge.push({
            w,
            d: u - pv,
            E: net.surfaceAt(w, p.i, p.f, left ? pv : -pv),
            h,
            vx: w.al.tz[k] * sg,
            vz: -w.al.tx[k] * sg,
          });
          continue;
        }
        if (g !== undefined || this.meshed(w, u, left)) onMesh = true;
        foot = Math.min(
          foot,
          h - (g !== undefined || this.meshed(w, u, left) ? SINK : 0),
        );
        continue;
      }
      const d = u - footW;
      const dl = w.tpl.daylight;
      // (the wall line: the template's offset, out to the surveyed wall where a verge lies between, `wallOut`)
      const wo = wallOff(w, k, left ? 0 : 1);
      const E = net.surfaceAt(w, p.i, p.f, left ? footW : -footW);
      const wt = w.wall[left ? 0 : 1][k];
      // in front of a higher road's fill wall (network `facedWalls`): this road's level up to that face
      const faced = w.wallFaced[left ? 0 : 1][k];
      if (faced && d < faced) {
        facedHard = Math.min(facedHard, E);
        continue;
      }
      if (d < BETWEEN_MAX && w.tpl.pave !== 'terrain' && wt !== WALL_CUT) {
        // direction from the point towards this road: its left normal, towards the way
        const sg = left ? -1 : 1;
        // (dp / Ep: from the pavement edge or kerb back, as `edges` - a strip's plane runs edge to edge)
        const els = left ? w.sec.left : w.sec.right;
        const pe =
          (left ? w.sec.paveL : w.sec.paveR) +
          (els[0]?.kind === 'kerb' ? els[0].w : 0);
        const cand = {
          d,
          E,
          dp: u - pe,
          Ep: net.surfaceAt(w, p.i, p.f, left ? pe : -pe),
          vx: w.al.tz[k] * sg,
          vz: -w.al.tx[k] * sg,
        };
        if (side.length < 2) side.push(cand);
        else if (d < side[0].d || d < side[1].d)
          side[side[0].d > side[1].d ? 0 : 1] = cand;
        around.push(cand);
      }
      if (wt === WALL_CUT) {
        held = true;
        if (d < wo + WALL_SETBACK) {
          cap = Math.min(cap, E);
          // up to the setback the land is this road's, whatever runs above (a street whose footprint reaches over the
          // wall line would pull terrain vertices up in front of the face: spikes at the wall foot)
          hard = Math.min(hard, E);
        } else {
          // retained earth: level with the wall's top right behind it, eased to the land further back; above it the
          // land is a bank rising from the coping (a lowered wall, `wallStyles` maxHeight: no terrain cliff over it)
          const top = retainedTop(w, left ? 0 : 1, p) - 0.15;
          const back = d - wo - WALL_SETBACK;
          if (w.wallCarried[left ? 0 : 1][k]) behindCarried = true;
          if (d < wo + WALL_HOLD)
            floor = Math.max(
              floor,
              top - Math.max(0, back - WALL_GRADE_FLAT) * WALL_GRADE_FALL,
            );
          cap = Math.min(cap, top + 0.15 + back / dl.cut);
        }
      } else if (wt === WALL_FILL) {
        if (d < wo) floor = Math.max(floor, E);
      } else {
        dayCap = Math.min(dayCap, E + d / dl.cut);
        dayFloor = Math.max(dayFloor, E - d / dl.fill);
      }
    }
    // between the stage road's deck and its other carriageway's where the median is decked too: under the slab
    for (const a of medDecks)
      for (const b of medDecks)
        if (
          a.w.stage &&
          b.w !== a.w &&
          a.vx * b.vx + a.vz * b.vz < -0.3 &&
          this.net.medianDeckAt(a.st)
        )
          hard = Math.min(hard, a.soffit, b.soffit);
    // under a roof slab, outside every bore: the floor of the lowest bore beside it (the land between bores with
    // different floors never slopes up to a wall or the next bore - teeth along the lane edge)
    if (!inBore && trench < Infinity && this.slabAt(x, z) !== undefined)
      hard = Math.min(hard, trench);
    if (!owned) hard = Math.min(hard, facedHard);
    const ph = this.plazaHeight(x, z);
    if (ph !== undefined) {
      onMesh = true;
      foot = Math.min(foot, ph - SINK);
    }
    for (const ji of this.jgrid.at(x, z)) {
      const j = net.junctions[ji];
      if (x < j.minX || x > j.maxX || z < j.minZ || z > j.maxZ) continue;
      if (inPolygon(j.poly, x, z)) {
        const jh = this.junctionHeight(j, x, z);
        if (jh < ownedTop - UNDER_PLAZA) continue;
        onMesh = true;
        foot = Math.min(foot, jh - SINK);
        continue;
      }
      for (const c of j.corners)
        if (inPolygon(c.poly, x, z)) {
          const jh = this.junctionHeight(j, x, z);
          if (jh >= ownedTop - UNDER_PLAZA)
            foot = Math.min(foot, jh + c.rise - SINK);
        }
    }
    const between2 =
      side.length === 2 &&
      side[0].vx * side[1].vx + side[0].vz * side[1].vz < -0.3 &&
      side[0].d + side[1].d < BETWEEN_MAX;
    if (between2) {
      // (a narrow strip beside a road a storey higher, too steep for a bank: level with the lower edge, the higher
      // road's slab side drops to it as a face - mesh.ts `slabSkirt`)
      // (a narrow strip, under STRIP_MAX: one plane edge to edge - the 1 m mesh draws anything else as waves)
      const [a, b] = side;
      const dh = Math.abs(a.E - b.E);
      if (a.dp + b.dp < STRIP_MAX) {
        const plane = stripHeight(a.Ep, b.Ep, a.dp, b.dp);
        strip = true;
        cap = Math.min(cap, plane);
        floor = plane;
      } else if (
        dh > STEP_MIN &&
        dh <= STEP_FACE &&
        dh > (a.d + b.d) * STEP_SLOPE
      ) {
        // (no higher than the face the slab side can draw: a taller drop keeps its bank)
        cap = Math.min(cap, Math.min(a.E, b.E));
        floor = Math.min(floor, Math.min(a.E, b.E));
      } else {
        const between = Math.max(a.E, b.E) + BETWEEN_HUMP;
        cap = Math.min(cap, between);
        floor = Math.min(floor, between);
      }
    }
    // the land beside a junction's paving: its edge's cut / fill slope (a road's daylight), the paving not counting as
    // a road edge would leave the old land standing at its rim (mounds between the arms)
    if (foot === Infinity && !held)
      for (const ji of this.jnear.at(x, z)) {
        const j = net.junctions[ji];
        const P = j.poly;
        if (P.length < 6 || inPolygon(P, x, z)) continue;
        const sides: number[] = [];
        let bd = BETWEEN_MAX;
        let bx = 0;
        let bz = 0;
        for (let k = 0; k < P.length; k += 2) {
          const [ax, az] = [P[k], P[k + 1]];
          const [cx, cz] = [P[(k + 2) % P.length], P[(k + 3) % P.length]];
          const ex = cx - ax;
          const ez = cz - az;
          const l2 = ex * ex + ez * ez || 1;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2),
          );
          const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
          if (d < bd) [bd, bx, bz] = [d, ax + ex * t, az + ez * t];
          // (each edge of the outline near by is a side: an island in the paving's notch has paving all round)
          if (d < BETWEEN_MAX && d > 0.01)
            sides.push(ax + ex * t, az + ez * t, d);
        }
        if (bd >= BETWEEN_MAX || bd < 0.01) continue;
        const E = this.junctionHeight(j, bx, bz);
        if (E < ownedTop - UNDER_PLAZA) continue;
        const dl = j.arms[0].way.tpl.daylight;
        dayCap = Math.min(dayCap, E + bd / dl.cut);
        dayFloor = Math.max(dayFloor, E - bd / dl.fill);
        for (let k = 0; k < sides.length; k += 3)
          around.push({
            d: sides[k + 2],
            E: this.junctionHeight(j, sides[k], sides[k + 1]),
            vx: (sides[k] - x) / sides[k + 2],
            vz: (sides[k + 1] - z) / sides[k + 2],
          });
      }
    if (!between2 && around.length >= 3) {
      // (an island in a junction: roads and junction pavings on every side, none opposite the nearest two - a kerb
      // over its edges)
      const ang = around
        .map((o) => Math.atan2(o.vz, o.vx))
        .sort((p, q) => p - q);
      let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
      for (let k = 1; k < ang.length; k++)
        gap = Math.max(gap, ang[k] - ang[k - 1]);
      if (gap < ISLAND_GAP) {
        // (its edges weighted by nearness: a plane across an island between a ramp and the paving below it)
        let sw = 0;
        let se = 0;
        for (const o of around) {
          const wgt = 1 / Math.max(0.25, o.d * o.d);
          sw += wgt;
          se += wgt * o.E;
        }
        const top = se / sw + ISLAND_RISE;
        cap = Math.min(cap, top);
        floor = Math.min(floor, top);
      }
    }
    if (!onMesh && edges.length > 1) {
      // a narrow strip between two roads' edges: one plane edge to edge, or level with the lower edge where too steep
      // for a bank (the higher road's slab side / kerb back drops to it as a face, mesh.ts) - continuous, so the 1 m
      // mesh draws no waves
      let a = edges[0];
      for (const e of edges) if (e.d < a.d) a = e;
      let b: (typeof edges)[0] | undefined;
      for (const e of edges)
        if (
          e.w !== a.w &&
          e.vx * a.vx + e.vz * a.vz < -0.3 &&
          (!b || e.d < b.d)
        )
          b = e;
      if (b && a.d + b.d < STRIP_MAX) {
        return Math.min(stripHeight(a.E, b.E, a.d, b.d), hard, cap);
      }
    }
    if (verge.length) {
      // two roads' verges meeting from opposite sides: the land runs straight from one pavement edge to the other (the
      // lower verge alone would leave the higher road's edge as a step the 1 m mesh draws as a jagged face)
      let pair: [(typeof verge)[0], (typeof verge)[0]] | undefined;
      for (let a = 0; a < verge.length && !pair; a++)
        for (let b = a + 1; b < verge.length; b++)
          if (
            verge[a].w !== verge[b].w &&
            verge[a].vx * verge[b].vx + verge[a].vz * verge[b].vz < -0.3
          ) {
            pair = [verge[a], verge[b]];
            break;
          }
      if (pair) {
        const [a, b] = pair;
        // (too steep for a bank - a road beside another a storey lower: the strip lies level with the lower edge
        // and the higher road's slab side drops to it as a face, mesh.ts `slabSkirt`)
        foot = Math.min(foot, stripHeight(a.E, b.E, a.d, b.d));
      } else
        for (const v of verge) {
          // a road's verge facing a road a storey lower across a steep strip drops with the strip (the step is the
          // slab side's face at the pavement edge)
          let h = v.h;
          for (const o of side) {
            if (o.vx * v.vx + o.vz * v.vz >= -0.3) continue;
            if (v.d + o.dp < STRIP_MAX)
              // (a narrow strip: the verge is part of the strip edge to edge)
              h = Math.min(h, stripHeight(v.E, o.Ep, v.d, o.dp));
            else if (
              v.E - o.E > STEP_MIN &&
              v.E - o.E <= STEP_FACE &&
              v.E - o.E > (v.d + o.d) * STEP_SLOPE
            )
              h = Math.min(h, o.E);
          }
          foot = Math.min(foot, h);
        }
    }
    if (foot < Infinity) return Math.min(foot, hard);
    let h = this.natural(x, z);
    if (!strip) {
      cap = Math.min(cap, dayCap);
      floor = Math.max(floor, dayFloor);
    }
    // (the retained fill behind an abutment wall reaches up to the deck it carries: no gap under its side over the land)
    if (behindCarried && deckUnder < Infinity)
      floor = Math.max(floor, Math.min(deckUnder, cap));
    if (floor > h) h = floor;
    if (cap < h) h = cap;
    return Math.min(h, hard);
  }

  /** Top of a tunnel's roof slab at (x, z) (the street level over the trench), undefined off every slab. */
  slabAt(x: number, z: number): number | undefined {
    let out: number | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (!w.slab || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      if (w.st[k] !== ST_TUNNEL) continue;
      const footW = p.t >= 0 ? w.sec.footL : w.sec.footR;
      if (Math.abs(p.t) > footW + w.tpl.daylight.wallOffset + SLAB_REACH)
        continue;
      // (only between bore samples: past the portal the next sample has no roof)
      const j = Math.min(w.al.n - 1, p.i + 1);
      const a = w.st[p.i] === ST_TUNNEL ? w.slab[p.i] : w.slab[j];
      const b = w.st[j] === ST_TUNNEL ? w.slab[j] : w.slab[p.i];
      const h = a + (b - a) * p.f;
      out = out === undefined ? h : Math.max(out, h);
    }
    return out;
  }

  /**
   * The road slab cut (world/road-slab.ts rules, v2 sections): how far the DRAWN terrain sinks at (x, z) - physics keeps
   * `ground`. Under a paved way's pavement and a junction's paving the cut reaches `SLAB_SINKS.asphalt` over the first
   * SINK_RAMP m inside the edge (the 1 m mesh dips under the road, not beside it); just past a kerbless edge the verge
   * lies EDGE_DROP lower, easing back over EDGE_EASE m, so the slab's side (the skirt, v2/mesh.ts) shows. Not under
   * decks (no ground there).
   */
  meshSink(x: number, z: number): number {
    let sink = 0;
    // only the ways at ground level cut it: a lane passing under another way (its footprint over (x, z), metres higher)
    // lies below the ground the upper one owns
    const cand: [Way, Projection, number][] = [];
    let top = -Infinity;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      if (w.st[k] === ST_DECK) continue;
      const L = w.al.length;
      if (p.s < w.cut0 - 0.01 || p.s > L - w.cut1 + 0.01) continue;
      const h = this.net.surfaceAt(w, p.i, p.f, p.t);
      if (Math.abs(p.t) <= (p.t >= 0 ? w.sec.footL : w.sec.footR))
        top = Math.max(top, h);
      if (w.st[k] !== ST_TUNNEL && w.tpl.pave !== 'terrain')
        cand.push([w, p, h]);
    }
    sink = Math.max(sink, this.wallCut(x, z));
    sink = Math.max(sink, this.stepCut(x, z, cand));
    // (the edges the point lies just outside of: [distance past the kerb back, edge height])
    const holds: [number, number][] = [];
    for (const [w, p, h] of cand) {
      if (h < top - UNDER_DROP) continue;
      const left = p.t >= 0;
      const gore = goreAt(w, p.i, p.f, left);
      const pave = left ? w.sec.paveL : w.sec.paveR;
      const e = Math.abs(p.t) - Math.max(pave, gore?.u ?? 0);
      if (e < 0)
        sink = Math.max(sink, Math.min(1, -e / SINK_RAMP) * SLAB_SINKS.asphalt);
      else {
        // just outside the edge (under its kerb / sidewalk, or the shoulder) the drawn land stays under the edge, so no
        // 1 m terrain cell rises over the pavement from a vertex beside it (grass along the gutters)
        const els = left ? w.sec.left : w.sec.right;
        const kerbW = els[0]?.kind === 'kerb' ? els[0].w : 0;
        if (e <= kerbW + EDGE_HOLD) {
          // (past a gore wedge: its outer edge is the host's, at the host's height)
          const edgeH =
            gore && gore.u > pave
              ? gore.h
              : this.net.surfaceAt(w, p.i, p.f, p.t - Math.sign(p.t) * e);
          holds.push([Math.max(0, e - kerbW), edgeH]);
        }
      }
      if (e < 0) continue;
      if (
        e < EDGE_EASE &&
        (left ? w.sec.left : w.sec.right)[0]?.kind !== 'kerb'
      )
        sink = Math.max(sink, EDGE_DROP * (1 - e / EDGE_EASE));
    }
    if (holds.length) {
      // the land stays under the edge it lies beside; between two edges under the plane from one to the other (the
      // higher edge keeps its own verge, no dip to the lower neighbour right at it)
      holds.sort((p0, p1) => p0[0] - p1[0]);
      const [ea, ha] = holds[0];
      const hold =
        holds.length > 1
          ? ha + ((holds[1][1] - ha) * ea) / Math.max(1e-3, ea + holds[1][0])
          : ha;
      sink = Math.max(sink, this.ground(x, z) - (hold - EDGE_UNDER));
    }
    for (const ji of this.jgrid.at(x, z)) {
      const j = this.net.junctions[ji];
      if (x < j.minX || x > j.maxX || z < j.minZ || z > j.maxZ) continue;
      if (!inPolygon(j.poly, x, z)) {
        // (just outside the plaza: the land stays under its paving, as beside a way's edge)
        if (polygonDistance(j.poly, x, z) <= EDGE_HOLD)
          sink = Math.max(
            sink,
            this.ground(x, z) - (this.junctionHeight(j, x, z) - EDGE_UNDER),
          );
        continue;
      }
      const e = -polygonDistance(j.poly, x, z);
      sink = Math.max(sink, Math.min(1, -e / SINK_RAMP) * SLAB_SINKS.asphalt);
    }
    for (const pf of this.plazaFields) {
      const pl = pf.pl;
      if (
        x < pl.minX - PLAZA_EASE ||
        x > pl.maxX + PLAZA_EASE ||
        z < pl.minZ - PLAZA_EASE ||
        z > pl.maxZ + PLAZA_EASE
      )
        continue;
      if (inPolygon(pl.area, x, z)) {
        // (the land stays a slab's depth under the paving drawn here, a road cell's too: the coarse terrain mesh
        // never bulges through it between its vertices)
        const drawn = this.plazaDrawn(x, z, 0);
        if (drawn !== undefined)
          sink = Math.max(
            sink,
            this.ground(x, z) - (drawn - SLAB_SINKS.asphalt),
          );
        if (this.plazaHeight(x, z) === undefined) continue;
        const e = polygonDistance(pl.area, x, z);
        sink = Math.max(sink, Math.min(1, e / SINK_RAMP) * SLAB_SINKS.asphalt);
        continue;
      }
      // (just outside the plaza: the land stays under its rim, as beside a way's edge - out to the street ends cut back
      // to the first sample outside it; past a 1 m cell it eases back up to the land over PLAZA_EASE m, a gentle slope,
      // no toothed trench where the rim runs across the grid)
      const e = polygonDistance(pl.area, x, z);
      if (e > PLAZA_EASE) continue;
      const rim = this.plazaRim(pf, x, z);
      if (rim !== undefined)
        sink = Math.max(
          sink,
          (this.ground(x, z) - (rim - EDGE_UNDER)) *
            Math.min(1, (PLAZA_EASE - e) / (PLAZA_EASE - 1)),
        );
    }
    // under a cut wall's coping past the WALL_CELL band: the drawn land up at the retained earth (physics keeps its
    // setback trench), so no 1 m mesh triangle dips from the earth behind the coping into the trench (stairs along
    // the wall's back)
    if (sink <= 0) {
      const up = this.copingLand(x, z);
      if (up !== undefined) return Math.min(0, this.ground(x, z) - up);
    }
    return sink;
  }

  /** The retained earth's level over (x, z) where it lies under a cut wall's coping, past the WALL_CELL band. */
  private copingLand(x: number, z: number): number | undefined {
    let out: number | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.beyondEnds(w, p, x, z)) continue;
      const L = w.al.length;
      if (p.s < w.cut0 || p.s > L - w.cut1) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      if (w.st[k] !== ST_GROUND) continue;
      const side = p.t >= 0 ? 0 : 1;
      if (w.wall[side][k] !== WALL_CUT || w.wallLane[side][k]) continue;
      const wo = wallOff(w, k, side);
      const d = Math.abs(p.t) - (side === 0 ? w.sec.footL : w.sec.footR);
      if (d < wo + WALL_CELL || d >= wo + WALL_SETBACK) continue;
      const top = retainedTop(w, side, p) - 0.15;
      out = out === undefined ? top : Math.min(out, top);
    }
    return out;
  }

  /**
   * The drawn terrain's cut at the walls (`WALL_CELL`): a point within the band on a wall's high side (behind a cut
   * wall's face, in front of a fill wall's, inside a deck's side over the land under it) drops to the land on its low
   * side (a cut wall's road-side ground, the land at a fill wall's foot or beside the deck). Physics keeps `ground`.
   */
  wallCut(x: number, z: number): number {
    let cut = 0;
    let h = NaN;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      const left = p.t >= 0;
      if (w.st[k] === ST_TUNNEL) continue;
      const footW = left ? w.sec.footL : w.sec.footR;
      const u = Math.abs(p.t);
      const sg = left ? 1 : -1;
      const nx = w.al.tz[k] * sg;
      const nz = -w.al.tx[k] * sg;
      let low: number;
      if (w.st[k] === ST_DECK) {
        // a deck's side: the land under it (held up to the soffit) drops near the edge to the land beside it
        if (u > footW || u < footW - WALL_CELL) continue;
        const out = footW + 0.6 - u;
        low = this.ground(x + nx * out, z + nz * out, w);
      } else {
        const wt = w.wall[left ? 0 : 1][k];
        if (wt !== WALL_CUT && wt !== WALL_FILL) continue;
        const tf = footW + wallOff(w, k, left ? 0 : 1);
        if (wt === WALL_CUT) {
          if (u < tf || u > tf + WALL_CELL) continue;
          low = this.net.surfaceAt(w, p.i, p.f, left ? footW : -footW);
        } else {
          // (not under the road's own pavement: only the drawn verge / fill between it and the face)
          // (the whole strip from the pavement edge: it lies under the wall's concrete bed, `mesh.ts` walls)
          if (u > tf || u <= fillBedFrom(w, left)) continue;
          const out = tf + 0.6 - u;
          low = this.ground(x + nx * out, z + nz * out, w);
        }
      }
      if (Number.isNaN(h)) h = this.ground(x, z);
      cut = Math.max(cut, h - low);
    }
    return cut;
  }

  /**
   * The drawn terrain under a pavement edge (kerbed or not) that stands over lower land (a step, `STEP_SLOPE`): within
   * STEP_CELL inside the edge (WALL_CELL outside it, on open land) it drops to the land just outside, so no 1 m mesh
   * triangle bridges the step in front of the slab side's face (it lies hidden under the pavement). Physics keeps
   * `ground`.
   */
  /** (x, z) lies within a tunnel bore's footprint or the gap between two bores (`BORE_GAP`): under a slab. */
  overBore(x: number, z: number): boolean {
    for (const [wi, p] of this.nearest(x, z)) {
      const w = this.net.ways[wi];
      if (this.beyondEnds(w, p, x, z)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      if (w.st[k] !== ST_TUNNEL) continue;
      if (Math.abs(p.t) <= (p.t >= 0 ? w.sec.footL : w.sec.footR) + BORE_GAP)
        return true;
    }
    return false;
  }

  /** `stepCut`'s land samples beside an edge, keyed by way, side, 0.5 m station and offset. */
  private readonly besideMemo = new Map<number, number>();

  private stepCut(
    x: number,
    z: number,
    cand: [Way, Projection, number][],
  ): number {
    let cut = 0;
    // (outside a face only on open land: never on any road's pavement or kerb)
    const paved = cand.some(([w, p]) => {
      const lf = p.t >= 0;
      const els = lf ? w.sec.left : w.sec.right;
      return (
        Math.abs(p.t) <=
        Math.max(
          (lf ? w.sec.paveL : w.sec.paveR) +
            (els[0]?.kind === 'kerb' ? els[0].w : 0),
          goreAt(w, p.i, p.f, lf)?.u ?? 0,
        )
      );
    });
    for (const [w, p] of cand) {
      const left = p.t >= 0;
      // (the step's face: the pavement edge, or a kerb's back)
      const els = left ? w.sec.left : w.sec.right;
      const pave =
        (left ? w.sec.paveL : w.sec.paveR) +
        (els[0]?.kind === 'kerb' ? els[0].w : 0);
      const e = pave - Math.abs(p.t);
      if (e < (paved ? 0 : -WALL_CELL) || e > STEP_CELL) continue;
      if (goreAt(w, p.i, p.f, left)) continue;
      const k = p.f < 0.5 ? p.i : p.i + 1;
      const sg = left ? 1 : -1;
      const nx = w.al.tz[k] * sg;
      const nz = -w.al.tx[k] * sg;
      // (the land `off` m beyond the edge: shared by the vertices of one 0.5 m station, `besideMemo`)
      const beside = (off: number): number => {
        const key =
          ((w.index * 2 + (left ? 1 : 0)) * 1e6 + Math.round(p.s * 2)) * 64 +
          Math.round(off * 4);
        let v = this.besideMemo.get(key);
        if (v === undefined) {
          const o = e + off;
          v = this.ground(x + nx * o, z + nz * o);
          if (this.besideMemo.size > 400000) this.besideMemo.clear();
          this.besideMemo.set(key, v);
        }
        return v;
      };
      let low = beside(Math.max(-e, 0) + 0.5);
      const h = this.ground(x, z);
      if (e < 0) {
        // (just outside the face: land still at the edge's height that steps down further out - a drop of STEP_MIN
        // within 0.5 m, not a bank - also drops, so the face reaches the low land instead of a ridge of 1 m mesh teeth)
        if (h - low < STEP_MIN) continue;
        low = Math.min(low, beside(-e + 1));
        if (h - low < STEP_MIN) continue;
      }
      const edge = this.net.surfaceAt(w, p.i, p.f, left ? pave : -pave);
      if (edge - low < STEP_MIN) continue;
      cut = Math.max(cut, Math.min(h - low, STEP_FACE));
    }
    // (over a tunnel bore the land is the slab's roof: never cut down towards the bore floor)
    if (cut > 0 && this.overBore(x, z)) return 0;
    return cut;
  }

  /** The element at lateral u on one side is drawn as a mesh (the terrain sinks under it). */
  private meshed(w: Way, u: number, left: boolean): boolean {
    const sec = w.sec;
    const pave = left ? sec.paveL : sec.paveR;
    if (u <= pave) return w.tpl.pave !== 'terrain';
    let acc = pave;
    for (const e of left ? sec.left : sec.right) {
      if (u <= acc + e.w) return e.mat !== 'terrain';
      acc += e.w;
    }
    return false;
  }

  /** Surface id of way `w` at lateral t / arc length s. */
  private surfaceOf(w: Way, s: number, t: number): SurfaceId {
    const sec = w.sec;
    const left = t >= 0;
    const u = Math.abs(t);
    const pave = left ? sec.paveL : sec.paveR;
    if (u <= pave) {
      for (const line of sec.paint) {
        const half = line.w / 2 + (line.double ? 0.11 : 0);
        if (Math.abs(t - line.t) > half) continue;
        if (line.dash && s % 12 > 3) continue;
        return 'paint';
      }
      return w.st[Math.min(w.al.n - 1, Math.round(s / 2))] === ST_DECK &&
        w.tpl.surface === 'asphalt_city'
        ? 'concrete'
        : w.tpl.surface;
    }
    let acc = pave;
    for (const e of left ? sec.left : sec.right) {
      if (u <= acc + e.w) return e.surface;
      acc += e.w;
    }
    return 'grass';
  }

  private hits: TopHit[] = [];
  /**
   * Drivable surfaces at (x, z): every way section (decks and tunnel floors included), junction paving and sidewalk
   * corners. Returns the highest at or below `maxY` + 0.6 (a probe from the car), or the highest of all for Infinity;
   * undefined off every road.
   */
  top(x: number, z: number, maxY = Infinity): TopHit | undefined {
    const net = this.net;
    let best: TopHit | undefined;
    let bestRank = -1;
    // the highest surface; where two sections overlap at grade (a ramp's merge end on the road it joins) the higher
    // ranked one within half a metre wins
    const consider = (
      h: number,
      surface: SurfaceId,
      nx: number,
      ny: number,
      nz: number,
      rank: number,
    ) => {
      if (maxY !== Infinity && h > maxY + 0.6) return;
      if (
        !best ||
        h > best.h + 0.5 ||
        (h > best.h && rank >= bestRank) ||
        (h > best.h - 0.5 && rank > bestRank)
      ) {
        best = { h, surface, nx, ny, nz };
        bestRank = rank;
      }
    };
    for (const [wi, p] of this.nearest(x, z)) {
      const w = net.ways[wi];
      if (this.beyondEnds(w, p, x, z)) continue;
      const left = p.t >= 0;
      const gore = goreAt(w, p.i, p.f, left);
      const footW = Math.max(left ? w.sec.footL : w.sec.footR, gore?.u ?? 0);
      if (Math.abs(p.t) > footW) continue;
      const L = w.al.length;
      if (p.s < w.cut0 - 0.01 || p.s > L - w.cut1 + 0.01) continue;
      const pv = left ? w.sec.paveL : w.sec.paveR;
      if (gore && Math.abs(p.t) > pv) {
        // the gore wedge drives like the pavement (its plane: the way's edge to the host's)
        const tE = Math.sign(p.t) * pv;
        const hg = this.goreH(w, p, gore);
        const sl =
          (gore.h - net.surfaceAt(w, p.i, p.f, tE)) /
          Math.max(0.01, gore.u - pv);
        const k = p.f < 0.5 ? p.i : p.i + 1;
        const gx = sl * (left ? 1 : -1) * w.al.tz[k];
        const gz = -sl * (left ? 1 : -1) * w.al.tx[k];
        const l = Math.hypot(gx, 1, gz);
        consider(
          hg,
          this.surfaceOf(w, p.s, tE * 0.99),
          -gx / l,
          1 / l,
          -gz / l,
          // (over the host's verge: the paving wins)
          Math.max(
            w.tpl.rank,
            ...w.into.map((q) => (q ? q.tpl.rank + 0.5 : 0)),
          ),
        );
        continue;
      }
      const h = net.surfaceAt(w, p.i, p.f, p.t);
      // normal from the same element: along the way + across within 0.2 m
      const e = 0.5;
      const i2 = Math.min(w.al.n - 2, p.i + 1);
      const ds = w.al.s[i2 + 1] - w.al.s[i2] || 2;
      const hs = net.surfaceAt(w, i2, 0, p.t);
      const h0 = net.surfaceAt(w, p.i, 0, p.t);
      const gs = (hs - h0) / ds;
      const dt = 0.2;
      const tIn = left ? Math.max(0, p.t - dt) : Math.min(0, p.t + dt);
      // (per section metre: on a narrowed pavement a world metre is 1 / k of them)
      const gt =
        (h - net.surfaceAt(w, p.i, p.f, tIn)) /
        (p.t - tIn || 1) /
        (Math.abs(p.t) <= (left ? w.sec.paveL : w.sec.paveR)
          ? scaleAt(w, p.i, p.f)
          : 1);
      const k = p.f < 0.5 ? p.i : p.i + 1;
      const tx = w.al.tx[k];
      const tz = w.al.tz[k];
      // world gradient = gs * tangent + gt * left normal (tz, -tx)
      const gx = gs * tx + gt * tz;
      const gz = gs * tz - gt * tx;
      const l = Math.hypot(gx, 1, gz);
      void e;
      consider(
        h,
        this.surfaceOf(w, p.s, p.t),
        -gx / l,
        1 / l,
        -gz / l,
        w.tpl.rank,
      );
    }
    const slab = this.slabAt(x, z);
    if (slab !== undefined) consider(slab, 'concrete', 0, 1, 0, 0);
    const ph = this.plazaHeight(x, z);
    if (ph !== undefined) consider(ph, 'asphalt_city', 0, 1, 0, 5);
    for (const ji of this.jgrid.at(x, z)) {
      const j = net.junctions[ji];
      if (x < j.minX || x > j.maxX || z < j.minZ || z > j.maxZ) continue;
      const inside = inPolygon(j.poly, x, z);
      let rise = -1;
      if (!inside)
        for (const c of j.corners)
          if (inPolygon(c.poly, x, z)) {
            rise = c.rise;
            break;
          }
      if (!inside && rise < 0) continue;
      const h0 = this.junctionHeight(j, x, z);
      const hx = this.junctionHeight(j, x + 0.5, z);
      const hz = this.junctionHeight(j, x, z + 0.5);
      const gx = (hx - h0) / 0.5;
      const gz = (hz - h0) / 0.5;
      const l = Math.hypot(gx, 1, gz);
      consider(
        h0 + (inside ? 0 : rise),
        inside ? j.surface : 'concrete',
        -gx / l,
        1 / l,
        -gz / l,
        j.rank,
      );
    }
    void this.hits;
    return best;
  }

  /**
   * The lowest section of another way at (x, z) lying under `top` by less than 3 m (a street running over a tunnel
   * slab lower than the slab's level there), or undefined.
   */
  streetBelow(
    x: number,
    z: number,
    self: Way,
    top: number,
  ): number | undefined {
    let out: number | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w === self || w.internal || this.beyondEnds(w, p, x, z)) continue;
      if (p.s < w.cut0 || p.s > w.al.length - w.cut1) continue;
      const footW = p.t >= 0 ? w.sec.footL : w.sec.footR;
      if (Math.abs(p.t) > footW + 0.5) continue;
      if (w.st[p.f < 0.5 ? p.i : Math.min(w.al.n - 1, p.i + 1)] === ST_TUNNEL)
        continue;
      const h = this.net.surfaceAt(
        w,
        p.i,
        p.f,
        Math.sign(p.t) * Math.min(Math.abs(p.t), footW),
      );
      if (h >= top || h < top - 3) continue;
      if (out === undefined || h < out) out = h;
    }
    return out;
  }

  /**
   * Height of another way's section at (x, z) - of any structure, the one closest to `ref` (the probing wall's own road
   * level): a deck only within 3 m of it (a deck far above is not the land beside the road), a road on the ground at
   * any height up to ABOVE_MAX (the road at the rim of the cut: the wall carries its edge): the wall probes read it.
   */
  sectionHeightOther(
    x: number,
    z: number,
    self: Way,
    ref: number,
  ): number | undefined {
    let out: number | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w === self || this.beyondEnds(w, p, x, z)) continue;
      const footW = p.t >= 0 ? w.sec.footL : w.sec.footR;
      if (Math.abs(p.t) > footW) continue;
      const h = this.net.surfaceAt(w, p.i, p.f, p.t);
      const onGround = w.st[p.f < 0.5 ? p.i : p.i + 1] !== ST_DECK;
      if (Math.abs(h - ref) > (onGround && h > ref ? ABOVE_MAX : 3)) continue;
      if (out === undefined || Math.abs(h - ref) < Math.abs(out - ref)) out = h;
    }
    const slab = this.slabAt(x, z);
    if (
      slab !== undefined &&
      Math.abs(slab - ref) <= 3 &&
      (out === undefined || Math.abs(slab - ref) < Math.abs(out - ref))
    )
      out = slab;
    return out;
  }

  /**
   * Another way whose pavement (+ `pad`) holds (x, z) at about height `y` (within 1.2 m), the highest ranked: a ramp
   * merging alongside, the road a ramp's end lies on. Decks count only at their own level.
   * `gores` false: the painted gore between a ramp and its road does not count, only the lanes.
   */
  pavedByOther(
    x: number,
    z: number,
    y: number,
    self: Way,
    pad = 0,
    tol = 1.2,
    gores = true,
  ): Way | undefined {
    let best: Way | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w === self || w.internal || this.beyondEnds(w, p, x, z)) continue;
      const pv = p.t >= 0 ? w.sec.paveL : w.sec.paveR;
      const gore = gores ? goreAt(w, p.i, p.f, p.t >= 0) : undefined;
      const pave = Math.max(pv, gore?.u ?? 0);
      if (Math.abs(p.t) > pave + pad) continue;
      const L = w.al.length;
      if (p.s < w.cut0 || p.s > L - w.cut1) continue;
      const h =
        gore && Math.abs(p.t) > pv
          ? this.goreH(w, p, gore)
          : this.net.surfaceAt(w, p.i, p.f, p.t);
      if (Math.abs(h - y) > tol) continue;
      if (!best || w.tpl.rank > best.tpl.rank) best = w;
    }
    return best;
  }

  /**
   * Another way whose whole section (sidewalks, verges; + `pad`) holds (x, z) at about height `y`: the platform test
   * for walls (a wall never stands on or beside a road at its own level).
   */
  sectionByOther(
    x: number,
    z: number,
    y: number,
    self: Way,
    pad = 0,
    tol = 3,
  ): Way | undefined {
    let best: Way | undefined;
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w === self || w.internal || this.beyondEnds(w, p, x, z)) continue;
      const foot = p.t >= 0 ? w.sec.footL : w.sec.footR;
      if (Math.abs(p.t) > foot + pad) continue;
      const L = w.al.length;
      if (p.s < w.cut0 - pad || p.s > L - w.cut1 + pad) continue;
      const h = this.net.surfaceAt(w, p.i, p.f, p.t);
      if (Math.abs(h - y) > tol) continue;
      if (!best || w.tpl.rank > best.tpl.rank) best = w;
    }
    return best;
  }

  /** Inside any way section / junction / corner (scatter, buildings keep off). `pad` m beyond the edge counts too. */
  /** (x, z) on a way's pavement (+ `pad`) or a junction's paving, at any height: a plaza island stops there. */
  onPaving(x: number, z: number, pad = 0): boolean {
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (w.internal || this.beyondEnds(w, p, x, z)) continue;
      if (p.s < w.cut0 || p.s > w.al.length - w.cut1) continue;
      if (Math.abs(p.t) <= (p.t >= 0 ? w.sec.paveL : w.sec.paveR) + pad)
        return true;
    }
    for (const ji of this.jgrid.at(x, z)) {
      const j = this.net.junctions[ji];
      if (j.plaza || x < j.minX || x > j.maxX || z < j.minZ || z > j.maxZ)
        continue;
      if (inPolygon(j.poly, x, z)) return true;
    }
    return false;
  }

  occupied(x: number, z: number, pad = 0): boolean {
    for (const [wi, p] of this.nearestFoot(x, z)) {
      const w = this.net.ways[wi];
      if (this.beyondEnds(w, p, x, z)) continue;
      const footW = Math.max(
        p.t >= 0 ? w.sec.footL : w.sec.footR,
        goreAt(w, p.i, p.f, p.t >= 0)?.u ?? 0,
      );
      if (Math.abs(p.t) <= footW + pad) return true;
    }
    for (const ji of this.jgrid.at(x, z)) {
      const j = this.net.junctions[ji];
      if (
        x < j.minX - pad ||
        x > j.maxX + pad ||
        z < j.minZ - pad ||
        z > j.maxZ + pad
      )
        continue;
      if (inPolygon(j.poly, x, z)) return true;
      for (const c of j.corners) if (inPolygon(c.poly, x, z)) return true;
    }
    return false;
  }
}
