import {
  BufferAttribute,
  BufferGeometry,
  WebGLRenderTarget,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { ScatterInstance } from '../world/scatter';
import type { World } from '../world/world';
import type { LoadedVariant, TreeLibrary } from './load';
import {
  barkMaterial,
  setSpritePrepass,
  setSpritePrepassDebug,
  spriteMaterial,
  spritePrepassMaterial,
  treeDepthMaterial,
  treeUniforms,
} from './materials';
import { HeightGrid, Horizon } from './occlusion';
import { FULL_DETAIL_DISTANCE, lodOf } from './species';
import {
  emptyFrameStats,
  meshTriangles,
  TreeGpuTimer,
  type TreeFrameStats,
} from './stats';

/**
 * Stage 6, drawing (spec: trees/Lod.md, trees/Foliage.md, trees/Performance.md#mitigations): placed trees as
 * instances of their variant. Per variant: one InstancedMesh batch per branch level (LOD0, LOD1) and one for its
 * foliage sprites (drawn with both branch levels: a depth prepass, then the lit sprites); ONE batch for every
 * impostor (LOD2) of every species (the library's texture array).
 *
 * - **Selection** (Lod.md#selection), once per frame per tree, the same for every pass: the share of the screen
 *   height the tree's bounding sphere covers, from the camera position before shake and bounce
 *   (`update(camera, steady)`) and its field of view. Coarser below a threshold, finer only above it by the species'
 *   hysteresis margin; within FULL_DETAIL_DISTANCE always LOD0. Sprite thinning is not a level: the sprite shader
 *   does it continuously from the same height (trees/materials.ts).
 * - **Transition** (Lod.md#transition): each tree keeps (from, to, fade, direction). A level change starts a fade of
 *   the species' fixed time; changing back reverses it; a third level waits; at most MAX_FADES fade at once. The fade
 *   is one number per tree (`treeFade.x`). Sprites never fade between LOD0 and LOD1 (they are the same); towards the
 *   impostor they fade out against it.
 * - **Shadows** (Lod.md#shadows): the branches one level coarser than the settled level (LOD1) and the sprites, never
 *   the impostor, never dithered, switched when a fade ends, within `shadowDistance` only.
 * - **Batches:** a tree that is settled and keeps its level and shadow for every camera position and zoom until the
 *   next job sits in static batches, refilled by a time-sliced job every `rebuildDistance` of camera travel; every
 *   other tree is "active" and re-selected every frame into the dynamic batches. Far instances outside the
 *   horizontal view are left out of the GPU buffers.
 * - **Debug view** (Lod.md#debug-view, Drawing.md#debug): `debugMode` 1 = level tint, fades, flickering trees
 *   (flashing red, `flickering` counts them); 2 = lighting only; 3 = normals only; 4 = depth; 5 = sprite pixels the
 *   EQUAL-depth lit pass missed (magenta; with SPRITE_PREPASS). `?treedebug=1..5`.
 * - **Drawing** (Drawing.md): every tree mesh is opaque (no transparent / sorted queue, nothing sorted by distance):
 *   the depth buffer alone decides what is in front. Trunks stand sunk by their base radius (no z-fight with the
 *   ground).
 */

/** Levels: branches LOD0, LOD1, the impostor. */
export const IMPOSTOR = 2;
/** Re-pack the static view window after the camera turned this far (rad). */
const REPACK = (8 * Math.PI) / 180;
/**
 * Static membership is conservative over this much zoom (px ratio) before the next job, which starts once the field
 * of view moved half of it. Tiny: at the far threshold (~370 m) every 1% is a 4 m ring of per-frame trees, and the
 * field of view only changes with a camera switch (trees/Lod.md#active-set).
 */
const ZOOM_MARGIN = 1.004;
/** Camera jump (m) between two jobs that counts as a cut: every tree snaps to its level, nothing queues to fade. */
const CUT_DISTANCE = 50;
/** Roles in `treeFade.y` (trees/materials.ts). */
const SOLID = 0;
const OUTGOING = 1;
const INCOMING = 2;
const SHADOW_ONLY = 3;
/** Trees fading at once (trees/Performance.md#mitigations); a change beyond that waits for a free slot. */
export const MAX_FADES = 32;
/** Render order of the sprite depth prepass (before every other opaque draw). */
const PREPASS_ORDER = -10;
/**
 * The sprite depth prepass + EQUAL-depth lit pass (trees/Drawing.md#depth, Performance.md#mitigations) is on by
 * default; `?treeprepass=0` is its debug toggle. It needs the prepass and the lit program to compute bit-identical
 * depths (`invariant gl_Position`), which WebGL does not promise on every driver: `checkPrepass` renders it once at
 * load and turns it off if any sprite pixel failed its own EQUAL test (debug view 5 shows those in magenta).
 */
export const SPRITE_PREPASS =
  typeof location === 'undefined' ||
  new URLSearchParams(location.search).get('treeprepass') !== '0';
/** Share of the sprite pixels that may miss the EQUAL test before the load check turns the prepass off. */
const PREPASS_MISS_LIMIT = 0.002;
/**
 * Sprite batches per variant by the share of its rank-ordered sprites they draw (trees/Foliage.md#simplification):
 * a thinned crown is put in the smallest that still holds every sprite the shader keeps, so the sprites it shrank
 * away cost no vertices either. Part ids 3 + bucket.
 */
const KEEP = [1, 0.8, 0.6, 0.45, 0.3];
const SPRITE_PARTS = KEEP.map((_, i) => 3 + i);
/** The shader's sprite fade window (trees/materials.ts `treeSpriteScale`). */
const KEEP_WINDOW = 0.08;

/** Share of a crown's sprites the shader keeps at projected height h and distance dist (same formula). */
export function spriteKeep(
  h: number,
  dist: number,
  thin: number,
  impostor: number,
): number {
  if (dist < FULL_DETAIL_DISTANCE || h >= thin) return 1;
  return (
    1 -
    0.75 *
      Math.min(1, Math.max(0, Math.log(thin / h) / Math.log(thin / impostor)))
  );
}

/** Sprite part (3 + bucket) holding every sprite kept at share k. */
function spritePart(k: number): number {
  const need = Math.min(1, k * (1 + KEEP_WINDOW));
  let b = 0;
  while (b + 1 < KEEP.length && KEEP[b + 1] >= need) b++;
  return 3 + b;
}

export interface TreeRendererOptions {
  /** Divides every threshold (quality preset x draw distance option): higher = finer levels further away. */
  lodScale: number;
  /** Nothing is drawn further than this (m): the streamed terrain's view distance. */
  maxDistance: number;
  /** Trees within this distance cast shadows (the sun's shadow box). */
  shadowDistance: number;
  /** New job after the camera moved this far (m). */
  rebuildDistance?: number;
  /** Max ms per frame for a job. */
  budgetMs?: number;
}

interface Budget {
  /** Branch thresholds: LOD0 -> LOD1, LOD1 -> impostor (scaled by lodScale). */
  t: number[];
  /** Sprite thinning threshold (scaled). */
  thin: number;
  hysteresis: number;
  fadeTime: number;
}

interface TreeState extends FadeState {
  m: Float32Array;
  inst: [number, number, number, number];
  lv: LoadedVariant;
  /** Bounding sphere centre (world) and diameter (m); centre height above the foot (m). */
  cx: number;
  cy: number;
  cz: number;
  diameter: number;
  rise: number;
  /** Times (s) of the last level changes (debug view). */
  changes: number[];
  /** Frame it was last seen by a job or drawn: a tree absent longer is new again (takes its level at once). */
  seen: number;
  /** Was in the view window last frame. */
  visible: boolean;
  /** Job that last put it in a static batch. */
  staticJob: number;
  /** Its variant's dynamic batches: LOD0, LOD1 branches, then the sprite buckets (KEEP). */
  batches: Batch[];
  budget: Budget;
}

/** Horizontal half-angle a tree (bounding radius r) at distance d covers beyond its centre's direction. */
function spread(r: number, d: number): number {
  return d > r ? Math.asin(r / d) : Math.PI;
}

interface Batch {
  meshes: InstancedMesh[];
  geometries: BufferGeometry[];
  capacity: number;
  count: number;
  mat: Float32Array;
  inst: Float32Array;
  fade: Float32Array;
  lod: Float32Array;
  aMat: InstancedBufferAttribute | null;
  aInst: InstancedBufferAttribute | null;
  aFade: InstancedBufferAttribute | null;
  aLod: InstancedBufferAttribute | null;
  /** Sprites per instance (sprite batches; 0 otherwise) and how many instances the main pass draws. */
  sprites: number;
  solid: number;
  /** Static batches: the shadow casters are packed first, and the shadow pass draws only them (-1 = every instance). */
  casters: number;
}

/** A batch filled by the job: staged / committed instances, packed for the view window at commit or repack. */
interface StaticBatch extends Batch {
  level: number;
  s: Staged;
  c: Staged;
}

interface Staged {
  mat: Float32Array;
  inst: Float32Array;
  fade: Float32Array;
  lod: Float32Array;
  angle: Float32Array;
  /** Half-angle the instance may cover around `angle` for any camera in the job's window. */
  spread: Float32Array;
  always: Float32Array;
  count: number;
}

/** The one impostor batch: static instances (packed at commit / repack) first, then this frame's dynamic ones. */
interface ImpostorBatch extends Batch {
  s: Staged;
  c: Staged;
  packed: number;
  dirty: boolean;
}

/** treeFade of a static impostor: solid, no shadow, debug level 2. */
const STATIC_IMPOSTOR = [1, SOLID, 0, IMPOSTOR];

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _dir = new Vector3();

let quad: BufferGeometry | null = null;
/** Impostor billboard: corners (-1..1)^2, the shader places it. */
function impostorQuad(): BufferGeometry {
  if (quad) return quad;
  quad = new BufferGeometry();
  quad.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      3,
    ),
  );
  quad.setAttribute(
    'normal',
    new BufferAttribute(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      3,
    ),
  );
  quad.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
  );
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  return quad;
}

function grow(a: Float32Array, n: number): Float32Array {
  if (a.length >= n) return a;
  let len = Math.max(64, a.length);
  while (len < n) len *= 2;
  const b = new Float32Array(len);
  b.set(a);
  return b;
}

function staged(): Staged {
  const f = () => new Float32Array(0);
  return {
    mat: f(),
    inst: f(),
    fade: f(),
    lod: f(),
    angle: f(),
    spread: f(),
    always: f(),
    count: 0,
  };
}

/** Branch level casting the shadow of a settled level (one coarser, never the impostor); -1 = none. */
function shadowLevel(level: number): number {
  return level >= IMPOSTOR ? -1 : 1;
}

/** Per-tree fade state (trees/Lod.md#transition): from `from` to `to`, `dir` -1 = reversing. Settled: from = to. */
export interface FadeState {
  from: number;
  to: number;
  fade: number;
  dir: number;
}

/** The level a fade is heading for (the settled level when not fading). */
export function fadeTarget(st: FadeState): number {
  return st.from === st.to || st.dir > 0 ? st.to : st.from;
}

/**
 * Level for projected height `h` (share of the screen height) from the current level: coarser below a threshold,
 * back to finer only above it by `margin` (the hysteresis). `t` = the branch thresholds, LOD0 -> LOD1 and
 * LOD1 -> impostor. Within FULL_DETAIL_DISTANCE (`dist`, m) always LOD0.
 */
export function selectLevel(
  h: number,
  current: number,
  t: readonly number[],
  margin: number,
  dist: number,
): number {
  if (dist < FULL_DETAIL_DISTANCE) return 0;
  let l = current;
  while (l < IMPOSTOR && h < t[l]) l++;
  while (l > 0 && h > t[l - 1] * (1 + margin)) l--;
  return l;
}

/**
 * One frame of a tree's fade towards the selected level `sel`. A change starts a fade of `fadeTime` s; changing
 * back reverses it from its current value; any other level waits until it ends. `snap` = take `sel` at once (culled,
 * coming into view). `canStart` = a fade slot is free (MAX_FADES): otherwise a settled tree keeps its level for now.
 * Returns true when a visible fade started or reversed (the debug view counts these).
 */
export function stepFade(
  st: FadeState,
  sel: number,
  snap: boolean,
  dt: number,
  fadeTime: number,
  canStart = true,
): boolean {
  const target = fadeTarget(st);
  let changed = false;
  if (snap) {
    // Not a visible change (the tree is out of view or just came into view): not counted.
    st.from = st.to = sel;
    st.fade = 1;
    st.dir = 1;
    return false;
  }
  if (st.from === st.to) {
    // No free fade slot: keep the level until one frees up (then a full fade).
    if (sel !== st.to && canStart) {
      st.from = st.to;
      st.to = sel;
      st.fade = 0;
      st.dir = 1;
      changed = true;
    }
  } else if (sel !== target && (sel === st.from || sel === st.to)) {
    st.dir = -st.dir;
    changed = true;
  }
  if (st.from !== st.to) {
    st.fade += (st.dir * dt) / fadeTime;
    if (st.fade >= 1) {
      st.from = st.to;
      st.fade = 1;
      st.dir = 1;
    } else if (st.fade <= 0) {
      st.to = st.from;
      st.fade = 1;
      st.dir = 1;
    }
  }
  return changed;
}

/**
 * Sprite role of a tree: they stay solid while the branches fade between LOD0 and LOD1, and fade out against the
 * impostor (with the role of the branch level on their side). -1 = no sprites (an impostor).
 */
export function spriteRole(st: FadeState): number {
  const a = st.from < IMPOSTOR;
  const b = st.to < IMPOSTOR;
  if (st.from === st.to) return a ? SOLID : -1;
  if (a && b) return SOLID;
  return a ? OUTGOING : INCOMING;
}

export class TreeRenderer {
  readonly group = new Group();
  /** Dynamic batches (refilled every frame) and static batches per variant: branch levels and sprites. */
  private dynamic = new Map<string, Batch>();
  private statics = new Map<string, StaticBatch>();
  private impostors: ImpostorBatch | null = null;
  private dynamicOf = new WeakMap<LoadedVariant, Batch[]>();
  private states = new WeakMap<ScatterInstance, TreeState | null>();
  private active: TreeState[] = [];
  private nextActive: TreeState[] = [];
  private job: Iterator<void> | null = null;
  private jobId = 0;
  private committedJob = -1;
  private lastFocus = new Vector3(Infinity, 0, 0);
  private lastPx = 0;
  private frame = 0;
  private time = 0;
  private lastNow = -1;
  private view: { yaw: number; half: number } | null = null;
  private packedView: { yaw: number; half: number } | null = null;
  private steadyPos = new Vector3();
  private budgets = new Map<string, Budget>();
  /** Sprite depth prepass on (SPRITE_PREPASS, unless `checkPrepass` failed) and its meshes. */
  private prepass = SPRITE_PREPASS;
  private prepassMeshes = new Set<InstancedMesh>();
  /** Terrain occlusion culling on (trees/occlusion.ts; `?treeocclusion=0` = its debug toggle) and its height grid. */
  occlusion =
    typeof location === 'undefined' ||
    new URLSearchParams(location.search).get('treeocclusion') !== '0';
  private heights: HeightGrid | null = null;
  /** Cells the last committed job checked and trees it left out as hidden by the terrain (the overlay). */
  lastJob = { cells: 0, occluded: 0 };
  /** The last job's horizon (debugging, tests). */
  horizon: Horizon | null = null;
  private litSprites = new Set<InstancedMesh>();
  /** Load check of the prepass: share of sprite pixels that failed the EQUAL test (NaN = not run). */
  prepassMisses = NaN;
  /** spread() of the tree the job is staging. */
  private jobSpread = 0;
  /** Instances drawn (main pass) this frame / trees flickering (debug view). */
  drawn = 0;
  flickering = 0;
  /** Last frame's tree cost counters (trees/Performance.md#counters). */
  stats: TreeFrameStats = emptyFrameStats();
  /** This frame's counters while they are collected (published as `stats` at the next update). */
  current: TreeFrameStats = emptyFrameStats();
  /** GPU timer of the tree draws (`attachRenderer`); runs while the debug view or a benchmark wants it. */
  timer: TreeGpuTimer | null = null;
  /** Keep the GPU timer running without the debug view (the benchmark). */
  measure = false;
  commits = 0;

  constructor(
    private world: World,
    private library: TreeLibrary,
    private opts: TreeRendererOptions,
  ) {
    this.group.name = 'trees';
    setSpritePrepass(this.prepass);
    treeUniforms.tlShadowD.value = opts.shadowDistance;
    const q =
      typeof location !== 'undefined'
        ? new URLSearchParams(location.search).get('treedebug')
        : null;
    if (q) this.debugMode = Number(q) || 1;
  }

  /** Debug view mode: 0 off, 1 levels / fades / flicker, 2 lighting only, 3 normals, 4 depth, 5 equal-test misses. */
  get debugMode(): number {
    return treeUniforms.tlDebug.value;
  }

  set debugMode(m: number) {
    treeUniforms.tlDebug.value = Math.max(0, Math.min(5, Math.round(m)));
    setSpritePrepassDebug(treeUniforms.tlDebug.value === 5);
  }

  /** Any debug mode on (the stats overlay shows with it). */
  get debug(): boolean {
    return this.debugMode > 0;
  }

  set debug(on: boolean) {
    this.debugMode = on ? Math.max(1, this.debugMode) : 0;
  }

  /** Next debug mode: off -> levels -> lighting only -> normals -> depth -> equal-test misses -> off. */
  cycleDebug(): number {
    this.debugMode = (this.debugMode + 1) % 6;
    return this.debugMode;
  }

  /** Which mitigations are on (trees/Performance.md#mitigations): the overlay and the benchmark show them. */
  mitigations(): Record<string, boolean> {
    return {
      occlusionCulling: this.occlusion,
      spritePrepass: this.prepass,
      shadowCascadeRules: true,
      spriteThinning: true,
    };
  }

  get lodScale(): number {
    return this.opts.lodScale;
  }

  setOptions(o: Partial<TreeRendererOptions>): void {
    Object.assign(this.opts, o);
    treeUniforms.tlShadowD.value = this.opts.shadowDistance;
    // Rescale the cached budgets in place (states hold them).
    for (const [name, b] of this.budgets) {
      const lv = this.library.all().find((v) => v.def.name === name);
      if (lv) Object.assign(b, this.makeBudget(lv));
    }
    this.lastFocus.set(Infinity, 0, 0);
  }

  /**
   * Call every frame after the camera moved. `steady` = the camera position before shake and bounce (the level
   * choice and the sprites must not follow them); the camera's own position when it has none.
   */
  update(camera: PerspectiveCamera, steady: Vector3 = camera.position): void {
    this.endFrameStats();
    const now = performance.now() / 1000;
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, now - this.lastNow);
    this.lastNow = now;
    this.time += dt;
    this.steadyPos.copy(steady);
    const px = this.pxOf(camera);
    if (!this.job) {
      const r = this.opts.rebuildDistance ?? 5;
      const zoom = this.lastPx ? Math.abs(px / this.lastPx - 1) : 1;
      const moved = this.lastFocus.distanceTo(steady);
      // A cut (reset, teleport): every tree takes its level at once, as one coming into view does.
      if (moved >= r || zoom > (ZOOM_MARGIN - 1) * 0.5)
        this.startJob(px, moved > CUT_DISTANCE);
    }
    if (this.job) {
      const t0 = performance.now();
      const budget = this.opts.budgetMs ?? 1.5;
      while (performance.now() - t0 < budget)
        if (this.job.next().done) {
          this.job = null;
          break;
        }
      this.current.jobMs = performance.now() - t0;
    }
    this.setView(camera);
    const t1 = performance.now();
    this.drawActive(px, dt);
    this.current.selectMs = performance.now() - t1;
  }

  /** GPU timing of the tree passes needs the renderer's WebGL2 context. */
  attachRenderer(renderer: WebGLRenderer): void {
    this.timer = new TreeGpuTimer(renderer);
  }

  /** The frame drawn since the last update is complete: publish its counters, start the next. */
  private endFrameStats(): void {
    if (this.timer) {
      this.timer.enabled = this.debug || this.measure;
      this.timer.endFrame();
      this.current.gpuMainMs = this.timer.mainMs;
      this.current.gpuShadowMs = this.timer.shadowMs;
    }
    this.stats = this.current;
    this.current = emptyFrameStats();
  }

  /** Build synchronously (loading screens, tools): every tree takes its level at once. */
  updateNow(
    camera: PerspectiveCamera,
    steady: Vector3 = camera.position,
  ): void {
    this.steadyPos.copy(steady);
    const px = this.pxOf(camera);
    this.startJob(px, true);
    while (!this.job!.next().done);
    this.job = null;
    this.setView(camera);
    this.drawActive(px, 0);
  }

  private pxOf(camera: PerspectiveCamera): number {
    camera.updateProjectionMatrix();
    // Share of the screen height per (m / m): a sphere of diameter D at distance d covers D * this / d.
    const px = camera.projectionMatrix.elements[5] / 2;
    treeUniforms.tlCam.value.copy(this.steadyPos);
    treeUniforms.tlPx.value = px;
    return px;
  }

  private startJob(px: number, cut = false): void {
    this.lastFocus.copy(this.steadyPos);
    this.lastPx = px;
    this.job = this.rebuild(this.steadyPos.clone(), px, cut);
  }

  private makeBudget(lv: LoadedVariant): Budget {
    const l = lodOf(lv.def);
    const k = 1 / this.opts.lodScale;
    return {
      t: [l.thresholds[1] * k, l.thresholds[2] * k],
      thin: l.thresholds[0] * k,
      hysteresis: l.hysteresis,
      fadeTime: l.fadeTime,
    };
  }

  /** A species' LOD budget with its thresholds scaled by the quality setting (cached; states hold it). */
  private budget(lv: LoadedVariant): Budget {
    let b = this.budgets.get(lv.def.name);
    if (!b) this.budgets.set(lv.def.name, (b = this.makeBudget(lv)));
    return b;
  }

  private stateOf(inst: ScatterInstance): TreeState | null {
    let st = this.states.get(inst);
    if (st !== undefined) return st;
    const lv = inst.tree
      ? this.library.variant(inst.tree.species, inst.variant)
      : undefined;
    if (!lv || !inst.tree) {
      this.states.set(inst, null);
      return null;
    }
    _e.set(inst.tiltX, inst.rotY, inst.tiltZ, 'YXZ');
    _q.setFromEuler(_e);
    // The trunk's base sunk below the ground by its radius: no shared surface, no z-fighting (trees/Drawing.md#depth).
    _m.compose(
      _p.set(inst.x, inst.y - lv.def.baseRadius * inst.scale, inst.z),
      _q,
      _s.setScalar(inst.scale),
    );
    st = {
      m: new Float32Array(_m.elements),
      // w: the variant's slot in the impostor texture array.
      inst: [inst.tree.hue, inst.tree.value, inst.tree.phase, lv.slot],
      lv,
      cx: inst.x,
      cy: inst.y + lv.info.sphere.cy * inst.scale,
      cz: inst.z,
      diameter: 2 * lv.info.sphere.r * inst.scale,
      rise: lv.info.sphere.cy * inst.scale,
      from: IMPOSTOR,
      to: IMPOSTOR,
      fade: 1,
      dir: 1,
      changes: [],
      seen: -10,
      visible: false,
      staticJob: -1,
      batches: this.batchesOf(lv),
      budget: this.budget(lv),
    };
    this.states.set(inst, st);
    return st;
  }

  /** treeLod of a tree: sphere centre rise, diameter, thinning and impostor thresholds (the sprite shader's input). */
  private lodOf(st: TreeState, out: Float32Array, i: number): void {
    out[i] = st.rise;
    out[i + 1] = st.diameter;
    out[i + 2] = st.budget.thin;
    out[i + 3] = st.budget.t[1];
  }

  /**
   * Time-sliced: sort trees in range into the active list (re-selected every frame) and the static batches: a tree
   * that is settled and keeps its level and shadow over every camera position and zoom until the next job (within
   * `rebuildDistance` + a margin) needs no per-frame selection.
   */
  private *rebuild(focus: Vector3, px: number, cut: boolean): Generator<void> {
    const job = ++this.jobId;
    for (const b of this.statics.values()) b.s.count = 0;
    this.impostorBatch().s.count = 0;
    this.nextActive.length = 0;
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const maxD = this.opts.maxDistance;
    const shadowD = this.opts.shadowDistance;
    const move = (this.opts.rebuildDistance ?? 5) + 4;
    const bounds = this.world.map.bounds;
    // Terrain occlusion (trees/occlusion.ts): the horizon from this focus, a few rays per slice.
    let horizon: Horizon | null = null;
    if (this.occlusion) {
      this.heights ??= new HeightGrid(
        (x, z) => this.world.analytic.height(x, z),
        {
          minX: bounds.minX - 300,
          maxX: bounds.maxX + 300,
          minZ: bounds.minZ - 300,
          maxZ: bounds.maxZ + 300,
        },
      );
      horizon = new Horizon(this.heights, focus, move, maxD);
      while (!horizon.step(64)) yield;
      this.horizon = horizon;
    }
    // Trees nearer than this always draw (they cast shadows and fill the full-detail distance).
    const occludeFrom = Math.max(shadowD, FULL_DETAIL_DISTANCE) + move;
    let cells = 0;
    let occluded = 0;
    const x0 = Math.floor(Math.max(bounds.minX - 300, focus.x - maxD) / cs);
    const x1 = Math.floor(Math.min(bounds.maxX + 300, focus.x + maxD) / cs);
    const z0 = Math.floor(Math.max(bounds.minZ - 300, focus.z - maxD) / cs);
    const z1 = Math.floor(Math.min(bounds.maxZ + 300, focus.z + maxD) / cs);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        if (
          Math.hypot((cx + 0.5) * cs - focus.x, (cz + 0.5) * cs - focus.z) -
            cs * 0.71 >
          maxD
        )
          continue;
        this.current.cellsChecked++;
        cells++;
        for (const inst of scatter.chunk(cx, cz).instances) {
          if (!inst.tree) continue;
          const st = this.stateOf(inst);
          if (!st) continue;
          const dx = st.cx - focus.x;
          const dy = st.cy - focus.y;
          const dz = st.cz - focus.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > maxD) continue;
          if (
            horizon &&
            dist > occludeFrom &&
            horizon.hides(st.cx, st.cy, st.cz, st.diameter / 2)
          ) {
            this.current.occluded++;
            occluded++;
            continue;
          }
          const { t, hysteresis: margin } = st.budget;
          // Neither drawn last frame nor in the last static batches (or a cut): new, it takes its level at once.
          if (
            cut ||
            (st.seen < this.frame - 1 && st.staticJob !== this.committedJob)
          ) {
            st.from = st.to = selectLevel(
              (st.diameter * px) / Math.max(dist, 0.5),
              IMPOSTOR,
              t,
              0,
              dist,
            );
            st.fade = 1;
            st.dir = 1;
          }
          st.seen = this.frame;
          const dMin = Math.max(dist - move, 0.5);
          const dMax = dist + move;
          const hMin = (st.diameter * px) / (ZOOM_MARGIN * dMax);
          const hMax = (st.diameter * px * ZOOM_MARGIN) / dMin;
          const l = st.to;
          // Settled at l for every camera in the window: LOD0 stays LOD0 inside the full-detail distance and above
          // its threshold outside it (so the full-detail line only activates trees whose level it changes); a coarser
          // level needs the whole window outside that distance and inside its hysteresis band.
          const steadyLevel =
            st.from === l &&
            (l === 0
              ? dMax < FULL_DETAIL_DISTANCE || hMin >= t[0]
              : dMin >= FULL_DETAIL_DISTANCE &&
                (l === IMPOSTOR || hMin >= t[l]) &&
                hMax <= t[l - 1] * (1 + margin));
          const angle = Math.atan2(dz, dx);
          this.jobSpread = spread(st.diameter / 2 + move, dist);
          if (steadyLevel) {
            // May come within the shadow distance: carries its shadow, which the shader keeps within tlShadowD (and
            // drawn whatever the view, for the shadows of trees behind the camera).
            const near = dMin < shadowD;
            if (l === IMPOSTOR) this.stageImpostor(st, angle);
            else {
              const sh = near ? shadowLevel(l) : -1;
              this.stageStatic(st, l, SOLID, sh === l, near, angle, l);
              if (sh >= 0 && sh !== l)
                this.stageStatic(st, sh, SHADOW_ONLY, true, true, angle, 0);
              const k = spriteKeep(hMax, dMin, st.budget.thin, t[1]);
              this.stageStatic(st, spritePart(k), SOLID, near, near, angle, l);
            }
            st.staticJob = job;
          } else {
            this.nextActive.push(st);
          }
        }
        yield;
      }
    [this.active, this.nextActive] = [this.nextActive, this.active];
    this.committedJob = job;
    for (const b of this.statics.values()) {
      [b.c, b.s] = [b.s, b.c];
      this.packStatic(b);
    }
    const ib = this.impostorBatch();
    [ib.c, ib.s] = [ib.s, ib.c];
    this.packImpostors();
    this.packedView = this.view && { ...this.view };
    this.commits++;
    this.current.commit = true;
    this.lastJob = { cells, occluded };
  }

  private stage(
    b: Staged,
    st: TreeState,
    fade: readonly number[],
    angle: number,
    always: boolean,
  ): void {
    const i = b.count++;
    b.spread = grow(b.spread, i + 1);
    b.spread[i] = this.jobSpread;
    b.mat = grow(b.mat, (i + 1) * 16);
    b.inst = grow(b.inst, (i + 1) * 4);
    b.fade = grow(b.fade, (i + 1) * 4);
    b.lod = grow(b.lod, (i + 1) * 4);
    b.angle = grow(b.angle, i + 1);
    b.always = grow(b.always, i + 1);
    b.mat.set(st.m, i * 16);
    b.inst.set(st.inst, i * 4);
    b.fade.set(fade, i * 4);
    this.lodOf(st, b.lod, i * 4);
    b.angle[i] = angle;
    b.always[i] = always ? 1 : 0;
  }

  private stageImpostor(st: TreeState, angle: number): void {
    this.stage(this.impostorBatch().s, st, STATIC_IMPOSTOR, angle, false);
  }

  /** `part` 0 / 1 = a branch level, 3+ = a sprite bucket. */
  private stageStatic(
    st: TreeState,
    part: number,
    role: number,
    shadow: boolean,
    always: boolean,
    angle: number,
    debug: number,
  ): void {
    this.stage(
      this.staticBatch(st.lv, part).s,
      st,
      [1, role, shadow ? 1 : 0, debug],
      angle,
      always,
    );
  }

  /** Every frame: select, fade and write every active tree into the dynamic batches. */
  private drawActive(px: number, dt: number): void {
    this.frame++;
    for (const b of this.dynamic.values()) {
      b.count = 0;
      b.solid = 0;
    }
    const ib = this.impostorBatch();
    ib.count = ib.packed;
    const v = this.view;
    const shadowD = this.opts.shadowDistance;
    const sx = this.steadyPos.x;
    const sy = this.steadyPos.y;
    const sz = this.steadyPos.z;
    const frame = this.frame;
    const levels = this.current.levels;
    let drawn = 0;
    let flickering = 0;
    let fading = 0;
    for (const st of this.active) if (st.from !== st.to) fading++;
    this.current.active = this.active.length;
    for (const st of this.active) {
      const dx = st.cx - sx;
      const dy = st.cy - sy;
      const dz = st.cz - sz;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.5);
      const near = dist < shadowD;
      let visible = true;
      if (!near && v) {
        // This frame's horizontal field of view, exactly: a tree off screen takes no fade slot.
        let a = Math.abs(Math.atan2(dz, dx) - v.yaw) % (2 * Math.PI);
        if (a > Math.PI) a = 2 * Math.PI - a;
        visible = a <= v.half + spread(st.diameter / 2, dist);
      }
      const lod = st.budget;
      const sel = selectLevel(
        (st.diameter * px) / dist,
        fadeTarget(st),
        lod.t,
        lod.hysteresis,
        dist,
      );
      const fresh = st.seen < frame - 1;
      st.seen = frame;
      // Culled (keeps its state) or coming into view: its selected level at once, no fade.
      const snap = !visible || !st.visible || fresh || dt === 0;
      const wasFading = st.from !== st.to;
      if (stepFade(st, sel, snap, dt, lod.fadeTime, fading < MAX_FADES))
        this.changed(st);
      const isFading = st.from !== st.to;
      if (isFading !== wasFading) fading += isFading ? 1 : -1;
      st.visible = visible;
      let flicker = false;
      if (st.changes.length) {
        while (st.changes.length && st.changes[0] < this.time - 1)
          st.changes.shift();
        flicker = st.changes.length > 2;
        if (flicker) flickering++;
      }
      // Shadow: LOD1 branches + sprites while the tree is settled on (`from` until a fade ends) a branch level.
      const sh = near ? shadowLevel(st.from) : -1;
      const code = (isFading ? 4 : 0) + (flicker ? 8 : 0);
      const role = spriteRole(st);
      if (visible) {
        if (!isFading) {
          this.emit(st, st.from, SOLID, 1, sh === st.from, st.from + code);
          levels[st.from]++;
        } else {
          this.emit(
            st,
            st.from,
            OUTGOING,
            st.fade,
            sh === st.from,
            st.from + code,
          );
          this.emit(st, st.to, INCOMING, st.fade, sh === st.to, st.to + code);
          this.current.fading++;
        }
        drawn++;
      }
      if (sh >= 0 && (!visible || (sh !== st.from && sh !== st.to)))
        this.emit(st, sh, SHADOW_ONLY, 1, true, 0);
      // Sprites: with both branch levels; fading out against the impostor; casting while settled on branches.
      if (role >= 0 && (visible || sh >= 0)) {
        const part = spritePart(
          spriteKeep((st.diameter * px) / dist, dist, lod.thin, lod.t[1]),
        );
        this.emit(
          st,
          part,
          visible ? role : SHADOW_ONLY,
          st.fade,
          sh >= 0,
          (isFading ? st.from : st.to) + code,
        );
      }
    }
    for (const b of this.dynamic.values()) this.upload(b, b.count);
    // Impostors: the whole buffer after a re-pack, else only this frame's dynamic part.
    this.upload(ib, ib.count, ib.dirty ? 0 : ib.packed);
    ib.dirty = false;
    let statics = ib.packed;
    let sprites = 0;
    for (const b of this.dynamic.values()) sprites += b.solid * b.sprites;
    for (const b of this.statics.values()) {
      if (b.level < IMPOSTOR) {
        levels[b.level] += b.solid;
        statics += b.solid;
      }
      sprites += b.solid * b.sprites;
    }
    levels[IMPOSTOR] += ib.packed;
    this.current.sprites = sprites;
    this.current.statics = statics;
    this.drawn = drawn + statics;
    this.flickering = flickering;
  }

  private changed(st: TreeState): void {
    st.changes.push(this.time);
    if (st.changes.length > 4) st.changes.shift();
  }

  /** `part` 0 / 1 = a branch level, 2 = the impostor, 3+ = a sprite bucket. */
  private emit(
    st: TreeState,
    part: number,
    role: number,
    fade: number,
    shadow: boolean,
    debug: number,
  ): void {
    const b =
      part === IMPOSTOR
        ? this.impostorBatch()
        : st.batches[part < IMPOSTOR ? part : part - 1];
    const i = b.count++;
    if (b.count > b.capacity) this.ensureCapacity(b, b.count);
    b.mat.set(st.m, i * 16);
    b.inst.set(st.inst, i * 4);
    b.fade[i * 4] = fade;
    b.fade[i * 4 + 1] = role;
    b.fade[i * 4 + 2] = shadow ? 1 : 0;
    b.fade[i * 4 + 3] = debug;
    this.lodOf(st, b.lod, i * 4);
    if (role !== SHADOW_ONLY) b.solid++;
  }

  /** A variant's dynamic batches: LOD0, LOD1 branches, the sprite buckets (cached on the state). */
  private batchesOf(lv: LoadedVariant): Batch[] {
    let list = this.dynamicOf.get(lv);
    if (!list)
      this.dynamicOf.set(
        lv,
        (list = [0, 1, ...SPRITE_PARTS].map((p) => this.dynamicBatch(lv, p))),
      );
    return list;
  }

  /** The one batch of every impostor (all species and variants: one draw call). */
  private impostorBatch(): ImpostorBatch {
    if (this.impostors) return this.impostors;
    const b: ImpostorBatch = {
      ...this.newBatch(),
      s: staged(),
      c: staged(),
      packed: 0,
      dirty: false,
    };
    const material = this.library.impostors?.material;
    if (material) {
      const g = new BufferGeometry();
      const q = impostorQuad();
      for (const [name, a] of Object.entries(q.attributes))
        g.setAttribute(name, a);
      g.setIndex(q.index);
      this.addMesh(b, g, material, 'tree impostors', false, false);
    }
    this.ensureCapacity(b, 64);
    this.impostors = b;
    return b;
  }

  private dynamicBatch(lv: LoadedVariant, part: number): Batch {
    const key = `${lv.info.species}#${lv.info.index}:${part}`;
    let b = this.dynamic.get(key);
    if (!b) {
      b = this.newBatch();
      this.createMeshes(b, lv, part, `dyn ${part}`);
      this.ensureCapacity(b, 64);
      this.dynamic.set(key, b);
    }
    return b;
  }

  private staticBatch(lv: LoadedVariant, part: number): StaticBatch {
    const key = `${lv.info.species}#${lv.info.index}:${part}`;
    let b = this.statics.get(key);
    if (!b) {
      b = { ...this.newBatch(), level: part, s: staged(), c: staged() };
      this.createMeshes(b, lv, part, `static ${part}`);
      this.ensureCapacity(b, 64);
      this.statics.set(key, b);
    }
    return b;
  }

  private newBatch(): Batch {
    const f = () => new Float32Array(0);
    return {
      meshes: [],
      geometries: [],
      capacity: 0,
      count: 0,
      mat: f(),
      inst: f(),
      fade: f(),
      lod: f(),
      aMat: null,
      aInst: null,
      aFade: null,
      aLod: null,
      sprites: 0,
      solid: 0,
      casters: -1,
    };
  }

  private setView(camera: PerspectiveCamera): void {
    const dir = camera.getWorldDirection(_dir);
    const flat = Math.hypot(dir.x, dir.z);
    const halfFov = Math.atan(
      Math.tan((camera.fov * Math.PI) / 360) * camera.aspect,
    );
    this.view =
      flat > 0.4 ? { yaw: Math.atan2(dir.z, dir.x), half: halfFov } : null;
    const v = this.view;
    const p = this.packedView;
    if (!v && !p) return;
    if (v && p) {
      let a = Math.abs(v.yaw - p.yaw) % (2 * Math.PI);
      if (a > Math.PI) a = 2 * Math.PI - a;
      if (a < REPACK && Math.abs(v.half - p.half) < REPACK) return;
    }
    this.packedView = v && { ...v };
    for (const b of this.statics.values()) this.packStatic(b);
    this.packImpostors();
  }

  /** Committed static instances -> GPU (from `at`): the ones in the view window, plus the always-drawn ones. */
  private pack(b: Batch, c: Staged, at: number): number {
    this.current.repacks++;
    const v = this.packedView ?? this.view;
    this.ensureCapacity(b, at + c.count + Math.max(0, b.count - at));
    let n = at;
    let solid = 0;
    // Shadow casters first (the shadow pass draws only them), then the rest in the view window.
    for (const casters of [true, false]) {
      for (let i = 0; i < c.count; i++) {
        if (c.fade[i * 4 + 2] > 0.5 !== casters) continue;
        // Kept while the view turns up to REPACK from the packed one and the camera stays in the job's window.
        if (v && !c.always[i]) {
          let a = Math.abs(c.angle[i] - v.yaw) % (2 * Math.PI);
          if (a > Math.PI) a = 2 * Math.PI - a;
          if (a > v.half + REPACK + c.spread[i]) continue;
        }
        b.mat.set(c.mat.subarray(i * 16, i * 16 + 16), n * 16);
        b.inst.set(c.inst.subarray(i * 4, i * 4 + 4), n * 4);
        b.fade.set(c.fade.subarray(i * 4, i * 4 + 4), n * 4);
        b.lod.set(c.lod.subarray(i * 4, i * 4 + 4), n * 4);
        if (c.fade[i * 4 + 1] !== SHADOW_ONLY) solid++;
        n++;
      }
      if (casters) b.casters = n - at;
    }
    b.solid = solid;
    return n;
  }

  private packStatic(b: StaticBatch): void {
    b.count = this.pack(b, b.c, 0);
    this.upload(b, b.count);
  }

  /** Static impostors -> the front of the impostor batch (the dynamic ones follow each frame). */
  private packImpostors(): void {
    const b = this.impostorBatch();
    b.packed = this.pack(b, b.c, 0);
    b.count = b.packed;
    b.dirty = true;
  }

  /** Instances [from, n) changed: upload that range, draw n. */
  private upload(b: Batch, n: number, from = 0): void {
    if (n > from) this.current.uploadBytes += (n - from) * 28 * 4;
    for (const a of [b.aMat!, b.aInst!, b.aFade!, b.aLod!]) {
      a.clearUpdateRanges();
      a.addUpdateRange(from * a.itemSize, (n - from) * a.itemSize);
      a.needsUpdate = n > from;
    }
    for (const mesh of b.meshes) {
      mesh.count = n;
      mesh.visible = n > 0 && (this.prepass || !this.prepassMeshes.has(mesh));
    }
  }

  /** CPU + GPU instance buffers for `n` instances (shared by the batch's meshes). */
  private ensureCapacity(b: Batch, n: number): void {
    if (n <= b.capacity) return;
    this.current.allocs++;
    let cap = Math.max(64, b.capacity);
    while (cap < n) cap *= 2;
    const keep = Math.min(b.count, cap);
    const attr = (size: number, old: Float32Array) => {
      const arr = new Float32Array(cap * size);
      arr.set(old.subarray(0, keep * size));
      const a = new InstancedBufferAttribute(arr, size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    b.aMat = attr(16, b.mat);
    b.aInst = attr(4, b.inst);
    b.aFade = attr(4, b.fade);
    b.aLod = attr(4, b.lod);
    b.mat = b.aMat.array as Float32Array;
    b.inst = b.aInst.array as Float32Array;
    b.fade = b.aFade.array as Float32Array;
    b.lod = b.aLod.array as Float32Array;
    b.meshes.forEach((mesh, i) => {
      mesh.instanceMatrix = b.aMat!;
      const g = b.geometries[i];
      g.setAttribute('treeInst', b.aInst!);
      g.setAttribute('treeFade', b.aFade!);
      g.setAttribute('treeLod', b.aLod!);
    });
    b.capacity = cap;
  }

  /**
   * `part` 0 / 1: a branch level's bark (LOD1 casts shadows); 3+: a sprite bucket, a depth prepass + the lit
   * sprites, drawing the first KEEP share of the rank-ordered sprites.
   */
  private createMeshes(
    b: Batch,
    lv: LoadedVariant,
    part: number,
    tag: string,
  ): void {
    const name = `tree ${lv.info.species}#${lv.info.index} ${tag}`;
    if (part >= 3) {
      const { kind, density } = lv.def.foliage;
      b.sprites = Math.max(1, Math.ceil(KEEP[part - 3] * lv.spriteCount));
      const end = lv.spriteEnds[Math.min(lv.spriteCount, b.sprites) - 1] ?? 0;
      const g0 = this.wrap(lv.sprites);
      const g1 = this.wrap(lv.sprites);
      g0.setDrawRange(0, end);
      g1.setDrawRange(0, end);
      const pre = this.addMesh(
        b,
        g0,
        spritePrepassMaterial(kind, density),
        `${name} depth`,
        false,
        true,
      );
      pre.renderOrder = PREPASS_ORDER;
      this.prepassMeshes.add(pre);
      this.litSprites.add(
        this.addMesh(b, g1, spriteMaterial(kind, density), name, true, true),
      );
    } else
      this.addMesh(
        b,
        this.wrap(lv.levels[part]),
        barkMaterial(lv.def.bark.texture),
        name,
        part === 1,
        false,
      );
  }

  /** A wrapper drawing a shared geometry's vertex buffers, to carry a batch's instance attributes. */
  private wrap(src: BufferGeometry): BufferGeometry {
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes))
      g.setAttribute(name, a);
    g.setIndex(src.index);
    g.boundingSphere = src.boundingSphere;
    return g;
  }

  private addMesh(
    b: Batch,
    g: BufferGeometry,
    material: Material,
    name: string,
    casts: boolean,
    sprite: boolean,
  ): InstancedMesh {
    const mesh = new InstancedMesh(g, material, 1);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = casts;
    mesh.receiveShadow = material.colorWrite;
    if (casts) mesh.customDepthMaterial = treeDepthMaterial(sprite);
    mesh.name = name;
    // Counters and GPU timing of exactly the tree draws (trees/Performance.md#counters).
    mesh.onBeforeRender = () => {
      this.current.mainDraws++;
      this.current.mainTriangles += meshTriangles(mesh);
      this.timer?.begin(false);
    };
    mesh.onAfterRender = () => this.timer?.end();
    // The shadow pass draws a static batch's casters only (packed first).
    let count = 0;
    mesh.onBeforeShadow = () => {
      count = mesh.count;
      if (b.casters >= 0) mesh.count = Math.min(count, b.casters);
      this.current.shadowDraws++;
      this.current.shadowTriangles += meshTriangles(mesh);
      this.timer?.begin(true);
    };
    mesh.onAfterShadow = () => {
      mesh.count = count;
      this.timer?.end();
    };
    b.meshes.push(mesh);
    b.geometries.push(g);
    this.group.add(mesh);
    return mesh;
  }

  /** Sprite depth prepass on / off (the debug toggle; the overlay and the benchmark report it). */
  setPrepass(on: boolean): void {
    this.prepass = on;
    setSpritePrepass(on);
    for (const mesh of this.prepassMeshes) mesh.visible = on && mesh.count > 0;
  }

  get prepassOn(): boolean {
    return this.prepass;
  }

  /**
   * Load-time check of the sprite depth prepass (call while `prewarm` puts one tree of every batch in front of the
   * camera): render the trees with the prepass painting magenta (debug view 5) into a small target, read it back
   * once, and turn the prepass off if more than PREPASS_MISS_LIMIT of the sprite pixels stayed magenta, i.e. the lit
   * pass missed its own depth on this driver. A readback at load only, never during a run.
   */
  checkPrepass(
    renderer: WebGLRenderer,
    scene: Object3D,
    camera: PerspectiveCamera,
  ): void {
    if (!this.prepass) return;
    const w = 256;
    const h = 128;
    const msaa = renderer.getContext().getContextAttributes()?.antialias;
    const target = new WebGLRenderTarget(w, h, { samples: msaa ? 4 : 0 });
    const mode = this.debugMode;
    const prev = renderer.getRenderTarget();
    const px = new Uint8Array(w * h * 4);
    const magenta = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++;
      return n;
    };
    // Sprite pixels: the prepass alone (magenta, lit sprites hidden); misses: what stays magenta under them.
    this.debugMode = 5;
    const lit = [...this.litSprites].filter((m) => m.visible);
    for (const o of lit) o.visible = false;
    const covered = magenta();
    for (const o of lit) o.visible = true;
    const missed = magenta();
    renderer.setRenderTarget(prev);
    this.debugMode = mode;
    target.dispose();
    this.prepassMisses = covered ? missed / covered : 0;
    if (this.prepassMisses > PREPASS_MISS_LIMIT) this.setPrepass(false);
  }

  /**
   * Make every batch draw ONE real instance (in front of `camera`, casting a shadow) for the load's warm-up render,
   * so every tree program is not only linked but drawn once, in the main and the shadow pass: drivers finish
   * compiling a program's variants at its first real draw, and that first draw mid-run was a 300-400 ms frame
   * (trees/Performance.md#frame-stability). `settle()` puts the batches back.
   */
  prewarm(camera?: PerspectiveCamera): void {
    const at = new Vector3();
    if (camera)
      camera.getWorldDirection(at).multiplyScalar(30).add(camera.position);
    const m = new Matrix4().setPosition(at).elements;
    const one = (b: Batch) => {
      this.ensureCapacity(b, 1);
      b.mat.set(m, 0);
      b.inst.set([0, 1, 0, 0], 0);
      b.fade.set([1, SOLID, 1, 0], 0);
      b.lod.set([5, 10, 0.06, 0.01], 0);
      for (const a of [b.aMat!, b.aInst!, b.aFade!, b.aLod!]) {
        a.clearUpdateRanges();
        a.needsUpdate = true;
      }
      for (const mesh of b.meshes) {
        mesh.count = 1;
        mesh.visible = true;
      }
    };
    for (const lv of this.library.all())
      for (const part of [0, 1, ...SPRITE_PARTS]) {
        one(this.dynamicBatch(lv, part));
        one(this.staticBatch(lv, part));
      }
    one(this.impostorBatch());
  }

  /** Re-apply visibility after prewarm / compile. */
  settle(): void {
    for (const b of this.dynamic.values()) {
      b.count = 0;
      this.upload(b, 0);
    }
    for (const b of this.statics.values()) this.packStatic(b);
    this.packImpostors();
    this.upload(this.impostorBatch(), this.impostorBatch().count);
  }

  get busy(): boolean {
    return this.job !== null;
  }

  get meshCount(): number {
    let n = 0;
    for (const b of this.batches()) n += b.count > 0 ? b.meshes.length : 0;
    return n;
  }

  dispose(): void {
    for (const b of this.batches()) {
      // Free only this batch's instance buffers: the vertex buffers belong to the library (TreeLibrary.dispose).
      for (const g of b.geometries) {
        for (const name of Object.keys(g.attributes))
          if (name !== 'treeInst' && name !== 'treeFade' && name !== 'treeLod')
            g.deleteAttribute(name);
        g.setIndex(null);
        g.dispose();
      }
      for (const m of b.meshes) m.dispose();
    }
    this.dynamic.clear();
    this.statics.clear();
    this.impostors = null;
    this.group.clear();
  }

  private batches(): Batch[] {
    return [
      ...this.dynamic.values(),
      ...this.statics.values(),
      ...(this.impostors ? [this.impostors] : []),
    ];
  }
}
