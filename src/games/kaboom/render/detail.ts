import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  TextureLoader,
  type Texture,
} from 'three';
import type { LevelId } from '../game/levels';

/**
 * Each level's detail tile (DETAILS.md "Style"): 512 px, baked from Poly Haven (CC0) scans by
 * `scripts/kaboom/bake-textures.py` (sources and credits: THIRD-PARTY.md). Red = the ground (terraces, rim, margin,
 * meadow, decks), green = the second surface (cliff and walls, bare soil, hulls), blue = boulders (Valley), all grey
 * around 0.5. The scenery material
 * multiplies its painted vertex colours by them, projected in world space from three sides, where a vertex asks for it
 * (`aDetail`, written by `part()`). `tile` = metres per tile (the bake's number), `strength` = how far the texture may
 * lighten or darken the paint.
 */
const LEVELS: Record<LevelId, { url: string; tile: number; strength: number }> =
  {
    quarry: {
      url: new URL('../assets/textures/quarry.webp', import.meta.url).href,
      tile: 2.4,
      strength: 1,
    },
    valley: {
      url: new URL('../assets/textures/valley.webp', import.meta.url).href,
      tile: 2.0,
      strength: 0.9,
    },
    sea: {
      url: new URL('../assets/textures/sea.webp', import.meta.url).href,
      tile: 1.5,
      strength: 0.85,
    },
  };

export interface DetailUniforms {
  uDetail: { value: Texture };
  uDetailTile: { value: number };
  uDetailK: { value: number };
}

/** Neutral grey: the texture changes nothing until the tile has loaded (and in node, where nothing loads). */
let grey: DataTexture | null = null;
const cache = new Map<LevelId, DetailUniforms>();

/** The uniforms of `level`'s detail tile, shared by every material that uses it; the tile loads on first use. */
export function levelDetail(level: LevelId): DetailUniforms {
  let u = cache.get(level);
  if (u) return u;
  grey ??= new DataTexture(
    new Uint8Array([128, 128, 128, 255]),
    1,
    1,
    RGBAFormat,
  );
  grey.needsUpdate = true;
  const spec = LEVELS[level];
  u = {
    uDetail: { value: grey },
    uDetailTile: { value: spec.tile },
    uDetailK: { value: spec.strength },
  };
  cache.set(level, u);
  if (typeof document !== 'undefined') {
    const uniforms = u;
    new TextureLoader().load(spec.url, (tex) => {
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.colorSpace = NoColorSpace;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      uniforms.uDetail.value = tex;
    });
  }
  return u;
}
