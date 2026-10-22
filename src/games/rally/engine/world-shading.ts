import {
  Color,
  Material,
  ShaderChunk,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { gradeUniforms } from './grade';

/**
 * World shading shared by every material of the rally pages, installed once when this module is imported
 * (`engine/environment.ts` imports it):
 *
 * - **Cloud shadows:** the sun's direct light is dimmed under drifting clouds (world-space noise from the `macro`
 *   texture, projected along the sun onto a cloud layer). Every lit material (standard / physical / lambert).
 * - **Canopy shadows:** ground materials (`defines.RALLY_GROUND`: terrain, roads, grass cards) lose the sun under a
 *   baked top-down tree-shadow texture (world/canopy-shadows.ts) - only outside the sun's shadow-map box, which
 *   already draws the real tree shadows near the car.
 * - **Height fog + sun glow:** `FogExp2` whose density falls off with height above the focus point (valleys hazier,
 *   hill tops and aerial views clearer) and a fog colour that warms towards the sun. Every material with `fog`
 *   (incl. the dust).
 * - **Wind:** vertex sway for materials with `defines.RALLY_WIND` (= sway per metre² of height above the asset
 *   origin; foliage materials in `engine/materials.ts`), phase from the instance position.
 * - **Flags:** cloth materials with `defines.RALLY_FLAG` fly downwind and ripple (`FLAG_VERTEX`).
 * - **Leaf translucency:** materials with `defines.RALLY_FOLIAGE` glow a little when the sun is behind them.
 *
 * How: ShaderChunk overrides (fog, begin_vertex, lights) that read the `ws*` uniforms below, and a default
 * `Material.onBeforeCompile` that hands those uniforms (shared objects) to every program. Materials with their own
 * `onBeforeCompile` (terrain, lamps) call `addWorldUniforms(shader)`; ShaderMaterials (dust) merge `worldUniforms`
 * and include `WORLD_SHADING_DECL`. A program that never gets the uniforms reads 0 = everything off, i.e. plain
 * three.js shading - so pages that never call `setWorldShading` look exactly as before.
 */

/** Shared uniform objects (same references in every program). */
export const worldUniforms = {
  wsTime: { value: 0 },
  wsSunDir: { value: new Vector3(0, 1, 0) },
  /** x strength (0 = off), y coverage 0..1, z noise frequency (1/m), w cloud layer height above the ground (m). */
  wsCloud: { value: new Vector4(0, 0.4, 1 / 1000, 1200) },
  /** xy cloud drift (m/s), z foliage sway strength (0 = still), w sway frequency (rad/s). */
  wsWind: { value: new Vector4(4.2, 4.2, 0, 1.3) },
  /** xyz sun glow added to the fog colour towards the sun (linear, 0 = off), w height falloff (1/m, 0 = off). */
  wsFog: { value: new Vector4(0, 0, 0, 0) },
  /** Height (m) where the fog has the map's `fogDensity`: the focus point (car / orbit target), `setFogBase`. */
  wsFogBase: { value: 0 },
  wsMacro: { value: null as Texture | null },
  /** Canopy shadow texture (world/canopy-shadows.ts) and its ground mapping: x0, z0, 1/width, 1/depth. */
  wsCanopy: { value: null as Texture | null },
  wsCanopyMap: { value: new Vector4(0, 0, 0, 0) },
  /** The finer canopy window following the camera (world/canopy-shadows.ts) and its ground mapping. */
  wsCanopyLocal: { value: null as Texture | null },
  wsCanopyLocalMap: { value: new Vector4(0, 0, 0, 0) },
  /** Shadow-map box on the ground: centre x, z, half extent (m), canopy shadow strength (0 = off). */
  wsShadowBox: { value: new Vector4(0, 0, 60, 0) },
  /**
   * Canopy shadows fade in between these distances from the camera (m; y = 0: at the shadow box's edge instead):
   * where the trees stop casting real shadows (`setCanopyFade`).
   */
  wsCanopyFade: { value: new Vector2(0, 0) },
  /**
   * The far forest painted on the ground (`setForest`): canopy colour (linear) and the distance (m) where the trees
   * end; the ground under the canopy texture turns this colour over the last quarter before it (w = 0: off).
   */
  wsForest: { value: new Vector4(0, 0, 0, 0) },
  /** The car's low beam in world space (`engine/night-glow.ts`): colour x strength (black = lights off), lamp position, aim. */
  wsHead: { value: new Color(0, 0, 0) },
  wsHeadPos: { value: new Vector3() },
  wsHeadDir: { value: new Vector3(0, 0, 1) },
  /** 0..1: how much the street lamps glow (`Environment.lightNeed`). */
  wsLamp: { value: 0 },
  // Colour grade (engine/grade.ts), declared in the tone-mapping chunk.
  ...gradeUniforms,
};
// Dev: tweak live from the console (`__worldShading.wsCloud.value.x = 1`).
(globalThis as { __worldShading?: typeof worldUniforms }).__worldShading =
  worldUniforms;

/** Give a program the world uniforms (for materials that replace `onBeforeCompile`). */
export function addWorldUniforms(
  shader: WebGLProgramParametersWithUniforms,
): void {
  Object.assign(shader.uniforms, worldUniforms);
}

/**
 * Grass / crop cards lit like the ground under them: their normals point up, and three would turn them down on a
 * card's back face (dark backs). No specular either: the camera sees an up-facing card at a grazing angle, where the
 * Fresnel sky reflection whitens it like a sheet of glass (worst on tall cards: reeds, corn). `key` names the
 * program (one per material kind).
 */
export function groundLitCard(m: Material, key: string): void {
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );',
      )
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\treflectedLight.directSpecular = vec3( 0.0 );\n\treflectedLight.indirectSpecular = vec3( 0.0 );',
      );
  };
  m.customProgramCacheKey = () => `ground-lit-card|${key}`;
}

export interface WorldShadingSettings {
  sunDir: Vector3;
  sunColor: Color;
  /** 0..1 how dark cloud shadows get (0 = off). */
  cloudShadow: number;
  cloudCoverage: number;
  /** Cloud drift speed multiplier. */
  cloudSpeed: number;
  /** Foliage sway multiplier (0 = still). */
  wind: number;
  /** Fog sun glow (multiplies the sun colour, 0 = off). */
  fogSunGlow: number;
  /** Fog height falloff (1/m, 0 = flat fog). */
  fogFalloff: number;
  macro: Texture;
}

export function setWorldShading(s: WorldShadingSettings): void {
  const u = worldUniforms;
  u.wsSunDir.value.copy(s.sunDir).normalize();
  u.wsCloud.value.x = s.cloudShadow;
  u.wsCloud.value.y = s.cloudCoverage;
  u.wsWind.value.x = 4.2 * s.cloudSpeed;
  u.wsWind.value.y = 2.4 * s.cloudSpeed;
  u.wsWind.value.z = s.wind;
  const glow = s.fogSunGlow;
  u.wsFog.value.set(
    s.sunColor.r * glow,
    s.sunColor.g * glow,
    s.sunColor.b * glow,
    s.fogFalloff,
  );
  u.wsMacro.value = s.macro;
}

/** Baked canopy shadows (null = off) and how dark they get. */
export function setCanopyShadows(
  texture: Texture | null,
  map: { x0: number; z0: number; invW: number; invD: number },
  strength: number,
  local?: {
    texture: Texture;
    map: { x0: number; z0: number; invW: number; invD: number };
  },
): void {
  const u = worldUniforms;
  u.wsCanopy.value = texture;
  u.wsCanopyMap.value.set(map.x0, map.z0, map.invW, map.invD);
  u.wsCanopyLocal.value = local?.texture ?? null;
  if (local) setCanopyLocalMap(local.map);
  u.wsShadowBox.value.w = texture ? strength : 0;
}

/** Where the local canopy window is on the ground (call after it moved: `CanopyShadows.update`). */
export function setCanopyLocalMap(map: {
  x0: number;
  z0: number;
  invW: number;
  invD: number;
}): void {
  worldUniforms.wsCanopyLocalMap.value.set(map.x0, map.z0, map.invW, map.invD);
}

/** Canopy shadows fade in from `start` to `end` m from the camera (where trees stop casting real shadows). */
export function setCanopyFade(start: number, end: number): void {
  worldUniforms.wsCanopyFade.value.set(start, end);
}

/** The far forest on the ground: canopy colour (linear) and where the trees end (m; 0 = off). */
export function setForest(color: Color, distance: number): void {
  worldUniforms.wsForest.value.set(color.r, color.g, color.b, distance);
}

/** Where the sun's shadow map is (canopy shadows fade in outside it; call every frame). */
export function setShadowBox(x: number, z: number, halfExtent: number): void {
  const b = worldUniforms.wsShadowBox.value;
  b.x = x;
  b.y = z;
  b.z = halfExtent;
}

/** Height where the fog has its nominal density (the ground at the focus point; call every frame). */
export function setFogBase(height: number): void {
  worldUniforms.wsFogBase.value = height;
}

/** Seconds, drives cloud drift and foliage sway (call every frame). */
export function setWorldTime(seconds: number): void {
  worldUniforms.wsTime.value = seconds;
}

// --- GLSL ------------------------------------------------------------------------------------------------------

/** Uniform declarations, guarded so several chunks of one stage can include them (custom shaders too). */
export const WORLD_SHADING_DECL = /* glsl */ `
#ifndef WS_DECL
#define WS_DECL
uniform float wsTime;
uniform vec3 wsSunDir;
uniform vec4 wsCloud;
uniform vec4 wsWind;
uniform vec4 wsFog;
uniform float wsFogBase;
#endif
`;

/** World position of a view-space position (inverse of the camera's view matrix, rigid). */
const WORLD_FROM_VIEW = /* glsl */ `transpose( mat3( viewMatrix ) ) * ( %v - viewMatrix[ 3 ].xyz )`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
${WORLD_SHADING_DECL}
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = ${WORLD_FROM_VIEW.replace('%v', 'mvPosition.xyz')};
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
${WORLD_SHADING_DECL}
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	vec3 wsFogRay = vFogWorld - cameraPosition;
	#ifdef FOG_EXP2
		float wsFogDensity = fogDensity;
		if ( wsFog.w > 0.0 ) {
			// Density ~ exp( -k ( h - base ) ): its mean along the camera -> point ray, capped (deep valleys).
			float kdh = wsFog.w * wsFogRay.y;
			float wsMean = exp( - wsFog.w * ( cameraPosition.y - wsFogBase ) ) * ( abs( kdh ) > 1e-3 ? ( 1.0 - exp( - kdh ) ) / kdh : 1.0 );
			wsFogDensity *= min( wsMean, 2.5 );
		}
		float fogFactor = 1.0 - exp( - wsFogDensity * wsFogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 wsFogCol = fogColor;
	if ( wsFog.x + wsFog.y + wsFog.z > 0.0 ) {
		float wsSunAmt = max( dot( normalize( wsFogRay ), wsSunDir ), 0.0 );
		wsFogCol += wsFog.xyz * ( wsSunAmt * wsSunAmt * wsSunAmt * wsSunAmt * wsSunAmt * wsSunAmt );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, wsFogCol, fogFactor );
#endif
`;

/**
 * Flag cloth (`defines.RALLY_FLAG` = wavelength scale, 1 = a 3.6 m flag): the cloth is turned about its pole to fly
 * downwind (the clouds' drift, veering a little with the gusts) and ripples with waves that travel down it and grow
 * towards the free end, with the foliage's wind clock, gusts and strength (`wsWind.z`, 0 = still). Declares `wsFm`
 * (the instance's world matrix) and the named yaw (to turn by).
 */
const FLAG_THETA = (v: string): string => /* glsl */ `
		mat4 wsFm = modelMatrix;
		#ifdef USE_INSTANCING
			wsFm = modelMatrix * instanceMatrix;
		#endif
		float ${v} = 0.0;
		vec2 wsFa = ( wsFm * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xz;
		if ( wsWind.z > 0.0 && dot( wsFa, wsFa ) > 1e-6 ) {
			float wsFv = 0.25 * sin( wsTime * 0.17 + dot( wsFm[ 3 ].xz, vec2( 0.011, 0.007 ) ) );
			${v} = atan( wsFa.y, wsFa.x ) - ( atan( wsWind.y, wsWind.x ) + wsFv );
		}`;

const FLAG_VERTEX = /* glsl */ `
#ifdef RALLY_FLAG
	{
		${FLAG_THETA('wsFth')}
		if ( wsWind.z > 0.0 ) {
			float wsX = max( position.x - 0.05, 0.0 );
			float wsK = 1.0 / float( RALLY_FLAG );
			float wsGu = 0.6 + 0.4 * sin( wsTime * 0.31 + dot( wsFm[ 3 ].xz, vec2( 0.011, 0.007 ) ) );
			float wsT = wsTime * wsWind.w * 2.2;
			float wsAmp = 0.09 * wsWind.z * wsGu * wsX;
			transformed.z += wsAmp * ( sin( 5.5 * wsK * wsX - wsT ) + 0.4 * sin( 10.0 * wsK * wsX - 1.7 * wsT + 1.3 ) );
			transformed.y += 0.5 * wsAmp * cos( 4.0 * wsK * wsX - 0.9 * wsT + 0.7 );
			transformed.x -= 0.18 * wsAmp * ( 0.5 + 0.5 * sin( 5.5 * wsK * wsX - wsT ) );
			float wsC = cos( wsFth );
			float wsS = sin( wsFth );
			transformed.xz = vec2( wsC * transformed.x + wsS * transformed.z, - wsS * transformed.x + wsC * transformed.z );
		}
	}
#endif
`;

/** The cloth's normals turn with it (appended to `beginnormal_vertex`). */
const FLAG_NORMAL = /* glsl */ `
#ifdef RALLY_FLAG
	{
		${FLAG_THETA('wsFthN')}
		float wsCn = cos( wsFthN );
		float wsSn = sin( wsFthN );
		objectNormal.xz = vec2( wsCn * objectNormal.x + wsSn * objectNormal.z, - wsSn * objectNormal.x + wsCn * objectNormal.z );
	}
#endif
`;

const BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif
#ifdef RALLY_WIND
	if ( wsWind.z > 0.0 ) {
		vec3 wsBase = vec3( 0.0 );
		#ifdef USE_INSTANCING
			wsBase = instanceMatrix[ 3 ].xyz;
		#endif
		wsBase = ( modelMatrix * vec4( wsBase, 1.0 ) ).xyz;
		float wsH = max( position.y, 0.0 );
		float wsPh = wsTime * wsWind.w + dot( wsBase.xz, vec2( 0.071, 0.093 ) );
		// Slow gust envelope * two sways, bend grows with height^2 (roots stay put).
		float wsGust = 0.65 + 0.35 * sin( wsTime * 0.31 + dot( wsBase.xz, vec2( 0.011, 0.007 ) ) );
		vec2 wsSway = vec2( sin( wsPh ) + 0.35 * sin( wsPh * 2.7 + 1.3 ), 0.6 * cos( wsPh * 0.83 + 0.4 ) );
		transformed.xz += wsSway * ( float( RALLY_WIND ) * wsWind.z * wsGust * wsH * wsH );
	}
#endif
${FLAG_VERTEX}`;

const LIGHTS_PARS = /* glsl */ `
uniform sampler2D wsMacro;
uniform sampler2D wsCanopy;
uniform vec4 wsCanopyMap;
uniform sampler2D wsCanopyLocal;
uniform vec4 wsCanopyLocalMap;
uniform vec4 wsShadowBox;
uniform vec2 wsCanopyFade;
uniform vec4 wsForest;
vec3 wsWorldPos( vec3 viewPos ) {
	return ${WORLD_FROM_VIEW.replace('%v', 'viewPos')};
}
/** Sun visibility under the clouds at a world position, 1 = clear. */
float wsCloudShadow( vec3 wp ) {
	if ( wsCloud.x <= 0.0 ) return 1.0;
	// Follow the sun ray up to the cloud layer, then drift with the wind.
	vec2 p = wp.xz + wsSunDir.xz / max( wsSunDir.y, 0.2 ) * wsCloud.w - wsWind.xy * wsTime;
	float n = texture2D( wsMacro, p * wsCloud.z ).r * 0.7 + texture2D( wsMacro, p * wsCloud.z * 3.7 + 0.37 ).r * 0.3;
	float t = 0.72 - wsCloud.y * 0.4;
	return 1.0 - wsCloud.x * smoothstep( t - 0.05, t + 0.07, n );
}
/** Sun visibility under the baked tree shadows, faded in outside the shadow-map box, 1 = clear. */
float wsCanopyShadow( vec3 wp ) {
	if ( wsShadowBox.w <= 0.0 ) return 1.0;
	float fade = wsCanopyFade.y > 0.0
		? smoothstep( wsCanopyFade.x, wsCanopyFade.y, length( wp.xz - cameraPosition.xz ) )
		: smoothstep( wsShadowBox.z * 0.65, wsShadowBox.z * 0.95, length( wp.xz - wsShadowBox.xy ) );
	float d = texture2D( wsCanopy, ( wp.xz - wsCanopyMap.xy ) * wsCanopyMap.zw ).r;
	float str = wsShadowBox.w;
	// The finer window around the camera (blended out over its outer fifth).
	if ( wsCanopyLocalMap.z > 0.0 ) {
		vec2 lu = ( wp.xz - wsCanopyLocalMap.xy ) * wsCanopyLocalMap.zw;
		float lw = 1.0 - smoothstep( 0.38, 0.48, max( abs( lu.x - 0.5 ), abs( lu.y - 0.5 ) ) );
		if ( lw > 0.0 ) {
			d = mix( d, texture2D( wsCanopyLocal, lu ).r, lw );
			str = mix( str, min( str * 1.4, 0.9 ), lw );
		}
	}
	return 1.0 - str * fade * d;
}
`;

/** Inserted after `getDirectionalLightInfo` (before the shadow map term). */
const SUN_TERMS = /* glsl */ `
		vec3 wsWP = wsWorldPos( geometryPosition );
		directLight.color *= wsCloudShadow( wsWP );
		#ifdef RALLY_GROUND
			directLight.color *= wsCanopyShadow( wsWP );
			// The far forest (no trees drawn there): the ground under the canopy takes the canopy's colour.
			if ( wsForest.w > 0.0 && wsShadowBox.w > 0.0 ) {
				float wsFd = texture2D( wsCanopy, ( wsWP.xz - wsCanopyMap.xy ) * wsCanopyMap.zw ).r;
				float wsFf = smoothstep( wsForest.w * 0.75, wsForest.w, length( wsWP.xz - cameraPosition.xz ) );
				float wsFk = clamp( wsFd * 1.5, 0.0, 1.0 ) * wsFf;
				material.diffuseColor = mix( material.diffuseColor, wsForest.rgb, wsFk );
				#ifdef STANDARD
					// three's physical path lights the diffuse contribution (diffuseColor is for its specular terms).
					material.diffuseContribution = mix( material.diffuseContribution, wsForest.rgb, wsFk );
				#endif
			}
		#endif`;

/** Inserted after the directional `RE_Direct` (after the shadow map: shaded leaves stay dark). */
const FOLIAGE_TERM = /* glsl */ `
		#ifdef RALLY_FOLIAGE
			#if defined( TREE_SPRITE ) || defined( TREE_IMPOSTOR )
				// Tree foliage (trees/materials.ts): a cheap wrap term for light through the leaves, weighted by the
				// atlas / impostor thickness map (thin leaves let light through: a crown against a low sun glows).
				float wsWrap = saturate( ( dot( - geometryNormal, directLight.direction ) + 0.5 ) / 1.5 );
				// ... and a half-Lambert wrap on the sun's diffuse, so a crown turning from the sun darkens softly.
				float wsLam = dot( geometryNormal, directLight.direction );
				reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( saturate( ( wsLam + 0.5 ) / 1.5 ) - saturate( wsLam ) );
				reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( float( RALLY_FOLIAGE ) * wsWrap * ( 1.0 - tlThickness ) );
			#else
				float wsBack = saturate( dot( - geometryViewDir, directLight.direction ) );
				reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( float( RALLY_FOLIAGE ) * wsBack * wsBack * wsBack );
			#endif
		#endif`;

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const chunks = ShaderChunk as Record<string, string>;
  chunks.fog_pars_vertex = FOG_PARS_VERTEX;
  chunks.fog_vertex = FOG_VERTEX;
  chunks.fog_pars_fragment = FOG_PARS_FRAGMENT;
  chunks.fog_fragment = FOG_FRAGMENT;
  chunks.begin_vertex = BEGIN_VERTEX;
  chunks.beginnormal_vertex = chunks.beginnormal_vertex + FLAG_NORMAL;
  chunks.common = WORLD_SHADING_DECL + chunks.common;
  chunks.lights_pars_begin = chunks.lights_pars_begin + LIGHTS_PARS;
  // Directional light loop only (the point / spot loops call RE_Direct too).
  const lights = chunks.lights_fragment_begin;
  const info = 'getDirectionalLightInfo( directionalLight, directLight );';
  const at = lights.indexOf(info);
  const direct = at < 0 ? -1 : lights.indexOf('RE_Direct( directLight', at);
  if (direct < 0)
    throw new Error(
      'world-shading: ShaderChunk.lights_fragment_begin changed (three upgrade?)',
    );
  const lineEnd = lights.indexOf('\n', direct);
  chunks.lights_fragment_begin =
    lights.slice(0, at + info.length) +
    SUN_TERMS +
    lights.slice(at + info.length, lineEnd) +
    FOLIAGE_TERM +
    lights.slice(lineEnd);
  // Car reflections: the specular env lookup at the material's own `envMapIntensity` (see `carEnv`).
  const ibl = chunks.envmap_physical_pars_fragment;
  const radiance = 'return envMapColor.rgb * envMapIntensity;';
  const rAt = ibl.indexOf(radiance, ibl.indexOf('getIBLRadiance'));
  if (rAt < 0)
    throw new Error(
      'world-shading: ShaderChunk.envmap_physical_pars_fragment changed (three upgrade?)',
    );
  chunks.envmap_physical_pars_fragment =
    '#ifdef RALLY_CAR_ENV\n\tuniform float wsEnvSpec;\n#endif\n' +
    ibl.slice(0, rAt) +
    '#ifdef RALLY_CAR_ENV\n\t\t\treturn envMapColor.rgb * envMapIntensity * wsEnvSpec;\n\t\t\t#endif\n\t\t\t' +
    ibl.slice(rAt);
  // Default hook for every material without its own: share the world uniforms.
  Material.prototype.onBeforeCompile = function (
    this: Material,
    shader: WebGLProgramParametersWithUniforms,
  ) {
    Object.assign(shader.uniforms, worldUniforms);
    if (this.userData.carEnv) {
      const mat = this as Material & { envMapIntensity?: number };
      shader.fragmentShader = '#define RALLY_CAR_ENV\n' + shader.fragmentShader;
      shader.uniforms.wsEnvSpec = {
        get value() {
          return (mat.envMapIntensity ?? 1) / DAY_ENV_INTENSITY;
        },
      };
    }
  };
  const key = Material.prototype.customProgramCacheKey;
  Material.prototype.customProgramCacheKey = function (this: Material) {
    return key.call(this) + (this.userData.carEnv ? '|carEnv' : '');
  };
}

/**
 * The scene env map intensity the car materials' `envMapIntensity` values are written for (`Environment`'s day
 * default). three.js draws every material without its own env map at `scene.environmentIntensity`, so a car's
 * 1.8 paint clearcoat would show at 0.3 like the ground.
 */
const DAY_ENV_INTENSITY = 0.3;

/**
 * Car materials: reflections (the specular env lookup) at their own `envMapIntensity`, scaled with the scene's env
 * intensity (night, studio), while the diffuse sky light stays the scene's like on every other surface. Flag set in
 * `userData` (survives `clone()`); needs a recompile, so call before the first draw or it sets `needsUpdate`.
 */
export function carEnv(material: Material): void {
  if (material.userData.carEnv) return;
  material.userData.carEnv = true;
  material.needsUpdate = true;
}

install();
