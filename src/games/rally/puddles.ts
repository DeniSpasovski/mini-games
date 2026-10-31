/**
 * Puddles on a wet road: one seeded field of standing water, read by the road shader (`PUDDLE_GLSL`: a shallow rim, a
 * deeper middle, rain rings, engine/world-shading.ts) and by the physics (`puddleDepth`, aquaplaning and drag,
 * physics/vehicle.ts), so a car hits the water it drives through. The field is two octaves of value noise over world
 * x / z, pulled out of line by a slow domain warp so the pools have ragged, bent outlines, on an integer hash (the
 * `permute` of Ashima's GLSL noise: exact in 32-bit floats), the same on the CPU and the GPU. More of it fills as the
 * ground gets wetter (weather.ts `wet`): a few dips after light rain, long pools in a downpour. Keep the two copies in
 * step.
 */

/** Size (m) of the large and the small noise cell. */
const BIG = 5.5;
const SMALL = 1.7;
/** Size (m) of the warp's noise cell and how far (m) it can push the field. */
const WARP_CELL = 11;
const WARP = 7;
/** Noise level where water starts at wet = 0.5 / 1 (lower = more puddles). */
const DRY_EDGE = 0.8;
const WET_EDGE = 0.68;
/** Deepest water (m) a puddle holds: a few cm in a road dip. */
export const PUDDLE_DEPTH = 0.03;

const permute = (x: number) => ((x * 34 + 1) * x) % 289;
const mod289 = (x: number) => ((x % 289) + 289) % 289;

function hash(ix: number, iz: number): number {
  return permute(mod289(permute(mod289(ix)) + mod289(iz))) / 289;
}

function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** The noise level water starts at on ground `wet` 0..1 (Infinity when dry). */
function edge(wet: number): number {
  return wet <= 0.3
    ? Infinity
    : DRY_EDGE + (WET_EDGE - DRY_EDGE) * Math.min(1, (wet - 0.5) / 0.5);
}

/** The puddle field at a point, 0..1 (0.62 big cells + 0.38 small ones, on a warped plane). */
export function puddleField(x: number, z: number): number {
  const wx = x + (noise(x / WARP_CELL + 7.3, z / WARP_CELL + 2.9) - 0.5) * WARP;
  const wz =
    z + (noise(x / WARP_CELL + 17.1, z / WARP_CELL + 41.7) - 0.5) * WARP;
  return (
    0.62 * noise(wx / BIG, wz / BIG) +
    0.38 * noise(wx / SMALL + 31.7, wz / SMALL + 11.3)
  );
}

/** Water standing on the road at x / z (m deep, 0 = none) on ground `wet` 0..1. */
export function puddleDepth(x: number, z: number, wet: number): number {
  const e = edge(wet);
  if (e === Infinity) return 0;
  const n = puddleField(x, z);
  if (n <= e) return 0;
  return PUDDLE_DEPTH * Math.min(1, (n - e) / 0.1);
}

/**
 * GLSL twin of `puddleField` / the puddle cover, plus the rain's rings on the water.
 *
 * - `wsPuddle( xz, wet )` = vec3( cover, deep, rim ), each 0..1: the water's cover (a thin film at the shore, where
 *   `puddleDepth` starts), how deep it is (the middle of a pool: a darker, clearer mirror) and a damp ring around it.
 *   A little fine noise (cm) breaks the shore up; it is not in the CPU copy (a cm of outline, not a different pool).
 * - `wsRipples( xz, t, rate )` = the slope (x, z) of the water surface where drops fall: rings that grow and fade
 *   from random points at random times, a few per square metre per second in a downpour (`rate` 0..1 = the share of
 *   places a drop is falling at). Two layers (cells of 0.6 and 0.9 m) so they never line up in a grid.
 */
export const PUDDLE_GLSL = /* glsl */ `
float wsPermute( float x ) { return mod( ( x * 34.0 + 1.0 ) * x, 289.0 ); }
float wsHash( vec2 i ) { return wsPermute( mod( wsPermute( mod( i.x, 289.0 ) ) + mod( i.y, 289.0 ), 289.0 ) ) / 289.0; }
float wsVNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = wsHash( i );
	float b = wsHash( i + vec2( 1.0, 0.0 ) );
	float c = wsHash( i + vec2( 0.0, 1.0 ) );
	float d = wsHash( i + vec2( 1.0, 1.0 ) );
	return a + ( b - a ) * u.x + ( c - a ) * u.y + ( a - b - c + d ) * u.x * u.y;
}
vec3 wsPuddle( vec2 xz, float wet ) {
	if ( wet <= 0.3 ) return vec3( 0.0 );
	float e = ${DRY_EDGE.toFixed(3)} + ${(WET_EDGE - DRY_EDGE).toFixed(3)} * min( 1.0, ( wet - 0.5 ) / 0.5 );
	vec2 w = xz + ( vec2( wsVNoise( xz / ${WARP_CELL.toFixed(3)} + vec2( 7.3, 2.9 ) ), wsVNoise( xz / ${WARP_CELL.toFixed(3)} + vec2( 17.1, 41.7 ) ) ) - 0.5 ) * ${WARP.toFixed(3)};
	float n = 0.62 * wsVNoise( w / ${BIG.toFixed(3)} ) + 0.38 * wsVNoise( w / ${SMALL.toFixed(3)} + vec2( 31.7, 11.3 ) );
	n += ( wsVNoise( xz / 0.35 + vec2( 3.1, 5.7 ) ) - 0.5 ) * 0.03;
	return vec3( smoothstep( e - 0.006, e + 0.02, n ), smoothstep( e + 0.015, e + 0.1, n ), smoothstep( e - 0.14, e, n ) );
}
vec2 wsRingLayer( vec2 p, float cell, float t, float rate, float seed ) {
	vec2 q = p / cell;
	vec2 id = floor( q );
	vec2 f = ( q - id - 0.5 ) * cell;
	float h = wsHash( id + seed );
	float age = t * ( 0.8 + 0.5 * h ) + h * 31.0;
	float cyc = floor( age );
	float ph = age - cyc;
	vec2 cid = id + vec2( cyc * 13.7, cyc * 5.3 ) + seed;
	if ( wsHash( cid + 91.0 ) > rate ) return vec2( 0.0 );
	vec2 c = ( vec2( wsHash( cid ), wsHash( cid + 17.0 ) ) - 0.5 ) * 0.4 * cell;
	vec2 v = f - c;
	float d = length( v );
	float x = d - ( 0.03 + ph * 0.27 * cell );
	float amp = ( 1.0 - ph ) * ( 1.0 - ph ) * smoothstep( 0.0, 0.2, ph ) * smoothstep( 0.0, 0.05, d );
	float s = amp * cos( x * 160.0 ) * exp( - x * x * 900.0 );
	return v / max( d, 1e-3 ) * s;
}
vec2 wsRipples( vec2 xz, float t, float rate ) {
	return wsRingLayer( xz, 0.6, t, rate, 3.0 ) + wsRingLayer( xz + 5.3, 0.9, t * 0.8 + 7.0, rate, 11.0 );
}
`;
