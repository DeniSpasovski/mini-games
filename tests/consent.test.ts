import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { SITE } from '../src/site.config';
import {
  CONSENT_KEY,
  CONSENT_MAX_AGE_MS,
  initConsent,
  openConsentBanner,
  readConsent,
  saveConsent,
} from '../src/shared/consent';

const initialShow = SITE.showPrivacyBanner;
const initialGaId = SITE.gaMeasurementId;

// site.config shows the banner in production builds only; force it on for the tests
// the GA id comes from the untracked .env.local; the tests must not depend on it
beforeEach(() => {
  SITE.showPrivacyBanner = true;
  SITE.gaMeasurementId = 'G-TEST000000';
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  SITE.showPrivacyBanner = initialShow;
  SITE.gaMeasurementId = initialGaId;
});

const banner = () => document.getElementById('mgp-consent');

test('hidden by site config: no banner, no analytics', () => {
  SITE.showPrivacyBanner = false;
  initConsent();
  expect(banner()).toBeNull();
  expect(window.dataLayer).toBeUndefined();
});

test('no stored choice shows the banner', () => {
  initConsent();
  expect(banner()).toBeInTheDocument();
});

test('decline is stored, closes the banner and loads nothing', () => {
  openConsentBanner();
  banner()!.querySelector<HTMLButtonElement>('[data-choice="denied"]')!.click();
  expect(banner()).toBeNull();
  expect(readConsent()).toBe('denied');
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  initConsent();
  expect(banner()).toBeNull(); // not asked again
});

test('accept is stored and the banner stays closed on the next page', () => {
  openConsentBanner();
  banner()!
    .querySelector<HTMLButtonElement>('[data-choice="granted"]')!
    .click();
  expect(readConsent()).toBe('granted');
  initConsent();
  expect(banner()).toBeNull();
});

test('stored choice expires and junk is ignored', () => {
  const t0 = 1_000_000;
  saveConsent('granted', t0);
  expect(readConsent(t0 + CONSENT_MAX_AGE_MS - 1)).toBe('granted');
  expect(readConsent(t0 + CONSENT_MAX_AGE_MS + 1)).toBeNull();
  localStorage.setItem(CONSENT_KEY, '{bad json');
  expect(readConsent()).toBeNull();
});
