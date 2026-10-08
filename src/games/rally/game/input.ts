import type { VehicleControls } from '../physics/types';

/**
 * Keyboard + gamepad + touch buttons -> smoothed VehicleControls.
 *
 * Keyboard steering is digital, so it is ramped and speed-limited (less lock
 * at speed) - except when counter-steering into a slide, where full lock is
 * allowed. That one rule is what makes keyboard drifting feel good.
 */
export type InputAction =
  | 'reset'
  | 'camera'
  | 'pause'
  | 'restart'
  | 'shiftUp'
  | 'shiftDown'
  | 'toggleGearbox'
  | 'telemetry'
  | 'physicsDebug'
  | 'mute'
  | 'traction'
  | 'abs'
  | 'autopilot';

const KEY_ACTIONS: Record<string, InputAction> = {
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'restart',
  KeyE: 'shiftUp',
  KeyQ: 'shiftDown',
  KeyG: 'toggleGearbox',
  F2: 'telemetry',
  F4: 'physicsDebug',
  KeyM: 'mute',
  KeyT: 'traction',
  KeyB: 'abs',
  F8: 'autopilot',
};

/** Gamepad (standard mapping) button -> action. */
const PAD_ACTIONS: Record<number, InputAction> = {
  1: 'reset', // B
  3: 'camera', // Y
  9: 'pause', // Start
  5: 'shiftUp', // RB
  4: 'shiftDown', // LB
};

/**
 * Keyboard steer limit (fraction of full lock) at a forward speed (m/s): ~0.76 at 30 km/h (hairpins), 0.53 at 60,
 * 0.34 at 100, 0.24 at 140. Close to the steering that gives peak grip (+30-50 %) - the old `1 / (1 + v / 26)` was 2-3x
 * it at speed, so a held key slid the front tyres, scrubbed speed and made traction control cut the power.
 * Counter-steering into a slide still gets more (see update()).
 */
export function keyboardSteerLimit(speed: number): number {
  return 1 / (1 + (Math.max(0, speed) / 18) ** 1.5);
}

export interface DriveState {
  /** Forward speed (m/s). */
  speed: number;
  /** Body slip angle (rad), + = sliding towards the car's left. */
  slipAngle: number;
  /** Max wheel steer angle (rad) - used to scale the counter-steer allowance. */
  maxSteer: number;
}

export class InputController {
  readonly controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: 0,
  };
  /** Last device used, for HUD hints. */
  device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  enabled = true;
  private keys = new Set<string>();
  private padButtons: boolean[] = [];
  private listeners: ((a: InputAction) => void)[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
          'F2',
          'F4',
          'F8',
        ].includes(e.code)
      )
        e.preventDefault();
      this.device = 'keyboard';
      if (!e.repeat && KEY_ACTIONS[e.code]) this.emit(KEY_ACTIONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onAction(fn: (a: InputAction) => void): void {
    this.listeners.push(fn);
  }

  private emit(a: InputAction): void {
    for (const fn of this.listeners) fn(a);
  }

  /**
   * While update() isn't called (paused): keep edge-detecting pad buttons so
   * Start still closes the pause menu.
   */
  poll(): void {
    this.pollGamepad();
  }

  /** On-screen touch buttons (touch-controls.ts) hold virtual keys like 'TouchGas'. */
  setVirtualKey(code: string, held: boolean): void {
    if (held) {
      this.keys.add(code);
      this.device = 'touch';
    } else this.keys.delete(code);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number, s: DriveState): VehicleControls {
    const c = this.controls;
    const pad = this.pollGamepad();
    if (!this.enabled) {
      c.throttle = c.brake = c.handbrake = 0;
      c.steer *= 0.8;
      return c;
    }
    if (pad) {
      c.throttle = pad.throttle;
      c.brake = pad.brake;
      c.handbrake = pad.handbrake;
      c.steer = pad.steer;
      return c;
    }
    const ramp = (cur: number, target: number, up: number, downRate: number) =>
      target > cur
        ? Math.min(target, cur + up * dt)
        : Math.max(target, cur - downRate * dt);
    c.throttle = ramp(
      c.throttle,
      this.down('KeyW', 'ArrowUp', 'TouchGas') ? 1 : 0,
      6,
      10,
    );
    c.brake = ramp(
      c.brake,
      this.down('KeyS', 'ArrowDown', 'TouchBrake') ? 1 : 0,
      7,
      10,
    );
    c.handbrake = this.down('Space') ? 1 : 0;

    const target =
      (this.down('KeyD', 'ArrowRight', 'TouchRight') ? 1 : 0) -
      (this.down('KeyA', 'ArrowLeft', 'TouchLeft') ? 1 : 0);
    // Speed-sensitive limit...
    let limit = keyboardSteerLimit(s.speed);
    // ...lifted when steering into a slide (counter-steer).
    // Sliding left (slip > 0) -> counter-steer is steering left (target < 0).
    const counter =
      target !== 0 && Math.sign(target) === -Math.sign(s.slipAngle);
    if (counter)
      limit = Math.min(
        1,
        Math.max(limit, Math.abs(s.slipAngle) / s.maxSteer + limit),
      );
    const goal = target * limit;
    const returning =
      Math.abs(goal) < Math.abs(c.steer) ||
      Math.sign(goal) !== Math.sign(c.steer);
    const rate = returning ? (counter ? 9 : 6) : 3.2;
    c.steer = ramp(c.steer, goal, rate, rate);
    return c;
  }

  private pollGamepad(): VehicleControls | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return null;
    // Edge-detect action buttons. While disabled a menu owns the pad
    // (pad-nav.ts): only Start (pause) still reaches the game.
    pad.buttons.forEach((b, i) => {
      const a = PAD_ACTIONS[i];
      if (
        b.pressed &&
        !this.padButtons[i] &&
        a &&
        (this.enabled || a === 'pause')
      )
        this.emit(a);
      this.padButtons[i] = b.pressed;
    });
    const sx = pad.axes[0] ?? 0;
    const dz = 0.08;
    const steer =
      Math.abs(sx) < dz
        ? 0
        : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz)) ** 1.4;
    const throttle = pad.buttons[7]?.value ?? 0;
    const brake = pad.buttons[6]?.value ?? 0;
    const handbrake =
      pad.buttons[0]?.pressed || pad.buttons[2]?.pressed ? 1 : 0;
    const active =
      Math.abs(steer) > 0 || throttle > 0.05 || brake > 0.05 || handbrake > 0;
    if (active) this.device = 'gamepad';
    if (this.device !== 'gamepad') return null;
    return { steer, throttle, brake, handbrake };
  }
}
