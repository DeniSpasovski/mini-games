import './portal.css';
import { SITE } from '../site.config';
import {
  activateFocused,
  attachKeyNav,
  ensureFocus,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
} from '../shared/pad-nav';
import { MenuTick } from '../shared/menu-tick';
import { consentEnabled, openConsentBanner } from '../shared/consent';
import { isReleased, RELEASE_BUILD } from '../shared/release';
import { resolveGamePage, type GameManifest } from './manifest';
import { GAME_LIST } from './release';
import wordmark from './wordmark.svg';

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

const wordmarkCtx = import.meta.webpackContext('../games', {
  recursive: true,
  regExp: /[\\/]wordmark\.svg$/,
});

/** Card order = `GAME_LIST` (release.ts); a game missing from it comes last, alphabetically. */
function orderRank(id: string): number {
  const i = GAME_LIST.findIndex((g) => g.id === id);
  return i === -1 ? GAME_LIST.length : i;
}

interface GameEntry {
  manifest: GameManifest;
  thumbnail?: string;
  /** The game's title in its own face (wordmark.svg); the plain title when missing. */
  wordmark?: string;
}

const assetUrl = (mod: unknown) =>
  typeof mod === 'string' ? mod : (mod as { default: string }).default;

function loadGames(): GameEntry[] {
  const thumbs = new Map<string, string>();
  for (const key of thumbCtx.keys())
    thumbs.set(key.split('/')[1], assetUrl(thumbCtx(key)));
  const wordmarks = new Map<string, string>();
  for (const key of wordmarkCtx.keys())
    if (key.split('/').length === 3)
      wordmarks.set(key.split('/')[1], assetUrl(wordmarkCtx(key)));
  return manifestCtx
    .keys()
    .filter((k) => k.split('/').length === 3) // ./<id>/game.json only
    .map((k) => {
      const manifest = manifestCtx(k) as GameManifest;
      return {
        manifest,
        thumbnail: thumbs.get(manifest.id),
        wordmark: wordmarks.get(manifest.id),
      };
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

const PLAY_ICON =
  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>';

function renderCard({ manifest, thumbnail, wordmark }: GameEntry): string {
  const pages = manifest.pages.map((p) => resolveGamePage(manifest.id, p));
  const play = pages.find((p) => p.id === 'play') ?? pages[0];
  const tools = pages.filter((p) => p.dev && !(p.hideInProd && RELEASE_BUILD));
  const title = escapeHtml(manifest.title);
  const style =
    manifest.accent && manifest.onAccent
      ? ` style="--ga:${escapeHtml(manifest.accent)};--ga-on:${escapeHtml(manifest.onAccent)}"`
      : '';
  const shot = thumbnail
    ? `<img class="shot" src="${thumbnail}" alt="" loading="lazy" />`
    : `<div class="no-shot"></div>`;
  const heading = wordmark ? `<img src="${wordmark}" alt="${title}" />` : title;
  const label = [manifest.genre, manifest.inputs].filter(Boolean).join(' · ');
  const toolsId = `tools-${escapeHtml(manifest.id)}`;
  return `
    <article class="cover"${style}>
      <div class="cover-pic">${shot}<h2 class="cover-title">${heading}</h2></div>
      <div class="cover-body">
        <div class="cover-meta"><span>${escapeHtml(label)}</span><span>${manifest.version ? `v${escapeHtml(manifest.version)}` : ''}</span></div>
        <p>${escapeHtml(manifest.description)}</p>
        <div class="cover-actions">
          <a class="play" data-primary href="${play.href}" aria-label="${escapeHtml(play.label)} ${title}">${PLAY_ICON}${escapeHtml(play.label)}</a>
          ${
            tools.length
              ? `<button type="button" class="tools-toggle" aria-expanded="false" aria-controls="${toolsId}">Tools ▾</button>`
              : ''
          }
        </div>
        ${
          tools.length
            ? `<div class="tools-list" id="${toolsId}" hidden>${tools
                .map((t) => `<a href="${t.href}">${escapeHtml(t.label)}</a>`)
                .join('')}</div>`
            : ''
        }
      </div>
    </article>`;
}

const root = document.querySelector('#root');
if (root) {
  const games = loadGames();
  root.innerHTML = `
    <header class="portal-header">
      <div>
        <h1 class="portal-title"><span class="portal-bars" aria-hidden="true">${games
          .map(
            (g) =>
              `<s style="--bar:${escapeHtml(g.manifest.accent ?? '#f0a020')}"></s>`,
          )
          .join(
            '',
          )}</span><img class="portal-wordmark" src="${wordmark}" alt="Mini Games" /></h1>
        <p class="portal-intro">Browser games built with three.js. Free to play, no accounts, no ads.</p>
      </div>
    </header>
    <main class="shelf">${games.map(renderCard).join('')}</main>
    <footer class="portal-footer">
      <p>${escapeHtml(SITE.tagline)} · © ${new Date().getFullYear()} ${escapeHtml(SITE.owner)}</p>
      <p>PolyForm Noncommercial · map data © OpenStreetMap contributors (ODbL)${
        consentEnabled()
          ? ' · <button type="button" class="link-btn" data-privacy>Privacy &amp; cookies</button>'
          : ''
      }</p>
    </footer>`;
  root.querySelectorAll<HTMLButtonElement>('.tools-toggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const list = root.querySelector<HTMLElement>(
        `#${btn.getAttribute('aria-controls')}`,
      );
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Tools ▴' : 'Tools ▾';
      if (list) list.hidden = !open;
    }),
  );
  root
    .querySelector('[data-privacy]')
    ?.addEventListener('click', openConsentBanner);

  // Keyboard (arrows), controller (d-pad / stick, A): same navigation + tick as the games' menus. No tick on mouse hover.
  const page = root as HTMLElement;
  const tick = new MenuTick(660, 'sine');
  page.addEventListener('focusin', () => {
    if (document.documentElement.dataset.input === 'pad') tick.play();
  });
  const nav = (a: NavAction) => {
    if (a === 'confirm') activateFocused(page);
    else if (a === 'up' || a === 'down' || a === 'left' || a === 'right')
      moveFocus(page, a);
    if (a === 'start') ensureFocus(page);
  };
  attachKeyNav(() => true, nav);
  new GamepadMenuNav(nav, () => document.scrollingElement as HTMLElement);
}
