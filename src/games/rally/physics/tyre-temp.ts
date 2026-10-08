import type { SurfaceDef } from './surfaces';

/**
 * Tyre temperature (arcade): two temperatures per tyre. The SURFACE (tread face) heats in seconds while sliding and
 * cools in seconds on a straight; the CORE (carcass) follows slowly, warmed by the surface and by flexing, so a cold
 * tyre takes a km or two to come in and a cooked one stays slow for a while. Grip follows a blend of the two
 * (`gripTemp`), as a multiplier on the tyre's grip input (`TireInput.grip`), so `tire.ts` and the cached surface tables
 * stay untouched. Design + numbers: ../PHYSICS.md ("Tyre temperature").
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

/** °C below the window over which a tyre goes from `cold` to full grip. */
export const COLD_SPAN = 45;
/** °C above the window over which a tyre goes from full grip to `hot`. */
export const HOT_SPAN = 35;
/** Sun heat on a dark surface with the sun high and no clouds (°C above the air). */
const SUN_HEAT = 24;
/** Tyres arrive at the start this much above the air (the road section from the service park). */
const START_ABOVE_AIR = 8;
/** Share of the surface temperature in the grip temperature (the rest is the core). */
const SURFACE_SHARE = 0.4;

// Surface (°C/s): sliding friction work per unit of nominal load in, heat out to the core, the air (more with
// speed) and the ground under the tyre.
const SLIDE_HEAT = 3;
const SURFACE_TO_CORE = 0.12;
const SURFACE_AIR = 0.012;
const SURFACE_AIR_V = 0.0015;
const SURFACE_ROAD = 0.03;
// Core (°C/s): carcass flex per m/s of speed, heat from the surface (the core is much heavier, so it moves
// CORE_MASS times slower) and air cooling (more with speed).
const ROLL_HEAT = 0.03;
const CORE_MASS = 12;
const CORE_AIR = 0.006;
const CORE_AIR_V = 0.0002;
/** Share of the sliding work the stones take on loose ground (gravel runs cool, tarmac hot). */
const LOOSE_SLIDE_SHARE = 0.6;
/** Water cooling (1/s, both layers) at 0.2 m depth or more. */
const WATER_COOL = 0.25;
/** Hottest a surface / core gets (°C): keeps the cool-down after a long burnout short. */
const MAX_SURFACE = 220;
const MAX_CORE = 150;

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

/** Tyre temperature at the start of a stage (°C, surface and core). */
export function startTemp(c: Climate): number {
  return c.air + START_ABOVE_AIR;
}

/** The temperature grip follows (°C): mostly the core, plus a share of the surface. */
export function gripTemp(surface: number, core: number): number {
  return core + SURFACE_SHARE * (surface - core);
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

/** What a tyre needs for one temperature step; `stepTemp` updates `surfaceTemp` / `coreTemp` in place. */
export interface TyreHeatInput {
  surfaceTemp: number;
  coreTemp: number;
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

/** Steps the surface and core temperatures by `dt` seconds; returns the new grip temperature (`gripTemp`). */
export function stepTemp(i: TyreHeatInput, c: Climate, dt: number): number {
  const ts = i.surfaceTemp;
  const tc = i.coreTemp;
  const toCore = SURFACE_TO_CORE * (ts - tc);
  let rs = -toCore - (SURFACE_AIR + SURFACE_AIR_V * i.speed) * (ts - c.air);
  let rc =
    toCore / CORE_MASS - (CORE_AIR + CORE_AIR_V * i.speed) * (tc - c.air);
  if (i.contact) {
    const s = i.surface;
    rs +=
      (SLIDE_HEAT *
        i.force *
        i.slideSpeed *
        (1 - LOOSE_SLIDE_SHARE * s.loose)) /
        i.nominalLoad -
      SURFACE_ROAD * (ts - trackTemp(c, s));
    rc += (ROLL_HEAT * i.speed * i.load) / i.nominalLoad;
  }
  if (i.water > 0) {
    const w = WATER_COOL * Math.min(1, i.water / 0.2);
    rs -= w * (ts - c.air);
    rc -= w * (tc - c.air);
  }
  i.surfaceTemp = Math.min(MAX_SURFACE, ts + rs * dt);
  i.coreTemp = Math.min(MAX_CORE, tc + rc * dt);
  return gripTemp(i.surfaceTemp, i.coreTemp);
}
