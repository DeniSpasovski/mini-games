import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Vector3,
} from 'three';
import { addWorldUniforms } from '../engine/world-shading';
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
/** Cells between the samples of the load-time ground (refined per chunk as its trees come in). */
const COARSE = 4;
/**
 * The crowns' mean albedo (`LoadedVariant.canopyColor`) times this: the trees' own light (leaf fill, translucency,
 * trees/materials.ts) is brighter than the shell's plain Lambert; matched by eye at the handover.
 */
const GAIN = 1.7;

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
 * - **Handover:** the trees dissolve over the last 15 % of the forest distance (`tlForest`); the shell dissolves in
 *   over the same band with the complementary 8x8 dither (trees/materials.ts `treeDither`).
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
  k = { area: 0, height: 0, color: [0, 0, 0] };
  for (let v = 0; ; v++) {
    const lv = library.variant(name, v);
    if (!lv) break;
    const r = lv.info.crown.r[0] * scale;
    k.area += Math.PI * r * r;
    k.height += lv.info.height * scale * TOP;
    for (let c = 0; c < 3; c++) k.color[c] += lv.canopyColor[c];
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
    shape.magFilter = shape.minFilter = LinearFilter;
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
    u.ffFrom.value = forestDistance;
    u.ffTo.value = viewDistance;

    const { geometry, snap } = shellGeometry(forestDistance, viewDistance);
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
    const visit = (asset: string, perM2: number, scale: number) => {
      const k = kindOf(asset, scale);
      if (!k) return;
      const w = perM2 * k.area;
      a += w;
      h += w * k.height;
      for (let c = 0; c < 3; c++) rgb[c] += w * k.color[c];
    };
    for (let j = 0; j < this.nz; j += step)
      for (let i = 0; i < this.nx; i += step) {
        a = h = rgb[0] = rgb[1] = rgb[2] = 0;
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
          // sqrt: dark greens keep their steps in 8 bits (the shader squares it back).
          for (let c = 0; c < 3; c++)
            this.tintData[o + c] = Math.round(
              Math.sqrt(Math.min(1, (this.rgb[k * 3 + c] / a) * GAIN)) * 255,
            );
          this.tintData[o + 3] = 255;
        }
      }
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
    this.shape.dispose();
    this.tint.dispose();
  }
}

/** A tree rule's mean crown: area (m^2), canopy height (m), colour (linear). */
interface Kind {
  area: number;
  height: number;
  color: number[];
}

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
/** Canopy surface height at xz: the ground where the cover thins out, the canopy where it is closed. */
float ffHeight( vec2 xz ) {
	vec4 t = texture2D( ffShape, ( xz - ffMap.xy ) * ffMap.zw );
	return ffBase + mix( t.b, t.r, smoothstep( 0.0, 0.35, t.g ) );
}
`;

const VERTEX_SHAPE = /* glsl */ `
	vec2 ffXZ = position.xz + ffCentre;
	float ffH = ffInfo.x != 0.0 || ffInfo.y != 0.0
		? 0.5 * ( ffHeight( ffXZ - ffInfo.xy ) + ffHeight( ffXZ + ffInfo.xy ) )
		: ffHeight( ffXZ );
	float ffS = ffInfo.z;
	vec3 ffPos = vec3( ffXZ.x, ffH + ffS * ${LIFT.toFixed(3)}, ffXZ.y );
	vec3 ffNormal = normalize( vec3(
		ffHeight( ffXZ - vec2( ffS, 0.0 ) ) - ffHeight( ffXZ + vec2( ffS, 0.0 ) ),
		2.0 * ffS,
		ffHeight( ffXZ - vec2( 0.0, ffS ) ) - ffHeight( ffXZ + vec2( 0.0, ffS ) )
	) );
	vFfXZ = ffXZ;
	vFfY = ffPos.y;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D ffShape;
uniform sampler2D ffTint;
uniform vec4 ffMap;
uniform float ffFrom;
uniform float ffTo;
varying vec2 vFfXZ;
varying float vFfY;
/** 8x8 ordered (Bayer) dither, 0..1: trees/materials.ts treeDither (the same tile, for a complementary handover). */
float ffDither() {
	int x = int( mod( gl_FragCoord.x, 8.0 ) );
	int y = int( mod( gl_FragCoord.y, 8.0 ) );
	int xy = x ^ y;
	int b = ( ( xy & 1 ) << 5 ) | ( ( x & 1 ) << 4 ) | ( ( xy & 2 ) << 2 ) | ( ( x & 2 ) << 1 ) | ( ( xy & 4 ) >> 1 ) | ( ( x & 4 ) >> 2 );
	return ( float( b ) + 0.5 ) / 64.0;
}
vec2 ffHash( vec2 p ) {
	p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
	return fract( sin( p ) * 43758.5453 );
}
/** Crown pattern: (offset from the nearest crown centre in crowns, that crown's random value). */
vec3 ffCrowns( vec2 p ) {
	vec2 c = floor( p );
	vec2 f = fract( p );
	float best = 8.0;
	vec2 off = vec2( 0.0 );
	float id = 0.0;
	for ( int y = -1; y <= 1; y++ )
		for ( int x = -1; x <= 1; x++ ) {
			vec2 g = vec2( float( x ), float( y ) );
			vec2 h = ffHash( c + g );
			vec2 d = g + 0.15 + 0.7 * h - f;
			float e = dot( d, d );
			if ( e < best ) { best = e; off = d; id = h.x; }
		}
	return vec3( off, id );
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
	if ( ffDither() >= ffKeep ) discard;
	vec3 ffC = texture2D( ffTint, ffUV ).rgb;
	diffuseColor.rgb = ffC * ffC;
	// Crowns: domes lit from above, darker gaps; faded out once a crown is a few pixels wide. Steep faces (a forest's
	// edge seen side-on) take the pattern along the face and up, not from above (it would streak down them).
	vec3 ffW = vec3( vFfXZ.x, vFfY, vFfXZ.y );
	vec3 ffN = normalize( cross( dFdx( ffW ), dFdy( ffW ) ) );
	vec2 ffAcross = normalize( ffN.xz + vec2( 1e-5 ) );
	vec2 ffP = ( abs( ffN.y ) < 0.6
		? vec2( dot( vFfXZ, vec2( -ffAcross.y, ffAcross.x ) ), vFfY )
		: vFfXZ ) / ${CROWN.toFixed(2)};
	vec3 ffCr = ffCrowns( ffP );
	float ffFoot = length( fwidth( ffP ) );
	float ffAmp = 1.0 - smoothstep( 0.15, 0.45, ffFoot );
	float ffD = clamp( length( ffCr.xy ) * 1.6, 0.0, 1.0 );
	float ffShade = mix( 0.68, 1.0, ( 1.0 - ffD * ffD ) ) * mix( 0.92, 1.08, ffCr.z );
	diffuseColor.rgb *= mix( 0.86, ffShade, ffAmp );
`;

/** After normal_fragment_maps: the crown domes bend the shell's normal (view space). */
const FRAGMENT_NORMAL = /* glsl */ `
	{
		vec3 ffBend = vec3( -ffCr.x, 0.0, -ffCr.y ) * ( 0.45 * ffAmp );
		normal = normalize( normal + ( viewMatrix * vec4( ffBend, 0.0 ) ).xyz );
	}
`;
