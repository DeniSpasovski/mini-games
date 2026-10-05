/**
 * Tiny typed wrapper around the query string, used by debug pages so any view
 * can be bookmarked / shared: e.g. `asset-debug.html?asset=pine_tree&seed=42`.
 *
 * The type of each default value decides how the param is parsed.
 */
export type UrlValue = string | number | boolean;

export function readUrlState<T extends Record<string, UrlValue>>(
  defaults: T,
): T {
  const params = new URLSearchParams(location.search);
  const out: Record<string, UrlValue> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const def = defaults[key];
    if (typeof def === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof def === 'boolean') {
      out[key] = raw === '1' || raw === 'true';
    } else {
      out[key] = raw;
    }
  }
  return out as T;
}

/**
 * Write values into the URL. Values equal to their default are removed to
 * keep links short. `push` creates a history entry (use for "navigation"
 * like selecting another asset), otherwise the entry is replaced.
 */
export function writeUrlState(
  values: Record<string, UrlValue>,
  defaults: Record<string, UrlValue> = {},
  push = false,
): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(values)) {
    if (key in defaults && defaults[key] === value) params.delete(key);
    else
      params.set(
        key,
        typeof value === 'boolean' ? (value ? '1' : '0') : String(value),
      );
  }
  const qs = params.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
  if (url === `${location.pathname}${location.search}${location.hash}`) return;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
