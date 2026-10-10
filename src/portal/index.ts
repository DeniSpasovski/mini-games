import './portal.css';
import { SITE } from '../site.config';
import {
  activateFocused,
  attachKeyNav,
  ensureFocus,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
  watchMenuTick,
} from '../shared/pad-nav';
import { MenuTick } from '../shared/menu-tick';
import { consentEnabled, openConsentBanner } from '../shared/consent';
import { isReleased, RELEASE_BUILD } from '../shared/release';
import { resolveGamePage, type GameManifest } from './manifest';
import { GAME_LIST } from './release';

/**
 * The portal is intentionally tiny: it lists every src/games/<id>/game.json
 * with its thumbnail and links. Games are discovered at build time, so a new
 * game folder shows up here without touching this file.
 */

const manifestCtx = import.meta.webpackContext('../games', {
  recursive: true,
  regExp: /[\\/]game\.json$/,
});
const thumbCtx = import.meta.webpackContext('../games', {
  recursive: true,
  regExp: /[\\/]thumbnail\.(jpg|png)$/,
});

/** Card order = `GAME_LIST` (release.ts); a game missing from it comes last, alphabetically. */
function orderRank(id: string): number {
  const i = GAME_LIST.findIndex((g) => g.id === id);
  return i === -1 ? GAME_LIST.length : i;
}

interface GameEntry {
  manifest: GameManifest;
  thumbnail?: string;
}

function loadGames(): GameEntry[] {
  const thumbs = new Map<string, string>();
  for (const key of thumbCtx.keys()) {
    const id = key.split('/')[1];
    const mod = thumbCtx(key) as string | { default: string };
    thumbs.set(id, typeof mod === 'string' ? mod : mod.default);
  }
  return manifestCtx
    .keys()
    .filter((k) => k.split('/').length === 3) // ./<id>/game.json only
    .map((k) => {
      const manifest = manifestCtx(k) as GameManifest;
      return { manifest, thumbnail: thumbs.get(manifest.id) };
    })
    .filter(
      ({ manifest }) => !RELEASE_BUILD || isReleased(GAME_LIST, manifest.id),
    )
    .sort(
      (a, b) =>
        orderRank(a.manifest.id) - orderRank(b.manifest.id) ||
        a.manifest.title.localeCompare(b.manifest.title),
    );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderCard({ manifest, thumbnail }: GameEntry): string {
  const pages = manifest.pages.map((p) => resolveGamePage(manifest.id, p));
  const play = pages.find((p) => p.id === 'play') ?? pages[0];
  const tools = pages.filter((p) => p.dev && !(p.hideInProd && RELEASE_BUILD));
  const tags = (manifest.tags ?? [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  const shot = thumbnail
    ? `<img src="${thumbnail}" alt="${escapeHtml(manifest.title)} screenshot" loading="lazy" />`
    : `<div class="no-shot">${escapeHtml(manifest.title)}</div>`;
  return `
    <article class="card">
      <a class="shot" href="${play.href}" tabindex="-1" aria-hidden="true">${shot}</a>
      <div class="body">
        <h2><a href="${play.href}">${escapeHtml(manifest.title)}</a></h2>
        <p>${escapeHtml(manifest.description)}</p>
        <div class="tags">${tags}</div>
        <div class="links">
          <a class="btn primary" href="${play.href}">${escapeHtml(play.label)}</a>
          ${tools.map((t) => `<a class="btn" href="${t.href}">${escapeHtml(t.label)}</a>`).join('')}
        </div>
      </div>
    </article>`;
}

const root = document.querySelector('#root');
if (root) {
  const games = loadGames();
  root.innerHTML = `
    <header class="portal-header">
      <h1><img class="portal-logo" src="icons/icon-192.png" alt="" width="40" height="40" />Mini Game Portal</h1>
      <span>${games.length} game${games.length === 1 ? '' : 's'}</span>
    </header>
    <main class="grid">${games.map(renderCard).join('')}</main>
    <footer class="portal-footer">
      <p>${escapeHtml(SITE.tagline)}</p>
      <p>© ${new Date().getFullYear()} ${escapeHtml(SITE.owner)}${
        consentEnabled()
          ? ' · <button type="button" class="link-btn" data-privacy>Privacy &amp; cookies</button>'
          : ''
      }</p>
    </footer>`;
  root
    .querySelector('[data-privacy]')
    ?.addEventListener('click', openConsentBanner);

  // Keyboard (arrows), controller (d-pad / stick, A) and hover: same navigation + tick as the games' menus.
  const page = root as HTMLElement;
  const tick = new MenuTick(660, 'sine');
  watchMenuTick(page, () => tick.play());
  const nav = (a: NavAction) => {
    if (a === 'confirm') activateFocused(page);
    else if (a === 'up' || a === 'down' || a === 'left' || a === 'right')
      moveFocus(page, a);
    if (a === 'start') ensureFocus(page);
  };
  attachKeyNav(() => true, nav);
  new GamepadMenuNav(nav, () => document.scrollingElement as HTMLElement);
}
