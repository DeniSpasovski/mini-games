import '../portal/ui-tokens.css';
import './tool-page.css';
import { DebugPanel, type PanelLink, type PanelSection } from './debug-panel';

/**
 * Tool pages of Hole Island and 3, 2, 1 Kabooom (map / item / crew viewers, balance, bench) in the portal's look
 * (`src/portal/STYLEGUIDE.md` -> Tool pages): graphite shell, portal fonts, the game's wordmark and accent from its
 * `game.json`. The panel is the shared DebugPanel; `body.tp-tool` scopes the look.
 *
 *   const panel = toolPanel({ game: gameManifest, wordmark, title: 'Map viewer', links: TOOL_LINKS });
 */
export interface ToolGame {
  id: string;
  title: string;
  accent?: string;
  onAccent?: string;
}

export interface ToolPanelOptions {
  game: ToolGame;
  /** The game's `wordmark.svg` (white outlined title), shown over the page title. */
  wordmark?: string;
  title: string;
  links: PanelLink[];
}

/** Mouse and panel keys of every orbit-camera tool page (`addToolHelp` puts the page's own keys after them). */
export const ORBIT_KEYS: [string, string][] = [
  ['Left-drag', 'orbit'],
  ['Right-drag', 'pan'],
  ['Wheel', 'zoom'],
  ['H', 'hide / show the panel'],
  ['F3', 'stats'],
];

/** The page's panel: portal look, the game's accent, remembered open sections and a "Panel · H" plate over the view. */
export function toolPanel(opts: ToolPanelOptions): DebugPanel {
  const body = document.body;
  body.classList.add('dp-body', 'tp-tool');
  if (opts.game.accent) body.style.setProperty('--tp-accent', opts.game.accent);
  if (opts.game.onAccent)
    body.style.setProperty('--tp-on-accent', opts.game.onAccent);
  const panel = new DebugPanel({
    title: opts.title,
    links: opts.links,
    rememberSections: `${opts.game.id}-tool-sections:${opts.title}`,
  });
  if (opts.wordmark) {
    const img = document.createElement('img');
    img.className = 'tp-wordmark';
    img.src = opts.wordmark;
    img.alt = opts.game.title;
    panel.el.querySelector('.dp-header h1')?.before(img);
  }
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tp-toggle';
  toggle.textContent = 'Panel · H';
  toggle.addEventListener('click', () => DebugPanel.toggle());
  panel.viewport.append(toggle);
  return panel;
}

/** "Help" section (closed by default): the orbit keys (`orbit` false = none), the page's own keys, then notes. */
export function addToolHelp(
  panel: DebugPanel,
  keys: [string, string][] = [],
  notes: string[] = [],
  orbit = true,
): PanelSection {
  const s = panel.section('Help', false);
  s.keys([...(orbit ? ORBIT_KEYS : []), ...keys]);
  for (const n of notes) s.note(n);
  return s;
}
