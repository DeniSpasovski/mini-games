import { el, fmtTime } from './dom';
import { ITEM_LEVELS, maxEdibleSize } from '../sim/progression';

/** In-run HUD: timer, score, level badge + progress ring, pause button, pop-ups, banners. */
export class Hud {
  readonly el = el('div', 'hg-hud');
  private timer = el('div', 'hg-pill hg-timer', '0:00');
  private topLeft = el('div', 'hg-topleft');
  private score = el('div', 'hg-pill hg-score');
  private done = el('div', 'hg-pill hg-done');
  private doneLabel!: HTMLElement;
  private doneNum = el('span', '', '0%');
  private doneBar = el('i');
  private scoreNum = el('span', '', '0');
  private badge = el('div', 'hg-badge');
  private badgeNum = el('b', '', '1');
  private eats = el('div', 'hg-eats');
  private popups = 0;
  private lastLevel = 0;
  private lastScore = -1;
  private lastDone = -1;
  private lastTime = '';
  private lastProgress = '';

  constructor(
    private root: HTMLElement,
    onPause: () => void,
  ) {
    const small = el('small', '', 'SCORE ');
    this.score.append(small, this.scoreNum);
    this.badge.append(this.badgeNum);
    const level = el('div', 'hg-level');
    level.append(this.badge, this.eats);
    const pause = el('button', 'hg-pause', 'II', {
      type: 'button',
      'aria-label': 'Pause',
    });
    pause.addEventListener('click', onPause);
    // island completion next to the score: percent of the map's points eaten
    const bar = el('div', 'hg-donebar');
    bar.append(this.doneBar);
    this.doneLabel = el('small', '', 'ISLAND ');
    this.done.append(this.doneLabel, this.doneNum, bar);
    this.topLeft.append(this.score, this.done);
    this.el.append(this.timer, this.topLeft, level, pause);
    root.append(this.el);
  }

  /** What a fully eaten map is called ('island', 'store'). */
  setNoun(noun: string): void {
    this.doneLabel.textContent = `${noun.toUpperCase()} `;
  }

  show(on: boolean): void {
    this.el.classList.toggle('on', on);
  }

  update(
    timeLeft: number,
    score: number,
    level: number,
    progress: number,
    islandDone = 0,
  ): void {
    const t = fmtTime(timeLeft);
    if (t !== this.lastTime) {
      this.timer.textContent = t;
      this.timer.classList.toggle('low', timeLeft <= 10);
      this.lastTime = t;
    }
    if (score !== this.lastScore) {
      this.scoreNum.textContent = String(score);
      this.lastScore = score;
    }
    const pct = Math.floor(islandDone * 100);
    if (pct !== this.lastDone) {
      this.doneNum.textContent = `${pct}%`;
      this.doneBar.style.width = `${Math.min(100, islandDone * 100).toFixed(1)}%`;
      this.lastDone = pct;
    }
    const p = progress.toFixed(3);
    if (p !== this.lastProgress) {
      this.badge.style.setProperty('--p', p);
      this.lastProgress = p;
    }
    if (level !== this.lastLevel) {
      this.badgeNum.textContent = String(level);
      this.eats.textContent =
        level > ITEM_LEVELS
          ? `Lv ${level} · eats everything`
          : `Lv ${level} · eats up to ${maxEdibleSize(level).toFixed(1)} m`;
      if (this.lastLevel) {
        this.badge.classList.remove('bump');
        void this.badge.offsetWidth;
        this.badge.classList.add('bump');
      }
      this.lastLevel = level;
    }
  }

  /** Reset cached values (new run). */
  reset(): void {
    this.lastLevel = 0;
    this.lastScore = -1;
    this.lastDone = -1;
    this.lastTime = '';
    this.lastProgress = '';
  }

  /** Floating "+N" at a screen position. */
  popup(x: number, y: number, text: string, color = '#fff'): void {
    if (this.popups > 40) return;
    const p = el('div', 'hg-pop', text);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.color = color;
    this.popups++;
    this.root.append(p);
    p.addEventListener('animationend', () => {
      p.remove();
      this.popups--;
    });
  }

  /** Big centre banner; `kind` (a map id) picks the colour (store pink, Animal Island green, City gold). */
  banner(text: string, kind = ''): void {
    const b = el(
      'div',
      'hg-banner' +
        (kind === 'toy' || kind === 'animal' || kind === 'construction'
          ? ` ${kind}`
          : ''),
      text,
    );
    this.el.append(b);
    b.addEventListener('animationend', () => b.remove());
  }

  /** Big countdown digit; pass null to clear. */
  count(text: string | null): void {
    this.root.querySelector('.hg-count')?.remove();
    if (!text) return;
    const c = el('div', 'hg-count');
    c.append(el('span', '', text));
    this.root.append(c);
  }
}
