import { SITE } from '../site.config';

/** An external resource a game credits on its About screen: data set, model, texture, person. */
export interface SourceLink {
  label: string;
  /** Linked only when set (every link needs the owner's OK first). */
  url?: string;
  /** What it was used for / licence. */
  note?: string;
}

export interface AboutContent {
  version: string;
  /** What the game is, in a few sentences (HTML, trusted strings). */
  description: string;
  /** Where the assets come from (HTML), or what was generated; a heading "Assets" over it. */
  assets: string;
  builtWith: SourceLink[];
}

/** The About body of Kaboom and Hole Island, laid out like the rally one: credit line, version, description, assets, built with. */
export function aboutHtml(c: AboutContent): string {
  return `<p class="about-credit">${MADE_WITH_AGENTS}</p>
    <p class="about-credit">Version ${c.version}</p>
    <p>${c.description}</p>
    <h3>Assets</h3><p>${c.assets}</p>
    <h3>Built with</h3>${sourceListHtml(c.builtWith)}`;
}

/** The "made using AI agents" line of every About screen. */
export const MADE_WITH_AGENTS = `This game was made using AI agents under direction of ${SITE.owner}`;

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
