/**
 * Tyre detail by speed and camera distance (the racing-game trick): three meshes per wheel set, one drawn at a time
 * except while crossfading.
 *   - full: displaced tread + lettering (tyre-mesh.ts) - at rest, at low speed and close up (car viewer, start line,
 *     chase camera at rest).
 *   - sharp: the low-poly tyre with the same tread normal map and groove shading - a few metres further than the chase
 *     camera (the displaced relief is under a pixel there).
 *   - blur: the low-poly tyre with the tread smeared along the rolling direction (tyre-tread.ts) - above walking pace
 *     a turning tyre's blocks are a blur to the eye and a camera, and a sharp pattern spinning at 60 fps strobes.
 * Crossfades are screen-door dithers (complementary pixel ranges of one noise, no transparency, no pop), weighted:
 *   blur = s, sharp = (1 - s) d, full = (1 - s)(1 - d)
 * with s the speed fade and d the distance fade. Far away the lettering is left out; at speed it smears (mip bias).
 */

/** Speed crossfade full / sharp -> blur (km/h), distance crossfade full -> sharp (m from the car's centre), lettering
 * left out beyond FAR_M, and the lettering's mip bias at full blur. The chase camera sits 5.4-7.8 m behind the car's
 * centre (camera-rig.ts), so the full tyre stays in view at rest from either chase camera. */
export const TYRE_LOD = {
  blurFromKmh: 20,
  blurToKmh: 40,
  lowFromM: 9,
  lowToM: 11,
  farM: 25,
  letterBias: 4,
} as const;

export interface TyreLodShares {
  /** Screen shares (sum 1) of the full, sharp low and blurred low tyre. */
  full: number;
  sharp: number;
  blur: number;
  /** Which mesh draws the lettering (the largest share; null = none, far away). */
  letters: 'full' | 'sharp' | 'blur' | null;
  /** Mip bias of the lettering (smeared at speed). */
  letterBias: number;
}

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Shares of the three tyre levels at a speed (km/h, either direction) and camera distance (m). */
export function tyreLodShares(speedKmh: number, distM: number): TyreLodShares {
  const L = TYRE_LOD;
  const s = smooth(
    (Math.abs(speedKmh) - L.blurFromKmh) / (L.blurToKmh - L.blurFromKmh),
  );
  const d = smooth((distM - L.lowFromM) / (L.lowToM - L.lowFromM));
  const full = (1 - s) * (1 - d);
  const sharp = (1 - s) * d;
  const blur = s;
  const letters =
    distM > L.farM
      ? null
      : full >= sharp && full >= blur
        ? 'full'
        : sharp >= blur
          ? 'sharp'
          : 'blur';
  return { full, sharp, blur, letters, letterBias: s * L.letterBias };
}
