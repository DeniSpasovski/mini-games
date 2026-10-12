import { tempLevel, type TempWindow } from '../physics/tyre-temp';

/**
 * HUD tyre temperatures: four translucent tyres in a top-down car (left of the gear / speed in the dash), white
 * (cold) -> green (in the window) -> yellow -> red (overheated), plus the air / track temperature. A thin disc mark
 * beside each tyre shows the brake: white cold, green biting, yellow fading, red at the fade floor. Styles in hud.css
 * (`.hud-tyres`). Only touches the DOM when a colour bucket, the steering or a number changes.
 */

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [238, 240, 242];
const GREEN: Rgb = [61, 220, 106];
const YELLOW: Rgb = [255, 208, 64];
const RED: Rgb = [255, 58, 42];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Colour for a `tempLevel` (0 stone cold, 1-2 the window, 3 cooked). */
export function tyreColor(level: number): Rgb {
  // Eased: tyres stay white while clearly cold, then turn green as they reach the window.
  if (level <= 1) return mix(WHITE, GREEN, Math.max(0, level) ** 2);
  if (level <= 2) return GREEN;
  if (level <= 2.4) return mix(GREEN, YELLOW, (level - 2) / 0.4);
  return mix(YELLOW, RED, Math.min(1, (level - 2.4) / 0.6));
}

/** Colour for a `brakeLevel` (0 cold, 1-2 biting, 2 fade starts, 3 fade floor). */
export function brakeColor(level: number): Rgb {
  if (level <= 1) return mix(WHITE, GREEN, Math.max(0, level));
  if (level <= 2) return GREEN;
  if (level <= 2.5) return mix(GREEN, YELLOW, (level - 2) / 0.5);
  return mix(YELLOW, RED, Math.min(1, (level - 2.5) / 0.5));
}

export interface TyreGaugeState {
  /** FL, FR, RL, RR (°C). */
  temps: readonly number[];
  window: TempWindow;
  /** Brake levels (`brakeLevel`) and disc temperatures (°C), same order. */
  brakes: readonly number[];
  discs: readonly number[];
  /** Front wheel steer angle (rad, + = left). */
  steer: number;
  air: number;
  track: number;
}

export class TyreGauge {
  readonly el: HTMLDivElement;
  private tyres: HTMLElement[];
  private discs: HTMLElement[];
  private air: HTMLElement;
  private track: HTMLElement;
  private cache: string[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-tyres';
    this.el.innerHTML = `
      <div class="car"><b></b><i></i><i></i><i></i><i></i><s></s><s></s><s></s><s></s></div>
      <div class="t">AIR <span></span></div>
      <div class="t">TRK <span></span></div>`;
    this.tyres = [...this.el.querySelectorAll<HTMLElement>('.car i')];
    this.discs = [...this.el.querySelectorAll<HTMLElement>('.car s')];
    [this.air, this.track] = [
      ...this.el.querySelectorAll<HTMLElement>('.t span'),
    ];
  }

  private put(i: number, key: string, apply: () => void): void {
    if (this.cache[i] === key) return;
    this.cache[i] = key;
    apply();
  }

  update(s: TyreGaugeState): void {
    s.temps.forEach((t, i) => {
      const level = Math.round(tempLevel(t, s.window) * 20) / 20;
      const el = this.tyres[i];
      this.put(i, String(level), () => {
        const [r, g, b] = tyreColor(level);
        el.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
        el.title = `${Math.round(t)}°C`;
      });
    });
    s.brakes.forEach((b, i) => {
      const level = Math.round(b * 20) / 20;
      const el = this.discs[i];
      this.put(7 + i, String(level), () => {
        const [r, g, bl] = brakeColor(level);
        el.style.backgroundColor = `rgba(${r}, ${g}, ${bl}, 0.85)`;
        el.title = `${Math.round(s.discs[i])}°C`;
      });
    });
    const steer = Math.round((-s.steer * 180) / Math.PI);
    this.put(4, String(steer), () => {
      for (const el of this.tyres.slice(0, 2))
        el.style.transform = `rotate(${steer}deg)`;
    });
    const air = `${Math.round(s.air)}°`;
    this.put(5, air, () => (this.air.textContent = air));
    const track = `${Math.round(s.track)}°`;
    this.put(6, track, () => (this.track.textContent = track));
  }
}
