import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
} from 'three';

/**
 * What the car reflects besides the sky (`world/car-surround.ts` fills it): the sky env map is one PMREM for the whole
 * stage, so in a wood paint and glass showed open sky. Here, per azimuth round the car, how much of each elevation band
 * is covered by crowns, trunks or terrain and what colour that is; the car materials (`carEnv`, engine/world-shading.ts)
 * lay it over the sky env lookup, blurred by roughness. No scene render: a 128 x 12 texture rebuilt on the CPU.
 *
 * Texture: SURROUND_BINS azimuth texels (u = atan2(z, x) / 2pi, repeating) x 3 blocks of SURROUND_BLUR rows, each row
 * the block blurred wider round the azimuth (roughness picks the row, linear filtering mixes two):
 * - block 0 / 1: coverage 0..1 of the elevation bands 0-3 / 4-7 (SURROUND_BANDS of 90 / 8 deg from the horizon up);
 * - block 2: rgb = sqrt(the covering's radiance / SURROUND_RANGE) (env map units; sqrt keeps dark greens in 8 bits),
 *   a = shade of the ground in that direction (0..1).
 */
export const SURROUND_BINS = 128;
export const SURROUND_BANDS = 8;
export const SURROUND_BLUR = 4;
export const SURROUND_ROWS = 3 * SURROUND_BLUR;
export const SURROUND_RANGE = 0.5;

const data = new Uint8Array(SURROUND_BINS * SURROUND_ROWS * 4);
const texture = new DataTexture(
  data,
  SURROUND_BINS,
  SURROUND_ROWS,
  RGBAFormat,
  UnsignedByteType,
);
texture.wrapS = RepeatWrapping;
texture.wrapT = ClampToEdgeWrapping;
texture.magFilter = LinearFilter;
texture.minFilter = LinearFilter;
texture.generateMipmaps = false;
texture.name = 'car-surround';
texture.needsUpdate = true;

/**
 * Shared by every `carEnv` material. `wsSurroundOn`: x = strength (0 = the sky env only: studio, car viewer, quality
 * low), y = the car's diffuse sky light factor (1 = open sky; the covered share of the sky lights it less).
 */
export const carSurroundUniforms = {
  wsSurround: { value: texture },
  wsSurroundOn: { value: new Vector2(0, 1) },
};

/** The texture's bytes (write, then `markSurroundDirty`). */
export const surroundData = data;

export function markSurroundDirty(): void {
  texture.needsUpdate = true;
}

/** Off: the car reflects the sky env map alone (showroom / car viewer, a game leaving). */
export function surroundOff(): void {
  carSurroundUniforms.wsSurroundOn.value.set(0, 1);
}

/**
 * GLSL (inside `#ifdef RALLY_CAR_ENV`, before getIBLRadiance): the env lookup's colour with the surroundings laid
 * over it. `dir` = world reflection direction, `rough` = the lobe's roughness.
 */
export const CAR_SURROUND_PARS = /* glsl */ `
uniform sampler2D wsSurround;
uniform vec2 wsSurroundOn;
float wsSurroundCov( vec4 a, vec4 b, float x ) {
	x = clamp( x, 0.0, 7.0 );
	return dot( a, max( vec4( 0.0 ), 1.0 - abs( x - vec4( 0.0, 1.0, 2.0, 3.0 ) ) ) ) +
		dot( b, max( vec4( 0.0 ), 1.0 - abs( x - vec4( 4.0, 5.0, 6.0, 7.0 ) ) ) );
}
vec3 wsSurroundEnv( vec3 env, vec3 dir, float rough ) {
	if ( wsSurroundOn.x <= 0.0 ) return env;
	// atan( 0, 0 ) is undefined (straight up / down).
	float u = atan( dir.z, abs( dir.x ) + abs( dir.z ) < 1e-5 ? 1.0 : dir.x ) * 0.15915494;
	// Roughness -> blur row (0 = sharp clear coat, 3 = the widest).
	float f = clamp( sqrt( rough ) * 3.4 - 0.3, 0.0, 3.0 );
	float r = ${SURROUND_ROWS.toFixed(1)};
	vec4 c0 = textureLod( wsSurround, vec2( u, ( 0.5 + f ) / r ), 0.0 );
	vec4 c1 = textureLod( wsSurround, vec2( u, ( ${SURROUND_BLUR.toFixed(1)} + 0.5 + f ) / r ), 0.0 );
	vec4 col = textureLod( wsSurround, vec2( u, ( ${(2 * SURROUND_BLUR).toFixed(1)} + 0.5 + f ) / r ), 0.0 );
	float el = asin( clamp( dir.y, -1.0, 1.0 ) );
	// Band index (band k centred at (k + 0.5) x 11.25 deg); a rough lobe averages over neighbouring bands too.
	float x = el * ${(SURROUND_BANDS / (Math.PI / 2)).toFixed(6)} - 0.5;
	float w = rough * rough * 2.5;
	float cov = ( wsSurroundCov( c0, c1, x - w ) + wsSurroundCov( c0, c1, x ) + wsSurroundCov( c0, c1, x + w ) ) / 3.0;
	// The lowest band runs on a little under the horizon (the trunks' feet), then the ground takes over.
	cov *= smoothstep( -0.09, -0.02, el );
	// Low in the band: trunks and the understorey in the crowns' shade.
	vec3 occ = col.rgb * col.rgb * ${SURROUND_RANGE.toFixed(2)} * mix( 0.6, 1.0, smoothstep( 0.0, 0.45, el ) );
	vec3 o = mix( env, occ, clamp( cov, 0.0, 1.0 ) * wsSurroundOn.x );
	// The ground under crowns is in their shade.
	float below = 1.0 - smoothstep( -0.12, 0.0, el );
	return o * ( 1.0 - 0.6 * col.a * below * wsSurroundOn.x );
}
`;

/** GLSL for lights_fragment_end: the car's diffuse sky light, as much as its surroundings leave of the sky. */
export const CAR_SURROUND_DIFFUSE = /* glsl */ `
#if defined( RALLY_CAR_ENV ) && defined( STANDARD )
	reflectedLight.indirectDiffuse *= wsSurroundOn.y;
#endif
`;
