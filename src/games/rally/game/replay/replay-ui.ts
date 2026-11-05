/**
 * The replay bar (STYLEGUIDE.md "Replay"): a glass transport slab along the bottom - timeline with start / split /
 * finish marks, play / skip, speed, camera, clean feed, export (a section as a video file), exit - plus a camera
 * plate top right. Keyboard, pad (focus moves over the buttons; LB / RB camera, X play, Y clean feed) and touch (the
 * timeline scrubs). DOM updates only on change, a few times a second at most.
 */
import './replay.css';
import type { RallyGame } from '../rally-game';
import { formatTime } from '../stage';
import { REPLAY_CAMS, type ReplayCamId } from './replay-cameras';
import { SPEEDS, type ReplaySession } from './session';
import {
  DEFAULT_EXPORT_SIZE,
  EXPORT_FPS,
  EXPORT_SIZES,
  downloadVideo,
  exportSupported,
  type ExportSize,
} from './export';
import { nameForm } from './manage-ui';
import { cleanName, renameReplay, replayId } from './store';

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l6 6-6 6M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Seconds a skip button / arrow key moves. */
const SKIP = 5;

export class ReplayUi {
  readonly el: HTMLDivElement;
  private refs: Record<string, HTMLElement> = {};
  private cache: Record<string, string> = {};
  private session?: ReplaySession;
  private raf = 0;
  private lastUi = 0;
  /** Export panel open: the section (replay s) shown on the timeline; `running` while it renders. */
  private exp?: {
    from: number;
    to: number;
    size: ExportSize;
    pop: HTMLElement;
    running?: AbortController;
  };
  /** Resolution picked last (kept for the next export of this page). */
  private exportSize: ExportSize = DEFAULT_EXPORT_SIZE;
  private dragging = false;
  private padPrev: boolean[] = [];
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private root: HTMLElement,
    private game: RallyGame,
    private opts: {
      onExit: () => void;
      exitLabel: string;
      /** False for a replay opened from the menu (already saved, renamed in Stage times): no Save button. */
      canSave: boolean;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'replay-ui hidden';
    const cams = REPLAY_CAMS.map(
      (c, i) =>
        `<button data-cam="${c.id}" title="${i + 1}">${c.label}</button>`,
    ).join('');
    this.el.innerHTML = `
      <div class="rp-plate"><span class="rp-tag">Replay</span><span data-ref="cam"></span></div>
      <div class="rp-bar" data-ref="bar">
        <div class="rp-timeline">
          <span class="rp-time" data-ref="time">0:00.00</span>
          <div class="rp-track" data-ref="track" role="slider" tabindex="0" aria-label="Replay position" aria-valuemin="0">
            <div class="rp-rail"><div class="rp-fill" data-ref="fill"></div></div>
            <div data-ref="marks"></div>
            <div class="rp-sel" data-ref="sel" hidden><i class="rp-sel-h" data-h="from"></i><i class="rp-sel-h" data-h="to"></i></div>
            <div class="rp-head" data-ref="head"></div>
          </div>
          <span class="rp-time total" data-ref="total"></span>
        </div>
        <div class="rp-controls">
          <div class="rp-transport">
            <button class="rp-btn" data-a="back" aria-label="Back ${SKIP} seconds">${ICON.back}</button>
            <button class="rp-btn play" data-a="play" data-primary aria-label="Play / pause" data-ref="play">${ICON.pause}</button>
            <button class="rp-btn" data-a="fwd" aria-label="Forward ${SKIP} seconds">${ICON.fwd}</button>
          </div>
          <div class="menu-seg rp-speed" data-ref="speed">${SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}</div>
          <div class="menu-seg rp-cams" data-ref="cams">${cams}</div>
          <label class="rp-cam-pick menu-select"><select data-ref="camSelect" aria-label="Camera">${REPLAY_CAMS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
          <div class="rp-actions">
            <button class="menu-btn small" data-a="name" data-ref="save" title="Name this replay: a named save is never deleted with the auto saves">Save</button>
            <button class="menu-btn small" data-a="clean">Clean feed</button>
            ${exportSupported() ? `<button class="menu-btn small rp-export" data-a="export" data-ref="export" title="Save a section of this replay as a video file">${ICON.export}<span>Export</span></button>` : ''}
            <button class="menu-btn small primary" data-a="exit">${opts.exitLabel}</button>
          </div>
        </div>
        <div class="rp-keys"><b>Space</b> play · <b>← →</b> ${SKIP} s · <b>, .</b> frame · <b>[ ]</b> speed · <b>1–7</b> camera · <b>C</b> next camera · <b>H</b> clean feed${exportSupported() ? ' · <b>V</b> export' : ''} · <b>Esc</b> exit</div>
      </div>
      <div class="rp-clean-hint" data-ref="hint">Clean feed · <b>H</b> or tap to show the controls</div>`;
    if (!opts.canSave) this.el.querySelector('[data-a="name"]')?.remove();
    root.append(this.el);
    this.el
      .querySelectorAll<HTMLElement>('[data-ref]')
      .forEach((e) => (this.refs[e.dataset.ref!] = e));
    this.el.addEventListener('click', (e) => this.click(e));
    this.refs.camSelect.addEventListener('change', () =>
      this.setCam(
        (this.refs.camSelect as HTMLSelectElement).value as ReplayCamId,
      ),
    );
    this.bindTrack();
    // Clean feed: a tap anywhere brings the controls back.
    this.el.addEventListener('pointerdown', (e) => {
      if (this.session?.clean && e.target === this.refs.hint)
        this.setClean(false);
    });
  }

  get open(): boolean {
    return !!this.session;
  }

  /** The box the page's pad navigation moves focus in. */
  get box(): HTMLElement {
    return this.refs.bar;
  }

  show(session: ReplaySession): void {
    this.session = session;
    this.cache = {};
    this.markSaved(false);
    this.el.classList.remove('hidden', 'clean');
    this.root.classList.add('replaying');
    this.buildMarks();
    this.refs.total.textContent =
      session.track.header.time !== undefined
        ? formatTime(session.track.header.time)
        : formatTime(session.track.duration);
    window.addEventListener('keydown', this.onKey, true);
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      if (!this.session) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
    this.refs.play.focus({ preventScroll: true });
  }

  hide(): void {
    this.closeExport();
    this.session = undefined;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.el.classList.add('hidden');
    this.root.classList.remove('replaying');
  }

  private buildMarks(): void {
    const s = this.session!;
    const t = s.track;
    const d = Math.max(1e-3, t.duration);
    const mark = (at: number, cls: string, label: string) =>
      `<i class="rp-mark ${cls}" style="left:${((100 * at) / d).toFixed(2)}%"><b>${label}</b></i>`;
    const free = t.header.free;
    this.refs.marks.className = 'rp-marks';
    this.refs.marks.innerHTML = free
      ? ''
      : [
          mark(t.goTime, 'go', 'Start'),
          ...t.splitAt.map((a, i) => mark(a, 'split', `S${i + 1}`)),
          ...(t.header.time !== undefined
            ? [mark(t.finishTime, 'finish', 'Finish')]
            : []),
        ].join('');
  }

  private set(ref: string, text: string): void {
    if (this.cache[ref] === text) return;
    this.cache[ref] = text;
    this.refs[ref].textContent = text;
  }

  private tick(now: number): void {
    const s = this.session!;
    this.pollPad();
    // The playhead every frame (a transform), the text 10 times a second.
    const f = s.duration ? s.time / s.duration : 0;
    const pct = `${(f * 100).toFixed(2)}%`;
    if (this.cache.head !== pct) {
      this.cache.head = pct;
      this.refs.head.style.left = pct;
      this.refs.fill.style.width = pct;
    }
    if (now - this.lastUi < 100) return;
    this.lastUi = now;
    const c = s.clock;
    this.set('time', s.time < s.track.goTime ? '0:00.00' : formatTime(c.time));
    this.refs.track.setAttribute('aria-valuenow', s.time.toFixed(1));
    this.refs.track.setAttribute('aria-valuemax', s.duration.toFixed(1));
    const playKey = s.playing ? 'pause' : 'play';
    if (this.cache.playKey !== playKey) {
      this.cache.playKey = playKey;
      this.refs.play.innerHTML = s.playing ? ICON.pause : ICON.play;
      this.refs.play.classList.toggle('paused', !s.playing);
    }
    this.set('cam', s.director.label);
    const camKey = s.director.mode;
    if (this.cache.camKey !== camKey) {
      this.cache.camKey = camKey;
      this.refs.cams
        .querySelectorAll<HTMLElement>('button')
        .forEach((b) => b.classList.toggle('on', b.dataset.cam === camKey));
      (this.refs.camSelect as HTMLSelectElement).value = camKey;
    }
    const speedKey = String(s.speed);
    if (this.cache.speedKey !== speedKey) {
      this.cache.speedKey = speedKey;
      this.refs.speed
        .querySelectorAll<HTMLElement>('button')
        .forEach((b) => b.classList.toggle('on', b.dataset.speed === speedKey));
    }
  }

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn || !this.session) return;
    const s = this.session;
    if (btn.dataset.speed) s.speed = Number(btn.dataset.speed);
    if (btn.dataset.cam) this.setCam(btn.dataset.cam as ReplayCamId);
    switch (btn.dataset.a) {
      case 'play':
        s.togglePlay();
        break;
      case 'back':
        s.seek(s.time - SKIP);
        break;
      case 'fwd':
        s.seek(s.time + SKIP);
        break;
      case 'name':
        this.openName(btn);
        break;
      case 'clean':
        this.setClean(true);
        break;
      case 'export':
        if (this.exp) this.closeExport();
        else this.openExport();
        break;
      case 'exit':
        this.opts.onExit();
        break;
    }
  }

  /** "Save": name this replay (a named save) in a field over the bar; it must be a saved one (the store has it). */
  private openName(btn: HTMLElement): void {
    const s = this.session;
    if (!s || this.el.querySelector('.rp-name-pop')) return;
    const id = replayId(s.track.header);
    const close = () => {
      pop.remove();
      btn.focus({ preventScroll: true });
    };
    const pop = nameForm(
      '',
      async (raw) => {
        const ok = await renameReplay(id, raw);
        const name = cleanName(raw);
        this.game.hud.message(
          !ok
            ? 'NOT SAVED ON THIS DEVICE'
            : name
              ? 'REPLAY SAVED'
              : 'AUTO SAVE',
          1.6,
          ok ? 'small' : 'small bad',
        );
        close();
        if (ok && name) {
          this.markSaved(true);
          this.refs.play.focus({ preventScroll: true });
        }
      },
      close,
    );
    pop.classList.add('rp-name-pop');
    this.refs.bar.append(pop);
  }

  /** A named save: the button says "Saved" and goes inactive (a second save has nothing to add); off again for each replay. */
  private markSaved(on: boolean): void {
    const b = this.refs.save as HTMLButtonElement | undefined;
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? 'Saved' : 'Save';
  }

  private setCam(id: ReplayCamId): void {
    this.session?.director.setMode(id);
  }

  private stepCam(dir: number): void {
    const s = this.session!;
    const i = REPLAY_CAMS.findIndex((c) => c.id === s.director.mode);
    this.setCam(
      REPLAY_CAMS[(i + dir + REPLAY_CAMS.length) % REPLAY_CAMS.length].id,
    );
  }

  private stepSpeed(dir: number): void {
    const s = this.session!;
    const i = SPEEDS.indexOf(s.speed);
    s.speed =
      SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + dir))];
  }

  setClean(on: boolean): void {
    const s = this.session;
    if (!s) return;
    s.clean = on;
    this.el.classList.toggle('clean', on);
    this.game.hud.el.classList.toggle('clean', on);
    if (!on) this.refs.play.focus({ preventScroll: true });
  }

  /** Export panel over the bar: the section (handles on the timeline, I / O at the playhead), resolution, Export. */
  private openExport(): void {
    const s = this.session;
    if (!s || this.exp) return;
    const t = s.track;
    // Default: from the run-up to GO to a few seconds past the finish (the car braking).
    const from = Math.max(0, t.goTime - 1.5);
    const to =
      t.header.time !== undefined
        ? Math.min(s.duration, t.finishTime + 3)
        : s.duration;
    const pop = document.createElement('div');
    pop.className = 'rp-export-pop';
    pop.innerHTML = `
      <div class="rp-ex-title">Export video</div>
      <div class="rp-ex-row"><span class="rp-ex-label">Section</span><b class="rp-ex-len" data-x="len"></b>
        <span class="rp-ex-btns"><button data-x="from" title="I">Start here</button><button data-x="to" title="O">End here</button><button data-x="all">Whole replay</button></span></div>
      <div class="rp-ex-row"><span class="rp-ex-label">Resolution</span>
        <div class="menu-seg rp-ex-size">${EXPORT_SIZES.map((z) => `<button data-size="${z.id}">${z.label}</button>`).join('')}</div></div>
      <div class="rp-ex-note">${EXPORT_FPS} fps MP4 with sound, from the camera picked on the bar. Drag the handles on the timeline to pick the section.</div>
      <div class="rp-ex-progress" hidden><div class="rp-ex-bar"><i></i></div><span class="rp-ex-status"></span></div>
      <div class="rp-ex-actions"><button class="primary" data-x="go">Export</button><button data-x="cancel">Cancel</button></div>`;
    pop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b || !this.exp) return;
      e.stopPropagation();
      const sz = EXPORT_SIZES.find((z) => z.id === b.dataset.size);
      if (sz && !this.exp.running) {
        this.exp.size = this.exportSize = sz;
        this.drawExport();
      }
      switch (b.dataset.x) {
        case 'from':
        case 'to':
          this.setSection(b.dataset.x, s.time);
          break;
        case 'all':
          this.exp.from = 0;
          this.exp.to = s.duration;
          this.drawExport();
          break;
        case 'go':
          void this.runExport();
          break;
        case 'cancel':
          this.closeExport();
          break;
      }
    });
    this.refs.bar.append(pop);
    this.exp = { from, to, size: this.exportSize, pop };
    this.refs.sel.hidden = false;
    this.refs.export?.classList.add('on');
    this.drawExport();
    pop
      .querySelector<HTMLElement>('[data-x="go"]')!
      .focus({ preventScroll: true });
  }

  /** Move one end of the section (the other end is kept at least a frame away). */
  private setSection(end: 'from' | 'to', t: number): void {
    const x = this.exp;
    const s = this.session;
    if (!x || !s || x.running) return;
    const min = 1 / EXPORT_FPS;
    if (end === 'from') x.from = Math.max(0, Math.min(t, x.to - min));
    else x.to = Math.min(s.duration, Math.max(t, x.from + min));
    this.drawExport();
  }

  private drawExport(): void {
    const x = this.exp;
    const s = this.session;
    if (!x || !s) return;
    const d = Math.max(1e-3, s.duration);
    const sel = this.refs.sel;
    sel.style.left = `${((100 * x.from) / d).toFixed(3)}%`;
    sel.style.width = `${((100 * (x.to - x.from)) / d).toFixed(3)}%`;
    const len = x.to - x.from;
    x.pop.querySelector('[data-x="len"]')!.textContent =
      `${formatTime(len).replace(/^0:/, '')} s`;
    x.pop
      .querySelectorAll<HTMLElement>('[data-size]')
      .forEach((b) => b.classList.toggle('on', b.dataset.size === x.size.id));
  }

  private closeExport(): void {
    const x = this.exp;
    if (!x) return;
    // Rendering: cancel it; the panel closes when it has stopped.
    if (x.running) return x.running.abort();
    x.pop.remove();
    this.exp = undefined;
    this.refs.sel.hidden = true;
    this.refs.export?.classList.remove('on');
    this.el.classList.remove('exporting');
    this.refs.export?.focus({ preventScroll: true });
  }

  private async runExport(): Promise<void> {
    const x = this.exp;
    const s = this.session;
    if (!x || !s || x.running) return;
    const ac = new AbortController();
    x.running = ac;
    this.el.classList.add('exporting');
    const prog = x.pop.querySelector<HTMLElement>('.rp-ex-progress')!;
    const bar = prog.querySelector<HTMLElement>('i')!;
    const status = prog.querySelector<HTMLElement>('.rp-ex-status')!;
    prog.hidden = false;
    const go = x.pop.querySelector<HTMLButtonElement>('[data-x="go"]')!;
    go.disabled = true;
    const frames = Math.round((x.to - x.from) * EXPORT_FPS);
    const t0 = performance.now();
    status.textContent = 'Starting…';
    let msg = '';
    let bad = false;
    try {
      const h = s.track.header;
      const blob = await this.game.exportReplay({
        from: x.from,
        to: x.to,
        size: x.size,
        signal: ac.signal,
        onProgress: (f) => {
          bar.style.width = `${(f * 100).toFixed(1)}%`;
          const left = ((performance.now() - t0) / 1000) * (1 / f - 1);
          status.textContent =
            f < 1
              ? `Frame ${Math.round(f * frames)} / ${frames} · about ${formatTime(left).replace(/\.\d+$/, '')} left`
              : 'Sound and file…';
        },
      });
      if (blob) {
        downloadVideo(
          blob,
          `rally-${h.stage}-${h.car}-${new Date(h.date).toISOString().slice(0, 10)}-${x.size.id}`,
        );
        msg = `VIDEO SAVED · ${(blob.size / 1e6).toFixed(1)} MB`;
      } else if (!ac.signal.aborted) {
        msg = 'THIS BROWSER CAN NOT ENCODE THAT SIZE';
        bad = true;
      }
    } catch (e) {
      console.warn('replay export failed', e);
      msg = 'EXPORT FAILED';
      bad = true;
    }
    x.running = undefined;
    this.closeExport();
    if (msg) this.game.hud.message(msg, 2.5, bad ? 'small bad' : 'small');
  }

  private key(e: KeyboardEvent): void {
    const s = this.session;
    if (
      !s ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLInputElement
    )
      return;
    if (this.exp?.running) {
      // Rendering: the replay is the export's; Esc cancels, nothing else.
      if (e.code === 'Escape') this.closeExport();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    let used = true;
    switch (e.code) {
      case 'Space':
      case 'KeyK':
        // A focused button would also fire on Space: the key does it once.
        s.togglePlay();
        break;
      case 'ArrowLeft':
      case 'KeyJ':
        s.seek(s.time - (e.shiftKey ? 1 : SKIP));
        break;
      case 'ArrowRight':
      case 'KeyL':
        s.seek(s.time + (e.shiftKey ? 1 : SKIP));
        break;
      case 'Comma':
        s.playing = false;
        s.seek(s.time - 1 / s.track.rate);
        break;
      case 'Period':
        s.playing = false;
        s.seek(s.time + 1 / s.track.rate);
        break;
      case 'BracketLeft':
        this.stepSpeed(-1);
        break;
      case 'BracketRight':
        this.stepSpeed(1);
        break;
      case 'Home':
        s.seek(Math.max(0, s.track.goTime - 1.5));
        break;
      case 'End':
        s.seek(s.track.finishTime);
        break;
      case 'KeyC':
        this.stepCam(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        this.setClean(!s.clean);
        break;
      case 'KeyV':
        if (!exportSupported()) used = false;
        else if (this.exp) this.closeExport();
        else this.openExport();
        break;
      case 'KeyI':
        if (this.exp) this.setSection('from', s.time);
        else used = false;
        break;
      case 'KeyO':
        if (this.exp) this.setSection('to', s.time);
        else used = false;
        break;
      case 'Escape':
        if (this.exp) this.closeExport();
        else if (s.clean) this.setClean(false);
        else this.opts.onExit();
        break;
      default: {
        const n = /^Digit([1-7])$/.exec(e.code);
        if (n) this.setCam(REPLAY_CAMS[Number(n[1]) - 1].id);
        else used = false;
      }
    }
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** LB / RB camera, X play, Y clean feed (A / B / d-pad go through the page's menu navigation). */
  private pollPad(): void {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(
      (p) => p?.connected,
    );
    if (!pad) return;
    const edge = (i: number) => !!pad.buttons[i]?.pressed && !this.padPrev[i];
    if (edge(4)) this.stepCam(-1);
    if (edge(5)) this.stepCam(1);
    if (edge(2)) this.session!.togglePlay();
    if (edge(3)) this.setClean(!this.session!.clean);
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }

  private bindTrack(): void {
    const track = this.refs.track;
    const seekAt = (x: number) => {
      const s = this.session;
      if (!s) return;
      const r = track.getBoundingClientRect();
      s.seek(((x - r.left) / Math.max(1, r.width)) * s.duration);
    };
    // Export section handles: drag one end (the playhead follows it, showing that frame).
    let handle: 'from' | 'to' | null = null;
    const timeAt = (x: number) => {
      const r = track.getBoundingClientRect();
      return (
        ((x - r.left) / Math.max(1, r.width)) * (this.session?.duration ?? 0)
      );
    };
    this.refs.sel.addEventListener('pointerdown', (e) => {
      const h = (e.target as HTMLElement).dataset.h;
      if ((h !== 'from' && h !== 'to') || this.exp?.running) return;
      e.stopPropagation();
      handle = h;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    });
    this.refs.sel.addEventListener('pointermove', (e) => {
      if (!handle) return;
      this.setSection(handle, timeAt(e.clientX));
      this.session?.seek(timeAt(e.clientX));
    });
    const drop = () => (handle = null);
    this.refs.sel.addEventListener('pointerup', drop);
    this.refs.sel.addEventListener('pointercancel', drop);
    track.addEventListener('pointerdown', (e) => {
      if (this.exp?.running) return;
      this.dragging = true;
      track.setPointerCapture(e.pointerId);
      seekAt(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (this.dragging) seekAt(e.clientX);
    });
    const end = () => (this.dragging = false);
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('keydown', (e) => {
      // Arrows on the focused slider are the window's seek keys; Home / End too.
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
    });
  }
}
