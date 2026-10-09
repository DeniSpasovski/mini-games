import { TEAM_COLORS } from '../render/characters';
import type { PortraitFn } from '../render/portraits';
import {
  CORNER_FROM_RANGE,
  MAX_POWER_LEVEL,
  ROUND_S,
  START_RANGE,
  START_TNT,
} from '../sim/rules';
import type { KabooomSim } from '../sim/types';
import { el, fmtTime, title } from './dom';
import { bundleIcon, stickIcon } from './icons';

/** Blast levels as players see them: range 2 = level 1 ... (levels 4 and 5 turn corners). */
const MAX_BLAST_LEVEL = MAX_POWER_LEVEL + 1;
const CORNER_LEVEL = CORNER_FROM_RANGE - START_RANGE + 1;

/**
 * In-run HUD: a chip per player (portrait, team colour, round wins, knocked-out state), the round timer, round counter,
 * pause button, TNT stock, and the big centre banners (countdown, round result, sudden death). Every element only
 * touches the DOM when its text changes, so updating it each frame costs nothing.
 */
export class Hud {
  readonly el = el('div', 'kb-hud');
  private readonly chips = el('div', 'kb-chips');
  private readonly timer = el('div', 'kb-pill kb-timer', '2:00');
  private readonly round = el('div', 'kb-pill kb-round');
  private readonly stock = el('div', 'kb-stock');
  private readonly tnt = el('div', 'kb-pill kb-tntleft');
  private readonly blast = el('div', 'kb-pill kb-blast');
  private readonly banner = el('div', 'kb-banner');
  private readonly sub = el('div', 'kb-sub');
  private readonly hint = el('div', 'kb-hint');
  private chipEls: { root: HTMLElement; wins: HTMLElement }[] = [];
  private last = {
    timer: '',
    round: '',
    tnt: '',
    blast: '',
    banner: '',
    sub: '',
    chips: '',
  };
  private hintUntil = 0;

  constructor(
    root: HTMLElement,
    onPause: () => void,
    private readonly portrait: PortraitFn,
  ) {
    const pause = el('button', 'kb-pause', 'II', {
      type: 'button',
      'aria-label': 'Pause',
    });
    pause.addEventListener('click', onPause);
    const top = el('div', 'kb-topcenter');
    top.append(this.timer, this.round);
    this.stock.append(this.tnt, this.blast);
    this.el.append(
      this.chips,
      top,
      this.stock,
      pause,
      this.banner,
      this.sub,
      this.hint,
    );
    root.append(this.el);
    this.hide();
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Build the player chips for a new match. */
  setPlayers(sim: KabooomSim): void {
    this.chips.replaceChildren();
    this.chipEls = sim.players.map((p) => {
      const root = el('div', 'kb-chip');
      root.style.setProperty(
        '--team',
        `#${TEAM_COLORS[p.color % TEAM_COLORS.length].toString(16).padStart(6, '0')}`,
      );
      const img = el('img', 'kb-chip-img', '', {
        src: this.portrait(p.critter, p.color),
        alt: title(p.critter),
      });
      const wins = el('div', 'kb-chip-wins');
      root.append(img, wins);
      if (p.id === 0) root.classList.add('you');
      root.title = p.id === 0 ? `${title(p.critter)} (you)` : title(p.critter);
      this.chips.append(root);
      return { root, wins };
    });
    this.last.chips = '';
  }

  /** Short hint at the bottom (controls), shown for `seconds`. */
  showHint(text: string, seconds: number): void {
    this.hint.textContent = text;
    this.hintUntil = performance.now() + seconds * 1000;
    this.hint.style.opacity = '1';
  }

  /** Refresh from the sim (call once per frame). */
  update(sim: KabooomSim, rounds: number): void {
    const timer = fmtTime(Math.max(0, ROUND_S - sim.time));
    if (timer !== this.last.timer) {
      this.last.timer = timer;
      this.timer.textContent = timer;
    }
    this.timer.classList.toggle('sudden', sim.suddenDeath);
    const round = rounds > 1 ? `Round ${sim.round + 1} / ${rounds}` : '';
    if (round !== this.last.round) {
      this.last.round = round;
      this.round.textContent = round;
      this.round.style.display = round ? '' : 'none';
    }
    const me = sim.players[0];
    const tnt = me ? `${me.tntLeft}/${me.maxTnt}` : '';
    if (tnt !== this.last.tnt) {
      this.bump(
        this.tnt,
        this.last.tnt !== '' && me !== undefined && me.maxTnt > this.maxSeen,
      );
      if (me) this.maxSeen = me.maxTnt;
      this.last.tnt = tnt;
      if (me) this.showTnt(me.tntLeft, me.maxTnt);
      this.tnt.classList.toggle('empty', !!me && me.tntLeft <= 0);
    }
    const level = me ? me.range - START_RANGE + 1 : 0;
    const blast = me ? String(level) : '';
    if (blast !== this.last.blast) {
      this.bump(
        this.blast,
        this.last.blast !== '' && me !== undefined && me.range > this.rangeSeen,
      );
      if (me) this.rangeSeen = me.range;
      this.last.blast = blast;
      if (me) this.showBlast(level);
    }
    const state = sim.players.map((p) => `${p.state}${p.wins}`).join(',');
    if (state !== this.last.chips) {
      this.last.chips = state;
      sim.players.forEach((p, i) => {
        const c = this.chipEls[i];
        if (!c) return;
        c.root.classList.toggle('out', p.state === 'ko');
        c.wins.textContent = p.wins > 0 ? '★'.repeat(Math.min(5, p.wins)) : '';
      });
    }
    if (this.hintUntil && performance.now() > this.hintUntil) {
      this.hintUntil = 0;
      this.hint.style.opacity = '0';
    }
  }

  /** The big centre text (countdown number, "GO!", round result); '' hides it. `kind` colours it. */
  setBanner(
    text: string,
    sub = '',
    kind: '' | 'go' | 'win' | 'lose' | 'warn' = '',
  ): void {
    const key = `${kind}|${text}`;
    if (key !== this.last.banner) {
      this.last.banner = key;
      this.banner.textContent = text;
      this.banner.className = `kb-banner ${kind}${text ? ' show' : ''}`;
      // restart the pop animation for a new text
      void this.banner.offsetWidth;
    }
    if (sub !== this.last.sub) {
      this.last.sub = sub;
      this.sub.textContent = sub;
      this.sub.style.display = sub ? '' : 'none';
    }
  }

  private maxSeen = 1;
  private rangeSeen = 2;

  /** Pop a pill when a power-up made it grow. */
  private bump(pill: HTMLElement, grew: boolean): void {
    if (!grew) return;
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }

  /** TNT stock: one stick per TNT you can hold, the ready ones lit. */
  private showTnt(left: number, max: number): void {
    let html = '';
    for (let i = 0; i < max; i++) html += stickIcon(i < left);
    this.tnt.innerHTML = html;
    const label = `TNT: ${left} of ${max} ready`;
    this.tnt.setAttribute('aria-label', label);
    this.tnt.title = label;
  }

  /** Blast level 1-5 as a bundle of that many sticks. */
  private showBlast(level: number): void {
    this.blast.innerHTML = bundleIcon(level);
    const label = `Blast level ${level} of ${MAX_BLAST_LEVEL}${level >= CORNER_LEVEL ? ': turns corners' : ''}`;
    this.blast.setAttribute('aria-label', label);
    this.blast.title = label;
  }

  /** Reset the TNT stock and the blast level for the default stock (round start). */
  resetTnt(): void {
    this.last.tnt = '';
    this.showTnt(START_TNT, START_TNT);
    this.showBlast(1);
    this.last.blast = '';
    this.maxSeen = START_TNT;
    this.rangeSeen = START_RANGE;
  }
}
