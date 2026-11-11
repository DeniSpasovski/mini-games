import lobedUrl from './leaves/lobed.webp';
import lobedNUrl from './leaves/lobed-n.webp';
import ovateUrl from './leaves/ovate.webp';
import ovateNUrl from './leaves/ovate-n.webp';
import palmateUrl from './leaves/palmate.webp';
import palmateNUrl from './leaves/palmate-n.webp';
import pineUrl from './leaves/pine.webp';
import pineNUrl from './leaves/pine-n.webp';
import roundUrl from './leaves/round.webp';
import roundNUrl from './leaves/round-n.webp';
import serrateUrl from './leaves/serrate.webp';
import serrateNUrl from './leaves/serrate-n.webp';
import smallUrl from './leaves/small.webp';
import smallNUrl from './leaves/small-n.webp';
import {
  atlasShape,
  leafPhoto,
  type LeafStyle,
  type SpriteAtlas,
} from './leaftex';

/**
 * Photo leaf atlases (spec: trees/Foliage.md#sprites): the images scripts/trees/bake-leaves.py cut from the CC BY pack
 * leaf textures, decoded off the main thread (trees/worker.ts) into the atlas layout trees/leaftex.ts draws. Meshing
 * never waits for them: the outlines and mean are baked (trees/leaf-photos.data.ts, `atlasShape`).
 *
 * `<style>.webp` = sRGB albedo + alpha; `<style>-n.webp` (half size) = normal x / y in R / G (x = image right, y = down
 * the rows, as the drawn atlas) and the thickness in B; z is rebuilt here.
 */

const URLS: Partial<Record<LeafStyle, [string, string]>> = {
  lobed: [lobedUrl, lobedNUrl],
  ovate: [ovateUrl, ovateNUrl],
  palmate: [palmateUrl, palmateNUrl],
  pine: [pineUrl, pineNUrl],
  round: [roundUrl, roundNUrl],
  serrate: [serrateUrl, serrateNUrl],
  small: [smallUrl, smallNUrl],
};

/** Absolute URLs of a photo style's two images (resolved on the page: a worker's base differs), or none. */
export function photoUrls(style: LeafStyle): [string, string] | undefined {
  const u = URLS[style];
  if (!u || !leafPhoto(style) || typeof location === 'undefined') return;
  return [new URL(u[0], location.href).href, new URL(u[1], location.href).href];
}

async function decode(url: string): Promise<ImageData> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * The canvas drops the colour of clear texels; an alpha-tested texel's bilinear edge reads them, so they take the mean
 * of their opaque neighbours (two rings), not black.
 */
function bleed(px: Uint8Array, w: number, h: number): void {
  const solid = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) solid[k] = px[k * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (solid[k]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += px[j * 4];
            g += px[j * 4 + 1];
            b += px[j * 4 + 2];
            n++;
          }
        if (!n) continue;
        px[k * 4] = Math.round(r / n);
        px[k * 4 + 1] = Math.round(g / n);
        px[k * 4 + 2] = Math.round(b / n);
        next[k] = 1;
      }
    solid.set(next);
  }
}

/** The atlas of a photo style from its images (`photoUrls`), or null when they cannot be decoded here. */
export async function photoAtlas(
  style: LeafStyle,
  urls: [string, string],
): Promise<SpriteAtlas | null> {
  if (
    typeof createImageBitmap === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  )
    return null;
  const shape = atlasShape(style);
  const [a, n] = await Promise.all(urls.map(decode));
  const W = shape.width;
  const H = shape.height;
  if (
    a.width !== W ||
    a.height !== H ||
    n.width * 2 !== W ||
    n.height * 2 !== H
  )
    throw new Error(`leaf photo ${style}: unexpected size`);
  const albedo = new Uint8Array(a.data.buffer.slice(0));
  bleed(albedo, W, H);
  // Normal + thickness at the albedo's size (each half-size texel 2 x 2: the material reads the normal map at half
  // size, so its mips rebuild the same texels).
  const normal = new Uint8Array(W * H * 4);
  const nw = n.width;
  const src = n.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = ((y >> 1) * nw + (x >> 1)) * 4;
      const nx = src[s] / 127.5 - 1;
      const ny = src[s + 1] / 127.5 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const o = (y * W + x) * 4;
      normal[o] = src[s];
      normal[o + 1] = src[s + 1];
      normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[o + 3] = src[s + 2];
    }
  return { ...shape, albedo, normal };
}
