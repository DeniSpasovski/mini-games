import { RepeatWrapping, SRGBColorSpace, Texture } from 'three';

/**
 * A repeating colour texture from an image file: mid grey at the image's size until it decodes (the image then fills
 * the same, immutable GPU texture, so `w` x `h` must be the file's size).
 */
export function imageTexture(
  url: string,
  w: number,
  h: number,
  name: string,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(0, 0, w, h);
  }
  const tex: Texture = new Texture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tex.name = name;
  tex.needsUpdate = true;
  if (typeof Image === 'undefined') return tex;
  const img = new Image();
  img.src = url;
  img.decode().then(
    () => {
      tex.image = img;
      tex.needsUpdate = true;
    },
    () => undefined,
  );
  return tex;
}
