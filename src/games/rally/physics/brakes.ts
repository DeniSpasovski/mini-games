import type { Climate } from './tyre-temp';
import type { TyreId } from './tyres';

/**
 * Brakes from their hardware: the torque one wheel's brake gives, the friction its pads keep at a disc temperature
 * (cold bite, fade), and how the disc heats and cools. One disc / drum temperature per wheel (`WheelState.brakeTemp`,
 * bulk temperature, °C); runs only with a climate (`Vehicle.setClimate`). Pure, DOM-free. Design + numbers:
 * ../PHYSICS.md ("Brakes").
 */

export type BrakeType = 'vented' | 'solid' | 'drum';

/** Pad classes: road (Zastava), sport (M3, 22B), rally (the WRC-style cars), race (GT2). */
export type PadId = 'road' | 'sport' | 'rally' | 'race';

/** One wheel's brake. */
export interface BrakeDef {
  type: BrakeType;
  /** Disc or drum diameter (m). */
  diameter: number;
  /** Disc thickness / drum width (m). */
  thickness: number;
  pad: PadId;
  /** Force the pedal puts on the pads at full pedal (N, per wheel): the one tuned number, so `brakeTorque` stops the car. */
  clamp: number;
  /** Brake ducts feed the disc cooling air (race car). */
  ducted?: boolean;
}

/** A car's brakes per axle; the rally cars fit the smaller `gravel` kit with the 15 in wheels (mixed / gravel compounds). */
export interface BrakeSet {
  front: BrakeDef;
  rear: BrakeDef;
}

/** Discs and drums at the start line: the liaison to the stage has warmed them this far above the air (K). */
const START_WARMUP = 80;
export const brakeStartTemp = (c: Climate): number => c.air + START_WARMUP;

/** The kit fitted with a compound: the smaller gravel kit goes with the 15 in wheels of the mixed and gravel tyres. */
export function brakeKit(
  main: BrakeSet,
  gravel: BrakeSet | undefined,
  tyre: TyreId | null,
): BrakeSet {
  return gravel && (tyre === 'mixed' || tyre === 'gravel') ? gravel : main;
}

/** Friction of a pad class against disc temperature (bulk, °C): see `padFactor`. */
export interface PadDef {
  /** Friction coefficient of the lining (scale only: `BrakeDef.clamp` is tuned to it). */
  mu: number;
  /** Bites fully from this temperature, starts to fade at `fade`, bottoms out at `floor` at `floorAt`. */
  full: number;
  fade: number;
  floorAt: number;
  floor: number;
  /** Friction factor at 20 °C (cold pads bite less). */
  cold: number;
}

export const PADS: Record<PadId, PadDef> = {
  road: {
    mu: 0.38,
    full: 100,
    fade: 330,
    floorAt: 600,
    floor: 0.45,
    cold: 0.9,
  },
  sport: {
    mu: 0.42,
    full: 150,
    fade: 450,
    floorAt: 700,
    floor: 0.5,
    cold: 0.85,
  },
  rally: {
    mu: 0.55,
    full: 250,
    fade: 650,
    floorAt: 850,
    floor: 0.55,
    cold: 0.75,
  },
  race: {
    mu: 0.5,
    full: 300,
    fade: 750,
    floorAt: 950,
    floor: 0.55,
    cold: 0.65,
  },
};

/** Drum shoes: a lower window; the self-energising shoe makes the torque follow the friction harder (factor^`exponent`). */
const DRUM_PAD: PadDef = {
  mu: 0.38,
  full: 80,
  fade: 250,
  floorAt: 450,
  floor: 0.4,
  cold: 0.9,
};
const DRUM_EXPONENT = 1.4;
/** Self-energising gain of a drum (leading shoe) over a disc of the same lining. */
const DRUM_GAIN = 1.5;
/** Effective friction radius of a disc as a share of its diameter, two faces. */
const DISC_RADIUS = 0.425;

const padOf = (b: BrakeDef): PadDef =>
  b.type === 'drum' ? DRUM_PAD : PADS[b.pad];

/** Torque (N m) one wheel's brake gives at full pedal with the pads at full friction. */
export function brakeTorque(b: BrakeDef): number {
  const mu = padOf(b).mu;
  return b.type === 'drum'
    ? b.clamp * mu * b.diameter * DRUM_GAIN
    : 2 * b.clamp * mu * DISC_RADIUS * b.diameter;
}

/**
 * Share of full torque the brake gives at a disc temperature: cold pads bite less (rising to 1 at `full`), flat in the
 * window, falling from `fade` to the floor at `floorAt`. Drums follow it to the power 1.4.
 */
export function padFactor(temp: number, b: BrakeDef): number {
  const p = padOf(b);
  let f = 1;
  if (temp < p.full) {
    const cold = p.cold * 0.9;
    f = Math.max(cold, p.cold + ((1 - p.cold) * (temp - 20)) / (p.full - 20));
  } else if (temp > p.fade)
    f = Math.max(
      p.floor,
      1 - ((1 - p.floor) * (temp - p.fade)) / (p.floorAt - p.fade),
    );
  return b.type === 'drum' ? Math.pow(f, DRUM_EXPONENT) : f;
}

/** Where a temperature sits for the HUD: 0 cold ... 1 pads biting ... 2 fade starts ... 3 fade floor. */
export function brakeLevel(temp: number, b: BrakeDef): number {
  const p = padOf(b);
  if (temp < p.full) return Math.max(0, (temp - 20) / (p.full - 20));
  if (temp <= p.fade) return 1 + (temp - p.full) / (p.fade - p.full);
  return Math.min(3, 2 + (temp - p.fade) / (p.floorAt - p.fade));
}

// --- heat ---------------------------------------------------------------------------------------------------------

const IRON_DENSITY = 7200;
/** Share of the braking work that heats the disc (the rest goes into the linings). */
const DISC_HEAT_SHARE = 0.94;
/** Cast iron specific heat (J/(kg K)) against temperature (°C), linear between points. */
const IRON_C: [number, number][] = [
  [27, 450],
  [127, 491],
  [327, 555],
  [527, 692],
  [727, 1034],
];
const STEFAN = 5.67e-8;
/** Radiation: emissivity of hot iron times the view factor behind the wheel. */
const EMISSIVITY = 0.45;
/** Cooling of the ring faces by water (W/(m² K)) at 0.2 m depth and deeper. */
const WATER_H = 2000;
const DRUM_COOLING = 0.38;
/** Vane surface (`G`): vented discs cool by their vanes too, ducts feed them. */
const VANES = { solid: 1, vented: 2, drum: 1 };
const DUCT_VANES = 5;

const ironC = (t: number): number => {
  if (t <= IRON_C[0][0]) return IRON_C[0][1];
  for (let i = 1; i < IRON_C.length; i++) {
    const [t1, c1] = IRON_C[i];
    if (t <= t1) {
      const [t0, c0] = IRON_C[i - 1];
      return c0 + ((c1 - c0) * (t - t0)) / (t1 - t0);
    }
  }
  return IRON_C[IRON_C.length - 1][1];
};

/** What a disc / drum needs for its temperature, worked out once from its size. */
export interface BrakeThermal {
  /** Heated mass (kg). */
  mass: number;
  /** Cooling surface (m²) that sees the air, multiplied by the vane factor. */
  area: number;
  /** Radiating and water-cooled surface (m²). */
  faces: number;
  /** Convection coefficient scale `k` in `h = 8 + k v^0.8` (W/(m² K)). */
  k: number;
}

export function brakeThermal(b: BrakeDef): BrakeThermal {
  const D = b.diameter;
  const t = b.thickness;
  if (b.type === 'drum') {
    // Cast shell 6 mm + a 5 mm web; cools like a solid disc of the same size at 0.38.
    const shell = Math.PI * D * t * 0.006;
    const web = (Math.PI / 4) * D * D * 0.005;
    const faces = (Math.PI / 4) * D * D * 2;
    return {
      mass: IRON_DENSITY * (shell + web),
      area: DRUM_COOLING * (faces + Math.PI * D * t),
      faces: DRUM_COOLING * faces,
      k: 2.5 * Math.pow(D / 2 / 0.095, 0.6),
    };
  }
  const ringWidth = (b.pad === 'road' ? 0.18 : 0.15) * D;
  const inner = D - 2 * ringWidth;
  const ring = (Math.PI / 4) * (D * D - inner * inner);
  const solid =
    b.type === 'solid'
      ? 1
      : b.pad === 'road' || b.pad === 'sport'
        ? 0.74
        : 0.65;
  const vanes = b.ducted ? DUCT_VANES : VANES[b.type];
  return {
    mass: IRON_DENSITY * ring * t * solid,
    area: 2 * ring * vanes + Math.PI * D * t,
    faces: 2 * ring,
    k: 2.5 * Math.pow((D / 2 - ringWidth / 2) / 0.095, 0.6),
  };
}

/** What one brake needs for a temperature step. */
export interface BrakeHeatInput {
  temp: number;
  /** Braking power (W): applied torque x wheel speed. */
  power: number;
  /** Car speed (m/s): the air through the wheel. */
  speed: number;
  /** Water depth at the wheel (m), 0 when dry. */
  water: number;
}

/** New disc temperature after `dt` seconds, in the air of the stage's climate. */
export function stepBrakeTemp(
  i: BrakeHeatInput,
  th: BrakeThermal,
  c: Climate,
  dt: number,
): number {
  const t = i.temp;
  const h = 8 + th.k * Math.pow(Math.abs(i.speed), 0.8);
  const tk = t + 273;
  const ak = c.air + 273;
  let out =
    h * th.area * (t - c.air) +
    EMISSIVITY * STEFAN * th.faces * (tk * tk * tk * tk - ak * ak * ak * ak);
  if (i.water > 0)
    out += WATER_H * th.faces * Math.min(1, i.water / 0.2) * (t - c.air);
  const heat = DISC_HEAT_SHARE * Math.max(0, i.power);
  return Math.max(c.air, t + ((heat - out) * dt) / (th.mass * ironC(t)));
}
