/**
 * Validators for values read from the URL (query string) or storage: every param is cut down to a real
 * value (a known id, a number in range) before use, and anything that must reach HTML is escaped.
 */

/** Longest text a URL param may carry into the app. */
export const MAX_PARAM_LENGTH = 200;

/** Text from the URL: control characters dropped, length capped. */
export function cleanParam(raw: string | null | undefined): string {
  let out = '';
  for (const ch of (raw ?? '').slice(0, MAX_PARAM_LENGTH * 2)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out.slice(0, MAX_PARAM_LENGTH);
}

/** `raw` when it is one of `allowed` (own values only), else `fallback`. */
export function paramOneOf<T extends string, F>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return (allowed as readonly string[]).includes(raw ?? '\0')
    ? (raw as T)
    : fallback;
}

/** A finite number clamped to [min, max]; `fallback` when missing, empty or not a number. */
export function paramNumber<F>(
  raw: string | null | undefined,
  min: number,
  max: number,
  fallback: F,
): number | F {
  if (raw === null || raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Like `paramNumber`, rounded down to a whole number. */
export function paramInt<F>(
  raw: string | null | undefined,
  min: number,
  max: number,
  fallback: F,
): number | F {
  const n = paramNumber(raw, min, max, null);
  return n === null ? fallback : Math.floor(n);
}

/** Whether `s` looks like an asset / map / car id (letters, digits, `_ - . : +`). */
export function isSafeId(s: string): boolean {
  return /^[A-Za-z0-9_.:+-]{1,64}$/.test(s);
}

/** Own-key lookup in a record (so `__proto__`, `constructor` ... are never found). */
export function ownValue<V>(
  table: Record<string, V>,
  key: string | null | undefined,
): V | undefined {
  return key !== null &&
    key !== undefined &&
    Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}

/** Text for `innerHTML`. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
