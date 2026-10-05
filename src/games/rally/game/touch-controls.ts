import type { InputController } from './input';

/**
 * On-screen controls for phones / tablets: steer left / right under the left
 * thumb, brake / gas under the right one, plus a small pause button (there is
 * no Esc key on an iPad). Shown only on touch devices.
 *
 * Every finger is tracked by pointerId and mapped to the button under it on
 * each move (`elementFromPoint` respects the landscape rotation below), so a
 * thumb can slide from left to right or from brake to gas without lifting.
 * Held buttons feed InputController as virtual keys, so touch gets the same
 * speed-sensitive steering + counter-steer help as the keyboard.
 */
export function isTouchDevice(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    typeof matchMedia === 'function' &&
    matchMedia('(any-pointer: coarse)').matches
  );
}

/** data-touch value -> InputController virtual key. */
const KEYS: Record<string, string> = {
  left: 'TouchLeft',
  right: 'TouchRight',
  brake: 'TouchBrake',
  gas: 'TouchGas',
};

export class TouchControls {
  readonly el = document.createElement('div');
  /** pointerId -> data-touch of the button under that finger. */
  private fingers = new Map<number, string>();

  constructor(
    parent: HTMLElement,
    private input: InputController,
    onPause: () => void,
  ) {
    this.el.className = 'touch-controls';
    this.el.innerHTML = `
      <div class="touch-pad left">
        <div class="touch-btn" data-touch="left" aria-label="Steer left">◀</div>
        <div class="touch-btn" data-touch="right" aria-label="Steer right">▶</div>
      </div>
      <div class="touch-pad right">
        <div class="touch-btn brake" data-touch="brake" aria-label="Brake / reverse">BRAKE</div>
        <div class="touch-btn gas" data-touch="gas" aria-label="Gas">GAS</div>
      </div>
      <button class="touch-pause" aria-label="Pause">❚❚</button>`;
    parent.append(this.el);
    this.el
      .querySelector('.touch-pause')!
      .addEventListener('click', () => onPause());

    const track = (e: PointerEvent) => {
      if (!this.fingers.has(e.pointerId) && e.type !== 'pointerdown') return;
      e.preventDefault();
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>('.touch-controls [data-touch]');
      this.fingers.set(e.pointerId, hit?.dataset.touch ?? '');
      this.sync();
    };
    const release = (e: PointerEvent) => {
      if (!this.fingers.delete(e.pointerId)) return;
      this.sync();
    };
    for (const pad of this.el.querySelectorAll<HTMLElement>('.touch-pad')) {
      pad.addEventListener('pointerdown', (e) => {
        // Keep receiving moves after the finger slides off this pad.
        try {
          pad.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already gone (or synthetic): track it without capture.
        }
        track(e);
      });
      pad.addEventListener('pointermove', track);
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
    }
    // App switch / notification: never leave a pedal stuck down.
    window.addEventListener('blur', () => this.reset());
    // No long-press menu / magnifier on the buttons.
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Push the held buttons into the input controller + light them up. */
  private sync(): void {
    const held = new Set(this.fingers.values());
    for (const [name, key] of Object.entries(KEYS))
      this.input.setVirtualKey(key, held.has(name));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-touch]'))
      b.classList.toggle('on', held.has(b.dataset.touch!));
  }

  /** Release everything (pause / blur) so the car doesn't keep driving. */
  reset(): void {
    this.fingers.clear();
    this.sync();
  }
}

/**
 * Mobile: the game is landscape only. Android (fullscreen) gets a real
 * orientation lock on the first tap; where that isn't possible (iOS / iPadOS
 * Safari) a portrait screen gets `html.force-landscape`, which turns #root by
 * 90° (hud.css) so the game still fills the screen sideways - correct when
 * the device is held sideways with the rotation lock on.
 */
export function forceLandscape(): void {
  const portrait = matchMedia('(orientation: portrait)');
  const apply = () =>
    document.documentElement.classList.toggle(
      'force-landscape',
      portrait.matches,
    );
  portrait.addEventListener('change', apply);
  // Some browsers only report the media change on the next frame (or never
  // while hidden): resize / orientationchange cover it.
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();

  const lock = async () => {
    try {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen?.({
          navigationUI: 'hide',
        });
      const o = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await o.lock?.('landscape');
    } catch {
      // iOS / desktop browsers: no fullscreen or lock - the CSS rotation covers it.
    }
  };
  window.addEventListener('pointerup', () => void lock(), { once: true });
}
