/**
 * Dithered fade between the detail levels of the streamed catalog assets (grass, weeds, crops, vines, people), the
 * trees' cross-fade (.claude/reference/trees/Lod.md "Transition") ported to the instance streamer
 * (world/instance-streamer.ts):
 *
 * - The streamer picks each instance's level at every rebuild (`nextFade` here, pure, tested). A change of level
 *   starts a fade of a fixed time (`LOD_FADE_TIME`), not tied to distance, so a car stopping at a threshold never
 *   leaves an instance half faded. A level reached back during a fade reverses it from where it is; a third level
 *   waits for the running fade. An instance coming into the stream (or out of range) takes its level at once; one
 *   crossing the far end of its last level fades in or out (an empty level).
 * - During a fade the instance is drawn twice, in the bucket of each level, with one per-instance attribute
 *   `instFade` = (start time, role): ONE number per instance per frame (the fade value from the world clock `wsTime`),
 *   nothing derived from a vertex or pixel. Both copies use the same 8 x 8 screen-space ordered dither: the outgoing
 *   level keeps the pixels whose dither value is >= the fade value, the incoming one those below it, so every pixel is
 *   covered by exactly one level and the instance is never see-through. Shadows are not dithered: one copy casts, the
 *   outgoing level until halfway, then the incoming one (`RALLY_LOD_FADE_SHADOW`).
 * - The fade lives in the shared shader chunks (engine/world-shading.ts, materials with `defines.RALLY_LOD_FADE`): a
 *   bucket draws with its material's cached fade copy (`lodFadeMaterial`) only while a fade runs, and drops the
 *   finished outgoing copies when the last fade ends (`InstanceStreamer.endFades`). Nothing is cloned per instance.
 */

/** Fade time (s). */
export const LOD_FADE_TIME = 0.3;

/**
 * Roles in `instFade.y`. 0 and 1 both mean solid: a mesh without the attribute reads (0, 0) or a generic value of
 * 1 that another program left on the same attribute slot.
 */
export const FADE_SOLID = 0;
export const FADE_OUT = 2;
export const FADE_IN = 3;

/** A start time the commit fills in (the fade starts when its first frame is drawn). */
export const START_AT_COMMIT = -1;

export interface FadeState {
  /** Level drawn (incoming during a fade), -1 = none. */
  lod: number;
  /** Outgoing level during a fade (-1 = none: fading in). */
  from: number;
  /** A fade is on (`from` -> `lod`). */
  fading: boolean;
  /** Fade start (s, world clock) or START_AT_COMMIT. */
  start: number;
  /** Rebuild that last saw the instance. */
  seen: number;
}

export function newFadeState(): FadeState {
  return { lod: -1, from: -1, fading: false, start: 0, seen: -2 };
}

/** Fade value 0..1 of a state at time `now` (1 = done). */
export function fadeValue(s: FadeState, now: number): number {
  if (!s.fading) return 1;
  if (s.start === START_AT_COMMIT) return 0;
  return Math.min(1, Math.max(0, (now - s.start) / LOD_FADE_TIME));
}

/**
 * Advance an instance's fade for rebuild `job` that wants level `lod` (-1 = none) at time `now`. A rebuild that did not
 * see the instance the time before (it was outside the streamed chunks) takes the level at once.
 */
export function nextFade(
  s: FadeState,
  lod: number,
  job: number,
  now: number,
): void {
  const fresh = s.seen !== job - 1;
  s.seen = job;
  if (fresh) {
    s.lod = lod;
    s.from = -1;
    s.fading = false;
    return;
  }
  if (s.fading && fadeValue(s, now) < 1) {
    if (lod === s.lod) return;
    if (lod === s.from) {
      // Back to the level it was leaving: reverse from the current value.
      const f = fadeValue(s, now);
      s.from = s.lod;
      s.lod = lod;
      s.start = now - (1 - f) * LOD_FADE_TIME;
    }
    // A third level waits for the running fade to end.
    return;
  }
  s.from = -1;
  s.fading = false;
  if (lod === s.lod) return;
  s.from = s.lod;
  s.lod = lod;
  s.fading = true;
  s.start = START_AT_COMMIT;
}

/** The copies to draw: [level, role] pairs (none, one, or the two of a fade; the streamer inlines it, no arrays). */
export function fadeCopies(s: FadeState): [number, number][] {
  if (!s.fading) return s.lod >= 0 ? [[s.lod, FADE_SOLID]] : [];
  const out: [number, number][] = [];
  if (s.lod >= 0) out.push([s.lod, FADE_IN]);
  if (s.from >= 0) out.push([s.from, FADE_OUT]);
  return out;
}

/** GLSL: the 8 x 8 ordered (Bayer) dither of trees/materials.ts, 0..1, anchored to screen pixels. */
const DITHER = /* glsl */ `
float lodFadeDither() {
	ivec2 p = ivec2( mod( gl_FragCoord.xy, 8.0 ) );
	int b = 0;
	int x = p.x;
	int y = p.y ^ p.x;
	for ( int i = 0; i < 3; i ++ ) {
		b = ( b << 2 ) | ( ( ( y >> i ) & 1 ) << 1 ) | ( ( x >> i ) & 1 );
	}
	return ( float( b ) + 0.5 ) / 64.0;
}`;

/** Vertex declarations (uv_pars_vertex). */
export const LOD_FADE_PARS_VERTEX = /* glsl */ `
#ifdef RALLY_LOD_FADE
attribute vec2 instFade;
varying vec2 vLodKeep;
#endif`;

/**
 * Vertex body (end of begin_vertex): the kept dither range [lo, hi) from the instance's role and fade value; a copy
 * with nothing left to draw collapses to a point.
 */
export const LOD_FADE_VERTEX = /* glsl */ `
#ifdef RALLY_LOD_FADE
	{
		float lfF = clamp( ( wsTime - instFade.x ) / ${LOD_FADE_TIME.toFixed(3)}, 0.0, 1.0 );
	#ifdef RALLY_LOD_FADE_SHADOW
		vLodKeep = vec2( 0.0, 2.0 );
		if ( instFade.y > 1.5 && ( instFade.y < 2.5 ? lfF >= 0.5 : lfF < 0.5 ) ) transformed = vec3( 0.0, -1e4, 0.0 );
	#else
		vLodKeep = instFade.y < 1.5 ? vec2( 0.0, 2.0 ) : instFade.y < 2.5 ? vec2( lfF, 2.0 ) : vec2( 0.0, lfF );
		if ( vLodKeep.y - vLodKeep.x < 1.0 / 128.0 ) transformed = vec3( 0.0, -1e4, 0.0 );
	#endif
	}
#endif`;

/** Fragment declarations (uv_pars_fragment). */
export const LOD_FADE_PARS_FRAGMENT = /* glsl */ `
#ifdef RALLY_LOD_FADE
varying vec2 vLodKeep;
${DITHER}
#endif`;

/** Fragment test (after alphatest_fragment). */
export const LOD_FADE_FRAGMENT = /* glsl */ `
#ifdef RALLY_LOD_FADE
	{
		float lfD = lodFadeDither();
		if ( lfD < vLodKeep.x || lfD >= vLodKeep.y ) discard;
	}
#endif`;
