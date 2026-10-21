import {
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Material,
} from 'three';
import { PEOPLE_BASE } from './people-base.data';
import { addWorldUniforms } from './world-shading';

/**
 * The skin of the two base bodies (`scripts/people/bake-base.mjs`, credits: THIRD-PARTY.md): one painted map each (skin,
 * brows, lips, eyes) tinted to the person's skin tone; a second map marks the eyes and teeth that keep their own colour.
 */
export type SkinLook = string;

interface SkinMaps {
  map: Texture;
  mask: Texture;
}

const maps = new Map<'male' | 'female', SkinMaps | undefined>();

/** The model's textures; undefined without a DOM (tests). */
function skinMaps(model: 'male' | 'female'): SkinMaps | undefined {
  if (maps.has(model)) return maps.get(model);
  let made: SkinMaps | undefined;
  if (typeof document !== 'undefined') {
    const load = (uri: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(uri);
      // glTF uv: origin top left.
      t.flipY = false;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = SRGBColorSpace;
      return t;
    };
    const d = PEOPLE_BASE[model];
    made = { map: load(d.map, true), mask: load(d.mask, false) };
  }
  maps.set(model, made);
  return made;
}

const cache = new Map<string, Material>();

/** Material of a body in a skin tone (shared by every figure that has it). */
export function bodySkinMaterial(
  model: 'male' | 'female',
  skin: SkinLook,
): Material {
  const key = `${model}|${skin}`;
  let m = cache.get(key);
  if (m) return m;
  const t = skinMaps(model);
  const base = new Color(...PEOPLE_BASE[model].skinBase);
  const tone = new Color(skin);
  const mul = new Color(
    Math.min(tone.r / base.r, 2.5),
    Math.min(tone.g / base.g, 2.5),
    Math.min(tone.b / base.b, 2.5),
  );
  m = new MeshStandardMaterial({ map: t?.map, roughness: 0.62 });
  const u = {
    uMask: { value: t?.mask ?? null },
    uSkinMul: { value: mul },
  };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uMask;
uniform vec3 uSkinMul;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
	{
		// The mask keeps the eyes and teeth white whatever the skin tone.
		float keep = texture2D(uMask, vMapUv).r;
		diffuseColor.rgb = mix(diffuseColor.rgb * uSkinMul, diffuseColor.rgb, keep);
	}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'people_skin';
  cache.set(key, m);
  return m;
}

let mid: Material | undefined;

/** The mid-range figures: one smooth material, the colours are in the vertices. */
export function scanMidMaterial(): Material {
  return (mid ??= new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
  }));
}
