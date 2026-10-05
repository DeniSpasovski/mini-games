/** Tiny DOM helper used by the HUD and menus. */
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
  const b = el('button', `hg-btn ${cls}`.trim(), label, { type: 'button' });
  b.addEventListener('click', onClick);
  return b;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
