import './hud.css';
import { CUT_GRACE, formatDelta, formatTime, type StageTimer } from './stage';

/**
 * DOM HUD (cheap, crisp text, no extra draw calls). Updated every frame but
 * only touches the DOM when a value actually changes.
 */
export interface HudState {
  speedKmh: number;
  rpm: number;
  redline: number;
  gear: number;
  automatic: boolean;
  tc: boolean;
  tcActive: boolean;
  /** Auto handbrake / start-line hold engaged. */
  hold: boolean;
}

export class Hud {
  readonly el: HTMLDivElement;
  private refs: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private messageTimer = 0;
  private rpmBars: HTMLElement[] = [];
  private sectors: { el: HTMLElement; fill: HTMLElement }[] = [];

  /** `testNotes`: one line per test-only map / car (dev server only, see release.ts). */
  constructor(parent: HTMLElement, title: string, testNotes: string[] = []) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-title">${title}</div>
        ${testNotes.map((n) => `<div class="hud-test">${n}</div>`).join('')}
        <div class="hud-progress" data-ref="progress"></div>
        <div class="hud-dist" data-ref="dist"></div>
      </div>
      <div class="hud-top">
        <div class="hud-time" data-ref="time">0:00.00</div>
        <div class="hud-splits" data-ref="splits"></div>
      </div>
      <div class="hud-center" data-ref="message"></div>
      <div class="hud-warn" data-ref="warn"></div>
      <div class="hud-dash">
        <div class="hud-rpm" data-ref="rpm"></div>
        <div class="hud-row">
          <div class="hud-gear" data-ref="gear">1</div>
          <div class="hud-speed"><span data-ref="speed">0</span><small>km/h</small></div>
        </div>
        <div class="hud-flags"><span data-ref="hold">HOLD</span><span data-ref="tc">TC</span><span data-ref="box">AUTO</span></div>
      </div>
      <div class="hud-hints" data-ref="hints">
        <b>W/S</b> throttle / brake·reverse &nbsp; <b>A/D</b> steer &nbsp; <b>Space</b> handbrake<br/>
        <b>R</b> reset &nbsp; <b>C</b> camera &nbsp; <b>Esc</b> menu &nbsp; <b>Q/E</b> shift (<b>G</b> manual) &nbsp;
        <b>T</b> traction ctrl &nbsp; <b>M</b> mute &nbsp; <b>F2</b> telemetry &nbsp; <b>F3</b> stats &nbsp; <b>F4</b> physics &nbsp; <b>F8</b> autopilot
      </div>`;
    parent.append(this.el);
    this.el
      .querySelectorAll<HTMLElement>('[data-ref]')
      .forEach((e) => (this.refs[e.dataset.ref!] = e));
    for (let i = 0; i < 24; i++) {
      const b = document.createElement('i');
      this.refs.rpm.append(b);
      this.rpmBars.push(b);
    }
    setTimeout(() => this.refs.hints.classList.add('fade'), 12000);
  }

  private set(ref: string, text: string): void {
    if (this.cache[ref] === text) return;
    this.cache[ref] = text;
    this.refs[ref].textContent = text;
  }

  message(text: string, seconds = 2, cls = ''): void {
    const el = this.refs.message;
    el.textContent = text;
    el.className = `hud-center show ${cls}`;
    this.messageTimer = seconds;
  }

  update(dt: number, s: HudState, stage: StageTimer): void {
    this.set('speed', String(Math.round(Math.abs(s.speedKmh))));
    this.set('gear', s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : String(s.gear));
    this.set('box', s.automatic ? 'AUTO' : 'MAN');
    this.refs.hold.className = s.hold ? 'on active' : '';
    this.refs.tc.className = s.tc ? (s.tcActive ? 'on active' : 'on') : '';
    const lit = Math.round((s.rpm / (s.redline * 1.05)) * this.rpmBars.length);
    const key = `rpm${lit}`;
    if (this.cache.rpmBars !== key) {
      this.cache.rpmBars = key;
      this.rpmBars.forEach((b, i) => {
        b.className =
          i < lit ? (i >= this.rpmBars.length * 0.82 ? 'red' : 'on') : '';
      });
    }
    this.set('time', formatTime(stage.time));
    this.updateSectors(stage);
    const splits = stage.splitTimes
      .map((t, i) => {
        const b = stage.reference?.splits[i];
        return `S${i + 1} ${formatTime(t)}${b !== undefined ? ` (${formatDelta(t - b)})` : ''}`;
      })
      .join('   ');
    this.set('splits', splits);
    const cut = stage.cutWarning && stage.phase === 'running';
    this.set(
      'warn',
      cut
        ? `${stage.shortcut ? 'SHORTCUT' : 'OFF STAGE'} — return to the road${
            stage.returning
              ? ''
              : `  ${Math.ceil(Math.max(0, CUT_GRACE - stage.cutTimer))}`
          }`
        : stage.wrongWay
          ? 'WRONG WAY'
          : '',
    );
    this.refs.warn.classList.toggle('cut', cut);
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.refs.message.classList.remove('show');
    }
  }

  /**
   * Progress bar split into sectors (start / splits / finish). Finished sectors
   * turn green when faster than the reference best, red when slower.
   */
  private updateSectors(stage: StageTimer): void {
    const b = stage.sectorBounds;
    if (this.sectors.length !== b.length - 1) {
      this.refs.progress.replaceChildren();
      this.sectors = [];
      for (let i = 0; i < b.length - 1; i++) {
        const el = document.createElement('div');
        el.className = 'sector';
        el.style.flexGrow = String(b[i + 1] - b[i]);
        const fill = document.createElement('div');
        el.append(fill);
        this.refs.progress.append(el);
        this.sectors.push({ el, fill });
      }
    }
    const times = stage.sectorTimes();
    const ref = stage.referenceSectorTimes();
    this.sectors.forEach((s, i) => {
      const f = Math.min(
        1,
        Math.max(0, (stage.progress - b[i]) / (b[i + 1] - b[i])),
      );
      const w = `${(f * 100).toFixed(1)}%`;
      if (s.fill.style.width !== w) s.fill.style.width = w;
      const done = i < times.length;
      const cls = !done
        ? 'sector'
        : !ref
          ? 'sector done'
          : times[i] <= ref[i]
            ? 'sector good'
            : 'sector bad';
      if (s.el.className !== cls) {
        s.el.className = cls;
        s.el.title = done && ref ? formatDelta(times[i] - ref[i]) : '';
      }
    });
  }

  setDistance(text: string): void {
    this.set('dist', text);
  }
}
