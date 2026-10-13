/**
 * Graphics quality presets. Picked with `?quality=low|medium|high` or saved in
 * localStorage by the in-game menu. Everything perf-sensitive reads from here.
 */
export interface QualitySettings {
  name: QualityName;
  /** Cap for devicePixelRatio. */
  maxPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  /** Half-size of the shadow camera box around the focus point (m). */
  shadowExtent: number;
  /** Terrain chunks are drawn up to this distance (m). */
  viewDistance: number;
  /** Multiplies every asset LOD distance (and therefore draw distance) and the terrain LOD bands. */
  lodScale: number;
  /**
   * The procedural trees' lodScale (trees/draw.ts: divides their screen-height thresholds): lower = impostors and
   * coarser branches closer. Trees are the biggest GPU cost of a forest stage, so medium / low bring them in further
   * than the other assets; the full-detail distance (trees/species.ts) never moves.
   */
  treeLodScale: number;
  /** Trees are drawn up to this distance (m); past it the forest is painted on the ground (canopy texture). */
  forestDistance: number;
  /** Multiplies detail-layer (grass) density, 0 disables it. */
  detailDensity: number;
  /** Max dust particles alive. */
  particles: number;
}

export type QualityName = 'low' | 'medium' | 'high';

export const QUALITY: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    maxPixelRatio: 1,
    antialias: false,
    shadowMapSize: 1024,
    shadowExtent: 45,
    viewDistance: 1100,
    lodScale: 0.7,
    treeLodScale: 0.35,
    forestDistance: 450,
    detailDensity: 0.35,
    particles: 600,
  },
  medium: {
    name: 'medium',
    maxPixelRatio: 1.25,
    antialias: true,
    shadowMapSize: 2048,
    shadowExtent: 60,
    viewDistance: 1700,
    lodScale: 1,
    treeLodScale: 0.5,
    forestDistance: 700,
    detailDensity: 0.7,
    particles: 1200,
  },
  high: {
    name: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadowMapSize: 4096,
    shadowExtent: 75,
    viewDistance: 2400,
    lodScale: 1.3,
    treeLodScale: 1.3,
    forestDistance: 1100,
    detailDensity: 1,
    particles: 2000,
  },
};

const KEY = 'rally.quality';

export function loadQuality(): QualitySettings {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  let name = fromUrl as QualityName | null;
  if (!name) {
    try {
      name = localStorage.getItem(KEY) as QualityName | null;
    } catch {
      name = null;
    }
  }
  return QUALITY[
    name && Object.prototype.hasOwnProperty.call(QUALITY, name)
      ? name
      : 'medium'
  ];
}

export function saveQuality(name: QualityName): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // storage unavailable - fine, quality just won't persist
  }
}
