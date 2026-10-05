import {
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { getAssetMeta, type AssetMeta } from '../assets/catalog';
import { getAsset } from '../assets/library';
import { hash3 } from '../../../shared/rng';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/**
 * Turns scatter instances near the camera into InstancedMeshes.
 *
 * One InstancedMesh per (asset, variant, LOD, part); geometry and materials
 * always come from the shared asset library - nothing is cloned.
 *
 * Re-bucketing (distance -> LOD) runs as an incremental JOB: every
 * `rebuildDistance` metres a new job walks the chunks in range, filling
 * staging arrays with a small per-frame time budget, then commits all buckets
 * at once (no half-updated frames). Commits upload only the used range.
 */
interface Bucket {
  key: string;
  meshes: InstancedMesh[];
  capacity: number;
  count: number;
  castShadow: boolean;
  tinted: boolean;
  // Staging (filled by the job, copied on commit).
  sMat: Float32Array;
  sCol: Float32Array;
  sCount: number;
}

interface InstanceData {
  m: Float32Array;
  /** Brightness multiplier (per-instance tint). */
  t: number;
  meta: AssetMeta;
  /** Bucket key per LOD, built once (no per-rebuild string garbage). */
  keys: string[];
}

export interface StreamerOptions {
  /** Multiplies every LOD distance. */
  lodScale: number;
  /** 0..1 fraction of detail (grass) instances kept. */
  detailDensity: number;
  /** Start a new rebuild after the camera moved this far (m). */
  rebuildDistance?: number;
  /** Max ms per frame spent on a rebuild job. */
  budgetMs?: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export class InstanceStreamer {
  readonly group = new Group();
  private buckets = new Map<string, Bucket>();
  private data = new WeakMap<ScatterInstance, InstanceData>();
  private lastFocus = new Vector3(Infinity, 0, 0);
  private maxRange: number;
  private detailRange: number;
  private job: Iterator<void> | null = null;
  /** Instances drawn after the last commit (stats). */
  drawn = 0;
  /** Completed rebuilds (stats / tests). */
  commits = 0;
  /** Disable categories / single assets from debug UIs. */
  filter: (asset: string) => boolean = () => true;

  constructor(
    private world: World,
    private opts: StreamerOptions,
  ) {
    this.group.name = 'scatter';
    const metas = new Set([
      ...world.map.scatter.map((r) => r.asset),
      ...world.map.roadside.map((r) => r.asset),
      ...world.map.props.map((p) => p.asset),
    ]);
    let max = 0;
    let detail = 0;
    for (const id of metas) {
      const m = getAssetMeta(id);
      const d = m.lods[m.lods.length - 1].maxDistance;
      if (world.map.scatter.some((r) => r.asset === id && r.detail))
        detail = Math.max(detail, d);
      else max = Math.max(max, d);
    }
    this.maxRange = max;
    this.detailRange = detail;
  }

  setOptions(o: Partial<StreamerOptions>): void {
    Object.assign(this.opts, o);
    this.invalidate();
  }

  invalidate(): void {
    this.lastFocus.set(Infinity, 0, 0);
  }

  /** Call every frame. Starts / continues a time-sliced rebuild. */
  update(focus: Vector3): void {
    if (!this.job) {
      const rebuild = this.opts.rebuildDistance ?? 10;
      if (this.lastFocus.distanceToSquared(focus) < rebuild * rebuild) return;
      this.lastFocus.copy(focus);
      this.job = this.rebuildJob(focus.clone());
    }
    const t0 = performance.now();
    const budget = this.opts.budgetMs ?? 2;
    while (performance.now() - t0 < budget) {
      if (this.job.next().done) {
        this.job = null;
        break;
      }
    }
  }

  /** Rebuild synchronously (loading screens, tools). */
  updateNow(focus: Vector3): void {
    this.lastFocus.copy(focus);
    const job = this.rebuildJob(focus.clone());
    while (!job.next().done);
    this.job = null;
  }

  private *rebuildJob(focus: Vector3): Generator<void> {
    for (const b of this.buckets.values()) b.sCount = 0;
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const lodScale = this.opts.lodScale;
    const range = this.maxRange * lodScale;
    const dRange = this.detailRange * lodScale;
    const b = this.world.map.bounds;
    let drawn = 0;

    const visit = (list: ScatterInstance[], detail: boolean) => {
      for (const inst of list) {
        if (!this.filter(inst.asset)) continue;
        if (
          detail &&
          hash3(Math.floor(inst.x * 10), Math.floor(inst.z * 10), 3) /
            4294967296 >
            this.opts.detailDensity
        )
          continue;
        const d = this.dataOf(inst);
        const lods = d.meta.lods;
        const dx = inst.x - focus.x;
        const dz = inst.z - focus.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        let lod = -1;
        for (let i = 0; i < lods.length; i++) {
          if (dist < lods[i].maxDistance * lodScale) {
            lod = i;
            break;
          }
        }
        if (lod < 0) continue;
        this.stage(inst, d, lod);
        drawn++;
      }
    };

    const span = (r: number, lo: number, hi: number, c: number) => [
      Math.floor(Math.max(lo, c - r) / cs),
      Math.floor(Math.min(hi, c + r) / cs),
    ];
    const [x0, x1] = span(range, b.minX - 300, b.maxX + 300, focus.x);
    const [z0, z1] = span(range, b.minZ - 300, b.maxZ + 300, focus.z);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const near =
          Math.hypot((cx + 0.5) * cs - focus.x, (cz + 0.5) * cs - focus.z) -
          cs * 0.71;
        if (near > range) continue;
        visit(scatter.chunk(cx, cz).instances, false);
        // Grass needs the 1 m heightfield; skip until terrain streaming has built it.
        if (
          dRange > 0 &&
          this.opts.detailDensity > 0 &&
          near < dRange &&
          this.world.heightfield.hasChunk(cx, cz)
        )
          visit(scatter.detail(cx, cz), true);
        yield;
      }
    }
    if (dRange > 0) scatter.pruneDetail(focus.x, focus.z, dRange * 2 + cs);
    this.commit();
    this.drawn = drawn;
    this.commits++;
  }

  private dataOf(inst: ScatterInstance): InstanceData {
    let d = this.data.get(inst);
    if (!d) {
      _e.set(inst.tiltX, inst.rotY, inst.tiltZ, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(
        _p.set(inst.x, inst.y, inst.z),
        _q,
        _s.set(
          inst.scale * (inst.sx ?? 1),
          inst.scale * (inst.sy ?? 1),
          inst.scale * (inst.sz ?? 1),
        ),
      );
      const meta = getAssetMeta(inst.asset);
      const tint = meta.tint ?? 0;
      const t =
        1 +
        ((hash3(Math.floor(inst.x * 7), Math.floor(inst.z * 7), 1) /
          4294967296) *
          2 -
          1) *
          tint;
      const keys = meta.lods.map(
        (_, lod) => `${inst.asset}:${inst.variant}:${lod}`,
      );
      d = { m: new Float32Array(_m.elements), t, meta, keys };
      this.data.set(inst, d);
    }
    return d;
  }

  private stage(inst: ScatterInstance, d: InstanceData, lod: number): void {
    const key = d.keys[lod];
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const tinted = (d.meta.tint ?? 0) > 0;
      bucket = {
        key,
        meshes: [],
        capacity: 0,
        count: 0,
        castShadow: d.meta.lods[lod].castShadow,
        tinted,
        sMat: new Float32Array(16 * 64),
        sCol: new Float32Array(tinted ? 3 * 64 : 0),
        sCount: 0,
      };
      this.buckets.set(key, bucket);
      this.createMeshes(bucket, inst, lod, 64);
    }
    const i = bucket.sCount++;
    if (i * 16 >= bucket.sMat.length) {
      const m = new Float32Array(bucket.sMat.length * 2);
      m.set(bucket.sMat);
      bucket.sMat = m;
      if (bucket.tinted) {
        const c = new Float32Array(bucket.sCol.length * 2);
        c.set(bucket.sCol);
        bucket.sCol = c;
      }
    }
    bucket.sMat.set(d.m, i * 16);
    if (bucket.tinted) {
      const t = d.t;
      bucket.sCol[i * 3] = t;
      bucket.sCol[i * 3 + 1] = t * (1 + (d.meta.tint ?? 0) * 0.15);
      bucket.sCol[i * 3 + 2] = t;
    }
  }

  /** Copy staging -> GPU buffers for every bucket, uploading only the used range. */
  private commit(): void {
    for (const b of this.buckets.values()) {
      if (b.sCount > b.capacity) {
        let cap = Math.max(64, b.capacity);
        while (cap < b.sCount) cap *= 2;
        const [id, variant, lod] = b.key.split(':');
        const inst = { asset: id, variant: Number(variant) } as ScatterInstance;
        this.createMeshes(b, inst, Number(lod), cap);
      }
      b.count = b.sCount;
      for (const mesh of b.meshes) {
        mesh.count = b.count;
        mesh.visible = b.count > 0;
        if (!b.count) continue;
        const im = mesh.instanceMatrix;
        (im.array as Float32Array).set(b.sMat.subarray(0, b.count * 16));
        im.clearUpdateRanges();
        im.addUpdateRange(0, b.count * 16);
        im.needsUpdate = true;
        if (b.tinted && mesh.instanceColor) {
          const ic = mesh.instanceColor;
          (ic.array as Float32Array).set(b.sCol.subarray(0, b.count * 3));
          ic.clearUpdateRanges();
          ic.addUpdateRange(0, b.count * 3);
          ic.needsUpdate = true;
        }
      }
    }
  }

  private createMeshes(
    bucket: Bucket,
    inst: ScatterInstance,
    lod: number,
    cap: number,
  ): void {
    for (const old of bucket.meshes) {
      this.group.remove(old);
      old.dispose(); // frees instance buffers only - geometry/material are shared
    }
    const asset = getAsset(inst.asset, inst.variant, lod);
    bucket.meshes = asset.parts.map((part) => {
      const mesh = new InstancedMesh(part.geometry, part.material, cap);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      if (bucket.tinted) {
        mesh.instanceColor = new InstancedBufferAttribute(
          new Float32Array(cap * 3).fill(1),
          3,
        );
        mesh.instanceColor.setUsage(DynamicDrawUsage);
      }
      mesh.count = 0;
      mesh.visible = false;
      // Buckets span the whole map, so a per-bucket frustum test almost never
      // culls anything but costs a full bounding-sphere pass after each commit.
      mesh.frustumCulled = false;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      mesh.name = `${inst.asset}#${inst.variant} lod${lod}`;
      this.group.add(mesh);
      return mesh;
    });
    bucket.capacity = cap;
  }

  /**
   * Create every (asset, variant, LOD) bucket the map can use and make them
   * visible so renderer.compile() builds all shader programs at load time
   * (avoids a hitch the first time e.g. a far LOD appears). Call before compile;
   * the next commit sets visibility correctly again.
   */
  prewarm(): void {
    const ids = new Set([
      ...this.world.map.scatter.map((r) => r.asset),
      ...this.world.map.roadside.map((r) => r.asset),
      ...this.world.map.props.map((p) => p.asset),
    ]);
    for (const id of ids) {
      const meta = getAssetMeta(id);
      for (let v = 0; v < meta.variants; v++) {
        for (let lod = 0; lod < meta.lods.length; lod++) {
          const key = `${id}:${v}:${lod}`;
          if (!this.buckets.has(key)) {
            const tinted = (meta.tint ?? 0) > 0;
            const bucket: Bucket = {
              key,
              meshes: [],
              capacity: 0,
              count: 0,
              castShadow: meta.lods[lod].castShadow,
              tinted,
              sMat: new Float32Array(16 * 64),
              sCol: new Float32Array(tinted ? 3 * 64 : 0),
              sCount: 0,
            };
            this.buckets.set(key, bucket);
            this.createMeshes(
              bucket,
              { asset: id, variant: v } as ScatterInstance,
              lod,
              64,
            );
          }
          for (const m of this.buckets.get(key)!.meshes) m.visible = true;
        }
      }
    }
  }

  /** Re-apply visibility after prewarm/compile. */
  settle(): void {
    for (const b of this.buckets.values())
      for (const m of b.meshes) m.visible = b.count > 0;
  }

  /** True while a rebuild job is in progress. */
  get busy(): boolean {
    return this.job !== null;
  }

  /** Number of InstancedMesh draw objects (for stats). */
  get meshCount(): number {
    let n = 0;
    for (const b of this.buckets.values())
      n += b.count > 0 ? b.meshes.length : 0;
    return n;
  }

  dispose(): void {
    for (const b of this.buckets.values())
      for (const m of b.meshes) m.dispose();
    this.buckets.clear();
    this.group.clear();
  }
}
