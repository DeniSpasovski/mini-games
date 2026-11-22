import type { Texture, WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * GPU-compressed textures (`.ktx2`, Basis Universal, drawn by `scripts/textures/bake-ktx2.mjs`): they stay
 * compressed in video memory and need no image decode at load. The transcoder (three's `libs/basis`) is copied
 * next to the game pages as `basis/` (rsbuild.config.ts). When a file is missing `loadKtx2` rejects and the
 * caller falls back to its webp.
 */
let loader: KTX2Loader | undefined;

/** Called by createRenderer: the loader picks the compressed format this GPU supports. */
export function initKtx2(renderer: WebGLRenderer): void {
  if (loader) return;
  loader = new KTX2Loader().setTranscoderPath('./basis/');
  loader.detectSupport(renderer);
}

/**
 * Textures can load before the game's renderer exists (the play page preloads the road behind the loading
 * overlay): ask a throwaway WebGL 2 context which formats this GPU takes, the same check detectSupport makes.
 */
function probeLoader(): KTX2Loader {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('ktx2: no WebGL 2');
  const probe = {
    extensions: {
      has: (name: string) => gl.getExtension(name) !== null,
      get: (name: string) => gl.getExtension(name),
    },
  } as unknown as WebGLRenderer;
  const l = new KTX2Loader().setTranscoderPath('./basis/');
  l.detectSupport(probe);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return l;
}

/** `?ktx2=0`: skip the compressed files (compare against the webp sets). */
export const ktx2Off =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('ktx2') === '0';

export function loadKtx2(url: string): Promise<Texture> {
  try {
    loader ??= probeLoader();
  } catch (e) {
    return Promise.reject(e);
  }
  return loader.loadAsync(url);
}
