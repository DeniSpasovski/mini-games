/**
 * Photo mode UI (STYLEGUIDE.md "Photo mode"): the lens panel on the left (focal length, aperture, focus, exposure,
 * roll, shutter speed (motion blur) and what it keeps sharp), the actions bottom right (Take photo, Hide, Reset view, Back), a PHOTO plate top right. The view orbits by
 * drag / one finger, pans by right-drag / two fingers, zooms by wheel / pinch; keys and pad too (see `key`, `pollPad`).
 * Pictures are saved as JPEG downloads.
 */
import './photo.css';
import type { RallyGame } from '../rally-game';
import { PHOTO_FILTERS, type PhotoFilter } from '../../engine/post-fx';
import {
  F_STOPS,
  FOCAL_MAX,
  FOCAL_MIN,
  type PhotoMode,
  SHUTTERS,
} from './photo-mode';

/** Focus slider range (m, log scale). */
const FOCUS_MIN = 0.5;
const FOCUS_MAX = 500;

const logPos = (v: number, lo: number, hi: number) =>
  Math.log(v / lo) / Math.log(hi / lo);
const logVal = (p: number, lo: number, hi: number) => lo * (hi / lo) ** p;

const ICON = {
  camera:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

export class PhotoUi {
  readonly el: HTMLDivElement;
  private refs: Record<string, HTMLElement> = {};
  private photo?: PhotoMode;
  private onClose?: () => void;
  private raf = 0;
  private last = 0;
  private hidden = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private held = new Set<string>();
  private padPrev: boolean[] = [];
  private busy = false;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    private root: HTMLElement,
    private game: RallyGame,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'photo-ui hidden';
    this.el.innerHTML = `
      <div class="ph-catch" data-ref="catch"></div>
      <div class="ph-plate"><span class="ph-tag">Photo</span><span data-ref="lensText"></span></div>
      <div class="ph-panel" data-ref="panel">
        <label class="ph-row"><span>Focal length</span><b data-ref="focalVal"></b>
          <input type="range" data-ref="focal" min="0" max="1" step="0.001" aria-label="Focal length"></label>
        <label class="ph-row"><span>Aperture</span><b data-ref="fStopVal"></b>
          <input type="range" data-ref="fStop" min="0" max="${F_STOPS.length - 1}" step="1" aria-label="Aperture"></label>
        <div class="ph-row"><span>Focus</span><b data-ref="focusVal"></b>
          <button class="ph-af" data-a="af" data-ref="af" title="Focus on the car">Car</button>
          <input type="range" data-ref="focus" min="0" max="1" step="0.001" aria-label="Focus distance"></div>
        <label class="ph-row"><span>Exposure</span><b data-ref="evVal"></b>
          <input type="range" data-ref="ev" min="-2" max="2" step="0.1" aria-label="Exposure"></label>
        <label class="ph-row"><span>Roll</span><b data-ref="rollVal"></b>
          <input type="range" data-ref="roll" min="-30" max="30" step="1" aria-label="Roll"></label>
        <label class="ph-row"><span>Shutter speed</span><b data-ref="shutterVal"></b>
          <input type="range" data-ref="shutter" min="0" max="${SHUTTERS.length - 1}" step="1" aria-label="Shutter speed (motion blur)"></label>
        <div class="ph-row ph-follow" data-ref="followRow"><span>Sharp</span>
          <span class="ph-chips"><button class="ph-af" data-follow="car" title="The camera pans with the car: the background streaks">Car</button><button class="ph-af" data-follow="ground" title="The camera holds still: the car streaks">Background</button></span></div>
        <label class="ph-row"><span>Filter</span>
          <span class="ph-select"><select data-ref="filter" aria-label="Filter">${Object.entries(
            PHOTO_FILTERS,
          )
            .map(([id, f]) => `<option value="${id}">${f.label}</option>`)
            .join('')}</select></span></label>
        <label class="ph-row ph-strength" data-ref="strengthRow"><span>Strength</span><b data-ref="strengthVal"></b>
          <input type="range" data-ref="strength" min="0" max="1" step="0.05" aria-label="Filter strength"></label>
      </div>
      <div class="ph-actions" data-ref="actions">
        <button class="menu-btn small" data-a="hide">Hide</button>
        <button class="menu-btn small" data-a="reset">Reset view</button>
        <button class="menu-btn small" data-a="back">Back</button>
        <button class="menu-btn small primary ph-shoot" data-a="shoot">${ICON.camera}<span>Take photo</span></button>
      </div>
      <div class="ph-keys"><b>Drag</b> orbit · <b>Right-drag</b> pan · <b>Wheel</b> zoom · <b>Enter</b> take photo · <b>H</b> hide · <b>Esc</b> back</div>
      <button class="ph-show" data-a="show">Show controls</button>
      <div class="ph-flash" data-ref="flash"></div>
      <div class="ph-toast" data-ref="toast"></div>`;
    root.append(this.el);
    this.el
      .querySelectorAll<HTMLElement>('[data-ref]')
      .forEach((e) => (this.refs[e.dataset.ref!] = e));
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('input', (e) => this.input(e));
    this.bindView();
  }

  get open(): boolean {
    return !!this.photo;
  }

  /** Open photo mode; `onClose` brings back whatever was open before (pause menu, replay bar). */
  show(onClose: () => void): void {
    this.photo = this.game.enterPhoto();
    this.onClose = onClose;
    this.setHidden(false);
    this.el.classList.remove('hidden');
    this.root.classList.add('photo-mode');
    this.sync();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.photo) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
    this.el
      .querySelector<HTMLElement>('.ph-shoot')!
      .focus({ preventScroll: true });
  }

  close(): void {
    if (!this.photo) return;
    this.photo = undefined;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.held.clear();
    this.pointers.clear();
    this.el.classList.add('hidden');
    this.root.classList.remove('photo-mode');
    this.game.exitPhoto();
    const cb = this.onClose;
    this.onClose = undefined;
    cb?.();
  }

  /** Sliders and labels from the settings. */
  private sync(): void {
    const p = this.photo!;
    const s = p.settings;
    const r = this.refs;
    (r.focal as HTMLInputElement).value = String(
      logPos(s.focal, FOCAL_MIN, FOCAL_MAX),
    );
    (r.fStop as HTMLInputElement).value = String(nearestStop(s.fStop));
    (r.ev as HTMLInputElement).value = String(s.ev);
    (r.roll as HTMLInputElement).value = String(s.roll);
    (r.shutter as HTMLInputElement).value = String(
      Math.max(0, SHUTTERS.indexOf(s.shutter)),
    );
    r.shutterVal.textContent = s.shutter
      ? `1/${Math.round(1 / s.shutter)} s`
      : 'Off';
    r.followRow.classList.toggle('off', !s.shutter);
    (r.filter as HTMLSelectElement).value = s.filter;
    (r.strength as HTMLInputElement).value = String(s.filterStrength);
    r.strengthVal.textContent = `${Math.round(s.filterStrength * 100)} %`;
    r.strengthRow.classList.toggle('off', s.filter === 'none');
    this.syncFocus();
    r.focalVal.textContent = `${Math.round(s.focal)} mm`;
    r.fStopVal.textContent = `f/${s.fStop}`;
    r.evVal.textContent = `${s.ev > 0 ? '+' : s.ev < 0 ? '−' : ''}${Math.abs(s.ev).toFixed(1)} EV`;
    r.rollVal.textContent = `${s.roll}°`;
    r.af.classList.toggle('on', s.autoFocus);
    r.lensText.textContent = `${Math.round(s.focal)} mm · f/${s.fStop}`;
  }

  /** The focus slider follows the auto focus while the view moves. */
  private syncFocus(): void {
    const s = this.photo!.settings;
    const f = this.refs.focus as HTMLInputElement;
    if (document.activeElement !== f)
      f.value = String(
        logPos(
          Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, s.focus)),
          FOCUS_MIN,
          FOCUS_MAX,
        ),
      );
    this.refs.focusVal.textContent =
      s.focus < 10 ? `${s.focus.toFixed(1)} m` : `${Math.round(s.focus)} m`;
  }

  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    const p = this.photo;
    if (!p) return;
    const s = p.settings;
    if (t.dataset.ref === 'filter') {
      s.filter = t.value as PhotoFilter;
      this.sync();
      return;
    }
    if (t.type !== 'range') return;
    const v = Number(t.value);
    switch (t.dataset.ref) {
      case 'focal':
        s.focal = Math.round(logVal(v, FOCAL_MIN, FOCAL_MAX));
        break;
      case 'fStop':
        s.fStop = F_STOPS[v];
        break;
      case 'focus':
        s.autoFocus = false;
        s.focus = logVal(v, FOCUS_MIN, FOCUS_MAX);
        break;
      case 'ev':
        s.ev = v;
        break;
      case 'roll':
        s.roll = v;
        break;
      case 'shutter':
        s.shutter = SHUTTERS[v];
        break;
      case 'strength':
        s.filterStrength = v;
        break;
    }
    this.sync();
  }

  private click(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
    const p = this.photo;
    if (!btn || !p) return;
    if (btn.dataset.follow) {
      p.settings.follow = btn.dataset.follow as 'car' | 'ground';
      this.sync();
      return;
    }
    switch (btn.dataset.a) {
      case 'af':
        p.settings.autoFocus = true;
        this.sync();
        break;
      case 'hide':
        this.setHidden(true);
        break;
      case 'show':
        this.setHidden(false);
        break;
      case 'reset':
        p.recentre();
        break;
      case 'back':
        this.close();
        break;
      case 'shoot':
        void this.shoot();
        break;
    }
  }

  private setHidden(on: boolean): void {
    this.hidden = on;
    this.el.classList.toggle('clean', on);
  }

  /** Take the picture: rendered at up to 4K over the next frame(s) (`RallyGame.takePhoto`), as a JPEG download. */
  private async shoot(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    // A big picture with motion blur takes a while: the note stays up with its progress (`tick`).
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    const blob = await this.game.takePhoto();
    this.setBusy(false);
    const flash = this.refs.flash;
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    if (!blob) return this.toast('Photo not saved');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gravel-rally-${this.game.world.stageDef.id}-${stamp()}.jpg`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    const { width, height } = this.game.photoSize;
    this.toast(
      `Photo saved · ${width} × ${height} · ${(blob.size / 1e6).toFixed(1)} MB`,
    );
  }

  /** A picture is being drawn: the note holds with a progress bar, Take photo is off. */
  private setBusy(on: boolean): void {
    this.busy = on;
    const t = this.refs.toast;
    t.classList.toggle('busy', on);
    t.style.setProperty('--ph-progress', '0');
    if (on) {
      t.classList.remove('on');
      t.textContent = 'Taking photo…';
    }
    this.el.querySelector<HTMLButtonElement>('.ph-shoot')!.disabled = on;
  }

  private toast(text: string): void {
    const t = this.refs.toast;
    t.textContent = text;
    t.classList.remove('on');
    void t.offsetWidth;
    t.classList.add('on');
  }

  private tick(dt: number): void {
    // The camera holds still while a picture is drawn; the note shows how far it is.
    if (this.busy) {
      const k = this.game.photoProgress;
      const t = this.refs.toast;
      t.style.setProperty('--ph-progress', String(k));
      const text =
        k > 0 && k < 1
          ? `Taking photo… ${Math.round(k * 100)} %`
          : 'Taking photo…';
      if (t.textContent !== text) t.textContent = text;
      return;
    }
    const p = this.photo!;
    const h = this.held;
    const turn = 1.4 * dt * (p.fov / 50);
    const x =
      (h.has('ArrowRight') || h.has('KeyD') ? 1 : 0) -
      (h.has('ArrowLeft') || h.has('KeyA') ? 1 : 0);
    const y =
      (h.has('ArrowUp') || h.has('KeyW') ? 1 : 0) -
      (h.has('ArrowDown') || h.has('KeyS') ? 1 : 0);
    const z =
      (h.has('KeyE') || h.has('Equal') ? 1 : 0) -
      (h.has('KeyQ') || h.has('Minus') ? 1 : 0);
    if (x || y) p.orbit(x * turn, y * turn);
    if (z) p.zoom(Math.exp(-z * dt * 1.2));
    this.pollPad(dt);
    if (p.settings.autoFocus) this.syncFocus();
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (!this.photo) return;
    // A focused slider or dropdown keeps its own keys.
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement;
    if (e.target instanceof HTMLSelectElement && e.code !== 'Escape') return;
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    let used = true;
    switch (e.code) {
      case 'Escape':
        if (this.hidden) this.setHidden(false);
        else this.close();
        break;
      case 'Enter':
      case 'KeyP':
        if (e.target instanceof HTMLButtonElement && e.code === 'Enter') return;
        void this.shoot();
        break;
      case 'KeyH':
        this.setHidden(!this.hidden);
        break;
      case 'KeyR':
        this.photo.recentre();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        // A focused slider keeps its arrows.
        if (typing) return;
        this.held.add(e.code);
        break;
      case 'KeyW':
      case 'KeyA':
      case 'KeyS':
      case 'KeyD':
      case 'KeyQ':
      case 'KeyE':
      case 'Equal':
      case 'Minus':
        this.held.add(e.code);
        break;
      default:
        used = false;
    }
    // Every key stops here: the game's own keys (pause, camera, reset) wait until photo mode closes.
    e.stopPropagation();
    if (used) e.preventDefault();
  }

  /** Left stick orbit, right stick zoom / pan, LT / RT focal length, A take photo, B back, Y hide. */
  private pollPad(dt: number): void {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(
      (g) => g?.connected,
    );
    const p = this.photo;
    if (!pad || !p) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const ax = (i: number) => dz(pad.axes[i] ?? 0);
    const turn = 1.6 * dt * (p.fov / 50);
    if (ax(0) || ax(1)) p.orbit(ax(0) * turn, -ax(1) * turn);
    if (ax(3)) p.zoom(Math.exp(ax(3) * dt * 1.5));
    if (ax(2)) p.panBy(ax(2) * dt * 2, 0);
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    if (lt > 0.1 || rt > 0.1) {
      const s = p.settings;
      s.focal = Math.min(
        FOCAL_MAX,
        Math.max(FOCAL_MIN, s.focal * Math.exp((rt - lt) * dt * 1.2)),
      );
      this.sync();
    }
    const edge = (i: number) => !!pad.buttons[i]?.pressed && !this.padPrev[i];
    if (edge(0)) void this.shoot();
    if (edge(1)) {
      if (this.hidden) this.setHidden(false);
      else this.close();
    }
    if (edge(3)) this.setHidden(!this.hidden);
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }

  /** Drag / touch on the view: orbit (one pointer, left button), pan (right / middle button, shift, two fingers), pinch zoom. */
  private bindView(): void {
    const view = this.refs.catch;
    let pan = false;
    let pinch = 0;
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('pointerdown', (e) => {
      view.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pan = e.button === 1 || e.button === 2 || e.shiftKey;
      pinch = this.spread();
      if (
        this.hidden &&
        e.pointerType === 'touch' &&
        this.pointers.size === 1
      ) {
        // Tap to show the controls again (a drag still orbits).
        view.dataset.tap = String(performance.now());
      }
    });
    view.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      const p = this.photo;
      if (!prev || !p) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      const n = this.pointers.size;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (n >= 2) {
        const s = this.spread();
        if (pinch > 0 && s > 0) p.zoom(pinch / s);
        pinch = s;
        this.panPx(dx / n, dy / n);
      } else if (pan) this.panPx(dx, dy);
      else {
        const k = 0.006 * (p.fov / 50);
        p.orbit(-dx * k, dy * k);
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      pinch = this.spread();
      const tap = Number(view.dataset.tap ?? 0);
      if (tap && performance.now() - tap < 250) this.setHidden(false);
      delete view.dataset.tap;
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.photo?.zoom(
          Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))),
        );
      },
      { passive: false },
    );
  }

  /** Pan by screen pixels: the orbit point moves with the picture (metres per pixel at the orbit distance). */
  private panPx(dx: number, dy: number): void {
    const p = this.photo!;
    const h = Math.max(1, this.el.clientHeight);
    const m = (2 * p.distance * Math.tan((p.fov * Math.PI) / 360)) / h;
    p.panBy(-dx * m, dy * m);
  }

  /** Distance between the first two pointers (0 with fewer). */
  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

function nearestStop(f: number): number {
  let best = 0;
  F_STOPS.forEach((s, i) => {
    if (Math.abs(s - f) < Math.abs(F_STOPS[best] - f)) best = i;
  });
  return best;
}

/** Local date and time for the file name: 20261111-081502. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
