import type { V3 } from './math';

/**
 * The `treeSprite` vertex attribute of a foliage sprite (trees/Foliage.md#sprites), one vec4 because the sprite
 * vertices are at the 16-attribute limit: x = the outline corner (u, v 10 bits each), a "grows along its heading"
 * flag and the sign of the heading's y packed in one float, y / w = the heading's x / z, z = the sprite size (m).
 *
 * The heading is the way the leaf spray grows (object space, unit): the shader turns the quad so the image's x axis
 * follows it on screen (`TREE_SPRITE_AXES`), so a spray lies along its twig from any side. Sprites of a round image
 * (needle bursts) carry no heading and keep the fallback turn.
 */

const CORNER_BITS = 1024;
const CORNER_MAX = CORNER_BITS - 1;

/** Packs a sprite vertex: the outline corner (-0.5..0.5 each), size and heading (null: round image, no heading). */
export function packSprite(
  cx: number,
  cy: number,
  size: number,
  heading: V3 | null,
  out: Float32Array | number[],
  at: number,
): void {
  const q = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c + 0.5)) * CORNER_MAX);
  const h = heading ?? [0, 1, 0];
  out[at] =
    ((q(cx) * CORNER_BITS + q(cy)) * 2 + (heading ? 1 : 0)) * 2 +
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
  const r = Math.floor(x / 4);
  const v = r % CORNER_BITS;
  return [Math.floor(r / CORNER_BITS) / CORNER_MAX - 0.5, v / CORNER_MAX - 0.5];
}

/** The heading of a packed vertex, null for a sprite without one. */
export function unpackHeading(x: number, hx: number, hz: number): V3 | null {
  if (Math.floor(x / 2) % 2 < 1) return null;
  const y = Math.sqrt(Math.max(0, 1 - hx * hx - hz * hz));
  return [hx, x % 2 >= 1 ? -y : y, hz];
}

/**
 * GLSL for the shaders that place a sprite (trees/materials.ts `SPRITE_PROJECT`, the impostor bake): the corner,
 * heading and "has a heading" out of `treeSprite`, and the sprite's two axes in the plane facing the camera. The
 * image's x axis follows the projected heading; a heading along the view (the spray seen end on) takes `fallback`
 * (rad) instead, and the spray shortens as it points at the viewer. `flutter` (rad) turns it a little.
 */
export const TREE_SPRITE_AXES = /* glsl */ `
void treeSpriteCorner( vec4 s, out vec2 corner, out vec3 heading, out float aligned ) {
	float down = mod( s.x, 2.0 );
	float r1 = ( s.x - down ) * 0.5;
	aligned = mod( r1, 2.0 );
	float r2 = ( r1 - aligned ) * 0.5;
	float v = mod( r2, ${CORNER_BITS}.0 );
	corner = vec2( ( r2 - v ) / ${CORNER_BITS}.0, v ) / ${CORNER_MAX}.0 - 0.5;
	heading = vec3( s.y, ( down > 0.5 ? -1.0 : 1.0 ) * sqrt( max( 0.0, 1.0 - s.y * s.y - s.w * s.w ) ), s.w );
}
void treeSpriteAxes( vec3 right, vec3 up, vec3 heading, float aligned, float fallback, float flutter, out vec3 axisR, out vec3 axisU, out float stretch ) {
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
