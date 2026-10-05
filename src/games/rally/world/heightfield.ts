import { Vector3 } from 'three';
import type { TerrainGenerator } from './terrain-gen';

/**
 * Chunked, lazily generated, LRU-cached height grid (1 m cells by default).
 *
 * This is THE ground truth shared by physics and rendering: terrain meshes
 * are built from these exact samples with the same triangle split, so wheels
 * never float or sink relative to what you see (at LOD 0).
 *
 * Grid triangle split (per cell, local fx,fz in [0,1)):
 *   fx > fz : triangle (00, 10, 11)      else : (00, 01, 11)
 */
export const CHUNK_CELLS = 64;

/** Anything that can answer height / normal queries (cached heightfield or analytic generator). */
export interface TerrainSampler {
  readonly chunkSize: number;
  height(x: number, z: number): number;
  normal(x: number, z: number, out: Vector3): Vector3;
}

/**
 * Uncached sampler straight from the generator. Used for placement work that
 * spans the whole map (scatter, road-side props, road mesh) so the 1 m
 * physics heightfield is only ever built near the car.
 */
export class AnalyticTerrain implements TerrainSampler {
  readonly chunkSize = CHUNK_CELLS;
  constructor(private gen: TerrainGenerator) {}
  /** Top surface: includes the deck of a stage-road bridge (the heightfield is the ground beneath it). */
  height(x: number, z: number): number {
    return this.gen.surfaceHeight(x, z);
  }
  /** Same central-difference normal as the heightfield (1 m spacing). */
  normal(x: number, z: number, out: Vector3): Vector3 {
    const g = this.gen;
    return out
      .set(
        g.surfaceHeight(x - 1, z) - g.surfaceHeight(x + 1, z),
        2,
        g.surfaceHeight(x, z - 1) - g.surfaceHeight(x, z + 1),
      )
      .normalize();
  }
}

/**
 * Uncached sampler of the GROUND (no stage-road deck): for things that lie on the land even where a stage-road
 * bridge passes over them - the ribbons, sidewalks and crossings of the streets under it (the analytic sampler
 * put them on the deck: the street climbed up to the bridge and back down).
 */
export class GroundTerrain implements TerrainSampler {
  readonly chunkSize = CHUNK_CELLS;
  constructor(private gen: TerrainGenerator) {}
  height(x: number, z: number): number {
    return this.gen.height(x, z);
  }
  normal(x: number, z: number, out: Vector3): Vector3 {
    const g = this.gen;
    return out
      .set(
        g.height(x - 1, z) - g.height(x + 1, z),
        2,
        g.height(x, z - 1) - g.height(x, z + 1),
      )
      .normalize();
  }
}

export class HeightChunk {
  /** (N+3)^2 heights, includes a 1-sample border for normals. */
  readonly heights: Float32Array;
  /** (N+1)^2 xyz normals. */
  readonly normals: Float32Array;
  /** (N+1)^2 RGBA splat weights 0..255 [grass, dirt, rock, gravel]. */
  readonly splat: Uint8Array;
  lastUsed = 0;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly cell: number,
  ) {
    const n = CHUNK_CELLS;
    this.heights = new Float32Array((n + 3) * (n + 3));
    this.normals = new Float32Array((n + 1) * (n + 1) * 3);
    this.splat = new Uint8Array((n + 1) * (n + 1) * 4);
  }

  /** Height at grid vertex (i, j), i/j in [-1, N+1]. */
  h(i: number, j: number): number {
    return this.heights[(j + 1) * (CHUNK_CELLS + 3) + (i + 1)];
  }
}

export class Heightfield implements TerrainSampler {
  readonly chunkSize: number;
  private chunks = new Map<number, HeightChunk>();
  private frame = 0;
  private tmpSplat = new Float32Array(4);
  /** Number of chunks generated so far (for stats). */
  generated = 0;

  constructor(
    readonly gen: TerrainGenerator,
    readonly cell = 1,
    readonly maxChunks = 900,
  ) {
    this.chunkSize = CHUNK_CELLS * cell;
  }

  get cachedChunks(): number {
    return this.chunks.size;
  }

  /** Call once per frame so LRU eviction knows what is recent. */
  tick(): void {
    this.frame++;
    if (this.chunks.size > this.maxChunks) this.evict();
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(key(cx, cz));
  }

  /** Synchronous access (physics). Finishes / performs generation if needed. */
  chunk(cx: number, cz: number): HeightChunk {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      const job = this.pending.get(k) ?? this.steps(cx, cz);
      let r = job.next();
      while (!r.done) r = job.next();
      c = r.value;
      this.pending.delete(k);
      this.chunks.set(k, c);
    }
    c.lastUsed = this.frame;
    return c;
  }

  /**
   * Time-sliced generation for streaming: advances the chunk's generation
   * (row by row) until it is done or `deadline` (performance.now()) passes.
   * Returns true when the chunk is ready.
   */
  prepare(cx: number, cz: number, deadline: number): boolean {
    const k = key(cx, cz);
    if (this.chunks.has(k)) return true;
    let job = this.pending.get(k);
    if (!job) this.pending.set(k, (job = this.steps(cx, cz)));
    while (performance.now() < deadline) {
      const r = job.next();
      if (r.done) {
        this.pending.delete(k);
        r.value.lastUsed = this.frame;
        this.chunks.set(k, r.value);
        return true;
      }
    }
    return false;
  }

  private pending = new Map<number, Generator<void, HeightChunk>>();

  /** Chunk generation as a generator: yields after every row. */
  private *steps(cx: number, cz: number): Generator<void, HeightChunk> {
    const n = CHUNK_CELLS;
    const cell = this.cell;
    const c = new HeightChunk(cx, cz, cell);
    const x0 = cx * this.chunkSize;
    const z0 = cz * this.chunkSize;
    const gen = this.gen;
    // Per-job scratch (several chunks can be in progress at once).
    const roadDist = new Float32Array((n + 1) * (n + 1));
    const roadHw = new Float32Array((n + 1) * (n + 1));
    let p = 0;
    let r = 0;
    for (let j = -1; j <= n + 1; j++) {
      for (let i = -1; i <= n + 1; i++) {
        c.heights[p++] = gen.height(x0 + i * cell, z0 + j * cell);
        if (i >= 0 && j >= 0 && i <= n && j <= n) {
          const q = gen.lastRoad;
          roadDist[r] = q.found ? q.distance : Infinity;
          roadHw[r++] = q.halfWidth;
        }
      }
      yield;
    }
    const sp = this.tmpSplat;
    let ni = 0;
    let si = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const dx = c.h(i - 1, j) - c.h(i + 1, j);
        const dz = c.h(i, j - 1) - c.h(i, j + 1);
        const len = Math.hypot(dx, 2 * cell, dz);
        const ny = (2 * cell) / len;
        c.normals[ni++] = dx / len;
        c.normals[ni++] = ny;
        c.normals[ni++] = dz / len;
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        gen.splat(x, z, 1 - ny, roadDist[si >> 2], roadHw[si >> 2], sp);
        c.splat[si++] = Math.round(sp[0] * 255);
        c.splat[si++] = Math.round(sp[1] * 255);
        c.splat[si++] = Math.round(sp[2] * 255);
        c.splat[si++] = Math.round(sp[3] * 255);
      }
      yield;
    }
    this.generated++;
    return c;
  }

  private evict(): void {
    const sorted = [...this.chunks.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );
    const drop = this.chunks.size - Math.floor(this.maxChunks * 0.8);
    for (let i = 0; i < drop; i++) this.chunks.delete(sorted[i][0]);
  }

  /** Height matching the rendered LOD0 triangles. */
  height(x: number, z: number): number {
    const cs = this.chunkSize;
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    const c = this.chunk(cx, cz);
    const lx = (x - cx * cs) / this.cell;
    const lz = (z - cz * cs) / this.cell;
    const i = Math.min(CHUNK_CELLS - 1, Math.floor(lx));
    const j = Math.min(CHUNK_CELLS - 1, Math.floor(lz));
    const fx = lx - i;
    const fz = lz - j;
    const h00 = c.h(i, j);
    const h11 = c.h(i + 1, j + 1);
    if (fx > fz) {
      const h10 = c.h(i + 1, j);
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    const h01 = c.h(i, j + 1);
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Smooth (bilinear) normal. */
  normal(x: number, z: number, out: Vector3): Vector3 {
    const cs = this.chunkSize;
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    const c = this.chunk(cx, cz);
    const lx = (x - cx * cs) / this.cell;
    const lz = (z - cz * cs) / this.cell;
    const i = Math.min(CHUNK_CELLS - 1, Math.floor(lx));
    const j = Math.min(CHUNK_CELLS - 1, Math.floor(lz));
    const fx = lx - i;
    const fz = lz - j;
    const row = CHUNK_CELLS + 1;
    const n = c.normals;
    const a = (j * row + i) * 3;
    const b = a + 3;
    const d = a + row * 3;
    const e = d + 3;
    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;
    out.set(
      n[a] * w00 + n[b] * w10 + n[d] * w01 + n[e] * w11,
      n[a + 1] * w00 + n[b + 1] * w10 + n[d + 1] * w01 + n[e + 1] * w11,
      n[a + 2] * w00 + n[b + 2] * w10 + n[d + 2] * w01 + n[e + 2] * w11,
    );
    return out.normalize();
  }

  /** Splat weights (0..1) at the nearest grid vertex. */
  splatAt(x: number, z: number, out: Float32Array | number[]): void {
    const cs = this.chunkSize;
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    const c = this.chunk(cx, cz);
    const i = Math.round((x - cx * cs) / this.cell);
    const j = Math.round((z - cz * cs) / this.cell);
    const o = (j * (CHUNK_CELLS + 1) + i) * 4;
    for (let k = 0; k < 4; k++) out[k] = c.splat[o + k] / 255;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
