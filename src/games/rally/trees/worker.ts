import { meshBuffers } from './mesh';
import type { Season } from '../season';
import { seasonal } from './seasons';
import { getSpecies } from './species';
import { generateVariant } from './variants';

/** Generator worker: grammar -> skeleton -> meshing of one variant, off the main thread (trees/load.ts). */

export interface GenerateRequest {
  id: number;
  species: string;
  index: number;
  season: Season;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
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
