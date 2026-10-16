import {
  SPECTATOR_FLAG_FROM,
  SPECTATOR_SEATED_COUNT,
  SPECTATOR_SEATED_FROM,
  SPECTATOR_VARIANTS,
} from '../assets/catalog';
import type { Country } from '../maps/shared/types';

/** Share of the standing fans that wave their country's hand flag. */
export const FLAG_SHARE = 0.4;

/** Index of the first hand-flag variant of a country (6 outfits each: North Macedonia, then the USA). */
const FLAG_BASE: Record<Country, number> = {
  mk: SPECTATOR_FLAG_FROM,
  us: SPECTATOR_FLAG_FROM + 6,
};

/** The hand-flag spectator variant for `country`, picked by `r` in [0, 1). */
export const flagVariant = (country: Country, r: number): number =>
  FLAG_BASE[country] + Math.min(5, Math.floor(r * 6));

/**
 * A spectator variant for a map in `country`, from ONE random number `r` in [0, 1) (so callers keep their random
 * sequence): a share of the standing fans wave the country's flag - never another country's, whatever the variant
 * count says. `standing` = no sitting / squatting ones.
 */
export function fanVariant(
  r: number,
  country: Country | undefined,
  standing = false,
): number {
  const n = standing
    ? SPECTATOR_VARIANTS
    : SPECTATOR_SEATED_FROM + SPECTATOR_SEATED_COUNT;
  if (country && r < FLAG_SHARE) return flagVariant(country, r / FLAG_SHARE);
  const rest = country ? (r - FLAG_SHARE) / (1 - FLAG_SHARE) : r;
  return Math.min(n - 1, Math.floor(rest * n));
}
