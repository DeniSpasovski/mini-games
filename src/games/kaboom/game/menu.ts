import {
  activateFocused,
  ensureFocus,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
} from '../../../shared/pad-nav';
import { goToPortal, portalUrl } from '../../../shared/portal-link';
import manifest from '../game.json';
import { MAP_SIZES, MAP_SIZE_IDS } from '../map/sizes';
import { TEAM_COLORS, TEAM_COLOR_NAMES } from '../render/characters';
import type { PortraitFn } from '../render/portraits';
import {
  CRITTERS,
  type CritterId,
  type Difficulty,
  type MapSizeId,
  type RoundCount,
} from '../sim/types';
import { button, el, title } from './dom';
import {
  DIFFICULTIES,
  QUALITIES,
  ROUND_COUNTS,
  clampBots,
  type KaboomSettings,
  type KaboomStats,
  type QualitySetting,
} from './settings';

const VERSION = manifest.version;

/** What the setup screen asks for. */
export interface MatchSetup {
  critter: CritterId;
  /** Team colour (palette index); the bots take the others. */
  color: number;
  bots: number;
  difficulty: Difficulty;
  size: MapSizeId;
  rounds: RoundCount;
}

/** How a finished match ended, for the results card. */
export interface MatchSummary {
  /** The human's slot won the match / lost it / it was a tie. */
  outcome: 'win' | 'lose' | 'tie';
  headline: string;
  standings: {
    critter: CritterId;
    color: number;
    wins: number;
    you: boolean;
    slot: number;
  }[];
  rounds: number;
}

export interface MenuApi {
  settings: KaboomSettings;
  /** A critter's portrait in a team colour (render/portraits.ts). */
  portrait: PortraitFn;
  stats(): KaboomStats;
  onPlay(setup: MatchSetup): void;
  /** Settings changed in the menu (the game saves them). */
  onSettings(): void;
  /** The arena size changed in the setup: build that arena behind the menu. */
  onArena(): void;
  /** The bot count or the team colour changed: fly bots in / out and recolour the match behind the menu (no rebuild). */
  onLineup(): void;
  onVolume(v: number): void;
  /** The quality tier changed: it needs a new renderer, so the game reloads the page. */
  onQuality(q: QualitySetting): void;
  onResume(): void;
  onRestart(): void;
  onMainMenu(): void;
  onClick(): void;
  /** The live 3D critter for the setup's picker; null (or missing) = show the portrait instead (no WebGL, tests). */
  makeStage?(): CritterStage | null;
}

/** A live critter on a little turntable (`render/critter-preview.ts`). */
export interface CritterStage {
  readonly canvas: HTMLCanvasElement;
  show(critter: CritterId, color: number): void;
  dispose(): void;
}

const SIZE_BLURB: Record<MapSizeId, string> = {
  s: 'Quick duels',
  m: 'The classic',
  l: 'Big brawl',
};

/** Menus: welcome, setup, how to play, options, pause and the match results, as cards over the 3D scene. */
export class Menu {
  private readonly layer = el('div', 'kb-menu');
  private readonly loadingEl = el('div', 'kb-loading');

  /** What the controller's B button does on the screen that is up (null = nothing). */
  private onBack: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly api: MenuApi,
  ) {
    new GamepadMenuNav((a) => this.padNav(a));
    this.loadingEl.append(
      el('div', 'kb-spinner'),
      el('div', '', 'Packing the TNT...'),
    );
    this.loadingEl.style.display = 'none';
    root.append(this.layer, this.loadingEl);
  }

  hide(): void {
    this.dropStage();
    this.layer.replaceChildren();
    this.layer.style.display = 'none';
  }

  loading(on: boolean): void {
    this.loadingEl.style.display = on ? '' : 'none';
  }

  /** The setup's live critter, while the setup card is up. */
  private stage: CritterStage | null = null;

  private dropStage(): void {
    this.stage?.dispose();
    this.stage = null;
  }

  private show(...children: HTMLElement[]): HTMLElement {
    if (this.stage && !children.some((c) => c.contains(this.stage!.canvas)))
      this.dropStage();
    this.layer.replaceChildren(...children);
    this.layer.style.display = '';
    this.onBack = null;
    const card = children[0];
    card?.classList.add('kb-in');
    return card;
  }

  /** Controller navigation (shared/pad-nav.ts): d-pad / stick move focus, A clicks, B goes back, Start resumes a paused match. */
  private padNav(a: NavAction): void {
    if (this.layer.style.display === 'none' || !this.layer.firstChild) return;
    if (a === 'back') this.onBack?.();
    else if (a === 'start') {
      if (this.layer.querySelector('.kb-pause-card')) this.api.onResume();
    } else if (a === 'confirm') {
      activateFocused(this.layer);
      ensureFocus(this.layer); // the next screen's primary button
    } else moveFocus(this.layer, a);
  }

  private click(fn: () => void): () => void {
    return () => {
      this.api.onClick();
      fn();
    };
  }

  private btn(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = button(label, cls, this.click(fn));
    if (cls.includes('primary')) b.setAttribute('data-primary', '');
    return b;
  }

  private allGames(card: HTMLElement): void {
    if (portalUrl())
      card.append(this.btn('All games', 'ghost', () => goToPortal()));
  }

  private logo(): HTMLElement {
    const h = el('h1', 'kb-logo');
    h.setAttribute('aria-label', '3, 2, 1 Kabooom');
    const hex = (i: number) =>
      `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    const num = (n: string, i: number) => {
      const s = el('span', 'kb-num', n);
      s.style.color = hex(i);
      return s;
    };
    h.append(
      num('3', 0),
      el('i', '', ','),
      num('2', 1),
      el('i', '', ','),
      num('1', 2),
      el('b', '', 'Kabooom'),
    );
    return h;
  }

  // ------------------------------------------------------------------ screens

  welcome(): void {
    const card = el('div', 'kb-card kb-welcome');
    const stats = this.api.stats();
    card.append(
      this.logo(),
      el('p', 'kb-tag', 'Light the fuse. Blast the crates. Outwit the crew.'),
      this.btn('Play', 'primary big', () => this.setup()),
      this.btn('How to play', '', () => this.howTo()),
      this.btn('Options', '', () => this.options(() => this.welcome())),
    );
    if (stats.matches > 0)
      card.append(
        el(
          'p',
          'kb-small',
          `You have won ${stats.wins} of ${stats.matches} matches.`,
        ),
      );
    this.allGames(card);
    this.show(card, el('div', 'kb-version', `v${VERSION}`));
  }

  setup(): void {
    const s = this.api.settings;
    const card = el('div', 'kb-card kb-setup');
    card.append(el('h2', '', 'New match'));

    // critter: one at a time, live in 3D on a turntable (a portrait without WebGL), arrows to flip through
    card.append(el('h3', '', 'Your critter'));
    this.dropStage();
    this.stage = this.api.makeStage?.() ?? null;
    const view = el('div', 'kb-stage');
    const portrait = el('img', 'kb-stage-img', '', { alt: '' });
    view.append(this.stage ? this.stage.canvas : portrait);
    const name = el('div', 'kb-critter-name');
    const step = (d: number) => {
      const i = CRITTERS.indexOf(s.critter);
      s.critter = CRITTERS[(i + d + CRITTERS.length) % CRITTERS.length];
      this.api.onSettings();
      showCritter();
    };
    const chevron = (d: string) =>
      `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const prev = this.btn('', 'kb-arrow', () => step(-1));
    const next = this.btn('', 'kb-arrow', () => step(1));
    prev.innerHTML = chevron('M15 5 8 12l7 7');
    next.innerHTML = chevron('M9 5l7 7-7 7');
    prev.setAttribute('aria-label', 'Previous critter');
    next.setAttribute('aria-label', 'Next critter');
    const picker = el('div', 'kb-picker');
    picker.append(prev, view, next);
    card.append(picker, name);
    const showCritter = () => {
      name.textContent = title(s.critter);
      portrait.src = this.api.portrait(s.critter, s.color);
      this.stage?.show(s.critter, s.color);
    };
    showCritter();

    // team colour: hard hat + vest
    const swatches = el('div', 'kb-swatches', '', {
      role: 'radiogroup',
      'aria-label': 'Team colour',
    });
    const hexOf = (i: number) =>
      `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    const swatchBtns = TEAM_COLORS.map((_, i) => {
      const b = el('button', 'kb-swatch', '', {
        type: 'button',
        role: 'radio',
        'aria-label': TEAM_COLOR_NAMES[i],
        title: TEAM_COLOR_NAMES[i],
      });
      b.style.setProperty('--sw', hexOf(i));
      b.addEventListener(
        'click',
        this.click(() => {
          if (s.color === i) return;
          s.color = i;
          this.api.onSettings();
          paint();
          showCritter();
          this.api.onLineup();
        }),
      );
      swatches.append(b);
      return b;
    });
    const paint = () => {
      swatchBtns.forEach((b, i) => {
        b.classList.toggle('on', i === s.color);
        b.setAttribute('aria-checked', String(i === s.color));
      });
      card.style.setProperty('--kb-team', hexOf(s.color));
    };
    paint();
    const colorRow = el('div', 'kb-row');
    colorRow.append(el('span', 'kb-rowlabel', 'Team colour'), swatches);
    card.append(colorRow);

    // arena size + bots
    card.append(el('h3', '', 'Arena'));
    const sizes = el('div', 'kb-seg');
    const sizeBtns = new Map<MapSizeId, HTMLButtonElement>();
    for (const id of MAP_SIZE_IDS) {
      const d = MAP_SIZES[id];
      const b = el('button', 'kb-segbtn', '', { type: 'button' });
      b.append(el('b', '', d.label), el('small', '', SIZE_BLURB[id]));
      b.addEventListener(
        'click',
        this.click(() => {
          const changed = s.size !== id;
          s.size = id;
          s.bots = clampBots(id, s.bots);
          this.api.onSettings();
          refresh();
          if (changed) this.api.onArena();
        }),
      );
      sizeBtns.set(id, b);
      sizes.append(b);
    }
    card.append(sizes);

    const botsRow = el('div', 'kb-row');
    const botsLabel = el('span', 'kb-botlabel');
    const minus = this.btn('−', 'round', () => bump(-1));
    const plus = this.btn('+', 'round', () => bump(1));
    botsRow.append(
      el('span', 'kb-rowlabel', 'Bot opponents'),
      minus,
      botsLabel,
      plus,
    );
    card.append(botsRow);
    const bump = (d: number) => {
      const before = s.bots;
      s.bots = clampBots(s.size, s.bots + d);
      this.api.onSettings();
      refresh();
      if (s.bots !== before) this.api.onLineup();
    };

    card.append(
      this.segRow(
        'Bot skill',
        DIFFICULTIES.map(String),
        s.difficulty,
        (v) => {
          s.difficulty = v as Difficulty;
          this.api.onSettings();
        },
        title,
      ),
    );
    card.append(
      this.segRow(
        'Rounds',
        ROUND_COUNTS.map(String),
        String(s.rounds),
        (v) => {
          s.rounds = Number(v) as RoundCount;
          this.api.onSettings();
        },
        (v) => (v === '1' ? 'Single' : `Best of ${v}`),
      ),
    );

    const refresh = () => {
      sizeBtns.forEach((b, id) => b.classList.toggle('on', id === s.size));
      botsLabel.textContent = String(s.bots);
      (minus as HTMLButtonElement).disabled = s.bots <= 1;
      (plus as HTMLButtonElement).disabled = s.bots >= clampBots(s.size, 99);
    };
    refresh();

    const actions = el('div', 'kb-actions');
    actions.append(
      this.btn('Start!', 'primary big', () =>
        this.api.onPlay({
          critter: s.critter,
          color: s.color,
          bots: s.bots,
          difficulty: s.difficulty,
          size: s.size,
          rounds: s.rounds,
        }),
      ),
      this.btn('Back', 'ghost', () => this.welcome()),
    );
    card.append(actions);
    this.show(card);
    this.onBack = () => this.click(() => this.welcome())();
  }

  /** A labelled row of exclusive buttons. */
  private segRow(
    label: string,
    values: string[],
    current: string,
    onPick: (v: string) => void,
    text: (v: string) => string = (v) => v,
  ): HTMLElement {
    const row = el('div', 'kb-row');
    const seg = el('div', 'kb-seg small');
    const btns = values.map((v) => {
      const b = el('button', 'kb-segbtn', text(v), { type: 'button' });
      b.addEventListener(
        'click',
        this.click(() => {
          onPick(v);
          btns.forEach((x, i) => x.classList.toggle('on', values[i] === v));
        }),
      );
      seg.append(b);
      return b;
    });
    btns.forEach((x, i) => x.classList.toggle('on', values[i] === current));
    row.append(el('span', 'kb-rowlabel', label), seg);
    return row;
  }

  howTo(): void {
    const card = el('div', 'kb-card kb-how');
    card.append(el('h2', '', 'How to play'));
    const list = el('ul', 'kb-list');
    for (const line of [
      'Walk with WASD / arrows, or drag a finger. Drop TNT with Space (or the TNT button).',
      'The band counts 3, 2, 1, then KABOOOM: flames shoot out in a cross.',
      'Hard blocks stop the flames; crates break and stop them too. Flames set off other TNT.',
      'Touch a flame and you are out. Run round a corner before your own TNT goes off!',
      'Last critter standing wins the round. Late in a round the walls fall in from the edge.',
    ])
      list.append(el('li', '', line));
    card.append(
      list,
      this.btn('Got it', 'primary', () => this.welcome()),
    );
    this.show(card);
    this.onBack = () => this.click(() => this.welcome())();
  }

  options(back: () => void): void {
    const s = this.api.settings;
    const card = el('div', 'kb-card kb-options');
    card.append(el('h2', '', 'Options'));
    const vol = el('input', 'kb-range', '', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
    });
    vol.value = String(s.volume);
    vol.addEventListener('input', () => {
      s.volume = Number(vol.value);
      this.api.onVolume(s.volume);
    });
    vol.addEventListener('change', () => this.api.onSettings());
    const volRow = el('div', 'kb-row');
    volRow.append(el('span', 'kb-rowlabel', 'Volume'), vol);
    card.append(volRow);
    card.append(
      this.segRow(
        'Graphics',
        [...QUALITIES],
        s.quality,
        (v) => this.api.onQuality(v as QualitySetting),
        title,
      ),
      el(
        'p',
        'kb-small',
        'Auto picks Low on phones. Changing graphics reloads the game.',
      ),
      this.btn('Back', 'primary', back),
    );
    this.show(card);
    this.onBack = () => this.click(back)();
  }

  pause(): void {
    const card = el('div', 'kb-card kb-pause-card');
    card.append(
      el('h2', '', 'Paused'),
      this.btn('Resume', 'primary big', () => this.api.onResume()),
      this.btn('Restart match', '', () => this.api.onRestart()),
      this.btn('Options', '', () => this.options(() => this.pause())),
      this.btn('Main menu', '', () => this.api.onMainMenu()),
    );
    this.allGames(card);
    this.show(card);
  }

  results(sum: MatchSummary): void {
    const card = el('div', `kb-card kb-results ${sum.outcome}`);
    card.append(el('h2', '', sum.headline));
    const list = el('ol', 'kb-standings');
    for (const row of [...sum.standings].sort(
      (a, b) => b.wins - a.wins || a.slot - b.slot,
    )) {
      const li = el('li', row.you ? 'you' : '');
      li.append(
        el('img', '', '', {
          src: this.api.portrait(row.critter, row.color),
          alt: '',
        }),
        el(
          'span',
          'name',
          row.you ? `${title(row.critter)} (you)` : title(row.critter),
        ),
        el(
          'span',
          'stars',
          row.wins > 0 ? '★'.repeat(Math.min(5, row.wins)) : '–',
        ),
      );
      list.append(li);
    }
    card.append(
      list,
      el(
        'p',
        'kb-small',
        `${sum.rounds > 1 ? `Best of ${sum.rounds}` : 'Single round'}`,
      ),
      this.btn('Play again', 'primary big', () => this.api.onRestart()),
      this.btn('Change setup', '', () => this.setup()),
      this.btn('Main menu', '', () => this.api.onMainMenu()),
    );
    this.allGames(card);
    this.show(card);
  }
}
