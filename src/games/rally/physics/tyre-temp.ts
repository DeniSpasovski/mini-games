import type { SurfaceDef } from './surfaces';

/**
 * Tyre temperature (arcade): one temperature per tyre, heated by sliding and rolling, cooled by the air and the
 * ground. Grip is a multiplier on the tyre's grip input (`TireInput.grip`), so `tire.ts` and the cached surface
 * tables stay untouched. Design + numbers: ../PHYSICS.md ("Tyre temperature").
 */

/** Air and sun of a stage. `Vehicle.setClimate`; null = no temperature (tool pages, reference tests). */
export interface Climate {
  /** Air temperature (°C). Under `Vehicle.setClimate`'s reference height it follows the car's height (`AIR_LAPSE`). */
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

/** °C below the window over which a tyre goes from `cold` to full grip. */
export const COLD_SPAN = 45;
/** °C above the window over which a tyre goes from full grip to `hot`. */
export const HOT_SPAN = 35;
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

/** Air cools with height: 6.5 K per km, the standard atmosphere. The road keeps its sun gap, so it falls with the air. */
export const AIR_LAPSE = 0.0065;

/** Air temperature (°C) `rise` metres above where `air` holds (below it when negative). */
export function airAtRise(air: number, rise: number): number {
  return air - AIR_LAPSE * rise;
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
}

/** New tyre temperature after `dt` seconds. */
export function stepTemp(i: TyreHeatInput, c: Climate, dt: number): number {
  const t = i.temp;
  let rate = -(AIR_COOL + AIR_COOL_V * i.speed) * (t - c.air);
  if (i.contact) {
    const s = i.surface;
    rate +=
      (SLIDE_HEAT * i.force * i.slideSpeed * (1 - LOOSE_SLIDE_SHARE * s.loose) +
        ROLL_HEAT * i.speed * i.load) /
        i.nominalLoad -
      ROAD_COOL * (t - trackTemp(c, s));
  }
  if (i.water > 0)
    rate -= WATER_COOL * Math.min(1, i.water / 0.2) * (t - c.air);
  return Math.min(MAX_TEMP, t + rate * dt);
}
