/**
 * Registers the service worker (public/sw.js, built to the portal root) so visited games keep working offline.
 * Production build only; every page registers it (games live in `games/<id>/`, two folders below the worker).
 */
export function registerOffline(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;
  if (process.env.NODE_ENV !== 'production') {
    unregisterInDev();
    return;
  }
  const inGame = /\/games\/[^/]+\//.test(location.pathname);
  const url = new URL(inGame ? '../../sw.js' : 'sw.js', location.href);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(url.href).catch(() => {
      // A game hosted on its own has no worker one level up: no offline mode, no error.
    });
  });
}

/**
 * Dev server: drop a worker a production preview left on the same origin (`npm run preview` also serves
 * localhost:3000). It would serve stale cached copies of the unhashed dev bundles: black pages until a refresh,
 * map chunks that never load.
 */
function unregisterInDev(): void {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window)
      await caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    // This page may already be running stale code from the worker: load it once more from the dev server.
    if (navigator.serviceWorker.controller) location.reload();
  });
}
