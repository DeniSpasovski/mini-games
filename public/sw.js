/* Offline support: caches what a visitor loads (pages, js, models, icons) and serves it when the network is gone.
 * Nothing is precached, so a game works offline after it was opened once online (incl. its car models, which are
 * cached when first requested). Paths are relative to this file, so it works from the site root or a sub-folder. */
const CACHE = 'mini-games-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    // ?mute=1, ?seed= ... must not break the offline lookup.
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit ?? (await update) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  const isPage = request.mode === 'navigate' || url.pathname.endsWith('.html');
  event.respondWith(
    isPage ? networkFirst(request) : staleWhileRevalidate(request),
  );
});
