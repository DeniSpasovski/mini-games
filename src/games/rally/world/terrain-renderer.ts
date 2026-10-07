import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Vector3,
} from 'three';
import { CHUNK_CELLS } from './heightfield';
import type { TerrainGenerator } from './terrain-gen';
import {
  getTerrainMaterial,
  setGroundMoisture,
  setGroundTint,
} from './terrain-material';
import { RENDER_MARGIN, type World } from './world';

/**
 * Streams terrain meshes around a focus point.
 *
 *  - LOD by distance: vertex step 1/2/4/8 cells. LOD0 reads the cached
 *    heightfield (exact match with physics), LOD1-3 sample the generator
 *    directly at coarse resolution so far terrain never fills the cache.
 *  - Far tiles merge chunks to save draw calls: 2 x 2 chunks once a block is all
 *    LOD2, 4 x 4 once it is all LOD3 (same vertex spacing, one mesh each).
 *  - Skirts hide cracks between neighbouring LODs.
 *  - Index buffers are shared per grid size (same topology for every tile).
 *  - Work is time-sliced: `update()` builds tiles until its ms budget is used.
 *    A replaced tile stays until every tile covering its area is built.
 */
const STEPS = [1, 2, 4, 8];
/** Merged tile sizes (chunks per side) -> the LOD they need: 2 x 2 at LOD2, 4 x 4 at LOD3. */
const MERGE: Record<number, number> = { 2: 2, 4: 3 };
const TOP = 4;
/** Metres of camera travel before the tile plan is redone (well inside the 10% LOD hysteresis). */
const REPLAN = 8;

interface Tile {
  /** Origin chunk (a multiple of `span`) and size in chunks. */
  cx: number;
  cz: number;
  span: number;
  lod: number;
  mesh: Mesh;
}

interface Want {
  cx: number;
  cz: number;
  span: number;
  lod: number;
  d: number;
}

export interface TerrainOptions {
  viewDistance: number;
  /** Distance thresholds between LODs (m). */
  lodDistances?: [number, number, number];
  /** Leave the ground moisture neutral: the caller bakes it later (`World.moistureJob`) and sets it. */
  deferMoisture?: boolean;
}

export class TerrainRenderer {
  readonly group = new Group();
  private tiles = new Map<number, Tile>();
  private indexCache = new Map<number, BufferAttribute>();
  private lodDistances: [number, number, number];
  private cs: number;
  private heightAbove = 0;
  /** Where the tile plan was last made (re-planned after REPLAN m of travel). */
  private planned = { x: Infinity, z: Infinity, h: 0 };
  private want = new Map<number, Want>();
  /** Builds of the current plan, nearest first; `next` = the first not yet done. */
  private todo: Want[] = [];
  private next = 0;
  /** Tile builds still wanted (for loading screens / stats). */
  pending = 0;

  constructor(
    private world: World,
    private opts: TerrainOptions,
  ) {
    this.group.name = 'terrain';
    this.lodDistances = opts.lodDistances ?? [150, 320, 640];
    this.cs = world.heightfield.chunkSize;
    setGroundTint(world.map.environment.groundTint);
    setGroundMoisture(opts.deferMoisture ? null : world.moisture);
  }

  /** Terrain meshes (one draw call each). */
  get chunkCount(): number {
    return this.tiles.size;
  }

  setViewDistance(d: number): void {
    this.opts.viewDistance = d;
    this.planned.x = Infinity;
  }

  /**
   * Load / unload / re-LOD tiles around `focus`. Returns true when nothing
   * is left to build. `heightAboveGround` makes LODs coarser for aerial views.
   */
  update(focus: Vector3, budgetMs = 4, heightAboveGround = 0): boolean {
    const t0 = performance.now();
    // The plan (walking every tile costs ~0.3 ms) is redone only after REPLAN m of travel; in between
    // the queued builds continue.
    const p = this.planned;
    const h = Math.max(0, heightAboveGround);
    const moved = Math.hypot(focus.x - p.x, focus.z - p.z, h - p.h) >= REPLAN;
    if (moved) {
      p.x = focus.x;
      p.z = focus.z;
      p.h = h;
      this.heightAbove = h;
      this.plan(focus);
    } else if (this.pending === 0) {
      this.world.heightfield.tick();
      return true;
    }

    const todo = this.todo;
    let built = 0;
    // Always allow ~1 ms of progress so streaming never stalls.
    const deadline = Math.max(t0 + budgetMs, performance.now() + 1);
    for (; this.next < todo.length; this.next++) {
      const w = todo[this.next];
      if (this.tiles.get(key(w.cx, w.cz, w.span))?.lod === w.lod) continue;
      if (built > 0 && performance.now() > deadline) break;
      // LOD0 needs the 1 m heightfield: generate it time-sliced, build the mesh when ready.
      if (w.lod === 0 && !this.world.heightfield.prepare(w.cx, w.cz, deadline))
        break;
      this.buildTile(w);
      built++;
    }
    this.pending = todo.length - this.next;
    if (moved || built > 0) this.unloadReplaced();
    this.world.heightfield.tick();
    return this.pending === 0;
  }

  /** Wanted tiles around `focus` and the builds they need, nearest first. */
  private plan(focus: Vector3): void {
    const b = this.world.map.bounds;
    const m = RENDER_MARGIN;
    const vd = this.opts.viewDistance;
    const cs = this.cs;
    // Chunks inside the map (+ margin); single chunks also stay inside the view square.
    const lx0 = Math.floor((b.minX - m) / cs);
    const lx1 = Math.floor((b.maxX + m) / cs);
    const lz0 = Math.floor((b.minZ - m) / cs);
    const lz1 = Math.floor((b.maxZ + m) / cs);
    const cx0 = Math.max(lx0, Math.floor((focus.x - vd) / cs));
    const cx1 = Math.min(lx1, Math.floor((focus.x + vd) / cs));
    const cz0 = Math.max(lz0, Math.floor((focus.z - vd) / cs));
    const cz1 = Math.min(lz1, Math.floor((focus.z + vd) / cs));

    // Wanted tiles: split each 4 x 4 block until its parts are far enough to merge.
    const want = new Map<number, Want>();
    const visit = (cx: number, cz: number, span: number): void => {
      const d = this.tileDistance(cx, cz, span, focus);
      if (d > vd) return;
      if (span === 1) {
        if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) return;
        const k = key(cx, cz, 1);
        const lod = this.lodFor(d, this.tiles.get(k)?.lod);
        want.set(k, { cx, cz, span, lod, d });
        return;
      }
      const lod = MERGE[span];
      const k = key(cx, cz, span);
      const inMap =
        cx >= lx0 && cx + span - 1 <= lx1 && cz >= lz0 && cz + span - 1 <= lz1;
      // Hysteresis: merge 10% past the threshold, split again right at it.
      const t = this.lodDistances[lod - 1] * (this.tiles.has(k) ? 1 : 1.1);
      if (inMap && d >= t) {
        want.set(k, { cx, cz, span, lod, d });
        return;
      }
      const h = span / 2;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) visit(cx + i * h, cz + j * h, h);
    };
    for (let bz = Math.floor(cz0 / TOP); bz <= Math.floor(cz1 / TOP); bz++)
      for (let bx = Math.floor(cx0 / TOP); bx <= Math.floor(cx1 / TOP); bx++)
        visit(bx * TOP, bz * TOP, TOP);

    const todo: Want[] = [];
    for (const [k, w] of want)
      if (this.tiles.get(k)?.lod !== w.lod) todo.push(w);
    todo.sort((a, b2) => a.d - b2.d);
    this.want = want;
    this.todo = todo;
    this.next = 0;
  }

  /** Unload tiles nobody wants once the tiles replacing them are built (no holes while merging / splitting). */
  private unloadReplaced(): void {
    const want = this.want;
    const ready = (cx: number, cz: number): boolean => {
      for (let span = 1; span <= TOP; span *= 2) {
        const k = key(
          Math.floor(cx / span) * span,
          Math.floor(cz / span) * span,
          span,
        );
        const w = want.get(k);
        if (w) return this.tiles.get(k)?.lod === w.lod;
      }
      return true; // out of range
    };
    for (const [k, t] of this.tiles) {
      if (want.has(k)) continue;
      let covered = true;
      for (let j = 0; j < t.span && covered; j++)
        for (let i = 0; i < t.span && covered; i++)
          covered = ready(t.cx + i, t.cz + j);
      if (covered) {
        this.disposeTile(t);
        this.tiles.delete(k);
      }
    }
  }

  private tileDistance(
    cx: number,
    cz: number,
    span: number,
    p: Vector3,
  ): number {
    const cs = this.cs;
    const dx = Math.max(cx * cs - p.x, 0, p.x - (cx + span) * cs);
    const dz = Math.max(cz * cs - p.z, 0, p.z - (cz + span) * cs);
    return Math.hypot(dx, dz, this.heightAbove);
  }

  private lodFor(d: number, current?: number): number {
    const t = this.lodDistances;
    // Hysteresis: stay at the current LOD unless 10% past the threshold.
    const h = (lod: number) =>
      current !== undefined && lod >= current ? 1.1 : 1;
    if (d < t[0] * h(1)) return 0;
    if (d < t[1] * h(2)) return 1;
    if (d < t[2] * h(3)) return 2;
    return 3;
  }

  private buildTile(w: Want): void {
    const k = key(w.cx, w.cz, w.span);
    const old = this.tiles.get(k);
    const geometry = this.buildGeometry(w.cx, w.cz, w.span, w.lod);
    if (old) {
      releaseGeometry(old.mesh.geometry);
      old.mesh.geometry = geometry;
      old.lod = w.lod;
      return;
    }
    const mesh = new Mesh(geometry, getTerrainMaterial());
    mesh.position.set(w.cx * this.cs, 0, w.cz * this.cs);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `terrain ${w.cx},${w.cz}${w.span > 1 ? ` x${w.span}` : ''}`;
    this.group.add(mesh);
    this.tiles.set(k, { cx: w.cx, cz: w.cz, span: w.span, lod: w.lod, mesh });
  }

  private buildGeometry(
    cx: number,
    cz: number,
    span: number,
    lod: number,
  ): BufferGeometry {
    const step = STEPS[lod];
    const n = (span * CHUNK_CELLS) / step + 1;
    const vcount = n * n + 4 * n;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const spl = new Uint8Array(vcount * 4);
    const cell = this.world.heightfield.cell;
    const skirt = 1.5 * step;

    // Only LOD0 (near the car) needs the exact 1 m physics heightfield; coarser
    // LODs sample the generator at their own resolution (much cheaper).
    if (lod === 0) {
      const c = this.world.heightfield.chunk(cx, cz);
      const row = CHUNK_CELLS + 1;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = j * n + i;
          const gi = i * step;
          const gj = j * step;
          pos[v * 3] = gi * cell;
          pos[v * 3 + 1] = c.h(gi, gj);
          pos[v * 3 + 2] = gj * cell;
          const s = gj * row + gi;
          nor[v * 3] = c.normals[s * 3];
          nor[v * 3 + 1] = c.normals[s * 3 + 1];
          nor[v * 3 + 2] = c.normals[s * 3 + 2];
          for (let q = 0; q < 4; q++) spl[v * 4 + q] = c.splat[s * 4 + q];
        }
      }
    } else {
      // Coarse LODs sample the generator directly (no heightfield cache).
      const g = new TerrainGrid(
        this.world.gen,
        cx * this.cs,
        cz * this.cs,
        step * cell,
        n,
        n,
      );
      g.heights(0, n + 2);
      g.vertices(0, n, pos, nor, spl);
    }

    // Skirts: copies of the edge vertices pushed down.
    let sv = n * n;
    const edge = (i: number, j: number) => {
      const v = j * n + i;
      pos[sv * 3] = pos[v * 3];
      pos[sv * 3 + 1] = pos[v * 3 + 1] - skirt;
      pos[sv * 3 + 2] = pos[v * 3 + 2];
      nor.copyWithin(sv * 3, v * 3, v * 3 + 3);
      spl.copyWithin(sv * 4, v * 4, v * 4 + 4);
      sv++;
    };
    for (let i = 0; i < n; i++) edge(i, 0);
    for (let i = 0; i < n; i++) edge(i, n - 1);
    for (let j = 0; j < n; j++) edge(0, j);
    for (let j = 0; j < n; j++) edge(n - 1, j);

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('splat', new BufferAttribute(spl, 4, true));
    g.setIndex(this.indexFor(n));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private indexFor(n: number): BufferAttribute {
    let idx = this.indexCache.get(n);
    if (idx) return idx;
    const tris: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i; // 00
        const b = a + 1; // 10
        const c = a + n; // 01
        const d = c + 1; // 11
        // Same split as Heightfield.height(): (00,01,11) and (00,11,10).
        tris.push(a, c, d, a, d, b);
      }
    }
    // Skirt strips (both windings so culling never shows a gap).
    const base = n * n;
    const strip = (start: number, edgeV: (k: number) => number) => {
      for (let k = 0; k < n - 1; k++) {
        const a = edgeV(k);
        const b = edgeV(k + 1);
        const sa = start + k;
        const sb = start + k + 1;
        tris.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
      }
    };
    strip(base, (k) => k);
    strip(base + n, (k) => (n - 1) * n + k);
    strip(base + 2 * n, (k) => k * n);
    strip(base + 3 * n, (k) => k * n + n - 1);
    const arr =
      n * n + 4 * n > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
    idx = new BufferAttribute(arr, 1);
    this.indexCache.set(n, idx);
    return idx;
  }

  private disposeTile(t: Tile): void {
    this.group.remove(t.mesh);
    releaseGeometry(t.mesh.geometry);
  }

  dispose(): void {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
  }
}

/**
 * Generator samples on a regular grid: `nx` x `nz` vertices `d` m apart from
 * (x0, z0), plus a 1-sample border for normals. Rows can be filled in slices
 * (time-sliced builds): height rows first, then the vertex rows they cover.
 */
export class TerrainGrid {
  /** Row length of the bordered height grid. */
  private m: number;
  private hs: Float32Array;
  private rd: Float32Array;
  private rh: Float32Array;
  private sp = [0, 0, 0, 0];

  constructor(
    private gen: TerrainGenerator,
    readonly x0: number,
    readonly z0: number,
    readonly d: number,
    readonly nx: number,
    readonly nz: number,
  ) {
    this.m = nx + 2;
    const size = this.m * (nz + 2);
    this.hs = new Float32Array(size);
    this.rd = new Float32Array(size);
    this.rh = new Float32Array(size);
  }

  /** Sample bordered height rows [j0, j1) (0 .. nz + 2). */
  heights(j0: number, j1: number): void {
    const { gen, m, d, hs, rd, rh } = this;
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < m; i++) {
        const k = j * m + i;
        hs[k] = gen.height(this.x0 + (i - 1) * d, this.z0 + (j - 1) * d);
        const q = gen.lastRoad;
        rd[k] = q.found ? q.distance : Infinity;
        rh[k] = q.halfWidth;
      }
    }
  }

  /**
   * Vertex rows [j0, j1) (0 .. nz): position relative to (x0, z0), normal and
   * splat. Needs height rows j0 .. j1 + 1.
   */
  vertices(
    j0: number,
    j1: number,
    pos: Float32Array,
    nor: Float32Array,
    spl: Uint8Array,
  ): void {
    const { gen, m, d, hs, rd, rh, sp, nx } = this;
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < nx; i++) {
        const v = j * nx + i;
        const k = (j + 1) * m + (i + 1);
        pos[v * 3] = i * d;
        pos[v * 3 + 1] = hs[k];
        pos[v * 3 + 2] = j * d;
        const dx = hs[k - 1] - hs[k + 1];
        const dz = hs[k - m] - hs[k + m];
        const len = Math.hypot(dx, 2 * d, dz);
        nor[v * 3] = dx / len;
        nor[v * 3 + 1] = (2 * d) / len;
        nor[v * 3 + 2] = dz / len;
        gen.splat(
          this.x0 + i * d,
          this.z0 + j * d,
          1 - (2 * d) / len,
          rd[k],
          rh[k],
          sp,
          // Dirt tracks at least ~a vertex step wide, so they stay lines on coarse tiles (not dots).
          d * 0.75,
        );
        for (let q = 0; q < 4; q++) spl[v * 4 + q] = Math.round(sp[q] * 255);
      }
    }
  }
}

/** Dispose a chunk geometry without freeing the shared index buffer. */
function releaseGeometry(g: BufferGeometry): void {
  g.setIndex(null);
  g.dispose();
}

function key(cx: number, cz: number, span: number): number {
  return ((cx + 32768) * 65536 + (cz + 32768)) * 8 + span;
}
