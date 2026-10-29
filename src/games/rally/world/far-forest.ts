import {
  BufferAttribute,
  Box3,
  BufferGeometry,
  type Camera,
  Color,
  DataTexture,
  DataUtils,
  FloatType,
  Frustum,
  HalfFloatType,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Vector3,
} from 'three';
import { hash3 } from '../../../shared/rng';
import { addWorldUniforms } from '../engine/world-shading';
import { impostorQuad } from '../trees/draw';
import { impostorMaterial } from '../trees/materials';
import { speciesOfType } from '../trees/species';
import type { TreeLibrary } from '../trees/load';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/** Metres per map cell (coarsened for very large maps so a side stays <= MAX_SIDE). */
const RES = 8;
const MAX_SIDE = 2048;
/** Scatter chunk keys looked at per `update()` (a cheap Map lookup each). */
const SCAN = 600;
/** Main-thread budget per `update()` (ms): splatting new chunks, then encoding their cells. */
const BUDGET = 1;
/** Minimum time between texture uploads (ms): only the rows of the cells that changed (texture update ranges). */
const UPLOAD_EVERY = 500;
/** More row ranges than this pending: one whole upload instead (the first seconds of a stage). */
const MAX_RANGES = 1500;
/** The canopy surface: this share of a tree's height (the crowns' tops, between the tips). */
const TOP = 0.88;
/** Grid spacing of the shell's first ring (m); every ring doubles it. */
const SPACING = 8;
/** The shell is lifted by this share of its grid spacing: a coarse grid must not sink under a fine ridge. */
const LIFT = 0.15;
/** Average crown spacing of the shader's crown pattern (m). */
const CROWN = 6.5;
/** How far (m) the shell reaches past the view distance: the terrain's tiles end up to that far out. */
const OVERHANG = 160;
/** Crowns along a side of the crown tile (crownTexture) and its size (px). */
const CROWN_TILE = 8;
const CROWN_TEX = 256;
/**
 * The far trees (`farTrees`): one candidate tree per FAR_CELL m cell out to FAR_REACH m (and FAR_MARGIN short of the
 * view distance: the shell takes over before the horizon); a cell grows its tree with chance cover x FAR_FILL.
 */
const FAR_CELL = 6;
const FAR_REACH = 1500;
const FAR_MARGIN = 200;
const FAR_FILL = 1.2;
/**
 * The far trees are drawn by tiles of FAR_TILE x FAR_TILE cells (world-fixed): each frame only the tiles in the view
 * and the trees' ring (at most MAX_TILES) get instances, so the vertex shader runs for few cells off screen.
 */
const FAR_TILE = 32;
const MAX_TILES = 256;
/** Cells between the samples of the load-time ground (refined per chunk as its trees come in). */
const COARSE = 4;
/**
 * The crowns' mean albedo (`LoadedVariant.canopyColor`) times this: the trees' own light (leaf fill, translucency,
 * trees/materials.ts) is brighter than the shell's plain Lambert; matched by eye at the handover.
 */
const GAIN = 1.7;
/** The tint map holds colour / TINT_RANGE (world/horizon.ts reads it too). */
export const TINT_RANGE = 2;

/**
 * The far forest (spec: trees/Performance.md#mitigations "Far forest"): past the forest distance, where no tree is
 * drawn, a canopy shell - ONE camera-centred grid mesh raised to the forest's canopy, so woods keep their volume and
 * silhouette out to the view distance instead of a flat colour on the ground.
 *
 * - **Canopy map:** every tree of every generated scatter chunk is splatted once into a top-down map of RES m cells:
 *   ground height (sampled every COARSE cells at load), canopy height (TOP of the trees' heights), crown
 *   cover and the crowns' colour as drawn (`LoadedVariant.canopyColor`, so the season's; tinted per tree as the trees
 *   are). Incremental like world/canopy-shadows.ts: only chunks the streamers have generated, BUDGET ms a frame, and
 *   only the changed rows uploaded, at most every UPLOAD_EVERY.
 * - **Shell:** square rings of a grid (spacing SPACING, doubling per ring), centred on the camera snapped to the
 *   coarsest ring's spacing (no swimming); the vertex shader lifts each vertex to the canopy, edge vertices of a
 *   finer ring average their coarser neighbours (no cracks). Fragments: the cover dithers the forest's edge and gaps,
 *   a crown pattern (CROWN m) shades domes and dark gaps while it is larger than a few pixels.
 * - **Far trees** (`farTrees`): between the forest distance and FAR_REACH, real impostors the vertex shader places from
 *   the canopy map, so a far slope shows trees, not a texture; the shell starts where they end.
 * - **Handover:** the trees dissolve over the last 15 % of the forest distance (`tlForest`) and the far trees in with
 *   the other side of the same 8x8 dither (trees/materials.ts `treeDither`); the shell takes the other side of the far
 *   trees' dissolve the same way.
 */
/**
 * The stage's mean crown colour as the far forest draws it (linear): for the land beyond the map (world/horizon.ts
 * `setForest`), so its woods take the season's colour too.
 */
export function canopyTone(library: TreeLibrary, world: World): Color {
  // The map's tree rules sampled on a grid: each species weighted by the crown cover it grows.
  const b = world.map.bounds;
  const crowns = new Map<string, Kind | null>();
  const rgb = [0, 0, 0];
  let w = 0;
  const N = 40;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++)
      world.scatter.treeRulesAt(
        b.minX + ((i + 0.5) / N) * (b.maxX - b.minX),
        b.minZ + ((j + 0.5) / N) * (b.maxZ - b.minZ),
        (asset, perM2, scale) => {
          const k = crownOf(library, crowns, asset, scale);
          if (!k) return;
          const a = perM2 * k.area;
          w += a;
          for (let c = 0; c < 3; c++) rgb[c] += a * k.color[c];
        },
      );
  if (w <= 0) return new Color(0x2f4626);
  return new Color(rgb[0] / w, rgb[1] / w, rgb[2] / w).multiplyScalar(
    GAIN * 0.86,
  );
}

/** A tree rule's mean crown over its species' variants (cached per asset and scale; null = species not loaded). */
function crownOf(
  library: TreeLibrary,
  cache: Map<string, Kind | null>,
  asset: string,
  scale: number,
): Kind | null {
  const key = `${asset}@${scale}`;
  let k = cache.get(key);
  if (k !== undefined) return k;
  const name = speciesOfType(asset).name;
  let n = 0;
  k = { area: 0, height: 0, color: [0, 0, 0], slots: [] };
  for (let v = 0; ; v++) {
    const lv = library.variant(name, v);
    if (!lv) break;
    const r = lv.info.crown.r[0] * scale;
    k.area += Math.PI * r * r;
    k.height += lv.info.height * scale * TOP;
    for (let c = 0; c < 3; c++) k.color[c] += lv.canopyColor[c];
    k.slots.push(lv.slot);
    n++;
  }
  if (!n) k = null;
  else {
    k.area /= n;
    k.height /= n;
    for (let c = 0; c < 3; c++) k.color[c] /= n;
  }
  cache.set(key, k);
  return k;
}

export class FarForest {
  readonly mesh: Mesh;
  /** The far trees: impostors the vertex shader places from the canopy map (null: no impostors loaded). */
  readonly farTrees: Mesh | null = null;
  private ftTiles: DataTexture | null = null;
  /** Where the far trees start (m): just inside the forest distance. */
  private ftNear = { value: 0 };
  private shapeData: Uint16Array;
  private tintData: Uint8Array;
  private shape: DataTexture;
  private tint: DataTexture;
  /** Per cell: crown area (m^2), area-weighted canopy height, colour; ground height; its chunk splatted (0 / 1). */
  private area: Float32Array;
  private top: Float32Array;
  private rgb: Float32Array;
  private ground: Float32Array;
  private splatted: Uint8Array;
  /** Per cell: one tree's impostor slot + 1 (0 = none), picked by crown area; the summed area so far. */
  private kind: Uint8Array;
  private kindArea: Float32Array;
  private nx: number;
  private nz: number;
  private res: number;
  private x0: number;
  private z0: number;
  /** Heights are stored relative to this (m): half floats keep ~1 m steps over the map. */
  private base: number;
  private todo: Int32Array;
  private todoCount: number;
  private cursor = 0;
  /** Splatted chunks' cell rects (i0, i1, j0, j1) not encoded yet; encoded rows waiting for the next upload. */
  private dirty: number[] = [];
  private ranges: number[] = [];
  private lastUpload = -Infinity;
  /** The coarsest ring's spacing: the grid's centre snaps to twice it. */
  private snap: number;
  private uniforms = {
    ffShape: { value: null as DataTexture | null },
    ffTint: { value: null as DataTexture | null },
    ffCrown: { value: crownTexture() },
    ffMap: { value: new Vector4() },
    ffCentre: { value: new Vector2() },
    ffBase: { value: 0 },
    /** Forest distance (m): the shell dissolves in over its last 15 %. */
    ffFrom: { value: 0 },
    /** View distance (m): the horizon backdrop takes over there; the shell dissolves out just before it. */
    ffTo: { value: 0 },
  };

  constructor(
    private world: World,
    private library: TreeLibrary,
    forestDistance: number,
    viewDistance: number,
    /** The shape map's mips need a renderable half-float format (`EXT_color_buffer_float` / `_half_float`). */
    mipmaps = true,
  ) {
    const b = world.map.bounds;
    const pad = 300;
    this.x0 = b.minX - pad;
    this.z0 = b.minZ - pad;
    const w = b.maxX - b.minX + 2 * pad;
    const d = b.maxZ - b.minZ + 2 * pad;
    this.res = Math.max(RES, w / MAX_SIDE, d / MAX_SIDE);
    this.nx = Math.ceil(w / this.res);
    this.nz = Math.ceil(d / this.res);
    const n = this.nx * this.nz;
    this.area = new Float32Array(n);
    this.top = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.ground = new Float32Array(n);
    this.splatted = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.kindArea = new Float32Array(n);
    this.base = world.analytic.height(
      (b.minX + b.maxX) / 2,
      (b.minZ + b.maxZ) / 2,
    );
    this.shapeData = new Uint16Array(n * 4);
    this.tintData = new Uint8Array(n * 4);
    this.coarseGround();
    this.estimate();

    const cs = world.scatter.chunkSize;
    const keys: number[] = [];
    for (let cz = Math.floor(this.z0 / cs); cz * cs <= this.z0 + d; cz++)
      for (let cx = Math.floor(this.x0 / cs); cx * cs <= this.x0 + w; cx++)
        keys.push(cx, cz);
    this.todo = Int32Array.from(keys);
    this.todoCount = keys.length / 2;

    const shape = new DataTexture(
      this.shapeData,
      this.nx,
      this.nz,
      RGBAFormat,
      HalfFloatType,
    );
    // Mipmapped: the shell's coarse rings sample it at their own scale (`ffHeightAt`).
    shape.magFilter = LinearFilter;
    shape.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
    shape.generateMipmaps = mipmaps;
    shape.name = 'far-forest-shape';
    this.encode(0, this.nx - 1, 0, this.nz - 1);
    shape.needsUpdate = true;
    this.shape = shape;
    const tint = new DataTexture(
      this.tintData,
      this.nx,
      this.nz,
      RGBAFormat,
      UnsignedByteType,
    );
    tint.magFilter = tint.minFilter = LinearFilter;
    tint.name = 'far-forest-tint';
    tint.needsUpdate = true;
    this.tint = tint;

    const u = this.uniforms;
    u.ffShape.value = shape;
    u.ffTint.value = tint;
    u.ffMap.value.set(
      this.x0,
      this.z0,
      1 / (this.nx * this.res),
      1 / (this.nz * this.res),
    );
    u.ffBase.value = this.base;
    u.ffTo.value = viewDistance;

    // The far trees reach past the trees; the shell starts where they end.
    const reach = Math.min(FAR_REACH, viewDistance - FAR_MARGIN);
    const shellFrom =
      library.impostors && reach > forestDistance ? reach : forestDistance;
    u.ffFrom.value = shellFrom;
    if (shellFrom > forestDistance)
      this.farTrees = this.farTreeMesh(forestDistance, reach);
    const { geometry, snap } = shellGeometry(shellFrom, viewDistance);
    this.snap = snap;
    const material = new MeshLambertMaterial({ color: 0xffffff });
    material.name = 'far forest';
    material.onBeforeCompile = (s) => {
      addWorldUniforms(s);
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace(
          '#include <beginnormal_vertex>',
          `${VERTEX_SHAPE}\n#include <beginnormal_vertex>\nobjectNormal = ffNormal;`,
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed = ffPos;',
        );
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\n${FRAGMENT_COLOR}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`,
        );
    };
    const mesh = new Mesh(geometry, material);
    mesh.name = 'far forest';
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
  }

  /** Loading: every chunk generated so far into the map at once, one whole upload. */
  fillNow(camera: Vector3): void {
    const scatter = this.world.scatter;
    for (let n = this.todoCount - 1; n >= 0; n--) {
      const cx = this.todo[n * 2];
      const cz = this.todo[n * 2 + 1];
      const chunk = scatter.cachedChunk(cx, cz);
      if (!chunk) continue;
      this.splatChunk(cx, cz, chunk.instances);
      this.todoCount--;
      this.todo[n * 2] = this.todo[this.todoCount * 2];
      this.todo[n * 2 + 1] = this.todo[this.todoCount * 2 + 1];
    }
    const d = this.dirty;
    for (let r = 0; r < d.length; r += 4)
      this.encode(d[r], d[r + 1], d[r + 2], d[r + 3]);
    d.length = 0;
    this.ranges.length = 0;
    for (const t of [this.shape, this.tint]) {
      t.clearUpdateRanges();
      t.needsUpdate = true;
    }
    this.update(camera);
  }

  /** Splat newly generated scatter chunks, upload when due, follow the camera. Cheap once everything near is in. */
  update(camera: Vector3, now = performance.now()): void {
    const t0 = performance.now();
    const scatter = this.world.scatter;
    for (let n = 0; n < SCAN && this.todoCount > 0; n++) {
      if (this.cursor >= this.todoCount) this.cursor = 0;
      const i = this.cursor * 2;
      const cx = this.todo[i];
      const cz = this.todo[i + 1];
      const chunk = scatter.cachedChunk(cx, cz);
      if (!chunk) {
        this.cursor++;
        continue;
      }
      this.splatChunk(cx, cz, chunk.instances);
      this.todoCount--;
      this.todo[i] = this.todo[this.todoCount * 2];
      this.todo[i + 1] = this.todo[this.todoCount * 2 + 1];
      if (performance.now() - t0 > BUDGET) break;
    }
    // Encode the splatted cells (each chunk's rect once), then upload their rows.
    const d = this.dirty;
    while (d.length && performance.now() - t0 < BUDGET) {
      const j1 = d.pop()!;
      const j0 = d.pop()!;
      const i1 = d.pop()!;
      const i0 = d.pop()!;
      this.encode(i0, i1, j0, j1);
      for (let j = j0; j <= j1; j++)
        this.ranges.push((j * this.nx + i0) * 4, (i1 - i0 + 1) * 4);
    }
    if (this.ranges.length && now - this.lastUpload >= UPLOAD_EVERY) {
      const whole = this.ranges.length / 2 > MAX_RANGES;
      for (const t of [this.shape, this.tint]) {
        t.clearUpdateRanges();
        if (!whole)
          for (let r = 0; r < this.ranges.length; r += 2)
            t.addUpdateRange(this.ranges[r], this.ranges[r + 1]);
        t.needsUpdate = true;
      }
      this.ranges.length = 0;
      this.lastUpload = now;
    }
    const s = this.snap * 2;
    this.uniforms.ffCentre.value.set(
      Math.round(camera.x / s) * s,
      Math.round(camera.z / s) * s,
    );
  }

  /** A chunk's trees into the cells, and its cells' ground heights. */
  private splatChunk(
    cx: number,
    cz: number,
    instances: readonly ScatterInstance[],
  ): void {
    const cs = this.world.scatter.chunkSize;
    const res = this.res;
    const i0 = Math.max(0, Math.floor((cx * cs - this.x0) / res));
    const i1 = Math.min(
      this.nx - 1,
      Math.floor(((cx + 1) * cs - this.x0) / res) - 1,
    );
    const j0 = Math.max(0, Math.floor((cz * cs - this.z0) / res));
    const j1 = Math.min(
      this.nz - 1,
      Math.floor(((cz + 1) * cs - this.z0) / res) - 1,
    );
    if (i1 < i0 || j1 < j0) return;
    // Its real trees replace the land cover estimate (`estimate`).
    for (let j = j0; j <= j1; j++)
      for (let k = j * this.nx + i0; k <= j * this.nx + i1; k++) {
        if (this.splatted[k]) continue;
        this.splatted[k] = 1;
        this.kind[k] = 0;
        this.kindArea[k] = 0;
        this.area[k] = 0;
        this.top[k] = 0;
        this.rgb[k * 3] = this.rgb[k * 3 + 1] = this.rgb[k * 3 + 2] = 0;
      }
    for (const inst of instances) {
      if (!inst.tree) continue;
      const lv = this.library.variant(inst.tree.species, inst.variant);
      if (!lv) continue;
      const i = Math.floor((inst.x - this.x0) / res);
      const j = Math.floor((inst.z - this.z0) / res);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const k = j * this.nx + i;
      const r = lv.info.crown.r[0] * inst.scale;
      const a = Math.PI * r * r;
      this.area[k] += a;
      this.top[k] += a * (inst.y + lv.info.height * inst.scale * TOP);
      // The cell's tree: each tree takes it with chance (its area / the area so far), so species keep their mix.
      this.kindArea[k] += a;
      const pick =
        hash3(Math.floor(inst.x * 16), Math.floor(inst.z * 16), 7, 0xfa7) /
        4294967296;
      if (pick * this.kindArea[k] < a) this.kind[k] = lv.slot + 1;
      const c = treeHue(lv.canopyColor, inst.tree.hue);
      const v = inst.tree.value * a;
      this.rgb[k * 3] += c[0] * v;
      this.rgb[k * 3 + 1] += c[1] * v;
      this.rgb[k * 3 + 2] += c[2] * v;
    }
    this.dirty.push(i0, i1, j0, j1);
  }

  /**
   * Every cell's ground from a grid COARSE cells apart (bilinear; one analytic sample per cell cost 0.3 s on a big
   * map): the shell needs a height everywhere, also where no chunk is splatted yet.
   */
  /**
   * Every cell from the map's tree rules (`Scatter.treeRulesAt`, sampled every COARSE cells): the forest the shell and
   * the horizon show where no chunk is generated (past the view distance, or not yet); a chunk's real trees replace it.
   */
  private estimate(): void {
    const kinds = new Map<string, Kind | null>();
    const kindOf = (asset: string, scale: number) =>
      crownOf(this.library, kinds, asset, scale);
    const step = COARSE;
    const res = this.res;
    const cell = res * res;
    let a = 0;
    let h = 0;
    const rgb = [0, 0, 0];
    const rules: { k: Kind; w: number }[] = [];
    const visit = (asset: string, perM2: number, scale: number) => {
      const k = kindOf(asset, scale);
      if (!k) return;
      const w = perM2 * k.area;
      if (k.slots.length) rules.push({ k, w });
      a += w;
      h += w * k.height;
      for (let c = 0; c < 3; c++) rgb[c] += w * k.color[c];
    };
    for (let j = 0; j < this.nz; j += step)
      for (let i = 0; i < this.nx; i += step) {
        a = h = rgb[0] = rgb[1] = rgb[2] = 0;
        rules.length = 0;
        this.world.scatter.treeRulesAt(
          this.x0 + (i + step / 2) * res,
          this.z0 + (j + step / 2) * res,
          visit,
        );
        if (a <= 0) continue;
        const ca = Math.min(a, 4) * cell;
        for (let jj = j; jj < Math.min(this.nz, j + step); jj++)
          for (let ii = i; ii < Math.min(this.nx, i + step); ii++) {
            const k = jj * this.nx + ii;
            this.area[k] = ca;
            this.top[k] = ca * (this.ground[k] + h / a);
            for (let c = 0; c < 3; c++) this.rgb[k * 3 + c] = (ca * rgb[c]) / a;
            // A rule by its share of the crowns, then one of its variants (hashed per cell).
            const hc = hash3(ii, jj, 11, 0xfa7);
            let r = ((hc & 0xffff) / 65536) * a;
            let rule = rules[0];
            for (const x of rules)
              if ((r -= x.w) < 0) {
                rule = x;
                break;
              }
            this.kind[k] = rule
              ? rule.k.slots[(hc >>> 16) % rule.k.slots.length] + 1
              : 0;
          }
      }
  }

  private coarseGround(): void {
    const step = COARSE;
    const cw = Math.ceil(this.nx / step) + 1;
    const ch = Math.ceil(this.nz / step) + 1;
    const grid = new Float32Array(cw * ch);
    const h = this.world.analytic;
    for (let j = 0; j < ch; j++)
      for (let i = 0; i < cw; i++)
        grid[j * cw + i] = h.height(
          this.x0 + (i * step + 0.5) * this.res,
          this.z0 + (j * step + 0.5) * this.res,
        );
    for (let j = 0; j < this.nz; j++) {
      const gj = Math.floor(j / step);
      const fj = j / step - gj;
      for (let i = 0; i < this.nx; i++) {
        const gi = Math.floor(i / step);
        const fi = i / step - gi;
        const a = grid[gj * cw + gi];
        const b = grid[gj * cw + gi + 1];
        const c = grid[(gj + 1) * cw + gi];
        const d = grid[(gj + 1) * cw + gi + 1];
        this.ground[j * this.nx + i] =
          (a + (b - a) * fi) * (1 - fj) + (c + (d - c) * fi) * fj;
      }
    }
  }

  /** Cells i0..i1 x j0..j1 -> the textures: shape = (canopy, cover, ground, splatted), heights relative to `base`. */
  private encode(i0: number, i1: number, j0: number, j1: number): void {
    const cell = this.res * this.res;
    const half = DataUtils.toHalfFloat;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        const g = this.ground[k];
        const a = this.area[k];
        const top = a > 0 ? this.top[k] / a : g;
        const o = k * 4;
        this.shapeData[o] = half(top - this.base);
        this.shapeData[o + 1] = half(Math.min(1, a / cell));
        this.shapeData[o + 2] = half(g - this.base);
        this.shapeData[o + 3] = half(this.splatted[k]);
        if (a > 0) {
          // sqrt: dark greens keep their steps in 8 bits (the shader squares it back); / TINT_RANGE: bright autumn
          // reds times GAIN pass 1 (clipped, they turned yellow-green next to the far trees).
          for (let c = 0; c < 3; c++)
            this.tintData[o + c] = Math.round(
              Math.sqrt(
                Math.min(1, ((this.rgb[k * 3 + c] / a) * GAIN) / TINT_RANGE),
              ) * 255,
            );
          // The cell's tree for the far trees (exact: read with texelFetch).
          this.tintData[o + 3] = Math.min(255, this.kind[k]);
        }
      }
  }

  /**
   * The far trees: the trees' own far impostors (their material, so the same look as the last trees) on a
   * camera-centred grid of FAR_CELL m cells; the vertex shader picks each cell's tree from the canopy map (variant,
   * height, cover), so the CPU never touches them. In over the trees' dissolve band, out towards `reach`.
   */
  private farTreeMesh(forestDistance: number, reach: number): Mesh {
    const imp = this.library.impostors!;
    const q = impostorQuad();
    const g = new InstancedBufferGeometry();
    for (const [name, a] of Object.entries(q.attributes))
      g.setAttribute(name, a);
    g.setIndex(q.index);
    g.instanceCount = 0;
    const tiles = new DataTexture(
      new Float32Array(MAX_TILES * 4),
      MAX_TILES,
      1,
      RGBAFormat,
      FloatType,
    );
    tiles.name = 'far-trees-tiles';
    this.ftTiles = tiles;
    const material = impostorMaterial(
      imp.atlas,
      imp.spheres,
      imp.bounds,
      true,
      {
        key: 'far-trees-v1',
        uniforms: {
          ffShape: this.uniforms.ffShape,
          ffTint: this.uniforms.ffTint,
          ffMap: this.uniforms.ffMap,
          ffBase: this.uniforms.ffBase,
          ftReach: { value: reach },
          ftNear: this.ftNear,
          ftHeights: { value: imp.heights },
          ftTiles: { value: tiles },
        },
        pars: farTreePars(imp.heights.length),
        main: FAR_TREE_MAIN,
      },
    );
    material.name = 'far trees';
    const mesh = new Mesh(g, material);
    mesh.name = 'far trees';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.ftNear.value = forestDistance * 0.8;
    mesh.onBeforeRender = (_r, _s, camera) =>
      this.pickTiles(camera, g, tiles, this.ftNear.value, reach);
    return mesh;
  }

  /** Forest distance changed at run time (perf panel): the far trees start where the trees now end. */
  setForestDistance(forestDistance: number): void {
    this.ftNear.value = forestDistance * 0.8;
  }

  /** Per tile: its ground's height range (+ the tallest trees), from a few terrain samples. */
  private tileY = new Map<number, [number, number]>();
  private lastTiles = new Float32Array(MAX_TILES * 4);
  private lastCount = -1;
  /** Warned once that the view held more tiles than MAX_TILES (the rest are dropped). */
  private tilesFull = false;

  /** The tiles in `camera`'s view between `near` and `reach` -> the tile texture and the instance count. */
  private pickTiles(
    camera: Camera,
    g: InstancedBufferGeometry,
    tiles: DataTexture,
    near: number,
    reach: number,
  ): void {
    _frustum.setFromProjectionMatrix(
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const p = camera.position;
    const w = FAR_TILE * FAR_CELL;
    const data = tiles.image.data as Float32Array;
    let n = 0;
    // Only tiles over the canopy map (cells outside it have no trees).
    const x1 = Math.min(p.x + reach, this.x0 + this.nx * this.res);
    const z1 = Math.min(p.z + reach, this.z0 + this.nz * this.res);
    for (
      let tz = Math.floor(Math.max(p.z - reach, this.z0) / w);
      tz * w <= z1;
      tz++
    )
      for (
        let tx = Math.floor(Math.max(p.x - reach, this.x0) / w);
        tx * w <= x1;
        tx++
      ) {
        const x0 = tx * w;
        const z0 = tz * w;
        const dx = Math.max(x0 - p.x, 0, p.x - x0 - w);
        const dz = Math.max(z0 - p.z, 0, p.z - z0 - w);
        if (Math.hypot(dx, dz) > reach) continue;
        const fx = Math.max(Math.abs(x0 - p.x), Math.abs(x0 + w - p.x));
        const fz = Math.max(Math.abs(z0 - p.z), Math.abs(z0 + w - p.z));
        if (Math.hypot(fx, fz) < near) continue;
        const y = this.tileHeights(tx, tz, w);
        _box.min.set(x0, y[0], z0);
        _box.max.set(x0 + w, y[1], z0 + w);
        if (!_frustum.intersectsBox(_box)) continue;
        if (n >= MAX_TILES) {
          if (!this.tilesFull)
            console.warn('far trees: more tiles in view than MAX_TILES');
          this.tilesFull = true;
          continue;
        }
        data[n * 4] = tx;
        data[n * 4 + 1] = tz;
        n++;
      }
    g.instanceCount = n * FAR_TILE * FAR_TILE;
    // Upload only when the list changed (most frames it does not).
    const last = this.lastTiles;
    let same = n === this.lastCount;
    for (let i = 0; same && i < n * 4; i += 4)
      same = last[i] === data[i] && last[i + 1] === data[i + 1];
    if (!same) {
      last.set(data.subarray(0, n * 4));
      this.lastCount = n;
      tiles.needsUpdate = true;
    }
  }

  private tileHeights(tx: number, tz: number, w: number): [number, number] {
    const k = tx * 65536 + tz;
    let y = this.tileY.get(k);
    if (y) return y;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j <= 4; j++)
      for (let i = 0; i <= 4; i++) {
        const h = this.world.analytic.height(
          tx * w + (i * w) / 4,
          tz * w + (j * w) / 4,
        );
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    // Slack for the ground between the samples, then the trees on it.
    y = [lo - 15, hi + 60];
    this.tileY.set(k, y);
    return y;
  }

  /** The canopy map, for the horizon's woods inside the map (world/horizon.ts `setForest`). */
  get canopy(): { shape: DataTexture; tint: DataTexture; map: Vector4 } {
    return {
      shape: this.shape,
      tint: this.tint,
      map: this.uniforms.ffMap.value,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    if (this.farTrees) {
      // The quad's buffers are shared with the tree impostor batches (`impostorQuad`): keep them.
      const g = this.farTrees.geometry;
      for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
      g.setIndex(null);
      g.dispose();
      (this.farTrees.material as MeshLambertMaterial).dispose();
      this.ftTiles?.dispose();
    }
    this.uniforms.ffCrown.value.dispose();
    this.shape.dispose();
    this.tint.dispose();
  }
}

/** A tree rule's mean crown: area (m^2), canopy height (m), colour (linear). */
interface Kind {
  area: number;
  height: number;
  color: number[];
  /** Its variants' impostor slots (`LoadedVariant.slot`). */
  slots: number[];
}

const _frustum = new Frustum();
const _vp = new Matrix4();
const _box = new Box3();

const _hue: [number, number, number] = [0, 0, 0];
/** A tree's colour turned by its hue shift (a fraction of a turn), as trees/materials.ts `treeHue` does it. */
function treeHue(c: readonly number[], turn: number): [number, number, number] {
  const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const i = 0.596 * c[0] - 0.274 * c[1] - 0.322 * c[2];
  const q = 0.211 * c[0] - 0.523 * c[1] + 0.312 * c[2];
  const a = turn * Math.PI * 2;
  const ci = Math.cos(a) * i - Math.sin(a) * q;
  const cq = Math.sin(a) * i + Math.cos(a) * q;
  _hue[0] = Math.max(0, y + 0.956 * ci + 0.621 * cq);
  _hue[1] = Math.max(0, y - 0.272 * ci - 0.647 * cq);
  _hue[2] = Math.max(0, y - 1.106 * ci + 1.703 * cq);
  return _hue;
}

/**
 * The shell's grid: square rings around the origin, ring k of spacing SPACING * 2^k from half size h_k to 2 h_k,
 * the first one's hole inside the forest distance's handover band (for any snap of the centre), the last one past
 * the view distance (quads beyond it left out). Per vertex `ffInfo` = (morph x, morph z, spacing): an odd vertex on
 * a ring's outer edge takes the mean height of its neighbours at +/- (morph x, z), as the coarser ring has no vertex there.
 */
function shellGeometry(
  forestDistance: number,
  viewDistance: number,
): { geometry: BufferGeometry; snap: number } {
  const inner = forestDistance * 0.85;
  // Rings until the outer edge passes the view distance (+ the centre's snap).
  let rings = 1;
  let n: number;
  for (;;) {
    const snap = SPACING * 2 ** (rings - 1);
    // Half size of the first ring's hole: inside the circle `inner` wherever the snapped centre is (corner + snap).
    const h0 = (inner - snap * Math.SQRT2) / Math.SQRT2;
    n = Math.max(4, Math.floor(h0 / SPACING) & ~1);
    const outer = n * SPACING * 2 ** rings;
    if (outer >= viewDistance + OVERHANG + snap * 2 || rings >= 6) break;
    rings++;
  }
  const snap = SPACING * 2 ** (rings - 1);
  const pos: number[] = [];
  const info: number[] = [];
  const index: number[] = [];
  const reach = viewDistance + OVERHANG + snap * 3;
  for (let r = 0; r < rings; r++) {
    const s = SPACING * 2 ** r;
    // Indices -2n..2n: outer half size 2 n s; hole |i|, |j| < n.
    const m = 2 * n;
    const side = 2 * m + 1;
    const at = new Int32Array(side * side).fill(-1);
    const vert = (i: number, j: number): number => {
      const k = (j + m) * side + (i + m);
      if (at[k] >= 0) return at[k];
      at[k] = pos.length / 3;
      pos.push(i * s, 0, j * s);
      // Odd vertex on the outer edge: between two vertices of the next ring.
      const edgeX = Math.abs(i) === m;
      const edgeZ = Math.abs(j) === m;
      let ex = 0;
      let ez = 0;
      if (r < rings - 1) {
        if (edgeX && Math.abs(j) % 2 === 1) ez = s;
        else if (edgeZ && Math.abs(i) % 2 === 1) ex = s;
      }
      info.push(ex, ez, s);
      return at[k];
    };
    for (let j = -m; j < m; j++)
      for (let i = -m; i < m; i++) {
        // Inside the hole (drawn by the finer ring, or the trees).
        if (i >= -n && i + 1 <= n && j >= -n && j + 1 <= n) continue;
        const nearX = Math.max(0, Math.abs(i + 0.5) - 0.5) * s;
        const nearZ = Math.max(0, Math.abs(j + 0.5) - 0.5) * s;
        if (Math.hypot(nearX, nearZ) > reach) continue;
        const a = vert(i, j);
        const b = vert(i + 1, j);
        const c = vert(i + 1, j + 1);
        const d = vert(i, j + 1);
        index.push(a, d, c, a, c, b);
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(pos), 3),
  );
  geometry.setAttribute(
    'ffInfo',
    new BufferAttribute(new Float32Array(info), 3),
  );
  geometry.setIndex(index);
  return { geometry, snap };
}

const VERTEX_PARS = /* glsl */ `
uniform sampler2D ffShape;
uniform vec4 ffMap;
uniform vec2 ffCentre;
uniform float ffBase;
attribute vec3 ffInfo;
varying vec2 vFfXZ;
varying float vFfY;
varying vec3 vFfN;
/** Canopy surface height at xz: the ground where the cover thins out, the canopy where it is closed. */
float ffHeight( vec2 xz ) {
	vec4 t = texture2D( ffShape, ( xz - ffMap.xy ) * ffMap.zw );
	return ffBase + mix( t.b, t.r, smoothstep( 0.0, 0.35, t.g ) );
}
/**
 * The canopy height averaged over about four grid spacings s (the shape map's mip level for it): a coarse ring's vertex
 * must not land on one cell's crown or gap (a sawtooth of ground / canopy heights: big facets lit each its own way).
 */
float ffHeightAt( vec2 xz, float s ) {
	vec2 uv = ( xz - ffMap.xy ) * ffMap.zw;
	float cell = 1.0 / ( ffMap.z * float( textureSize( ffShape, 0 ).x ) );
	vec4 t = textureLod( ffShape, uv, max( 0.0, log2( 4.0 * s / cell ) ) );
	return ffBase + mix( t.b, t.r, smoothstep( 0.0, 0.35, t.g ) );
}
`;

const VERTEX_SHAPE = /* glsl */ `
	vec2 ffXZ = position.xz + ffCentre;
	float ffS = ffInfo.z;
	// An odd edge vertex filters at the coarser ring's size (its two neighbours are that ring's vertices).
	float ffH = ffInfo.x != 0.0 || ffInfo.y != 0.0
		? 0.5 * ( ffHeightAt( ffXZ - ffInfo.xy, 2.0 * ffS ) + ffHeightAt( ffXZ + ffInfo.xy, 2.0 * ffS ) )
		: ffHeightAt( ffXZ, ffS );
	vec3 ffPos = vec3( ffXZ.x, ffH + ffS * ${LIFT.toFixed(3)}, ffXZ.y );
	vec3 ffNormal = normalize( vec3(
		ffHeightAt( ffXZ - vec2( ffS, 0.0 ), ffS ) - ffHeightAt( ffXZ + vec2( ffS, 0.0 ), ffS ),
		2.0 * ffS,
		ffHeightAt( ffXZ - vec2( 0.0, ffS ), ffS ) - ffHeightAt( ffXZ + vec2( 0.0, ffS ), ffS )
	) );
	vFfXZ = ffXZ;
	vFfY = ffPos.y;
	vFfN = ffNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D ffShape;
uniform sampler2D ffTint;
uniform sampler2D ffCrown;
uniform vec4 ffMap;
uniform float ffFrom;
uniform float ffTo;
varying vec2 vFfXZ;
varying float vFfY;
varying vec3 vFfN;
/** 8x8 ordered (Bayer) dither, 0..1: trees/materials.ts treeDither (the same tile, for a complementary handover). */
float ffDither() {
	int x = int( mod( gl_FragCoord.x, 8.0 ) );
	int y = int( mod( gl_FragCoord.y, 8.0 ) );
	int xy = x ^ y;
	int b = ( ( xy & 1 ) << 5 ) | ( ( x & 1 ) << 4 ) | ( ( xy & 2 ) << 2 ) | ( ( x & 2 ) << 1 ) | ( ( xy & 4 ) >> 1 ) | ( ( x & 4 ) >> 2 );
	return ( float( b ) + 0.5 ) / 64.0;
}
`;

/** After color_fragment: the canopy's colour, the dithered edge / handover, the crown pattern. */
const FRAGMENT_COLOR = /* glsl */ `
	vec2 ffUV = ( vFfXZ - ffMap.xy ) * ffMap.zw;
	vec4 ffT = texture2D( ffShape, ffUV );
	float ffDist = length( vFfXZ - cameraPosition.xz );
	// In over the trees' dissolve band; out past the view distance, over the streamed terrain's last tiles (they reach
	// past it), where the horizon backdrop (world/horizon.ts) has the same woods.
	float ffIn = smoothstep( ffFrom * 0.85, ffFrom, ffDist ) * ( 1.0 - smoothstep( ffTo + ${(OVERHANG * 0.4).toFixed(1)}, ffTo + ${OVERHANG.toFixed(1)}, ffDist ) );
	float ffKeep = smoothstep( 0.12, 0.5, ffT.g ) * ffIn;
	// The other side of the far trees' dither (they keep < 1 - in).
	if ( ffDither() < 1.0 - ffKeep ) discard;
	vec3 ffC = texture2D( ffTint, ffUV ).rgb;
	diffuseColor.rgb = ffC * ffC * ${TINT_RANGE.toFixed(1)};
	// Crowns: domes lit from above, darker gaps; faded out once a crown is a few pixels wide. Triplanar on fixed world
	// axes, weighted by the shell's smooth normal: steep faces (a forest's edge side-on, a mountainside) take the
	// pattern along the face and up, not from above (it would streak down them), and the weights never switch per
	// triangle (a facet of its own pattern each read as boxes on a far slope).
	vec3 ffN = normalize( vFfN );
	vec3 ffWt = pow( abs( ffN ), vec3( 4.0 ) );
	ffWt /= ffWt.x + ffWt.y + ffWt.z;
	// The crown tile (crownTexture): r = the crown's shade, gb = the offset from its centre; mipmapped, so a far slope
	// keeps its crowns down to about a pixel each and then their mean tone, never a flat blanket.
	float ffShade = 0.0;
	// The crown's offset back on the world axes of its face (the dome's bend of the normal).
	vec3 ffBend = vec3( 0.0 );
	if ( ffWt.y > 0.02 ) {
		vec4 c = texture2D( ffCrown, vFfXZ / ${(CROWN * CROWN_TILE).toFixed(2)} ); vec2 o = c.gb * 2.0 - 1.0;
		ffShade += c.r * ffWt.y; ffBend += vec3( o.x, 0.0, o.y ) * ffWt.y;
	}
	if ( ffWt.x > 0.02 ) {
		vec4 c = texture2D( ffCrown, vec2( vFfXZ.y, vFfY ) / ${(CROWN * CROWN_TILE).toFixed(2)} ); vec2 o = c.gb * 2.0 - 1.0;
		ffShade += c.r * ffWt.x; ffBend += vec3( 0.0, o.y, o.x ) * ffWt.x;
	}
	if ( ffWt.z > 0.02 ) {
		vec4 c = texture2D( ffCrown, vec2( vFfXZ.x, vFfY ) / ${(CROWN * CROWN_TILE).toFixed(2)} ); vec2 o = c.gb * 2.0 - 1.0;
		ffShade += c.r * ffWt.z; ffBend += vec3( o.x, o.y, 0.0 ) * ffWt.z;
	}
	diffuseColor.rgb *= ffShade * 1.25;
`;

/** After normal_fragment_maps: the crown domes bend the shell's normal (view space). */
const FRAGMENT_NORMAL = /* glsl */ `
	{
		normal = normalize( normal + ( viewMatrix * vec4( -ffBend * 0.45, 0.0 ) ).xyz );
	}
`;

/**
 * The crown tile: CROWN_TILE x CROWN_TILE crowns (one jittered crown per cell, wrapping), per texel r = the shade of
 * the shell's crown pattern (dome lit from above, darker gaps, a tone per crown; x 0.8 to fit a byte) and gb = the
 * offset from the nearest crown centre (crowns, 0.5 = none). Mipmapped and anisotropic: its mean is the far tone.
 */
function crownTexture(): DataTexture {
  const n = CROWN_TEX;
  const px = n / CROWN_TILE;
  const wrap = (c: number) => ((c % CROWN_TILE) + CROWN_TILE) % CROWN_TILE;
  const jitter = (cx: number, cz: number, k: number) =>
    hash3(wrap(cx), wrap(cz), k, 0x5eed) / 4294967296;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const p = (x + 0.5) / px;
      const q = (y + 0.5) / px;
      const cx = Math.floor(p);
      const cz = Math.floor(q);
      let best = 8;
      let ox = 0;
      let oz = 0;
      let id = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const hx = jitter(cx + i, cz + j, 0);
          const dx = cx + i + 0.15 + 0.7 * hx - p;
          const dz = cz + j + 0.15 + 0.7 * jitter(cx + i, cz + j, 1) - q;
          const e = dx * dx + dz * dz;
          if (e < best) {
            best = e;
            ox = dx;
            oz = dz;
            id = hx;
          }
        }
      const d = Math.min(1, Math.hypot(ox, oz) * 1.6);
      const shade = (0.68 + 0.32 * (1 - d * d)) * (0.92 + 0.16 * id);
      const k = (y * n + x) * 4;
      data[k] = Math.round(Math.min(1, shade * 0.8) * 255);
      data[k + 1] = Math.round(
        (Math.max(-1, Math.min(1, ox)) * 0.5 + 0.5) * 255,
      );
      data[k + 2] = Math.round(
        (Math.max(-1, Math.min(1, oz)) * 0.5 + 0.5) * 255,
      );
      data[k + 3] = 255;
    }
  const t = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.name = 'far-forest-crowns';
  t.needsUpdate = true;
  return t;
}

function farTreePars(variants: number): string {
  return /* glsl */ `
uniform sampler2D ffShape;
uniform sampler2D ffTint;
uniform vec4 ffMap;
uniform float ffBase;
uniform float ftReach;
uniform float ftNear;
uniform float ftHeights[ ${Math.max(1, variants)} ];
/** The tiles drawn (x = tile x, y = tile z): instance i is cell i % FT_TILE^2 of tile i / FT_TILE^2. */
uniform highp sampler2D ftTiles;
const int FT_TILE = ${FAR_TILE};
const float FT_CELL = ${FAR_CELL.toFixed(1)};
uint ftHash( ivec2 c, uint k ) {
	uint h = uint( c.x ) * 0x8da6b343u ^ uint( c.y ) * 0xd8163841u ^ k * 0xcb1ab31fu;
	h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
	return h;
}
float ftRand( ivec2 c, uint k ) { return float( ftHash( c, k ) >> 8 ) / 16777216.0; }
`;
}

/** Before the tree code: this instance's cell -> its tree, or none (tgOut = 0 collapses it). */
const FAR_TREE_MAIN = /* glsl */ `
	{
		int ftI = gl_InstanceID / ( FT_TILE * FT_TILE );
		int ftK = gl_InstanceID - ftI * FT_TILE * FT_TILE;
		ivec2 ftC = ivec2( texelFetch( ftTiles, ivec2( ftI, 0 ), 0 ).xy ) * FT_TILE + ivec2( ftK % FT_TILE, ftK / FT_TILE );
		vec2 ftXZ = ( vec2( ftC ) + 0.15 + 0.7 * vec2( ftRand( ftC, 0u ), ftRand( ftC, 1u ) ) ) * FT_CELL;
		float ftD = distance( ftXZ, tlCam.xz );
		treeInst = vec4( 0.0 );
		treeFade = vec4( 0.0 );
		instanceMatrix = mat4( 1.0 );
		tgOut = 0.0;
		vec2 ftUV = ( ftXZ - ffMap.xy ) * ffMap.zw;
		if ( ftD > ftNear && ftD < ftReach && all( greaterThanEqual( ftUV, vec2( 0.0 ) ) ) && all( lessThan( ftUV, vec2( 1.0 ) ) ) ) {
			vec4 ftTint = texelFetch( ffTint, ivec2( ftUV * vec2( textureSize( ffTint, 0 ) ) ), 0 );
			int ftSlot = int( ftTint.a * 255.0 + 0.5 ) - 1;
			vec4 ftShape = textureLod( ffShape, ftUV, 0.0 );
			float ftH = ( ftShape.r - ftShape.b ) / ${TOP.toFixed(2)} * ( 0.85 + 0.3 * ftRand( ftC, 3u ) );
			if ( ftSlot >= 0 && ftRand( ftC, 2u ) < ftShape.g * ${FAR_FILL.toFixed(2)} && ftH > 2.0 ) {
				float ftGround = ffBase + ftShape.b;
				// Off screen (its centre, padded by its height): skipped.
				vec4 ftClip = projectionMatrix * viewMatrix * vec4( ftXZ.x, ftGround + ftH * 0.5, ftXZ.y, 1.0 );
				vec2 ftPad = vec2( projectionMatrix[ 0 ][ 0 ], projectionMatrix[ 1 ][ 1 ] ) * ftH;
				if ( ftClip.w > - ftH && all( lessThan( abs( ftClip.xy ) - ftPad, vec2( ftClip.w ) ) ) ) {
					float ftS = ftH / ftHeights[ ftSlot ];
					float ftA = ftRand( ftC, 4u ) * 6.2832;
					float ftCos = cos( ftA ) * ftS;
					float ftSin = sin( ftA ) * ftS;
					instanceMatrix = mat4( ftCos, 0.0, - ftSin, 0.0, 0.0, ftS, 0.0, 0.0, ftSin, 0.0, ftCos, 0.0, ftXZ.x, ftGround, ftXZ.y, 1.0 );
					// As trees/placement.ts poses a tree: hue, value, sway phase; the variant slot.
					treeInst = vec4( ( ftRand( ftC, 5u ) - 0.5 ) * 0.06, 0.86 + 0.26 * ftRand( ftC, 6u ), ftRand( ftC, 7u ) * 6.2832, float( ftSlot ) );
					tgOut = 1.0 - smoothstep( ftReach * 0.85, ftReach, ftD );
				}
			}
		}
	}
`;
