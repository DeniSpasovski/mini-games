import { SITE } from '../site.config';
import './consent.css';

/**
 * Cookie consent + Google Analytics (GA4).
 *
 * GA sets cookies (`_ga`, `_ga_<id>`), so under GDPR / ePrivacy it may only load
 * after the visitor says yes. `consent-boot.ts` (Rsbuild preEntry, every page)
 * calls `initConsent()`: no stored choice -> show the banner; "Accept" -> load
 * gtag.js; "Decline" -> nothing loads and the game keeps working (consent must
 * be freely given, so declining never blocks the site). The choice is kept in
 * localStorage for CONSENT_MAX_AGE_MS, then the banner asks again.
 * The portal footer "Privacy & cookies" link calls `openConsentBanner()`.
 */

export const CONSENT_KEY = 'mgp.consent.v1';
/** Ask again after ~12 months. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 3600 * 1000;

export type ConsentChoice = 'granted' | 'denied';
interface StoredConsent {
  analytics: ConsentChoice;
  at: number;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function readConsent(now = Date.now()): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredConsent;
    if (v.analytics !== 'granted' && v.analytics !== 'denied') return null;
    if (!(now - v.at < CONSENT_MAX_AGE_MS)) return null;
    return v.analytics;
  } catch {
    return null;
  }
}

export function saveConsent(choice: ConsentChoice, now = Date.now()): void {
  try {
    const v: StoredConsent = { analytics: choice, at: now };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(v));
  } catch {
    // storage blocked (private mode): the banner simply shows again next visit
  }
}

/** GA only runs in production builds on a real (non-local) host. */
export function analyticsEnabled(): boolean {
  if (!SITE.gaMeasurementId || !import.meta.env.PROD) return false;
  const h = location.hostname;
  return !(
    location.protocol === 'file:' ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]'
  );
}

let gaLoaded = false;
/** Injects gtag.js once. Same snippet as Google's, built in code. */
export function loadAnalytics(id = SITE.gaMeasurementId): void {
  if (gaLoaded || !id) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js only accepts the real `arguments` object (an array is ignored)
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

/** Removes GA cookies already set (visitor changed their mind to "Decline"). */
export function clearAnalyticsCookies(): void {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid');
  // GA sets cookies on the top-most registrable domain, e.g. ".deni.io".
  const parts = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++)
    domains.push(`; domain=.${parts.slice(i).join('.')}`);
  for (const n of names)
    for (const d of domains)
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
}

const BANNER_ID = 'mgp-consent';

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

function bannerHtml(): string {
  const owner = escapeHtml(SITE.owner);
  const contact = SITE.privacyContact
    ? ` Questions or data requests: <a href="mailto:${escapeHtml(SITE.privacyContact)}">${escapeHtml(SITE.privacyContact)}</a>.`
    : '';
  return `
    <p class="mgp-consent-text">
      This site uses Google Analytics cookies to count visits and see which games
      get played. No ads, nothing sold. Is that OK?
      <button type="button" class="mgp-consent-more" aria-expanded="false">Privacy details</button>
    </p>
    <div class="mgp-consent-details hg-scroll" hidden>
      <p><b>Who:</b> ${owner} runs this personal, non-commercial site.${contact}</p>
      <p><b>What, if you accept:</b> Google Analytics 4 records the pages you open, your
      browser / device type, approximate location (country / city, no full IP stored) and a
      random visitor ID kept in the <code>_ga</code> cookies for up to 2 years. Google
      processes this data, possibly outside the EU
      (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google privacy policy</a>).</p>
      <p><b>If you decline:</b> no analytics loads and no tracking cookies are set. Every game
      works the same either way.</p>
      <p><b>Always on:</b> games save settings and high scores in your browser's local storage.
      That data never leaves your device.</p>
      <p>You can change your choice any time via <b>Privacy &amp; cookies</b> at the bottom of
      the home page.</p>
    </div>
    <div class="mgp-consent-actions">
      <button type="button" data-choice="denied">Decline</button>
      <button type="button" data-choice="granted">Accept</button>
    </div>`;
}

/** Shows the banner (no-op if it is already open). */
export function openConsentBanner(): void {
  if (document.getElementById(BANNER_ID)) return;
  const el = document.createElement('div');
  el.id = BANNER_ID;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Cookie consent');
  el.innerHTML = bannerHtml();

  const more = el.querySelector<HTMLButtonElement>('.mgp-consent-more')!;
  const details = el.querySelector<HTMLElement>('.mgp-consent-details')!;
  more.addEventListener('click', () => {
    details.hidden = !details.hidden;
    more.setAttribute('aria-expanded', String(!details.hidden));
  });
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-choice]'))
    b.addEventListener('click', () => {
      const choice = b.dataset.choice as ConsentChoice;
      saveConsent(choice);
      if (choice === 'granted') {
        if (analyticsEnabled()) loadAnalytics();
      } else {
        clearAnalyticsCookies();
        // gtag.js is already running if they accepted earlier on this page
        window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      }
      el.remove();
    });
  // keys typed into the banner must not drive the game underneath
  el.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(el);
}

/**
 * True when the banner is switched on: a GA id is configured and
 * `SITE.showPrivacyBanner` allows it in this build. Also gates the portal
 * footer link.
 */
export function consentEnabled(): boolean {
  const mode = SITE.showPrivacyBanner;
  const shown = mode === true || (mode === 'production' && import.meta.env.PROD);
  return shown && !!SITE.gaMeasurementId;
}

/** Entry point, runs before every page (see consent-boot.ts). */
export function initConsent(): void {
  // banner hidden in this build (or no analytics configured): nothing is asked
  // and nothing loads - GA never runs without the visitor's consent
  if (!consentEnabled()) return;
  const choice = readConsent();
  if (choice === 'granted') {
    if (analyticsEnabled()) loadAnalytics();
    return;
  }
  if (choice === 'denied') return;
  if (document.body) openConsentBanner();
  else document.addEventListener('DOMContentLoaded', openConsentBanner);
}
