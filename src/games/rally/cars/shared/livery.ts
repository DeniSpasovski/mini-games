import { Rng } from '../../../../shared/rng';
import type { CarDef } from './types';

const PALETTE = [
  '#1d4fa8',
  '#c8102e',
  '#f2f0ea',
  '#111418',
  '#f5b400',
  '#0f7a3c',
  '#e05a12',
  '#5a2a86',
  '#9aa3ad',
];

export interface LiveryInfo {
  base: string;
  accent: string;
  accent2: string;
}

/**
 * Seeded paint colours: the base (seed 0 = the car's own `model.paint`) and two accents, used by every car's atlas
 * livery painter (`CarAtlas.paint`) and as the flat paint of the fallback body. No lettering: the car number + rally
 * name are a separate door decal (rally-badge.ts).
 */
export function liveryInfo(
  def: CarDef,
  seed: number,
  paint?: string,
): LiveryInfo {
  const rng = new Rng(seed * 7919 + 13);
  const base = paint ?? (seed === 0 ? def.model.paint : rng.pick(PALETTE));
  const others = PALETTE.filter((c) => c !== base);
  const accent = rng.pick(others);
  const accent2 = rng.pick(others.filter((c) => c !== accent));
  return { base, accent, accent2 };
}

/** The shape of a livery's graphics, as far as a suit or a helmet can carry it. */
export type CrewMotif =
  'plain' | 'stripes' | 'slant' | 'split' | 'peaks' | 'swoosh' | 'checker';

/**
 * What the crew wears with a livery (assets/builders/crew.ts): the suit's own colour, the colour of its graphics and a
 * second colour in them, and the motif they are drawn in. Suit and helmet match the car without copying it.
 */
export interface CrewLivery {
  main: string;
  second: string;
  third: string;
  motif: CrewMotif;
}

/** How far apart two colours are (0 = the same, ~1.7 = black to white). */
export const colorGap = (a: string, b: string): number => {
  const h = (c: string, i: number): number =>
    parseInt(c.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return Math.hypot(h(a, 0) - h(b, 0), h(a, 1) - h(b, 1), h(a, 2) - h(b, 2));
};

const CREW_WHITE = '#eeeeea';
const CREW_DARK = '#23252b';
const CREW_SILVER = '#9aa0a8';

/** The crew of a car in one plain colour: that colour with white panels (charcoal on a light car) and a dark trim. */
export function plainCrew(base: string): CrewLivery {
  const second =
    colorGap(base, CREW_WHITE) >= colorGap(base, CREW_DARK)
      ? CREW_WHITE
      : CREW_DARK;
  const rest = second === CREW_WHITE ? CREW_DARK : CREW_WHITE;
  return {
    main: base,
    second,
    third: colorGap(base, rest) > 0.3 ? rest : CREW_SILVER,
    motif: 'plain',
  };
}

/** What the crew of a car wears: its livery's own answer (`CarAtlas.crew`), else the plain suit in its paint. */
export function crewLivery(
  def: CarDef,
  info: LiveryInfo,
  seed: number,
): CrewLivery {
  const atlas = def.model.gltf?.atlas ?? def.model.custom?.atlas;
  return atlas?.crew?.(info, seed) ?? plainCrew(info.base);
}
