/**
 * Gamepad -> menu navigation (main menu, pause menu, stage results).
 *
 * Polls the first connected pad (standard mapping) every animation frame and
 * reports edge-triggered actions: d-pad / left stick = direction (auto-repeat
 * while held), A = confirm, B = back, Start = start. Button state is tracked
 * even while the handler ignores input, so a button already held when a menu
 * appears (e.g. A = handbrake at the finish) doesn't fire as a fresh press.
 *
 * Stick drift: an axis only counts once it has been seen near centre (a stick
 * or a non-gamepad axis resting off-centre - pedals, a worn stick - never
 * navigates), and uses hysteresis (press past STICK_ON, release below
 * STICK_OFF). Pads with the standard mapping are preferred over other devices.
 *
 * While a pad drives the menus, `<html data-input="pad">` makes the focused
 * control visible (programmatic focus doesn't always get :focus-visible);
 * the mouse clears it again.
 */
export type NavAction =
  'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start';
export type NavDir = 'up' | 'down' | 'left' | 'right';

const BUTTONS: [index: number, action: NavAction][] = [
  [0, 'confirm'], // A
  [1, 'back'], // B
  [9, 'start'], // Start
];
const DPAD: [index: number, dir: NavDir][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const STICK_ON = 0.65;
const STICK_OFF = 0.4;
/** An axis is trusted once it has been seen inside this rest zone. */
const STICK_REST = 0.25;
const REPEAT_DELAY = 0.4;
const REPEAT_EVERY = 0.13;

export class GamepadMenuNav {
  private prev: boolean[] = [];
  private padId = '';
  /** Per stick axis: seen near centre since the pad connected. */
  private armed = [false, false];
  private stickDir: NavDir | null = null;
  private dir: NavDir | null = null;
  private dirTime = 0;
  private nextRepeat = 0;
  private raf = 0;
  private last = 0;
  private clearPadMode = () => delete document.documentElement.dataset.input;

  /** `handler` receives every action; ignore the ones that don't apply. */
  constructor(private handler: (a: NavAction) => void) {
    window.addEventListener('mousemove', this.clearPadMode);
    window.addEventListener('mousedown', this.clearPadMode);
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      this.poll(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private poll(dt: number): void {
    const pad = menuPad();
    if (!pad) return;
    if (pad.id + pad.index !== this.padId) {
      this.padId = pad.id + pad.index;
      this.armed = [false, false];
      this.stickDir = null;
    }
    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
    for (const [i, a] of BUTTONS) {
      if (pressed(i) && !this.prev[i]) this.fire(a);
      this.prev[i] = pressed(i);
    }

    // Direction: d-pad wins over the stick; repeats while held.
    const dpad =
      pad.mapping === 'standard'
        ? (DPAD.find(([i]) => pressed(i))?.[1] ?? null)
        : null;
    const dir = dpad ?? this.stick(pad);
    if (dir !== this.dir) {
      this.dir = dir;
      this.dirTime = 0;
      this.nextRepeat = REPEAT_DELAY;
      if (dir) this.fire(dir);
    } else if (dir) {
      this.dirTime += dt;
      if (this.dirTime >= this.nextRepeat) {
        this.nextRepeat += REPEAT_EVERY;
        this.fire(dir);
      }
    }
  }

  /** Left stick direction with rest-arming + hysteresis (see the header). */
  private stick(pad: Gamepad): NavDir | null {
    const raw = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
    raw.forEach((v, i) => {
      if (Math.abs(v) < STICK_REST) this.armed[i] = true;
    });
    const [x, y] = raw.map((v, i) => (this.armed[i] ? v : 0));
    const mag = Math.max(Math.abs(x), Math.abs(y));
    if (mag < (this.stickDir ? STICK_OFF : STICK_ON)) this.stickDir = null;
    else if (!this.stickDir)
      this.stickDir =
        Math.abs(x) > Math.abs(y)
          ? x > 0
            ? 'right'
            : 'left'
          : y > 0
            ? 'down'
            : 'up';
    return this.stickDir;
  }

  private fire(a: NavAction): void {
    document.documentElement.dataset.input = 'pad';
    this.handler(a);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this.clearPadMode);
    window.removeEventListener('mousedown', this.clearPadMode);
  }
}

/** The pad that drives menus: a standard-mapping gamepad first, else any connected device. */
function menuPad(): Gamepad | undefined {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter(
    (p): p is Gamepad => !!p && p.connected,
  );
  return pads.find((p) => p.mapping === 'standard') ?? pads[0];
}

// --- focus helpers (shared by gamepad and keyboard menu navigation) ---------------------

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled])';

/** Visible focusable controls inside `container`. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

/** Focus the container's primary control (or its first one) if focus is elsewhere. */
export function ensureFocus(container: HTMLElement): HTMLElement | undefined {
  const items = focusables(container);
  const cur = items.find((el) => el === document.activeElement);
  if (cur) return cur;
  const first = items.find((el) => el.hasAttribute('data-primary')) ?? items[0];
  if (first) focusEl(first);
  return undefined;
}

/**
 * Spatial focus move: the nearest control in `dir` (favouring ones in line with
 * the current control; left / right only within its row). Falls back to
 * wrapping around for up / down. A focused
 * range slider takes left / right as value steps instead.
 */
export function moveFocus(container: HTMLElement, dir: NavDir): void {
  const items = focusables(container);
  const cur = items.find((el) => el === document.activeElement);
  if (!cur) {
    ensureFocus(container);
    return;
  }
  if (
    cur instanceof HTMLInputElement &&
    cur.type === 'range' &&
    (dir === 'left' || dir === 'right')
  ) {
    stepRange(cur, dir === 'right' ? 1 : -1);
    return;
  }
  const [dx, dy] = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  }[dir];
  const c = centre(cur);
  // Left / right stay on the current row (option segments, button rows).
  const rowHalf = cur.getBoundingClientRect().height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  let wrap: HTMLElement | undefined;
  let wrapScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const p = centre(el);
    if (dx !== 0 && Math.abs(p.y - c.y) > rowHalf) continue;
    const along = (p.x - c.x) * dx + (p.y - c.y) * dy;
    const across = Math.abs((p.x - c.x) * dy - (p.y - c.y) * dx);
    if (along > 4) {
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    } else if (dy !== 0) {
      // Wrap target: furthest away on the other side.
      const score = along + across * 0.5;
      if (score < wrapScore) {
        wrapScore = score;
        wrap = el;
      }
    }
  }
  const next = best ?? wrap;
  if (next) focusEl(next);
}

/** Click the focused control (or focus the primary one if nothing is focused yet). */
export function activateFocused(container: HTMLElement): void {
  const cur = ensureFocus(container);
  if (cur && !(cur instanceof HTMLInputElement)) cur.click();
}

function stepRange(el: HTMLInputElement, sign: number): void {
  const step = (Number(el.max) - Number(el.min)) / 20 || 1;
  el.value = String(Number(el.value) + sign * step);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function centre(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
