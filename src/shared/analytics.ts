/**
 * Game events for Google Analytics 4, named `game_<game id>_<event>` (e.g.
 * `game_rally_level_end`); `<event>` follows GA4's recommended game events
 * (`level_start`, `level_end`, `post_score`, `select_content`).
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

/** GA4 event names: letters, digits, `_`, starting with a letter, max 40 characters. */
export function eventName(game: string, event: string): string {
  return `game_${game}_${event}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
}

/**
 * Sends `game_<game>_<event>`; `game_id` is also added as a param (one report across games).
 * Param names: `game_<name>` when every game sends it, `game_<game>_<name>` when only one does.
 */
export function track(
  game: string,
  event: string,
  params: EventParams = {},
): void {
  const name = eventName(game, event);
  const p = cleanParams({ game_id: game, ...params });
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
