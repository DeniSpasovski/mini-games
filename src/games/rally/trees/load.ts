import {
  BufferAttribute,
  BufferGeometry,
  type DataArrayTexture,
  type MeshLambertMaterial,
  type WebGLRenderer,
} from 'three';
import { getCached, pruneCached, putCached } from './cache';
import {
  bakeImpostor,
  impostorArray,
  impostorBounds,
  type ImpostorPixels,
} from './impostor';
import {
  barkMaterial,
  barkTexture,
  impostorMaterial,
  spriteMaterial,
  spriteTextures,
} from './materials';
import type { Crown, MeshData, SpriteData, VariantMeshes } from './mesh';
import { isTreeType, speciesOfType, type SpeciesDef } from './species';
import {
  cacheKey,
  generateVariant,
  registerVariant,
  variantSeed,
  variantsOf,
  type GeneratedVariant,
  type TreeVariantInfo,
} from './variants';
import type { GenerateRequest } from './worker';
import { meshBuffers } from './mesh';
import { crownProxy, quadSprites } from './proxy';
import type { TreeLoadStats } from './stats';

type Timed = GeneratedVariant & { ms: number };

/**
 * Stage load (spec: trees/Grammar.md#timing, trees/Placement.md#caching): every variant of the species a map uses,
 * from the disk cache or generated in a worker (never during a frame), turned into shared GPU geometry, its
 * impostor baked, and its summary registered for placement. `TreeLibrary` is what the drawing stage reads.
 */

export interface LoadedVariant {
  info: TreeVariantInfo;
  def: SpeciesDef;
  /** LOD0 / LOD1 branch tubes and the foliage sprites (drawn with both). */
  levels: BufferGeometry[];
  sprites: BufferGeometry;
  /** Sprites in the crown, and the index count up to each (rank order: thinned crowns draw a prefix). */
  spriteCount: number;
  spriteEnds: Uint32Array;
  /** The same sprites as plain quads (far crowns) and their index ends (trees/proxy.ts). */
  quads: BufferGeometry;
  quadEnds: Uint32Array;
  /** The crown's shadow caster (null: no foliage). */
  proxy: BufferGeometry | null;
  /** Slot of its impostor in the library's shared texture array (`TreeLibrary.impostors`). */
  slot: number;
}

function geometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('normal', new BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new BufferAttribute(m.uv, 2));
  g.setAttribute('color', new BufferAttribute(m.color, 3));
  g.setAttribute('treeWind', new BufferAttribute(m.wind, 4));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Every sprite vertex carries its crown's ellipsoid (the sprites' shadow lookup, trees/materials.ts). */
function crownAttributes(g: BufferGeometry, crown: Crown): void {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++)
    c.set([crown.c[0], crown.c[1], crown.c[2], crown.r[0]], i * 4);
  g.setAttribute('treeCrown', new BufferAttribute(c, 4));
  g.setAttribute(
    'treeCrownY',
    new BufferAttribute(new Float32Array(n).fill(crown.r[1]), 1),
  );
}

function spriteGeometry(s: SpriteData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(s.position, 3));
  g.setAttribute('normal', new BufferAttribute(s.normal, 3));
  g.setAttribute('uv', new BufferAttribute(s.uv, 2));
  g.setAttribute('color', new BufferAttribute(s.color, 3));
  g.setAttribute('treeWind', new BufferAttribute(s.wind, 4));
  g.setAttribute('treeSprite', new BufferAttribute(s.sprite, 4));
  g.setAttribute('treeRank', new BufferAttribute(s.rank, 1));
  g.setIndex(new BufferAttribute(s.index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Generates variants in a worker (or inline where there are no workers). A worker that fails (script load error,
 * a throw inside it) is dropped and its pending variants are generated inline, so the stage load never hangs.
 */
class Generator {
  private worker: Worker | null = null;
  private pending = new Map<
    number,
    {
      def: SpeciesDef;
      index: number;
      resolve: (g: Timed) => void;
      reject: (e: unknown) => void;
    }
  >();
  private next = 0;

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (
        e: MessageEvent<
          (Timed & { id: number }) | { id: number; error: string }
        >,
      ) => {
        const job = this.pending.get(e.data.id);
        if (!job) return;
        this.pending.delete(e.data.id);
        if ('error' in e.data) this.inline(job);
        else job.resolve(e.data);
      };
      const fail = (e: Event) => {
        console.warn('[trees] generator worker failed, generating inline', e);
        this.fallback();
      };
      this.worker.onerror = fail;
      this.worker.onmessageerror = fail;
    } catch {
      this.worker = null;
    }
  }

  /** A variant and the ms its derivation + meshing took. */
  generate(def: SpeciesDef, index: number): Promise<Timed> {
    return new Promise((resolve, reject) => {
      const job = { def, index, resolve, reject };
      if (!this.worker) return this.inline(job);
      const id = this.next++;
      this.pending.set(id, job);
      const req: GenerateRequest = { id, species: def.name, index };
      this.worker.postMessage(req);
    });
  }

  private inline(job: {
    def: SpeciesDef;
    index: number;
    resolve: (g: Timed) => void;
    reject: (e: unknown) => void;
  }): void {
    try {
      const t0 = performance.now();
      const g = generateVariant(job.def, job.index);
      job.resolve({ ...g, ms: performance.now() - t0 });
    } catch (e) {
      job.reject(e);
    }
  }

  /** Drop the worker; everything still pending is generated inline. */
  private fallback(): void {
    this.worker?.terminate();
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) this.inline(job);
  }

  dispose(): void {
    this.worker?.terminate();
  }
}

export class TreeLibrary {
  private variants = new Map<string, LoadedVariant[]>();
  /** Every variant's impostor: one texture array, one material (one draw for all impostors, trees/draw.ts). */
  impostors: {
    atlas: DataArrayTexture;
    material: MeshLambertMaterial;
    /** The far impostors' material: no baked depth (trees/draw.ts IMPOSTOR_FLAT_FROM). */
    farMaterial: MeshLambertMaterial;
  } | null = null;
  /** What loading cost (trees/Performance.md#counters). */
  stats: TreeLoadStats = {
    variants: 0,
    cached: 0,
    generateMs: 0,
    bakeMs: 0,
    totalMs: 0,
    gpuBytes: 0,
    diskBytes: 0,
  };

  /** Species of every tree type in `assets` (map rules / fixed instances). */
  static speciesOf(assets: Iterable<string>): SpeciesDef[] {
    const out = new Set<SpeciesDef>();
    for (const a of assets) if (isTreeType(a)) out.add(speciesOfType(a));
    return [...out];
  }

  /** Load every variant of `species`; `report` gets 0..1 progress. */
  static async load(
    species: SpeciesDef[],
    renderer: WebGLRenderer,
    report: (f: number) => void = () => {},
  ): Promise<TreeLibrary> {
    const lib = new TreeLibrary();
    const st = lib.stats;
    const t0 = performance.now();
    const gen = new Generator();
    const jobs = species.flatMap((def) =>
      variantsOf(def).map((i) => ({ def, i })),
    );
    let done = 0;
    // Cache lookups / worker generation run in parallel; baking (GPU) one after another as results arrive.
    const results = await Promise.all(
      jobs.map(async ({ def, i }) => {
        const key = cacheKey(def, variantSeed(def, i));
        const cached = await getCached(key);
        if (cached) {
          st.cached++;
          return { def, i, key, g: cached, impostor: cached.impostor };
        }
        const g = await gen.generate(def, i);
        st.generateMs += g.ms;
        return { def, i, key, g, impostor: undefined };
      }),
    );
    gen.dispose();
    const allPixels: ImpostorPixels[] = [];
    const spheres: { cy: number; r: number }[] = [];
    const bounds: [number, number, number, number][] = [];
    for (const { def, i, key, g, impostor } of results) {
      const b0 = performance.now();
      const v = lib.build(def, g.info, g.meshes, impostor, renderer);
      if (!impostor) st.bakeMs += performance.now() - b0;
      if (!impostor)
        void putCached(key, {
          info: g.info,
          meshes: g.meshes,
          impostor: v.pixels,
        });
      // Memory: mesh buffers + impostor pixels on disk; on the GPU the same + the atlases' mips (~1/3 more).
      const meshBytes =
        meshBuffers(g.meshes).reduce((n, b) => n + b.byteLength, 0) +
        g.info.capsules.byteLength;
      const px =
        v.pixels.albedo.byteLength +
        v.pixels.normal.byteLength +
        v.pixels.thickness.byteLength;
      st.diskBytes += meshBytes + px;
      st.gpuBytes +=
        meshBytes - g.info.capsules.byteLength + Math.round((px * 4) / 3);
      st.variants++;
      let list = lib.variants.get(def.name);
      if (!list) lib.variants.set(def.name, (list = []));
      list[i] = v.loaded;
      v.loaded.slot = allPixels.length;
      allPixels.push(v.pixels);
      spheres.push(g.info.sphere);
      bounds.push(impostorBounds(v.pixels));
      report(++done / jobs.length);
    }
    if (allPixels.length) {
      const atlas = impostorArray(renderer, allPixels);
      lib.impostors = {
        atlas,
        material: impostorMaterial(atlas, spheres, bounds),
        farMaterial: impostorMaterial(atlas, spheres, bounds, true),
      };
    }
    // Shared bark / leaf textures (RGBA8 + mips).
    const textures = new Set<string>();
    for (const def of species) {
      textures.add(`bark:${def.bark.texture}`);
      textures.add(`leaf:${def.foliage.kind}`);
    }
    for (const t of textures)
      st.gpuBytes += Math.round(
        ((t.startsWith('bark') ? 64 * 128 : 256 * 128) * 4 * 4) / 3,
      );
    st.totalMs = performance.now() - t0;
    for (const def of species)
      void pruneCached(
        def.name,
        new Set(variantsOf(def).map((i) => cacheKey(def, variantSeed(def, i)))),
      );
    return lib;
  }

  private build(
    def: SpeciesDef,
    info: TreeVariantInfo,
    meshes: VariantMeshes,
    cachedImpostor: ImpostorPixels | undefined,
    renderer: WebGLRenderer,
  ): { loaded: LoadedVariant; pixels: ImpostorPixels } {
    registerVariant(info);
    const levels = meshes.levels.map(geometry);
    const sprites = spriteGeometry(meshes.sprites);
    const quads = quadSprites(meshes.sprites);
    for (const g of [sprites, quads.geometry]) crownAttributes(g, info.crown);
    const tex = spriteTextures(def.foliage.kind, def.foliage.density);
    const pixels =
      cachedImpostor ??
      bakeImpostor(
        renderer,
        [
          { geometry: levels[0], map: barkTexture(def.bark.texture) },
          { geometry: sprites, map: tex.albedo, normalMap: tex.normal },
        ],
        info.sphere,
      );
    // Materials are shared per bark / foliage kind; created here so they exist before the first frame.
    barkMaterial(def.bark.texture);
    spriteMaterial(def.foliage.kind, def.foliage.density);
    return {
      loaded: {
        info,
        def,
        levels,
        sprites,
        spriteCount: meshes.sprites.count,
        spriteEnds: meshes.sprites.ends,
        quads: quads.geometry,
        quadEnds: quads.ends,
        proxy: crownProxy(meshes.sprites),
        slot: -1,
      },
      pixels,
    };
  }

  get species(): string[] {
    return [...this.variants.keys()];
  }

  variant(species: string, index: number): LoadedVariant | undefined {
    return this.variants.get(species)?.[index];
  }

  all(): LoadedVariant[] {
    return [...this.variants.values()].flat();
  }

  dispose(): void {
    for (const v of this.all())
      for (const g of [...v.levels, v.sprites]) g.dispose();
    this.impostors?.atlas.dispose();
    this.impostors?.material.dispose();
    this.variants.clear();
  }
}
