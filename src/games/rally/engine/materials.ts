import {
  DoubleSide,
  Material,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Vector2,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { getTexture } from './textures';
import { grassSheet } from './grass';
import { addNightGlow } from './night-glow';
import { houseMaterial } from './house-walls';
import { groundLitCard } from './world-shading';
import { GROUND_MEAN, groundScan } from './ground-textures';

/**
 * Shared material library. Assets reference materials by id so thousands of
 * instances / dozens of asset types share a handful of GPU programs.
 */
export type MaterialId =
  | 'foliage_card'
  | 'foliage_card_dry'
  | 'foliage_card_spring'
  | 'grass_blade'
  | 'rock'
  | 'hay'
  | 'props'
  | 'house'
  | 'people'
  | 'people_flag'
  | 'flag'
  | 'fan_flag'
  | 'chevron'
  | 'reflector'
  | 'lamp_lens'
  | 'vehicle'
  | 'village_sign';

const cache = new Map<MaterialId, Material>();

/** Seconds, shared by every waving hand flag (`people_flag`); a free-running clock so tools animate it too. */
const FLAG_TIME = { value: 0 };
let flagClock = false;
function startFlagClock(): void {
  if (flagClock || typeof requestAnimationFrame === 'undefined') return;
  flagClock = true;
  const tick = (): void => {
    FLAG_TIME.value = performance.now() / 1000;
    requestAnimationFrame(tick);
  };
  tick();
}

/**
 * Hand flags (people.ts `markFlag`): vertex colours only, lit but kept bright, and waved in the vertex shader. The
 * pole and cloth lean about the hand together (`flagRel` = vertex minus hand) and the cloth also swings about the pole
 * (`flutter` 0..1 along it); both are rigid turns, so the printed pieces on the cloth stay put on it.
 */
function peopleFlagMaterial(): Material {
  startFlagClock();
  const m = new MeshStandardMaterial({
    vertexColors: true,
    side: DoubleSide,
    roughness: 1,
  });
  m.onBeforeCompile = (shader, renderer: WebGLRenderer) => {
    Material.prototype.onBeforeCompile.call(m, shader, renderer);
    shader.uniforms.uFlagTime = FLAG_TIME;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 flagRel;
attribute float flutter;
uniform float uFlagTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
	float ph = 0.0;
#ifdef USE_INSTANCING
	ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
#endif
	float lean = 0.42 * sin(uFlagTime * 6.0 + ph) + 0.12 * sin(uFlagTime * 10.0 + ph * 2.0);
	float lc = cos(lean);
	float ls = sin(lean);
	vec3 fr = vec3(lc * flagRel.x - ls * flagRel.y, ls * flagRel.x + lc * flagRel.y, flagRel.z);
	float yw = flutter * 0.5 * sin(uFlagTime * 11.0 + ph * 1.3 + 1.0);
	float yc = cos(yw);
	float ys = sin(yw);
	fr = vec3(yc * fr.x + ys * fr.z, fr.y, -ys * fr.x + yc * fr.z);
	transformed += fr - flagRel;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
	totalEmissiveRadiance += diffuseColor.rgb * 0.45;`,
    );
  };
  m.customProgramCacheKey = () => 'people_flag';
  return m;
}

/**
 * Wind sway (`RALLY_WIND`, metres of sway per m² of height) and leaf translucency (`RALLY_FOLIAGE`) for the
 * world shading (engine/world-shading.ts): grass / reed cards bend at their tips. Trees sway in their own shader
 * (trees/draw.ts).
 */
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
    case 'foliage_card':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: grassSheet('green'),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_dry':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: grassSheet('dry'),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_spring':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: grassSheet('spring'),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'grass_blade':
      // The near grass LOD: opaque blade strips (engine/grass.ts), vertex coloured.
      m = new MeshStandardMaterial({
        vertexColors: true,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'rock':
      // The terrain's rock scan (engine/ground/rock.webp), so a boulder matches the rock on the ground beside it;
      // vertex colour only varies it (and adds the moss).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: groundScan('rock'),
        bumpMap: groundScan('rock'),
        bumpScale: 2,
        roughness: 0.88,
      });
      break;
    case 'hay':
      // Straw: the stubble scan (desaturated, mean brightness GROUND_MEAN.stubble) lifted to 1 on average, so the
      // vertex colour sets the straw colour and the scan gives the fibres.
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: groundScan('stubble'),
        bumpMap: groundScan('stubble'),
        bumpScale: 1.5,
        roughness: 0.95,
      });
      (m as MeshStandardMaterial).color.setScalar(0.5 / GROUND_MEAN.stubble);
      break;
    case 'props':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.7,
      });
      break;
    case 'house':
      m = houseMaterial();
      break;
    case 'people':
      // Figures: vertex colour x the people atlas (weave, denim, skin, hair, painted face).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('people'),
        normalMap: getTexture('people_normal'),
        normalScale: new Vector2(0.5, 0.5),
        roughness: 0.85,
      });
      break;
    case 'people_flag':
      m = peopleFlagMaterial();
      break;
    case 'flag':
      // The national flag's cloth: the printed flag, with the wind shader (RALLY_FLAG, engine/world-shading.ts).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('flag_mk'),
        roughness: 0.75,
      });
      break;
    case 'fan_flag':
      // Fan flag cloth: vertex-coloured like the props, but with the wind shader.
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: getTexture('detail'),
        roughness: 0.75,
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
      // Reflective sheeting: lights up in the car's low beam at night.
      addNightGlow(m as MeshStandardMaterial, 'retro');
      break;
    case 'reflector':
      m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
      addNightGlow(m as MeshStandardMaterial, 'retro');
      break;
    case 'lamp_lens':
      m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
      addNightGlow(m as MeshStandardMaterial, 'lamp');
      break;
  }
  m.name = id;
  if (FOLIAGE.includes(id)) {
    m.alphaToCoverage = foliageA2C;
    m.defines = { ...CARD_DEFINES };
    groundLitCard(m, 'foliage');
  }
  if (id === 'grass_blade') {
    m.defines = { ...CARD_DEFINES };
    groundLitCard(m, 'blade');
  }
  if (id === 'flag') m.defines = { RALLY_FLAG: 1 };
  if (id === 'fan_flag') m.defines = { RALLY_FLAG: 0.4 };
  cache.set(id, m);
  return m;
}

export function allMaterials(): Material[] {
  return [...cache.values()];
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
