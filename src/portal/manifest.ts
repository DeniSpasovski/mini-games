/**
 * Shape of `src/games/<id>/game.json`.
 * Shared by rsbuild.config.ts (to create page entries) and the portal (to list games).
 * Keep this file free of DOM / browser imports.
 */
export interface GamePageManifest {
  /** Page id. "play" is the main game page and is served at /games/<id>/ */
  id: string;
  /** Entry module, relative to the game folder (e.g. "pages/play.ts"). */
  entry: string;
  /** Browser tab title. */
  title: string;
  /** Short button label on the portal card. */
  label: string;
  /** Dev / debug tool page (shown in the "tools" row of the card). */
  dev?: boolean;
  /** Hide this tool's link in the release build (page still builds; the dev server and `build:test` show it). */
  hideInProd?: boolean;
}

export interface GameManifest {
  id: string;
  title: string;
  /** Semantic version, 0.x.y while in development (minor = feature, patch = fix). Shown in the game's menu + About. */
  version?: string;
  description: string;
  /** Free-form tags shown on the card, e.g. ["three.js", "racing"]. */
  tags?: string[];
  pages: GamePageManifest[];
}

export interface ResolvedGamePage extends GamePageManifest {
  gameId: string;
  /** Rsbuild entry name; also the html output path without ".html". */
  entryName: string;
  /** URL to link to, relative to the portal root (no leading slash). */
  href: string;
}

export function resolveGamePage(
  gameId: string,
  page: GamePageManifest,
): ResolvedGamePage {
  const isMain = page.id === 'play';
  const entryName = `games/${gameId}/${isMain ? 'index' : page.id}`;
  const href = isMain ? `games/${gameId}/` : `${entryName}.html`;
  return { ...page, gameId, entryName, href };
}

export function gamePagesFromManifests(
  manifests: GameManifest[],
): ResolvedGamePage[] {
  return manifests.flatMap((m) => m.pages.map((p) => resolveGamePage(m.id, p)));
}
