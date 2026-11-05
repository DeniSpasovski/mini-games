/**
 * The replay bar (STYLEGUIDE.md "Replay"): a glass transport slab along the bottom - timeline with start / split /
 * finish marks, play / skip, speed, camera, clean feed, video, exit - plus a camera plate top right. Keyboard,
 * pad (focus moves over the buttons; LB / RB camera, X play, Y clean feed) and touch (the timeline scrubs). DOM
 * updates only on change, a few times a second at most.
 */
import './replay.css';
import type { RallyGame } from '../rally-game';
import { formatTime } from '../stage';
import { REPLAY_CAMS, type ReplayCamId } from './replay-cameras';
import { SPEEDS, type ReplaySession } from './session';
import { ReplayVideo, videoSupported } from './video';
import { nameForm } from './manage-ui';
import { cleanName, renameReplay, replayId } from './store';

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l6 6-6 6M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
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
  private video?: ReplayVideo;
  private dragging = false;
  private orbitDrag: { x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private root: HTMLElement,
    private game: RallyGame,
    private opts: { onExit: () => void; exitLabel: string },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'replay-ui hidden';
    const cams = REPLAY_CAMS.map(
      (c, i) =>
        `<button data-cam="${c.id}" title="${i + 1}">${c.label}</button>`,
    ).join('');
    this.el.innerHTML = `
      <div class="rp-plate"><span class="rp-tag">Replay</span><span data-ref="cam"></span><span class="rp-recording" data-ref="recording" hidden></span></div>
      <div class="rp-bar" data-ref="bar">
        <div class="rp-timeline">
          <span class="rp-time" data-ref="time">0:00.00</span>
          <div class="rp-track" data-ref="track" role="slider" tabindex="0" aria-label="Replay position" aria-valuemin="0">
            <div class="rp-rail"><div class="rp-fill" data-ref="fill"></div></div>
            <div data-ref="marks"></div>
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
            <button class="menu-btn small" data-a="name" title="Name this replay: a named save is never deleted with the auto saves">Save</button>
            <button class="menu-btn small" data-a="clean">Clean feed</button>
            ${videoSupported() ? `<button class="menu-btn small rp-video" data-a="video" data-ref="video">${ICON.rec}<span>Record video</span></button>` : ''}
            <button class="menu-btn small primary" data-a="exit">${opts.exitLabel}</button>
          </div>
        </div>
        <div class="rp-keys"><b>Space</b> play · <b>← →</b> ${SKIP} s · <b>, .</b> frame · <b>[ ]</b> speed · <b>1–8</b> camera · <b>C</b> next camera · <b>H</b> clean feed${videoSupported() ? ' · <b>V</b> video' : ''} · <b>Esc</b> exit</div>
      </div>
      <div class="rp-clean-hint" data-ref="hint">Clean feed · <b>H</b> or tap to show the controls</div>`;
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
    this.bindOrbit();
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
    if (this.video) void this.stopVideo();
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
    const rec = this.video
      ? `● REC ${formatTime(this.video.seconds).replace(/\.\d+$/, '')}`
      : '';
    this.set('recording', rec);
    this.refs.recording.hidden = !rec;
    if (this.refs.video) this.refs.video.classList.toggle('on', !!this.video);
    // Recording stops by itself at the end.
    if (this.video && !s.playing && s.time >= s.duration - 0.01)
      void this.stopVideo();
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
      case 'video':
        void this.toggleVideo();
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
      },
      close,
    );
    pop.classList.add('rp-name-pop');
    this.refs.bar.append(pop);
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

  private async toggleVideo(): Promise<void> {
    if (this.video) return this.stopVideo();
    const s = this.session!;
    const h = s.track.header;
    // From the start line, clean, at normal speed.
    if (s.time >= s.duration - 0.5) s.seek(Math.max(0, s.track.goTime - 1.5));
    s.playing = true;
    this.video = new ReplayVideo(
      this.game.renderer.domElement,
      this.game.audio.captureStream(),
      `rally-${h.stage}-${h.car}-${new Date(h.date).toISOString().slice(0, 10)}`,
    );
    this.setClean(true);
  }

  private async stopVideo(): Promise<void> {
    const v = this.video;
    if (!v) return;
    this.video = undefined;
    const bytes = await v.stop();
    this.setClean(false);
    this.game.hud.message(
      `VIDEO SAVED · ${(bytes / 1e6).toFixed(1)} MB`,
      2.5,
      'small',
    );
  }

  private key(e: KeyboardEvent): void {
    const s = this.session;
    if (
      !s ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLInputElement
    )
      return;
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
        if (videoSupported()) void this.toggleVideo();
        break;
      case 'Escape':
        if (this.video) void this.stopVideo();
        else if (s.clean) this.setClean(false);
        else this.opts.onExit();
        break;
      default: {
        const n = /^Digit([1-8])$/.exec(e.code);
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
    track.addEventListener('pointerdown', (e) => {
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

  /** Orbit camera: drag on the 3D view turns it, the wheel / pinch-less scroll zooms. */
  private bindOrbit(): void {
    const canvas = this.game.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.session?.director.shot !== 'orbit') return;
      this.orbitDrag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.orbitDrag;
      if (!d || !this.session) return;
      this.session.director.orbitBy(
        -(e.clientX - d.x) * 0.006,
        (e.clientY - d.y) * 0.004,
        0,
      );
      d.x = e.clientX;
      d.y = e.clientY;
    });
    const end = () => (this.orbitDrag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.session?.director.shot !== 'orbit') return;
        e.preventDefault();
        this.session.director.orbitBy(0, 0, Math.sign(e.deltaY) * 0.1);
      },
      { passive: false },
    );
  }
}
