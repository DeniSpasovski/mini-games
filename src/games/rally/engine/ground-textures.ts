import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { imageTexture } from './image-texture';
import grassSpringUrl from './ground/grass_spring.webp';
import grassSummerUrl from './ground/grass_summer.webp';
import grassAutumnUrl from './ground/grass_autumn.webp';
import soilUrl from './ground/soil.webp';
import gravelUrl from './ground/gravel.webp';
import rockUrl from './ground/rock.webp';
import litterUrl from './ground/litter.webp';
import leavesUrl from './ground/leaves.webp';
import stubbleUrl from './ground/stubble.webp';

/**
 * Terrain scans (Poly Haven, CC0): one texture array, a layer per ground material, read by the terrain material
 * (world/terrain-material.ts). Each tile is a whole scan; `GROUND_SCAN` is its size on the ground in metres, so the
 * shader maps world metres / scan size straight to the texture coordinate.
 */
export const GROUND_LAYER = {
  grassSpring: 0,
  grassSummer: 1,
  grassAutumn: 2,
  soil: 3,
  gravel: 4,
  rock: 5,
  litter: 6,
  leaves: 7,
  stubble: 8,
} as const;
export type GroundLayer = keyof typeof GROUND_LAYER;

/** Size of each scan on the ground (m), in layer order (the GLSL `GS_*` constants in terrain-material.ts). */
export const GROUND_SCAN: Record<GroundLayer, number> = {
  grassSpring: 2.0,
  grassSummer: 2.51,
  grassAutumn: 2.0,
  soil: 1.3,
  gravel: 2.0,
  rock: 1.8,
  litter: 1.5,
  leaves: 1.26,
  stubble: 2.0,
};

/** Mean linear luminance of each tile (scripts/ground/bake.py prints it): the terrain shader's brightness reference. */
export const GROUND_MEAN: Record<GroundLayer, number> = {
  grassSpring: 0.077,
  grassSummer: 0.077,
  grassAutumn: 0.077,
  soil: 0.127,
  gravel: 0.145,
  rock: 0.22,
  litter: 0.144,
  leaves: 0.128,
  stubble: 0.09,
};

const URLS = [
  grassSpringUrl,
  grassSummerUrl,
  grassAutumnUrl,
  soilUrl,
  gravelUrl,
  rockUrl,
  litterUrl,
  leavesUrl,
  stubbleUrl,
];
const SIZE = 512;

let array: DataArrayTexture | undefined;
/** The array; layers fill in as their images decode (mid grey until then, and in headless tests). */
export function groundArray(): DataArrayTexture {
  if (array) return array;
  const data = new Uint8Array(SIZE * SIZE * 4 * URLS.length).fill(110);
  const tex = new DataArrayTexture(data, SIZE, SIZE, URLS.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  array = tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof Image === 'undefined') return tex;
  // One upload once every layer has decoded.
  Promise.all(
    URLS.map((url) => {
      const img = new Image();
      img.src = url;
      return img.decode().then(() => img);
    }),
  ).then(
    (imgs) => {
      const row = SIZE * 4;
      imgs.forEach((img, layer) => {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
        // Array layers are not flipped like canvas textures: v = 0 is the first row.
        for (let y = 0; y < SIZE; y++)
          data.set(
            px.subarray((SIZE - 1 - y) * row, (SIZE - y) * row),
            (layer * SIZE + y) * row,
          );
      });
      tex.needsUpdate = true;
    },
    () => undefined,
  );
  return tex;
}

const scans = new Map<GroundLayer, Texture>();
/** One scan as a plain repeating texture, for meshes that wear a ground material (the rocks). */
export function groundScan(id: GroundLayer): Texture {
  let tex = scans.get(id);
  if (!tex) {
    tex = imageTexture(URLS[GROUND_LAYER[id]], SIZE, SIZE, `ground:${id}`);
    scans.set(id, tex);
  }
  return tex;
}
