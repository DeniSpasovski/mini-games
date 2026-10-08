import type { PlayerInput } from '../sim/types';
import { el } from './dom';
import {
  DEFAULT_STICK,
  dragToDir,
  followOrigin,
  keysToDir,
  padToDir,
  type StickTuning,
} from './input-map';

/**
 * The human's controls: keyboard (WASD / arrows + Space), gamepad (stick or d-pad + A) and touch (a floating stick
 * anywhere on the stage + a big TNT button). `read()` gives this tick's `PlayerInput`; placing TNT is edge-triggered (one
 * press = one TNT) so holding the button does not carpet the floor.
 */
export class Controls {
  readonly tuning: StickTuning = { ...DEFAULT_STICK };
  enabled = false;
  /** Show the touch UI (set when the device has touch, or after the first touch). */
  touchUi = false;
  onPause: (() => void) | null = null;
  private pointerId = -1;
  private ox = 0;
  private oy = 0;
  private px = 0;
  private py = 0;
  private stick = { dx: 0, dy: 0 };
  private keys = new Set<string>();
  private placeQueued = false;
  private padA = false;
  private padStart = false;
  private readonly ring = el('div', 'kb-joy-ring');
  private readonly dot = el('div', 'kb-joy-dot');
  private readonly tnt = el('button', 'kb-tnt-btn', 'TNT', {
    type: 'button',
    'aria-label': 'Place TNT',
  });

  constructor(surface: HTMLElement, overlay: HTMLElement) {
    overlay.append(this.ring, this.dot, this.tnt);
    this.hideStick();
    this.setTouchUi(
      typeof matchMedia === 'function' &&
        matchMedia('(pointer: coarse)').matches,
    );

    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // desktop plays with the keyboard
      this.setTouchUi(true);
      if (!this.enabled || this.pointerId >= 0) return;
      if ((e.target as HTMLElement | null)?.closest('.kb-tnt-btn, .kb-pause'))
        return;
      this.pointerId = e.pointerId;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no active pointer */
      }
      this.ox = this.px = e.clientX;
      this.oy = this.py = e.clientY;
      this.showStick();
      this.updateStick();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.px = e.clientX;
      this.py = e.clientY;
      const o = followOrigin(
        this.ox,
        this.oy,
        this.px,
        this.py,
        this.tuning.maxDragPx,
      );
      this.ox = o.x;
      this.oy = o.y;
      this.updateStick();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = -1;
      this.stick = { dx: 0, dy: 0 };
      this.hideStick();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);

    this.tnt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.enabled) this.placeQueued = true;
    });

    window.addEventListener('keydown', (e) => {
      if (
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
          e.code,
        ) &&
        this.enabled
      )
        e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (
        this.enabled &&
        (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')
      )
        this.placeQueued = true;
      if (this.enabled && (e.code === 'Escape' || e.code === 'KeyP'))
        this.onPause?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private setTouchUi(on: boolean): void {
    this.touchUi = this.touchUi || on;
    this.tnt.style.display = this.touchUi && this.enabled ? '' : 'none';
  }

  /** Turn the controls on (a round is running) or off (menus). Off also drops the touch and held keys. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.release();
    this.tnt.style.display = this.touchUi && on ? '' : 'none';
  }

  private updateStick(): void {
    this.stick = dragToDir(this.px - this.ox, this.py - this.oy, this.tuning);
    const r = this.tuning.maxDragPx;
    this.ring.style.transform = `translate(${this.ox - r}px, ${this.oy - r}px)`;
    this.ring.style.width = this.ring.style.height = `${r * 2}px`;
    this.dot.style.transform = `translate(${this.px - 20}px, ${this.py - 20}px)`;
  }

  private showStick(): void {
    this.ring.style.display = this.dot.style.display = '';
  }

  private hideStick(): void {
    this.ring.style.display = this.dot.style.display = 'none';
  }

  /** Show the number of TNT the player can still place on the touch button. */
  setTntLeft(n: number): void {
    const text = n > 0 ? `TNT ${n}` : 'TNT';
    if (this.tnt.textContent !== text) this.tnt.textContent = text;
    this.tnt.classList.toggle('empty', n <= 0);
  }

  /** This tick's input. Keyboard wins over stick, stick over gamepad. */
  read(out: PlayerInput): PlayerInput {
    out.dx = out.dy = 0;
    out.place = false;
    if (!this.enabled) return out;
    const k = keysToDir(this.keys);
    if (k.dx || k.dy) {
      out.dx = k.dx;
      out.dy = k.dy;
    } else if (this.stick.dx || this.stick.dy) {
      out.dx = this.stick.dx;
      out.dy = this.stick.dy;
    } else {
      const pad = this.pollPad();
      out.dx = pad.dx;
      out.dy = pad.dy;
    }
    if (this.placeQueued) {
      out.place = true;
      this.placeQueued = false;
    }
    return out;
  }

  private pollPad(): { dx: number; dy: number } {
    const pads =
      typeof navigator !== 'undefined' && navigator.getGamepads
        ? navigator.getGamepads()
        : [];
    for (const g of pads) {
      if (!g) continue;
      const b = (i: number) => !!g.buttons[i]?.pressed;
      const a = b(0) || b(1) || b(2) || b(3);
      if (a && !this.padA) this.placeQueued = true;
      this.padA = a;
      const start = b(9);
      if (start && !this.padStart) this.onPause?.();
      this.padStart = start;
      return padToDir(g.axes, {
        up: b(12),
        down: b(13),
        left: b(14),
        right: b(15),
      });
    }
    return { dx: 0, dy: 0 };
  }

  /** Drop the current touch, held keys and a queued TNT (menus, pause). */
  release(): void {
    this.pointerId = -1;
    this.stick = { dx: 0, dy: 0 };
    this.keys.clear();
    this.placeQueued = false;
    this.hideStick();
  }
}
