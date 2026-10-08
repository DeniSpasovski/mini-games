/**
 * Registers the service worker (public/sw.js, built to the portal root) so visited games keep working offline.
 * Production build only; every page registers it (games live in `games/<id>/`, two folders below the worker).
 */
export function registerOffline(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;
  if (process.env.NODE_ENV !== 'production') return;
  const inGame = /\/games\/[^/]+\//.test(location.pathname);
  const url = new URL(inGame ? '../../sw.js' : 'sw.js', location.href);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(url.href).catch(() => {
      // A game hosted on its own has no worker one level up: no offline mode, no error.
    });
  });
}
