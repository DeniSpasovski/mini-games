import { SITE } from '../site.config';

/** An external resource a game credits on its About screen: data set, model, texture, person. */
export interface SourceLink {
  label: string;
  /** Linked only when set (every link needs the owner's OK first). */
  url?: string;
  /** What it was used for / licence. */
  note?: string;
}

/** The simple About body (Kaboom, Hole Island): what the game is, who made it, optional asset credits (HTML, trusted strings). */
export function aboutHtml(intro: string, assets?: string): string {
  return `<p>${intro}</p>
    <p class="about-by">By ${SITE.owner}</p>${assets ? `<h3>Assets</h3><p>${assets}</p>` : ''}`;
}

/** Poly Haven (CC0 scans), linked once as the source. */
export const POLY_HAVEN_HTML =
  '<a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a>';

/** A `<ul>` of credits (label, optional link, optional note), or a `<p class="noneClass">` when there are none. */
export function sourceListHtml(
  sources: SourceLink[] | undefined,
  none = '',
  noneClass = 'about-none',
): string {
  if (!sources?.length) return `<p class="${noneClass}">${none}</p>`;
  const items = sources.map(
    (s) =>
      `<li>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : s.label}${s.note ? `<small>${s.note}</small>` : ''}</li>`,
  );
  return `<ul>${items.join('')}</ul>`;
}
