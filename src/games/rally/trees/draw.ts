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
import { SHADOW_ONLY_LAYER } from '../engine/layers';
import { worldUniforms } from '../engine/world-shading';
import type { RoadQuery } from '../world/road';
import type { ScatterChunk, ScatterInstance } from '../world/scatter';
import type { World } from '../world/world';
import type { LoadedVariant, TreeLibrary } from './load';
import {
  barkKind,
  barkMaterial,
  setSpritePrepass,
  setSpritePrepassDebug,
  proxyMaterial,
  spriteFarMaterial,
  spriteMaterial,
  spritePrepassMaterial,
  type TreeDepthKind,
  treeDepthMaterial,
  treeUniforms,
} from './materials';
import { HeightGrid, Horizon } from './occlusion';
import {
  FOREST_REACH,
  IMPOSTOR_FROM,
  lodOf,
  NEAR_SPRITES,
  ROAD_REACH,
  ROAD_REACH_FLAG,
  ROADSIDE_EDGE,
  type Reach,
} from './species';
import { MultiDraw, SubDraw, TreePool } from './multi-draw';
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
 *   hysteresis margin; within the tree's `Reach.full` always LOD0. Sprite thinning is not a level: the sprite shader
 *   does it continuously from the same height (trees/materials.ts).
 * - **Transition** (Lod.md#transition): each tree keeps (from, to, fade, direction). A level change starts a fade of
 *   the species' fixed time; changing back reverses it; a third level waits; at most MAX_FADES fade at once. The fade
 *   is one number per tree (`treeFade.x`). Sprites never fade between LOD0 and LOD1 (they are the same); towards the
 *   impostor they fade out against it.
 * - **Shadows** (Lod.md#shadows): LOD1 branches and the crown proxy for every settled level (the impostor's too, so a
 *   shadow never pops with the level), never dithered, within `shadowDistance` only.
 * - **Batches:** a tree that is settled and keeps its level and shadow for every camera position and zoom until the
 *   next job is static, refilled by a time-sliced job every `rebuildDistance` of camera travel; every other tree is
 *   "active", re-selected every frame into a room of the same batch (one draw call per variant and part). Trees far
 *   from the road (`fakeFrom`) are staged per scatter chunk as ready blocks of impostors. Far instances outside the
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
 * Free caster slots a whole pack leaves (share of the casters), so new casters fit without a re-pack. Kept small: an
 * empty slot is drawn collapsed, but its vertices still run the vertex shader.
 */
const HEADROOM = 0.1;
/** A static batch is packed whole again once its empty slots pass this share of the used ones. */
const HOLES = 0.15;
/**
 * Static membership is conservative over this much zoom (px ratio) before the next job, which starts once the field
 * of view moved half of it. Tiny: at the far threshold (~370 m) every 1% is a 4 m ring of per-frame trees, and the
 * field of view only changes with a camera switch (trees/Lod.md#active-set).
 */
const ZOOM_MARGIN = 1.004;
/** Camera jump (m) between two jobs that counts as a cut: every tree snaps to its level, nothing queues to fade. */
const CUT_DISTANCE = 50;
/**
 * The jobs within this (m) of a horizon's eye reuse it (trees/occlusion.ts: built with this much more margin), instead
 * of tracing 1024 rays every job: it was most of a job's time on a forest map.
 */
const HORIZON_REUSE = 30;
/** Roles in `treeFade.y` (trees/materials.ts). */
const SOLID = 0;
const OUTGOING = 1;
const INCOMING = 2;
const SHADOW_ONLY = 3;
/** Trees fading at once (trees/Performance.md#mitigations); a change beyond that waits for a free slot. */
export const MAX_FADES = 32;
/**
 * Render order of the sprite depth prepass: before every other opaque draw, but after the sky (-1) and the horizon
 * backdrop (world/horizon.ts, -0.5), which clears the depth buffer after it draws (it would wipe the prepass depth).
 */
const PREPASS_ORDER = -0.25;
/**
 * The sprite depth prepass + lit pass (trees/Drawing.md#depth, Performance.md#mitigations) is on by default except
 * on touch devices; `?treeprepass=0|1` forces it. The lit pass tests LESS-OR-EQUAL with a small polygon offset toward
 * the camera (not EQUAL: two programs' depths differ in the last bit on some drivers, and a missed pixel kept the
 * background colour = a blinking crown); `checkPrepass` still renders it once at load and turns the prepass off if
 * sprite pixels stay unshaded (debug view 5 shows those in magenta).
 */
export const SPRITE_PREPASS = (() => {
  if (typeof location === 'undefined') return true;
  const flag = new URLSearchParams(location.search).get('treeprepass');
  if (flag !== null) return flag !== '0';
  // Phones / tablets: tile GPUs already discard hidden pixels, and their depths did not always match (blinking crowns).
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return !coarse;
})();
/** Share of the sprite pixels that may miss the EQUAL test before the load check turns the prepass off. */
const PREPASS_MISS_LIMIT = 0.002;
/** Bump when the prepass or the check changes: earlier verdicts no longer count. */
const PREPASS_CHECK_VERSION = 1;

/** The GPU + driver the verdict of `checkPrepass` belongs to. */
function prepassVerdictKey(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  return `rally.prepass.${PREPASS_CHECK_VERSION}.${gl.getParameter(gl.VERSION)}.${name}`;
}

function readVerdict(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writeVerdict(key: string, ok: boolean): void {
  try {
    localStorage.setItem(key, ok ? '1' : '0');
  } catch {
    // No storage: the check runs every load.
  }
}
/** The shader's sprite fade window (trees/materials.ts `treeSpriteScale`). */
const KEEP_WINDOW = 0.08;
/**
 * Sprite batches per variant (trees/Performance.md#mitigations). Crowns within a tree's `Reach` full + ramp: part
 * NEAR_PART, the sprites' tight outlines (NEAR_SPRITES of them), depth prepass + EQUAL lit pass (near crowns fill the
 * screen: overdraw is their cost). Farther crowns: part FAR_PART, plain quads in ONE lit pass, holding the far share
 * (`tlFar.x`; thinner crowns shrink the rest to nothing in the shader). One far batch per variant, not one per
 * thinning step: far crowns are few triangles each, and splitting them by share left a few crowns per draw call.
 */
const NEAR_PART = 3;
const MID_PART = 4;
const FAR_PART = 5;
const SPRITE_PARTS = [NEAR_PART, MID_PART, FAR_PART];
/** The crown's shadow caster (trees/proxy.ts): the shadow pass draws it instead of the sprites. */
const PROXY_PART = 6;
/** Static impostors farther than this (m) draw without their baked depth (trees/materials.ts TREE_IMPOSTOR_FLAT). */
const IMPOSTOR_FLAT_FROM = 350;
/** Every batch part of a variant: branches LOD0, LOD1, the sprite parts, the shadow proxy. */
const PARTS = [0, 1, ...SPRITE_PARTS, PROXY_PART];

/** Share of a crown's sprites the shader keeps at projected height h and distance dist (same formula). */
export function spriteKeep(
  h: number,
  dist: number,
  thin: number,
  impostor: number,
  reach: Reach = FOREST_REACH,
): number {
  const far = treeUniforms.tlFar.value;
  const f =
    h < thin
      ? Math.min(1, Math.max(0, Math.log(thin / h) / Math.log(thin / impostor)))
      : 0;
  const t = Math.min(1, Math.max(0, (dist - reach.full) / reach.ramp));
  const w = t * t * (3 - 2 * t);
  return NEAR_SPRITES + (far.x + (far.y - far.x) * f - NEAR_SPRITES) * w;
}

/** The perf panel's part of a tree mesh, from its name (`createMeshes`, the impostor batches). */
function partOfMesh(name: string, proxy: boolean): TreePart {
  if (proxy) return 'proxy';
  if (name.endsWith('impostors far')) return 'farImpostors';
  if (name.endsWith('impostors')) return 'impostors';
  if (name.endsWith(' depth')) return 'prepass';
  const part = Number(/ (\d+)$/.exec(name)?.[1] ?? -1);
  return part === 0
    ? 'lod0'
    : part === 1
      ? 'lod1'
      : part === NEAR_PART
        ? 'near'
        : 'far';
}

/** Sprite part of a crown at distance `dist`: near (outlines + prepass), mid (the ramp, quads) or far (quads). */
function spritePart(dist: number, reach: Reach): number {
  return dist < reach.near
    ? NEAR_PART
    : dist < reach.full + reach.ramp
      ? MID_PART
      : FAR_PART;
}

/**
 * Sprites a mid / far batch holds: every one the shader keeps in its range (the share at its near end: the mid batch
 * starts at a tree's `Reach.near`, the larger share of the two reaches; the far one past the ramp at `tlFar.x`) and
 * its fade window.
 */
function bucketSprites(lv: LoadedVariant, part: number): number {
  const share =
    part === MID_PART
      ? Math.max(
          spriteKeep(Infinity, FOREST_REACH.near, 1, 0.5),
          spriteKeep(Infinity, ROAD_REACH.near, 1, 0.5, ROAD_REACH),
        )
      : treeUniforms.tlFar.value.x;
  return Math.max(
    1,
    Math.ceil(Math.min(1, share * (1 + KEEP_WINDOW)) * lv.spriteCount),
  );
}

/** Tree mesh kinds the perf panel can hide (game/perf-panel.ts): every pass of them. */
export type TreePart =
  | 'lod0'
  | 'lod1'
  | 'near'
  | 'prepass'
  | 'far'
  | 'proxy'
  | 'impostors'
  | 'farImpostors';

export interface TreeRendererOptions {
  /** Divides every threshold (quality preset x draw distance option): higher = finer levels further away. */
  lodScale: number;
  /** Nothing is drawn further than this (m): the streamed terrain's view distance. */
  maxDistance: number;
  /**
   * Trees are drawn up to this distance (m; unset = maxDistance); the job still visits the scatter out to
   * maxDistance, so the canopy texture (world/canopy-shadows.ts) fills and paints the far forest on the ground
   * (engine/world-shading.ts `setForest`).
   */
  forestDistance?: number;
  /** Trees within this distance cast shadows (the sun's shadow box). */
  shadowDistance: number;
  /**
   * Half size of the sun's shadow box (m, engine/environment.ts: centred half a box ahead of the camera). Set: static
   * trees cast only when their bounding sphere can reach the box in light space, not everywhere within
   * `shadowDistance` (behind the camera, most of them throw their shadow where no shadow map is).
   */
  shadowExtent?: number;
  /**
   * Trees farther than this from the stage road (m) are always static impostors (no branches, sprites or shadows): the
   * player only ever sees them from the road, at least this far away.
   */
  fakeFrom?: number;
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
  /** Its variant's batches: LOD0, LOD1 branches, then the sprite buckets (KEEP), the crown proxy. */
  batches: StaticBatch[];
  budget: Budget;
  /** Farther than `fakeFrom` from the road: always a static impostor. */
  faked: boolean;
  /** Its detail zones: the first row (within ROADSIDE_EDGE of the road) reaches farther than the forest behind. */
  reach: Reach;
  /** Its scatter chunk's sorted trees (`chunkTrees`). */
  home: ChunkTrees | null;
}

/**
 * A scatter chunk's trees, sorted once: the ones near the road (selected per tree by every job) and the faked ones
 * (`fakeFrom`), which are always static impostors away from the camera, so a job stages them as one ready block of
 * instances instead of tree by tree (most of a forest map's trees are faked).
 */
interface ChunkTrees {
  near: TreeState[];
  faked: TreeState[];
  /** The faked trees' impostor instances (STATIC_IMPOSTOR), in the batch layout. */
  mat: Float32Array;
  inst: Float32Array;
  fade: Float32Array;
  lod: Float32Array;
  /** Chunk square (world, m): x0, z0 and size; its faked crowns' bounding sphere (centre y, radius). */
  x0: number;
  z0: number;
  size: number;
  cy: number;
  r: number;
  /** Last job that staged the block (a faked tree back on the per-tree path is not new then). */
  job: number;
  /** `blockVersion` its instances were built for (budgets change with the quality setting). */
  version: number;
}

/** The blocks of faked trees a job staged: the chunk, the view angle from the job's focus and the half-angle it covers. */
interface StagedBlocks {
  list: ChunkTrees[];
  angle: Float32Array;
  spread: Float32Array;
  count: number;
}

/** Horizontal half-angle a tree (bounding radius r) at distance d covers beyond its centre's direction. */
function spread(r: number, d: number): number {
  return d > r ? Math.asin(r / d) : Math.PI;
}

/** What the batch code sets on its draws: an InstancedMesh (impostors) or a sub-draw of a multi-draw. */
interface DrawView {
  count: number;
  visible: boolean;
}

interface Batch {
  meshes: DrawView[];
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
  /** Multi-drawn (static batches): the instances live in the tree pool from `base` (trees/multi-draw.ts). */
  pooled: boolean;
  base: number;
}

/**
 * A variant's batch of one part, ONE mesh set (one draw call) for its settled and its active trees: filled by the job
 * (staged / committed instances, packed for the view window at commit or repack) and every frame by the active trees,
 * as [static shadow casters | room for the active trees | the other static instances]. The shadow pass draws up to
 * the end of the room (`casters`); room slots no active tree uses are collapsed (COLLAPSED).
 */
interface StaticBatch extends Batch {
  level: number;
  s: Staged;
  c: Staged;
  /** The room: first instance and size; active trees in it this frame / last frame / most since the last commit. */
  dynAt: number;
  dynCap: number;
  dyn: number;
  dynLast: number;
  dynPeak: number;
  /** Active instances the main pass draws (not shadow-only). */
  dynSolid: number;
  /** Static instances after the room. */
  rest: number;
  /** Collapse the whole room this frame (re-packed or grown: it holds stale instances). */
  clearRoom: boolean;
  /** The room as last uploaded, 28 floats a slot (`uploadRoom`); null = upload it whole next. */
  sent?: Float32Array | null;
  /** Tree slots (`packStatic`); null = pack whole next. */
  slots?: Slots | null;
  /** Trees in its slots (casters + rest; holes left out): drawn only with some, or an active one. */
  live?: number;
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
  /** Bounding sphere: centre (world) and radius (m). */
  sphere: Float32Array;
  /** The tree of each instance (slot-stable packing keys on it). */
  owner: TreeState[];
  count: number;
}

/**
 * Where a static batch's trees sit (`packStatic`): a slot per tree in the shadow-caster region [0, cCap) and in the
 * rest after the room, kept from pack to pack; freed slots are collapsed and reused.
 */
interface Slots {
  c: Map<TreeState, number>;
  r: Map<TreeState, number>;
  cFree: number[];
  rFree: number[];
  cLen: number;
  rLen: number;
  cCap: number;
}

/** Slots of an impostor batch (`packRuns`): single impostors, then a run per chunk block. */
interface RunSlots {
  s: Map<TreeState, number>;
  sFree: number[];
  sLen: number;
  sCap: number;
  k: Map<ChunkTrees, { at: number; len: number; version: number }>;
  kFree: { at: number; len: number }[];
  kLen: number;
}

/** The one impostor batch: static instances (packed at commit / repack) first, then this frame's dynamic ones. */
interface ImpostorBatch extends Batch {
  s: Staged;
  c: Staged;
  /** Blocks of faked trees: staged by the running job / committed. */
  sb: StagedBlocks;
  cb: StagedBlocks;
  packed: number;
}

/** Item `i` of `src` -> slot `n` of `dst` (`size` floats each); 1 when anything changed. */
function copyChanged(
  dst: Float32Array,
  src: Float32Array,
  n: number,
  i: number,
  size: number,
): number {
  let changed = 0;
  for (let k = 0; k < size; k++)
    if (dst[n * size + k] !== src[i * size + k]) {
      dst[n * size + k] = src[i * size + k];
      changed = 1;
    }
  return changed;
}

/** treeFade of a static impostor: solid, no shadow, debug level 2. */
const STATIC_IMPOSTOR = [1, SOLID, 0, IMPOSTOR];
/** treeFade of an unused room slot: drawn by no pass (it collapses in the vertex shader). */
const COLLAPSED = [0, SHADOW_ONLY, 0, 0];

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _rq: RoadQuery = {
  found: false,
  lateral: 0,
  distance: 0,
  along: 0,
  height: 0,
  halfWidth: 0,
  index: 0,
};
const _p = new Vector3();
const _s = new Vector3();
const _dir = new Vector3();

let quad: BufferGeometry | null = null;
/** Impostor billboard: corners (-1..1)^2, the shader places it. */
export function impostorQuad(): BufferGeometry {
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
    sphere: f(),
    owner: [],
    count: 0,
  };
}

function stagedBlocks(): StagedBlocks {
  return {
    list: [],
    angle: new Float32Array(0),
    spread: new Float32Array(0),
    count: 0,
  };
}

/** Horizontal distance (m) from (x, z) to the nearest point of a chunk square. */
function chunkDistance(ct: ChunkTrees, x: number, z: number): number {
  const dx = Math.max(ct.x0 - x, 0, x - ct.x0 - ct.size);
  const dz = Math.max(ct.z0 - z, 0, z - ct.z0 - ct.size);
  return Math.hypot(dx, dz);
}

/**
 * Branch level casting the shadow of a settled level: LOD1 (+ the crown proxy) for every level, the impostor's too -
 * a tree's shadow never pops when it turns into an impostor inside the shadow distance.
 */
function shadowLevel(_level: number): number {
  return 1;
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
 * LOD1 -> impostor. Within `full` (`dist`, m: the tree's `Reach.full`) always LOD0.
 */
export function selectLevel(
  h: number,
  current: number,
  t: readonly number[],
  margin: number,
  dist: number,
  full: number = FOREST_REACH.full,
): number {
  if (dist < full) return 0;
  let l = current;
  while (l < IMPOSTOR && h < t[l]) l++;
  while (l > 0 && h > t[l - 1] * (1 + margin)) l--;
  // Never the impostor up close (IMPOSTOR_FROM); a tree already at LOD1 stays there until past it by the margin.
  if (
    l === IMPOSTOR &&
    dist < IMPOSTOR_FROM * (current === IMPOSTOR ? 1 : 1 + margin)
  )
    l = 1;
  // LOD0 branches only in the full-detail zone (+ the hysteresis margin for a tree already there): past it, LOD1.
  if (l === 0 && !(current === 0 && dist < full * (1 + margin))) l = 1;
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
  /** Batches per variant and part (branch levels, sprites, crown proxy): settled + active trees. */
  private statics = new Map<string, StaticBatch>();
  private impostors: ImpostorBatch | null = null;
  /** Static impostors past IMPOSTOR_FLAT_FROM: the far program (no baked depth), static only. */
  private farImpostors: Batch | null = null;
  /** Debug: hidden tree parts (`setPartVisible`) and each mesh's part. */
  private hiddenParts = new Set<TreePart>();
  /** Far sprite batches' sizing (they hold the far share, `setFarSprites`). */
  private farResize: (() => void)[] = [];
  private partOf = new WeakMap<DrawView, TreePart>();
  /** Per-tree data of the static batches and their multi-draws (one per material and part). */
  private pool = new TreePool();
  private draws = new Map<string, MultiDraw>();
  private renderer: WebGLRenderer | null = null;
  private batchesByVariant = new WeakMap<LoadedVariant, StaticBatch[]>();
  private states = new WeakMap<ScatterInstance, TreeState | null>();
  private chunks = new WeakMap<ScatterChunk, ChunkTrees>();
  /** Bumped when the budgets change: every chunk's block of faked trees is rebuilt at its next job. */
  private blockVersion = 0;
  private active: TreeState[] = [];
  private nextActive: TreeState[] = [];
  /** The time-sliced job; it yields `true` to end the frame's slice (the commit then starts the next one). */
  private job: Iterator<boolean | void> | null = null;
  private jobId = 0;
  private committedJob = -1;
  /** Impostor batch slots (`packRuns`). */
  private runs = new Map<Batch, RunSlots>();
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
  private prepassMeshes = new Set<DrawView>();
  /** Terrain occlusion culling on (trees/occlusion.ts; `?treeocclusion=0` = its debug toggle) and its height grid. */
  occlusion =
    typeof location === 'undefined' ||
    new URLSearchParams(location.search).get('treeocclusion') !== '0';
  private heights: HeightGrid | null = null;
  /** Cells the last committed job checked and trees it left out as hidden by the terrain (the overlay). */
  lastJob = { cells: 0, occluded: 0 };
  /** The last job's horizon (debugging, tests). */
  horizon: Horizon | null = null;
  private litSprites = new Set<DrawView>();
  /** Load check of the prepass: share of sprite pixels that failed the EQUAL test (NaN = not run). */
  prepassMisses = NaN;
  /** Sprite pixels the load check saw (0: none in view, nothing was measured). */
  prepassCovered = 0;
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
    treeUniforms.tlForest.value = opts.forestDistance ?? 0;
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

  /** Far crowns' sprite shares (perf panel; defaults trees/species.ts FAR_SPRITES): re-stages every tree. */
  setFarSprites(start: number, end: number): void {
    treeUniforms.tlFar.value.set(start, end);
    for (const resize of this.farResize) resize();
    this.lastFocus.set(Infinity, 0, 0);
  }

  /** The batching job's time per frame (ms): the game shares a frame budget out (cheap, unlike `setOptions`). */
  setJobBudget(ms: number): void {
    this.opts.budgetMs = ms;
  }

  setOptions(o: Partial<TreeRendererOptions>): void {
    Object.assign(this.opts, o);
    treeUniforms.tlShadowD.value = this.opts.shadowDistance;
    treeUniforms.tlForest.value = this.opts.forestDistance ?? 0;
    // Rescale the cached budgets in place (states hold them).
    for (const [name, b] of this.budgets) {
      const lv = this.library.all().find((v) => v.def.name === name);
      if (lv) Object.assign(b, this.makeBudget(lv));
    }
    this.blockVersion++;
    // Its reach follows the forest distance.
    this.horizon = null;
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
      while (performance.now() - t0 < budget) {
        const step = this.job.next();
        if (step.done) {
          this.job = null;
          break;
        }
        // The commit waits for the next frame's slice.
        if (step.value === true) break;
      }
      this.current.jobMs = performance.now() - t0;
    }
    this.setView(camera);
    const t1 = performance.now();
    this.drawActive(px, dt);
    this.syncDraws();
    this.current.selectMs = performance.now() - t1;
  }

  /** GPU timing of the tree passes needs the renderer's WebGL2 context. */
  attachRenderer(renderer: WebGLRenderer): void {
    this.timer = new TreeGpuTimer(renderer);
    this.renderer = renderer;
  }

  /** Before a render: the changed tree data into the pool texture, each multi-draw's geometry + visibility. */
  private syncDraws(): void {
    this.pool.flush(this.renderer);
    for (const d of this.draws.values()) d.sync();
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
    this.syncDraws();
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
    const reach = this.reachOf(inst.x, inst.z);
    st = {
      m: new Float32Array(_m.elements),
      // w: the variant's slot in the impostor texture array + the first-row flag (the fraction, for the sprite shader).
      inst: [
        inst.tree.hue,
        inst.tree.value,
        inst.tree.phase,
        lv.slot + (reach === ROAD_REACH ? ROAD_REACH_FLAG : 0),
      ],
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
      faked: this.farFromRoad(inst.x, inst.z),
      reach,
      home: null,
    };
    this.states.set(inst, st);
    return st;
  }

  /** The first row: within ROADSIDE_EDGE of the road's edge (`Reach`). */
  private reachOf(x: number, z: number): Reach {
    const q = this.world.road.query(x, z, _rq);
    return q.found && q.distance - q.halfWidth <= ROADSIDE_EDGE
      ? ROAD_REACH
      : FOREST_REACH;
  }

  private farFromRoad(x: number, z: number): boolean {
    const d = this.opts.fakeFrom;
    if (d === undefined) return false;
    const q = this.world.road.query(x, z, _rq);
    return !q.found || q.distance > d;
  }

  /** A chunk's trees sorted into near / faked, with the faked ones' block of impostor instances (cached). */
  private chunkTrees(
    chunk: ScatterChunk,
    cx: number,
    cz: number,
    cs: number,
  ): ChunkTrees {
    let ct = this.chunks.get(chunk);
    if (ct && ct.version === this.blockVersion) return ct;
    if (!ct) {
      const near: TreeState[] = [];
      const faked: TreeState[] = [];
      for (const inst of chunk.instances) {
        if (!inst.tree) continue;
        const st = this.stateOf(inst);
        if (st) (st.faked ? faked : near).push(st);
      }
      const n = faked.length;
      ct = {
        near,
        faked,
        mat: new Float32Array(n * 16),
        inst: new Float32Array(n * 4),
        fade: new Float32Array(n * 4),
        lod: new Float32Array(n * 4),
        x0: cx * cs,
        z0: cz * cs,
        size: cs,
        cy: 0,
        r: 0,
        job: -1,
        version: -1,
      };
      for (const st of near) st.home = ct;
      for (const st of faked) st.home = ct;
      this.chunks.set(chunk, ct);
    }
    let lo = Infinity;
    let hi = -Infinity;
    let r = 0;
    ct.faked.forEach((st, i) => {
      ct.mat.set(st.m, i * 16);
      ct.inst.set(st.inst, i * 4);
      ct.fade.set(STATIC_IMPOSTOR, i * 4);
      this.lodOf(st, ct.lod, i * 4);
      lo = Math.min(lo, st.cy);
      hi = Math.max(hi, st.cy);
      r = Math.max(r, st.diameter / 2);
    });
    ct.cy = ct.faked.length ? (lo + hi) / 2 : 0;
    ct.r = cs * Math.SQRT1_2 + (ct.faked.length ? (hi - lo) / 2 : 0) + r;
    ct.version = this.blockVersion;
    return ct;
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
  private *rebuild(
    focus: Vector3,
    px: number,
    cut: boolean,
  ): Generator<boolean | void> {
    const job = ++this.jobId;
    for (const b of this.statics.values()) b.s.count = 0;
    const ib = this.impostorBatch();
    ib.s.count = 0;
    ib.sb.count = 0;
    this.nextActive.length = 0;
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const maxD = this.opts.maxDistance;
    const forestD = this.opts.forestDistance ?? Infinity;
    const shadowD = this.opts.shadowDistance;
    const move = (this.opts.rebuildDistance ?? 5) + 4;
    const bounds = this.world.map.bounds;
    // Trees past this from the focus are drawn nowhere (the shader dissolves them up to forestD).
    const farD = Math.min(maxD, forestD + move);
    // Terrain occlusion (trees/occlusion.ts): the horizon out to farD, a few rays per slice; built for a camera
    // anywhere within HORIZON_REUSE + move of its eye, so the next jobs within HORIZON_REUSE reuse it.
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
      horizon = this.horizon;
      const e = horizon?.eye;
      if (
        !horizon ||
        !e ||
        Math.hypot(e.x - focus.x, e.y - focus.y, e.z - focus.z) >
          HORIZON_REUSE ||
        horizon.move < move + HORIZON_REUSE
      ) {
        horizon = new Horizon(this.heights, focus, move + HORIZON_REUSE, farD);
        while (!horizon.step(64)) yield;
        this.horizon = horizon;
      }
    }
    // Trees nearer than this always draw (they cast shadows and fill the full-detail distance).
    const occludeFrom = (r: Reach) => Math.max(shadowD, r.full) + move;
    // A chunk this far away stages its faked trees as one block: none of them can leave the impostor for any camera
    // in the job's window (the per-tree rule below).
    const blockFrom = IMPOSTOR_FROM * 1.15 + move;
    const sb = ib.sb;
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
        // Generated out to maxD even past the forest: the canopy texture paints the far forest from the chunks.
        const cached = scatter.cachedChunk(cx, cz);
        const chunk = cached ?? scatter.chunk(cx, cz);
        // Every tree of the chunk is at least this far from the focus.
        const dNear = Math.hypot(
          Math.max(cx * cs - focus.x, 0, focus.x - (cx + 1) * cs),
          Math.max(cz * cs - focus.z, 0, focus.z - (cz + 1) * cs),
        );
        if (dNear > farD) {
          if (!cached) yield;
          continue;
        }
        const ct = this.chunkTrees(chunk, cx, cz, cs);
        const block = ct.faked.length > 0 && dNear >= blockFrom;
        if (block) {
          const bx = ct.x0 + cs / 2 - focus.x;
          const bz = ct.z0 + cs / 2 - focus.z;
          if (
            horizon &&
            dNear > occludeFrom(FOREST_REACH) &&
            horizon.hides(ct.x0 + cs / 2, ct.cy, ct.z0 + cs / 2, ct.r)
          ) {
            this.current.occluded += ct.faked.length;
            occluded += ct.faked.length;
          } else {
            const i = sb.count++;
            sb.list[i] = ct;
            sb.angle = grow(sb.angle, i + 1);
            sb.spread = grow(sb.spread, i + 1);
            sb.angle[i] = Math.atan2(bz, bx);
            sb.spread[i] = spread(ct.r + move, Math.hypot(bx, bz));
          }
          ct.job = job;
        }
        for (let k = 0; k < (block ? 1 : 2); k++)
          for (const st of k ? ct.faked : ct.near) {
            const dx = st.cx - focus.x;
            const dy = st.cy - focus.y;
            const dz = st.cz - focus.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            // Past the forest edge (+ the job's move: the shader dissolves trees up to it).
            if (dist > farD) continue;
            if (
              horizon &&
              dist > occludeFrom(st.reach) &&
              horizon.hides(st.cx, st.cy, st.cz, st.diameter / 2)
            ) {
              this.current.occluded++;
              occluded++;
              continue;
            }
            // Far from the road: always a static impostor, unless it is near the camera (IMPOSTOR_FROM) - the trees
            // just beyond the first rows are what the driver sees across the fields.
            if (st.faked && dist - move >= IMPOSTOR_FROM * 1.15) {
              st.from = st.to = IMPOSTOR;
              st.fade = 1;
              st.dir = 1;
              st.seen = this.frame;
              this.jobSpread = spread(st.diameter / 2 + move, dist);
              this.stageImpostor(st, Math.atan2(dz, dx));
              st.staticJob = job;
              continue;
            }
            const { t, hysteresis: margin } = st.budget;
            const unseen =
              st.seen < this.frame - 1 && st.staticJob !== this.committedJob;
            // Drawn in its chunk's block of faked trees by the last job: a settled impostor, as a static one.
            if (
              unseen &&
              st.faked &&
              st.home?.job === this.committedJob &&
              !cut
            ) {
              st.from = st.to = IMPOSTOR;
              st.fade = 1;
              st.dir = 1;
            } else if (cut || unseen) {
              // Neither drawn last frame nor in the last static batches (or a cut): new, it takes its level at once.
              st.from = st.to = selectLevel(
                (st.diameter * px) / Math.max(dist, 0.5),
                IMPOSTOR,
                t,
                0,
                dist,
                st.reach.full,
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
            // Settled at l for every camera in the window: LOD0 only inside the tree's full-detail distance (`selectLevel`);
            // LOD1 the whole window outside it and above the impostor threshold; the impostor the whole window outside
            // it and inside its hysteresis band.
            const steadyLevel =
              st.from === l &&
              (l === 0
                ? dMax < st.reach.full
                : dMin >= st.reach.full &&
                  (l === IMPOSTOR
                    ? hMax <= t[l - 1] * (1 + margin) &&
                      dMin >= IMPOSTOR_FROM * (1 + margin)
                    : hMin >= t[l] || dMax < IMPOSTOR_FROM));
            const angle = Math.atan2(dz, dx);
            this.jobSpread = spread(st.diameter / 2 + move, dist);
            if (steadyLevel) {
              // May come within the shadow distance: carries its shadow, which the shader keeps within tlShadowD (and
              // drawn whatever the view, for the shadows of trees behind the camera).
              const near = dMin < shadowD;
              if (l === IMPOSTOR) {
                this.stageImpostor(st, angle);
                if (near) {
                  this.stageStatic(st, 1, SHADOW_ONLY, true, true, angle, 0);
                  if (st.lv.proxy)
                    this.stageStatic(
                      st,
                      PROXY_PART,
                      SHADOW_ONLY,
                      true,
                      true,
                      angle,
                      0,
                    );
                }
              } else {
                const sh = near ? shadowLevel(l) : -1;
                this.stageStatic(st, l, SOLID, sh === l, near, angle, l);
                if (sh >= 0 && sh !== l)
                  this.stageStatic(st, sh, SHADOW_ONLY, true, true, angle, 0);
                // Sprites cast no shadow: the crown proxy does (trees/proxy.ts).
                this.stageStatic(
                  st,
                  spritePart(dMin, st.reach),
                  SOLID,
                  false,
                  false,
                  angle,
                  l,
                );
                if (near && st.lv.proxy)
                  this.stageStatic(
                    st,
                    PROXY_PART,
                    SHADOW_ONLY,
                    true,
                    true,
                    angle,
                    0,
                  );
              }
              st.staticJob = job;
            } else {
              this.nextActive.push(st);
            }
          }
        yield;
      }
    // The commit (every batch re-packed) in a slice of its own, not stacked on the job's last one.
    yield true;
    [this.active, this.nextActive] = [this.nextActive, this.active];
    this.committedJob = job;
    for (const b of this.statics.values()) {
      [b.c, b.s] = [b.s, b.c];
      this.packStatic(b, true);
    }
    [ib.c, ib.s] = [ib.s, ib.c];
    [ib.cb, ib.sb] = [ib.sb, ib.cb];
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
    b.sphere = grow(b.sphere, (i + 1) * 4);
    b.mat.set(st.m, i * 16);
    b.inst.set(st.inst, i * 4);
    b.fade.set(fade, i * 4);
    this.lodOf(st, b.lod, i * 4);
    b.angle[i] = angle;
    b.always[i] = always ? 1 : 0;
    b.sphere[i * 4] = st.cx;
    b.sphere[i * 4 + 1] = st.cy;
    b.sphere[i * 4 + 2] = st.cz;
    b.sphere[i * 4 + 3] = st.diameter / 2;
    b.owner[i] = st;
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

  /** Every frame: select, fade and write every active tree into its batches' room. */
  private drawActive(px: number, dt: number): void {
    this.frame++;
    for (const b of this.statics.values()) {
      b.dyn = 0;
      b.dynSolid = 0;
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
        st.reach.full,
      );
      const fresh = st.seen < frame - 1;
      st.seen = frame;
      // Culled (keeps its state) or coming into view: its selected level at once, no fade.
      const snap = !visible || !st.visible || fresh || dt === 0;
      const wasFading = st.from !== st.to;
      // A finer level a distance rule demands (no impostor inside IMPOSTOR_FROM, LOD0 inside the full-detail ring)
      // never waits for a slot: with the slots taken (medium quality crosses many more trees) the impostor stayed to 10 m.
      const urgent =
        sel < st.to &&
        (st.to === IMPOSTOR ? dist < IMPOSTOR_FROM : dist < st.reach.full);
      if (
        stepFade(st, sel, snap, dt, lod.fadeTime, fading < MAX_FADES || urgent)
      )
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
      // Sprites: with both branch levels; fading out against the impostor. The crown proxy casts their shadow while
      // the tree is settled on branches.
      if (role >= 0 && visible) {
        const part = spritePart(dist, st.reach);
        this.emit(
          st,
          part,
          role,
          st.fade,
          false,
          (isFading ? st.from : st.to) + code,
        );
      }
      if (sh >= 0 && st.lv.proxy)
        this.emit(st, PROXY_PART, SHADOW_ONLY, 1, true, 0);
    }
    // Impostors: this frame's dynamic part on top of what a pack queued.
    if (ib.count > ib.packed) this.uploadRange(ib, ib.packed, ib.count);
    for (const mesh of ib.meshes) {
      mesh.count = ib.count;
      mesh.visible = this.shows(mesh, ib.count);
    }
    const fb = this.farImpostorBatch();
    let statics = ib.packed + fb.count;
    let sprites = 0;
    for (const b of this.statics.values()) {
      this.finishRoom(b);
      if (b.level < IMPOSTOR) {
        levels[b.level] += b.solid;
        statics += b.solid;
      }
      sprites += (b.solid + b.dynSolid) * b.sprites;
    }
    levels[IMPOSTOR] += ib.packed + fb.count;
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
    let b: Batch;
    let i: number;
    if (part === IMPOSTOR) {
      b = this.impostorBatch();
      i = b.count++;
      if (b.count > b.capacity) this.ensureCapacity(b, b.count);
      if (role !== SHADOW_ONLY) b.solid++;
    } else {
      const vb = st.batches[part < IMPOSTOR ? part : part - 1];
      if (vb.dyn >= vb.dynCap) this.growRoom(vb);
      i = vb.dynAt + vb.dyn++;
      if (role !== SHADOW_ONLY) vb.dynSolid++;
      b = vb;
    }
    b.mat.set(st.m, i * 16);
    b.inst.set(st.inst, i * 4);
    b.fade[i * 4] = fade;
    b.fade[i * 4 + 1] = role;
    b.fade[i * 4 + 2] = shadow ? 1 : 0;
    b.fade[i * 4 + 3] = debug;
    this.lodOf(st, b.lod, i * 4);
  }

  /** More room for a batch's active trees: the static instances after it move up (and upload again). */
  private growRoom(b: StaticBatch): void {
    const cap = Math.max(8, b.dynCap * 2);
    const from = b.dynAt + b.dynCap;
    const total = b.dynAt + cap + b.rest;
    this.ensureCapacity(b, total);
    for (const [a, size] of [
      [b.mat, 16],
      [b.inst, 4],
      [b.fade, 4],
      [b.lod, 4],
    ] as const)
      a.copyWithin((b.dynAt + cap) * size, from * size, (from + b.rest) * size);
    b.dynCap = cap;
    b.count = total;
    b.casters = b.dynAt + cap;
    b.clearRoom = true;
    this.uploadRange(b, b.dynAt, total);
  }

  /**
   * After this frame's emits: collapse the room's slots the active trees no longer use, upload what changed, set the
   * draw counts (the room is drawn only when static instances follow it).
   */
  private finishRoom(b: StaticBatch): void {
    const used = b.dyn;
    const clear = b.clearRoom ? b.dynCap : Math.max(b.dynLast, used);
    for (let i = used; i < clear; i++) b.fade.set(COLLAPSED, (b.dynAt + i) * 4);
    if (clear > 0) this.uploadRoom(b, clear);
    b.clearRoom = false;
    b.dynLast = used;
    b.dynPeak = Math.max(b.dynPeak, used);
    const n = b.rest > 0 ? b.count : b.dynAt + used;
    for (const mesh of b.meshes) {
      mesh.count = n;
      mesh.visible = this.shows(mesh, (b.live ?? b.dynAt + b.rest) + used);
    }
  }

  /**
   * Upload the room's first `n` slots, only the ones that changed since the last upload: a room is re-filled every
   * frame, but a tree's instance changes only while it fades or the active set changes, and each upload is a
   * `bufferSubData` per attribute (hundreds a frame cost ~2 ms on ANGLE / D3D11). Whole after a re-pack or grow.
   */
  private uploadRoom(b: StaticBatch, n: number): void {
    const at = b.dynAt;
    if (b.clearRoom || !b.sent || b.sent.length < b.dynCap * 28) {
      const sent = (b.sent = new Float32Array(b.dynCap * 28));
      for (let j = 0; j < n; j++) this.copySlot(b, at + j, sent, j);
      this.uploadRange(b, at, at + n);
      return;
    }
    if (b.pooled) {
      this.roomPooled(b, n);
      return;
    }
    // Per attribute (mat, inst, fade, lod): a fading tree changes only its fade, one upload instead of four.
    this.roomPart(b, n, b.mat, b.aMat!, 16, 0);
    this.roomPart(b, n, b.inst, b.aInst!, 4, 16);
    this.roomPart(b, n, b.fade, b.aFade!, 4, 20);
    this.roomPart(b, n, b.lod, b.aLod!, 4, 24);
  }

  /** One attribute of the room: the slots that differ from what was sent -> one update range. */
  private roomPart(
    b: StaticBatch,
    n: number,
    a: Float32Array,
    attr: InstancedBufferAttribute,
    size: number,
    off: number,
  ): void {
    const at = b.dynAt;
    const sent = b.sent!;
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < n; j++) {
      const i = (at + j) * size;
      const o = j * 28 + off;
      let same = true;
      for (let k = 0; k < size; k++)
        if (a[i + k] !== sent[o + k]) {
          same = false;
          sent[o + k] = a[i + k];
        }
      if (same) continue;
      if (lo < 0) lo = j;
      hi = j;
    }
    if (lo < 0) return;
    this.current.uploadBytes += (hi - lo + 1) * size * 4;
    attr.addUpdateRange((at + lo) * size, (hi - lo + 1) * size);
    attr.needsUpdate = true;
  }

  /** A pooled room: the slots that differ from what was sent -> one changed range (one span upload). */
  private roomPooled(b: StaticBatch, n: number): void {
    const at = b.dynAt;
    const sent = b.sent!;
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < n; j++) {
      const i = at + j;
      const o = j * 28;
      let same = true;
      for (let k = 0; k < 16; k++)
        if (b.mat[i * 16 + k] !== sent[o + k]) {
          same = false;
          sent[o + k] = b.mat[i * 16 + k];
        }
      for (let k = 0; k < 4; k++) {
        if (b.inst[i * 4 + k] !== sent[o + 16 + k]) {
          same = false;
          sent[o + 16 + k] = b.inst[i * 4 + k];
        }
        if (b.fade[i * 4 + k] !== sent[o + 20 + k]) {
          same = false;
          sent[o + 20 + k] = b.fade[i * 4 + k];
        }
        if (b.lod[i * 4 + k] !== sent[o + 24 + k]) {
          same = false;
          sent[o + 24 + k] = b.lod[i * 4 + k];
        }
      }
      if (same) continue;
      if (lo < 0) lo = j;
      hi = j;
    }
    if (lo < 0) return;
    this.current.uploadBytes += (hi - lo + 1) * 32 * 4;
    this.pool.mark(b, at + lo, at + hi + 1);
  }

  /** Instance `i` of `b` -> slot `j` of a 28-float-a-slot copy (mat, inst, fade, lod). */
  private copySlot(b: Batch, i: number, out: Float32Array, j: number): void {
    out.set(b.mat.subarray(i * 16, i * 16 + 16), j * 28);
    out.set(b.inst.subarray(i * 4, i * 4 + 4), j * 28 + 16);
    out.set(b.fade.subarray(i * 4, i * 4 + 4), j * 28 + 20);
    out.set(b.lod.subarray(i * 4, i * 4 + 4), j * 28 + 24);
  }

  /** Add instances [from, to) to this frame's upload (on top of a pack's). */
  private uploadRange(b: Batch, from: number, to: number): void {
    this.current.uploadBytes += (to - from) * 28 * 4;
    if (b.pooled) {
      this.pool.mark(b, from, to);
      return;
    }
    for (const a of [b.aMat!, b.aInst!, b.aFade!, b.aLod!]) {
      a.addUpdateRange(from * a.itemSize, (to - from) * a.itemSize);
      a.needsUpdate = true;
    }
  }

  /** A variant's batches: LOD0, LOD1 branches, the sprite buckets, the crown proxy (cached on the state). */
  private batchesOf(lv: LoadedVariant): StaticBatch[] {
    let list = this.batchesByVariant.get(lv);
    if (!list)
      this.batchesByVariant.set(
        lv,
        (list = PARTS.map((p) => this.staticBatch(lv, p))),
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
      sb: stagedBlocks(),
      cb: stagedBlocks(),
      packed: 0,
    };
    const material = this.library.impostors?.material;
    if (material) {
      const g = new BufferGeometry();
      const q = impostorQuad();
      for (const [name, a] of Object.entries(q.attributes))
        g.setAttribute(name, a);
      g.setIndex(q.index);
      const mesh = this.addMesh(
        b,
        g,
        material,
        'tree impostors',
        false,
        'branch',
      );
      // Far trees: beyond the shadow box, no shadow map reads.
      mesh.receiveShadow = false;
    }
    this.ensureCapacity(b, 64);
    this.impostors = b;
    return b;
  }

  private staticBatch(lv: LoadedVariant, part: number): StaticBatch {
    const key = `${lv.info.species}#${lv.info.index}:${part}`;
    let b = this.statics.get(key);
    if (!b) {
      b = {
        ...this.newBatch(),
        level: part,
        s: staged(),
        c: staged(),
        dynAt: 0,
        dynCap: 0,
        dyn: 0,
        dynLast: 0,
        dynPeak: 0,
        dynSolid: 0,
        rest: 0,
        clearRoom: false,
        pooled: true,
      };
      this.createMeshes(b, lv, part);
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
      pooled: false,
      base: -1,
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

  /**
   * The sun's shadow box in light space for a pack (opts.shadowExtent; null = unset or no view): centred half a box
   * ahead of the camera along the view (as engine/environment.ts places it), widened by how far the camera can move
   * and turn before the next pack (a job or a REPACK).
   */
  private shadowBox(
    v: { yaw: number } | null,
  ): { reaches(s: Float32Array, at: number): boolean } | null {
    const ext = this.opts.shadowExtent;
    if (!ext || !v) return null;
    const sun = worldUniforms.wsSunDir.value;
    // The shadow camera's axes (Matrix4.lookAt from the sun, up +y): right = y x sun, up = sun x right.
    const rl = Math.hypot(sun.z, sun.x);
    if (rl < 1e-3) return null;
    const rx = sun.z / rl;
    const rz = -sun.x / rl;
    const ux = sun.y * rz;
    const uy = sun.z * rx - sun.x * rz;
    const uz = -sun.y * rx;
    const p = this.steadyPos;
    const bx = p.x + Math.cos(v.yaw) * ext * 0.5;
    const bz = p.z + Math.sin(v.yaw) * ext * 0.5;
    const by = p.y;
    // + the chase camera's distance behind the car (the box follows the car, this the camera).
    const margin =
      (this.opts.rebuildDistance ?? 5) + 4 + ext * 0.5 * REPACK + 10;
    return {
      reaches: (s, at) => {
        const dx = s[at] - bx;
        const dy = s[at + 1] - by;
        const dz = s[at + 2] - bz;
        const lim = ext + s[at + 3] + margin;
        return (
          Math.abs(dx * rx + dz * rz) <= lim &&
          Math.abs(dx * ux + dy * uy + dz * uz) <= lim
        );
      },
    };
  }

  /**
   * `commit`: a job's new instances (the room grows for the most active trees since the last one). Slot-stable: a tree
   * keeps its slot from pack to pack, so a commit or a view turn writes and uploads only the trees that came, went or
   * changed (a whole re-pack + upload of every batch every 5 m was most of the p99 frames). Whole again when a region
   * runs out of room, the room is resized (grows, or shrinks under half use), or the holes pass HOLES of the slots.
   */
  private packStatic(b: StaticBatch, commit = false): void {
    let dynCap = b.dynCap;
    if (commit) {
      // Grows at once; shrinks (a whole pack) only below half, so a cut or a dense stretch does not leave idle
      // room slots running the vertex shader for the rest of the stage.
      const want = Math.max(4, Math.ceil(Math.max(b.dynPeak, b.dyn) * 1.25));
      if (want > dynCap || want * 2 < dynCap) dynCap = want;
      b.dynPeak = 0;
    }
    if (dynCap !== b.dynCap || !b.slots || !this.packDelta(b))
      this.packWhole(b, dynCap);
  }

  /** Region of staged instance `i`: 0 not drawn, 1 shadow caster, 2 the rest (the same tests as `pack`). */
  private regionOf(
    c: Staged,
    i: number,
    v: { yaw: number; half: number } | null,
    box: ReturnType<TreeRenderer['shadowBox']>,
  ): number {
    const casts =
      c.fade[i * 4 + 2] > 0.5 && (!box || box.reaches(c.sphere, i * 4));
    if (!casts && c.fade[i * 4 + 1] === SHADOW_ONLY) return 0;
    if (v && !c.always[i]) {
      let a = Math.abs(c.angle[i] - v.yaw) % (2 * Math.PI);
      if (a > Math.PI) a = 2 * Math.PI - a;
      if (a > v.half + REPACK + c.spread[i]) return 0;
    }
    return casts ? 1 : 2;
  }

  /** Staged instance `i` -> batch slot `n`, only where it differs; true when it changed. */
  private writeSlot(b: Batch, n: number, c: Staged, i: number): boolean {
    // Non-short-circuit `|`: every attribute is written.
    return (
      (copyChanged(b.mat, c.mat, n, i, 16) |
        copyChanged(b.inst, c.inst, n, i, 4) |
        copyChanged(b.fade, c.fade, n, i, 4) |
        copyChanged(b.lod, c.lod, n, i, 4)) !==
      0
    );
  }

  /** Empty slot `n` (drawn as nothing, like an unused room slot); true when it changed. */
  private collapseSlot(b: Batch, n: number): boolean {
    let changed = false;
    for (let k = 0; k < 4; k++)
      if (b.fade[n * 4 + k] !== COLLAPSED[k]) {
        b.fade[n * 4 + k] = COLLAPSED[k];
        changed = true;
      }
    return changed;
  }

  /** Every tree into a fresh layout [casters + HEADROOM free | room | rest]; uploads it all. */
  private packWhole(b: StaticBatch, dynCap: number): void {
    this.current.repacks++;
    const v = this.packedView ?? this.view;
    const box = this.shadowBox(v);
    const c = b.c;
    const cs: number[] = [];
    const rs: number[] = [];
    for (let i = 0; i < c.count; i++) {
      const r = this.regionOf(c, i, v, box);
      if (r === 1) cs.push(i);
      else if (r === 2) rs.push(i);
    }
    const cCap =
      cs.length +
      (cs.length ? Math.max(2, Math.ceil(cs.length * HEADROOM)) : 0);
    const total = cCap + dynCap + rs.length;
    this.ensureCapacity(b, total);
    const slots: Slots = {
      c: new Map(),
      r: new Map(),
      cFree: [],
      rFree: [],
      cLen: cs.length,
      rLen: rs.length,
      cCap,
    };
    let solid = 0;
    cs.forEach((i, k) => {
      this.writeSlot(b, k, c, i);
      slots.c.set(c.owner[i], k);
      if (c.fade[i * 4 + 1] !== SHADOW_ONLY) solid++;
    });
    for (let k = cs.length; k < cCap; k++) this.collapseSlot(b, k);
    const base = cCap + dynCap;
    rs.forEach((i, k) => {
      this.writeSlot(b, base + k, c, i);
      slots.r.set(c.owner[i], k);
      solid++;
    });
    b.slots = slots;
    b.solid = solid;
    b.live = cs.length + rs.length;
    b.dynCap = dynCap;
    b.dynAt = cCap;
    b.casters = cCap + dynCap;
    b.count = total;
    b.rest = rs.length;
    b.clearRoom = true;
    this.upload(b, b.count);
  }

  /** This pack's changes into the kept slots, uploading only those; false = a whole pack is due. */
  private packDelta(b: StaticBatch): boolean {
    const s = b.slots!;
    const v = this.packedView ?? this.view;
    const box = this.shadowBox(v);
    const c = b.c;
    const nextC = new Map<TreeState, number>();
    const nextR = new Map<TreeState, number>();
    for (let i = 0; i < c.count; i++) {
      const r = this.regionOf(c, i, v, box);
      if (r === 1) nextC.set(c.owner[i], i);
      else if (r === 2) nextR.set(c.owner[i], i);
    }
    // Changed slot ranges, caster region / rest region (relative to their region).
    const dirty = [Infinity, -1, Infinity, -1];
    const mark = (r: number, k: number) => {
      dirty[r * 2] = Math.min(dirty[r * 2], k);
      dirty[r * 2 + 1] = Math.max(dirty[r * 2 + 1], k);
    };
    const base = s.cCap + b.dynCap;
    // Frees first (a tree moving between regions frees its old slot), then the new trees into free slots.
    for (const [o, k] of s.c)
      if (!nextC.has(o)) {
        s.c.delete(o);
        s.cFree.push(k);
        if (this.collapseSlot(b, k)) mark(0, k);
      }
    for (const [o, k] of s.r)
      if (!nextR.has(o)) {
        s.r.delete(o);
        s.rFree.push(k);
        if (this.collapseSlot(b, base + k)) mark(1, k);
      }
    let solid = nextR.size;
    for (const [o, i] of nextC) {
      let k = s.c.get(o);
      if (k === undefined) {
        k = s.cFree.pop() ?? s.cLen++;
        if (k >= s.cCap) return false;
        s.c.set(o, k);
      }
      if (this.writeSlot(b, k, c, i)) mark(0, k);
      if (c.fade[i * 4 + 1] !== SHADOW_ONLY) solid++;
    }
    let adds = 0;
    for (const o of nextR.keys()) if (!s.r.has(o)) adds++;
    const need = base + s.rLen + Math.max(0, adds - s.rFree.length);
    // Bigger buffers (count = the old layout, all kept): new attributes, uploaded whole on their first draw.
    const grown = need > b.capacity;
    if (grown) this.ensureCapacity(b, need);
    for (const [o, i] of nextR) {
      let k = s.r.get(o);
      if (k === undefined) {
        k = s.rFree.pop() ?? s.rLen++;
        s.r.set(o, k);
      }
      if (this.writeSlot(b, base + k, c, i)) mark(1, k);
    }
    // Free slots at the end of the rest are dropped (not drawn).
    if (s.rFree.length) {
      const free = new Set(s.rFree);
      while (s.rLen > 0 && free.delete(s.rLen - 1)) s.rLen--;
      s.rFree = [...free];
    }
    if (s.cFree.length + s.rFree.length > HOLES * (s.c.size + s.r.size) + 4)
      return false;
    b.count = base + s.rLen;
    b.live = s.c.size + s.r.size;
    b.rest = s.rLen;
    b.solid = solid;
    if (!grown) {
      if (dirty[1] >= 0) this.uploadRange(b, dirty[0], dirty[1] + 1);
      if (dirty[3] >= 0)
        this.uploadRange(b, base + dirty[2], base + dirty[3] + 1);
    }
    for (const mesh of b.meshes) {
      mesh.count = b.count;
      mesh.visible = this.shows(mesh, b.live + b.dyn);
    }
    return true;
  }

  /**
   * Static impostors -> the front of the impostor batch (the dynamic ones follow each frame), those past
   * IMPOSTOR_FLAT_FROM of the camera into the far batch instead (its program writes no baked depth: the early depth
   * test then rejects their hidden pixels, and at that distance the baked depth changes next to nothing). Slot-stable
   * like the static batches (`packRuns`): a commit uploads only the impostors that came or went.
   */
  private packImpostors(): void {
    const b = this.impostorBatch();
    const f = this.farImpostorBatch();
    const p = this.steadyPos;
    const v = this.packedView ?? this.view;
    const c = b.c;
    const m = c.mat;
    const inView = (angle: number, spread: number) => {
      if (!v) return true;
      let a = Math.abs(angle - v.yaw) % (2 * Math.PI);
      if (a > Math.PI) a = 2 * Math.PI - a;
      return a <= v.half + REPACK + spread;
    };
    const near: number[] = [];
    const farS: number[] = [];
    for (let i = 0; i < c.count; i++) {
      if (!c.always[i] && !inView(c.angle[i], c.spread[i])) continue;
      const far =
        (m[i * 16 + 12] - p.x) ** 2 + (m[i * 16 + 14] - p.z) ** 2 >
        IMPOSTOR_FLAT_FROM * IMPOSTOR_FLAT_FROM;
      (far ? farS : near).push(i);
    }
    const k = b.cb;
    const nearK: ChunkTrees[] = [];
    const farK: ChunkTrees[] = [];
    for (let i = 0; i < k.count; i++) {
      if (!inView(k.angle[i], k.spread[i])) continue;
      const ct = k.list[i];
      (chunkDistance(ct, p.x, p.z) > IMPOSTOR_FLAT_FROM ? farK : nearK).push(
        ct,
      );
    }
    b.packed = this.packRuns(b, c, near, nearK);
    b.count = b.packed;
    f.count = this.packRuns(f, c, farS, farK);
    // Trees, not slots: the packed extent also holds holes and headroom.
    const trees = (idx: number[], ks: ChunkTrees[]) =>
      ks.reduce((n, ct) => n + ct.faked.length, idx.length);
    b.solid = trees(near, nearK);
    f.solid = trees(farS, farK);
    for (const mesh of f.meshes) {
      mesh.count = f.count;
      mesh.visible = this.shows(mesh, f.count);
    }
  }

  /**
   * Single impostors (staged `idx`) into slots [0, sCap) and whole chunk blocks into runs after them, each kept from
   * pack to pack; what left is collapsed and its slots reused; only the changed slots upload. Returns the packed
   * count. Whole again when the singles outgrow their region or the holes pass HOLES.
   */
  private packRuns(
    b: Batch,
    c: Staged,
    idx: readonly number[],
    blocks: readonly ChunkTrees[],
  ): number {
    let s = this.runs.get(b);
    if (s && this.runsDelta(b, s, c, idx, blocks)) return s.sCap + s.kLen;
    // Whole: singles, headroom, then the blocks back to back.
    const sCap = idx.length + Math.max(16, Math.ceil(idx.length * HEADROOM));
    let kLen = 0;
    for (const ct of blocks) kLen += ct.faked.length;
    this.ensureCapacity(b, sCap + kLen + 64);
    s = {
      s: new Map(),
      sFree: [],
      sLen: idx.length,
      sCap,
      k: new Map(),
      kFree: [],
      kLen: 0,
    };
    idx.forEach((i, n) => {
      this.writeSlot(b, n, c, i);
      s!.s.set(c.owner[i], n);
    });
    for (let n = idx.length; n < sCap; n++) this.collapseSlot(b, n);
    for (const ct of blocks) {
      const at = sCap + s.kLen;
      this.writeBlock(b, at, ct);
      s.k.set(ct, { at, len: ct.faked.length, version: ct.version });
      s.kLen += ct.faked.length;
    }
    this.runs.set(b, s);
    this.current.repacks++;
    this.upload(b, sCap + s.kLen);
    return sCap + s.kLen;
  }

  private runsDelta(
    b: Batch,
    s: RunSlots,
    c: Staged,
    idx: readonly number[],
    blocks: readonly ChunkTrees[],
  ): boolean {
    let lo = Infinity;
    let hi = -1;
    const mark = (a: number, z: number) => {
      lo = Math.min(lo, a);
      hi = Math.max(hi, z);
    };
    const next = new Map<TreeState, number>();
    for (const i of idx) next.set(c.owner[i], i);
    for (const [o, n] of s.s)
      if (!next.has(o)) {
        s.s.delete(o);
        s.sFree.push(n);
        if (this.collapseSlot(b, n)) mark(n, n);
      }
    for (const [o, i] of next) {
      let n = s.s.get(o);
      if (n === undefined) {
        n = s.sFree.pop() ?? s.sLen++;
        if (n >= s.sCap) return false;
        s.s.set(o, n);
      }
      if (this.writeSlot(b, n, c, i)) mark(n, n);
    }
    // Blocks: a run per chunk; a changed one (re-staged, other size) is freed and placed again.
    const want = new Set(blocks);
    for (const [ct, r] of s.k)
      if (
        !want.has(ct) ||
        r.version !== ct.version ||
        r.len !== ct.faked.length
      ) {
        s.k.delete(ct);
        s.kFree.push({ at: r.at, len: r.len });
        for (let n = r.at; n < r.at + r.len; n++)
          if (this.collapseSlot(b, n)) mark(n, n);
      }
    let adds = 0;
    for (const ct of blocks) if (!s.k.has(ct)) adds += ct.faked.length;
    const need = s.sCap + s.kLen + adds + 64;
    // Bigger buffers (the packed slots kept): new attributes, uploaded whole on their first draw.
    const grown = need > b.capacity;
    if (grown) {
      b.count = s.sCap + s.kLen;
      this.ensureCapacity(b, need);
    }
    for (const ct of blocks) {
      if (s.k.has(ct)) continue;
      const len = ct.faked.length;
      let at: number;
      const f = s.kFree.findIndex((r) => r.len >= len);
      if (f >= 0) {
        const r = s.kFree[f];
        at = r.at;
        if (r.len === len) s.kFree.splice(f, 1);
        else {
          r.at += len;
          r.len -= len;
        }
      } else {
        at = s.sCap + s.kLen;
        s.kLen += len;
      }
      this.writeBlock(b, at, ct);
      s.k.set(ct, { at, len, version: ct.version });
      mark(at, at + len - 1);
    }
    let holes = s.sFree.length;
    for (const r of s.kFree) holes += r.len;
    if (holes > HOLES * (s.s.size + s.kLen) + 64) return false;
    if (!grown && hi >= 0) this.uploadRange(b, lo, hi + 1);
    return true;
  }

  /** A chunk's block of faked trees -> slots [at, at + its trees). */
  private writeBlock(b: Batch, at: number, ct: ChunkTrees): void {
    b.mat.set(ct.mat, at * 16);
    b.inst.set(ct.inst, at * 4);
    b.fade.set(ct.fade, at * 4);
    b.lod.set(ct.lod, at * 4);
  }

  private farImpostorBatch(): Batch {
    if (this.farImpostors) return this.farImpostors;
    const b = this.newBatch();
    const material = this.library.impostors?.farMaterial;
    if (material) {
      const g = new BufferGeometry();
      const q = impostorQuad();
      for (const [name, a] of Object.entries(q.attributes))
        g.setAttribute(name, a);
      g.setIndex(q.index);
      const mesh = this.addMesh(
        b,
        g,
        material,
        'tree impostors far',
        false,
        'branch',
      );
      // Far trees: beyond the shadow box, no shadow map reads.
      mesh.receiveShadow = false;
    }
    this.ensureCapacity(b, 64);
    this.farImpostors = b;
    return b;
  }

  /** Instances [from, n) changed: upload that range, draw n. */
  private upload(b: Batch, n: number, from = 0): void {
    if (n > from) this.current.uploadBytes += (n - from) * 28 * 4;
    if (b.pooled) this.pool.mark(b, from, n);
    else
      for (const a of [b.aMat!, b.aInst!, b.aFade!, b.aLod!]) {
        a.clearUpdateRanges();
        a.addUpdateRange(from * a.itemSize, (n - from) * a.itemSize);
        a.needsUpdate = n > from;
      }
    for (const mesh of b.meshes) {
      mesh.count = n;
      mesh.visible = this.shows(mesh, n);
    }
  }

  /** CPU + GPU instance buffers for `n` instances (shared by the batch's meshes). */
  private ensureCapacity(b: Batch, n: number): void {
    if (n <= b.capacity) return;
    this.current.allocs++;
    let cap = Math.max(64, b.capacity);
    while (cap < n) cap *= 2;
    const keep = Math.min(b.count, cap);
    if (b.pooled) {
      const grow = (size: number, old: Float32Array) => {
        const arr = new Float32Array(cap * size);
        arr.set(old.subarray(0, keep * size));
        return arr;
      };
      b.mat = grow(16, b.mat);
      b.inst = grow(4, b.inst);
      b.fade = grow(4, b.fade);
      b.lod = grow(4, b.lod);
      this.pool.release(b.base, b.capacity);
      b.base = this.pool.alloc(cap);
      b.capacity = cap;
      this.pool.mark(b, 0, keep);
      return;
    }
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
      (mesh as InstancedMesh).instanceMatrix = b.aMat!;
      const g = b.geometries[i];
      g.setAttribute('treeInst', b.aInst!);
      g.setAttribute('treeFade', b.aFade!);
      g.setAttribute('treeLod', b.aLod!);
    });
    b.capacity = cap;
  }

  /**
   * The meshes of a batch: a branch level (bark), a sprite part (near: outlines, depth prepass + lit; far: quads, one
   * lit pass; both drawing a prefix of the rank-ordered sprites) or the crown's shadow proxy.
   */
  private createMeshes(b: StaticBatch, lv: LoadedVariant, part: number): void {
    const { leaf } = lv.def.foliage;
    if (part === NEAR_PART) {
      const keep = Math.min(1, NEAR_SPRITES * (1 + KEEP_WINDOW));
      b.sprites = Math.max(1, Math.ceil(keep * lv.spriteCount));
      const end = lv.spriteEnds[Math.min(lv.spriteCount, b.sprites) - 1] ?? 0;
      const pre = this.subDraw(
        b,
        lv.sprites,
        'prepass',
        `near:${leaf}`,
        spritePrepassMaterial(leaf),
        false,
        'sprite',
      );
      pre.elements = end;
      this.prepassMeshes.add(pre);
      const lit = this.subDraw(
        b,
        lv.sprites,
        'near',
        `near:${leaf}`,
        spriteMaterial(leaf),
        false,
        'sprite',
      );
      lit.elements = end;
      this.litSprites.add(lit);
    } else if (part === MID_PART || part === FAR_PART) {
      const sub = this.subDraw(
        b,
        lv.quads,
        'far',
        `far:${leaf}`,
        spriteFarMaterial(leaf),
        false,
        'sprite',
      );
      const resize = () => {
        b.sprites = bucketSprites(lv, part);
        sub.elements =
          lv.quadEnds[Math.min(lv.spriteCount, b.sprites) - 1] ?? 0;
      };
      resize();
      this.farResize.push(resize);
    } else if (part === PROXY_PART) {
      if (!lv.proxy) return;
      this.subDraw(
        b,
        lv.proxy,
        'proxy',
        'proxy',
        proxyMaterial(),
        true,
        'proxy',
      );
    } else {
      const kind = barkKind(lv.def);
      this.subDraw(
        b,
        lv.levels[part],
        part === 0 ? 'lod0' : 'lod1',
        `bark${part}:${kind}`,
        barkMaterial(kind),
        part === 1,
        'branch',
      );
    }
  }

  /**
   * A static batch's draw of one material: a sub-draw of the multi-draw of that material and part (every variant
   * of the part in one draw call, trees/multi-draw.ts).
   */
  private subDraw(
    b: StaticBatch,
    source: BufferGeometry,
    part: TreePart,
    geomKey: string,
    material: Material,
    casts: boolean,
    depth: TreeDepthKind,
  ): SubDraw {
    const key = `${part}|${geomKey}|${material.uuid}`;
    let d = this.draws.get(key);
    if (!d) {
      d = new MultiDraw(this, geomKey, source, material, {
        before: (shadow, tris) => {
          if (shadow) {
            this.current.shadowDraws++;
            this.current.shadowTriangles += tris;
          } else {
            this.current.mainDraws++;
            this.current.mainTriangles += tris;
          }
          this.timer?.begin(shadow);
        },
        after: () => this.timer?.end(),
      });
      const mesh = d.mesh;
      mesh.name = `tree ${part} ${geomKey}`;
      mesh.castShadow = casts;
      mesh.receiveShadow = material.colorWrite;
      if (casts) mesh.customDepthMaterial = treeDepthMaterial(depth);
      if (part === 'prepass') mesh.renderOrder = PREPASS_ORDER;
      // Crown proxies: the shadow pass only, off the main camera's layer (`shadowCasterLayers`).
      if (part === 'proxy') mesh.layers.set(SHADOW_ONLY_LAYER);
      this.draws.set(key, d);
      this.group.add(mesh);
    }
    const sub = new SubDraw(source, b, () => b.casters);
    d.add(sub);
    b.meshes.push(sub);
    this.partOf.set(sub, part);
    return sub;
  }

  private addMesh(
    b: Batch,
    g: BufferGeometry,
    material: Material,
    name: string,
    casts: boolean,
    sprite: TreeDepthKind,
  ): InstancedMesh {
    const mesh = new InstancedMesh(g, material, 1);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    // Never moved (the instances carry the transforms): no matrix compose every frame.
    mesh.matrixAutoUpdate = false;
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
    this.partOf.set(mesh, partOfMesh(name, sprite === 'proxy'));
    return mesh;
  }

  /** Whether a mesh with `n` instances draws: not empty, its prepass on, its part not hidden. */
  private shows(mesh: DrawView, n: number): boolean {
    if (n <= 0 || (!this.prepass && this.prepassMeshes.has(mesh))) return false;
    const part = this.partOf.get(mesh);
    return !part || !this.hiddenParts.has(part);
  }

  /** Debug (game/perf-panel.ts): draw a tree part or not, in every pass. */
  setPartVisible(part: TreePart, on: boolean): void {
    if (on) this.hiddenParts.delete(part);
    else this.hiddenParts.add(part);
    for (const b of this.batches())
      for (const mesh of b.meshes) mesh.visible = this.shows(mesh, mesh.count);
    this.syncDraws();
  }

  /** Sprite depth prepass on / off (the debug toggle; the overlay and the benchmark report it). */
  setPrepass(on: boolean): void {
    this.prepass = on;
    setSpritePrepass(on);
    for (const mesh of this.prepassMeshes)
      mesh.visible = this.shows(mesh, mesh.count);
    this.syncDraws();
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
    // A GPU that passed once is trusted from then on (the check renders the trees again: seconds of shader builds).
    const gpu = prepassVerdictKey(renderer);
    const known = readVerdict(gpu);
    if (known !== null) {
      if (!known) this.setPrepass(false);
      return;
    }
    // Only the trees (and the lights they are lit by) are drawn for the check, not the rest of the world.
    const hidden: Object3D[] = [];
    for (const child of scene.children)
      if (
        child !== this.group &&
        child.visible &&
        !child.getObjectByProperty('isLight', true)
      ) {
        child.visible = false;
        hidden.push(child);
      }
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
    this.syncDraws();
    const covered = magenta();
    for (const o of lit) o.visible = true;
    this.syncDraws();
    const missed = magenta();
    renderer.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
    this.debugMode = mode;
    target.dispose();
    this.prepassMisses = covered ? missed / covered : 0;
    this.prepassCovered = covered;
    const ok = this.prepassMisses <= PREPASS_MISS_LIMIT;
    // A scene with no sprite in view says nothing: only a measured verdict is kept.
    if (covered) writeVerdict(gpu, ok);
    if (!ok) this.setPrepass(false);
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
      if (b.pooled) this.pool.mark(b, 0, 1);
      else
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
      for (const part of PARTS) {
        const b = this.staticBatch(lv, part);
        // Slot 0 is overwritten: `settle` packs the batch whole.
        b.slots = null;
        one(b);
      }
    // Slot 0 is overwritten: `settle` packs the impostors whole.
    this.runs.clear();
    one(this.impostorBatch());
    one(this.farImpostorBatch());
    // Batches double as they fill while driving: twice the load's regions keeps the pool from growing mid-run.
    this.pool.reserve(this.pool.used * 2);
    this.syncDraws();
  }

  /** Re-apply visibility after prewarm / compile. */
  settle(): void {
    for (const b of this.statics.values()) {
      b.dyn = 0;
      this.packStatic(b);
      this.finishRoom(b);
    }
    this.packImpostors();
    this.upload(this.impostorBatch(), this.impostorBatch().count);
    this.syncDraws();
  }

  get busy(): boolean {
    return this.job !== null;
  }

  get meshCount(): number {
    let n = 0;
    for (const b of this.batches())
      if (!b.pooled) n += b.count > 0 ? b.meshes.length : 0;
    for (const d of this.draws.values()) if (d.mesh.visible) n++;
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
      for (const m of b.meshes) (m as InstancedMesh).dispose?.();
    }
    for (const d of this.draws.values()) d.dispose();
    this.draws.clear();
    this.pool.dispose();
    this.statics.clear();
    this.impostors = null;
    this.group.clear();
  }

  private batches(): Batch[] {
    return [
      ...this.statics.values(),
      ...(this.impostors ? [this.impostors] : []),
      ...(this.farImpostors ? [this.farImpostors] : []),
    ];
  }
}
