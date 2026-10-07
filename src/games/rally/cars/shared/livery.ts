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
