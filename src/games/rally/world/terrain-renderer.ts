import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Vector3,
} from 'three';
import { CHUNK_CELLS } from './heightfield';
import type { TerrainGenerator } from './terrain-gen';
import { getTerrainMaterial, setGroundTint } from './terrain-material';
import { RENDER_MARGIN, type World } from './world';

/**
 * Streams terrain chunk meshes around a focus point.
 *
 *  - LOD by distance: vertex step 1/2/4/8 cells. LOD0 reads the cached
 *    heightfield (exact match with physics), LOD1-3 sample the generator
 *    directly at coarse resolution so far terrain never fills the cache.
 *  - Skirts hide cracks between neighbouring LODs.
 *  - Index buffers are shared per LOD (same topology for every chunk).
 *  - Work is time-sliced: `update()` builds chunks until its ms budget is used.
 */
const STEPS = [1, 2, 4, 8];

interface ChunkMesh {
  cx: number;
  cz: number;
  lod: number;
  mesh: Mesh;
}

export interface TerrainOptions {
  viewDistance: number;
  /** Distance thresholds between LODs (m). */
  lodDistances?: [number, number, number];
}

export class TerrainRenderer {
  readonly group = new Group();
  private meshes = new Map<number, ChunkMesh>();
  private indexCache = new Map<number, BufferAttribute>();
  private lodDistances: [number, number, number];
  private cs: number;
  private heightAbove = 0;
  /** Chunk builds still wanted (for loading screens / stats). */
  pending = 0;

  constructor(
    private world: World,
    private opts: TerrainOptions,
  ) {
    this.group.name = 'terrain';
    this.lodDistances = opts.lodDistances ?? [150, 320, 640];
    this.cs = world.heightfield.chunkSize;
    setGroundTint(world.map.environment.groundTint);
  }

  get chunkCount(): number {
    return this.meshes.size;
  }

  setViewDistance(d: number): void {
    this.opts.viewDistance = d;
  }

  /**
   * Load / unload / re-LOD chunks around `focus`. Returns true when nothing
   * is left to build. `heightAboveGround` makes LODs coarser for aerial views.
   */
  update(focus: Vector3, budgetMs = 4, heightAboveGround = 0): boolean {
    this.heightAbove = Math.max(0, heightAboveGround);
    const t0 = performance.now();
    const b = this.world.map.bounds;
    const m = RENDER_MARGIN;
    const vd = this.opts.viewDistance;
    const cs = this.cs;
    const cx0 = Math.floor(Math.max(b.minX - m, focus.x - vd) / cs);
    const cx1 = Math.floor(Math.min(b.maxX + m, focus.x + vd) / cs);
    const cz0 = Math.floor(Math.max(b.minZ - m, focus.z - vd) / cs);
    const cz1 = Math.floor(Math.min(b.maxZ + m, focus.z + vd) / cs);

    const wanted: { cx: number; cz: number; lod: number; d: number }[] = [];
    const keep = new Set<number>();
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const d = this.chunkDistance(cx, cz, focus);
        if (d > vd) continue;
        const k = key(cx, cz);
        keep.add(k);
        const lod = this.lodFor(d, this.meshes.get(k)?.lod);
        const cur = this.meshes.get(k);
        if (!cur || cur.lod !== lod) wanted.push({ cx, cz, lod, d });
      }
    }
    // Unload chunks out of range.
    for (const [k, c] of this.meshes) {
      if (!keep.has(k)) {
        this.disposeChunk(c);
        this.meshes.delete(k);
      }
    }
    wanted.sort((a, b2) => a.d - b2.d);
    let built = 0;
    // Always allow ~1 ms of progress so streaming never stalls.
    const deadline = Math.max(t0 + budgetMs, performance.now() + 1);
    for (const w of wanted) {
      if (built > 0 && performance.now() > deadline) break;
      // LOD0 needs the 1 m heightfield: generate it time-sliced, build the mesh when ready.
      if (w.lod === 0 && !this.world.heightfield.prepare(w.cx, w.cz, deadline))
        break;
      this.buildChunk(w.cx, w.cz, w.lod);
      built++;
    }
    this.pending = wanted.length - built;
    this.world.heightfield.tick();
    return this.pending === 0;
  }

  private chunkDistance(cx: number, cz: number, p: Vector3): number {
    const cs = this.cs;
    const dx = Math.max(cx * cs - p.x, 0, p.x - (cx + 1) * cs);
    const dz = Math.max(cz * cs - p.z, 0, p.z - (cz + 1) * cs);
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

  private buildChunk(cx: number, cz: number, lod: number): void {
    const k = key(cx, cz);
    const old = this.meshes.get(k);
    const geometry = this.buildGeometry(cx, cz, lod);
    if (old) {
      releaseGeometry(old.mesh.geometry);
      old.mesh.geometry = geometry;
      old.lod = lod;
      return;
    }
    const mesh = new Mesh(geometry, getTerrainMaterial());
    mesh.position.set(cx * this.cs, 0, cz * this.cs);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `terrain ${cx},${cz}`;
    this.group.add(mesh);
    this.meshes.set(k, { cx, cz, lod, mesh });
  }

  private buildGeometry(cx: number, cz: number, lod: number): BufferGeometry {
    const step = STEPS[lod];
    const n = CHUNK_CELLS / step + 1;
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
      this.sampleCoarse(cx, cz, step, n, pos, nor, spl);
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

  /** Coarse LOD: sample the generator directly (no heightfield cache). */
  private sampleCoarse(
    cx: number,
    cz: number,
    step: number,
    n: number,
    pos: Float32Array,
    nor: Float32Array,
    spl: Uint8Array,
  ): void {
    const d = step * this.world.heightfield.cell;
    const g = new TerrainGrid(
      this.world.gen,
      cx * this.cs,
      cz * this.cs,
      d,
      n,
      n,
    );
    g.heights(0, n + 2);
    g.vertices(0, n, pos, nor, spl);
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

  private disposeChunk(c: ChunkMesh): void {
    this.group.remove(c.mesh);
    releaseGeometry(c.mesh.geometry);
  }

  dispose(): void {
    for (const c of this.meshes.values()) this.disposeChunk(c);
    this.meshes.clear();
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

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
