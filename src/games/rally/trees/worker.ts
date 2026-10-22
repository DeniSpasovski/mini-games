import { meshBuffers } from './mesh';
import type { Season } from '../season';
import { seasonal } from './seasons';
import { getSpecies } from './species';
import { generateVariant } from './variants';
import { spriteAtlas, type LeafStyle, type SpriteAtlas } from './leaftex';
import { coverageMips, type MipLevel } from './materials';

/** Generator worker: grammar -> skeleton -> meshing of one variant, off the main thread (trees/load.ts). */

export interface GenerateRequest {
  id: number;
  species: string;
  index: number;
  season: Season;
}

/** The atlas of a leaf style and its mip chains (trees/materials.ts `spriteTextures`): pure pixel work, done here. */
export interface AtlasRequest {
  id: number;
  atlas: LeafStyle;
}

export interface AtlasResult {
  id: number;
  atlas: SpriteAtlas;
  mips: { main: MipLevel[]; companion: MipLevel[] };
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest | AtlasRequest>) => void) | null;
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
  if ('atlas' in e.data) {
    const { id, atlas: style } = e.data;
    try {
      const atlas = spriteAtlas(style);
      const mips = coverageMips(
        atlas.albedo,
        atlas.width,
        atlas.height,
        false,
        atlas.normal,
      );
      const buffers = new Set<ArrayBuffer>([
        atlas.albedo.buffer as ArrayBuffer,
        atlas.normal.buffer as ArrayBuffer,
      ]);
      for (const l of [...mips.main, ...mips.companion])
        buffers.add(l.data.buffer as ArrayBuffer);
      scope.postMessage({ id, atlas, mips } satisfies AtlasResult, [
        ...buffers,
      ]);
    } catch (err) {
      scope.postMessage({ id, error: String(err) }, []);
    }
    return;
  }
  const { id, species, index, season } = e.data;
  try {
    const t0 = performance.now();
    const g = generateVariant(seasonal(getSpecies(species), season), index);
    scope.postMessage({ id, ...g, ms: performance.now() - t0 }, [
      ...meshBuffers(g.meshes),
      g.info.capsules.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    // The main thread retries inline (trees/load.ts `Generator`), where the error surfaces.
    scope.postMessage({ id, error: String(err) }, []);
  }
};
