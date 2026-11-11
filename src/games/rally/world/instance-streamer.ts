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
  type Material,
} from 'three';
import {
  ASSET_CATALOG,
  getAssetMeta,
  hasAsset as isCatalogAsset,
  type AssetMeta,
} from '../assets/catalog';
import {
  canBuildAway,
  evictAsset,
  getAsset,
  getVariantSet,
  hasAsset,
  requestAsset,
} from '../assets/library';
import {
  lodFadeDepthMaterial,
  lodFadeMaterial,
  variantDepthMaterial,
} from '../engine/materials';
import { worldUniforms } from '../engine/world-shading';
import { hash3 } from '../../../shared/rng';
import { mapSeason } from '../maps/shared/climate';
import { isTreeType } from '../trees/species';
import { BuildQueue, evictions, type Held, type Want } from './build-queue';
import { CORNER_FAN_ASSETS } from './corner-fans';
import { meadowPatch } from './meadow-patches';
import { ParkCars } from './park-car-mesh';
import { SERVICE_PARK_ASSETS } from './service-park';
import {
  FADE_IN,
  FADE_OUT,
  FADE_SOLID,
  LOD_FADE_TIME,
  nextFade,
  START_AT_COMMIT,
  type FadeState,
} from './lod-fade';
import { NEAR_DETAIL_MAX, type ScatterInstance } from './scatter';
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
 *
 * Level fades (catalog `fade`, `opts.fade`): an instance whose level changes at a rebuild is staged in both levels'
 * buckets for the fade, each copy carrying `instFade` (world/lod-fade.ts); the shaders dither between them.
 */
const BINS = 360;
/** Levels the workers build at once while driving (each takes the next as soon as one is done). */
const MAX_PENDING = 4;
/** New `lazy` buckets one rebuild may start drawing (their geometry uploads to the GPU on the first draw). */
const MAX_FRESH = 3;
/** Without a worker: the pause between two builds on this thread (ms), at least this many times a build's own duration. */
const GAP_MS = 60;
const SHARE = 3;
/** Built `lazy` levels (their geometry, in memory and on the GPU) kept at most this many bytes: idle ones go first. */
const LAZY_BUDGET = 48 * 1024 * 1024;
/** A level counts as unused after this many rebuilds without an instance (one per `rebuildDistance`: ~600 m). */
const LAZY_GRACE = 60;
/** Instances this close to the commit focus are always drawn (m). */
const NEAR = 60;
/** Re-pack the view window after the camera turned this far (rad). */
const REPACK = (8 * Math.PI) / 180;
/**
 * Fading assets: instances this far (m) past their last level beyond the rebuild distance are tracked, so
 * they can fade in (the ring must be wider than the camera moves between two rebuilds).
 */
const FADE_IN_MARGIN = 2;

interface Bucket {
  key: string;
  meshes: InstancedMesh[];
  capacity: number;
  count: number;
  castShadow: boolean;
  tinted: boolean;
  /** Variant set: every instance also carries its variant (`instVariant`, on per-part `geometries`). */
  variants: boolean;
  /** Level fades: every instance also carries `instFade` (start time, role) on per-part `geometries`. */
  fades: boolean;
  /** A copy staged / committed is fading: the meshes draw with the fade materials (`setFading`). */
  sFading: boolean;
  fading: boolean;
  /** An outgoing fade copy staged / committed (`endFades`: a bucket with none draws plain once its fades are done). */
  sOut: boolean;
  out: boolean;
  /** Per part: the plain and the fade material, and their shadow-pass materials (undefined = three's default). */
  plainMats: Material[];
  fadeMats: Material[];
  plainDepth: (Material | undefined)[];
  fadeDepth: (Material | undefined)[];
  geometries: BufferGeometry[];
  /** Committed instances (`count`, sorted by angle when culled); `drawnCount` of them are on the GPU now. */
  cMat: Float32Array;
  cCol: Float32Array;
  cVar: Float32Array;
  cFade: Float32Array;
  /** Staged index -> committed position. */
  order: Uint32Array;
  /** First committed position of each bin (0 = near, 1..BINS = angle; BINS + 2 entries), null = drawn whole. */
  binStart: Uint32Array | null;
  drawnCount: number;
  /** A `lazy` level (people close up): built on demand, dropped when unused (`evict`); `used` = `commits` at its last use. */
  lazy: boolean;
  used: number;
  // Staging (filled by the job, copied on commit).
  sMat: Float32Array;
  sCol: Float32Array;
  sVar: Float32Array;
  sFade: Float32Array;
  sCount: number;
}

interface Slot {
  bucket: Bucket;
  i: number;
}

/** The level fade state lives on the instance itself (world/lod-fade.ts FadeState): no object per streamed plant. */
interface InstanceData extends FadeState {
  m: Float32Array;
  /** Colour multiplier r, g, b (per-instance tint, meadow patches). */
  t: number;
  tg: number;
  tb: number;
  meta: AssetMeta;
  variant: number;
  /** Bucket key per LOD, shared by every instance of the asset + variant (`keysOf`). */
  keys: string[];
  /** The streamer that made it (`ScatterInstance.streamed`; `reset` starts a new owner). */
  owner: object;
  /**
   * Moved instances (setMatrix): slots staged by the running job / drawn since the last commit (two during a level
   * fade: both copies follow the move, or a person turning to the car shows two poses).
   */
  staged?: Slot[] | null;
  slot?: Slot[] | null;
}

export interface StreamerOptions {
  /** Multiplies every LOD distance. */
  lodScale: number;
  /** 0..1 fraction of detail (grass) instances kept. */
  detailDensity: number;
  /** Grass density near the roads, x the map's (quality `grassNear`; default 1 = the map's everywhere). */
  grassNear?: number;
  /** Start a new rebuild after the camera moved this far (m). */
  rebuildDistance?: number;
  /** Max ms per frame spent on a rebuild job. */
  budgetMs?: number;
  /**
   * Nothing is drawn further than this (m), whatever the LOD distances say: the game passes the terrain view
   * distance, so no tree / house stands past the streamed ground. Unset = the longest LOD distance.
   */
  maxDistance?: number;
  /**
   * The game: levels flagged `lazy` (people close up) are not built for every variant at load. They are built one at a
   * time ahead of the camera (BuildQueue) and an instance draws the next cheaper LOD until its level is there; `updateNow`
   * builds what the view needs at once. Unset (tools, tests): built where they are first needed.
   */
  prefetch?: boolean;
  /** Dither between levels for the catalog's `fade` assets (world/lod-fade.ts; the game). Off: levels swap. */
  fade?: boolean;
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
const _patch = [1, 1, 1, 0];

export class InstanceStreamer {
  readonly group = new Group();
  private buckets = new Map<string, Bucket>();
  /** Owner tag of this streamer's `ScatterInstance.streamed` data (a new one drops it all: `reset`). */
  private owner = {};
  /** Bucket keys per asset and variant (`keysOf`). */
  private keys = new Map<string, string[][]>();
  /** Instances whose matrix was changed by setMatrix (their draw slot is tracked so it can be patched). */
  private moved = new Set<InstanceData>();
  /** Fades the running rebuild starts: their start time is the commit's, as is that of their staged copies (slots). */
  private starting: FadeState[] = [];
  private startBuckets: Bucket[] = [];
  private startSlots: number[] = [];
  /** Angle-binned buckets a move (`patch`) changed: packed once at the end of the frame's `update`. */
  private dirty = new Set<Bucket>();
  /** World time the fades of the last commit have all ended (Infinity: none running). */
  private fadeEnd = Infinity;
  /** Prewarm only: fade-material twins of the fading buckets' meshes, so both programs compile at load. */
  private warmTwins: InstancedMesh[] = [];
  private lastFocus = new Vector3(Infinity, 0, 0);
  private maxRange: number;
  private detailRange: number;
  /** Reach of the short-range detail assets (ScatterField `nearDetail`). */
  private nearDetailRange: number;
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
  /** The service park's team cars: real car models, drawn apart from the instance buckets (`team_car` is a collider). */
  private parkCars: ParkCars | null = null;
  /** `lazy` levels still to build (`opts.prefetch`). */
  private queue = new BuildQueue();
  /** Levels the worker is building, and who waits for it to finish them (loading). */
  private pending = 0;
  private idle: (() => void)[] = [];
  /** A level arrived since the last rebuild; when that last was started (ms). */
  private builtSince = false;
  /** When the last rebuild started (ms): while the car moves they come often enough to put arrivals to use. */
  private rebuiltAt = 0;
  /** Without a worker: no build on this thread before this time (ms). */
  private resumeAt = 0;
  private evictAt = 0;
  /** `lazy` buckets this rebuild has created so far (-Infinity: no limit, loading). */
  private fresh = 0;

  constructor(
    private world: World,
    private opts: StreamerOptions,
  ) {
    this.group.name = 'scatter';
    const metas = assetIds(world);
    let max = 0;
    let detail = 0;
    let nearDetail = 0;
    for (const id of metas) {
      const m = getAssetMeta(id);
      const d = m.lods[m.lods.length - 1].maxDistance;
      if (!world.map.scatter.some((r) => r.asset === id && r.detail))
        max = Math.max(max, d);
      else if (d > NEAR_DETAIL_MAX) detail = Math.max(detail, d);
      else nearDetail = Math.max(nearDetail, d);
    }
    this.maxRange = max;
    this.detailRange = detail;
    this.nearDetailRange = nearDetail;
    const cars =
      typeof document === 'undefined'
        ? []
        : (world.servicePark?.instances.filter((i) => i.asset === 'team_car') ??
          []);
    if (cars.length) {
      this.parkCars = new ParkCars(cars, opts);
      this.group.add(this.parkCars.group);
    }
  }

  /**
   * Resolves when the park's car models are loaded (loading screens, bakes wait for it). They load once `update` /
   * `updateNow` has put the focus near the park, so call one of those first.
   */
  get ready(): Promise<void> {
    return this.parkCars?.ready ?? Promise.resolve();
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
  /** `budgetMs`: this frame's share of time for a rebuild job (default the `budgetMs` option). */
  update(focus: Vector3, budgetMs?: number): void {
    this.parkCars?.update(focus, this.filter('team_car'));
    if (worldUniforms.wsTime.value >= this.fadeEnd) this.endFades();
    if (!this.job) {
      const rebuild = this.opts.rebuildDistance ?? 10;
      if (this.lastFocus.distanceToSquared(focus) >= rebuild * rebuild) {
        this.lastFocus.copy(focus);
        this.rebuiltAt = performance.now();
        this.builtSince = false;
        this.job = this.rebuildJob(focus.clone());
      }
    }
    if (this.job) {
      const t0 = performance.now();
      const budget = budgetMs ?? this.opts.budgetMs ?? 2;
      while (performance.now() - t0 < budget) {
        if (this.job.next().done) {
          this.job = null;
          break;
        }
      }
    }
    if (this.opts.prefetch) this.prefetch();
    this.flushPacks();
  }

  /** Pack the angle-binned buckets moves changed since the last pack (one pack per bucket per frame). */
  private flushPacks(): void {
    if (!this.dirty.size) return;
    for (const b of this.dirty) if (this.buckets.get(b.key) === b) this.pack(b);
    this.dirty.clear();
  }

  /**
   * Gets the `lazy` levels built, the most urgent first: a few at a time in the worker, or (no worker) one on this
   * thread now and then, never more than a quarter of the time. Once some have arrived, a rebuild puts them to use.
   */
  private prefetch(): void {
    const now = performance.now();
    for (let w = this.queue.next(Infinity); w; w = this.queue.next(Infinity)) {
      if (canBuildAway(w.asset)) {
        if (this.pending >= MAX_PENDING) break;
        this.queue.done(w);
        this.request(w);
        continue;
      }
      if (now < this.resumeAt) break;
      this.queue.done(w);
      getAsset(w.asset, w.variant, w.lod);
      const end = performance.now();
      this.resumeAt = end + Math.max(GAP_MS, SHARE * (end - now));
      this.builtSince = true;
      break;
    }
    this.evict(now);
    if (this.builtSince && !this.job && now - this.rebuiltAt > 1000) {
      this.builtSince = false;
      this.invalidate();
    }
  }

  /** Drops detailed people nobody has drawn for a while once the built ones hold more than LAZY_BUDGET (every 2 s at most). */
  private evict(now: number): void {
    if (now < this.evictAt) return;
    this.evictAt = now + 2000;
    const held: Held[] = [];
    for (const [key, b] of this.buckets)
      if (b.lazy)
        held.push({
          key,
          bytes: b.meshes.reduce((n, m) => n + geometryBytes(m.geometry), 0),
          used: b.used,
          idle: !b.count && !b.sCount,
        });
    for (const key of evictions(held, this.commits, LAZY_BUDGET, LAZY_GRACE)) {
      const b = this.buckets.get(key)!;
      disposeBucket(b, this.group);
      this.buckets.delete(key);
      const [id, variant, lod] = key.split(':');
      evictAsset(id, Number(variant), Number(lod));
    }
  }

  private request(w: Want): void {
    this.pending++;
    const sent = requestAsset(w.asset, w.variant, w.lod, () => {
      this.builtSince = true;
      if (--this.pending === 0) for (const f of this.idle.splice(0)) f();
    });
    if (!sent) this.pending--;
  }

  /** Resolves when the worker has built every level asked of it (loading screens: then `updateNow` stages them). */
  whenBuilt(): Promise<void> {
    return this.pending
      ? new Promise((resolve) => this.idle.push(resolve))
      : Promise.resolve();
  }

  /** Rebuild synchronously (loading screens, tools). */
  updateNow(focus: Vector3): void {
    this.parkCars?.update(focus, this.filter('team_car'));
    this.lastFocus.copy(focus);
    // With `prefetch`: the levels the view needs (wanted at slack 0) are requested from the worker (`whenBuilt`, then
    // stage again) or, without one, built here and staged again.
    for (let pass = 0; pass < 3; pass++) {
      const job = this.rebuildJob(focus.clone(), false);
      while (!job.next().done);
      this.job = null;
      if (!this.opts.prefetch) break;
      let inline = false;
      for (let w = this.queue.next(0); w; w = this.queue.next(0)) {
        this.queue.done(w);
        if (canBuildAway(w.asset)) this.request(w);
        else {
          getAsset(w.asset, w.variant, w.lod);
          inline = true;
        }
      }
      if (!inline) break;
    }
    this.flushPacks();
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
    this.dirty.clear();
  }

  private *rebuildJob(focus: Vector3, limit = true): Generator<void> {
    this.fresh = limit ? 0 : -Infinity;
    for (const b of this.buckets.values()) {
      b.sCount = 0;
      b.sFading = false;
      b.sOut = false;
    }
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
    const nRange = Math.min(maxD, this.nearDetailRange * lodScale);
    const b = this.world.map.bounds;
    let drawn = 0;
    const fade = !!this.opts.fade;
    const fadeRing = (this.opts.rebuildDistance ?? 10) + FADE_IN_MARGIN;
    // Chunks are swept this much further for the fading assets (their instances fade in from past their last level).
    const ring = fade ? fadeRing : 0;
    const now = worldUniforms.wsTime.value;
    this.starting.length = 0;
    this.startBuckets.length = 0;
    this.startSlots.length = 0;

    const visit = (list: ScatterInstance[], detail: boolean) => {
      for (const inst of list) {
        // Trees are drawn by trees/draw.ts (TreeRenderer).
        if (inst.tree || !this.filter(inst.asset)) continue;
        // A lot that shows only up close (`ServiceLot.showWithin`).
        if (
          inst.showWithin !== undefined &&
          Math.hypot(inst.x - focus.x, inst.z - focus.z) > inst.showWithin
        )
          continue;
        if (
          detail &&
          hash3(Math.floor(inst.x * 10), Math.floor(inst.z * 10), 3) /
            4294967296 >
            this.opts.detailDensity
        )
          continue;
        const dx = inst.x - focus.x;
        const dz = inst.z - focus.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const s = inst.streamed as InstanceData | undefined;
        const known = s?.owner === this.owner ? s : undefined;
        const meta = known?.meta ?? getAssetMeta(inst.asset);
        // Past every level (fading assets: past the ring they fade in from) and idle (nothing drawn, no fade
        // running): no bookkeeping at all.
        if (!known || (!known.fading && known.lod < 0)) {
          const reach =
            meta.lods[meta.lods.length - 1].maxDistance * lodScale +
            (fade && meta.fade ? fadeRing : 0);
          if (dist >= reach) continue;
        }
        // The extra grass near the roads (catalog `nearBoost`): the quality preset's share of it (`grassNear`).
        // Before `dataOf`: the grass this skips allocates nothing.
        const boost = meta.nearBoost;
        if (inst.extra && boost) {
          const keep =
            (Math.min(boost, this.opts.grassNear ?? 1) - 1) / (boost - 1);
          if (
            hash3(Math.floor(inst.x * 10), Math.floor(inst.z * 10), 7) /
              4294967296 >=
            keep
          )
            continue;
        }
        const d = known ?? this.dataOf(inst);
        const lods = d.meta.lods;
        let lod = -1;
        if (dist <= maxD) {
          // Near LOD by road distance (catalog `nearRoad`), fixed per instance: nothing swaps as the car drives on.
          const first = d.meta.nearRoad !== undefined && !inst.near ? 1 : 0;
          for (let i = first; i < lods.length; i++) {
            if (dist < lods[i].maxDistance * lodScale) {
              lod = i;
              break;
            }
          }
        }
        if (fade && d.meta.fade) {
          if (lod >= 0 && this.opts.prefetch)
            lod = this.built(inst, d, lod, dist);
          // While driving (`limit`), an instance new to the stream that lands inside a level fades in: one the last
          // rebuild did not track (beyond its fade ring, after a long rebuild step) would otherwise pop in.
          nextFade(d, lod, this.commits, now, limit);
          if (d.fading && d.start === START_AT_COMMIT) this.starting.push(d);
          if (!d.fading) {
            if (d.lod >= 0) this.stage(inst, d, d.lod, dist);
          } else {
            if (d.lod >= 0) this.stage(inst, d, d.lod, dist, FADE_IN, d.start);
            if (d.from >= 0)
              this.stage(inst, d, d.from, dist, FADE_OUT, d.start);
          }
          if (d.lod >= 0) drawn++;
          continue;
        }
        if (lod < 0) continue;
        this.stage(inst, d, lod, dist);
        drawn++;
      }
    };

    const span = (r: number, lo: number, hi: number, c: number) => [
      Math.floor(Math.max(lo, c - r) / cs),
      Math.floor(Math.min(hi, c + r) / cs),
    ];
    const [x0, x1] = span(range + ring, b.minX - 300, b.maxX + 300, focus.x);
    const [z0, z1] = span(range + ring, b.minZ - 300, b.maxZ + 300, focus.z);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const near =
          Math.hypot((cx + 0.5) * cs - focus.x, (cz + 0.5) * cs - focus.z) -
          cs * 0.71;
        if (near > range + ring) continue;
        const list = scatter.chunk(cx, cz).instances;
        // A far chunk of short-range assets (bushes, orchards, rocks) has nothing to draw: skip its instances. The
        // fade ring too: an instance must be tracked before it reaches its last level, or it pops in.
        if (near <= this.reachOf(list) * lodScale + ring) visit(list, false);
        // Grass needs the 1 m heightfield; skip until terrain streaming has built it.
        const inD = dRange > 0 && near < dRange + ring;
        const inN = nRange > 0 && near < nRange + ring;
        if (
          this.opts.detailDensity > 0 &&
          (inD || inN) &&
          this.world.heightfield.hasChunk(cx, cz)
        ) {
          if (inD) visit(yield* scatter.detailSteps(cx, cz), true);
          if (inN) visit(yield* scatter.nearDetailSteps(cx, cz), true);
        }
        yield;
      }
    }
    if (dRange > 0 || nRange > 0)
      scatter.pruneDetail(focus.x, focus.z, dRange * 2 + cs, nRange * 2 + cs);
    // Generated chunks stay out to past the view distance: the tree job (trees/draw.ts) reads them that far.
    scatter.pruneChunks(
      focus.x,
      focus.z,
      (Number.isFinite(maxD) ? maxD : range) * 1.25 + cs,
    );
    this.sortX = focus.x;
    this.sortZ = focus.z;
    this.queue.swap();
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
    if (d.slot) for (const s of d.slot) this.patch(s.bucket, s.i, d.m);
    if (!m) d.slot = d.staged = null;
  }

  private patch(b: Bucket, i: number, m: Float32Array): void {
    if (i >= b.count) return;
    const pos = b.order[i];
    b.cMat.set(m, pos * 16);
    if (b.binStart) {
      this.dirty.add(b);
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
        if (inst.tree || seen.has(inst.asset)) continue;
        seen.add(inst.asset);
        const lods = getAssetMeta(inst.asset).lods;
        r = Math.max(r, lods[lods.length - 1].maxDistance);
      }
      this.reach.set(list, r);
    }
    return r;
  }

  private dataOf(inst: ScatterInstance): InstanceData {
    let d = inst.streamed as InstanceData | undefined;
    if (d?.owner !== this.owner) {
      const meta = getAssetMeta(inst.asset);
      const tint = meta.tint ?? 0;
      const t =
        1 +
        ((hash3(Math.floor(inst.x * 7), Math.floor(inst.z * 7), 1) /
          4294967296) *
          2 -
          1) *
          tint;
      let r = t;
      let g = t * (1 + tint * 0.15);
      let b = t;
      let variant = inst.variant;
      if (meta.patches) {
        const p = meadowPatch(inst.x, inst.z, meta.patches, _patch);
        r *= p[0];
        g *= p[1];
        b *= p[2];
        // Two-variant grass: the drier variant 0 in the dry patches, 1 in the lush ones (never all one).
        if (meta.variants === 2)
          variant =
            hash3(Math.floor(inst.x * 7), Math.floor(inst.z * 7), 5) /
              4294967296 <
            0.15 + 0.7 * p[3]
              ? 0
              : 1;
      }
      d = {
        m: placedMatrix(inst, new Float32Array(16)),
        t: r,
        tg: g,
        tb: b,
        meta,
        variant,
        keys: this.keysOf(inst.asset, variant, meta),
        owner: this.owner,
        // (lod-fade.ts newFadeState)
        lod: -1,
        from: -1,
        fading: false,
        start: 0,
        seen: -2,
      };
      inst.streamed = d;
    }
    return d;
  }

  /** Bucket key per LOD of an asset variant. */
  private keysOf(asset: string, variant: number, meta: AssetMeta): string[] {
    let byVariant = this.keys.get(asset);
    if (!byVariant) this.keys.set(asset, (byVariant = []));
    // Far LODs flagged `oneVariant` share one bucket (getAsset draws variant 0 for them), variant sets too ('v').
    return (byVariant[variant] ??= meta.lods.map(
      (l, lod) =>
        `${asset}:${getVariantSet(asset, lod) ? 'v' : l.oneVariant ? 0 : variant}:${lod}`,
    ));
  }

  private stage(
    inst: ScatterInstance,
    d: InstanceData,
    lod: number,
    dist: number,
    role = 0,
    start = 0,
  ): void {
    // (A fading asset has picked its built level already.)
    if (this.opts.prefetch && !(this.opts.fade && d.meta.fade))
      lod = this.built(inst, d, lod, dist);
    const key = d.keys[lod];
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = newBucket(key, d.meta, lod, !!this.opts.fade);
      this.buckets.set(key, bucket);
      // (The meadow patches may pick another variant than the scatter's: `dataOf`.)
      this.createMeshes(
        bucket,
        { asset: inst.asset, variant: d.variant } as ScatterInstance,
        lod,
        64,
      );
      if (bucket.lazy) this.fresh++;
    }
    bucket.used = this.commits;
    const i = bucket.sCount++;
    if (this.moved.has(d)) (d.staged ??= []).push({ bucket, i });
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
      if (bucket.fades) {
        const f = new Float32Array(bucket.sFade.length * 2);
        f.set(bucket.sFade);
        bucket.sFade = f;
      }
    }
    bucket.sMat.set(d.m, i * 16);
    if (bucket.variants) bucket.sVar[i] = d.variant;
    if (bucket.fades) {
      bucket.sFade[i * 2] = start;
      bucket.sFade[i * 2 + 1] = role;
      if (role !== FADE_SOLID) bucket.sFading = true;
      if (role === FADE_OUT) bucket.sOut = true;
      if (start === START_AT_COMMIT) {
        this.startBuckets.push(bucket);
        this.startSlots.push(i);
      }
    }
    if (bucket.tinted) {
      bucket.sCol[i * 3] = d.t;
      bucket.sCol[i * 3 + 1] = d.tg;
      bucket.sCol[i * 3 + 2] = d.tb;
    }
  }

  /**
   * The LOD an instance is drawn at: a `lazy` level that is not built yet is asked for (the queue builds the one
   * nearest to being needed first) and the next cheaper level stands in. The level in front of this one is asked for
   * ahead of time, so it is there when the instance gets close.
   */
  private built(
    inst: ScatterInstance,
    d: InstanceData,
    lod: number,
    dist: number,
  ): number {
    const lods = d.meta.lods;
    if (lod > 0 && lods[lod - 1].lazy) this.ask(inst, d, lod - 1, dist);
    while (lod < lods.length - 1 && lods[lod].lazy) {
      const have = hasAsset(inst.asset, inst.variant, lod);
      if (have && (this.buckets.has(d.keys[lod]) || this.fresh < MAX_FRESH))
        break;
      // Built but not drawn yet: only a few new levels per rebuild, their buffers upload in the next frames, not all at once.
      if (have) this.builtSince = true;
      this.ask(inst, d, lod, dist);
      lod++;
    }
    return lod;
  }

  private ask(
    inst: ScatterInstance,
    d: InstanceData,
    lod: number,
    dist: number,
  ): void {
    if (hasAsset(inst.asset, inst.variant, lod)) return;
    this.queue.want({
      key: d.keys[lod],
      asset: inst.asset,
      variant: inst.variant,
      lod,
      slack: dist - d.meta.lods[lod].maxDistance * this.opts.lodScale,
    });
  }

  /** Staging -> committed copy (angle-sorted for culled buckets) -> GPU buffers, uploading only the used range. */
  private commit(): void {
    for (const d of this.moved) d.slot = d.staged;
    // Fades start now (their first frame); the staged copies say so with START_AT_COMMIT.
    const now = worldUniforms.wsTime.value;
    for (const f of this.starting) f.start = now;
    this.starting.length = 0;
    for (let k = 0; k < this.startSlots.length; k++)
      this.startBuckets[k].sFade[this.startSlots[k] * 2] = now;
    this.startBuckets.length = 0;
    this.startSlots.length = 0;
    let fading = false;
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
      if (b.fades) {
        this.setFading(b, b.sFading);
        b.out = b.sOut;
        if (b.sFading) fading = true;
      }
    }
    this.fadeEnd = fading ? now + LOD_FADE_TIME : Infinity;
    // A move during the job staged the old matrix: draw the current one.
    for (const d of this.moved)
      if (d.slot) for (const s of d.slot) this.patch(s.bucket, s.i, d.m);
  }

  /** Copy the staged instances into the committed arrays; buckets without shadows bin-sorted by angle. */
  private sortCommitted(b: Bucket): void {
    const n = b.count;
    if (b.cMat.length < n * 16) {
      b.cMat = new Float32Array(b.sMat.length);
      b.cCol = new Float32Array(b.sCol.length);
      b.cVar = new Float32Array(b.sVar.length);
      b.cFade = new Float32Array(b.sFade.length);
    }
    if (b.order.length < n) b.order = new Uint32Array(b.sMat.length / 16);
    if (b.castShadow || n < 64) {
      b.cMat.set(b.sMat.subarray(0, n * 16));
      if (b.tinted) b.cCol.set(b.sCol.subarray(0, n * 3));
      if (b.variants) b.cVar.set(b.sVar.subarray(0, n));
      if (b.fades) b.cFade.set(b.sFade.subarray(0, n * 2));
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
      if (b.fades) {
        b.cFade[pos * 2] = b.sFade[i * 2];
        b.cFade[pos * 2 + 1] = b.sFade[i * 2 + 1];
      }
    }
  }

  /** Committed -> GPU: everything, or only the bins of the view window (1 or 2 contiguous ranges). */
  private pack(b: Bucket): void {
    // Flat [from, to) pairs.
    const ranges = _ranges;
    ranges.length = 0;
    const start = b.binStart;
    if (!start || !this.view) ranges.push(0, b.count);
    else {
      const k = BINS / (2 * Math.PI);
      // Angles were measured from the commit focus; the camera stays near it (rebuildDistance).
      const lo = Math.floor((this.view.yaw - this.view.half + Math.PI) * k);
      const hi = Math.floor((this.view.yaw + this.view.half + Math.PI) * k);
      if (hi - lo >= BINS - 1) ranges.push(0, b.count);
      else {
        ranges.push(start[0], start[1]);
        for (let bin = lo; bin <= hi;) {
          const w = ((bin % BINS) + BINS) % BINS;
          const end = Math.min(hi, bin + (BINS - 1 - w));
          ranges.push(start[w + 1], start[w + 1 + (end - bin) + 1]);
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
      const fa = b.fades
        ? (mesh.geometry.getAttribute('instFade') as InstancedBufferAttribute)
        : null;
      n = 0;
      for (let k = 0; k < ranges.length; k += 2) {
        const r0 = ranges[k];
        const r1 = ranges[k + 1];
        if (r1 <= r0) continue;
        arr.set(b.cMat.subarray(r0 * 16, r1 * 16), n * 16);
        if (ic)
          (ic.array as Float32Array).set(
            b.cCol.subarray(r0 * 3, r1 * 3),
            n * 3,
          );
        if (iv) (iv.array as Float32Array).set(b.cVar.subarray(r0, r1), n);
        if (fa)
          (fa.array as Float32Array).set(
            b.cFade.subarray(r0 * 2, r1 * 2),
            n * 2,
          );
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
      if (fa) {
        fa.clearUpdateRanges();
        fa.addUpdateRange(0, n * 2);
        fa.needsUpdate = true;
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
    // Growth: the old wrappers' per-instance buffers are too small; free them (a replaced attribute's GL buffer would
    // never be) and wrap anew.
    for (const g of bucket.geometries) disposeWrapper(g);
    bucket.geometries = [];
    const set = bucket.variants ? getVariantSet(inst.asset, lod) : null;
    const asset = set ?? getAsset(inst.asset, inst.variant, lod);
    bucket.meshes = asset.parts.map((part, pi) => {
      let geometry = part.geometry;
      if (set || bucket.fades) {
        // A wrapper sharing the cached vertex buffers, carrying this bucket's per-instance variants / fades.
        geometry = bucket.geometries[pi] ??= shareAttributes(part.geometry);
      }
      if (set) {
        const iv = new InstancedBufferAttribute(new Float32Array(cap), 1);
        iv.setUsage(DynamicDrawUsage);
        geometry.setAttribute('instVariant', iv);
      }
      const depth = set ? variantDepthMaterial(part.material) : undefined;
      if (bucket.fades) {
        const fa = new InstancedBufferAttribute(new Float32Array(cap * 2), 2);
        fa.setUsage(DynamicDrawUsage);
        geometry.setAttribute('instFade', fa);
        bucket.plainMats[pi] = part.material;
        bucket.fadeMats[pi] = lodFadeMaterial(part.material);
        bucket.plainDepth[pi] = depth;
        bucket.fadeDepth[pi] = bucket.castShadow
          ? lodFadeDepthMaterial(part.material, !!set)
          : depth;
      }
      const mesh = new InstancedMesh(geometry, part.material, cap);
      if (depth) mesh.customDepthMaterial = depth;
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
      // Never moved (the instances carry the transforms): no matrix compose for ~500 meshes every frame.
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      mesh.name = `${inst.asset}#${set ? 'all' : inst.variant} lod${lod}`;
      this.group.add(mesh);
      return mesh;
    });
    bucket.capacity = cap;
    if (bucket.fading) {
      bucket.fading = false;
      this.setFading(bucket, true);
    }
  }

  /** Draw a fading bucket with the fade materials (a copy of it is fading) or the plain ones. */
  private setFading(b: Bucket, on: boolean): void {
    if (b.fading === on) return;
    b.fading = on;
    b.meshes.forEach((mesh, pi) => {
      mesh.material = on ? b.fadeMats[pi] : b.plainMats[pi];
      mesh.customDepthMaterial = on ? b.fadeDepth[pi] : b.plainDepth[pi];
    });
  }

  /**
   * Every fade of the last commit has ended: buckets with only incoming copies draw with their plain materials again,
   * without waiting for the next rebuild. One with outgoing copies keeps its fade materials (those copies stay
   * collapsed to a point in the vertex shader) until the next commit drops them: no scan or re-upload in this frame.
   */
  private endFades(): void {
    this.fadeEnd = Infinity;
    for (const b of this.buckets.values())
      if (b.fading && !b.out) this.setFading(b, false);
  }

  /**
   * Create every (asset, variant, LOD) bucket the map can use and make them
   * visible so renderer.compile() builds all shader programs at load time
   * (avoids a hitch the first time e.g. a far LOD appears). Call before compile;
   * the next commit sets visibility correctly again.
   */
  prewarm(): void {
    for (const id of assetIds(this.world)) {
      const meta = getAssetMeta(id);
      for (let v = 0; v < meta.variants; v++) {
        for (let lod = 0; lod < meta.lods.length; lod++) {
          // Lazy levels: only the variants that cover every material (the rest comes through the queue).
          if (
            this.opts.prefetch &&
            meta.lods[lod].lazy &&
            !(meta.warm ?? [0]).includes(v)
          )
            continue;
          const set = !!getVariantSet(id, lod);
          if (v > 0 && (meta.lods[lod].oneVariant || set)) continue;
          const key = `${id}:${set ? 'v' : v}:${lod}`;
          if (!this.buckets.has(key)) {
            const bucket = newBucket(key, meta, lod, !!this.opts.fade);
            this.buckets.set(key, bucket);
            this.createMeshes(
              bucket,
              { asset: id, variant: v } as ScatterInstance,
              lod,
              64,
            );
          }
          const bucket = this.buckets.get(key)!;
          for (const m of bucket.meshes) m.visible = true;
          // The fade programs too (a fade's first frame must not compile one).
          if (bucket.fades)
            bucket.meshes.forEach((m, pi) => {
              const twin = new InstancedMesh(
                m.geometry,
                bucket.fadeMats[pi],
                1,
              );
              // Same program inputs as the mesh: instance colours, shadows.
              if (m.instanceColor)
                twin.instanceColor = new InstancedBufferAttribute(
                  new Float32Array(3).fill(1),
                  3,
                );
              twin.customDepthMaterial = bucket.fadeDepth[pi];
              twin.castShadow = bucket.castShadow;
              twin.receiveShadow = m.receiveShadow;
              twin.frustumCulled = false;
              this.warmTwins.push(twin);
              this.group.add(twin);
            });
        }
      }
    }
    this.parkCars?.prewarm();
  }

  /** Re-apply visibility after prewarm/compile. */
  settle(): void {
    for (const t of this.warmTwins.splice(0)) {
      this.group.remove(t);
      t.dispose();
    }
    for (const b of this.buckets.values())
      for (const m of b.meshes) m.visible = m.count > 0;
    this.parkCars?.settle();
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
    for (const b of this.buckets.values()) disposeBucket(b, this.group);
    this.buckets.clear();
    this.dirty.clear();
    this.group.clear();
    this.parkCars?.dispose();
  }

  /** Drop every bucket and cached bucket key and rebuild from scratch (after `setVariantSets`; dev A/B). */
  reset(focus: Vector3): void {
    this.dispose();
    this.owner = {};
    this.keys.clear();
    this.moved.clear();
    this.job = null;
    if (this.parkCars) this.group.add(this.parkCars.group);
    this.updateNow(focus);
  }
}

/** Every catalog asset the map places (tree types are not assets: trees/). */
export function assetIds(world: World): Set<string> {
  // Scatter rules of other seasons place nothing (world.ts): their assets would only cost prewarm and downloads.
  const season = mapSeason(world.map.environment);
  const ids = new Set([
    ...world.map.scatter
      .filter((r) => !r.season || r.season.includes(season))
      .map((r) => r.asset),
    ...world.map.roadside.map((r) => r.asset),
    ...(world.stageDef.cornerFans ? CORNER_FAN_ASSETS : []),
    ...(world.stageDef.servicePark ? SERVICE_PARK_ASSETS : []),
    ...world.map.props.map((p) => p.asset),
    ...(world.stageDef.props ?? []).map((p) => p.asset),
    // The pack models standing in for generated trees near the road.
    ...Object.values(world.map.heroTrees?.swap ?? {}).map((s) => s.asset),
  ]);
  // Placed by the world itself (gore cushions, catenary masts, pylons, street dressing ...): `prewarm` must cover them
  // too, or their shaders compile when the first one streams in (a 1-4 s freeze on a fresh shader cache).
  for (const inst of world.scatter.fixedInstances())
    if (isCatalogAsset(inst.asset)) ids.add(inst.asset);
  if (ids.has('tape_post')) ids.add('tape_span');
  for (const id of ids) if (isTreeType(id)) ids.delete(id);
  return ids;
}

/** Bytes of a geometry's buffers (what building it cost in memory, and on the GPU once drawn). */
function geometryBytes(g: BufferGeometry): number {
  let n = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) n += a.array.byteLength;
  return n;
}

let _bins = new Uint16Array(4096);
const _ranges: number[] = [];
const _cursor = new Uint32Array(BINS + 1);

function newBucket(
  key: string,
  meta: AssetMeta,
  lod: number,
  fade: boolean,
): Bucket {
  const tinted = (meta.tint ?? 0) > 0;
  const variants = key.split(':')[1] === 'v';
  const fades = fade && !!meta.fade;
  return {
    key,
    meshes: [],
    capacity: 0,
    count: 0,
    castShadow: meta.lods[lod].castShadow,
    tinted,
    variants,
    fades,
    sFading: false,
    fading: false,
    sOut: false,
    out: false,
    plainMats: [],
    fadeMats: [],
    plainDepth: [],
    fadeDepth: [],
    geometries: [],
    cMat: new Float32Array(16 * 64),
    cCol: new Float32Array(tinted ? 3 * 64 : 0),
    cVar: new Float32Array(variants ? 64 : 0),
    cFade: new Float32Array(fades ? 128 : 0),
    order: new Uint32Array(64),
    binStart: null,
    drawnCount: 0,
    lazy: !!meta.lods[lod].lazy,
    used: 0,
    sMat: new Float32Array(16 * 64),
    sCol: new Float32Array(tinted ? 3 * 64 : 0),
    sVar: new Float32Array(variants ? 64 : 0),
    sFade: new Float32Array(fades ? 128 : 0),
    sCount: 0,
  };
}

/** A geometry drawing the same vertex buffers as `src` (shared attribute objects = shared GPU buffers). */
function shareAttributes(src: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes))
    g.setAttribute(name, attr);
  g.setIndex(src.index);
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

/** Per-instance attributes a `shareAttributes` wrapper owns (the rest are the cached asset's). */
const OWN_ATTRIBUTES = new Set(['instVariant', 'instFade']);

/**
 * Free a `shareAttributes` wrapper's own GPU state (its per-instance buffers, its vertex array objects) and not the
 * shared vertex / index buffers: three's `dispose` frees every attribute the geometry holds, so those go first.
 */
function disposeWrapper(g: BufferGeometry): void {
  for (const name of Object.keys(g.attributes))
    if (!OWN_ATTRIBUTES.has(name)) g.deleteAttribute(name);
  g.setIndex(null);
  g.dispose();
}

/** Free a bucket's meshes (their instance buffers) and wrappers; the asset's geometry and materials are shared. */
function disposeBucket(b: Bucket, group: Group): void {
  for (const m of b.meshes) {
    group.remove(m);
    m.dispose();
  }
  for (const g of b.geometries) disposeWrapper(g);
  b.geometries = [];
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
