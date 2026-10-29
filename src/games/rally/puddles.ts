/**
 * Puddles on a wet road: one seeded field of standing water, read by the road shader (`PUDDLE_GLSL`, a mirror-flat film
 * with rain rings, engine/world-shading.ts) and by the physics (`puddleDepth`, aquaplaning and drag,
 * physics/vehicle.ts), so a car hits the water it drives through. The field is two octaves of value noise over world
 * x / z on an integer hash (the `permute` of Ashima's GLSL noise: exact in 32-bit floats), the same on the CPU and the
 * GPU. More of it fills as the ground gets wetter (weather.ts `wet`): a few dips after light rain, long pools in a
 * downpour. Keep the two copies in step.
 */

/** Size (m) of the large and the small noise cell. */
const BIG = 5.5;
const SMALL = 1.7;
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

/** The puddle field at a point, 0..1 (0.65 big cells + 0.35 small ones). */
export function puddleField(x: number, z: number): number {
  return (
    0.65 * noise(x / BIG, z / BIG) +
    0.35 * noise(x / SMALL + 31.7, z / SMALL + 11.3)
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
 * GLSL twin of `puddleField` / the puddle cover: `wsPuddle( xz, wet )` = 0..1, the water's cover (a soft rim) where
 * `puddleDepth` > 0.
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
float wsPuddle( vec2 xz, float wet ) {
	if ( wet <= 0.3 ) return 0.0;
	float e = ${DRY_EDGE.toFixed(3)} + ${(WET_EDGE - DRY_EDGE).toFixed(3)} * min( 1.0, ( wet - 0.5 ) / 0.5 );
	float n = 0.65 * wsVNoise( xz / ${BIG.toFixed(3)} ) + 0.35 * wsVNoise( xz / ${SMALL.toFixed(3)} + vec2( 31.7, 11.3 ) );
	return smoothstep( e, e + 0.04, n );
}
`;
