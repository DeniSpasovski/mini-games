import { RepeatWrapping, SRGBColorSpace, Texture } from 'three';

const decoded = new WeakMap<Texture, Promise<void>>();

/** Resolves once an `imageTexture` holds its image (or the image failed: it keeps the placeholder). */
export function imageReady(tex: Texture): Promise<void> {
  return decoded.get(tex) ?? Promise.resolve();
}

/**
 * A repeating colour texture from an image file: mid grey at the image's size until it decodes (the image then fills
 * the same, immutable GPU texture, so `w` x `h` must be the file's size). Anything that reads its pixels once (a bake)
 * awaits `imageReady` first.
 */
export function imageTexture(
  url: string,
  w: number,
  h: number,
  name: string,
  /** Placeholder colour; a normal map passes '#8080ff' (flat) and `srgb` false. */
  fill = '#6e6e6e',
  srgb = true,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  const tex: Texture = new Texture(canvas);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tex.name = name;
  tex.needsUpdate = true;
  if (typeof Image === 'undefined') return tex;
  const img = new Image();
  img.src = url;
  decoded.set(
    tex,
    img.decode().then(
      () => {
        tex.image = img;
        tex.needsUpdate = true;
      },
      () => undefined,
    ),
  );
  return tex;
}
