import { isAllowedHost, isDevLanHost, SITE } from '../site.config';

/**
 * Runs before every page entry (rsbuild.config.ts -> source.preEntry).
 * If the site is served from a host that isn't in SITE.allowedHosts, the page
 * is replaced with a short notice and the page script stops here.
 *
 * Note: this is a deterrent against casual re-hosting, not DRM - anyone can
 * edit the built JS. Allowed hosts are configured in src/site.config.ts.
 */
if (
  typeof location !== 'undefined' &&
  location.protocol !== 'file:' &&
  !isAllowedHost(location.hostname) &&
  !(import.meta.env.DEV && isDevLanHost(location.hostname))
) {
  const msg = `This game is only available at <a href="${SITE.canonicalUrl}">${SITE.canonicalUrl.replace(/^https?:\/\//, '')}</a>.`;
  const render = () => {
    document.body.innerHTML = `<div style="font:16px system-ui,sans-serif;color:#ddd;background:#111;position:fixed;inset:0;display:grid;place-items:center;text-align:center;padding:16px">${msg}</div>`;
  };
  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);
  // Abort the rest of the bundle (the page entry never runs).
  throw new Error(`[host-guard] ${location.hostname} is not an allowed host`);
}

export {};
