import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGFormat,
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
import needlesUrl from './ground/needles.webp';
import grassSpringN from './ground/grass_spring_n.webp';
import grassSummerN from './ground/grass_summer_n.webp';
import grassAutumnN from './ground/grass_autumn_n.webp';
import soilN from './ground/soil_n.webp';
import gravelN from './ground/gravel_n.webp';
import rockN from './ground/rock_n.webp';
import litterN from './ground/litter_n.webp';
import leavesN from './ground/leaves_n.webp';
import stubbleN from './ground/stubble_n.webp';
import needlesN from './ground/needles_n.webp';

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
  needles: 9,
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
  needles: 2.0,
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
  needles: 0.105,
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
  needlesUrl,
];
/** The scans' own normal maps (OpenGL: green up the image), same layers: the relief of the near terrain. */
const NORMAL_URLS = [
  grassSpringN,
  grassSummerN,
  grassAutumnN,
  soilN,
  gravelN,
  rockN,
  litterN,
  leavesN,
  stubbleN,
  needlesN,
];
const SIZE = 512;

let array: DataArrayTexture | undefined;
let normals: DataArrayTexture | undefined;
/** The array; layers fill in as their images decode (mid grey until then, and in headless tests). */
export function groundArray(): DataArrayTexture {
  return (array ??= loadArray(URLS, 110, SRGBColorSpace));
}

/**
 * The scans' normals (flat until they decode): x and y only (RG8, half the colour array's fetch; the terrain shader
 * rebuilds z), 4x anisotropic (their relief fades out within the detail distance anyway).
 */
export function groundNormalArray(): DataArrayTexture {
  return (normals ??= loadArray(NORMAL_URLS, 128, NoColorSpace, 2, 4));
}

function loadArray(
  urls: string[],
  fill: number,
  colorSpace: string,
  channels: 2 | 4 = 4,
  anisotropy = 8,
): DataArrayTexture {
  const data = new Uint8Array(SIZE * SIZE * channels * urls.length).fill(fill);
  const tex = new DataArrayTexture(data, SIZE, SIZE, urls.length);
  if (channels === 2) tex.format = RGFormat;
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof Image === 'undefined') return tex;
  // One upload once every layer has decoded.
  Promise.all(
    urls.map((url) => {
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
        for (let y = 0; y < SIZE; y++) {
          const src = (SIZE - 1 - y) * row;
          if (channels === 4)
            data.set(px.subarray(src, src + row), (layer * SIZE + y) * row);
          else
            for (let x = 0, d = (layer * SIZE + y) * SIZE * 2; x < SIZE; x++) {
              data[d + x * 2] = px[src + x * 4];
              data[d + x * 2 + 1] = px[src + x * 4 + 1];
            }
        }
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
