import type { V3 } from './math';

/**
 * The `treeSprite` vertex attribute of a foliage sprite (trees/Foliage.md#sprites), one vec4 because the sprite
 * vertices are at the 16-attribute limit: x = the outline corner (u, v 10 bits each), the card (2 bits), a "grows
 * along its heading" flag and the sign of the heading's y packed in one float, y / w = the heading's x / z, z = the
 * sprite size (m).
 *
 * The heading is the way the leaf spray grows (object space, unit). A leaf card (card 1 or 2) is fixed in the tree:
 * its x axis is the heading, so the spray's painted stem stays on its twig from every side, and cards 1 and 2 cross
 * at right angles round it. A billboard (card 0, the round needle bursts) faces the camera.
 */

const CORNER_BITS = 1024;
const CORNER_MAX = CORNER_BITS - 1;

/**
 * Packs a sprite vertex: the outline corner (-0.5..0.5 each), size, heading (null: round image, no heading) and card
 * (0 billboard, 1 / 2 the crossed leaf cards).
 */
export function packSprite(
  cx: number,
  cy: number,
  size: number,
  heading: V3 | null,
  card: number,
  out: Float32Array | number[],
  at: number,
): void {
  const q = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c + 0.5)) * CORNER_MAX);
  const h = heading ?? [0, 1, 0];
  out[at] =
    (((q(cx) * CORNER_BITS + q(cy)) * 4 + card) * 2 + (heading ? 1 : 0)) * 2 +
    (h[1] < 0 ? 1 : 0);
  out[at + 1] = h[0];
  out[at + 2] = size;
  out[at + 3] = h[2];
}

/** The heading of vertex `v` of a `SpriteData.heading` array (null: a round image has none, y = 2). */
export function headingAt(heading: Float32Array, v: number): V3 | null {
  return heading[v * 3 + 1] > 1.5
    ? null
    : [heading[v * 3], heading[v * 3 + 1], heading[v * 3 + 2]];
}

/** The outline corner of a packed vertex (what the GLSL below reads). */
export function unpackCorner(x: number): [number, number] {
  const r = Math.floor(x / 16);
  const v = r % CORNER_BITS;
  return [Math.floor(r / CORNER_BITS) / CORNER_MAX - 0.5, v / CORNER_MAX - 0.5];
}

/** The card of a packed vertex (0 billboard, 1 / 2 leaf cards). */
export function unpackCard(x: number): number {
  return Math.floor(x / 4) % 4;
}

/** The heading of a packed vertex, null for a sprite without one. */
export function unpackHeading(x: number, hx: number, hz: number): V3 | null {
  if (Math.floor(x / 2) % 2 < 1) return null;
  const y = Math.sqrt(Math.max(0, 1 - hx * hx - hz * hz));
  return [hx, x % 2 >= 1 ? -y : y, hz];
}

/** `TREE_SPRITE_LIFT` below (share of the sprite size). */
const SPRITE_LIFT = 0.3;

/**
 * GLSL for the shaders that place a sprite (trees/materials.ts `SPRITE_PROJECT`, the impostor bake): the corner,
 * heading, "has a heading" and card out of `treeSprite`, and the sprite's two axes. A leaf card's x axis is its
 * heading and its y axis a side of it, rolled by `roll` (rad; card 2 a right angle further), fixed in the tree. A
 * billboard lies in the plane facing the camera (`right`, `up`): the image's x axis follows the projected heading; a
 * heading along the view takes `fallback` (rad) instead, and the spray shortens as it points at the viewer. `flutter`
 * (rad) turns either a little.
 */
export const TREE_SPRITE_AXES = /* glsl */ `
// A billboard stands this share of its size towards the viewer (not in the shadow pass): a burst wraps round its twig,
// so the twig reads through its gaps instead of streaking across it. Leaf cards stay on their twigs.
#define TREE_SPRITE_LIFT ${SPRITE_LIFT.toFixed(3)}
void treeSpriteCorner( vec4 s, out vec2 corner, out vec3 heading, out float aligned, out float card ) {
	float down = mod( s.x, 2.0 );
	float r1 = ( s.x - down ) * 0.5;
	aligned = mod( r1, 2.0 );
	float r2 = ( r1 - aligned ) * 0.5;
	card = mod( r2, 4.0 );
	float r3 = ( r2 - card ) * 0.25;
	float v = mod( r3, ${CORNER_BITS}.0 );
	corner = vec2( ( r3 - v ) / ${CORNER_BITS}.0, v ) / ${CORNER_MAX}.0 - 0.5;
	heading = vec3( s.y, ( down > 0.5 ? -1.0 : 1.0 ) * sqrt( max( 0.0, 1.0 - s.y * s.y - s.w * s.w ) ), s.w );
}
// A per-sprite roll (rad) for a leaf card from its centre (object space).
float treeCardRoll( vec3 centre ) {
	return ( fract( sin( dot( centre, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) - 0.5 ) * 1.2;
}
void treeSpriteAxes( vec3 right, vec3 up, vec3 heading, float aligned, float card, float roll, float fallback, float flutter, out vec3 axisR, out vec3 axisU, out float stretch ) {
	if ( card > 0.5 ) {
		vec3 h = normalize( heading );
		vec3 side = cross( h, vec3( 0.0, 1.0, 0.0 ) );
		side = dot( side, side ) > 1e-6 ? normalize( side ) : vec3( 1.0, 0.0, 0.0 );
		vec3 n = cross( side, h );
		float r = roll + flutter + ( card > 1.5 ? 1.5708 : 0.0 );
		axisR = h;
		axisU = side * cos( r ) + n * sin( r );
		stretch = 1.0;
		return;
	}
	vec2 a = vec2( dot( heading, right ), dot( heading, up ) );
	float len = length( a );
	vec2 f = vec2( cos( fallback ), sin( fallback ) );
	a = normalize( mix( f, a / max( len, 1e-4 ), aligned * smoothstep( 0.05, 0.35, len ) ) + vec2( 1e-4, 0.0 ) );
	float c = a.x * cos( flutter ) - a.y * sin( flutter );
	float s = a.y * cos( flutter ) + a.x * sin( flutter );
	axisR = right * c + up * s;
	axisU = up * c - right * s;
	stretch = mix( 1.0, mix( 0.6, 1.0, smoothstep( 0.1, 0.7, len ) ), aligned );
}
`;
