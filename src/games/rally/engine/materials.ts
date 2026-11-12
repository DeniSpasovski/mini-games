import {
  Color,
  DoubleSide,
  Material,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Vector2,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { getTexture } from './textures';
import { plantSheet, cardColor } from './grass';
import { addNightGlow } from './night-glow';
import { houseMaterial } from './house-walls';
import { groundLitCard, worldUniforms } from './world-shading';
import { imageTexture } from './image-texture';
import rockColorUrl from './props/rocks.color.webp';
import debrisColorUrl from './props/simready-forest.color.webp';
import debrisNormalUrl from './props/simready-forest.normal.webp';
import rockNormalUrl from './props/rocks.normal.webp';
import outcropColorUrl from './props/outcrop.color.webp';
import outcropNormalUrl from './props/outcrop.normal.webp';
import strawUrl from './props/straw.webp';

/**
 * Shared material library. Assets reference materials by id so thousands of
 * instances / dozens of asset types share a handful of GPU programs.
 */
export type MaterialId =
  | 'foliage_card'
  | 'foliage_card_dry'
  | 'foliage_card_spring'
  | 'foliage_card_weeds'
  | 'foliage_card_reeds'
  | 'foliage_card_ferns'
  | 'foliage_card_ferns_autumn'
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
  | 'debris'
  | 'outcrop'
  | 'village_sign';

const cache = new Map<MaterialId, Material>();

let straw: Texture | undefined;
/** The hay bales' straw tile (repeat it every `STRAW_SIZE` metres). */
export function strawTexture(): Texture {
  straw ??= imageTexture(strawUrl, 512, 256, 'straw');
  return straw;
}
/** Size of the straw tile on a bale (m): width, height. */
export const STRAW_SIZE: [number, number] = [0.94, 0.55];

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

/** Grass cards cut lower than the other cards: the scans' thin blades keep their body at a distance (the tufts
 * stay a meadow, not a few stalks over bare ground). */
const GRASS_CARD_ALPHA = 0.35;

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
  'foliage_card_weeds',
  'foliage_card_reeds',
  'foliage_card_ferns',
  'foliage_card_ferns_autumn',
];
let foliageA2C = false;

/**
 * Grass / leaf cards: alpha-to-coverage when the renderer has MSAA (smooth, non-shimmering card edges at no cost;
 * three keeps the `alphaTest` cut and antialiases across it). Without MSAA it would do nothing: plain alpha test.
 * `createRenderer` calls this with the quality preset's `antialias`.
 */
export function setFoliageAntialias(on: boolean): void {
  foliageA2C = on;
  setAlphaToCoverage(
    FOLIAGE.map((id) => cache.get(id)),
    on,
  );
}

/**
 * Alpha-to-coverage on card materials and their variant-set / level-fade copies (`variantMaterial`, `lodFadeMaterial`):
 * a fade copy must match its plain material (grass, vines, crops).
 */
export function setAlphaToCoverage(
  bases: Iterable<Material | undefined>,
  on: boolean,
): void {
  for (const m of bases) {
    if (!m) continue;
    const v = variantMats.get(m);
    for (const x of [m, v, fadeMats.get(m), v && fadeMats.get(v)])
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
        map: plantSheet('grass-green'),
        color: new Color(...cardColor('grass-green')),
        alphaTest: GRASS_CARD_ALPHA,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_dry':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: plantSheet('grass-dry'),
        color: new Color(...cardColor('grass-dry')),
        alphaTest: GRASS_CARD_ALPHA,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_spring':
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: plantSheet('grass-spring'),
        color: new Color(...cardColor('grass-spring')),
        alphaTest: GRASS_CARD_ALPHA,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_weeds':
      // Nettles and weeds (engine/plants/weeds.webp).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: plantSheet('weeds'),
        color: new Color(...cardColor('weeds')),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_reeds':
      // Reed beds and cattails (engine/plants/reeds.webp).
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: plantSheet('reeds'),
        color: new Color(...cardColor('reeds')),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'foliage_card_ferns':
    case 'foliage_card_ferns_autumn': {
      // Fern stands of the shaded woods, green / dead bracken (engine/plants/ferns*.webp).
      const sheet = id === 'foliage_card_ferns' ? 'ferns' : 'ferns-autumn';
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: plantSheet(sheet),
        color: new Color(...cardColor(sheet)),
        alphaTest: 0.5,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    }
    case 'grass_blade':
      // The near grass LOD: opaque blade strips (engine/grass.ts), vertex coloured.
      m = new MeshStandardMaterial({
        vertexColors: true,
        side: DoubleSide,
        roughness: 1,
      });
      break;
    case 'rock': {
      // Scanned stones (Poly Haven "Rock Moss Set 01", engine/props/rocks.*.webp, scripts/rocks/bake-rocks.mjs): the
      // set's own colour and normal maps; vertex colour only varies the tone between stones.
      const map = imageTexture(rockColorUrl, 1024, 1024, 'rocks');
      const normalMap = imageTexture(
        rockNormalUrl,
        1024,
        1024,
        'rocks:normal',
        '#8080ff',
        false,
      );
      for (const t of [map, normalMap]) t.flipY = false; // glTF UVs
      m = new MeshStandardMaterial({
        vertexColors: true,
        map,
        normalMap,
        roughness: 0.9,
      });
      break;
    }
    case 'outcrop': {
      // Rock bands of steep hillsides (builders/outcrops.ts): two Poly Haven rock-face scans in their own colour and
      // normal maps side by side (engine/props/outcrop.*.webp, scripts/rocks/bake-outcrops.mjs); lit like the ground.
      const map = imageTexture(outcropColorUrl, 1024, 512, 'outcrop');
      const normalMap = imageTexture(
        outcropNormalUrl,
        1024,
        512,
        'outcrop:normal',
        '#8080ff',
        false,
      );
      for (const t of [map, normalMap]) t.flipY = false; // glTF UVs
      m = new MeshStandardMaterial({
        vertexColors: true,
        map,
        normalMap,
        roughness: 0.92,
      });
      break;
    }
    case 'hay':
      // Straw: a bale side from a photo scan (engine/props/straw.webp, scripts/props/bake-straw.py), ~0.94 x 0.55 m.
      m = new MeshStandardMaterial({
        vertexColors: true,
        map: strawTexture(),
        bumpMap: strawTexture(),
        bumpScale: 0.8,
        roughness: 0.95,
      });
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
        alphaTest: 0.5,
        roughness: 0.42,
        metalness: 0.3,
      });
      break;
    case 'debris': {
      // Forest-floor scans (stumps, logs, branches, roots: builders/simready.ts) in their own colour and normal maps,
      // one atlas tile each (scripts/props/bake-simready.py `forest`); lit like the ground they lie on (RALLY_GROUND).
      const map = imageTexture(debrisColorUrl, 2048, 1024, 'debris');
      const normalMap = imageTexture(
        debrisNormalUrl,
        1024,
        512,
        'debris:normal',
        '#8080ff',
        false,
      );
      m = new MeshStandardMaterial({
        vertexColors: true,
        map,
        normalMap,
        roughness: 0.95,
      });
      break;
    }
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
      addNightGlow(m as MeshStandardMaterial, 'sheeting');
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
  if (id === 'debris' || id === 'outcrop') m.defines = { RALLY_GROUND: 1 };
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

const fadeMats = new Map<Material, Material>();
const fadeDepth = new Map<string, MeshDepthMaterial>();

/**
 * `base` with the dithered level fade (world/lod-fade.ts `RALLY_LOD_FADE`), cached. The instance streamer draws a bucket
 * with it only while one of its instances fades: the dither's `discard` would cost every other draw of the shared
 * material its early depth test. Its own `onBeforeCompile` (or the world-shading default) runs first.
 */
export function lodFadeMaterial(base: Material): Material {
  let m = fadeMats.get(base);
  if (m) return m;
  m = base.clone();
  // (copy() resets a standard material's defines.)
  m.defines = { ...base.defines, RALLY_LOD_FADE: '' };
  const baseHook = Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')
    ? base.onBeforeCompile
    : Material.prototype.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer: WebGLRenderer) =>
    baseHook.call(base, shader, renderer);
  m.customProgramCacheKey = () => `${base.customProgramCacheKey()}|fade`;
  m.name = `${base.name}|fade`;
  fadeMats.set(base, m);
  return m;
}

/**
 * Shadow pass of a fading bucket (`customDepthMaterial`; three copies map / alphaTest onto it): one copy casts, the
 * outgoing level until halfway, then the incoming one (`RALLY_LOD_FADE_SHADOW`), never both. `variants` = a variant set.
 */
export function lodFadeDepthMaterial(
  base: Material,
  variants: boolean,
): MeshDepthMaterial {
  const key = `${base.uuid}|${variants}`;
  let m = fadeDepth.get(key);
  if (m) return m;
  m = new MeshDepthMaterial();
  m.defines = { RALLY_LOD_FADE: '', RALLY_LOD_FADE_SHADOW: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    if (variants) injectVariants(shader);
  };
  m.customProgramCacheKey = () => `depth|fade${variants ? '|variants' : ''}`;
  fadeDepth.set(key, m);
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
