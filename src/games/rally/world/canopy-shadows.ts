import {
  Box2,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  UnsignedByteType,
  Vector2,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { canopyOf, isVegetation } from './aerial-trees';
import type { ScatterChunk, ScatterInstance } from './scatter';
import type { World } from './world';

/** Metres per texel (coarsened for very large maps so a side stays <= MAX_SIDE). */
const RES = 3;
const MAX_SIDE = 2048;
/** Shadow density at the centre of one tree's shadow (several overlapping trees reach 1). */
const DENSITY = 0.75;
/** Scatter chunk keys looked at per `update()` (a cheap Map lookup each). */
const SCAN = 1500;
/** Time per `update()` for splatting new chunks (ms; at least one chunk). */
const SPLAT_BUDGET = 1;
/** Minimum time between texture uploads (ms). */
const UPLOAD_EVERY = 1500;
/**
 * The local window: a finer shadow texture (LOCAL_RES m per texel, LOCAL_N texels a side) that follows the camera,
 * so the road (5-6 m wide) gets readable tree shadows well past the sun's shadow map. Rebuilt from the scatter chunks
 * already generated after the camera moved LOCAL_MOVE m (or new chunks came in), in slices of LOCAL_BUDGET ms.
 */
const LOCAL_RES = 1.5;
const LOCAL_N = 512;
const LOCAL_MOVE = 64;
const LOCAL_BUDGET = 1.5;
/** Shadow density of one crown in the local window (overlaps add up to 1). */
const LOCAL_DENSITY = 0.85;
/** Leaf litter (the G channel): straight under the crown, out to this x its radius, this dense at the trunk. */
const LITTER_REACH = 1.35;
const LITTER_DENSITY = 0.9;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A crown's shadow into the local window grid (LOCAL_N a side, LOCAL_RES m, origin x0 / z0): an ellipse at sx / sz,
 * `ra` along the sun's azimuth (ax, az) and `r` across, solid with a soft rim. Plain numbers and typed arrays only:
 * as a method reading `this` it was deoptimised over and over and boxed a number per texel (~0.7 MB a frame).
 */
function splatEllipse(
  grid: Float32Array,
  x0: number,
  z0: number,
  sx: number,
  sz: number,
  r: number,
  ra: number,
  ax: number,
  az: number,
  density: number,
): void {
  const n = LOCAL_N;
  const res = LOCAL_RES;
  const reach = ra + res;
  const i0 = Math.max(0, Math.floor((sx - reach - x0) / res));
  const i1 = Math.min(n - 1, Math.ceil((sx + reach - x0) / res));
  const j0 = Math.max(0, Math.floor((sz - reach - z0) / res));
  const j1 = Math.min(n - 1, Math.ceil((sz + reach - z0) / res));
  for (let j = j0; j <= j1; j++) {
    const pz = z0 + (j + 0.5) * res - sz;
    for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * res - sx;
      const u = (px * ax + pz * az) / ra;
      const v = (-px * az + pz * ax) / r;
      const q = u * u + v * v;
      if (q >= 1) continue;
      const k = j * n + i;
      const t = Math.min(1, Math.max(0, (q - 0.55) / 0.45));
      grid[k] = Math.min(1, grid[k] + density * (1 - t * t * (3 - 2 * t)));
    }
  }
}

/** Leaf litter into the local window grid: a disc of radius `rl` at x / z, densest at the trunk (as `splatEllipse`). */
function splatDisc(
  grid: Float32Array,
  x0: number,
  z0: number,
  x: number,
  z: number,
  rl: number,
): void {
  const n = LOCAL_N;
  const res = LOCAL_RES;
  const i0 = Math.max(0, Math.floor((x - rl - x0) / res));
  const i1 = Math.min(n - 1, Math.ceil((x + rl - x0) / res));
  const j0 = Math.max(0, Math.floor((z - rl - z0) / res));
  const j1 = Math.min(n - 1, Math.ceil((z + rl - z0) / res));
  for (let j = j0; j <= j1; j++) {
    const pz = (z0 + (j + 0.5) * res - z) / rl;
    for (let i = i0; i <= i1; i++) {
      const px = (x0 + (i + 0.5) * res - x) / rl;
      const q = px * px + pz * pz;
      if (q >= 1) continue;
      const k = j * n + i;
      const t = Math.min(1, Math.max(0, (q - 0.3) / 0.7));
      grid[k] = Math.min(
        1,
        grid[k] + LITTER_DENSITY * (1 - t * t * (3 - 2 * t)),
      );
    }
  }
}

/**
 * Tree shadows on the ground BEYOND both shadow maps (the sun's and the far one, world/far-shadow.ts): every
 * vegetation instance is splatted into one top-down density texture over the map as a soft ellipse, moved away
 * from the sun by its canopy height and stretched along the sun's azimuth (low sun = long shadows). The world
 * shading (engine/world-shading.ts `setCanopyShadows`) dims the sun on ground materials with it, fading in where
 * the shadow maps stop covering - so forests read as forests out to 2000 m.
 *
 * Incremental and hitch-free: `update()` only takes scatter chunks the instance streamer has ALREADY generated
 * (generating one costs 50-200 ms) - i.e. everything within its draw distance - and uploads the changed rows at
 * most every 1.5 s while new chunks come in (`renderer` set; else the whole texture: ~8 MB, a 2-3 ms frame). The
 * texture exists from the first `update()` on (empty = no shadow).
 */
export class CanopyShadows {
  readonly texture: DataTexture;
  /** Uploads only the changed rows into `texture` when set (`copyTextureToTexture` from `rows`, the same bytes). */
  renderer: WebGLRenderer | null = null;
  private rows: DataTexture;
  private band = new Box2(new Vector2(), new Vector2());
  private bandAt = new Vector2();
  /** The local window texture and its ground mapping (x0, z0, 1 / width, 1 / depth), moved with the camera. */
  readonly local: DataTexture;
  readonly localMap = {
    x0: 0,
    z0: 0,
    invW: 1 / (LOCAL_N * LOCAL_RES),
    invD: 1 / (LOCAL_N * LOCAL_RES),
  };
  /** R = shadow, G = leaf litter under the crowns (`wsCanopyCover`). */
  private localData = new Uint8Array(LOCAL_N * LOCAL_N * 2);
  private localJob: Generator<void> | null = null;
  private localAt = { x: Infinity, z: Infinity };
  private localStale = true;
  /** x0, z0 (m) and 1 / width, 1 / depth (1/m) of the texture on the ground. */
  readonly map = { x0: 0, z0: 0, invW: 0, invD: 0 };
  private grid: Float32Array;
  private litter: Float32Array;
  /** R = shadow, G = leaf litter under the crowns (`wsCanopyCover`). */
  private data: Uint8Array;
  private nx: number;
  private nz: number;
  private res: number;
  /** Scatter chunks not splatted yet, as [cx, cz] pairs (swap-removed when done). */
  private todo: Int32Array;
  private todoCount: number;
  private cursor = 0;
  /** Rows changed since the last upload (-1 = none). */
  private dirtyMin = -1;
  private dirtyMax = -1;
  private lastUpload = -Infinity;
  // Sun projection (see constructor).
  private ox: number;
  private oz: number;
  private ax: number;
  private az: number;
  private stretch: number;
  /** cot of the sun's elevation: a crown's shadow is as long as sqrt(r^2 + (ry cot)^2) along the sun. */
  private cot: number;
  /** Local window tuning (crown radius factor, density): `__rally.canopy.tune`. */
  tune = { radius: 1, density: LOCAL_DENSITY };

  constructor(
    private world: World,
    sunDir: Vector3,
  ) {
    const b = world.map.bounds;
    const pad = 300;
    const x0 = b.minX - pad;
    const z0 = b.minZ - pad;
    const w = b.maxX - b.minX + 2 * pad;
    const d = b.maxZ - b.minZ + 2 * pad;
    this.res = Math.max(RES, w / MAX_SIDE, d / MAX_SIDE);
    this.nx = Math.ceil(w / this.res);
    this.nz = Math.ceil(d / this.res);
    this.grid = new Float32Array(this.nx * this.nz);
    this.litter = new Float32Array(this.nx * this.nz);
    this.data = new Uint8Array(this.nx * this.nz * 2);
    this.map.x0 = x0;
    this.map.z0 = z0;
    this.map.invW = 1 / (this.nx * this.res);
    this.map.invD = 1 / (this.nz * this.res);

    // Ground offset per metre of height (away from the sun) and the stretch along the sun's azimuth.
    const sy = Math.max(0.12, sunDir.y);
    this.ox = -sunDir.x / sy;
    this.oz = -sunDir.z / sy;
    const flat = Math.hypot(sunDir.x, sunDir.z) || 1;
    this.ax = sunDir.x / flat;
    this.az = sunDir.z / flat;
    this.stretch = Math.min(3, 1 / sy);
    this.cot = Math.min(4, Math.sqrt(Math.max(0, 1 - sy * sy)) / sy);

    const cs = world.scatter.chunkSize;
    const keys: number[] = [];
    for (let cz = Math.floor(z0 / cs); cz * cs <= z0 + d; cz++)
      for (let cx = Math.floor(x0 / cs); cx * cs <= x0 + w; cx++)
        keys.push(cx, cz);
    this.todo = Int32Array.from(keys);
    this.todoCount = keys.length / 2;

    const t = new DataTexture(
      this.data,
      this.nx,
      this.nz,
      RGFormat,
      UnsignedByteType,
    );
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.unpackAlignment = 2; // rows of 2 nx bytes
    t.name = 'canopy-shadows';
    t.needsUpdate = true;
    this.texture = t;
    this.rows = new DataTexture(
      this.data,
      this.nx,
      this.nz,
      RGFormat,
      UnsignedByteType,
    );
    this.rows.unpackAlignment = 2;
    const l = new DataTexture(
      this.localData,
      LOCAL_N,
      LOCAL_N,
      RGFormat,
      UnsignedByteType,
    );
    l.magFilter = LinearFilter;
    l.minFilter = LinearFilter;
    l.unpackAlignment = 2;
    l.name = 'canopy-shadows-local';
    l.needsUpdate = true;
    this.local = l;
  }

  /**
   * Splat newly generated scatter chunks; upload when due. Cheap (~0.1 ms) once everything near is in; splatting takes
   * at most `budget` ms (at least one chunk; loading passes Infinity).
   */
  update(
    now = performance.now(),
    focus?: { x: number; z: number },
    budget = SPLAT_BUDGET,
    localBudget = LOCAL_BUDGET,
  ): void {
    const scatter = this.world.scatter;
    const t0 = performance.now();
    for (let n = 0; n < SCAN && this.todoCount > 0; n++) {
      if (this.cursor >= this.todoCount) this.cursor = 0;
      const i = this.cursor * 2;
      const chunk = scatter.cachedChunk(this.todo[i], this.todo[i + 1]);
      if (!chunk) {
        this.cursor++;
        continue;
      }
      for (const inst of chunk.instances) {
        this.splat(inst);
        this.splatLitter(inst);
      }
      this.localStale = true;
      // Swap-remove: the last pending key takes this slot (looked at next).
      this.todoCount--;
      this.todo[i] = this.todo[this.todoCount * 2];
      this.todo[i + 1] = this.todo[this.todoCount * 2 + 1];
      // Many chunks can come in at once (a streamer rebuild): the rest wait for the next frames.
      if (performance.now() - t0 > budget) break;
    }
    if (focus) this.updateLocal(focus, now, localBudget);
    // The texels' bytes are written as they are splatted (converting the dirty rows here took ~10 ms every upload).
    if (this.dirtyMin >= 0 && now - this.lastUpload >= UPLOAD_EVERY) {
      if (this.renderer) {
        this.band.min.set(0, this.dirtyMin);
        this.band.max.set(this.nx, this.dirtyMax + 1);
        this.bandAt.set(0, this.dirtyMin);
        this.renderer.copyTextureToTexture(
          this.rows,
          this.texture,
          this.band,
          this.bandAt,
        );
      } else this.texture.needsUpdate = true;
      this.dirtyMin = this.dirtyMax = -1;
      this.lastUpload = now;
    }
  }

  /** Start / continue the local window rebuild (one slice per call). */
  private updateLocal(
    focus: { x: number; z: number },
    now: number,
    budget: number,
  ): void {
    if (!this.localJob) {
      const dx = focus.x - this.localAt.x;
      const dz = focus.z - this.localAt.z;
      const moved = dx * dx + dz * dz >= LOCAL_MOVE * LOCAL_MOVE;
      // New chunks only re-run it while the window still holds nothing (the first fill) or every few seconds.
      if (!moved && !(this.localStale && now - this.lastLocal > 3000)) return;
      this.localStale = false;
      this.lastLocal = now;
      this.localAt.x = focus.x;
      this.localAt.z = focus.z;
      this.localJob = this.localRebuild(focus.x, focus.z);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < budget)
      if (this.localJob.next().done) {
        this.localJob = null;
        break;
      }
  }

  private lastLocal = -Infinity;
  private localGrid?: Float32Array;
  private localLitter?: Float32Array;
  private localBytes?: Uint8Array;

  private *localRebuild(fx: number, fz: number): Generator<void> {
    const span = LOCAL_N * LOCAL_RES;
    // Texel-aligned so the shadows do not swim while the window moves.
    const x0 = Math.round((fx - span / 2) / LOCAL_RES) * LOCAL_RES;
    const z0 = Math.round((fz - span / 2) / LOCAL_RES) * LOCAL_RES;
    // Reused (one job at a time): a fresh 1 MB array every rebuild was garbage-collection pauses at speed.
    const grid = (this.localGrid ??= new Float32Array(LOCAL_N * LOCAL_N));
    const litter = (this.localLitter ??= new Float32Array(LOCAL_N * LOCAL_N));
    grid.fill(0);
    litter.fill(0);
    const cs = this.world.scatter.chunkSize;
    for (let cz = Math.floor(z0 / cs); cz * cs <= z0 + span; cz++) {
      for (let cx = Math.floor(x0 / cs); cx * cs <= x0 + span; cx++) {
        const chunk = this.world.scatter.cachedChunk(cx, cz);
        if (!chunk) continue;
        const v = this.localVegetation(chunk);
        for (let o = 0; o < v.length; o += 5)
          this.splatLocal(v, o, grid, litter, x0, z0);
        // Per chunk, not per row: a row of forest chunks overran the time slice.
        yield;
      }
    }
    // Into the texture's bytes in slices too (the upload below swaps the whole window at once).
    const bytes = (this.localBytes ??= new Uint8Array(LOCAL_N * LOCAL_N * 2));
    for (let row = 0; row < LOCAL_N; row += 64) {
      const end = (row + 64) * LOCAL_N;
      for (let k = row * LOCAL_N; k < end; k++) {
        bytes[k * 2] = Math.round(grid[k] * 255);
        bytes[k * 2 + 1] = Math.round(litter[k] * 255);
      }
      yield;
    }
    this.localData.set(bytes);
    this.localMap.x0 = x0;
    this.localMap.z0 = z0;
    this.local.needsUpdate = true;
  }

  /** Per scatter chunk: its vegetation as [x, z, crown radius, height, ry] (scaled), only the ones that splat. */
  private localVeg = new WeakMap<ScatterChunk, Float32Array>();

  /**
   * A chunk's vegetation for the local window, packed once: the window walks every instance of ~20 chunks each
   * rebuild, and reading them as objects (mixed shapes, an asset lookup each) boxed numbers by the thousand.
   */
  private localVegetation(chunk: ScatterChunk): Float32Array {
    let v = this.localVeg.get(chunk);
    if (v) return v;
    const out: number[] = [];
    for (const inst of chunk.instances) {
      if (!isVegetation(inst.asset)) continue;
      const c = canopyOf(inst.asset);
      const r = c.radius * inst.scale;
      // Too small for a shadow even at twice the radius tune, and for litter: skipped (as `splatLocal` would).
      if (r * 2 < 0.6 && r * LITTER_REACH < 1.2) continue;
      out.push(inst.x, inst.z, r, c.height * inst.scale, c.ry * inst.scale);
    }
    v = new Float32Array(out);
    this.localVeg.set(chunk, v);
    return v;
  }

  /**
   * One packed instance (`localVegetation`, from `o`) into the local window: its shadow (the crown's true ellipse
   * along the sun, solid profile) and its leaf litter - the maths of `splat` / `splatLitter` for the local grid.
   */
  private splatLocal(
    veg: Float32Array,
    o: number,
    grid: Float32Array,
    litter: Float32Array,
    x0: number,
    z0: number,
  ): void {
    const r = veg[o + 2] * this.tune.radius;
    if (r >= 0.6) {
      const h = veg[o + 3];
      splatEllipse(
        grid,
        x0,
        z0,
        veg[o] + this.ox * h,
        veg[o + 1] + this.oz * h,
        r,
        Math.min(r * 4, Math.hypot(r, veg[o + 4] * this.cot)),
        this.ax,
        this.az,
        this.tune.density,
      );
    }
    const rl = veg[o + 2] * LITTER_REACH;
    if (rl >= 1.2) splatDisc(litter, x0, z0, veg[o], veg[o + 1], rl);
  }

  private splat(
    inst: ScatterInstance,
    grid = this.grid,
    nx = this.nx,
    nz = this.nz,
    res = this.res,
    x0 = this.map.x0,
    z0 = this.map.z0,
    minRadius = 0.9,
  ): void {
    if (!isVegetation(inst.asset)) return;
    const c = canopyOf(inst.asset);
    const r =
      c.radius * inst.scale * (grid === this.grid ? 1 : this.tune.radius);
    // Skip bushes / grass: small shadows are lost at these texels anyway.
    if (r < minRadius) return;
    const global = grid === this.grid;
    const h = c.height * inst.scale;
    const sx = inst.x + this.ox * h;
    const sz = inst.z + this.oz * h;
    // Along the sun azimuth: the global map keeps one cheap stretch; the local window (the road) the crown's
    // true shadow ellipse, and a solid profile (a crown lets ~a third of the sun through, not the soft blob).
    const ra = global
      ? r * this.stretch
      : Math.min(r * 4, Math.hypot(r, c.ry * inst.scale * this.cot));
    const reach = ra + res;
    const i0 = Math.max(0, Math.floor((sx - reach - x0) / res));
    const i1 = Math.min(nx - 1, Math.ceil((sx + reach - x0) / res));
    const j0 = Math.max(0, Math.floor((sz - reach - z0) / res));
    const j1 = Math.min(nz - 1, Math.ceil((sz + reach - z0) / res));
    if (i0 > i1 || j0 > j1) return;
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * res - sz;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * res - sx;
        // Ellipse coordinates: along / across the sun azimuth.
        const u = (px * this.ax + pz * this.az) / ra;
        const v = (-px * this.az + pz * this.ax) / r;
        const q = u * u + v * v;
        if (q >= 1) continue;
        const k = j * nx + i;
        grid[k] = Math.min(
          1,
          grid[k] +
            (global
              ? DENSITY * (1 - q) * (1 - q)
              : this.tune.density * (1 - smooth(0.55, 1, q))),
        );
        if (global) this.data[k * 2] = Math.round(grid[k] * 255);
      }
    }
    if (!global) return;
    this.dirtyMin = this.dirtyMin < 0 ? j0 : Math.min(this.dirtyMin, j0);
    this.dirtyMax = Math.max(this.dirtyMax, j1);
  }

  /**
   * Leaf litter: a round patch straight under the crown (not moved with the sun like the shadow), densest at the trunk.
   * Global rows touched are marked dirty by `splat` of the same instance (its shadow covers the crown at noon too).
   */
  private splatLitter(
    inst: ScatterInstance,
    grid = this.litter,
    nx = this.nx,
    nz = this.nz,
    res = this.res,
    x0 = this.map.x0,
    z0 = this.map.z0,
  ): void {
    if (!isVegetation(inst.asset)) return;
    const r = canopyOf(inst.asset).radius * inst.scale * LITTER_REACH;
    // Trees only: bushes drop too little to show.
    if (r < 1.2) return;
    const i0 = Math.max(0, Math.floor((inst.x - r - x0) / res));
    const i1 = Math.min(nx - 1, Math.ceil((inst.x + r - x0) / res));
    const j0 = Math.max(0, Math.floor((inst.z - r - z0) / res));
    const j1 = Math.min(nz - 1, Math.ceil((inst.z + r - z0) / res));
    if (i0 > i1 || j0 > j1) return;
    for (let j = j0; j <= j1; j++) {
      const pz = (z0 + (j + 0.5) * res - inst.z) / r;
      for (let i = i0; i <= i1; i++) {
        const px = (x0 + (i + 0.5) * res - inst.x) / r;
        const q = px * px + pz * pz;
        if (q >= 1) continue;
        const k = j * nx + i;
        grid[k] = Math.min(
          1,
          grid[k] + LITTER_DENSITY * (1 - smooth(0.3, 1, q)),
        );
        if (grid === this.litter)
          this.data[k * 2 + 1] = Math.round(grid[k] * 255);
      }
    }
    if (grid !== this.litter) return;
    this.dirtyMin = this.dirtyMin < 0 ? j0 : Math.min(this.dirtyMin, j0);
    this.dirtyMax = Math.max(this.dirtyMax, j1);
  }

  dispose(): void {
    this.texture.dispose();
    this.local.dispose();
  }
}
