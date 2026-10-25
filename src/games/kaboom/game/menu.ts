import {
  activateFocused,
  ensureFocus,
  attachKeyNav,
  GamepadMenuNav,
  watchMenuTick,
  moveFocus,
  type NavAction,
} from '../../../shared/pad-nav';
import { aboutHtml, POLY_HAVEN_HTML } from '../../../shared/about';
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
import { starIcon, stickIcon } from './icons';
import {
  DIFFICULTIES,
  CAMERAS,
  QUALITIES,
  ROUND_COUNTS,
  clampBots,
  type KaboomSettings,
  type KaboomStats,
  type CameraSetting,
  type QualitySetting,
} from './settings';

import { LEVELS, type LevelId } from './levels';
import { offeredLevels } from '../release';

const VERSION = manifest.version;

/** What the setup screen asks for. */
export interface MatchSetup {
  critter: CritterId;
  /** Team colour (palette index); the bots take the others. */
  color: number;
  bots: number;
  difficulty: Difficulty;
  size: MapSizeId;
  level: LevelId;
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
    /** Other players this one knocked out (self booms not counted). */
    booms: number;
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
  /** The camera view changed in the options (the game applies it right away). */
  onCamera(c: CameraSetting): void;
  /** "Change setup" on the results card: the finished match behind it goes (the setup shows the bots' arena). */
  onSetup?(): void;
  onResume(): void;
  onRestart(): void;
  onMainMenu(): void;
  onClick(): void;
  /** Menu highlight moved (keyboard, controller, mouse hover): play the tick. */
  onTick(): void;
  /** The live 3D critter for the setup's picker; null (or missing) = show the portrait instead (no WebGL, tests). */
  makeStage?(): CritterStage | null;
}

/** A live critter on a little turntable (`render/critter-preview.ts`). */
export interface CritterStage {
  readonly canvas: HTMLCanvasElement;
  show(critter: CritterId, color: number): void;
  dispose(): void;
}

const hexOf = (i: number): string =>
  `#${(TEAM_COLORS[(i | 0) % TEAM_COLORS.length] ?? TEAM_COLORS[0]).toString(16).padStart(6, '0')}`;

/** A segmented button's chosen state, for the look (`.on`) and for assistive tech. */
const setOn = (b: HTMLElement, on: boolean): void => {
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
};

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
    attachKeyNav(
      () => this.layer.style.display !== 'none' && !!this.layer.firstChild,
      (a) => this.padNav(a),
    );
    watchMenuTick(this.layer, () => this.api.onTick());
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
    this.layer.classList.toggle(
      'sheet',
      !!card?.classList.contains('kb-sheet'),
    );
    return card;
  }

  /** Controller navigation (shared/pad-nav.ts): d-pad / stick move focus, A clicks, B goes back, Start resumes a paused match. */
  private padNav(a: NavAction): void {
    if (this.layer.style.display === 'none' || !this.layer.firstChild) return;
    if (a === 'back') this.onBack?.();
    else if (a === 'start') {
      if (this.layer.querySelector('.kb-pause-card')) this.api.onResume();
      else this.layer.querySelector<HTMLElement>('[data-start]')?.click();
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

  /** Bottom action row of a card: stays in view while the card content scrolls. */
  private actions(...kids: HTMLElement[]): HTMLElement {
    const a = el('div', 'kb-actions');
    a.append(...kids);
    return a;
  }

  /** The secondary buttons of the welcome card: stacked, or side by side on a short landscape screen. */
  private minor(...kids: HTMLElement[]): HTMLElement {
    const m = el('div', 'kb-minor');
    m.append(...kids);
    return m;
  }

  private allGames(card: HTMLElement): void {
    if (portalUrl())
      card.append(this.btn('All games', 'ghost', () => goToPortal()));
  }

  private logo(): HTMLElement {
    const h = el('h1', 'kb-logo');
    h.setAttribute('aria-label', '3, 2, 1 Kabooom');
    const balls = el('div', 'kb-balls');
    ['3', '2', '1'].forEach((n, i) => {
      const b = el('span', 'kb-ball', n, { 'aria-hidden': 'true' });
      b.style.setProperty('--ball', hexOf(i));
      balls.append(b);
    });
    const word = el('div', 'kb-word', '', { 'aria-hidden': 'true' });
    for (const ch of 'Kabooom') word.append(el('span', '', ch));
    h.append(balls, word);
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
      this.minor(
        this.btn('How to play', '', () => this.howTo()),
        this.btn('Options', '', () => this.options(() => this.welcome())),
        this.btn('About', '', () => this.about()),
      ),
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
    const card = el('div', 'kb-card kb-setup kb-sheet');
    card.append(el('h2', '', 'New match'));
    const cols = el('div', 'kb-cols');
    const you = el('div', 'kb-col');
    const match = el('div', 'kb-col');
    cols.append(you, match);
    card.append(cols);

    // critter: one at a time, live in 3D on a turntable (a portrait without WebGL), arrows to flip through
    you.append(el('h3', '', 'Your critter'));
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
    you.append(picker, name);
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
    you.append(el('h3', '', 'Team colour'), swatches);

    // arena size + bots
    match.append(el('h3', '', 'Arena'));
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
    match.append(sizes);

    const botsRow = el('div', 'kb-row kb-botrow');
    const botsLabel = el('span', 'kb-botlabel');
    const minus = this.btn('−', 'round', () => bump(-1));
    const plus = this.btn('+', 'round', () => bump(1));
    minus.setAttribute('aria-label', 'Fewer bots');
    plus.setAttribute('aria-label', 'More bots');
    const stepper = el('div', 'kb-stepper');
    stepper.append(minus, botsLabel, plus);
    botsRow.append(el('span', 'kb-rowlabel', 'Bot opponents'), stepper);
    match.append(botsRow);
    const bump = (d: number) => {
      const before = s.bots;
      s.bots = clampBots(s.size, s.bots + d);
      this.api.onSettings();
      refresh();
      if (s.bots !== before) this.api.onLineup();
    };

    // the match rules: folded behind one row on a phone held upright
    const rules = el('div', 'kb-rules');
    const more = this.btn('Match rules ›', 'ghost kb-more', () => {
      const open = rules.classList.toggle('open');
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Match rules ‹' : 'Match rules ›';
    });
    more.setAttribute('aria-expanded', 'false');
    match.append(more, rules);

    // level (the look): only when this build offers more than the Quarry
    const levels = offeredLevels();
    const levelBtns = new Map<LevelId, HTMLButtonElement>();
    if (levels.length > 1) {
      rules.append(el('h3', '', 'Level'));
      const seg = el('div', 'kb-seg');
      for (const id of levels) {
        const b = el('button', 'kb-segbtn', '', { type: 'button' });
        b.append(
          el('b', '', LEVELS[id].label),
          el('small', '', LEVELS[id].blurb),
        );
        b.addEventListener(
          'click',
          this.click(() => {
            if (s.level === id) return;
            s.level = id;
            this.api.onSettings();
            refresh();
            this.api.onArena();
          }),
        );
        levelBtns.set(id, b);
        seg.append(b);
      }
      rules.append(seg);
    }

    rules.append(
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
      sizeBtns.forEach((b, id) => setOn(b, id === s.size));
      levelBtns.forEach((b, id) => setOn(b, id === s.level));
      botsLabel.textContent = String(s.bots);
      (minus as HTMLButtonElement).disabled = s.bots <= 1;
      (plus as HTMLButtonElement).disabled = s.bots >= clampBots(s.size, 99);
    };
    refresh();

    const startBtn = this.btn('Start!', 'primary big', () =>
      this.api.onPlay({
        critter: s.critter,
        color: s.color,
        bots: s.bots,
        difficulty: s.difficulty,
        size: s.size,
        level: s.level,
        rounds: s.rounds,
      }),
    );
    // The pad starts on the critter picker, not on Start! (Start button = go).
    startBtn.removeAttribute('data-primary');
    startBtn.setAttribute('data-start', '');
    cols.append(
      this.actions(
        startBtn,
        this.btn('Back', 'ghost', () => this.welcome()),
      ),
    );
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
          btns.forEach((x, i) => setOn(x, values[i] === v));
        }),
      );
      seg.append(b);
      return b;
    });
    btns.forEach((x, i) => setOn(x, values[i] === current));
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
      'Last critter standing wins the round. Late in a round the arena closes in from the edge.',
    ])
      list.append(el('li', '', line));
    card.append(
      list,
      this.actions(this.btn('Got it', 'primary', () => this.welcome())),
    );
    this.show(card);
    this.onBack = () => this.click(() => this.welcome())();
  }

  about(): void {
    const card = el('div', 'kb-card kb-about');
    card.append(el('h2', '', 'About'));
    const body = el('div', 'kb-about-body');
    body.innerHTML = aboutHtml({
      version: VERSION,
      description:
        'A party game for you and up to seven bots. A crew of chubby animal demolition workers is dropped into an arena with a cheering crowd: light the fuse, watch the band count 3, 2, 1, blast the crates and be the last critter standing. A tilted 3D arena, three arena sizes, bots in three skill levels, and chain reactions that stay smooth.',
      assets: `The critters, arenas, effects and sounds are made in code. Environment light and textures from ${POLY_HAVEN_HTML}, CC0.`,
      builtWith: [
        { label: 'three.js', note: 'rendering, MIT' },
        {
          label: 'Grandstander and Nunito',
          note: 'UI fonts, SIL Open Font License 1.1',
        },
      ],
    });
    card.append(
      body,
      this.actions(this.btn('Back', 'primary', () => this.welcome())),
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
        'Camera',
        [...CAMERAS],
        s.camera,
        (v) => this.api.onCamera(v as CameraSetting),
        (v) => (v === 'follow' ? 'Close' : 'Whole arena'),
      ),
      el('p', 'kb-small', 'Close follows you. Press C in a match to switch.'),
    );
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
      this.actions(this.btn('Back', 'primary', back)),
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
    const card = el('div', `kb-card kb-results kb-sheet ${sum.outcome}`);
    card.append(el('h2', '', sum.headline));
    const list = el('ol', 'kb-standings');
    const rows = [...sum.standings].sort(
      (a, b) => b.wins - a.wins || b.booms - a.booms || a.slot - b.slot,
    );
    rows.forEach((row, rank) => {
      const li = el('li', row.you ? 'you' : '');
      const img = el('img', '', '', {
        src: this.api.portrait(row.critter, row.color),
        alt: '',
      });
      li.style.setProperty('--team', hexOf(row.color));
      const stars = el('span', 'stars', '', {
        role: 'img',
        'aria-label': `${row.wins} round ${row.wins === 1 ? 'win' : 'wins'}`,
      });
      stars.innerHTML =
        row.wins > 0
          ? starIcon(true).repeat(Math.min(5, row.wins))
          : starIcon(false);
      const booms = el('span', 'booms', String(row.booms), {
        role: 'img',
        'aria-label': `${row.booms} ${row.booms === 1 ? 'blast' : 'blasts'}`,
      });
      booms.insertAdjacentHTML('afterbegin', stickIcon(true));
      li.append(
        el('span', 'rank', String(rank + 1)),
        img,
        el(
          'span',
          'name',
          row.you ? `${title(row.critter)} (you)` : title(row.critter),
        ),
        stars,
        booms,
      );
      list.append(li);
    });
    card.append(
      list,
      el(
        'p',
        'kb-small',
        `${sum.rounds > 1 ? `Best of ${sum.rounds}` : 'Single round'}`,
      ),
    );
    const actions = el('div', 'kb-actions');
    actions.append(
      this.btn('Play again', 'primary big', () => this.api.onRestart()),
      this.btn('Change setup', '', () => {
        this.api.onSetup?.();
        this.setup();
      }),
      this.btn('Main menu', '', () => this.api.onMainMenu()),
    );
    card.append(actions);
    this.allGames(card);
    this.show(card);
  }
}
