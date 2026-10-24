import {
  Color,
  Material,
  MathUtils,
  Matrix4,
  ShaderChunk,
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
 * - **Sun shadows:** three's lookup in the sun's shadow map is blended with the far shadow map (world/far-shadow.ts)
 *   by how much the sun's covers the fragment (`wsNearWeight`: its box edge and `wsNear` from the camera).
 * - **Canopy shadows:** ground materials (`defines.RALLY_GROUND`: terrain, roads, grass cards) lose the sun under a
 *   baked top-down tree-shadow texture (world/canopy-shadows.ts) - only where neither shadow map reaches.
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
   * The sun's shadow map fades out between these distances from the camera (m; y = 0: only at its box's edge), so it
   * is gone before trees stop casting into it; z: how much closer the far map fades in (`setNearShadowFade`).
   */
  wsNear: { value: new Vector3(0, 0, 0) },
  /**
   * The far shadow map (engine/far-shadow.ts, `setFarShadow`): x strength (0 = off), y texel size (uv), z normal
   * offset (m), w depth bias; its world -> [0, 1] matrix and depth texture.
   */
  wsFar: { value: new Vector4(0, 0, 0, 0) },
  /** Where the far map has its crowns (a disc on the ground): centre x, z, fade-out start / end radius (m). */
  wsFarDisc: { value: new Vector4(0, 0, 0, 1e9) },
  wsFarMatrix: { value: new Matrix4() },
  wsFarShadow: { value: null as Texture | null },
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

/** The sun's shadow map fades out from `start` to `end` m from the camera (0, 0 = only at its box's edge). */
export function setNearShadowFade(
  start: number,
  end: number,
  overlap: number,
): void {
  worldUniforms.wsNear.value.set(start, end, overlap);
}

/**
 * The far shadow map (engine/far-shadow.ts; null = off): depth texture, world -> [0, 1] matrix, strength, texel size
 * (uv), normal offset (m) and depth bias.
 */
export function setFarShadow(
  texture: Texture | null,
  matrix?: Matrix4,
  o: { strength: number; texel: number; normalOffset: number; bias: number } = {
    strength: 0,
    texel: 0,
    normalOffset: 0,
    bias: 0,
  },
): void {
  const u = worldUniforms;
  u.wsFarShadow.value = texture;
  if (matrix) u.wsFarMatrix.value.copy(matrix);
  u.wsFar.value.set(texture ? o.strength : 0, o.texel, o.normalOffset, o.bias);
}

/** The far forest on the ground: canopy colour (linear) and where the trees end (m; 0 = off). */
export function setForest(color: Color, distance: number): void {
  worldUniforms.wsForest.value.set(color.r, color.g, color.b, distance);
}

/** The ground disc where the far shadow map has its crowns (it fades out towards `end`, m). */
export function setFarShadowDisc(
  x: number,
  z: number,
  start: number,
  end: number,
): void {
  worldUniforms.wsFarDisc.value.set(x, z, start, end);
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
uniform vec3 wsNear;
uniform vec4 wsFar;
uniform vec4 wsFarDisc;
uniform mat4 wsFarMatrix;
uniform sampler2D wsFarShadow;
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
/**
 * Weight of the sun's shadow map at a fragment (its shadow coordinate): 1 inside the box, 0 at its edge and past
 * wsNear from the camera (where trees stop casting into it). \`inner\` = 1: the same fade moved in by the overlap
 * (wsNear.z m, a fifth of the box): where the far map starts, so both draw over that band.
 */
float wsNearWeight( vec4 coord, vec3 wp, float inner ) {
	vec2 e = abs( coord.xy / coord.w - 0.5 ) * 2.0;
	float w = 1.0 - smoothstep( 0.82 - 0.2 * inner, 0.96 - 0.2 * inner, max( e.x, e.y ) );
	float shift = wsNear.z * inner;
	if ( wsNear.y > 0.0 ) w *= 1.0 - smoothstep( wsNear.x - shift, wsNear.y - shift, length( wp.xz - cameraPosition.xz ) );
	return w;
}
/**
 * Sun visibility in the far shadow map (engine/far-shadow.ts), 1 = clear; \`cover\` = how much of the fragment it
 * covers (fades out at its edge). A plain sampler2D (see world/far-shadow.ts): 2x2 texel compares, bilinear weights.
 */
float wsFarLit( vec2 uv, float z ) {
	return step( z, texture2D( wsFarShadow, uv ).r );
}
float wsFarSun( vec3 wp, vec3 wn, out float cover ) {
	cover = 0.0;
	if ( wsFar.x <= 0.0 ) return 1.0;
	vec4 c = wsFarMatrix * vec4( wp + wn * wsFar.z, 1.0 );
	vec2 e = abs( c.xy - 0.5 ) * 2.0;
	if ( c.z >= 1.0 ) return 1.0;
	cover = ( 1.0 - smoothstep( 0.86, 0.97, max( e.x, e.y ) ) )
		* ( 1.0 - smoothstep( wsFarDisc.z, wsFarDisc.w, length( wp.xz - wsFarDisc.xy ) ) );
	if ( cover <= 0.0 ) return 1.0;
	float z = c.z - wsFar.w;
	float t = wsFar.y;
	// The four texels around the lookup, bilinear weights (far pixels are small on screen: 4 reads are enough).
	vec2 p = c.xy / t - 0.5;
	vec2 f = fract( p );
	vec2 b = ( floor( p ) + 0.5 ) * t;
	float s = mix(
		mix( wsFarLit( b, z ), wsFarLit( b + vec2( t, 0.0 ), z ), f.x ),
		mix( wsFarLit( b + vec2( 0.0, t ), z ), wsFarLit( b + vec2( t, t ), z ), f.x ),
		f.y
	);
	return mix( 1.0, s, cover * wsFar.x );
}
/**
 * Sun visibility under the baked tree shadows, 1 = clear. \`cover\`: how much real shadow maps cover the fragment
 * (the baked shadows fill in only where they end).
 */
float wsCanopyShadow( vec3 wp, float cover ) {
	if ( wsShadowBox.w <= 0.0 ) return 1.0;
	float fade = 1.0 - cover;
	if ( fade <= 0.0 ) return 1.0;
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
/** Where tree crowns stand over the ground (0..1; G of the baked canopy textures: under the crowns, not their shadow): leaf litter. */
float wsCanopyCover( vec2 xz ) {
	float d = texture2D( wsCanopy, ( xz - wsCanopyMap.xy ) * wsCanopyMap.zw ).g;
	if ( wsCanopyLocalMap.z > 0.0 ) {
		vec2 lu = ( xz - wsCanopyLocalMap.xy ) * wsCanopyLocalMap.zw;
		float lw = 1.0 - smoothstep( 0.38, 0.48, max( abs( lu.x - 0.5 ), abs( lu.y - 0.5 ) ) );
		if ( lw > 0.0 ) d = mix( d, texture2D( wsCanopyLocal, lu ).g, lw );
	}
	return d;
}
`;

/**
 * Tree materials (TREE_FULL) look the far map up at their shadow lookup point, as the sun's map does (sprites: moved
 * out of their own crown towards the sun, trees/materials.ts `SELF_SHADOW`) - at the fragment itself a crown would
 * sit inside its own far-map proxy and go dark.
 */
const TREE_SHADOW_WP_DECL = /* glsl */ `
#if defined( TREE_FULL ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && ! defined( WS_TREE_SHADOW_WP )
#define WS_TREE_SHADOW_WP
varying vec3 wsShadowWP;
#endif
`;

/**
 * Inserted after `getDirectionalLightInfo` (before the shadow map term): clouds, the near / far shadow map weights
 * (`wsNearW` / `wsFarIn` / `wsFarV`, read by the shadow term, see `SUN_SHADOW`) and the canopy where neither map reaches.
 */
const SUN_TERMS = /* glsl */ `
		vec3 wsWP = wsWorldPos( geometryPosition );
		directLight.color *= wsCloudShadow( wsWP );
		float wsNearW = 0.0;
		float wsFarIn = 1.0;
		float wsFarV = 1.0;
		float wsFarW = 0.0;
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			wsNearW = wsNearWeight( vDirectionalShadowCoord[ i ], wsWP, 0.0 );
			wsFarIn = 1.0 - wsNearWeight( vDirectionalShadowCoord[ i ], wsWP, 1.0 );
			// Near the car the sun's map covers everything: no far lookup (most of the screen's pixels).
			if ( wsFarIn > 0.0 ) {
				#ifdef TREE_FULL
					wsFarV = wsFarSun( wsShadowWP, normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz ), wsFarW );
				#else
					wsFarV = wsFarSun( wsWP, normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz ), wsFarW );
				#endif
			}
		#endif
		#ifdef RALLY_GROUND
			directLight.color *= wsCanopyShadow( wsWP, max( wsNearW, wsFarW ) );
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

/**
 * The sun's shadow-map lookup in three's directional loop, replaced by `min( mix( 1, <it>, wsNearW ), mix( 1, wsFarV,
 * wsFarIn ) )`: the near map inside its box, the far map past it, both over an overlap band before the near one fades
 * (the darker wins: one shadow in both maps is not doubled; 1 where neither reaches, the canopy takes over there).
 */
const SUN_SHADOW =
  'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

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
  chunks.lights_pars_begin =
    chunks.lights_pars_begin + TREE_SHADOW_WP_DECL + LIGHTS_PARS;
  // Tree materials: their shadow lookup point (worldpos_vertex; sprites move it out of their own crown) for the far map.
  chunks.shadowmap_pars_vertex =
    chunks.shadowmap_pars_vertex + TREE_SHADOW_WP_DECL;
  chunks.shadowmap_vertex =
    chunks.shadowmap_vertex +
    /* glsl */ `
#ifdef WS_TREE_SHADOW_WP
	wsShadowWP = worldPosition.xyz;
#endif
`;
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
  const shadow = lights.indexOf(SUN_SHADOW, at);
  if (shadow < 0 || shadow > direct)
    throw new Error(
      'world-shading: the directional shadow term changed (three upgrade?)',
    );
  chunks.lights_fragment_begin =
    lights.slice(0, at + info.length) +
    SUN_TERMS +
    lights.slice(at + info.length, shadow) +
    `min( mix( 1.0, ${SUN_SHADOW}, wsNearW ), mix( 1.0, wsFarV, wsFarIn ) )` +
    lights.slice(shadow + SUN_SHADOW.length, lineEnd) +
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
          return (mat.envMapIntensity ?? 1) / carEnvRef;
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
 * The scene env map intensity at which a car material reflects at its own `envMapIntensity`. three.js draws every
 * material without its own env map at `scene.environmentIntensity` (day 0.3). By day 0.6: a value of 1 reflects the
 * sky 1.67x the world's strength, a sheen like a car on the street, not a studio mirror (0.3 washed paint out to
 * white). With the sun low and at night it eases back to 0.3 (`setCarEnvSun`): with little direct light the sky
 * reflection is what shows a car's shape, and dark paint went flat black without it.
 */
const CAR_ENV_DAY = 0.6;
const CAR_ENV_LOW = 0.3;
let carEnvRef = CAR_ENV_DAY;

/** Sun elevation (deg) and night flag of the environment -> the car reflection strength (`CAR_ENV_DAY`). */
export function setCarEnvSun(elevation: number, night: boolean): void {
  carEnvRef = night
    ? CAR_ENV_LOW
    : MathUtils.lerp(
        CAR_ENV_LOW,
        CAR_ENV_DAY,
        MathUtils.smoothstep(elevation, 3, 18),
      );
}

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
