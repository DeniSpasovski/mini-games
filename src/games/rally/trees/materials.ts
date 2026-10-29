import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  LessEqualDepth,
  type Material,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBADepthPacking,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { addWorldUniforms } from '../engine/world-shading';
import {
  ALPHA_TEST,
  primeSpriteAtlas,
  spriteAtlas,
  type LeafStyle,
  type SpriteAtlas,
} from './leaftex';
import { imageReady, imageTexture } from '../engine/image-texture';
import { mix32, unit } from './math';
import {
  FAR_RAMP,
  FAR_SPRITES,
  FULL_DETAIL_DISTANCE,
  NEAR_SPRITES,
  ROAD_REACH,
  type BarkScan,
  type BarkTexture,
  type SpeciesDef,
} from './species';
import furrowedUrl from './bark/furrowed.webp';
import pineUrl from './bark/pine.webp';
import beechUrl from './bark/beech.webp';
import planeUrl from './bark/plane.webp';
import { TREE_SPRITE_AXES } from './sprite-attr';

/**
 * Shared materials of the tree module (the impostor bake and the drawing stage): bark and sprite atlas textures and
 * the tree shader code injected into three's standard / Lambert / depth / basic materials, so branches, foliage sprites and
 * impostors all go through the game's normal lit path (sun, sky, fog, shadow maps: trees/Foliage.md#shading).
 *
 * - **Level cross-fade** (trees/Lod.md#transition): the level and its fade are chosen on the CPU, once per frame per
 *   tree (trees/draw.ts); every instance carries `treeFade` = (fade 0..1, role, casts shadow, debug code): ONE number
 *   per tree, nothing derived from a vertex or pixel. Role 0 = solid, 1 = outgoing (keeps the pixels whose dither
 *   value is >= fade), 2 = incoming (keeps < fade), 3 = shadow caster only. The dither is an 8x8 ordered (Bayer)
 *   tile anchored to screen pixels: no gradient, no direction, nothing that could read as a wipe. Shadow casters are
 *   never dithered. Instances with nothing to draw collapse in the vertex shader.
 * - **Sprites** (trees/Foliage.md#sprites): every sprite vertex carries the sprite centre, its outline corner, size
 *   and heading (trees/sprite-attr.ts); `SPRITE_PROJECT` turns it into a quad facing the camera POSITION (`tlCam`, before shake), in every
 *   pass (depth prepass, lit pass, shadow pass) with the same code, so their depths match. Thinning
 *   (trees/Foliage.md#simplification) is computed there too, per tree, from its projected height.
 * - **Wind** (trees/Foliage.md#wind): the trunk bends with height^2, each limb sways about the trunk with its own
 *   phase and an amplitude growing with branch order and distance along the limb (`treeWind`), a sprite moves with
 *   its branch and flutters by a small turn. The impostor applies the trunk term only.
 * - **Shading**: per-tree hue / value (`treeInst`), baked AO, sprite normals = the crown ellipsoid's bent by the
 *   atlas normal map, light through the leaves = a wrap term weighted by the thickness map (engine/world-shading.ts
 *   `RALLY_FOLIAGE`). Foliage shaders read the 2 sprite atlas textures (the thickness rides in the normal map's
 *   alpha) + the shadow map + the cloud noise; the sky's diffuse light comes from spherical harmonics of the
 *   environment (`setTreeSky`) instead of a 4th texture, so sprites get the same sky ambient as the terrain.
 */

/**
 * Shared uniforms: `tlDebug` = debug view (trees/Lod.md#debug-view, trees/Drawing.md#debug: 0 off, 1 level tint
 * / fades / flicker, 2 lighting only, 3 normals only, 4 depth, 5 sprites failing the equal-depth test: magenta), `tlCam` / `tlPx` = the camera position before shake and the screen-height share
 * per (m / m) (sprite facing + thinning), `tlSky` = the environment's diffuse light as spherical harmonics and
 * `tlSkyOn` (0 until it is computed: then the hemisphere ambient is boosted instead).
 */
export const treeUniforms = {
  tlDebug: { value: 0 },
  tlCam: { value: new Vector3() },
  tlPx: { value: 0.87 },
  tlSky: { value: Array.from({ length: 9 }, () => new Vector3()) },
  tlSkyOn: { value: 0 },
  /** Trees cast shadows within this horizontal distance of `tlCam` (m): decided per instance here, so the shadow
   * distance never makes a tree re-selected on the CPU (trees/Lod.md#active-set). */
  tlShadowD: { value: 1e9 },
  /**
   * Far crowns' sprite share (trees/draw.ts `spriteKeep`): x just past FAR_RAMP beyond the full-detail distance, y at
   * the impostor threshold. Far crowns are vertex bound, so they draw few, large sprites (`setFarSprites`).
   */
  tlFar: { value: new Vector2(FAR_SPRITES[0], FAR_SPRITES[1]) },
  /** Trees end here (m; 0 = no edge): they dissolve over its last 15% (trees/draw.ts `forestDistance`). */
  tlForest: { value: 0 },
};

// Dev: inspect / tweak from the console (`__treeUniforms.tlDebug.value = 2`).
(globalThis as { __treeUniforms?: typeof treeUniforms }).__treeUniforms =
  treeUniforms;

export { ALPHA_TEST };

/** The environment's diffuse light (SH, already times its intensity) for the foliage (engine/environment.ts). */
export function setTreeSky(coefficients: Vector3[], intensity: number): void {
  coefficients.forEach((c, i) =>
    treeUniforms.tlSky.value[i].copy(c).multiplyScalar(intensity),
  );
  treeUniforms.tlSkyOn.value = 1;
}

/** Ambient boost while the sky SH is not computed yet (the IBL's share of the ambient). */
const FALLBACK_AMBIENT = 2.4;

// --- GLSL ------------------------------------------------------------------------------------------------------

const VERTEX_PARS = /* glsl */ `
// Bit-identical positions in every program of a mesh (the sprite depth prepass and its lit pass).
invariant gl_Position;
uniform vec3 tlCam;
uniform float tlPx;
uniform float tlShadowD;
uniform vec2 tlFar;
uniform float tlForest;
const float TREE_FAR_RAMP = ${FAR_RAMP.toFixed(1)};
/** The first row's zones (species.ts ROAD_REACH): the fraction of the variant slot (treeInst.w) flags the tree. */
const float TREE_FULL_ROAD = ${ROAD_REACH.full.toFixed(1)};
const float TREE_FAR_RAMP_ROAD = ${ROAD_REACH.ramp.toFixed(1)};
/** Wind fades out towards this distance (m): past it a sway is under a pixel, so its vertex maths is skipped. */
const float TREE_WIND_FAR = 110.0;
#ifdef TREE_IMPOSTOR_GRID
// Placed by the vertex shader itself (world/far-forest.ts FAR_TREES), not instance attributes.
vec4 treeInst;
vec4 treeFade;
mat4 instanceMatrix;
float tgOut;
#else
attribute vec4 treeInst;
attribute vec4 treeFade;
#endif
#ifndef TREE_IMPOSTOR
attribute vec4 treeWind;
#endif
#ifdef TREE_SPRITE
attribute vec4 treeSprite;
attribute float treeRank;
/** The crown's ellipsoid (object space): centre, horizontal radius; vertical radius. */
attribute vec4 treeCrown;
attribute float treeCrownY;
attribute vec4 treeLod;
varying vec3 vSprRight;
varying vec3 vSprUp;
${TREE_SPRITE_AXES}
#endif
varying vec2 vTreeKeep;
varying vec2 vTreeTint;
varying float vTreeAO;
varying vec2 vTreeDebug;
/** Trunk sway (object space metres along the wind) at height y. */
float treeTrunk( float y, float phase, float gust ) {
	float hy = max( y, 0.0 );
	return 0.0009 * hy * hy * gust * ( sin( wsTime * 0.9 + phase ) + 0.3 * sin( wsTime * 2.1 + phase * 1.7 ) );
}
#ifdef TREE_SPRITE
/**
 * Sprite thinning (trees/Foliage.md#simplification), per tree: keep share k = TREE_KEEP_NEAR (species.ts NEAR_SPRITES)
 * inside the tree's full-detail distance (the first row's reaches farther) and above the thinning threshold (treeLod.z), falling to 0.25 at the impostor threshold
 * (treeLod.w); a sprite of rank r shrinks to nothing as k passes it, the rest grow by 1 / sqrt(k) so the crown keeps
 * its coverage.
 */
float treeSpriteScale( vec3 origin, float rank ) {
	vec3 centre = origin + vec3( 0.0, treeLod.x, 0.0 );
	float dist = max( distance( centre, tlCam ), 0.5 );
	float h = treeLod.y * tlPx / dist;
	float f = h < treeLod.z ? clamp( log( treeLod.z / h ) / log( treeLod.z / treeLod.w ), 0.0, 1.0 ) : 0.0;
	float road = step( 0.125, fract( treeInst.w ) );
	float full = mix( TREE_FULL, TREE_FULL_ROAD, road );
	float ramp = mix( TREE_FAR_RAMP, TREE_FAR_RAMP_ROAD, road );
	float k = mix( TREE_KEEP_NEAR, mix( tlFar.x, tlFar.y, f ), smoothstep( full, full + ramp, dist ) );
	const float w = 0.08;
	return smoothstep( rank, rank + w, k * ( 1.0 + w ) ) * inversesqrt( k );
}
#endif
`;

/** After begin_vertex: wind on branch vertices, the level visibility, tint / AO / debug varyings. */
const VERTEX_MAIN = /* glsl */ `
	vec3 tOrigin = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	float tScale = length( instanceMatrix[ 0 ].xyz );
	mat3 tRot = mat3( instanceMatrix ) / tScale;
	vec3 tWindW = vec3( wsWind.x, 0.0, wsWind.y );
	tWindW = dot( tWindW, tWindW ) > 1e-6 ? normalize( tWindW ) : vec3( 1.0, 0.0, 0.0 );
	vec3 tWind = transpose( tRot ) * tWindW;
	float tWindK = wsWind.z * ( 1.0 - smoothstep( TREE_WIND_FAR * 0.7, TREE_WIND_FAR, distance( tOrigin, tlCam ) ) );
	float tGust = 0.0;
	if ( tWindK > 0.0 ) tGust = tWindK * ( 0.65 + 0.35 * sin( wsTime * 0.31 + treeInst.z * 0.5 + dot( tOrigin.xz, vec2( 0.011, 0.007 ) ) ) );
	#ifndef TREE_IMPOSTOR
		// Trunk bend + limb sway (phase per limb, more for higher orders and further out). Sprites: at their centre.
		if ( tGust > 0.0 ) {
			float tBranch = 0.012 * tGust * ( 1.0 + 0.35 * treeWind.x ) * treeWind.z * sin( wsTime * 1.7 + treeWind.y + treeInst.z );
			transformed += tWind * treeTrunk( position.y, treeInst.z, tGust ) + ( tWind + vec3( 0.0, 0.3, 0.0 ) ) * tBranch;
		}
	#endif
	// Kept dither range [lo, hi): solid, outgoing (>= fade), incoming (< fade), or nothing.
	#ifdef TREE_SHADOW_PASS
		vTreeKeep = treeFade.z > 0.5 && distance( tOrigin.xz, tlCam.xz ) < tlShadowD ? vec2( 0.0, 2.0 ) : vec2( 1.0, 0.0 );
	#else
		float tRole = treeFade.y;
		vTreeKeep = tRole < 0.5 ? vec2( 0.0, 2.0 ) : tRole < 1.5 ? vec2( treeFade.x, 2.0 ) : tRole < 2.5 ? vec2( 0.0, treeFade.x ) : vec2( 1.0, 0.0 );
		#ifdef TREE_IMPOSTOR_GRID
			// No forest edge: no far trees (an empty cell must never fall back to the solid default).
			vTreeKeep = vec2( 1.0, 0.0 );
		#endif
		// The forest edge (trees/draw.ts forestDistance): trees dissolve in with the same dither, never pop.
		if ( tlForest > 0.0 ) {
			float tEdge = 1.0 - smoothstep( tlForest * 0.85, tlForest, distance( tOrigin.xz, tlCam.xz ) );
			#ifdef TREE_IMPOSTOR_GRID
				// The far trees take the other side of the same dither: in where the trees dissolve out.
				vTreeKeep = vec2( tEdge, tgOut );
			#else
				if ( tEdge < 1.0 ) vTreeKeep.y = min( vTreeKeep.y, tEdge );
			#endif
		}
	#endif
	vTreeDebug = vec2( treeFade.w, treeFade.x );
	vTreeTint = treeInst.xy;
	#ifdef TREE_IMPOSTOR
		vTreeAO = 1.0;
	#else
		vTreeAO = treeWind.w;
	#endif
`;

/**
 * Replaces project_vertex for sprites (every pass): the sprite centre (`transformed`, already swayed) in the world,
 * a quad facing the camera position, its x axis along the sprite's heading (+ a small flutter), scaled by the thinning.
 */
const SPRITE_PROJECT = /* glsl */ `
	vec3 sprCentre = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	vec3 sprToCam = normalize( tlCam - sprCentre );
	vec3 sprRight = cross( vec3( 0.0, 1.0, 0.0 ), sprToCam );
	sprRight = dot( sprRight, sprRight ) > 1e-6 ? normalize( sprRight ) : vec3( 1.0, 0.0, 0.0 );
	vec3 sprUp = cross( sprToCam, sprRight );
	vec2 sprCorner;
	vec3 sprHeading;
	float sprAligned;
	treeSpriteCorner( treeSprite, sprCorner, sprHeading, sprAligned );
	float sprFlutter = 0.0;
	if ( tWindK > 0.0 ) sprFlutter = 0.12 * tWindK * sin( wsTime * 5.3 + treeWind.y * 2.7 );
	vec3 sprR;
	vec3 sprU;
	float sprStretch;
	treeSpriteAxes( sprRight, sprUp, tRot * sprHeading, sprAligned, treeWind.y, sprFlutter, sprR, sprU, sprStretch );
	float sprSize = treeSprite.z * tScale * treeSpriteScale( tOrigin, treeRank );
	vec3 sprWorld = sprCentre + ( sprR * ( sprCorner.x * sprStretch ) + sprU * sprCorner.y ) * sprSize;
	vec4 mvPosition = viewMatrix * vec4( sprWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	if ( sprSize <= 0.0 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
	#ifndef TREE_SHADOW_PASS
		vSprRight = ( viewMatrix * vec4( sprR, 0.0 ) ).xyz;
		vSprUp = ( viewMatrix * vec4( sprU, 0.0 ) ).xyz;
	#endif
`;

/** Share of the way out of its own crown (towards the sun) a sprite's shadow lookup moves. */
const SELF_SHADOW = 0.8;

/** Replaces worldpos_vertex for sprites: the shadow lookup point (see injectVertex). */
const SPRITE_SHADOW_LOOKUP = /* glsl */ `
	vec3 tcC = ( modelMatrix * instanceMatrix * vec4( treeCrown.xyz, 1.0 ) ).xyz;
	vec3 tcR = vec3( treeCrown.w, treeCrownY, treeCrown.w ) * tScale;
	vec3 tcQ = ( sprCentre - tcC ) / tcR;
	vec3 tcD = wsSunDir / tcR;
	float tcA = dot( tcD, tcD );
	float tcB = dot( tcQ, tcD );
	float tcDisc = tcB * tcB - tcA * ( dot( tcQ, tcQ ) - 1.0 );
	float tcOut = tcDisc > 0.0 ? max( ( - tcB + sqrt( tcDisc ) ) / tcA, 0.0 ) : 0.0;
	vec4 worldPosition = vec4( sprWorld + wsSunDir * max( 0.35, ${SELF_SHADOW.toFixed(2)} * tcOut ), 1.0 );
`;

const VERTEX_COLLAPSE = /* glsl */ `
	if ( vTreeKeep.x >= vTreeKeep.y ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`;

const FRAGMENT_PARS = /* glsl */ `
const float TREE_SKY_LEAN = 0.8;
const float TREE_LEAF_FILL = 0.06;
#ifdef TREE_SPRITE
uniform sampler2D tlSprNormal;
uniform float tlDepthOnly;
varying vec3 vSprRight;
varying vec3 vSprUp;
#endif
uniform float tlDebug;
uniform vec3 tlSky[ 9 ];
uniform float tlSkyOn;
varying vec2 vTreeKeep;
varying vec2 vTreeTint;
varying float vTreeAO;
varying vec2 vTreeDebug;
/** Debug view: level colour (0 green, 1 orange, impostor blue); fading = magenta -> white with the fade value;
 * changed level more than twice in the last second = flashing red. Code = level + 4 fading + 8 flickering. */
vec3 treeDebugColor( vec2 dbg ) {
	if ( dbg.x >= 7.5 ) return vec3( 1.0, 0.0, 0.0 ) * ( 0.55 + 0.45 * sin( wsTime * 12.0 ) );
	if ( dbg.x >= 3.5 ) return mix( vec3( 1.0, 0.0, 1.0 ), vec3( 1.0 ), dbg.y );
	return dbg.x < 0.5 ? vec3( 0.1, 0.8, 0.1 ) : dbg.x < 1.5 ? vec3( 0.95, 0.55, 0.05 ) : vec3( 0.15, 0.35, 0.95 );
}
/** 8x8 ordered (Bayer) dither, 0..1, anchored to screen pixels: a fixed tile, no gradient or direction. */
float treeDither() {
	int x = int( mod( gl_FragCoord.x, 8.0 ) );
	int y = int( mod( gl_FragCoord.y, 8.0 ) );
	int xy = x ^ y;
	int b = ( ( xy & 1 ) << 5 ) | ( ( x & 1 ) << 4 ) | ( ( xy & 2 ) << 2 ) | ( ( x & 2 ) << 1 ) | ( ( xy & 4 ) >> 1 ) | ( ( x & 4 ) >> 2 );
	return ( float( b ) + 0.5 ) / 64.0;
}
vec3 treeHue( vec3 c, float turn ) {
	const mat3 toYIQ = mat3( 0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312 );
	const mat3 toRGB = mat3( 1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703 );
	vec3 yiq = toYIQ * c;
	float a = turn * 6.2831853;
	yiq.yz = mat2( cos( a ), sin( a ), -sin( a ), cos( a ) ) * yiq.yz;
	return max( toRGB * yiq, 0.0 );
}
`;

const FRAGMENT_DITHER = /* glsl */ `
	float tD = treeDither();
	if ( tD < vTreeKeep.x || tD >= vTreeKeep.y ) discard;
`;

/** After color_fragment: per-tree tint, baked AO, the debug colours (1 = level, 2 = lighting only: white albedo). */
const FRAGMENT_COLOR = /* glsl */ `
	// Baked AO darkens the albedo a little (the ambient gets the rest, FRAGMENT_AMBIENT); sprites: the ambient only.
	#ifdef TREE_SPRITE
		diffuseColor.rgb = treeHue( diffuseColor.rgb, vTreeTint.x ) * vTreeTint.y;
	#else
		diffuseColor.rgb = treeHue( diffuseColor.rgb, vTreeTint.x ) * vTreeTint.y * mix( 0.65, 1.0, vTreeAO );
	#endif
	if ( tlDebug > 0.5 && tlDebug < 1.5 ) diffuseColor.rgb = treeDebugColor( vTreeDebug );
	if ( tlDebug > 1.5 && tlDebug < 2.5 ) diffuseColor.rgb = vec3( 0.75 );
`;

/** After lights_fragment_end: baked AO on the ambient; the sky's diffuse light (SH) where IBL is not sampled. */
const FRAGMENT_AMBIENT = /* glsl */ `
	reflectedLight.indirectDiffuse *= vTreeAO;
	#ifdef TREE_SKY
		if ( tlSkyOn > 0.5 ) {
			vec3 tSkyN = inverseTransformDirection( normal, viewMatrix );
			#if defined( TREE_SPRITE ) || defined( TREE_IMPOSTOR )
				// Foliage: the sky light of a leaf is soft whatever way its crown faces (light bounces between the
				// leaves, and the ground), so the sky normal leans up and a little light is always there.
				tSkyN = normalize( tSkyN + vec3( 0.0, TREE_SKY_LEAN, 0.0 ) );
				reflectedLight.indirectDiffuse += material.diffuseColor * ( TREE_LEAF_FILL * vTreeAO );
			#endif
			reflectedLight.indirectDiffuse += shGetIrradianceAt( tSkyN, tlSky ) * BRDF_Lambert( material.diffuseColor ) * vTreeAO;
		} else reflectedLight.indirectDiffuse *= FALLBACK_AMBIENT;
	#endif
`;

/** At the very end: debug 3 = the shading normal (view space) as colour. */
const FRAGMENT_NORMALS = /* glsl */ `
	if ( tlDebug > 2.5 && tlDebug < 3.5 ) gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, 1.0 );
	// Debug 4: the depth this pixel wrote (log of the view distance, 1 m white .. 2 km black), impostor depth included.
	if ( tlDebug > 3.5 && tlDebug < 4.5 ) gl_FragColor = vec4( vec3( 1.0 - clamp( log( max( TREE_VIEW_Z, 1.0 ) ) / log( 2000.0 ), 0.0, 1.0 ) ), 1.0 );
`;

/** Foliage shaders skip the environment map (IBL): its diffuse light comes as SH (`tlSky`), not a 4th texture. */
const NO_ENVMAP = '#undef USE_ENVMAP';

/** Sprite shading normal: the crown normal (vNormal) bent by the atlas normal map; thickness for the wrap term. */
const SPRITE_NORMAL = /* glsl */ `
	vec4 tlNT = texture2D( tlSprNormal, vMapUv );
	vec3 tlTN = tlNT.xyz * 2.0 - 1.0;
	normal = normalize( normalize( vNormal ) + ( normalize( vSprRight ) * tlTN.x + normalize( vSprUp ) * tlTN.y ) * TREE_BEND );
	nonPerturbedNormal = normal;
	float tlThickness = tlNT.w;
`;

function injectVertex(
  shader: WebGLProgramParametersWithUniforms,
  project: boolean,
  sprite = false,
): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${VERTEX_MAIN}`,
    );
  if (sprite)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <project_vertex>',
        `${SPRITE_PROJECT}\n${VERTEX_COLLAPSE}`,
      )
      // Shadow lookup lifted towards the sun: a sprite (facing the camera, often edge-on to the sun) does not
      // shadow itself, and its crown's shadow proxy (trees/proxy.ts) does not swallow it: the lift is a share of
      // the way out of the crown's ellipsoid towards the sun, so the inside still sits in some shade.
      .replace('#include <worldpos_vertex>', SPRITE_SHADOW_LOOKUP);
  else if (project)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n${VERTEX_COLLAPSE}`,
    );
}

function injectFragment(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('void main() {', `void main() {\n${FRAGMENT_DITHER}`);
}

/** The lit path of branches (standard) and sprites (Lambert): three's material + the tree code. */
function hookStandard(
  m: MeshStandardMaterial | MeshLambertMaterial,
  key: string,
  sprite: boolean,
  extra: Record<string, unknown> = {},
): void {
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    Object.assign(shader.uniforms, treeUniforms, extra);
    injectVertex(shader, true, sprite);
    injectFragment(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${FRAGMENT_COLOR}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${FRAGMENT_AMBIENT}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\n${FRAGMENT_NORMALS}`,
      );
    if (sprite)
      shader.fragmentShader = `${NO_ENVMAP}\n${shader.fragmentShader}`
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>\n${SPRITE_NORMAL}`,
        )
        // The depth prepass (same program): stop after the alpha test (A2C keeps its alpha as the coverage).
        .replace(
          '#include <alphatest_fragment>',
          '#include <alphatest_fragment>\n\tif ( tlDepthOnly > 0.5 ) { gl_FragColor = vec4( 1.0, 0.0, 1.0, diffuseColor.a ); return; }',
        );
  };
  m.customProgramCacheKey = () => key;
}

// --- textures --------------------------------------------------------------------------------------------------

function noise2(
  x: number,
  y: number,
  seed: number,
  wrapX: number,
  wrapY: number,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const h = (i: number, j: number) =>
    unit(
      mix32(
        mix32(seed, (((xi + i) % wrapX) + wrapX) % wrapX),
        (((yi + j) % wrapY) + wrapY) % wrapY,
      ),
    );
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(0, 0) + (h(1, 0) - h(0, 0)) * sx;
  const b = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
  return a + (b - a) * sy;
}

const textures = new Map<string, Texture>();

/** Scanned bark tiles (trees/bark/<kind>.webp, scripts/trees/bake-bark.py; 256 x 512). */
const BARK_URLS: Partial<Record<BarkTexture | BarkScan, string>> = {
  furrowed: furrowedUrl,
  pine: pineUrl,
  beech: beechUrl,
  plane: planeUrl,
};
/** Lifts a scanned tile (its own contrast) to the procedural tiles' mean brightness; printed by the baker. */
const BARK_GAIN: Partial<Record<BarkTexture | BarkScan, number>> = {
  furrowed: 2.67,
  pine: 1.34,
  beech: 1.38,
  plane: 1.48,
};

/** A species' bark tile: its own scan, else its kind. */
export function barkKind(def: SpeciesDef): BarkTexture | BarkScan {
  return def.bark.scan ?? def.bark.texture;
}

/** The bark material's colour over its tile (`BARK_GAIN`); the impostor bake applies the same. */
export function barkGain(kind: BarkTexture | BarkScan): number {
  return BARK_GAIN[kind] ?? 1;
}

/** Side of a bark tile (px): a scan or the procedural one. */
export function barkTileSize(kind: BarkTexture | BarkScan): [number, number] {
  return BARK_URLS[kind] ? [256, 512] : [64, 128];
}

/** Resolves when these bark tiles hold their scans: the impostor bake reads them once (trees/load.ts). */
export function barkReady(kinds: (BarkTexture | BarkScan)[]): Promise<void> {
  return Promise.all(
    [...new Set(kinds)].map((k) => imageReady(barkTexture(k))),
  ).then(() => undefined);
}

/** Grey bark detail (multiplies the bark vertex colour): u around the branch, v along it. */
export function barkTexture(kind: BarkTexture | BarkScan): Texture {
  let t = textures.get(`bark:${kind}`);
  if (t) return t;
  const url = BARK_URLS[kind];
  if (url) {
    t = imageTexture(url, 256, 512, `bark:${kind}`, '#9a9a9a');
    textures.set(`bark:${kind}`, t);
    return t;
  }
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v: number;
      if (kind === 'furrowed') {
        // Vertical plates split by dark furrows.
        const ridge = noise2(x / 6, y / 24, 11, w / 6, h / 24);
        const plate = noise2(x / 3, y / 6, 12, w / 3, h / 6);
        v =
          0.45 +
          0.55 * Math.pow(Math.abs(ridge * 2 - 1), 0.6) * (0.75 + 0.25 * plate);
      } else {
        // Smooth bark with faint horizontal lenticels.
        const base = noise2(x / 8, y / 8, 21, w / 8, h / 8);
        const len = noise2(x / 10, y / 1.5, 22, w / 10, h / 1.5);
        v = 0.82 + 0.14 * base - (len > 0.82 ? 0.25 : 0);
      }
      const c = Math.round(Math.min(1, v) * 255);
      data.set([c, c, c, 255], (y * w + x) * 4);
    }
  t = new DataTexture(data, w, h);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  textures.set(`bark:${kind}`, t);
  return t;
}

/** Mip chains made elsewhere (a worker: trees/worker.ts), by leaf style. */
const primedMips = new Map<
  LeafStyle,
  { main: MipLevel[]; companion: MipLevel[] }
>();

/** The atlas and mips of a style, made in a worker: `spriteTextures` uses them. */
export function primeSpriteTextures(
  style: LeafStyle,
  atlas: SpriteAtlas,
  mips: { main: MipLevel[]; companion: MipLevel[] },
): void {
  primeSpriteAtlas(style, atlas);
  primedMips.set(style, mips);
}

/**
 * The sprite atlas textures of a leaf style (pixels from trees/leaftex.ts): albedo + alpha (sRGB) and normal +
 * thickness (linear, half the albedo's size), both with coverage-preserving mipmaps (the normal map follows the
 * albedo's alpha scale).
 */
export function spriteTextures(style: LeafStyle): {
  albedo: Texture;
  normal: Texture;
} {
  const key = `sprite:${style}`;
  const hit = textures.get(`${key}:a`);
  if (hit) return { albedo: hit, normal: textures.get(`${key}:n`)! };
  const atlas = spriteAtlas(style);
  const mips =
    primedMips.get(style) ??
    coverageMips(atlas.albedo, atlas.width, atlas.height, false, atlas.normal);
  const make = (levels: MipLevel[], srgb: boolean) => {
    const t = new DataTexture(
      levels[0].data,
      levels[0].width,
      levels[0].height,
    );
    t.mipmaps = levels;
    t.generateMipmaps = false;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  // The normal + thickness map is read at the albedo's uv at half its resolution (a leaf's tilt and glow need no more),
  // which saves a quarter of the atlas' memory.
  const albedo = make(mips.main, true);
  const normal = make(mips.companion.slice(1), false);
  textures.set(`${key}:a`, albedo);
  textures.set(`${key}:n`, normal);
  return { albedo, normal };
}

export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Coverage-preserving mip chain (trees/Foliage.md#alpha) of RGBA8 `data`: each level is a 2x2 box filter of the one
 * above (colour weighted by alpha unless `premultiplied`), then its alpha is scaled so the share of texels passing
 * ALPHA_TEST matches level 0, so crowns do not thin out with distance. A premultiplied texture (impostor atlas)
 * scales its colour and the `companion` texture (the normal atlas, divided by the same alpha) by the same factor.
 */
export function coverageMips(
  data: Uint8Array,
  width: number,
  height: number,
  premultiplied: boolean,
  companion?: Uint8Array,
): { main: MipLevel[]; companion: MipLevel[] } {
  const r = coverageChains(
    data,
    width,
    height,
    premultiplied,
    companion ? [companion] : [],
  );
  return { main: r.main, companion: r.companions[0] ?? [] };
}

/** `coverageMips` with several companion textures (the impostor's normal and thickness atlases) in one pass. */
export function coverageChains(
  data: Uint8Array,
  width: number,
  height: number,
  premultiplied: boolean,
  companions: Uint8Array[],
): { main: MipLevel[]; companions: MipLevel[][] } {
  const thr = ALPHA_TEST * 255;
  // Texels passing the alpha test after a scale: counted per alpha value, not per texel.
  const hist = new Uint32Array(256);
  const coverage = (n: number, s: number) => {
    let c = 0;
    for (let a = 0; a < 256; a++) if (a * s >= thr) c += hist[a];
    return c / n;
  };
  const count = (d: Uint8Array) => {
    hist.fill(0);
    for (let i = 3; i < d.length; i += 4) hist[d[i]]++;
  };
  count(data);
  const target = coverage(data.length / 4, 1);
  const main: MipLevel[] = [{ data, width, height }];
  const comps: MipLevel[][] = companions.map((c) => [
    { data: c, width, height },
  ]);
  const nc = comps.length;
  const cacc = new Float64Array(4);
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const src = main[main.length - 1].data;
    const out = new Uint8Array(nw * nh * 4);
    const couts = comps.map(() => new Uint8Array(nw * nh * 4));
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        let a3 = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(w - 1, x * 2 + dx);
            const sy = Math.min(h - 1, y * 2 + dy);
            const k = (sy * w + sx) * 4;
            const a = src[k + 3];
            const wt = premultiplied ? 1 : a;
            a0 += src[k] * wt;
            a1 += src[k + 1] * wt;
            a2 += src[k + 2] * wt;
            a3 += a;
            n++;
          }
        const o = (y * nw + x) * 4;
        const wsum = premultiplied ? n : a3;
        if (wsum > 0) {
          out[o] = Math.round(a0 / wsum);
          out[o + 1] = Math.round(a1 / wsum);
          out[o + 2] = Math.round(a2 / wsum);
        } else {
          const k = (Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2)) * 4;
          out[o] = src[k];
          out[o + 1] = src[k + 1];
          out[o + 2] = src[k + 2];
        }
        out[o + 3] = Math.round(a3 / n);
        for (let q = 0; q < nc; q++) {
          const csrc = comps[q][comps[q].length - 1].data;
          cacc.fill(0);
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const sx = Math.min(w - 1, x * 2 + dx);
              const sy = Math.min(h - 1, y * 2 + dy);
              const k = (sy * w + sx) * 4;
              for (let c = 0; c < 4; c++) cacc[c] += csrc[k + c];
            }
          for (let c = 0; c < 4; c++) couts[q][o + c] = Math.round(cacc[c] / n);
        }
      }
    // Alpha scale that restores the level-0 coverage (binary search).
    count(out);
    let lo = 0.5;
    let hi = 16;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (coverage(out.length / 4, mid) < target) lo = mid;
      else hi = mid;
    }
    const s = (lo + hi) / 2;
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (!a) continue;
      const na = Math.min(255, a * s);
      if (premultiplied) {
        const k = na / a;
        for (let c = 0; c < 3; c++)
          out[i + c] = Math.min(255, Math.round(out[i + c] * k));
        for (const cout of couts)
          for (let c = 0; c < 4; c++)
            cout[i + c] = Math.min(255, Math.round(cout[i + c] * k));
      }
      out[i + 3] = Math.round(na);
    }
    main.push({ data: out, width: nw, height: nh });
    couts.forEach((cout, q) =>
      comps[q].push({ data: cout, width: nw, height: nh }),
    );
    w = nw;
    h = nh;
  }
  return { main, companions: comps };
}

// --- materials -------------------------------------------------------------------------------------------------

const materials = new Map<
  string,
  | MeshStandardMaterial
  | MeshLambertMaterial
  | MeshBasicMaterial
  | MeshDepthMaterial
>();
let foliageA2C = false;

/** Alpha-to-coverage on the sprites when the renderer has MSAA (engine/materials.ts `setFoliageAntialias`). */
export function setTreeFoliageAntialias(on: boolean): void {
  foliageA2C = on;
  for (const [k, m] of materials)
    if (k.startsWith('sprite:') && m.alphaToCoverage !== on) {
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
}

export function barkMaterial(
  kind: BarkTexture | BarkScan,
): MeshStandardMaterial {
  const key = `bark:${kind}`;
  let m = materials.get(key) as MeshStandardMaterial | undefined;
  if (m) return m;
  m = new MeshStandardMaterial({
    vertexColors: true,
    map: barkTexture(kind),
    roughness: 0.95,
  });
  m.color.setScalar(barkGain(kind));
  m.name = `tree ${key}`;
  m.defines = {
    TREE_FULL: FULL_DETAIL_DISTANCE.toFixed(1),
    TREE_KEEP_NEAR: NEAR_SPRITES.toFixed(3),
    TREE_VIEW_Z: 'vViewPosition.z',
  };
  hookStandard(m, 'tree-bark-v7', false);
  materials.set(key, m);
  return m;
}

/** How far the atlas normal map bends the crown normal. */
const SPRITE_BEND = 0.8;

let spritePrepass = true;

/**
 * Sprite depth prepass on / off (trees/Performance.md#mitigations; off = the debug toggle or a driver failing the
 * load-time equal-depth check, trees/draw.ts `checkPrepass`). On: the lit sprites shade only where the prepass left
 * their own depth (EQUAL, no depth write; positions are `invariant`), so each covered pixel is shaded once. Off:
 * the normal depth test, writing depth (trees/Drawing.md#depth). Depth state only: no program changes.
 */
export function setSpritePrepass(on: boolean): void {
  spritePrepass = on;
  for (const [k, m] of materials)
    if (k.startsWith('sprite:lit:')) litSpriteDepth(m);
}

/** Lit sprites: after the prepass they pass where the depth is the prepass' (or nearer: a tiny offset covers the last bit). */
function litSpriteDepth(m: Material): void {
  m.depthFunc = LessEqualDepth;
  m.depthWrite = !spritePrepass;
  m.polygonOffset = spritePrepass;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
}

/** The lit foliage sprites (trees/Foliage.md#shading), after the depth prepass while it is on (`setSpritePrepass`). */
export function spriteMaterial(style: LeafStyle): MeshLambertMaterial {
  const key = `sprite:lit:${style}`;
  let m = materials.get(key) as MeshLambertMaterial | undefined;
  if (m) return m;
  m = spriteLit(style, false);
  m.name = `tree ${key}`;
  litSpriteDepth(m);
  materials.set(key, m);
  return m;
}

/**
 * Far sprites (trees/draw.ts: quads, one lit pass): the sprite program with the normal depth test, writing depth,
 * whatever `setSpritePrepass` says (no prepass draws them).
 */
export function spriteFarMaterial(style: LeafStyle): MeshLambertMaterial {
  const key = `sprite:far:${style}`;
  let m = materials.get(key) as MeshLambertMaterial | undefined;
  if (m) return m;
  m = spriteLit(style, false);
  m.name = `tree ${key}`;
  materials.set(key, m);
  return m;
}

/**
 * Main material of the crown shadow proxies (trees/proxy.ts), which the main pass never draws (trees/draw.ts sets
 * their count to 0 there): only its `shadowSide` matters, both faces, so the lathe's winding does not.
 */
export function proxyMaterial(): MeshBasicMaterial {
  const key = 'proxy';
  let m = materials.get(key) as MeshBasicMaterial | undefined;
  if (m) return m;
  m = new MeshBasicMaterial({ shadowSide: DoubleSide });
  m.name = 'tree shadow proxy';
  materials.set(key, m);
  return m;
}

/**
 * A sprite material on the ONE sprite program (same source, defines and cache key for the prepass and the lit pass:
 * the same compiled vertex code, so the depths match bit for bit; two different programs did not on every driver,
 * `invariant` or not). `depthOnly` = the prepass: `tlDepthOnly` returns right after the alpha test.
 * Lambert, not standard: a leaf cluster at roughness ~0.85 has next to no specular, and the sprites are most of the
 * tree pixels (trees/Performance.md#hotspots); the same sun, sky ambient, shadows, fog and leaf translucency.
 */
function spriteLit(style: LeafStyle, depthOnly: boolean): MeshLambertMaterial {
  const tex = spriteTextures(style);
  const m = new MeshLambertMaterial({
    vertexColors: true,
    map: tex.albedo,
    alphaTest: ALPHA_TEST,
    side: DoubleSide,
  });
  m.alphaToCoverage = foliageA2C;
  m.defines = {
    TREE_SPRITE: 1,
    TREE_SKY: 1,
    TREE_VIEW_Z: 'vViewPosition.z',
    TREE_FULL: FULL_DETAIL_DISTANCE.toFixed(1),
    TREE_KEEP_NEAR: NEAR_SPRITES.toFixed(3),
    TREE_BEND: SPRITE_BEND.toFixed(2),
    FALLBACK_AMBIENT: FALLBACK_AMBIENT.toFixed(2),
    RALLY_FOLIAGE: 0.45,
  };
  hookStandard(m, 'tree-sprite-v9', true, {
    tlSprNormal: { value: tex.normal },
    tlDepthOnly: { value: depthOnly ? 1 : 0 },
  });
  return m;
}

/** Equal-test debug view (trees/Drawing.md#debug): the depth prepass also paints magenta, under the lit pass. */
export function setSpritePrepassDebug(on: boolean): void {
  for (const [k, m] of materials)
    if (k.startsWith('sprite:prepass:') && m.colorWrite !== on)
      m.colorWrite = on;
}

/**
 * Sprite depth prepass: the lit sprites' own program (`spriteLit`) stopping after the alpha test, depth only.
 * Colour only in the equal-test debug view: magenta, so what the lit pass then fails to cover stays magenta.
 */
export function spritePrepassMaterial(style: LeafStyle): MeshLambertMaterial {
  const key = `sprite:prepass:${style}`;
  let m = materials.get(key) as MeshLambertMaterial | undefined;
  if (m) return m;
  m = spriteLit(style, true);
  m.name = `tree ${key}`;
  m.colorWrite = false;
  materials.set(key, m);
  return m;
}

export type TreeDepthKind = 'branch' | 'sprite' | 'proxy';

/**
 * Leafy holes in a crown proxy's shadow: two octaves of value noise over the world position (about 0.6 m cells),
 * so light falls through the crown in dapples that do not crawl with the camera.
 */
const PROXY_HOLES = /* glsl */ `
	vec3 tpP = vTreeWorld * 1.7;
	vec3 tpI = floor( tpP );
	vec3 tpF = fract( tpP );
	tpF = tpF * tpF * ( 3.0 - 2.0 * tpF );
	#define TP_H( o ) fract( sin( dot( tpI + o, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 )
	float tpN = mix(
		mix( mix( TP_H( vec3( 0, 0, 0 ) ), TP_H( vec3( 1, 0, 0 ) ), tpF.x ), mix( TP_H( vec3( 0, 1, 0 ) ), TP_H( vec3( 1, 1, 0 ) ), tpF.x ), tpF.y ),
		mix( mix( TP_H( vec3( 0, 0, 1 ) ), TP_H( vec3( 1, 0, 1 ) ), tpF.x ), mix( TP_H( vec3( 0, 1, 1 ) ), TP_H( vec3( 1, 1, 1 ) ), tpF.x ), tpF.y ),
		tpF.z );
	if ( tpN > 0.72 ) discard;
`;

/**
 * Shadow-pass material: the same positions (wind, sprite facing + thinning), the caster flag (no dither) and, for
 * sprites, the material's map and ALPHA_TEST, which three copies over. `proxy`: a crown shadow proxy (trees/proxy.ts)
 * with leafy holes.
 */
export function treeDepthMaterial(kind: TreeDepthKind): MeshDepthMaterial {
  const key = `depth:${kind}`;
  let m = materials.get(key) as MeshDepthMaterial | undefined;
  if (m) return m;
  const sprite = kind === 'sprite';
  const proxy = kind === 'proxy';
  m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.defines = {
    TREE_SHADOW_PASS: 1,
    TREE_FULL: FULL_DETAIL_DISTANCE.toFixed(1),
    TREE_KEEP_NEAR: NEAR_SPRITES.toFixed(3),
    ...(sprite ? { TREE_SPRITE: 1 } : {}),
  };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    Object.assign(shader.uniforms, treeUniforms);
    injectVertex(shader, true, sprite);
    injectFragment(shader);
    if (proxy) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vTreeWorld;',
        )
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n\tvTreeWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vTreeWorld;',
        )
        .replace('void main() {', `void main() {\n${PROXY_HOLES}`);
    }
  };
  m.customProgramCacheKey = () => `tree-depth-v8-${kind}`;
  materials.set(key, m);
  return m;
}

// --- impostor --------------------------------------------------------------------------------------------------

/** Octahedral impostor atlas: N x N frames over the upper hemisphere (trees/impostor.ts bakes them). */
export const IMPOSTOR_FRAMES = 8;

/** Hemi-octahedral map of a unit direction with y >= 0 -> [0, 1]^2 (the same formula as the shader). */
export function hemiOctEncode(d: [number, number, number]): [number, number] {
  const s = Math.abs(d[0]) + Math.abs(d[2]) + Math.max(d[1], 0);
  const px = d[0] / s;
  const pz = d[2] / s;
  return [(px + pz) * 0.5 + 0.5, (px - pz) * 0.5 + 0.5];
}

export function hemiOctDecode(u: number, v: number): [number, number, number] {
  const fx = u * 2 - 1;
  const fy = v * 2 - 1;
  const x = (fx + fy) * 0.5;
  const z = (fx - fy) * 0.5;
  const y = 1 - Math.abs(x) - Math.abs(z);
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
}

/** Layers per variant in the impostor texture array: albedo + coverage, normal + depth, thickness. */
export const IMPOSTOR_LAYERS = 3;

const IMPOSTOR_VERTEX = /* glsl */ `
	// This instance's variant: its array layers and bounding sphere.
	int tiVariant = int( treeInst.w + 0.5 );
	vec2 tlSphere = tlSpheres[ tiVariant ];
	vTiLayer = float( tiVariant * IMPOSTOR_LAYERS );
	// Billboard around the bounding sphere centre, facing the camera, upright like the bake cameras.
	vec3 tiCenter = tOrigin + vec3( 0.0, tlSphere.x * tScale, 0.0 );
	vec3 tiToCam = normalize( cameraPosition - tiCenter );
	vec3 tiRight = cross( vec3( 0.0, 1.0, 0.0 ), tiToCam );
	tiRight = dot( tiRight, tiRight ) > 1e-6 ? normalize( tiRight ) : tRot * vec3( 1.0, 0.0, 0.0 );
	vec3 tiUp = cross( tiToCam, tiRight );
	float tiR = tlSphere.y * tScale;
	// The quad sits at the FRONT of the bounding sphere: the baked depth only ever pushes a pixel away from the
	// camera (trees/Drawing.md#depth), never in front of the quad.
	// The billboard cropped to what its baked views cover (impostor.ts impostorBounds): frame uv and quad position.
	vec4 tiB = tlBounds[ tiVariant ];
	vec2 tiQ = mix( tiB.xy, tiB.zw, position.xy * 0.5 + 0.5 );
	vec2 tiCorner = tiQ * 2.0 - 1.0;
	#ifdef TREE_IMPOSTOR_FLAT
		// Far impostors write no baked depth (it costs the early depth test): the quad stands through the centre.
		vec3 tiWorld = tiCenter + ( tiRight * tiCorner.x + tiUp * tiCorner.y ) * tiR;
	#else
		vec3 tiWorld = tiCenter + ( tiToCam + tiRight * tiCorner.x + tiUp * tiCorner.y ) * tiR;
	#endif
	// Trunk sway at this corner's height above the foot (object space), the same as the geometry levels.
	tiWorld += tWindW * treeTrunk( ( tiWorld.y - tOrigin.y ) / tScale, treeInst.z, tGust ) * tScale;
	vec4 mvPosition = viewMatrix * vec4( tiWorld, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	// Frames: the grid cell around the object-space view direction (the fragment shader blends 3 of its corners).
	vec3 tiDir = transpose( tRot ) * tiToCam;
	tiDir.y = max( tiDir.y, 0.0 );
	float tiS = abs( tiDir.x ) + abs( tiDir.z ) + tiDir.y;
	vec2 tiP = tiDir.xz / tiS;
	vec2 tiGrid = ( vec2( tiP.x + tiP.y, tiP.x - tiP.y ) * 0.5 + 0.5 ) * ( TREE_FRAMES - 1.0 );
	vec2 tiF0 = min( floor( tiGrid ), vec2( TREE_FRAMES - 2.0 ) );
	vTiFrame = tiF0;
	vTiWeight = tiGrid - tiF0;
	vTiUv = tiQ;
	vTiRot0 = tRot[ 0 ];
	vTiRot1 = tRot[ 1 ];
	vTiRot2 = tRot[ 2 ];
	vTiDepth = tiR;
	vTiToCamView = normalize( ( viewMatrix * vec4( tiToCam, 0.0 ) ).xyz );
`;

/** Albedo (sRGB-decoded), coverage and the three samples' blend; the normal / depth / thickness after it. */
const IMPOSTOR_FRAGMENT = /* glsl */ `
	// The three baked views nearest the view direction (the grid triangle it falls in), barycentric weights.
	vec2 tiF = vTiWeight;
	vec2 tiC0 = vec2( 0.0 );
	vec3 tiW = vec3( 1.0 - tiF.x - tiF.y, tiF.x, tiF.y );
	if ( tiF.x + tiF.y > 1.0 ) {
		tiC0 = vec2( 1.0 );
		tiW = vec3( tiF.x + tiF.y - 1.0, 1.0 - tiF.y, 1.0 - tiF.x );
	}
	vec2 tiUv = clamp( vTiUv, 0.002, 0.998 );
	vec2 tiU0 = ( vTiFrame + tiC0 + tiUv ) / TREE_FRAMES;
	vec2 tiU1 = ( vTiFrame + vec2( 1.0, 0.0 ) + tiUv ) / TREE_FRAMES;
	vec2 tiU2 = ( vTiFrame + vec2( 0.0, 1.0 ) + tiUv ) / TREE_FRAMES;
	float tiA = floor( vTiLayer + 0.5 );
	// Albedo + coverage: the three views blended (no jump between views as the camera passes).
	vec4 tiA0 = texture( tlAtlas, vec3( tiU0, tiA ) );
	vec4 tiA1 = texture( tlAtlas, vec3( tiU1, tiA ) );
	vec4 tiA2 = texture( tlAtlas, vec3( tiU2, tiA ) );
	vec4 tiAlbedo = tiA0 * tiW.x + tiA1 * tiW.y + tiA2 * tiW.z;
	// Out before the normal: most of a billboard is empty (trees/Performance.md#mitigations).
	if ( tiAlbedo.a < TREE_ALPHA_TEST ) discard;
	// Normal + depth from the heaviest view only (cheap: impostors are far trees), un-premultiplied by its own coverage.
	vec2 tiUN = tiW.x >= tiW.y && tiW.x >= tiW.z ? tiU0 : tiW.y >= tiW.z ? tiU1 : tiU2;
	float tiAN = tiW.x >= tiW.y && tiW.x >= tiW.z ? tiA0.a : tiW.y >= tiW.z ? tiA1.a : tiA2.a;
	vec4 tiNormal = texture( tlAtlas, vec3( tiUN, tiA + 1.0 ) );
	float tiInvN = 1.0 / max( tiAN, 1e-3 );
	float tiInvA = 1.0 / max( tiAlbedo.a, 1e-3 );
	diffuseColor.rgb = sRGBTransferEOTF( vec4( tiAlbedo.rgb * tiInvA, 1.0 ) ).rgb;
	diffuseColor.a = 1.0;
`;

/** An impostor material whose vertex shader places its own trees (world/far-forest.ts): it sets `treeInst`,
 * `treeFade`, `instanceMatrix` and `tgOut` (the far end of its dither) before the tree code runs. */
export interface ImpostorGrid {
  uniforms: Record<string, { value: unknown }>;
  pars: string;
  main: string;
  key: string;
}

/**
 * The ONE impostor material of every variant of every species (trees/Performance.md#mitigations): the texture array
 * of trees/impostor.ts `impostorArray` and each variant's bounding sphere (cy, r), picked per instance by
 * `treeInst.w` = variant slot. Lit like the geometry (trees/Lod.md#levels): the baked normal through the standard
 * lights, the sky SH, shadows, fog, and the baked thickness in the translucency term; never albedo alone.
 */
export function impostorMaterial(
  atlas: Texture,
  spheres: { cy: number; r: number }[],
  bounds: [number, number, number, number][],
  flat = false,
  grid?: ImpostorGrid,
): MeshLambertMaterial {
  // Lambert: impostors are far trees (diffuse only, like the sprites); their meshes receive no shadow (beyond the
  // shadow box), so the shadow map is not read either (trees/draw.ts).
  const m = new MeshLambertMaterial();
  m.name = flat ? 'tree impostors far' : 'tree impostors';
  m.defines = {
    ...(flat ? { TREE_IMPOSTOR_FLAT: 1 } : {}),
    ...(grid ? { TREE_IMPOSTOR_GRID: 1 } : {}),
    TREE_IMPOSTOR: 1,
    TREE_SKY: 1,
    TREE_VIEW_Z: '-tiView.z',
    TREE_FULL: FULL_DETAIL_DISTANCE.toFixed(1),
    TREE_KEEP_NEAR: NEAR_SPRITES.toFixed(3),
    TREE_FRAMES: `${IMPOSTOR_FRAMES}.0`,
    TREE_ALPHA_TEST: `${ALPHA_TEST.toFixed(3)}`,
    TREE_VARIANTS: Math.max(1, spheres.length),
    IMPOSTOR_LAYERS,
    FALLBACK_AMBIENT: FALLBACK_AMBIENT.toFixed(2),
    RALLY_FOLIAGE: 0.45,
  };
  const uniforms = {
    tlAtlas: { value: atlas },
    tlSpheres: { value: spheres.map((s) => new Vector2(s.cy, s.r)) },
    tlBounds: {
      value: bounds.map((b) => new Vector4(b[0], b[1], b[2], b[3])),
    },
  };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    Object.assign(shader.uniforms, treeUniforms, uniforms, grid?.uniforms);
    if (grid)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
${grid.pars}`,
        )
        .replace(
          '#include <begin_vertex>',
          `${grid.main}
#include <begin_vertex>`,
        );
    const vary = /* glsl */ `
varying vec2 vTiFrame;
varying vec2 vTiWeight;
varying vec2 vTiUv;
varying vec3 vTiRot0;
varying vec3 vTiRot1;
varying vec3 vTiRot2;
varying float vTiDepth;
varying vec3 vTiToCamView;
varying float vTiLayer;
`;
    injectVertex(shader, false);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec2 tlSpheres[ TREE_VARIANTS ];\nuniform vec4 tlBounds[ TREE_VARIANTS ];\n${vary}`,
      )
      .replace(
        '#include <project_vertex>',
        `${IMPOSTOR_VERTEX}\n${VERTEX_COLLAPSE}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        'vec4 worldPosition = vec4( tiWorld, 1.0 );',
      );
    injectFragment(shader);
    shader.fragmentShader = `${NO_ENVMAP}\n${shader.fragmentShader}`
      .replace(
        '#include <common>',
        `#include <common>\nuniform highp sampler2DArray tlAtlas;\nuniform mat4 projectionMatrix;\n${vary}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n${IMPOSTOR_FRAGMENT}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${FRAGMENT_COLOR}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${FRAGMENT_AMBIENT}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\n${FRAGMENT_NORMALS}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
	vec3 tiN = mat3( vTiRot0, vTiRot1, vTiRot2 ) * ( tiNormal.xyz * tiInvN * 2.0 - 1.0 );
	normal = normalize( ( viewMatrix * vec4( tiN, 0.0 ) ).xyz );
	nonPerturbedNormal = normal;
	// A crown's average leaf thickness (the thickness layer is not read: one texture fetch less per pixel).
	float tlThickness = 0.5;
	// Depth: the baked surface sits this far behind the quad (baked 1 = the sphere's front = the quad, 0 = its back).
	vec3 tiView = - vViewPosition + vTiToCamView * ( ( tiNormal.w * tiInvN ) * 2.0 - 2.0 ) * vTiDepth;
	vec4 tiClip = projectionMatrix * vec4( tiView, 1.0 );
	#ifndef TREE_IMPOSTOR_FLAT
		gl_FragDepth = clamp( tiClip.z / tiClip.w * 0.5 + 0.5, 0.0, 1.0 );
	#endif`,
      );
  };
  m.customProgramCacheKey = () =>
    `tree-impostor-v10-${spheres.length}${flat ? '-flat' : ''}${grid ? `-${grid.key}` : ''}`;
  return m;
}
