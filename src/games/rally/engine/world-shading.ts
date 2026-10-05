import {
  Color,
  Material,
  ShaderChunk,
  Vector3,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

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
  /** Shadow-map box on the ground: centre x, z, half extent (m), canopy shadow strength (0 = off). */
  wsShadowBox: { value: new Vector4(0, 0, 60, 0) },
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
): void {
  const u = worldUniforms;
  u.wsCanopy.value = texture;
  u.wsCanopyMap.value.set(map.x0, map.z0, map.invW, map.invD);
  u.wsShadowBox.value.w = texture ? strength : 0;
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
`;

const LIGHTS_PARS = /* glsl */ `
uniform sampler2D wsMacro;
uniform sampler2D wsCanopy;
uniform vec4 wsCanopyMap;
uniform vec4 wsShadowBox;
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
	float fade = smoothstep( wsShadowBox.z * 0.65, wsShadowBox.z * 0.95, length( wp.xz - wsShadowBox.xy ) );
	float d = texture2D( wsCanopy, ( wp.xz - wsCanopyMap.xy ) * wsCanopyMap.zw ).r;
	return 1.0 - wsShadowBox.w * fade * d;
}
`;

/** Inserted after `getDirectionalLightInfo` (before the shadow map term). */
const SUN_TERMS = /* glsl */ `
		vec3 wsWP = wsWorldPos( geometryPosition );
		directLight.color *= wsCloudShadow( wsWP );
		#ifdef RALLY_GROUND
			directLight.color *= wsCanopyShadow( wsWP );
		#endif`;

/** Inserted after the directional `RE_Direct` (after the shadow map: shaded leaves stay dark). */
const FOLIAGE_TERM = /* glsl */ `
		#ifdef RALLY_FOLIAGE
			float wsBack = saturate( dot( - geometryViewDir, directLight.direction ) );
			reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( float( RALLY_FOLIAGE ) * wsBack * wsBack * wsBack );
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
  // Default hook for every material without its own: share the world uniforms.
  Material.prototype.onBeforeCompile = function (
    shader: WebGLProgramParametersWithUniforms,
  ) {
    Object.assign(shader.uniforms, worldUniforms);
  };
}

install();
