/**
 * "All games" link for game menus.
 *
 * Games are served at `<portal>/games/<id>/` (or `<page>.html` next to it), so
 * when the page path ends that way the portal is two folders up. In PWA
 * standalone mode there is no browser back button / address bar, so menus show
 * a button back to the portal. A game hosted on its own (not inside
 * `games/<id>/`) gets `null` and shows no button.
 */
export function portalUrl(href: string = location.href): string | null {
  const url = new URL(href);
  if (!/\/games\/[^/]+\/[^/]*$/.test(url.pathname)) return null;
  return new URL('../../', url).href;
}

/** Navigate to the portal (no-op when the game is not inside the portal). */
export function goToPortal(href?: string): void {
  const url = portalUrl(href);
  if (url) location.href = url;
}
