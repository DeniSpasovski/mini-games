/**
 * Terrain occlusion of trees (spec: trees/Performance.md#mitigations, trees/Drawing.md#culling), on the CPU: WebGL2
 * has no compute shaders or indirect draws for a GPU depth-pyramid cull, so the batching job (trees/draw.ts) leaves
 * out every tree a hill hides from EVERY camera position of its window (within `move` m of the job focus), using a
 * horizon map of the terrain built once per job. Conservative: a tree is only culled when the terrain blocks it with
 * room to spare for the camera moving `move` m in any direction, the tree's own size, terrain slopes up to SLOPE and
 * the coarse height grid; anything closer than the near distance is never culled.
 */

/** Steepest terrain slope (rise / run) the margins allow for between two samples. */
const SLOPE = 0.5;
/** How high the eye can rise over `move` m of travel: a road grade plus a jump / camera lag (m). */
const EYE_GRADE = 0.35;
const EYE_JUMP = 1;
/** Height grid cell (m) and the error margin of taking the lowest corner of a cell (m). */
const CELL = 8;
const GRID_ERROR = 2;
/** Azimuth rays of a horizon map. */
export const HORIZON_RAYS = 1024;
/** First sample distance (m) and the sample spacing: max(MIN_STEP, STEP_SHARE * distance). */
const FIRST = 12;
const MIN_STEP = 4;
const STEP_SHARE = 0.03;

/** Terrain heights on a lazily filled CELL grid: a sample is the lowest of its cell's 4 corners. */
export class HeightGrid {
  private data: Float32Array;
  private nx: number;
  private nz: number;

  constructor(
    private height: (x: number, z: number) => number,
    private bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 2;
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 2;
    this.data = new Float32Array(this.nx * this.nz).fill(NaN);
  }

  private corner(i: number, j: number): number {
    const k = j * this.nx + i;
    let h = this.data[k];
    if (h !== h)
      h = this.data[k] = this.height(
        this.bounds.minX + i * CELL,
        this.bounds.minZ + j * CELL,
      );
    return h;
  }

  /** A height at or below the terrain around (x, z) (-Infinity outside the map: blocks nothing). */
  low(x: number, z: number): number {
    const i = Math.floor((x - this.bounds.minX) / CELL);
    const j = Math.floor((z - this.bounds.minZ) / CELL);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1)
      return -Infinity;
    return Math.min(
      this.corner(i, j),
      this.corner(i + 1, j),
      this.corner(i, j + 1),
      this.corner(i + 1, j + 1),
    );
  }
}

/** Sample distances of a horizon ray, out to `maxD`. */
export function horizonDistances(maxD: number): Float32Array {
  const out: number[] = [];
  for (let d = FIRST; d < maxD; d += Math.max(MIN_STEP, STEP_SHARE * d))
    out.push(d);
  return new Float32Array(out);
}

/**
 * The horizon seen from `eye`: per azimuth bin and sample distance D, the highest "blocking slope"
 * (terrain - eye) / D over every sample up to D, already lowered by the margins for a camera anywhere within `move`.
 */
export class Horizon {
  readonly dist: Float32Array;
  /** rays x samples: running max of the lowered slope along each ray; then per bin (rays b, b + 1) the lower. */
  private ray: Float32Array;
  private bin: Float32Array;
  /** Sample index by whole metre: the last sample nearer than that distance (-1 = none). */
  private index: Int16Array;
  private built = 0;

  constructor(
    private grid: HeightGrid,
    readonly eye: { x: number; y: number; z: number },
    readonly move: number,
    maxD: number,
  ) {
    this.dist = horizonDistances(maxD);
    const n = this.dist.length;
    this.ray = new Float32Array(HORIZON_RAYS * n);
    this.bin = new Float32Array(HORIZON_RAYS * n);
    this.index = new Int16Array(Math.ceil(maxD) + 2);
    let k = -1;
    for (let m = 0; m < this.index.length; m++) {
      while (k + 1 < n && this.dist[k + 1] < m) k++;
      this.index[m] = k;
    }
  }

  /** Build `rays` more rays (time-slicing); true when the map is complete. */
  step(rays: number): boolean {
    const n = this.dist.length;
    const gap = (Math.PI * 2) / HORIZON_RAYS;
    const end = Math.min(HORIZON_RAYS, this.built + rays);
    const rise = this.move * EYE_GRADE + EYE_JUMP;
    for (let r = this.built; r < end; r++) {
      const a = r * gap;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      let best = -Infinity;
      for (let k = 0; k < n; k++) {
        const D = this.dist[k];
        const h = this.grid.low(this.eye.x + cx * D, this.eye.z + cz * D);
        // Eye up to `rise` higher and `move` aside, the ray passing up to half a bin aside: terrain up to SLOPE steep.
        const s =
          (h -
            this.eye.y -
            rise -
            this.move * SLOPE -
            GRID_ERROR -
            SLOPE * D * gap * 0.5) /
          D;
        if (s > best) best = s;
        this.ray[r * n + k] = best;
      }
    }
    this.built = end;
    if (end < HORIZON_RAYS) return false;
    for (let r = 0; r < HORIZON_RAYS; r++) {
      const r2 = (r + 1) % HORIZON_RAYS;
      for (let k = 0; k < n; k++)
        this.bin[r * n + k] = Math.min(
          this.ray[r * n + k],
          this.ray[r2 * n + k],
        );
    }
    return true;
  }

  get ready(): boolean {
    return this.built >= HORIZON_RAYS;
  }

  /**
   * Is a sphere (centre x, y, z, radius r) hidden behind the terrain from every eye within `move`? Its top plus the
   * slope margin of its own width must stay under the horizon of every bin it spans.
   */
  hides(x: number, y: number, z: number, r: number): boolean {
    if (!this.ready) return false;
    const dx = x - this.eye.x;
    const dz = z - this.eye.z;
    const d = Math.hypot(dx, dz);
    const reach = Math.floor(d - r - this.move);
    if (reach < FIRST || reach >= this.index.length) return false;
    const k = this.index[reach];
    if (k < 0) return false;
    const need = (y + r - this.eye.y + SLOPE * r) / d;
    const n = this.dist.length;
    const gap = (Math.PI * 2) / HORIZON_RAYS;
    const spread = Math.asin(Math.min(1, (r + this.move) / d));
    let a = Math.atan2(dz, dx);
    if (a < 0) a += Math.PI * 2;
    const b0 = Math.floor((a - spread) / gap);
    const b1 = Math.floor((a + spread) / gap);
    for (let b = b0; b <= b1; b++) {
      const bb = ((b % HORIZON_RAYS) + HORIZON_RAYS) % HORIZON_RAYS;
      if (this.bin[bb * n + k] <= need) return false;
    }
    return true;
  }
}
