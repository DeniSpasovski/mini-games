import type { Texture, WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * GPU-compressed textures (`.ktx2`, Basis Universal, drawn by `scripts/textures/bake-ktx2.mjs`): they stay
 * compressed in video memory and need no image decode at load. The transcoder (three's `libs/basis`) is copied
 * next to the game pages as `basis/` (rsbuild.config.ts). Without a renderer, or when a file is missing,
 * `loadKtx2` rejects and the caller falls back to its webp.
 */
let loader: KTX2Loader | undefined;

/** Called once by createRenderer: the loader picks the compressed format this GPU supports. */
export function initKtx2(renderer: WebGLRenderer): void {
  if (loader) return;
  loader = new KTX2Loader().setTranscoderPath('./basis/');
  loader.detectSupport(renderer);
}

export function loadKtx2(url: string): Promise<Texture> {
  if (!loader) return Promise.reject(new Error('ktx2: no renderer'));
  return loader.loadAsync(url);
}
