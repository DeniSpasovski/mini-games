import {
  DEFAULT_STICK,
  dragToStick,
  followOrigin,
  padToStick,
  stickToWorld,
  type StickTuning,
} from './stick';

/**
 * Floating joystick (touch / mouse / pen) + keyboard + gamepad. Touch anywhere on the
 * stage to set the origin, drag to steer; lifting the finger stops the hole. A pad steers
 * with the left stick (analogue speed) or the d-pad; its Start button is handled by the
 * menu's pad navigation (`Menu`), so it pauses and resumes from one place.
 */
export class Controls {
  readonly tuning: StickTuning = { ...DEFAULT_STICK };
  enabled = false;
  /** Called on a 3-finger tap (debug HUD on devices without F keys). */
  onThreeFingerTap: (() => void) | null = null;
  private pointerId = -1;
  private ox = 0;
  private oy = 0;
  private px = 0;
  private py = 0;
  private keys = new Set<string>();
  private ring: HTMLDivElement;
  private dot: HTMLDivElement;
  private readout: HTMLDivElement;
  /** Debug HUD: print the stick vector next to the finger. */
  showReadout = false;
  /** Current stick: x right, y up, magnitude 0..1. */
  stick = { x: 0, y: 0 };

  constructor(surface: HTMLElement, overlay: HTMLElement) {
    this.ring = document.createElement('div');
    this.ring.className = 'hg-joy-ring';
    this.dot = document.createElement('div');
    this.dot.className = 'hg-joy-dot';
    this.readout = document.createElement('div');
    this.readout.className = 'hg-joy-readout';
    overlay.append(this.ring, this.dot, this.readout);
    this.hide();

    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pointerId >= 0) return;
      this.pointerId = e.pointerId;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no active pointer */
      }
      this.ox = this.px = e.clientX;
      this.oy = this.py = e.clientY;
      this.show();
      this.update();
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
      this.update();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = -1;
      this.stick = { x: 0, y: 0 };
      this.hide();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('touchstart', (e) => {
      if (e.touches.length === 3) this.onThreeFingerTap?.();
    });

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private update(): void {
    this.stick = dragToStick(this.px - this.ox, this.py - this.oy, this.tuning);
    const r = this.tuning.maxDragPx;
    this.ring.style.transform = `translate(${this.ox - r}px, ${this.oy - r}px)`;
    this.ring.style.width = this.ring.style.height = `${r * 2}px`;
    this.dot.style.transform = `translate(${this.px - 20}px, ${this.py - 20}px)`;
    this.readout.style.display = this.showReadout ? '' : 'none';
    if (this.showReadout) {
      const s = this.stick;
      this.readout.textContent = `${s.x.toFixed(2)}, ${s.y.toFixed(2)}  |${Math.hypot(s.x, s.y).toFixed(2)}|  ${Math.round(Math.hypot(this.px - this.ox, this.py - this.oy))}px`;
      this.readout.style.transform = `translate(${this.px + 28}px, ${this.py - 12}px)`;
    }
  }

  private show(): void {
    this.ring.style.display = this.dot.style.display = '';
  }

  private hide(): void {
    this.ring.style.display = this.dot.style.display = 'none';
    this.readout.style.display = 'none';
  }

  /** Stick for the sim as a world direction (keyboard wins when pressed). */
  world(): { x: number; z: number } {
    if (!this.enabled) return { x: 0, z: 0 };
    let kx = 0;
    let ky = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) ky += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) ky -= 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return stickToWorld(kx / l, ky / l);
    }
    if (this.pointerId >= 0) return stickToWorld(this.stick.x, this.stick.y);
    const p = padStick();
    return stickToWorld(p.x, p.y);
  }

  /** Drop the current touch (menus, pause). */
  release(): void {
    this.pointerId = -1;
    this.stick = { x: 0, y: 0 };
    this.keys.clear();
    this.hide();
  }
}

/** The first connected pad's steering (standard mapping: d-pad buttons 12-15). */
function padStick(): { x: number; y: number } {
  const pads = navigator.getGamepads?.() ?? [];
  for (const g of pads) {
    if (!g?.connected) continue;
    const b = (i: number) =>
      g.mapping === 'standard' && !!g.buttons[i]?.pressed;
    return padToStick(g.axes, {
      up: b(12),
      down: b(13),
      left: b(14),
      right: b(15),
    });
  }
  return { x: 0, y: 0 };
}
