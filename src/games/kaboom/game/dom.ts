/** Tiny DOM helpers for the HUD and menus. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function button(
  label: string,
  cls: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = el('button', `kb-btn ${cls}`.trim(), label, { type: 'button' });
  b.addEventListener('click', onClick);
  return b;
}

/** `m:ss` from seconds (rounded up, never negative). */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Capitalised critter / difficulty names for the UI. */
export const title = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);
