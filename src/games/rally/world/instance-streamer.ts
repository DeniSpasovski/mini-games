import {
  BufferGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { ASSET_CATALOG, getAssetMeta, type AssetMeta } from '../assets/catalog';
import { getAsset, getVariantSet } from '../assets/library';
import { variantDepthMaterial } from '../engine/materials';
import { hash3 } from '../../../shared/rng';
import { CORNER_FAN_ASSETS } from './corner-fans';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/**
 * Turns scatter instances near the camera into InstancedMeshes.
 *
 * One InstancedMesh per (asset, variant, LOD, part); geometry and materials
 * always come from the shared asset library - nothing is cloned. Where the library has a variant set
 * (`getVariantSet`: all variants in one geometry) it is one InstancedMesh per (asset, LOD, material) and each
 * instance carries its variant (`instVariant`) - far fewer draw calls for the near, many-variant LODs.
 *
 * Re-bucketing (distance -> LOD) runs as an incremental JOB: every
 * `rebuildDistance` metres a new job walks the chunks in range, filling
 * staging arrays with a small per-frame time budget, then commits all buckets
 * at once (no half-updated frames). Commits upload only the used range.
 *
 * View culling (`setView`, the game calls it every frame): three.js cannot cull single instances and a
 * bucket spans the whole view ring, so buckets that cast no shadow (LOD1+ = the far, numerous instances)
 * keep their instances sorted by angle around the commit focus (a bin sort) and only the angular window
 * the camera sees is packed to the front of the GPU buffer and drawn. Re-packed after REPACK of turning.
 * Shadow casters (LOD0) are always drawn whole: things behind the camera throw shadows into the view.
 */
const BINS = 360;
/** Instances this close to the commit focus are always drawn (m). */
const NEAR = 60;
/** Re-pack the view window after the camera turned this far (rad). */
const REPACK = (8 * Math.PI) / 180;

interface Bucket {
  key: string;
  meshes: InstancedMesh[];
  capacity: number;
  count: number;
  castShadow: boolean;
  tinted: boolean;
  /** Variant set: every instance also carries its variant (`instVariant`, on per-part `geometries`). */
  variants: boolean;
  geometries: BufferGeometry[];
  /** Committed instances (sorted by angle when culled); `drawnCount` of them are on the GPU now. */
  cMat: Float32Array;
  cCol: Float32Array;
  cVar: Float32Array;
  /** Staged index -> committed position. */
  order: Uint32Array;
  /** First committed position of each bin (0 = near, 1..BINS = angle; BINS + 2 entries), null = drawn whole. */
  binStart: Uint32Array | null;
  drawnCount: number;
  // Staging (filled by the job, copied on commit).
  sMat: Float32Array;
  sCol: Float32Array;
  sVar: Float32Array;
  sCount: number;
}

interface InstanceData {
  m: Float32Array;
  /** Brightness multiplier (per-instance tint). */
  t: number;
  meta: AssetMeta;
  variant: number;
  /** Bucket key per LOD, built once (no per-rebuild string garbage). */
  keys: string[];
  /** Moved instances (setMatrix): slot staged by the running job / drawn since the last commit. */
  staged?: { bucket: Bucket; i: number } | null;
  slot?: { bucket: Bucket; i: number } | null;
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
  /**
   * Nothing is drawn further than this (m), whatever the LOD distances say: the game passes the terrain view
   * distance, so no tree / house stands past the streamed ground. Unset = the longest LOD distance.
   */
  maxDistance?: number;
}

/** Longest last-LOD distance of any asset (power pylons, buildings): the widest chunk sweep needed. */
const LONGEST_LOD = Math.max(
  ...ASSET_CATALOG.map((a) => a.lods[a.lods.length - 1].maxDistance),
);

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export class InstanceStreamer {
  readonly group = new Group();
  private buckets = new Map<string, Bucket>();
  private data = new WeakMap<ScatterInstance, InstanceData>();
  /** Instances whose matrix was changed by setMatrix (their draw slot is tracked so it can be patched). */
  private moved = new Set<InstanceData>();
  private lastFocus = new Vector3(Infinity, 0, 0);
  private maxRange: number;
  private detailRange: number;
  private job: Iterator<void> | null = null;
  /** Per instance list (a scatter chunk): the longest last-LOD distance in it, to skip far chunks wholesale. */
  private reach = new WeakMap<ScatterInstance[], number>();
  /** Instances drawn after the last commit (stats). */
  drawn = 0;
  /** Completed rebuilds (stats / tests). */
  commits = 0;
  /** Disable categories / single assets from debug UIs. */
  filter: (asset: string) => boolean = () => true;
  /** Commit focus (angles are measured from it). */
  private sortX = 0;
  private sortZ = 0;
  /** View window (centre angle + half width, rad) the buckets are packed for; null = draw everything. */
  private view: { yaw: number; half: number } | null = null;

  constructor(
    private world: World,
    private opts: StreamerOptions,
  ) {
    this.group.name = 'scatter';
    const metas = new Set([
      ...world.map.scatter.map((r) => r.asset),
      ...world.map.roadside.map((r) => r.asset),
      ...(world.map.cornerFans ? CORNER_FAN_ASSETS : []),
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

  /** Current LOD distance multiplier. */
  get lodScale(): number {
    return this.opts.lodScale;
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

  /**
   * Draw only what the camera can see: `yaw` = atan2(dz, dx) of its horizontal view direction, `half` = half the
   * horizontal field of view plus a margin (rad). null draws every instance (aerial views, tools).
   */
  setView(view: { yaw: number; half: number } | null): void {
    const v = this.view;
    if (!view && !v) return;
    if (view && v) {
      let d = Math.abs(view.yaw - v.yaw) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < REPACK && Math.abs(view.half - v.half) < REPACK) return;
    }
    this.view = view ? { ...view } : null;
    for (const b of this.buckets.values()) if (b.binStart) this.pack(b);
  }

  private *rebuildJob(focus: Vector3): Generator<void> {
    for (const b of this.buckets.values()) b.sCount = 0;
    for (const d of this.moved) d.staged = null;
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const lodScale = this.opts.lodScale;
    const maxD = this.opts.maxDistance ?? Infinity;
    // Buildings / pylons / landmark props (fixed instances) may reach further than the map's scatter rules;
    // chunks with nothing that far are skipped by their reach below.
    const range = Math.min(
      maxD,
      Math.max(this.maxRange, LONGEST_LOD) * lodScale,
    );
    const dRange = Math.min(maxD, this.detailRange * lodScale);
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
        if (dist > maxD) continue;
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
        const list = scatter.chunk(cx, cz).instances;
        // A far chunk of short-range assets (bushes, orchards, rocks) has nothing to draw: skip its instances.
        if (near <= this.reachOf(list) * lodScale) visit(list, false);
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
    this.sortX = focus.x;
    this.sortZ = focus.z;
    this.commit();
    this.drawn = drawn;
    this.commits++;
  }

  /**
   * Move one instance (a knocked-over breakable): its drawn matrix is patched in place right away and every later
   * rebuild uses it. `null` puts it back where the map placed it.
   */
  setMatrix(inst: ScatterInstance, m: Matrix4 | null): void {
    const d = this.dataOf(inst);
    if (m) d.m.set(m.elements);
    else {
      placedMatrix(inst, d.m);
      this.moved.delete(d);
    }
    if (m) this.moved.add(d);
    if (d.slot) this.patch(d.slot.bucket, d.slot.i, d.m);
    if (!m) d.slot = d.staged = null;
  }

  private patch(b: Bucket, i: number, m: Float32Array): void {
    if (i >= b.count) return;
    const pos = b.order[i];
    b.cMat.set(m, pos * 16);
    if (b.binStart) {
      this.pack(b);
      return;
    }
    for (const mesh of b.meshes) {
      const im = mesh.instanceMatrix;
      (im.array as Float32Array).set(m, pos * 16);
      im.addUpdateRange(pos * 16, 16);
      im.needsUpdate = true;
    }
  }

  private reachOf(list: ScatterInstance[]): number {
    let r = this.reach.get(list);
    if (r === undefined) {
      r = 0;
      const seen = new Set<string>();
      for (const inst of list) {
        if (seen.has(inst.asset)) continue;
        seen.add(inst.asset);
        const lods = getAssetMeta(inst.asset).lods;
        r = Math.max(r, lods[lods.length - 1].maxDistance);
      }
      this.reach.set(list, r);
    }
    return r;
  }

  private dataOf(inst: ScatterInstance): InstanceData {
    let d = this.data.get(inst);
    if (!d) {
      const meta = getAssetMeta(inst.asset);
      const tint = meta.tint ?? 0;
      const t =
        1 +
        ((hash3(Math.floor(inst.x * 7), Math.floor(inst.z * 7), 1) /
          4294967296) *
          2 -
          1) *
          tint;
      // Far LODs flagged `oneVariant` share one bucket (getAsset draws variant 0 for them), variant sets too ('v').
      const keys = meta.lods.map(
        (l, lod) =>
          `${inst.asset}:${getVariantSet(inst.asset, lod) ? 'v' : l.oneVariant ? 0 : inst.variant}:${lod}`,
      );
      d = {
        m: placedMatrix(inst, new Float32Array(16)),
        t,
        meta,
        variant: inst.variant,
        keys,
      };
      this.data.set(inst, d);
    }
    return d;
  }

  private stage(inst: ScatterInstance, d: InstanceData, lod: number): void {
    const key = d.keys[lod];
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = newBucket(key, d.meta, lod);
      this.buckets.set(key, bucket);
      this.createMeshes(bucket, inst, lod, 64);
    }
    const i = bucket.sCount++;
    if (this.moved.has(d)) d.staged = { bucket, i };
    if (i * 16 >= bucket.sMat.length) {
      const m = new Float32Array(bucket.sMat.length * 2);
      m.set(bucket.sMat);
      bucket.sMat = m;
      if (bucket.tinted) {
        const c = new Float32Array(bucket.sCol.length * 2);
        c.set(bucket.sCol);
        bucket.sCol = c;
      }
      if (bucket.variants) {
        const v = new Float32Array(bucket.sVar.length * 2);
        v.set(bucket.sVar);
        bucket.sVar = v;
      }
    }
    bucket.sMat.set(d.m, i * 16);
    if (bucket.variants) bucket.sVar[i] = d.variant;
    if (bucket.tinted) {
      const t = d.t;
      bucket.sCol[i * 3] = t;
      bucket.sCol[i * 3 + 1] = t * (1 + (d.meta.tint ?? 0) * 0.15);
      bucket.sCol[i * 3 + 2] = t;
    }
  }

  /** Staging -> committed copy (angle-sorted for culled buckets) -> GPU buffers, uploading only the used range. */
  private commit(): void {
    for (const d of this.moved) d.slot = d.staged;
    for (const b of this.buckets.values()) {
      if (b.sCount > b.capacity) {
        let cap = Math.max(64, b.capacity);
        while (cap < b.sCount) cap *= 2;
        const [id, variant, lod] = b.key.split(':');
        const inst = {
          asset: id,
          variant: variant === 'v' ? 0 : Number(variant),
        } as ScatterInstance;
        this.createMeshes(b, inst, Number(lod), cap);
      }
      b.count = b.sCount;
      this.sortCommitted(b);
      this.pack(b);
    }
    // A move during the job staged the old matrix: draw the current one.
    for (const d of this.moved)
      if (d.slot) this.patch(d.slot.bucket, d.slot.i, d.m);
  }

  /** Copy the staged instances into the committed arrays; buckets without shadows bin-sorted by angle. */
  private sortCommitted(b: Bucket): void {
    const n = b.count;
    if (b.cMat.length < n * 16) {
      b.cMat = new Float32Array(b.sMat.length);
      b.cCol = new Float32Array(b.sCol.length);
      b.cVar = new Float32Array(b.sVar.length);
    }
    if (b.order.length < n) b.order = new Uint32Array(b.sMat.length / 16);
    if (b.castShadow || n < 64) {
      b.cMat.set(b.sMat.subarray(0, n * 16));
      if (b.tinted) b.cCol.set(b.sCol.subarray(0, n * 3));
      if (b.variants) b.cVar.set(b.sVar.subarray(0, n));
      for (let i = 0; i < n; i++) b.order[i] = i;
      b.binStart = null;
      return;
    }
    // Bin 0 = near the focus (always drawn: its angle from the focus says little), 1..BINS = angle.
    const start = (b.binStart ??= new Uint32Array(BINS + 2));
    start.fill(0);
    if (_bins.length < n) _bins = new Uint16Array(n * 2);
    const bins = _bins;
    const k = BINS / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const dx = b.sMat[i * 16 + 12] - this.sortX;
      const dz = b.sMat[i * 16 + 14] - this.sortZ;
      const bin =
        dx * dx + dz * dz < NEAR * NEAR
          ? 0
          : 1 +
            Math.min(BINS - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) * k));
      bins[i] = bin;
      start[bin + 1]++;
    }
    for (let i = 0; i <= BINS; i++) start[i + 1] += start[i];
    const cursor = _cursor;
    cursor.set(start.subarray(0, BINS + 1));
    for (let i = 0; i < n; i++) {
      const pos = cursor[bins[i]]++;
      b.order[i] = pos;
      b.cMat.set(b.sMat.subarray(i * 16, i * 16 + 16), pos * 16);
      if (b.tinted) b.cCol.set(b.sCol.subarray(i * 3, i * 3 + 3), pos * 3);
      if (b.variants) b.cVar[pos] = b.sVar[i];
    }
  }

  /** Committed -> GPU: everything, or only the bins of the view window (1 or 2 contiguous ranges). */
  private pack(b: Bucket): void {
    const ranges: [number, number][] = [];
    const start = b.binStart;
    if (!start || !this.view) ranges.push([0, b.count]);
    else {
      const k = BINS / (2 * Math.PI);
      // Angles were measured from the commit focus; the camera stays near it (rebuildDistance).
      const lo = Math.floor((this.view.yaw - this.view.half + Math.PI) * k);
      const hi = Math.floor((this.view.yaw + this.view.half + Math.PI) * k);
      if (hi - lo >= BINS - 1) ranges.push([0, b.count]);
      else {
        ranges.push([start[0], start[1]]);
        for (let bin = lo; bin <= hi;) {
          const w = ((bin % BINS) + BINS) % BINS;
          const end = Math.min(hi, bin + (BINS - 1 - w));
          ranges.push([start[w + 1], start[w + 1 + (end - bin) + 1]]);
          bin = end + 1;
        }
      }
    }
    let n = 0;
    for (const mesh of b.meshes) {
      const im = mesh.instanceMatrix;
      const arr = im.array as Float32Array;
      const ic = b.tinted ? mesh.instanceColor : null;
      const iv = b.variants
        ? (mesh.geometry.getAttribute(
            'instVariant',
          ) as InstancedBufferAttribute)
        : null;
      n = 0;
      for (const [r0, r1] of ranges) {
        if (r1 <= r0) continue;
        arr.set(b.cMat.subarray(r0 * 16, r1 * 16), n * 16);
        if (ic)
          (ic.array as Float32Array).set(
            b.cCol.subarray(r0 * 3, r1 * 3),
            n * 3,
          );
        if (iv) (iv.array as Float32Array).set(b.cVar.subarray(r0, r1), n);
        n += r1 - r0;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) continue;
      im.clearUpdateRanges();
      im.addUpdateRange(0, n * 16);
      im.needsUpdate = true;
      if (ic) {
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, n * 3);
        ic.needsUpdate = true;
      }
      if (iv) {
        iv.clearUpdateRanges();
        iv.addUpdateRange(0, n);
        iv.needsUpdate = true;
      }
    }
    b.drawnCount = n;
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
    const set = bucket.variants ? getVariantSet(inst.asset, lod) : null;
    const asset = set ?? getAsset(inst.asset, inst.variant, lod);
    bucket.meshes = asset.parts.map((part, pi) => {
      let geometry = part.geometry;
      if (set) {
        // A wrapper sharing the cached vertex buffers, carrying this bucket's per-instance variants.
        geometry = bucket.geometries[pi] ??= shareAttributes(part.geometry);
        const iv = new InstancedBufferAttribute(new Float32Array(cap), 1);
        iv.setUsage(DynamicDrawUsage);
        geometry.setAttribute('instVariant', iv);
      }
      const mesh = new InstancedMesh(geometry, part.material, cap);
      if (set) mesh.customDepthMaterial = variantDepthMaterial(part.material);
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
      mesh.name = `${inst.asset}#${set ? 'all' : inst.variant} lod${lod}`;
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
      ...(this.world.map.cornerFans ? CORNER_FAN_ASSETS : []),
      ...this.world.map.props.map((p) => p.asset),
    ]);
    for (const id of ids) {
      const meta = getAssetMeta(id);
      for (let v = 0; v < meta.variants; v++) {
        for (let lod = 0; lod < meta.lods.length; lod++) {
          const set = !!getVariantSet(id, lod);
          if (v > 0 && (meta.lods[lod].oneVariant || set)) continue;
          const key = `${id}:${set ? 'v' : v}:${lod}`;
          if (!this.buckets.has(key)) {
            const bucket = newBucket(key, meta, lod);
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
      for (const m of b.meshes) m.visible = m.count > 0;
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

  /** Drop every bucket and cached bucket key and rebuild from scratch (after `setVariantSets`; dev A/B). */
  reset(focus: Vector3): void {
    this.dispose();
    this.data = new WeakMap();
    this.moved.clear();
    this.job = null;
    this.updateNow(focus);
  }
}

let _bins = new Uint16Array(4096);
const _cursor = new Uint32Array(BINS + 1);

function newBucket(key: string, meta: AssetMeta, lod: number): Bucket {
  const tinted = (meta.tint ?? 0) > 0;
  const variants = key.split(':')[1] === 'v';
  return {
    key,
    meshes: [],
    capacity: 0,
    count: 0,
    castShadow: meta.lods[lod].castShadow,
    tinted,
    variants,
    geometries: [],
    cMat: new Float32Array(16 * 64),
    cCol: new Float32Array(tinted ? 3 * 64 : 0),
    cVar: new Float32Array(variants ? 64 : 0),
    order: new Uint32Array(64),
    binStart: null,
    drawnCount: 0,
    sMat: new Float32Array(16 * 64),
    sCol: new Float32Array(tinted ? 3 * 64 : 0),
    sVar: new Float32Array(variants ? 64 : 0),
    sCount: 0,
  };
}

/** A geometry drawing the same vertex buffers as `src` (shared attribute objects = shared GPU buffers). */
function shareAttributes(src: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes))
    g.setAttribute(name, attr);
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

/** World matrix of an instance as the map placed it. */
function placedMatrix(inst: ScatterInstance, out: Float32Array): Float32Array {
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
  out.set(_m.elements);
  return out;
}
