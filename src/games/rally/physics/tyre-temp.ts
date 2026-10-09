import type { SurfaceDef } from './surfaces';

/**
 * Tyre temperature (arcade): one temperature per tyre, heated by sliding and rolling, cooled by the air and the
 * ground. Grip is a multiplier on the tyre's grip input (`TireInput.grip`), so `tire.ts` and the cached surface
 * tables stay untouched. Design + numbers: ../PHYSICS.md ("Tyre temperature").
 */

/** Air and sun of a stage. `Vehicle.setClimate`; null = no temperature (tool pages, reference tests). */
export interface Climate {
  /** Air temperature (°C). */
  air: number;
  /** How much the sun warms a fully sun-heated surface (`SurfaceDef.heat` = 1) above the air (°C). */
  sun: number;
}

/** Temperature window of a compound (`TyreDef.temp`). */
export interface TempWindow {
  /** Ideal window (°C): full grip inside. */
  lo: number;
  hi: number;
  /** Grip factor left when stone cold / cooked (on hard ground; loose ground halves the loss). */
  cold: number;
  hot: number;
}

/** Cold set pressure of a compound (bar, gauge, filled at `FILL_TEMP` with the tyre at air temperature). */
export interface PressureDef {
  cold: number;
}

/** Sharpness (< 1) / laziness (> 1) of the tyre at the cold floor / cooked: `tire.ts` scales peak slip + angle by it. */
export const COLD_RESPONSE = 0.85;
export const HOT_RESPONSE = 1.15;

/** °C below the window over which a tyre goes from `cold` to full grip. */
export const COLD_SPAN = 45;
/** °C above the window over which a tyre goes from full grip to `hot`. */
export const HOT_SPAN = 35;
/** Sun heat on a dark surface with the sun high and no clouds (°C above the air). */
const SUN_HEAT = 24;

// Heat in (°C/s): sliding friction work per unit of nominal load, and carcass flex per m/s of speed.
const SLIDE_HEAT = 0.65;
const ROLL_HEAT = 0.08;
/** Share of the sliding work the stones take on loose ground (gravel runs cool, tarmac hot). */
const LOOSE_SLIDE_SHARE = 0.6;
// Cooling (1/s): air (rises with speed), the ground under the tyre, water.
const AIR_COOL = 0.01;
const AIR_COOL_V = 0.001;
const ROAD_COOL = 0.016;
const WATER_COOL = 0.25;
/** Hottest a tyre gets (°C): keeps the cool-down after a long burnout short. */
const MAX_TEMP = 150;

/** Climate of a stage: air temperature, sun height (deg) and cloud cover (0..1). */
export function climateFor(
  air: number,
  sunElevationDeg: number,
  clouds = 0.4,
): Climate {
  const sun = Math.max(0, Math.sin((sunElevationDeg * Math.PI) / 180));
  return {
    air,
    sun:
      SUN_HEAT * Math.min(1, sun / Math.sin(Math.PI / 3)) * (1 - 0.5 * clouds),
  };
}

/** Temperature of a surface in the sun (°C). */
export function trackTemp(c: Climate, s: SurfaceDef): number {
  return c.air + c.sun * s.heat;
}

/** Tyre temperature at the start of a stage (°C): the air temperature. */
export function startTemp(c: Climate): number {
  return c.air;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Grip factor of a tyre at temperature `t` on a surface (`loose` 0 = tarmac ... 1 = gravel): 1 inside the window,
 * down to `cold` / `hot` outside it; loose ground grips through the tread, so it halves the loss.
 */
export function tempGrip(t: number, w: TempWindow, loose: number): number {
  let f = 1;
  if (t < w.lo) f = w.cold + (1 - w.cold) * smooth(1 - (w.lo - t) / COLD_SPAN);
  else if (t > w.hi) f = 1 - (1 - w.hot) * smooth((t - w.hi) / HOT_SPAN);
  return 1 - (1 - f) * (1 - 0.5 * loose);
}

/** Where a temperature sits for the HUD: 0 stone cold ... 1 window ... 2 window top ... 3 cooked. */
export function tempLevel(t: number, w: TempWindow): number {
  if (t < w.lo) return Math.max(0, 1 - (w.lo - t) / COLD_SPAN);
  if (t <= w.hi) return 1 + (t - w.lo) / (w.hi - w.lo);
  return Math.min(3, 2 + (t - w.hi) / HOT_SPAN);
}

/**
 * Peak slip / angle multiplier from the tyre temperature (`TireInput.response`): a cold tyre is stiff and peaks at a
 * smaller slip angle, a cooked one is soft and lazy. Same shape as `tempGrip`; loose ground halves it.
 */
export function tempResponse(t: number, w: TempWindow, loose: number): number {
  let r = 1;
  if (t < w.lo)
    r = 1 + (COLD_RESPONSE - 1) * (1 - smooth(1 - (w.lo - t) / COLD_SPAN));
  else if (t > w.hi) r = 1 + (HOT_RESPONSE - 1) * smooth((t - w.hi) / HOT_SPAN);
  return 1 + (r - 1) * (1 - 0.5 * loose);
}

// Tyre pressure: gas law on a fixed fill. The gas runs cooler than the tread (`GAS_SHARE` of the way up from the air).
/** Air the tyres are filled at (°C) and atmospheric pressure (bar). */
export const FILL_TEMP = 20;
const ATM = 1.013;
const GAS_SHARE = 0.5;

/** Gauge pressure (bar) of a tyre at `tyreTemp` in `air` (both °C), from its cold set pressure. */
export function gasPressure(
  cold: number,
  tyreTemp: number,
  air: number,
): number {
  const gas = air + GAS_SHARE * (tyreTemp - air);
  return ((cold + ATM) * (gas + 273)) / (FILL_TEMP + 273) - ATM;
}

/** Pressure the tyre wants hot: what it reaches at the middle of its window on a `FILL_TEMP` day. */
export function targetPressure(p: PressureDef, w: TempWindow): number {
  return gasPressure(p.cold, (w.lo + w.hi) / 2, FILL_TEMP);
}

/** Relative distance of the pressure from its target (-0.16 = 16 % under). */
export const pressureDp = (p: number, target: number) => (p - target) / target;

/** Grip factor of a pressure off its target: quiet near it, a little more to lose when under-inflated. */
export function pressureGrip(dp: number): number {
  return 1 - (dp < 0 ? 0.7 : 0.4) * dp * dp;
}

/** Peak slip / angle multiplier: a firm tyre (+ dp) is stiffer and quicker, a soft one vaguer. */
export function pressureResponse(dp: number): number {
  return 1 / (1 + 0.5 * dp);
}

/** Heat build-up multiplier: an under-inflated carcass flexes and heats more. */
export function pressureHeat(dp: number): number {
  return 1 + 0.8 * Math.max(0, -dp) + 0.3 * Math.max(0, dp);
}

/** What a tyre needs for one temperature step. */
export interface TyreHeatInput {
  temp: number;
  contact: boolean;
  /** Tyre force magnitude (N) and sliding speed of the contact patch (m/s). */
  force: number;
  slideSpeed: number;
  /** Rolling speed (m/s), load and static load (N). */
  speed: number;
  load: number;
  nominalLoad: number;
  surface: SurfaceDef;
  /** Water depth at the wheel (m), 0 when dry. */
  water: number;
  /** Heat-up scale of the compound (`TyreDef.heat`) times the pressure's (`pressureHeat`). */
  heat: number;
}

/** New tyre temperature after `dt` seconds. */
export function stepTemp(i: TyreHeatInput, c: Climate, dt: number): number {
  const t = i.temp;
  let rate = -(AIR_COOL + AIR_COOL_V * i.speed) * (t - c.air);
  if (i.contact) {
    const s = i.surface;
    rate +=
      (i.heat *
        (SLIDE_HEAT *
          i.force *
          i.slideSpeed *
          (1 - LOOSE_SLIDE_SHARE * s.loose) +
          ROLL_HEAT * i.speed * i.load)) /
        i.nominalLoad -
      ROAD_COOL * (t - trackTemp(c, s));
  }
  if (i.water > 0)
    rate -= WATER_COOL * Math.min(1, i.water / 0.2) * (t - c.air);
  return Math.min(MAX_TEMP, t + rate * dt);
}
