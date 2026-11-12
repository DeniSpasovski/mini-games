/**
 * A page's URL parameter: a value the page filled in itself first, else the query string. A replay link (`?replay=<id>`)
 * fills in the season, hour and weather of the run from the saved replay (pages/play.ts) and those win over any other
 * params in the link, so the address bar can stay short and the readers do not care where a value came from.
 */
const inferred = new Map<string, string>();

/** Values the page uses whatever the URL says; '' / missing = none (the replay's own hour, dry weather). */
export function setInferredParams(
  values: Record<string, string | undefined>,
): void {
  inferred.clear();
  for (const [k, v] of Object.entries(values)) inferred.set(k, v ?? '');
}

export function urlParam(name: string): string | null {
  const own = inferred.get(name);
  if (own !== undefined) return own;
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}
