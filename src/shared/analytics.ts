/**
 * Game events for Google Analytics 4 (names / params follow GA4's recommended
 * game events: `level_start`, `level_end`, `post_score`, `select_content`).
 *
 * `window.gtag` only exists after the visitor accepted the cookie banner on a
 * production host (consent.ts), so `track()` is a no-op everywhere else - no
 * consent check is needed at the call site. `?analytics=log` prints every event
 * to the console (works in dev, where GA never loads).
 */

export type EventValue = string | number | boolean | undefined;
export type EventParams = Record<string, EventValue>;

/** GA4 limit: string param values are cut at 100 characters. */
const MAX_VALUE = 100;

export function cleanParams(
  params: EventParams,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v)))
      continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX_VALUE) : v;
  }
  return out;
}

export function analyticsLogging(search: string = location.search): boolean {
  return new URLSearchParams(search).get('analytics') === 'log';
}

export function track(name: string, params: EventParams = {}): void {
  const p = cleanParams(params);
  try {
    if (analyticsLogging()) console.info('[analytics]', name, p);
  } catch {
    // no location (tests in node)
  }
  if (typeof window !== 'undefined') window.gtag?.('event', name, p);
}

/** Seconds rounded to milliseconds (GA shows long floats badly). */
export function seconds(t: number): number {
  return Math.round(t * 1000) / 1000;
}
