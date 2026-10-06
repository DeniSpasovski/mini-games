/**
 * Mobile web guards: no pinch / double-tap zoom, no rubber-band scroll, no
 * long-press callouts. Pairs with the viewport meta (rsbuild.config.ts) and
 * the touch-action / user-select rules in hole.css.
 */
export function installMobileGuards(): void {
  const stop = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(type, stop);
  document.addEventListener('dblclick', stop);
  document.addEventListener('contextmenu', stop);
  // block page scroll / rubber banding, but let menu lists and cards taller
  // than the screen (overflow-y: auto in hole.css) scroll
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!(e.target as HTMLElement | null)?.closest('.hg-scroll, .hg-card'))
        e.preventDefault();
    },
    { passive: false },
  );
}

/** Run `fn` when the page goes to the background (pause on app switch). */
export function onBackground(fn: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) fn();
  });
  window.addEventListener('pagehide', fn);
}
