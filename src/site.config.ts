/**
 * Site-wide settings. Edit here - nothing else needs changing.
 */
export const SITE = {
  /**
   * Hostnames allowed to run the portal and games (any port).
   * "*.example.com" also matches subdomains. Checked by src/shared/host-guard.ts,
   * which Rsbuild runs before every page (source.preEntry).
   */
  allowedHosts: ['deni.io', '*.deni.io', 'localhost', '127.0.0.1', '[::1]'],
  /** Where to send people who load a copy from another domain. */
  canonicalUrl: 'https://deni.io',
  owner: 'Deni S.',
  tagline: 'This site was made using AI agents under direction of Deni S.',
  /**
   * Google Analytics 4 measurement ID, read from the untracked env file
   * (`PUBLIC_GA_MEASUREMENT_ID` in `.env.local`, template: `.env.example`). Loaded only after
   * the visitor accepts the cookie banner, only in production builds on a non-local host
   * (src/shared/consent.ts). Empty / not set = no analytics and no banner.
   */
  gaMeasurementId:
    (import.meta.env.PUBLIC_GA_MEASUREMENT_ID as string | undefined) ?? '',
  /**
   * Privacy / cookie banner and its footer link:
   *  - 'production' = shown in the production build only, hidden on `npm run dev`
   *  - true         = shown everywhere (also dev, to test the banner)
   *  - false        = hidden everywhere
   * Wherever the banner is hidden, Google Analytics does not load either: it
   * only ever runs after the visitor clicks Accept.
   */
  showPrivacyBanner: 'production' as boolean | 'production',
  /** Optional e-mail shown in the banner's privacy details for data requests. */
  privacyContact: '',
};

/** True if `hostname` matches one of the allowed patterns. */
export function isAllowedHost(
  hostname: string,
  allowed: readonly string[] = SITE.allowedHosts,
): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((p) => {
    const pat = p.toLowerCase();
    return pat.startsWith('*.')
      ? host.endsWith(pat.slice(1)) || host === pat.slice(2)
      : host === pat;
  });
}

/**
 * Private-network hosts (192.168.x.x, 10.x.x.x, 172.16-31.x.x, *.local). Only
 * allowed by the host guard in `npm run dev`, so a phone / iPad on the same
 * Wi-Fi can open the dev server (`npm run dev -- --host`). Production builds
 * never accept these.
 */
export function isDevLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  );
}
