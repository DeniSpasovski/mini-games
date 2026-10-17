import {
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  Vector4,
  type Material,
} from 'three';
import { PEOPLE_SCAN, type PersonData } from './people-scan.data';
import { addWorldUniforms } from './world-shading';

/**
 * The two scanned people (`scripts/people/bake-people.mjs`, credits: THIRD-PARTY.md): their own texture, dyed per
 * person by two masks (R top, G trousers, B skin / R hair, G shoes, B torso fill) so one texture serves every outfit.
 * Default look = the texture as it is. The vertex attribute `zone` (people-scan.ts: arm share, position along the
 * arm, height) lets an outfit recolour the skin texels of the arms (sleeves, gloves) and of the legs (shorts).
 */
export type ScanModel = 'male' | 'female';

/** Colours of one person (css colours); a missing entry keeps the texture. */
export interface ScanLook {
  top?: string;
  low?: string;
  hair?: string;
  shoe?: string;
  skin?: string;
  /** Sleeve colour (default the top). */
  sleeve?: string;
  glove?: string;
  /** How far the sleeve colour runs down the arm (0 = the texture's own sleeves, 1 = the wrist). */
  sleeveEnd?: number;
  /** Height (m, scan frame) below which the legs are bare (shorts); 0 = trousers. */
  hem?: number;
}

interface ModelMaps {
  map: Texture;
  mask: Texture;
  mask2: Texture;
}

const maps = new Map<ScanModel, ModelMaps | undefined>();

/** The model's textures; undefined without a DOM (tests). */
function modelMaps(model: ScanModel): ModelMaps | undefined {
  if (maps.has(model)) return maps.get(model);
  let made: ModelMaps | undefined;
  if (typeof document !== 'undefined') {
    const load = (uri: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(uri);
      // glTF uv: origin top left.
      t.flipY = false;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = SRGBColorSpace;
      return t;
    };
    const d: PersonData = PEOPLE_SCAN[model];
    made = {
      map: load(d.map, true),
      mask: load(d.mask, false),
      mask2: load(d.mask2, false),
    };
  }
  maps.set(model, made);
  return made;
}

const WHITE = new Color(1, 1, 1);
const cache = new Map<string, Material>();

/** Linear colour of a css colour (or white). */
const lin = (c?: string): Color => (c ? new Color(c) : WHITE.clone());

/** Material of a model in a look (shared by every figure that wears it). */
export function scanMaterial(model: ScanModel, look: ScanLook): Material {
  const key = `${model}|${look.top}|${look.low}|${look.hair}|${look.shoe}|${look.skin}|${look.sleeve}|${look.glove}|${look.sleeveEnd}|${look.hem}`;
  let m = cache.get(key);
  if (m) return m;
  const data = PEOPLE_SCAN[model];
  const t = modelMaps(model);
  m = new MeshStandardMaterial({ map: t?.map, roughness: 0.82 });
  const skin = lin(look.skin);
  const base = new Color(...data.skinBase);
  const mul = new Color(
    look.skin ? Math.min(skin.r / base.r, 2.5) : 1,
    look.skin ? Math.min(skin.g / base.g, 2.5) : 1,
    look.skin ? Math.min(skin.b / base.b, 2.5) : 1,
  );
  const u = {
    uMask: { value: t?.mask ?? null },
    uMask2: { value: t?.mask2 ?? null },
    uTop: { value: lin(look.top) },
    uLow: { value: lin(look.low) },
    uHair: { value: lin(look.hair) },
    uShoe: { value: lin(look.shoe) },
    uSleeve: { value: lin(look.sleeve ?? look.top) },
    uGlove: { value: lin(look.glove) },
    uSkinColor: { value: look.skin ? skin : new Color(...data.skinBase) },
    uSkinMul: { value: mul },
    uOn: {
      value: new Vector4(
        look.top ? 1 : 0,
        look.low ? 1 : 0,
        look.hair ? 1 : 0,
        look.shoe ? 1 : 0,
      ),
    },
    uCover: {
      value: new Vector3(
        look.sleeveEnd ?? 0,
        look.hem ?? 0,
        look.glove ? 1 : 0,
      ),
    },
    uRef: { value: new Vector4(...data.refs.slice(0, 4)) },
    uRefShoe: { value: data.refs[4] },
  };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 zone;
varying vec3 vZone;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\tvZone = zone;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vZone;
uniform sampler2D uMask;
uniform sampler2D uMask2;
uniform vec3 uTop, uLow, uHair, uShoe, uSleeve, uGlove, uSkinColor, uSkinMul, uCover;
uniform vec4 uOn, uRef;
uniform float uRefShoe;
// Keeps the fabric's light and dark detail around the garment's mean luminance.
vec3 dye(vec3 c, float lum, float ref) {
	return c * clamp(pow(lum / max(ref, 0.004), 0.6), 0.45, 1.7);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
	{
		vec3 tx = diffuseColor.rgb;
		float lum = dot(tx, vec3(0.2126, 0.7152, 0.0722));
		vec4 m1 = texture2D(uMask, vMapUv);
		vec4 m2 = texture2D(uMask2, vMapUv);
		float refCloth = mix(uRef.z, uRef.x, m1.r);
		float topW = uOn.x * clamp(m1.r + m2.b * (1.0 - m1.r) * (1.0 - m1.g), 0.0, 1.0);
		float sleeveW = uCover.x > 0.0 ? vZone.x * (1.0 - smoothstep(uCover.x - 0.02, uCover.x + 0.02, vZone.y)) : 0.0;
		float gloveW = uCover.z > 0.0 ? vZone.x * smoothstep(1.0, 1.05, vZone.y) : 0.0;
		float bareW = uCover.y > 0.0 ? (1.0 - smoothstep(uCover.y - 0.02, uCover.y + 0.02, vZone.z)) * smoothstep(0.1, 0.14, vZone.z) : 0.0;
		vec3 c = tx;
		c = mix(c, dye(uTop, lum, refCloth), topW);
		c = mix(c, dye(uLow, lum, uRef.y), m1.g * uOn.y);
		c = mix(c, tx * uSkinMul, m1.b);
		c = mix(c, dye(uHair, lum, uRef.w), m2.r * uOn.z);
		c = mix(c, dye(uShoe, lum, uRefShoe), m2.g * uOn.w);
		c = mix(c, dye(uSleeve, lum, refCloth), sleeveW);
		c = mix(c, dye(uSkinColor, lum, uRef.y), bareW);
		c = mix(c, dye(uGlove, lum, uRef.z), gloveW);
		diffuseColor.rgb = c;
	}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'people_scan';
  cache.set(key, m);
  return m;
}

let mid: Material | undefined;

/** The mid-range figures: one faceted material, the colours are in the vertices. */
export function scanMidMaterial(): Material {
  return (mid ??= new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    flatShading: true,
  }));
}
