import {
  DoubleSide,
  Material,
  MeshDepthMaterial,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { getTexture } from './textures';
import { addWorldUniforms } from './world-shading';

/**
 * Shared material library. Assets reference materials by id so thousands of
 * instances / dozens of asset types share a handful of GPU programs.
 */
export type MaterialId =
  | 'vegetation'
  | 'foliage_card'
  | 'foliage_card_dry'
  | 'foliage_card_spring'
  | 'rock'
  | 'props'
  | 'chevron'
  | 'vehicle'
  | 'village_sign'
  | 'tree_impostor';

const cache = new Map<MaterialId, Material>();

/**
 * Wind sway (`RALLY_WIND`, metres of sway per m² of height) and leaf translucency (`RALLY_FOLIAGE`) for the
 * world shading (engine/world-shading.ts). Trees bend at the top, grass / reed cards at their tips.
 */
const TREE_DEFINES = { RALLY_WIND: 0.0009, RALLY_FOLIAGE: 0.3 };
const CARD_DEFINES = { RALLY_WIND: 0.1, RALLY_FOLIAGE: 0.25, RALLY_GROUND: 1 };

const FOLIAGE: MaterialId[] = [
  'foliage_card',
  'foliage_card_dry',
  'foliage_card_spring',
];
let foliageA2C = false;

/**
 * Grass / leaf cards: alpha-to-coverage when the renderer has MSAA (smooth, non-shimmering card edges at no cost;
 * three keeps the `alphaTest` cut and antialiases across it). Without MSAA it would do nothing: plain alpha test.
 * `createRenderer` calls this with the quality preset's `antialias`.
 */
export function setFoliageAntialias(on: boolean): void {
  foliageA2C = on;
  for (const id of FOLIAGE) {
    const m = cache.get(id);
    for (const x of m ? [m, variantMats.get(m)] : [])
      if (x && x.alphaToCoverage !== on) {
        x.alphaToCoverage = on;
        x.needsUpdate = true;
      }
  }
}

export function getMaterial(id: MaterialId): Material {
  let m = cache.get(id);
  if (m) return m;
  switch (id) {
    case 'vegetation':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.92,
      });
      m.defines = { ...TREE_DEFINES };
      break;
    case 'foliage_card':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_dry':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card_dry'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_spring':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('grass_card_spring'),
        alphaTest: 0.45,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'rock':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('rock'),
        bumpMap: getTexture('rock'),
        bumpScale: 2,
        roughness: 0.88,
      });
      break;
    case 'props':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.7,
      });
      break;
    case 'vehicle':
      // Vertex-coloured paint; the decals atlas supplies the lettering (plain faces sample its white corner).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('vehicle_decals'),
        roughness: 0.42,
        metalness: 0.3,
      });
      break;
    case 'village_sign':
      m = new MeshStandardMaterial({
        map: getTexture('village_sign'),
        roughness: 0.55,
        side: DoubleSide,
      });
      break;
    case 'chevron':
      m = new MeshStandardMaterial({
        map: getTexture('chevron'),
        roughness: 0.55,
      });
      break;
    case 'tree_impostor':
      m = impostorMaterial();
      break;
  }
  m.name = id;
  if (FOLIAGE.includes(id)) {
    m.alphaToCoverage = foliageA2C;
    m.defines = { ...CARD_DEFINES };
  }
  cache.set(id, m);
  return m;
}

export function allMaterials(): Material[] {
  return [...cache.values()];
}

/**
 * Far trees (assets/impostor.ts): a flat diamond turned to face the camera in the vertex shader - 2 triangles
 * instead of an 8-face crown. Geometry x = sideways offset, y = height; the instance matrix places the axis.
 * Lit like a crown seen from the front (normal towards the camera, tipped up), no wind (sub-pixel).
 */
function impostorMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  m.defines = { RALLY_FOLIAGE: TREE_DEFINES.RALLY_FOLIAGE };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\ntransformedNormal = normalize( vec3( 0.0, 0.55, 1.0 ) );',
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( 0.0, transformed.y, 0.0, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	float impostorScale = length( instanceMatrix[ 0 ].xyz );
#else
	float impostorScale = 1.0;
#endif
mvPosition = modelViewMatrix * mvPosition;
mvPosition.x += transformed.x * impostorScale;
gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  m.customProgramCacheKey = () => 'tree-impostor-v1';
  return m;
}

/**
 * Variant sets (assets/library.ts `getVariantSet`): every variant of an asset in ONE geometry, each vertex tagged with
 * its `variantId`; the instance picks one with the per-instance `instVariant` attribute and the vertex shader clips
 * the other variants' triangles (all three corners to one point outside the clip volume). One draw per (asset, LOD,
 * material) instead of one per variant - the GPU runs the vertex shader over every variant, so keep sets small.
 */
const VARIANT_PARS = /* glsl */ `
attribute float variantId;
attribute float instVariant;`;
const VARIANT_CLIP = /* glsl */ `#include <project_vertex>
	if ( abs( variantId - instVariant ) > 0.5 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );`;

function injectVariants(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VARIANT_PARS}`)
    .replace('#include <project_vertex>', VARIANT_CLIP);
}

const variantMats = new Map<Material, Material>();
const variantDepth = new Map<Material, MeshDepthMaterial>();

/** `base` for variant-set meshes (cached; its own `onBeforeCompile`, or the world-shading default, runs first). */
export function variantMaterial(base: Material): Material {
  let m = variantMats.get(base);
  if (m) return m;
  m = base.clone();
  const baseHook = Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')
    ? base.onBeforeCompile
    : Material.prototype.onBeforeCompile;
  const baseKey = base.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer: WebGLRenderer) => {
    baseHook.call(base, shader, renderer);
    injectVariants(shader);
  };
  m.customProgramCacheKey = () => `${baseKey}|variants`;
  variantMats.set(base, m);
  return m;
}

/** Shadow-pass material for variant-set meshes of `base` (`customDepthMaterial`; three copies map / alphaTest onto it). */
export function variantDepthMaterial(base: Material): MeshDepthMaterial {
  let m = variantDepth.get(base);
  if (m) return m;
  m = new MeshDepthMaterial();
  m.onBeforeCompile = (shader) => injectVariants(shader);
  m.customProgramCacheKey = () => 'depth|variants';
  variantDepth.set(base, m);
  return m;
}
