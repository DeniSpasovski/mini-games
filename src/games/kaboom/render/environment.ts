import {
  EquirectangularReflectionMapping,
  PMREMGenerator,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { LevelId } from '../game/levels';

/**
 * Each level's environment light (High quality only): a 128 x 64 Poly Haven HDRI with the sun clipped out
 * (`scripts/kaboom/bake-hdri.py`), prefiltered once per page. Sources and credits: THIRD-PARTY.md.
 */
const URLS: Record<LevelId, string> = {
  quarry: new URL('../assets/hdri/quarry.hdr', import.meta.url).href,
  valley: new URL('../assets/hdri/valley.hdr', import.meta.url).href,
  sea: new URL('../assets/hdri/sea.hdr', import.meta.url).href,
};

const cache = new Map<LevelId, Promise<Texture | null>>();

/** The prefiltered environment map of `level` (null when it cannot load: the hemisphere fill still lights the scene). */
export function levelEnvironment(
  renderer: WebGLRenderer,
  level: LevelId,
): Promise<Texture | null> {
  let p = cache.get(level);
  if (!p) {
    p = new HDRLoader()
      .loadAsync(URLS[level])
      .then((hdr) => {
        hdr.mapping = EquirectangularReflectionMapping;
        const pmrem = new PMREMGenerator(renderer);
        const env = pmrem.fromEquirectangular(hdr).texture;
        pmrem.dispose();
        hdr.dispose();
        return env;
      })
      .catch(() => null);
    cache.set(level, p);
  }
  return p;
}
