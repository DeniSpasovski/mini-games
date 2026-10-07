import { portalUrl } from '../../../shared/portal-link';
import { SITE } from '../../../site.config';
import gameManifest from '../game.json';
import { HOLE_COLORS } from '../render/hole-mesh';
import {
  DIFFICULTIES,
  MAX_LEVEL,
  TIER_COUNT,
  type Difficulty,
} from '../sim/progression';
import { button, el, fmtTime } from './dom';
import type { ScoreEntry } from './scores';
import type { HoleSettings } from './settings';

/** Game version (game.json, semver 0.x.y), shown in the menu + About. */
const VERSION = gameManifest.version;

/** Map card pictures (640 x 360 in-game shots, see screenshots/); a map without one gets a plain card. */
const MAP_THUMBS: Record<string, string> = {
  city: new URL('../screenshots/menu-city.jpg', import.meta.url).href,
  toy: new URL('../screenshots/menu-toy.jpg', import.meta.url).href,
  animal: new URL('../screenshots/menu-animal.jpg', import.meta.url).href,
};

export interface MapChoice {
  id: string;
  name: string;
  blurb: string;
  noun: string;
  /** Show the seed stepper (City Island). */
  seeded: boolean;
  /** Floor plans to pick from (toy store), empty when the map has one layout. */
  layouts: { id: string; name: string }[];
}

export interface MenuApi {
  settings: HoleSettings;
  /** Playable maps; with more than one, Play asks for the map first. */
  maps: MapChoice[];
  /** The map the game is set to right now. */
  mapId(): string;
  /** Switch the map (the menu background follows). */
  onMap(id: string): void;
  /** Pick another island seed / floor plan of the current map (the menu background follows). */
  onVariant(v: { seed?: number; layout?: string }): void;
  best(map: string, difficulty: Difficulty['id']): number;
  scores(map: string, difficulty: Difficulty['id']): ScoreEntry[];
  onPlay(d: Difficulty): void;
  onColor(id: string): void;
  onSettings(): void;
  onResume(): void;
  onRestart(): void;
  onMainMenu(): void;
  onAgain(): void;
  onClick(): void;
  /** The colour screen shows the live 3D hole behind a bottom card: the game frames the demo hole close up. */
  onPreview(on: boolean): void;
}

export interface ResultData {
  difficulty: Difficulty;
  /** Name of the map that was played and what its cleared state is called. */
  mapName: string;
  noun: string;
  score: number;
  level: number;
  eaten: number;
  pct: number;
  cleared: boolean;
  clearBonus: number;
  /** Items eaten per size tier (index 1..25). */
  perTier: number[];
  list: ScoreEntry[];
  rank: number;
  entry: ScoreEntry;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** All menu screens (welcome, colour, difficulty, scores, options, pause, results). */
export class Menu {
  readonly el = el('div', 'hg-screen');

  constructor(
    root: HTMLElement,
    private api: MenuApi,
  ) {
    root.append(this.el);
  }

  hide(): void {
    this.el.classList.remove('on', 'bottom');
    this.el.replaceChildren();
    this.api.onPreview(false);
  }

  private mount(card: HTMLElement, dim = false, preview = false): void {
    this.el.replaceChildren(card);
    this.el.classList.add('on');
    this.el.classList.toggle('dim', dim);
    this.el.classList.toggle('bottom', preview);
    this.api.onPreview(preview);
  }

  private click(fn: () => void): () => void {
    return () => {
      this.api.onClick();
      fn();
    };
  }

  private row(...kids: HTMLElement[]): HTMLElement {
    const r = el('div', 'hg-row');
    r.append(...kids);
    return r;
  }

  /** "All games" button when the game runs inside the portal (PWA has no back button). */
  private portal(cls = 'gray small'): HTMLButtonElement[] {
    const url = portalUrl();
    if (!url) return [];
    return [
      button(
        '‹ All games',
        cls,
        this.click(() => (location.href = url)),
      ),
    ];
  }

  private back(label = '‹ Back'): HTMLButtonElement {
    return button(
      label,
      'gray small',
      this.click(() => this.welcome()),
    );
  }

  // ------------------------------------------------------------------ welcome
  welcome(): void {
    const card = el('div', 'hg-card');
    card.append(
      el('h1', 'hg-title', 'HOLE ISLAND'),
      el(
        'p',
        'hg-sub',
        'Swallow the world. Start tiny, finish with the biggest thing in sight.',
      ),
      button(
        '▶  PLAY',
        '',
        this.click(() =>
          this.api.maps.length > 1 ? this.mapScreen() : this.difficulty(true),
        ),
      ),
      this.row(
        button(
          'Hole colour',
          'blue',
          this.click(() => this.colour()),
        ),
        button(
          'Top scores',
          'orange',
          this.click(() => this.scoresScreen()),
        ),
      ),
      this.row(
        button(
          'Options',
          'gray small',
          this.click(() => this.options()),
        ),
        button(
          'How to play',
          'gray small',
          this.click(() => this.about()),
        ),
      ),
      ...this.portal(),
    );
    // Version just under the menu card.
    const stack = el('div', 'hg-stack');
    stack.append(card, el('div', 'hg-version', `v${VERSION}`));
    this.mount(stack);
  }

  // ------------------------------------------------------------------ about
  about(): void {
    const card = el('div', 'hg-card wide hg-scroll');
    const list = (items: string[]) => {
      const ul = el('ul', 'hg-list');
      for (const t of items) ul.append(el('li', '', t));
      return ul;
    };
    card.append(
      el('h2', 'hg-h2', 'How to play'),
      list([
        'Touch and drag anywhere to steer the hole (arrow keys / WASD on a keyboard).',
        'Swallow anything smaller than the hole. Bigger things lean over the edge but stay put.',
        `Eat enough to level up: the hole grows, up to level ${MAX_LEVEL}, and can swallow bigger things.`,
        'Eat the whole island before the time runs out for a bonus on the seconds you have left.',
        'Pause with the II button, Esc or P.',
      ]),
      el('h2', 'hg-h2', 'Credits'),
      list([
        `Hole Island is a mini game by ${SITE.owner}.`,
        `Version ${VERSION}.`,
        SITE.tagline + '.',
        'Every model, the island and the sounds are generated in code. Rendering by three.js.',
      ]),
      this.back(),
    );
    this.mount(card);
  }

  // ------------------------------------------------------------------ colour
  colour(): void {
    const card = el('div', 'hg-card');
    const cur = () =>
      HOLE_COLORS.find((c) => c.id === this.api.settings.color) ??
      HOLE_COLORS[0];
    const grid = el('div', 'hg-swatches');
    for (const c of HOLE_COLORS) {
      const s = el(
        'button',
        'hg-swatch' + (c.id === cur().id ? ' sel' : ''),
        '',
        { type: 'button', 'aria-label': c.name },
      );
      s.style.background = hex(c.hex);
      s.addEventListener('click', () => {
        this.api.onClick();
        this.api.settings.color = c.id;
        this.api.onColor(c.id);
        grid
          .querySelectorAll('.hg-swatch')
          .forEach((n) => n.classList.remove('sel'));
        s.classList.add('sel');
      });
      grid.append(s);
    }
    card.append(el('h2', 'hg-h2', 'Hole colour'), grid, this.back('✓ Done'));
    this.mount(card, false, true);
  }

  // ------------------------------------------------------------------ map
  mapScreen(): void {
    const card = el('div', 'hg-card');
    const list = el('div', 'hg-maps');
    for (const m of this.api.maps) {
      const b = el(
        'button',
        `hg-map hg-map-${m.id}` + (m.id === this.api.mapId() ? ' on' : ''),
        '',
        { type: 'button' },
      );
      const best = Math.max(
        ...DIFFICULTIES.map((d) => this.api.best(m.id, d.id)),
      );
      const pic = MAP_THUMBS[m.id];
      if (pic) {
        const img = el('img', 'hg-map-img', '', {
          src: pic,
          alt: '',
          loading: 'lazy',
          draggable: 'false',
        });
        b.classList.add('pic');
        b.append(img);
      }
      b.append(
        el('b', '', m.name),
        el('span', '', m.blurb),
        el('em', '', best ? `Best ${best}` : 'No score yet'),
      );
      b.addEventListener(
        'click',
        this.click(() => {
          this.api.onMap(m.id);
          this.difficulty(true);
        }),
      );
      list.append(b);
    }
    card.append(el('h2', 'hg-h2', 'Pick a map'), list, this.back());
    this.mount(card);
  }

  // ------------------------------------------------------------------ difficulty
  /** `fresh` (coming from Play / the map picker) rolls a random island seed. */
  difficulty(fresh = false): void {
    const mc = this.api.maps.find((m) => m.id === this.api.mapId());
    if (fresh && mc?.seeded)
      this.api.onVariant({ seed: 1 + Math.floor(Math.random() * 999) });
    const card = el('div', 'hg-card');
    const row = el('div', 'hg-diffs');
    const mapId = this.api.mapId();
    const noun = this.api.maps.find((m) => m.id === mapId)?.noun ?? 'island';
    for (const d of DIFFICULTIES) {
      const b = el('button', `hg-diff ${d.id}`, '', { type: 'button' });
      const best = this.api.best(mapId, d.id);
      b.append(
        el('b', '', d.label),
        el('span', '', `${fmtTime(d.seconds)} · ${d.seconds} s`),
        el('span', '', best ? `Best ${best}` : 'No score yet'),
      );
      b.addEventListener(
        'click',
        this.click(() => this.api.onPlay(d)),
      );
      row.append(b);
    }
    card.append(
      el('h2', 'hg-h2', 'Pick your time'),
      el('p', 'hg-sub', `Less time = faster game. Same ${noun}.`),
      ...this.variantPicker(),
      row,
      this.api.maps.length > 1
        ? button(
            '‹ Back',
            'gray small',
            this.click(() => this.mapScreen()),
          )
        : this.back(),
    );
    this.mount(card);
  }

  /** Island seed stepper (City Island) or floor plan buttons (toy store) above the time buttons. */
  private variantPicker(): HTMLElement[] {
    const mc = this.api.maps.find((m) => m.id === this.api.mapId());
    const s = this.api.settings;
    if (mc?.seeded) {
      const again = (seed: number) => {
        this.api.onVariant({ seed: Math.min(999, Math.max(1, seed)) });
        this.difficulty();
      };
      const step = (
        label: string,
        cls: string,
        to: () => number,
        title: string,
      ) => {
        const b = button(
          label,
          cls,
          this.click(() => again(to())),
        );
        b.title = title;
        return b;
      };
      const stepper = el('div', 'hg-seed');
      stepper.append(
        step(
          '‹',
          'gray hg-arrow',
          () => (s.seed <= 1 ? 999 : s.seed - 1),
          'Previous island',
        ),
        el('p', 'hg-variant', `Island #${s.seed}`),
        step(
          '›',
          'gray hg-arrow',
          () => (s.seed >= 999 ? 1 : s.seed + 1),
          'Next island',
        ),
      );
      return [
        stepper,
        step(
          '🎲 Random',
          'gray small hg-random',
          () => 1 + Math.floor(Math.random() * 999),
          'Random island',
        ),
      ];
    }
    if (mc && mc.layouts.length > 1) {
      const tabs = el('div', 'hg-tabs');
      for (const l of mc.layouts) {
        const t = el(
          'button',
          'hg-tab' + (l.id === s.layout ? ' on' : ''),
          l.name,
          { type: 'button' },
        );
        t.addEventListener(
          'click',
          this.click(() => {
            this.api.onVariant({ layout: l.id });
            this.difficulty();
          }),
        );
        tabs.append(t);
      }
      return [tabs];
    }
    return [];
  }

  // ------------------------------------------------------------------ scores
  scoresScreen(
    selected: Difficulty['id'] = 'medium',
    mapId = this.api.mapId(),
  ): void {
    const card = el('div', 'hg-card wide');
    const mapTabs = el('div', 'hg-tabs');
    if (this.api.maps.length > 1)
      for (const m of this.api.maps) {
        const t = el(
          'button',
          'hg-tab' + (m.id === mapId ? ' on' : ''),
          m.name,
          { type: 'button' },
        );
        t.addEventListener(
          'click',
          this.click(() => this.scoresScreen(selected, m.id)),
        );
        mapTabs.append(t);
      }
    const tabs = el('div', 'hg-tabs');
    for (const d of DIFFICULTIES) {
      const t = el(
        'button',
        'hg-tab' + (d.id === selected ? ' on' : ''),
        d.label,
        {
          type: 'button',
        },
      );
      t.addEventListener(
        'click',
        this.click(() => this.scoresScreen(d.id, mapId)),
      );
      tabs.append(t);
    }
    const wrap = el('div', 'hg-scroll');
    wrap.append(this.scoreTable(this.api.scores(mapId, selected), -1));
    card.append(
      el('h2', 'hg-h2', 'Top 10'),
      ...(mapTabs.childElementCount ? [mapTabs] : []),
      tabs,
      wrap,
      this.back(),
    );
    this.mount(card);
  }

  private scoreTable(
    list: ScoreEntry[],
    highlight: number,
    extra?: ScoreEntry,
  ): HTMLElement {
    const table = el('table', 'hg-table');
    const head = el('tr');
    for (const h of ['#', 'SCORE', 'LEVEL', 'EATEN', 'DONE'])
      head.append(el('th', '', h));
    table.append(head);
    const row = (e: ScoreEntry, rank: string, me: boolean) => {
      const tr = el('tr', me ? 'me' : '');
      tr.append(
        el('td', '', rank),
        el('td', '', String(e.score)),
        el('td', '', String(e.level)),
        el('td', '', String(e.eaten)),
        el('td', '', `${Math.round(e.pct * 100)}%`),
      );
      table.append(tr);
    };
    list.forEach((e, i) => row(e, String(i + 1), i + 1 === highlight));
    if (!list.length) {
      const tr = el('tr');
      const td = el('td', '', 'No runs yet. Go eat something!', {
        colspan: '5',
      });
      td.style.textAlign = 'center';
      tr.append(td);
      table.append(tr);
    }
    if (extra) {
      const gap = el('tr', 'gap');
      gap.append(el('td', '', '⋮', { colspan: '5' }));
      table.append(gap);
      row(extra, 'you', true);
    }
    return table;
  }

  // ------------------------------------------------------------------ options
  options(fromPause = false): void {
    const s = this.api.settings;
    const card = el('div', 'hg-card');
    const vol = el('label', 'hg-slider', 'Volume');
    const input = el('input', '', '', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
    });
    input.value = String(s.volume);
    input.addEventListener('input', () => {
      s.volume = Number(input.value);
      this.api.onSettings();
    });
    vol.append(input);
    const q = el('label', 'hg-slider', 'Graphics');
    const sel = el('select', 'hg-select');
    for (const [v, l] of [
      ['auto', 'Auto'],
      ['high', 'High (shadows)'],
      ['low', 'Low (faster)'],
    ])
      sel.append(el('option', '', l, { value: v }));
    sel.value = s.quality;
    sel.addEventListener('change', () => {
      s.quality = sel.value as HoleSettings['quality'];
      this.api.onSettings();
    });
    q.append(sel);
    card.append(
      el('h2', 'hg-h2', 'Options'),
      vol,
      q,
      el('p', 'hg-sub', 'Graphics changes apply on the next run.'),
      fromPause
        ? button(
            '‹ Back',
            'gray small',
            this.click(() => this.pause()),
          )
        : this.back(),
    );
    this.mount(card, fromPause);
  }

  // ------------------------------------------------------------------ pause
  pause(): void {
    const card = el('div', 'hg-card');
    card.append(
      el('h2', 'hg-h2', 'Paused'),
      button(
        '▶  Resume',
        '',
        this.click(() => this.api.onResume()),
      ),
      this.row(
        button(
          'Restart',
          'orange',
          this.click(() => this.api.onRestart()),
        ),
        button(
          'Options',
          'blue',
          this.click(() => this.options(true)),
        ),
      ),
      this.row(
        button(
          'Main menu',
          'gray small',
          this.click(() => this.api.onMainMenu()),
        ),
        ...this.portal(),
      ),
    );
    this.mount(card, true);
  }

  // ------------------------------------------------------------------ results
  results(r: ResultData): void {
    const card = el('div', 'hg-card wide hg-scroll');
    const newBest = r.rank === 1;
    card.append(
      el(
        'h2',
        'hg-h2',
        r.cleared ? `${r.noun.toUpperCase()} CLEARED!` : 'TIME IS UP!',
      ),
      el('div', 'hg-big', String(r.score)),
      el(
        'p',
        'hg-sub',
        newBest
          ? '★ New best score! ★'
          : r.rank
            ? `#${r.rank} on the ${r.difficulty.label} top 10`
            : `Not in the ${r.difficulty.label} top 10 yet`,
      ),
    );
    const stats = el('div', 'hg-stats');
    for (const [v, l] of [
      [`${r.level}/${MAX_LEVEL}`, 'LEVEL'],
      [String(r.eaten), 'ITEMS EATEN'],
      [`${Math.round(r.pct * 100)}%`, `OF THE ${r.noun.toUpperCase()}`],
    ]) {
      const s = el('div', 'hg-stat');
      s.append(el('b', '', v), el('span', '', l));
      stats.append(s);
    }
    card.append(stats);
    if (r.cleared)
      card.append(el('p', 'hg-sub', `Time bonus +${r.clearBonus}`));
    // items eaten per size tier
    const max = Math.max(1, ...r.perTier);
    const bars = el('div', 'hg-bars');
    for (let l = 1; l <= TIER_COUNT; l++) {
      const b = el('i');
      b.style.height = `${Math.max(4, ((r.perTier[l] ?? 0) / max) * 100)}%`;
      b.style.opacity = r.perTier[l] ? '1' : '0.25';
      // one hue per tier (blue -> violet -> red) so the 25 bars stay apart; every fifth bar is darker
      b.style.background = `hsl(${205 + ((l - 1) * 150) / (TIER_COUNT - 1)}deg 78% ${l % 5 === 0 ? 42 : 56}%)`;
      b.title = `Size tier ${l}: ${r.perTier[l] ?? 0}`;
      bars.append(b);
    }
    const axis = el('div', 'hg-bars-axis');
    axis.append(
      el('span', '', 'tier 1 · small'),
      el('span', '', 'big · tier 25'),
    );
    card.append(el('p', 'hg-sub', 'Items eaten by size tier'), bars, axis);
    card.append(
      el('h2', 'hg-h2', `${r.mapName} · ${r.difficulty.label} · Top 10`),
      this.scoreTable(r.list, r.rank, r.rank === 0 ? r.entry : undefined),
      this.row(
        button(
          'Play again',
          '',
          this.click(() => this.api.onAgain()),
        ),
        button(
          'Main menu',
          'gray',
          this.click(() => this.api.onMainMenu()),
        ),
      ),
      ...this.portal(),
    );
    this.mount(card, true);
  }
}
