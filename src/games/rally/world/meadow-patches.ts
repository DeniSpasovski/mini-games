import { Noise2D, smoothstep } from '../../../shared/noise';

/**
 * Meadow patches of the grass detail layer: a seeded low-frequency noise field turns the grass yellower and paler in dry
 * patches and a deeper green in lush ones, drifts ~5-30 m across with a slow brightness field over them, so a verge or a
 * meadow is not one stamped colour. Per instance (`AssetMeta.patches`, world/instance-streamer.ts), times the fine
 * per-instance jitter (`tint`); the field is the same on every map (explicit seeds). It also picks the variant of a
 * two-variant grass (variant 0 = the drier look): mostly 0 in dry patches, mostly 1 in lush ones.
 */
const PATCH = new Noise2D(0x6d3a);
const VALUE = new Noise2D(0x6d3b);

/** Colour gain (linear) of a full dry patch and of a full lush one. */
const DRY: readonly number[] = [1.32, 1.1, 0.68];
const LUSH: readonly number[] = [0.76, 0.93, 0.7];

/** The patch colour gain at (x, z) at `strength` (0-1) into `out` (r, g, b), and its dryness 0-1 (`out[3]`). */
export function meadowPatch(
  x: number,
  z: number,
  strength: number,
  out: number[],
): number[] {
  const a =
    PATCH.noise2(x / 26, z / 26) * 0.65 +
    PATCH.noise2(x / 9 + 41.3, z / 9 - 17.9) * 0.35;
  const dry = smoothstep(0.08, 0.5, a) * strength;
  const lush = smoothstep(-0.08, -0.5, a) * strength;
  const v = 1 + VALUE.noise2(x / 14, z / 14) * 0.1 * strength;
  for (let i = 0; i < 3; i++)
    out[i] = (1 + (DRY[i] - 1) * dry + (LUSH[i] - 1) * lush) * v;
  out[3] = smoothstep(-0.45, 0.45, a);
  return out;
}
