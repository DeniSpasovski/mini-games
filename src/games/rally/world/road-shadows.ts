import {
  DataArrayTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type Vector3,
} from 'three';
import { Noise2D } from '../../../shared/noise';
import { canopyOf, isVegetation } from './aerial-trees';
import { nearestRoadPoint } from './road-distance';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/** Ground size of one tile (m), its texel size (m) and the apron (texels) that makes bilinear reads seamless. */
const TILE = 16;
const RES = 0.5;
const CORE = TILE / RES;
const APRON = 1;
const TEX = CORE + 2 * APRON;
/** Tiles within this distance of the stage road are baked (m): the road plus its verges. */
const NEAR_ROAD = 10;
/** How far a tree's shadow can fall onto a tile (m): trees this far outside it are splatted too. */
const REACH = 42;
const MAX_LAYERS = 400;
/** Tiles are kept from this far behind the car to this far ahead (m of road). */
const BEHIND = 150;
const AHEAD = 700;
/** CPU time per `update()` (ms). */
const BUDGET = 2;
/** Shadow density at the heart of one crown (overlaps add up to 1). */
const DENSITY = 0.95;

/**
 * Tree shadows of the MAIN ROAD, pre-baked: the ground within `NEAR_ROAD` of the stage road is cut into 16 m tiles
 * of 0.5 m texels (one layer of an array texture each; a small index texture maps a ground cell to its layer). A
 * tile is splatted once, from the scatter chunks around it, when they have all been generated, nearest ahead of the
 * car first (up to 700 m ahead); it then stays until the car is 150 m past it, so the road keeps crisp, leafy shadow
 * shapes far ahead and nothing rebuilds or fades while driving. The world shading (engine/world-shading.ts `setRoadShadows`) prefers a tile over the
 * canopy window and the coarse map, outside the sun's shadow-map reach like them.
 */
export class RoadShadows {
  readonly tiles: DataArrayTexture;
  readonly index: DataTexture;
  /** x0, z0 (m), 1 / TILE (1/m), grid width (cells) of the index. */
  readonly map = { x0: 0, z0: 0, invTile: 1 / TILE, w: 0 };
  private data = new Uint8Array(TEX * TEX * MAX_LAYERS);
  private indexData: Float32Array;
  private w: number;
  private h: number;
  private free: number[] = [];
  private baked: { cell: number; along: number; layer: number }[] = [];
  /** Cells to bake, as grid indices, and the road distance each lies at (for the ahead-first order). */
  private todo: { cell: number; along: number }[] = [];
  private noise: Noise2D;
  private sx: number;
  private sz: number;
  private ax: number;
  private az: number;
  private cot: number;

  constructor(
    private world: World,
    sunDir: Vector3,
  ) {
    const b = world.map.bounds;
    const x0 = Math.floor((b.minX - 40) / TILE) * TILE;
    const z0 = Math.floor((b.minZ - 40) / TILE) * TILE;
    this.w = Math.ceil((b.maxX + 40 - x0) / TILE);
    this.h = Math.ceil((b.maxZ + 40 - z0) / TILE);
    this.map.x0 = x0;
    this.map.z0 = z0;
    this.map.w = this.w;
    this.indexData = new Float32Array(this.w * this.h);
    this.noise = new Noise2D(0x5ad0);
    // Ground offset per metre of height (away from the sun) and the sun's azimuth, as in CanopyShadows.
    const sy = Math.max(0.12, sunDir.y);
    this.sx = -sunDir.x / sy;
    this.sz = -sunDir.z / sy;
    const flat = Math.hypot(sunDir.x, sunDir.z) || 1;
    this.ax = sunDir.x / flat;
    this.az = sunDir.z / flat;
    this.cot = Math.min(4, Math.sqrt(Math.max(0, 1 - sy * sy)) / sy);

    // The cells near the stage road, with the road distance of the nearest sample.
    const road = world.stageRoad;
    const near = nearestRoadPoint(road, 8);
    const seen = new Set<number>();
    for (let d = 0; d <= road.length; d += 8) {
      const p = road.at(d);
      const r = NEAR_ROAD + TILE * 0.71;
      const cx0 = Math.floor((p.x - r - x0) / TILE);
      const cx1 = Math.floor((p.x + r - x0) / TILE);
      const cz0 = Math.floor((p.z - r - z0) / TILE);
      const cz1 = Math.floor((p.z + r - z0) / TILE);
      for (let cz = cz0; cz <= cz1; cz++)
        for (let cx = cx0; cx <= cx1; cx++) {
          if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
          const cell = cz * this.w + cx;
          if (seen.has(cell)) continue;
          const mx = x0 + (cx + 0.5) * TILE;
          const mz = z0 + (cz + 0.5) * TILE;
          if (near(mx, mz).d > NEAR_ROAD + TILE * 0.71) continue;
          seen.add(cell);
          this.todo.push({ cell, along: d });
        }
    }

    for (let l = MAX_LAYERS - 1; l >= 0; l--) this.free.push(l);
    const t = new DataArrayTexture(this.data, TEX, TEX, MAX_LAYERS);
    t.format = RedFormat;
    t.type = UnsignedByteType;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.unpackAlignment = 1;
    t.name = 'road-shadow-tiles';
    this.tiles = t;
    const i = new DataTexture(
      this.indexData,
      this.w,
      this.h,
      RedFormat,
      FloatType,
    );
    i.magFilter = NearestFilter;
    i.minFilter = NearestFilter;
    i.name = 'road-shadow-index';
    i.needsUpdate = true;
    this.index = i;
  }

  /** Tiles baked now / waiting to be baked (debug). */
  get progress(): { baked: number; total: number } {
    return {
      baked: this.baked.length,
      total: this.baked.length + this.todo.length,
    };
  }

  /**
   * Bake what can be baked within the budget: the pending tile nearest ahead of `along` (m on the stage road) within
   * `AHEAD`, whose surrounding chunks are all generated. Tiles more than `BEHIND` behind give their layer back.
   */
  update(along: number, now = performance.now()): void {
    let changed = false;
    for (let k = this.baked.length - 1; k >= 0; k--) {
      const t = this.baked[k];
      if (t.along >= along - BEHIND && t.along <= along + AHEAD + TILE)
        continue;
      this.baked.splice(k, 1);
      this.indexData[t.cell] = 0;
      this.free.push(t.layer);
      this.todo.push({ cell: t.cell, along: t.along });
      changed = true;
    }
    const t0 = now;
    while (this.free.length && performance.now() - t0 < BUDGET) {
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < this.todo.length; k++) {
        const d = this.todo[k].along - along;
        if (d < -BEHIND || d > AHEAD || d >= bestD) continue;
        if (this.ready(this.todo[k].cell)) [best, bestD] = [k, d];
      }
      if (best < 0) break;
      const [job] = this.todo.splice(best, 1);
      const layer = this.free.pop()!;
      this.bake(job.cell, layer);
      // Upload just this layer.
      this.tiles.addLayerUpdate(layer);
      this.tiles.needsUpdate = true;
      this.indexData[job.cell] = layer + 1;
      this.baked.push({ ...job, layer });
      changed = true;
    }
    if (changed) this.index.needsUpdate = true;
  }

  /** Every scatter chunk a tile reads is generated (never generates one: that would hitch). */
  private ready(cell: number): boolean {
    const { cx0, cx1, cz0, cz1 } = this.chunkRange(cell);
    const sc = this.world.scatter;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (!sc.cachedChunk(cx, cz)) return false;
    return true;
  }

  private chunkRange(cell: number): {
    cx0: number;
    cx1: number;
    cz0: number;
    cz1: number;
  } {
    const cs = this.world.scatter.chunkSize;
    const tx = this.map.x0 + (cell % this.w) * TILE;
    const tz = this.map.z0 + Math.floor(cell / this.w) * TILE;
    return {
      cx0: Math.floor((tx - REACH) / cs),
      cx1: Math.floor((tx + TILE + REACH) / cs),
      cz0: Math.floor((tz - REACH) / cs),
      cz1: Math.floor((tz + TILE + REACH) / cs),
    };
  }

  /** Splat the crowns around a tile into layer `layer`. */
  private bake(cell: number, layer: number): void {
    const tx = this.map.x0 + (cell % this.w) * TILE;
    const tz = this.map.z0 + Math.floor(cell / this.w) * TILE;
    // Texel (i, j) of the layer covers [tx + (i - APRON) * RES, +RES): the apron repeats the neighbour's ground.
    const gx0 = tx - APRON * RES;
    const gz0 = tz - APRON * RES;
    const grid = new Float32Array(TEX * TEX);
    const { cx0, cx1, cz0, cz1 } = this.chunkRange(cell);
    const sc = this.world.scatter;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = sc.cachedChunk(cx, cz);
        if (chunk)
          for (const inst of chunk.instances) this.splat(inst, grid, gx0, gz0);
      }
    const out = this.data.subarray(layer * TEX * TEX, (layer + 1) * TEX * TEX);
    for (let k = 0; k < out.length; k++) out[k] = Math.round(grid[k] * 255);
  }

  private splat(
    inst: ScatterInstance,
    grid: Float32Array,
    gx0: number,
    gz0: number,
  ): void {
    if (!isVegetation(inst.asset)) return;
    const c = canopyOf(inst.asset);
    const r = c.radius * inst.scale;
    if (r < 0.6) return;
    const h = c.height * inst.scale;
    const cx = inst.x + this.sx * h;
    const cz = inst.z + this.sz * h;
    // The crown's shadow ellipse: across the sun azimuth r, along it the crown's slant length.
    const ra = Math.min(r * 4, Math.hypot(r, c.ry * inst.scale * this.cot));
    const reach = ra + RES;
    const i0 = Math.max(0, Math.floor((cx - reach - gx0) / RES));
    const i1 = Math.min(TEX - 1, Math.ceil((cx + reach - gx0) / RES));
    const j0 = Math.max(0, Math.floor((cz - reach - gz0) / RES));
    const j1 = Math.min(TEX - 1, Math.ceil((cz + reach - gz0) / RES));
    if (i0 > i1 || j0 > j1) return;
    for (let j = j0; j <= j1; j++) {
      const pz = gz0 + (j + 0.5) * RES - cz;
      for (let i = i0; i <= i1; i++) {
        const px = gx0 + (i + 0.5) * RES - cx;
        const u = (px * this.ax + pz * this.az) / ra;
        const v = (-px * this.az + pz * this.ax) / r;
        const q = u * u + v * v;
        if (q >= 1) continue;
        // A crown lets sun through in leafy holes (world-space noise, so overlapping crowns agree on them) and
        // has a firm edge.
        const wx = gx0 + (i + 0.5) * RES;
        const wz = gz0 + (j + 0.5) * RES;
        const n =
          0.5 +
          0.5 *
            (this.noise.noise2(wx * 0.9, wz * 0.9) * 0.6 +
              this.noise.noise2(wx * 2.3 + 17, wz * 2.3) * 0.4);
        const hole = n > 0.62 ? 0.45 : 1;
        const edge = 1 - smooth(0.78, 1, q);
        const k = j * TEX + i;
        grid[k] = Math.min(1, grid[k] + DENSITY * edge * hole);
      }
    }
  }

  dispose(): void {
    this.tiles.dispose();
    this.index.dispose();
  }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const ROAD_SHADOW_TILE = {
  size: TILE,
  texels: TEX,
  apron: APRON,
  core: CORE,
};
