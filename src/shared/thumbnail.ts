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

export async function saveThumbnail(
  gameId: string,
  source: HTMLCanvasElement,
): Promise<string> {
  // Downscale to 16:9 640px wide to keep the portal light.
  const w = 640;
  const h = 360;
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
  const data = c.toDataURL('image/jpeg', 0.85);
  const r = await fetch(`/__dev/thumbnail?game=${encodeURIComponent(gameId)}`, {
    method: 'POST',
    body: data,
  });
  return r.text();
}
