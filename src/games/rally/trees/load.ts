import {
  BufferAttribute,
  BufferGeometry,
  type DataArrayTexture,
  type MeshLambertMaterial,
  type WebGLRenderer,
} from 'three';
import { DEFAULT_SEASON, type Season } from '../season';
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
  primeSpriteTextures,
  spriteMaterial,
  spriteTextures,
} from './materials';
import type { Crown, MeshData, SpriteData, VariantMeshes } from './mesh';
import { allSeasons, seasonal, seasonOf } from './seasons';
import { isTreeType, speciesOfType, type SpeciesDef } from './species';
import { headingAt, packSprite } from './sprite-attr';
import {
  cacheKey,
  generateVariant,
  registerVariant,
  variantSeed,
  variantsOf,
  type GeneratedVariant,
  type TreeVariantInfo,
} from './variants';
import type { AtlasRequest, AtlasResult, GenerateRequest } from './worker';
import { WorkerPool } from '../../../shared/worker-pool';
import type { LeafStyle } from './leaftex';
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
  /** The crown's mean albedo as drawn (linear, from its impostor's views): world/far-forest.ts paints the canopy with it. */
  canopyColor: [number, number, number];
}

/** Coverage-weighted mean of an impostor's albedo over all its views, sRGB decoded (linear). */
function meanAlbedo(px: ImpostorPixels): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const a = px.albedo;
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  // Every 3rd texel: plenty for a mean.
  for (let i = 0; i < a.length; i += 12) {
    const cover = a[i + 3] / 255;
    if (cover < 0.5) continue;
    r += lin(a[i]) * cover;
    g += lin(a[i + 1]) * cover;
    b += lin(a[i + 2]) * cover;
    w += cover;
  }
  return w > 0 ? [r / w, g / w, b / w] : [0.05, 0.08, 0.03];
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
  const packed = new Float32Array(s.sprite.length);
  for (let v = 0; v < packed.length / 4; v++)
    packSprite(
      s.sprite[v * 4],
      s.sprite[v * 4 + 1],
      s.sprite[v * 4 + 2],
      headingAt(s.heading, v),
      packed,
      v * 4,
    );
  g.setAttribute('treeSprite', new BufferAttribute(packed, 4));
  g.setAttribute('treeRank', new BufferAttribute(s.rank, 1));
  g.setIndex(new BufferAttribute(s.index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Generates variants in workers (or inline where there are none): a failed worker is dropped and its pending variants
 * are generated inline, so the stage load never hangs (shared/worker-pool.ts). The leaf atlases of the styles in use
 * are made in the workers too.
 */
type TreeAnswer = (Timed & { id: number }) | AtlasResult;

class Generator {
  private pool = new WorkerPool<TreeAnswer>(
    () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    undefined,
    'trees',
  );

  /** A variant and the ms its derivation + meshing took. */
  generate(def: SpeciesDef, index: number): Promise<Timed> {
    return new Promise((resolve, reject) => {
      const inline = () => {
        try {
          const t0 = performance.now();
          const g = generateVariant(def, index);
          resolve({ ...g, ms: performance.now() - t0 });
        } catch (e) {
          reject(e);
        }
      };
      const req: Omit<GenerateRequest, 'id'> = {
        species: def.name,
        index,
        season: seasonOf(def),
      };
      const sent = this.pool.post(req, [], (r) =>
        r ? resolve(r as Timed) : inline(),
      );
      if (!sent) inline();
    });
  }

  /** Makes the atlas + mips of every style in a worker and primes `spriteTextures` with them. */
  atlases(styles: LeafStyle[]): Promise<void> {
    return Promise.all(
      styles.map(
        (style) =>
          new Promise<void>((resolve) => {
            const req: Omit<AtlasRequest, 'id'> = { atlas: style };
            const sent = this.pool.post(req, [], (r) => {
              // Without the worker `spriteTextures` makes them itself.
              if (r && 'atlas' in r)
                primeSpriteTextures(style, r.atlas, r.mips);
              resolve();
            });
            if (!sent) resolve();
          }),
      ),
    ).then(() => undefined);
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

  /** Species of every tree type in `assets` (map rules / fixed instances), in the leaf colours of `season`. */
  static speciesOf(
    assets: Iterable<string>,
    season: Season = DEFAULT_SEASON,
  ): SpeciesDef[] {
    const out = new Set<SpeciesDef>();
    for (const a of assets)
      if (isTreeType(a)) out.add(seasonal(speciesOfType(a), season));
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
    // The leaf atlases are made beside the variants (the pool's workers take them first).
    const atlases = gen.atlases([
      ...new Set(species.map((def) => def.foliage.leaf)),
    ]);
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
    await atlases;
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
    // The other seasons' variants stay cached.
    for (const def of species)
      void pruneCached(
        def.name,
        new Set(
          allSeasons(def).flatMap((d) =>
            variantsOf(d).map((i) => cacheKey(d, variantSeed(d, i))),
          ),
        ),
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
    const tex = spriteTextures(def.foliage.leaf);
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
    spriteMaterial(def.foliage.leaf);
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
        canopyColor: meanAlbedo(pixels),
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
