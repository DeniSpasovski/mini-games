import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  UnsignedByteType,
  type Vector3,
} from 'three';
import { getAssetMeta } from '../assets/catalog';
import { canopyOf } from './aerial-trees';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/** Metres per texel (coarsened for very large maps so a side stays <= MAX_SIDE). */
const RES = 3;
const MAX_SIDE = 2048;
/** Shadow density at the centre of one tree's shadow (several overlapping trees reach 1). */
const DENSITY = 0.75;
/** Scatter chunk keys looked at per `update()` (a cheap Map lookup each). */
const SCAN = 1500;
/** Minimum time between texture uploads (ms). */
const UPLOAD_EVERY = 1500;

/**
 * Tree shadows on the ground BEYOND the sun's shadow map (which only covers ~50-75 m around the car): every
 * vegetation instance is splatted into one top-down density texture over the map as a soft ellipse, moved away
 * from the sun by its canopy height and stretched along the sun's azimuth (low sun = long shadows). The world
 * shading (engine/world-shading.ts `setCanopyShadows`) dims the sun on ground materials with it, fading in where
 * the real shadow box ends - so forests read as forests at 100-2000 m.
 *
 * Incremental and hitch-free: `update()` only takes scatter chunks the instance streamer has ALREADY generated
 * (generating one costs 50-200 ms) - i.e. everything within its draw distance - and re-uploads the texture at
 * most every 1.5 s while new chunks come in. The texture exists from the first `update()` on (empty = no shadow).
 */
export class CanopyShadows {
  readonly texture: DataTexture;
  /** x0, z0 (m) and 1 / width, 1 / depth (1/m) of the texture on the ground. */
  readonly map = { x0: 0, z0: 0, invW: 0, invD: 0 };
  private grid: Float32Array;
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
    this.data = new Uint8Array(this.nx * this.nz);
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
      RedFormat,
      UnsignedByteType,
    );
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.unpackAlignment = 1; // rows of nx bytes
    t.name = 'canopy-shadows';
    t.needsUpdate = true;
    this.texture = t;
  }

  /** Splat newly generated scatter chunks; upload when due. Cheap (~0.1 ms) once everything near is in. */
  update(now = performance.now()): void {
    const scatter = this.world.scatter;
    for (let n = 0; n < SCAN && this.todoCount > 0; n++) {
      if (this.cursor >= this.todoCount) this.cursor = 0;
      const i = this.cursor * 2;
      const chunk = scatter.cachedChunk(this.todo[i], this.todo[i + 1]);
      if (!chunk) {
        this.cursor++;
        continue;
      }
      for (const inst of chunk.instances) this.splat(inst);
      // Swap-remove: the last pending key takes this slot (looked at next).
      this.todoCount--;
      this.todo[i] = this.todo[this.todoCount * 2];
      this.todo[i + 1] = this.todo[this.todoCount * 2 + 1];
    }
    if (this.dirtyMin >= 0 && now - this.lastUpload >= UPLOAD_EVERY) {
      const a = this.dirtyMin * this.nx;
      const b = (this.dirtyMax + 1) * this.nx;
      for (let k = a; k < b; k++) this.data[k] = Math.round(this.grid[k] * 255);
      this.texture.needsUpdate = true;
      this.dirtyMin = this.dirtyMax = -1;
      this.lastUpload = now;
    }
  }

  private splat(inst: ScatterInstance): void {
    if (getAssetMeta(inst.asset).category !== 'vegetation') return;
    const c = canopyOf(inst.asset);
    const r = c.radius * inst.scale;
    // Skip bushes / grass: small shadows are lost at 3 m texels anyway.
    if (r < 0.9) return;
    const { nx, nz, res, grid } = this;
    const { x0, z0 } = this.map;
    const h = c.height * inst.scale;
    const sx = inst.x + this.ox * h;
    const sz = inst.z + this.oz * h;
    const ra = r * this.stretch; // along the sun azimuth
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
        grid[k] = Math.min(1, grid[k] + DENSITY * (1 - q) * (1 - q));
      }
    }
    this.dirtyMin = this.dirtyMin < 0 ? j0 : Math.min(this.dirtyMin, j0);
    this.dirtyMax = Math.max(this.dirtyMax, j1);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
