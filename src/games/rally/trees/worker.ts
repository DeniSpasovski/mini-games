import { meshBuffers } from './mesh';
import { getSpecies } from './species';
import { generateVariant } from './variants';

/** Generator worker: grammar -> skeleton -> meshing of one variant, off the main thread (trees/load.ts). */

export interface GenerateRequest {
  id: number;
  species: string;
  index: number;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
  const { id, species, index } = e.data;
  const t0 = performance.now();
  const g = generateVariant(getSpecies(species), index);
  scope.postMessage({ id, ...g, ms: performance.now() - t0 }, [
    ...meshBuffers(g.meshes),
    g.info.capsules.buffer as ArrayBuffer,
  ]);
};
