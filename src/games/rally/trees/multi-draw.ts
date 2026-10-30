import {
  Box2,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  InstancedMesh,
  NearestFilter,
  RGBAFormat,
  Vector2,
  type Material,
  type WebGLRenderer,
} from 'three';
import { MULTI_DRAW_EXT, TREE_MULTI_DRAWS, treeUniforms } from './materials';

/**
 * One draw call per tree material and part (trees/draw.ts): every variant's batch of that part is a sub-draw of ONE
 * `multiDrawElementsInstancedWEBGL` over a merged geometry, instead of an InstancedMesh each (~250 tree meshes a frame
 * on a forest stage: three's per-object work was most of their ~1 ms).
 *
 * - **Instance data** lives in one float texture (`TreePool`), 8 texels a tree: matrix (4), treeInst, treeFade,
 *   treeLod, unused. A batch owns a region of it; the shader reads tree `tmBase[gl_DrawID] + gl_InstanceID`
 *   (trees/materials.ts TREE_MULTI): instanced attributes cannot start at a per-draw offset in WebGL 2.
 * - **Uploads**: the batches keep their own arrays (trees/draw.ts writes them as before) and mark changed ranges; once
 *   a frame (`flush`) they are copied into the texture's array and sent as row spans (`copyTextureToTexture`).
 * - **Drawing**: the mesh is an InstancedMesh with count 0 (three sets the program, uniforms and buffers, then draws
 *   nothing); its `onAfterRender` / `onAfterShadow` issue the multi-draw with the batches' current counts. Without
 *   WEBGL_multi_draw (Firefox, `?multidraw=0`) the same data is drawn one sub-draw at a time with a `tmDraw` uniform.
 */

/** Texels per tree and trees per texture row. */
const TEXELS = 8;
const PER_ROW = 256;
const WIDTH = TEXELS * PER_ROW;
/** Changed ranges closer than this (trees) are sent as one span. */
const MERGE_GAP = 16;

/** The instance arrays of a batch (trees/draw.ts Batch): 16 + 4 + 4 + 4 floats a tree. */
export interface PoolSource {
  mat: Float32Array;
  inst: Float32Array;
  fade: Float32Array;
  lod: Float32Array;
  capacity: number;
  /** Its region: first tree in the pool (-1 = none yet). */
  base: number;
}

/** The shared per-tree texture: regions per batch, changed ranges sent once a frame. */
export class TreePool {
  texture: DataTexture;
  private src!: DataTexture;
  private data: Float32Array;
  private rows = 0;
  private top = 0;
  /** Trees allocated so far (the end of the last region). */
  get used(): number {
    return this.top;
  }
  private free = new Map<number, number[]>();
  /** Changed ranges: source, from, to (trees, relative to the source's region). */
  private dirty: (PoolSource | number)[] = [];
  private whole = true;
  private spans: number[] = [];
  private box = new Box2();
  private at = new Vector2();

  constructor() {
    this.data = new Float32Array(0);
    this.texture = this.makeTexture(64);
  }

  /** A region of `size` trees (a power of two), aligned so it never straddles a row unless it fills whole rows. */
  alloc(size: number): number {
    const list = this.free.get(size);
    if (list?.length) return list.pop()!;
    const align = Math.min(size, PER_ROW);
    const at = Math.ceil(this.top / align) * align;
    this.top = at + size;
    const need = Math.ceil(this.top / PER_ROW);
    if (need > this.rows) {
      let rows = this.rows;
      while (rows < need) rows *= 2;
      this.texture.dispose();
      this.texture = this.makeTexture(rows);
    }
    return at;
  }

  /** Room for `trees` without a grow (a grow re-uploads the whole texture: done at load, not while driving). */
  reserve(trees: number): void {
    const need = Math.ceil(trees / PER_ROW);
    if (need <= this.rows) return;
    let rows = this.rows;
    while (rows < need) rows *= 2;
    this.texture.dispose();
    this.texture = this.makeTexture(rows);
  }

  release(at: number, size: number): void {
    if (at < 0) return;
    let list = this.free.get(size);
    if (!list) this.free.set(size, (list = []));
    list.push(at);
  }

  /** Trees [from, to) of `s` changed (sent at the next `flush`). */
  mark(s: PoolSource, from: number, to: number): void {
    if (to > from) this.dirty.push(s, from, to);
  }

  /** Copy the changed trees into the texture's array and upload them (whole after a grow). */
  flush(renderer: WebGLRenderer | null): void {
    const d = this.dirty;
    const spans = this.spans;
    spans.length = 0;
    for (let k = 0; k < d.length; k += 3) {
      const s = d[k] as PoolSource;
      const from = d[k + 1] as number;
      const to = Math.min(d[k + 2] as number, s.capacity);
      if (s.base < 0 || to <= from) continue;
      this.copy(s, from, to);
      spans.push(s.base + from, s.base + to);
    }
    d.length = 0;
    if (this.whole || !renderer) {
      if (this.whole || spans.length) this.texture.needsUpdate = true;
      this.whole = false;
      return;
    }
    if (!spans.length) return;
    // Sort by start (pairs), merge near neighbours, send each as row pieces.
    const order: number[] = [];
    for (let i = 0; i < spans.length; i += 2) order.push(i);
    order.sort((a, b) => spans[a] - spans[b]);
    let lo = spans[order[0]];
    let hi = spans[order[0] + 1];
    for (let k = 1; k <= order.length; k++) {
      const i = order[k];
      if (k < order.length && spans[i] <= hi + MERGE_GAP) {
        hi = Math.max(hi, spans[i + 1]);
        continue;
      }
      this.send(renderer, lo, hi);
      if (k < order.length) {
        lo = spans[i];
        hi = spans[i + 1];
      }
    }
  }

  /** Trees [lo, hi) as at most three boxes: the first row's tail, whole rows, the last row's head. */
  private send(renderer: WebGLRenderer, lo: number, hi: number): void {
    while (lo < hi) {
      const row = Math.floor(lo / PER_ROW);
      const x = lo - row * PER_ROW;
      if (x === 0 && hi - lo >= PER_ROW) {
        const rows = Math.floor((hi - lo) / PER_ROW);
        this.box.min.set(0, row);
        this.box.max.set(WIDTH, row + rows);
        this.at.set(0, row);
        lo += rows * PER_ROW;
      } else {
        const end = Math.min(hi, (row + 1) * PER_ROW);
        this.box.min.set(x * TEXELS, row);
        this.box.max.set((end - row * PER_ROW) * TEXELS, row + 1);
        this.at.set(x * TEXELS, row);
        lo = end;
      }
      renderer.copyTextureToTexture(this.src, this.texture, this.box, this.at);
    }
  }

  private copy(s: PoolSource, from: number, to: number): void {
    const out = this.data;
    for (let i = from; i < to; i++) {
      const o = (s.base + i) * TEXELS * 4;
      for (let k = 0; k < 16; k++) out[o + k] = s.mat[i * 16 + k];
      for (let k = 0; k < 4; k++) {
        out[o + 16 + k] = s.inst[i * 4 + k];
        out[o + 20 + k] = s.fade[i * 4 + k];
        out[o + 24 + k] = s.lod[i * 4 + k];
      }
    }
  }

  private makeTexture(rows: number): DataTexture {
    const data = new Float32Array(WIDTH * rows * 4);
    data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    this.data = data;
    this.rows = rows;
    const make = () => {
      const t = new DataTexture(data, WIDTH, rows, RGBAFormat, FloatType);
      t.minFilter = t.magFilter = NearestFilter;
      t.generateMipmaps = false;
      return t;
    };
    const t = make();
    t.name = 'tree instances';
    t.needsUpdate = true;
    // The same bytes, never uploaded itself: the source of the span copies.
    this.src = make();
    this.whole = true;
    treeUniforms.tmData.value = t;
    return t;
  }

  dispose(): void {
    this.texture.dispose();
    this.src.dispose();
  }
}

/** One batch inside a multi-draw: its instances and its piece of the merged geometry. */
export class SubDraw {
  /** Instances drawn (the main pass) and whether they draw at all (trees/draw.ts sets both, like a mesh's). */
  count = 0;
  visible = false;
  /** Index range within its source geometry (a sprite part draws a prefix). */
  start = 0;
  elements = 0;
  constructor(
    readonly source: BufferGeometry,
    readonly pool: PoolSource,
    /** Shadow pass: instances up to this (-1 = all). */
    readonly casters: () => number,
  ) {
    this.elements = source.index?.count ?? 0;
  }
}

/** Several geometries with the same attributes in one vertex + index buffer (indices offset to the merged vertices). */
class MergedGeometry {
  geometry = new BufferGeometry();
  private sources: BufferGeometry[] = [];
  private starts = new Map<BufferGeometry, number>();
  private built = 0;
  users: InstancedMesh[] = [];

  add(g: BufferGeometry): void {
    if (!this.starts.has(g)) {
      this.starts.set(g, -1);
      this.sources.push(g);
    }
  }

  /** First index of `g` in the merged index buffer. */
  start(g: BufferGeometry): number {
    return this.starts.get(g) ?? 0;
  }

  /** Rebuild after new sources joined (every variant joins at load: once). */
  update(): void {
    if (this.built === this.sources.length) return;
    this.built = this.sources.length;
    const first = this.sources[0];
    const g = new BufferGeometry();
    let vertices = 0;
    let indices = 0;
    for (const s of this.sources) {
      vertices += s.getAttribute('position').count;
      indices += s.index!.count;
    }
    for (const [name, a] of Object.entries(first.attributes)) {
      const proto = a.array as unknown as {
        constructor: new (
          n: number,
        ) => ArrayLike<number> & { set(a: ArrayLike<number>, o: number): void };
      };
      const arr = new proto.constructor(vertices * a.itemSize);
      let at = 0;
      for (const s of this.sources) {
        const sa = s.getAttribute(name);
        arr.set(sa.array as ArrayLike<number>, at);
        at += sa.count * a.itemSize;
      }
      g.setAttribute(
        name,
        new BufferAttribute(
          arr as unknown as Float32Array,
          a.itemSize,
          a.normalized,
        ),
      );
    }
    const index =
      vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let vo = 0;
    let io = 0;
    for (const s of this.sources) {
      this.starts.set(s, io);
      const src = s.index!.array;
      for (let i = 0; i < src.length; i++) index[io + i] = src[i] + vo;
      io += src.length;
      vo += s.getAttribute('position').count;
    }
    g.setIndex(new BufferAttribute(index, 1));
    g.boundingSphere = first.boundingSphere;
    this.geometry.dispose();
    this.geometry = g;
    for (const m of this.users) m.geometry = g;
  }
}

/** The attribute layout of a geometry: only identical layouts merge. */
function layout(g: BufferGeometry): string {
  return Object.entries(g.attributes)
    .map(
      ([n, a]) =>
        `${n}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`,
    )
    .sort()
    .join(',');
}

const merged = new WeakMap<object, Map<string, MergedGeometry>>();

type Locations = {
  base: WebGLUniformLocation | null;
  id: WebGLUniformLocation | null;
};
const locations = new WeakMap<WebGLProgram, Locations>();

/** Counters + GPU timing hooks of the tree renderer (trees/stats.ts). */
export interface DrawHooks {
  before(shadow: boolean, triangles: number): void;
  after(): void;
}

/** One multi-draw: a material, a merged geometry, its sub-draws. */
export class MultiDraw {
  readonly mesh: InstancedMesh;
  readonly subs: SubDraw[] = [];
  private geo: MergedGeometry;
  private offsets = new Int32Array(0);
  private counts = new Int32Array(0);
  private insts = new Int32Array(0);
  private bases = new Int32Array(0);
  private n = 0;

  constructor(
    owner: object,
    geomKey: string,
    sample: BufferGeometry,
    material: Material,
    hooks: DrawHooks,
  ) {
    let byKey = merged.get(owner);
    if (!byKey) merged.set(owner, (byKey = new Map()));
    const key = `${geomKey}|${layout(sample)}`;
    let geo = byKey.get(key);
    if (!geo) byKey.set(key, (geo = new MergedGeometry()));
    this.geo = geo;
    const mesh = (this.mesh = new InstancedMesh(geo.geometry, material, 1));
    geo.users.push(mesh);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    let tris = 0;
    mesh.onBeforeRender = () => {
      tris = this.collect(false);
      hooks.before(false, tris);
    };
    mesh.onAfterRender = (renderer) => {
      this.draw(renderer, tris);
      hooks.after();
    };
    mesh.onBeforeShadow = () => {
      tris = this.collect(true);
      hooks.before(true, tris);
    };
    mesh.onAfterShadow = (renderer) => {
      this.draw(renderer, tris);
      hooks.after();
    };
  }

  add(sub: SubDraw): void {
    this.geo.add(sub.source);
    this.subs.push(sub);
  }

  /** Before rendering: the merged geometry current, the mesh drawn only with something in it. */
  sync(): void {
    this.geo.update();
    let on = false;
    for (const s of this.subs) if (s.visible && s.count > 0) on = true;
    this.mesh.visible = on;
  }

  /** This pass' sub-draws into the call arrays; returns the triangles. */
  private collect(shadow: boolean): number {
    const subs = this.subs;
    if (this.offsets.length < subs.length) {
      const n = Math.ceil(subs.length / 4) * 4;
      this.offsets = new Int32Array(n);
      this.counts = new Int32Array(n);
      this.insts = new Int32Array(n);
      this.bases = new Int32Array(n);
    }
    const bytes = this.geo.geometry.index!.array.BYTES_PER_ELEMENT;
    let n = 0;
    let tris = 0;
    for (const s of subs) {
      if (!s.visible || s.count <= 0 || s.elements <= 0) continue;
      const c = s.casters();
      const inst = shadow && c >= 0 ? Math.min(s.count, c) : s.count;
      if (inst <= 0) continue;
      this.offsets[n] = (this.geo.start(s.source) + s.start) * bytes;
      this.counts[n] = s.elements;
      this.insts[n] = inst;
      this.bases[n] = s.pool.base;
      tris += (s.elements / 3) * inst;
      n++;
    }
    this.n = n;
    return tris;
  }

  private draw(renderer: WebGLRenderer, tris: number): void {
    const n = this.n;
    if (!n) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) return;
    let loc = locations.get(program);
    if (!loc) {
      loc = {
        base: gl.getUniformLocation(program, 'tmBase'),
        id: gl.getUniformLocation(program, 'tmDraw'),
      };
      locations.set(program, loc);
    }
    const type =
      this.geo.geometry.index!.array.BYTES_PER_ELEMENT === 4
        ? gl.UNSIGNED_INT
        : gl.UNSIGNED_SHORT;
    const ext = MULTI_DRAW_EXT ? multiDraw(renderer) : null;
    const max = TREE_MULTI_DRAWS * 4;
    for (let k = 0; k < n; k += max) {
      const m = Math.min(max, n - k);
      gl.uniform4iv(loc.base, this.bases, k, Math.ceil(m / 4) * 4);
      if (ext && !loc.id)
        ext.multiDrawElementsInstancedWEBGL(
          gl.TRIANGLES,
          this.counts,
          k,
          type,
          this.offsets,
          k,
          this.insts,
          k,
          m,
        );
      else
        for (let i = 0; i < m; i++) {
          gl.uniform1i(loc.id, i);
          gl.drawElementsInstanced(
            gl.TRIANGLES,
            this.counts[k + i],
            type,
            this.offsets[k + i],
            this.insts[k + i],
          );
        }
    }
    renderer.info.update(tris * 3, gl.TRIANGLES, 1);
  }

  dispose(): void {
    this.mesh.dispose();
    this.geo.geometry.dispose();
  }
}

type MultiDrawExt = {
  multiDrawElementsInstancedWEBGL(
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    instanceCounts: Int32Array,
    instanceCountsOffset: number,
    drawCount: number,
  ): void;
};
const exts = new WeakMap<WebGLRenderer, MultiDrawExt | null>();

function multiDraw(renderer: WebGLRenderer): MultiDrawExt | null {
  let e = exts.get(renderer);
  if (e === undefined) {
    e = renderer
      .getContext()
      .getExtension('WEBGL_multi_draw') as MultiDrawExt | null;
    exts.set(renderer, e);
  }
  return e;
}
