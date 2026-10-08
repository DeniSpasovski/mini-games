import { TEAM_COLORS } from '../render/characters';
import { ROUND_S, START_TNT } from '../sim/rules';
import type { CritterId, KaboomSim } from '../sim/types';
import { el, fmtTime, title } from './dom';

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
  private readonly tnt = el('div', 'kb-pill kb-tntleft');
  private readonly banner = el('div', 'kb-banner');
  private readonly sub = el('div', 'kb-sub');
  private readonly hint = el('div', 'kb-hint');
  private chipEls: { root: HTMLElement; wins: HTMLElement }[] = [];
  private last = {
    timer: '',
    round: '',
    tnt: '',
    banner: '',
    sub: '',
    chips: '',
  };
  private hintUntil = 0;

  constructor(
    root: HTMLElement,
    onPause: () => void,
    private readonly portraits: Record<CritterId, string>,
  ) {
    const pause = el('button', 'kb-pause', 'II', {
      type: 'button',
      'aria-label': 'Pause',
    });
    pause.addEventListener('click', onPause);
    const top = el('div', 'kb-topcenter');
    top.append(this.timer, this.round);
    this.el.append(
      this.chips,
      top,
      this.tnt,
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
  setPlayers(sim: KaboomSim): void {
    this.chips.replaceChildren();
    this.chipEls = sim.players.map((p) => {
      const root = el('div', 'kb-chip');
      root.style.setProperty(
        '--team',
        `#${TEAM_COLORS[p.id % TEAM_COLORS.length].toString(16).padStart(6, '0')}`,
      );
      const img = el('img', 'kb-chip-img', '', {
        src: this.portraits[p.critter],
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
  update(sim: KaboomSim, rounds: number): void {
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
    const tnt = me ? `TNT ${me.tntLeft}` : '';
    if (tnt !== this.last.tnt) {
      this.last.tnt = tnt;
      this.tnt.textContent = tnt;
      this.tnt.classList.toggle('empty', !!me && me.tntLeft <= 0);
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

  /** Reset the "you have this many TNT" pill for the default stock (round start). */
  resetTnt(): void {
    this.last.tnt = '';
    this.tnt.textContent = `TNT ${START_TNT}`;
  }
}
