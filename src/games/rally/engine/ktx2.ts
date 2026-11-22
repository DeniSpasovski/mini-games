import {
  LinearFilter,
  LinearMipmapLinearFilter,
  type CompressedTexture,
  type Texture,
  type WebGLRenderer,
} from 'three';
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

/**
 * The single textures baked next to their webp (scripts/textures/bake-ktx2.mjs `FILES`): the .ktx2 URL for a webp's
 * URL, both as the build emits them, so `imageTexture` and the ground arrays can take the compressed copy of the very
 * file they were given.
 */
const ktx2Urls = new Map<string, string>();
// Resolved by the bundler at build time (rspack also builds the tests), so the call is never guarded.
const files = import.meta.webpackContext('..', {
  recursive: true,
  regExp:
    /^\.\/(engine\/(ground|props|particles|facades)|trees\/bark)\/[^/]+\.(webp|ktx2)$/,
});
const fileUrl = (key: string): string => {
  const m = files(key) as string | { default: string };
  return typeof m === 'string' ? m : m.default;
};
const keys = new Set(files.keys());
for (const key of keys)
  if (key.endsWith('.webp')) {
    const k = key.replace(/\.webp$/, '.ktx2');
    if (keys.has(k)) ktx2Urls.set(fileUrl(key), fileUrl(k));
  }

/** The compressed copy of a webp, or undefined (none baked, or `?ktx2=0`). */
export function ktx2For(webpUrl: string): string | undefined {
  return ktx2Off ? undefined : ktx2Urls.get(webpUrl);
}

/**
 * Gives `target` (the texture object the materials already hold) a loaded compressed texture's data: format, mip levels
 * and colour space, no flip, no generated mips. Its wrapping, anisotropy and name stay. The format change gives it a
 * new GPU texture on its next upload.
 */
export function adoptCompressed(target: Texture, src: Texture): void {
  const c = src as CompressedTexture;
  const t = target as Texture & {
    isCompressedTexture?: boolean;
    mipmaps: CompressedTexture['mipmaps'];
  };
  t.isCompressedTexture = true;
  t.mipmaps = c.mipmaps;
  t.image = { width: c.image.width, height: c.image.height };
  t.format = c.format;
  t.type = c.type;
  t.colorSpace = c.colorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = c.mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
  t.needsUpdate = true;
}

/**
 * Same-size compressed layers (one .ktx2 each) as one compressed array: each level's data is the layers' data of that
 * level in a row, the layout `CompressedArrayTexture` uploads.
 */
export async function adoptCompressedArray(
  target: Texture,
  urls: string[],
): Promise<void> {
  const layers = (await Promise.all(urls.map(loadKtx2))) as CompressedTexture[];
  const first = layers[0];
  for (const l of layers)
    if (
      l.format !== first.format ||
      l.mipmaps.length !== first.mipmaps.length ||
      l.image.width !== first.image.width ||
      l.image.height !== first.image.height
    )
      throw new Error('ktx2: array layers differ in size or format');
  const mipmaps = first.mipmaps.map((m, level) => {
    const size = m.data.byteLength;
    const data = new Uint8Array(size * layers.length);
    layers.forEach((l, i) =>
      data.set(
        new Uint8Array(
          l.mipmaps[level].data.buffer,
          l.mipmaps[level].data.byteOffset,
          size,
        ),
        i * size,
      ),
    );
    return { data, width: m.width, height: m.height };
  });
  const t = target as Texture & {
    isCompressedTexture?: boolean;
    isCompressedArrayTexture?: boolean;
    mipmaps: unknown[];
  };
  t.isCompressedTexture = true;
  t.isCompressedArrayTexture = true;
  t.mipmaps = mipmaps;
  t.image = {
    width: first.image.width,
    height: first.image.height,
    depth: layers.length,
  };
  t.format = first.format;
  t.type = first.type;
  t.colorSpace = first.colorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  for (const l of layers) l.dispose();
}
