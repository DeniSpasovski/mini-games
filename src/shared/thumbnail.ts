/**
 * Dev helper: save the current canvas as the game's portal thumbnail
 * (src/games/<id>/thumbnail.jpg) through the dev-server endpoint defined in
 * rsbuild.config.ts. Only active in `npm run dev`.
 *
 * The renderer must either use `preserveDrawingBuffer` or `render()` must be
 * called right before `capture()` in the same task (we do the latter).
 */
export function installThumbnailCapture(
  gameId: string,
  capture: () => HTMLCanvasElement,
  key = 'F9',
): void {
  if (!import.meta.env.DEV) return;
  window.addEventListener('keydown', async (e) => {
    if (e.code !== key) return;
    e.preventDefault();
    const res = await saveThumbnail(gameId, capture());
    console.info(`[thumbnail] ${res}`);
  });
}

/**
 * Saves `thumbnail.jpg` (1280x720) and `thumbnail-640.jpg` (640x360): the portal cover's srcset picks one by screen
 * width and pixel density. The centre of the canvas is cropped to 16:9.
 */
export async function saveThumbnail(
  gameId: string,
  source: HTMLCanvasElement,
): Promise<string> {
  // Both sizes before the first await: a WebGL canvas is cleared after this task.
  const files = [
    { query: '', data: thumbnailJpeg(source, 1280, 0.82) },
    { query: '&size=640', data: thumbnailJpeg(source, 640, 0.85) },
  ];
  const results: string[] = [];
  for (const f of files) {
    const r = await fetch(
      `/__dev/thumbnail?game=${encodeURIComponent(gameId)}${f.query}`,
      { method: 'POST', body: f.data },
    );
    results.push(await r.text());
  }
  return results.join(', ');
}

function thumbnailJpeg(
  source: HTMLCanvasElement,
  w: number,
  quality: number,
): string {
  const h = (w * 9) / 16;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const sa = source.width / source.height;
  const ta = w / h;
  let sw = source.width;
  let sh = source.height;
  if (sa > ta) sw = sh * ta;
  else sh = sw / ta;
  ctx.drawImage(
    source,
    (source.width - sw) / 2,
    (source.height - sh) / 2,
    sw,
    sh,
    0,
    0,
    w,
    h,
  );
  return c.toDataURL('image/jpeg', quality);
}

/**
 * Dev helper: save the canvas as `src/games/<id>/screenshots/<name>.jpg` (README screenshots, taken in game at the canvas
 * size, so render at 1280-1536 px wide first). Call it in the same task as the render (the WebGL canvas is cleared after).
 */
export async function saveScreenshot(
  gameId: string,
  name: string,
  source: HTMLCanvasElement,
): Promise<string> {
  const data = source.toDataURL('image/jpeg', 0.9);
  const r = await fetch(
    `/__dev/screenshot?game=${encodeURIComponent(gameId)}&name=${encodeURIComponent(name)}`,
    { method: 'POST', body: data },
  );
  return r.text();
}
