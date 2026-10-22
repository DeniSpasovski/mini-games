import { drawTexture, textureSize, type TextureId } from './textures';

/** Texture worker: draws a texture on an OffscreenCanvas and hands back its bitmap (engine/texture-prefetch.ts). */

export interface TextureRequest {
  id: number;
  texture: TextureId;
}

export interface TextureResult {
  id: number;
  bitmap?: ImageBitmap;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<TextureRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, texture } = e.data;
  try {
    const [w, h] = textureSize(texture);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    drawTexture(texture, ctx as unknown as CanvasRenderingContext2D, w, h);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id, bitmap } satisfies TextureResult, [bitmap]);
  } catch (err) {
    // `getTexture` draws it on the page when it is first used.
    scope.postMessage({ id, error: String(err) } satisfies TextureResult, []);
  }
};
