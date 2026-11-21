import { meshBuffers } from './mesh';
import type { Season } from '../season';
import { seasonal } from './seasons';
import { getSpecies, type SpeciesDef } from './species';
import { generateVariant } from './variants';
import { spriteAtlas, type LeafStyle, type SpriteAtlas } from './leaftex';
import { photoAtlas } from './leafphoto';
import { coverageMips, type MipLevel } from './materials';
import {
  getCached,
  putCached,
  type CachedAtlas,
  type CachedVariant,
} from './cache';
import { atlasCacheKey } from './variants';
import { impostorChains, type ImpostorPixels } from './impostor';

/** Generator worker: grammar -> skeleton -> meshing of one variant, off the main thread (trees/load.ts). */

export interface GenerateRequest {
  id: number;
  species: string;
  index: number;
  season: Season;
  /** The definition itself when it is not the registry's (a debugger override, a bare species). */
  def?: SpeciesDef;
}

/** The atlas of a leaf style and its mip chains (trees/materials.ts `spriteTextures`): pure pixel work, done here. */
export interface AtlasRequest {
  id: number;
  atlas: LeafStyle;
  /** A photo style's images (trees/leafphoto.ts `photoUrls`, resolved on the page). */
  urls?: [string, string];
}

export interface AtlasResult {
  id: number;
  atlas: SpriteAtlas;
  mips: { main: MipLevel[]; companion: MipLevel[] };
}

/** A cached variant read from the disk cache here, with its impostor's mip chains (the main thread does neither). */
export interface CachedRequest {
  id: number;
  key: string;
}

export interface CachedResult {
  id: number;
  hit: { variant: CachedVariant; chains: MipLevel[][] } | null;
}

/** A freshly baked impostor's mip chains (`impostorChains`), made here while the main thread bakes the next variant. */
export interface ChainsRequest {
  id: number;
  pixels: ImpostorPixels;
}
export interface ChainsResult {
  id: number;
  chains: MipLevel[][];
}
/** Start-up (trees/load.ts `warmTreeWorkers`): opens the disk cache; answers `{ id }`. */
export interface PingRequest {
  id: number;
  ping: true;
}
const scope = globalThis as unknown as {
  onmessage:
    | ((
        e: MessageEvent<
          | GenerateRequest
          | AtlasRequest
          | CachedRequest
          | ChainsRequest
          | PingRequest
        >,
      ) => void)
    | null;
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
};

async function readCached(id: number, key: string): Promise<void> {
  const variant = await getCached(key);
  if (!variant) {
    scope.postMessage({ id, hit: null } satisfies CachedResult, []);
    return;
  }
  const chains = impostorChains(variant.impostor);
  const px = variant.impostor;
  const buffers = new Set<ArrayBuffer>([
    ...meshBuffers(variant.meshes),
    variant.info.capsules.buffer as ArrayBuffer,
    px.albedo.buffer as ArrayBuffer,
    px.normal.buffer as ArrayBuffer,
    px.thickness.buffer as ArrayBuffer,
  ]);
  for (const c of chains)
    for (const l of c) buffers.add(l.data.buffer as ArrayBuffer);
  scope.postMessage({ id, hit: { variant, chains } } satisfies CachedResult, [
    ...buffers,
  ]);
}

/**
 * From the disk cache, else made here and stored (the same pixels: `GENERATOR_VERSION` and the photo's baked mean
 * cover the atlas code and images). A photo that does not decode falls back to the drawn atlas, not stored.
 */
async function sendAtlas(
  id: number,
  style: LeafStyle,
  urls: [string, string] | undefined,
): Promise<void> {
  const key = atlasCacheKey(style);
  let hit = await getCached<CachedAtlas>(key);
  if (!hit) {
    const photo = urls
      ? await photoAtlas(style, urls).catch((err: unknown) => {
          console.warn(`trees: leaf photo ${style}:`, err);
          return null;
        })
      : null;
    const atlas = photo ?? spriteAtlas(style);
    const mips = coverageMips(
      atlas.albedo,
      atlas.width,
      atlas.height,
      false,
      atlas.normal,
    );
    hit = { atlas, mips };
    // Stored before the transfer below detaches the pixels.
    if (photo || !urls) await putCached(key, hit);
  }
  const { atlas, mips } = hit;
  const buffers = new Set<ArrayBuffer>([
    atlas.albedo.buffer as ArrayBuffer,
    atlas.normal.buffer as ArrayBuffer,
  ]);
  for (const l of [...mips.main, ...mips.companion])
    buffers.add(l.data.buffer as ArrayBuffer);
  scope.postMessage({ id, atlas, mips } satisfies AtlasResult, [...buffers]);
}

scope.onmessage = (e) => {
  if ('ping' in e.data) {
    const { id } = e.data;
    void getCached('ping').finally(() => scope.postMessage({ id }, []));
    return;
  }
  if ('pixels' in e.data) {
    const { id, pixels } = e.data;
    try {
      const chains = impostorChains(pixels);
      const buffers = new Set<ArrayBuffer>();
      for (const c of chains)
        for (const l of c) buffers.add(l.data.buffer as ArrayBuffer);
      scope.postMessage({ id, chains } satisfies ChainsResult, [...buffers]);
    } catch (err) {
      scope.postMessage({ id, error: String(err) }, []);
    }
    return;
  }
  if ('key' in e.data) {
    const { id, key } = e.data;
    readCached(id, key).catch((err) =>
      scope.postMessage({ id, error: String(err) }, []),
    );
    return;
  }
  if ('atlas' in e.data) {
    const { id, atlas: style, urls } = e.data;
    sendAtlas(id, style, urls).catch((err) =>
      scope.postMessage({ id, error: String(err) }, []),
    );
    return;
  }
  const { id, species, index, season, def } = e.data;
  try {
    const t0 = performance.now();
    const g = generateVariant(
      def ?? seasonal(getSpecies(species), season),
      index,
    );
    scope.postMessage({ id, ...g, ms: performance.now() - t0 }, [
      ...meshBuffers(g.meshes),
      g.info.capsules.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    // The main thread retries inline (trees/load.ts `Generator`), where the error surfaces.
    scope.postMessage({ id, error: String(err) }, []);
  }
};
