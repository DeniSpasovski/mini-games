import type { BufferGeometry, Mesh, WebGLRenderer } from 'three';

/**
 * Tree cost counters (spec: trees/Performance.md#counters): what the tree passes drew last frame, the GPU time of
 * the tree main pass and the tree shadow pass on their own, the CPU time of level selection, and what loading the
 * variants cost. Filled by trees/draw.ts and trees/load.ts, shown by trees/overlay.ts and the benchmark.
 */

export interface TreeFrameStats {
  /** Trees drawn settled at LOD0, LOD1, the impostor and trees in a fade (main pass). */
  levels: [number, number, number];
  fading: number;
  /** Foliage sprites drawn (main pass; before the shader's thinning). */
  sprites: number;
  /** Trees re-selected this frame (trees/Lod.md#active-set), trees drawn from static batches, cells checked. */
  active: number;
  statics: number;
  cellsChecked: number;
  /** Trees the batching job left out this frame as hidden behind the terrain (trees/occlusion.ts). */
  occluded: number;
  /** Frame stability (trees/Performance.md#frame-stability): instance buffer (re)allocations, bytes uploaded, static
   * batches re-packed for the view, a batching job committed this frame. */
  allocs: number;
  uploadBytes: number;
  repacks: number;
  commit: boolean;
  /** Draw calls and triangles submitted by the tree meshes: main pass and shadow pass. */
  mainDraws: number;
  mainTriangles: number;
  shadowDraws: number;
  shadowTriangles: number;
  /** CPU ms: per-frame level selection + fade updates (active trees), and the time-sliced batching job. */
  selectMs: number;
  jobMs: number;
  /** GPU ms of the tree draws, main and shadow pass (smoothed over the last frames whose timings came back); NaN = no timer. */
  gpuMainMs: number;
  gpuShadowMs: number;
}

export function emptyFrameStats(): TreeFrameStats {
  return {
    levels: [0, 0, 0],
    fading: 0,
    sprites: 0,
    active: 0,
    statics: 0,
    cellsChecked: 0,
    occluded: 0,
    allocs: 0,
    uploadBytes: 0,
    repacks: 0,
    commit: false,
    mainDraws: 0,
    mainTriangles: 0,
    shadowDraws: 0,
    shadowTriangles: 0,
    selectMs: 0,
    jobMs: 0,
    gpuMainMs: NaN,
    gpuShadowMs: NaN,
  };
}

export interface TreeLoadStats {
  variants: number;
  /** Variants read from the disk cache (the rest were generated). */
  cached: number;
  /** ms spent deriving + meshing (summed over the worker's variants) and baking impostors. */
  generateMs: number;
  bakeMs: number;
  /** Wall time of the whole tree load (ms). */
  totalMs: number;
  /** Bytes of the variants on the GPU (geometry + impostor atlases with mips + leaf / bark textures) and on disk. */
  gpuBytes: number;
  diskBytes: number;
}

/** Triangles a mesh draws now (instances x index count / 3). */
export function meshTriangles(mesh: Mesh): number {
  const g = mesh.geometry as BufferGeometry;
  const n = Math.min(
    g.drawRange.count,
    g.index ? g.index.count : g.getAttribute('position').count,
  );
  return (n / 3) * ((mesh as Mesh & { count?: number }).count ?? 1);
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/**
 * GPU time of the tree draws with WebGL2 timer queries (EXT_disjoint_timer_query_webgl2): one query around each
 * tree draw (main and shadow, `begin` / `end` from the meshes' render hooks), results read back a few frames later
 * and summed per frame. Only runs while `enabled` (the queries cost a little themselves).
 */
export class TreeGpuTimer {
  enabled = false;
  private gl: WebGL2RenderingContext;
  private ext: TimerExt | null;
  private pool: WebGLQuery[] = [];
  private pending: { q: WebGLQuery; frame: number; shadow: boolean }[] = [];
  private open: WebGLQuery | null = null;
  private frame = 0;
  private sums = new Map<
    number,
    { main: number; shadow: number; left: number }
  >();
  /** Smoothed ms per frame. */
  mainMs = NaN;
  shadowMs = NaN;

  constructor(renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as TimerExt | null;
  }

  get available(): boolean {
    return !!this.ext;
  }

  begin(shadow: boolean): void {
    if (!this.enabled || !this.ext || this.open) return;
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = q;
    this.pending.push({ q, frame: this.frame, shadow });
    const s = this.sums.get(this.frame) ?? { main: 0, shadow: 0, left: 0 };
    s.left++;
    this.sums.set(this.frame, s);
  }

  end(): void {
    if (!this.open || !this.ext) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.open = null;
  }

  /** Call once per frame after rendering: collects finished queries. */
  endFrame(): void {
    this.frame++;
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.pool.push(p.q);
      const s = this.sums.get(p.frame);
      if (!s) continue;
      if (p.shadow) s.shadow += ns / 1e6;
      else s.main += ns / 1e6;
      if (--s.left === 0) {
        this.sums.delete(p.frame);
        if (disjoint) continue;
        const k = 0.1;
        this.mainMs = Number.isNaN(this.mainMs)
          ? s.main
          : this.mainMs + (s.main - this.mainMs) * k;
        this.shadowMs = Number.isNaN(this.shadowMs)
          ? s.shadow
          : this.shadowMs + (s.shadow - this.shadowMs) * k;
        this.samples.push(s.main + s.shadow);
        this.mainSamples.push(s.main);
        this.shadowSamples.push(s.shadow);
      }
    }
    // Frames that drew no trees.
    if (!this.sums.has(this.frame - 1) && this.enabled) this.samples.push(0);
  }

  /** Per-frame tree GPU ms (main + shadow, and each pass) since the last `takeSamples` (the benchmark). */
  private samples: number[] = [];
  private mainSamples: number[] = [];
  private shadowSamples: number[] = [];
  takeSamples(): number[] {
    const s = this.samples;
    this.samples = [];
    return s;
  }

  takePassSamples(): { main: number[]; shadow: number[] } {
    const r = { main: this.mainSamples, shadow: this.shadowSamples };
    this.mainSamples = [];
    this.shadowSamples = [];
    return r;
  }
}
