import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
} from 'three';

/**
 * What never moves on a stage, baked once per stage from the terrain (the sun is fixed for a stage):
 *
 * - **R, B, hill shadows:** the shadow line, the lowest height (m over `baseY`) at a point that still sees the sun past
 *   the terrain towards it, and its penumbra (m). The sun's and the far shadow map cast the terrain too, but only from
 *   inside their boxes (~300 m), and a low sun's shadow of a ridge runs on for a kilometre; engine/world-shading.ts
 *   compares every fragment's own height with the line (a crown or a car over a shaded slope stands in the sun).
 * - **G, sky light:** the share of the sky (cosine-weighted) the surrounding terrain leaves in view: valleys, gullies
 *   and the foot of a slope get less sky light than a ridge.
 *
 * Built in the background (`step`, a time budget per frame: no long task), heights first, then rows of texels; it is
 * handed to the shaders when done and faded in (`strength`), so it never pops.
 */

/** Texel size (m), and the most texels a side (larger maps get coarser texels). */
const CELL = 8;
const MAX_SIDE = 1024;
/** Hills this far (m) past the map's bounds still shade it. */
const MARGIN = 600;
/** Hill-shadow march: the furthest occluder (m), each step this much longer than the last. */
const SUN_REACH = 2500;
const SUN_GROWTH = 1.12;
/** The line sits this far under the coarse terrain's (m): smooth slopes do not shade themselves. */
const LIFT = 2;
/** Penumbra (rad): the sun's disc plus the coarse heights' error; and its least width (m). */
const PENUMBRA = 0.03;
const MIN_WIDTH = 1.5;
/** Sky light: azimuths, reach (m) and step growth of the horizon search. */
const SKY_RAYS = 8;
const SKY_REACH = 320;
const SKY_GROWTH = 1.35;
/** Samples baked between time checks. */
const SLICE = 32;
/** No terrain towards the sun (the grid's edge): the line this far under the ground (m). */
const OPEN = 50;

export interface TerrainLightMap {
  x0: number;
  z0: number;
  invW: number;
  invD: number;
  /** Heights in the texture are over this (m): half floats keep their precision near 0. */
  baseY: number;
}

/** Linear interpolation inside a height grid (clamped at its edge). */
function sample(
  h: Float32Array,
  nx: number,
  nz: number,
  gx: number,
  gz: number,
): number {
  const x = Math.min(nx - 1.001, Math.max(0, gx));
  const z = Math.min(nz - 1.001, Math.max(0, gz));
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const k = j * nx + i;
  return (
    (h[k] * (1 - fx) + h[k + 1] * fx) * (1 - fz) +
    (h[k + nx] * (1 - fx) + h[k + nx + 1] * fx) * fz
  );
}

/**
 * The shadow line at a grid point: march towards the sun and keep the highest terrain over the sun ray, as the height a
 * point there must reach to see the sun (`[height, penumbra]`, m). `sx, sz` = the sun's
 * horizontal direction (unit), `tanEl` its elevation's tangent; distances in cells.
 */
export function shadowLine(
  h: Float32Array,
  nx: number,
  nz: number,
  gx: number,
  gz: number,
  sx: number,
  sz: number,
  tanEl: number,
  cell: number,
): [number, number] {
  let line = -Infinity;
  let at = 0;
  for (let t = 1.5; t * cell < SUN_REACH; t = t * SUN_GROWTH + 0.5) {
    const x = gx + sx * t;
    const z = gz + sz * t;
    if (x < 0 || z < 0 || x > nx - 1 || z > nz - 1) break;
    const d = t * cell;
    const y = sample(h, nx, nz, x, z) - d * tanEl;
    if (y > line) {
      line = y;
      at = d;
    }
  }
  if (line === -Infinity) return [sample(h, nx, nz, gx, gz) - OPEN, MIN_WIDTH];
  return [line - LIFT, Math.max(MIN_WIDTH, at * PENUMBRA)];
}

/** Sun reaching height `y` under a shadow line (0..1): what the shader does with the texture. */
export function sunAt(y: number, line: number, width: number): number {
  return Math.min(1, Math.max(0, (y - line) / width + 0.5));
}

/** Share of the sky the terrain round a grid point leaves in view (cosine-weighted: a horizon at a keeps cos^2 a). */
export function skyVisibility(
  h: Float32Array,
  nx: number,
  nz: number,
  gx: number,
  gz: number,
  cell: number,
): number {
  const h0 = sample(h, nx, nz, gx, gz) + LIFT;
  let sum = 0;
  for (let r = 0; r < SKY_RAYS; r++) {
    const a = (r / SKY_RAYS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let slope = 0;
    for (let t = 1; t * cell < SKY_REACH; t = t * SKY_GROWTH + 0.5)
      slope = Math.max(
        slope,
        (sample(h, nx, nz, gx + dx * t, gz + dz * t) - h0) / (t * cell),
      );
    sum += 1 / (1 + slope * slope);
  }
  return sum / SKY_RAYS;
}

export class TerrainLight {
  /** Null until baked. */
  texture: DataTexture | null = null;
  readonly map: TerrainLightMap;
  /** 0 -> 1 once baked (rally-game.ts fades it in; world-shading reads it). */
  strength = 0;
  private readonly cell: number;
  private readonly heights: Float32Array;
  private readonly hx: number;
  private readonly hz: number;
  /** Texels of the map (inside the margin of the height grid). */
  private readonly nx: number;
  private readonly nz: number;
  /** Line height, sky, penumbra per texel (half floats; 4th channel unused). */
  private readonly out: Uint16Array;
  /** Next sample to bake: the heights first, then the texels. */
  private next = 0;
  private lowest = Infinity;
  private readonly sx: number;
  private readonly sz: number;
  private readonly tanEl: number;

  constructor(
    private readonly height: (x: number, z: number) => number,
    private readonly bounds: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    },
    sunDir: { x: number; y: number; z: number },
  ) {
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    this.cell = Math.max(CELL, Math.ceil(Math.max(w, d) / MAX_SIDE));
    this.nx = Math.ceil(w / this.cell) + 1;
    this.nz = Math.ceil(d / this.cell) + 1;
    const m = Math.ceil(MARGIN / this.cell);
    this.hx = this.nx + 2 * m;
    this.hz = this.nz + 2 * m;
    this.heights = new Float32Array(this.hx * this.hz);
    this.out = new Uint16Array(this.nx * this.nz * 4);
    const flat = Math.hypot(sunDir.x, sunDir.z);
    this.sx = flat > 1e-6 ? sunDir.x / flat : 0;
    this.sz = flat > 1e-6 ? sunDir.z / flat : 0;
    this.tanEl = flat > 1e-6 ? sunDir.y / flat : 1e3;
    this.map = {
      x0: bounds.minX - this.cell / 2,
      z0: bounds.minZ - this.cell / 2,
      invW: 1 / (this.nx * this.cell),
      invD: 1 / (this.nz * this.cell),
      baseY: 0,
    };
  }

  get done(): boolean {
    return this.texture !== null;
  }

  /** Bake for up to `budgetMs` (checked every `SLICE` samples: a row takes ms); true when the texture was just made. */
  step(budgetMs: number): boolean {
    if (this.texture) return false;
    const t0 = performance.now();
    const m = (this.hx - this.nx) / 2;
    const c = this.cell;
    const heights = this.hx * this.hz;
    for (; this.next < heights; this.next++) {
      const i = this.next % this.hx;
      const j = (this.next - i) / this.hx;
      const y = this.height(
        this.bounds.minX + (i - m) * c,
        this.bounds.minZ + (j - m) * c,
      );
      this.heights[this.next] = y;
      this.lowest = Math.min(this.lowest, y);
      if (this.next % SLICE === 0 && performance.now() - t0 > budgetMs) {
        this.next++;
        return false;
      }
    }
    const baseY = (this.map.baseY = Math.floor(this.lowest));
    const half = DataUtils.toHalfFloat;
    const texels = this.nx * this.nz;
    for (; this.next < heights + texels; this.next++) {
      const n = this.next - heights;
      const i = n % this.nx;
      const gx = i + m;
      const gz = (n - i) / this.nx + m;
      const [line, width] = shadowLine(
        this.heights,
        this.hx,
        this.hz,
        gx,
        gz,
        this.sx,
        this.sz,
        this.tanEl,
        c,
      );
      this.out[n * 4] = half(line - baseY);
      this.out[n * 4 + 1] = half(
        skyVisibility(this.heights, this.hx, this.hz, gx, gz, c),
      );
      this.out[n * 4 + 2] = half(width);
      if (n % SLICE === 0 && performance.now() - t0 > budgetMs) {
        this.next++;
        return false;
      }
    }
    const t = new DataTexture(
      this.out,
      this.nx,
      this.nz,
      RGBAFormat,
      HalfFloatType,
    );
    t.minFilter = t.magFilter = LinearFilter;
    t.needsUpdate = true;
    this.texture = t;
    return true;
  }

  dispose(): void {
    this.texture?.dispose();
  }
}
