import type { ScatterInstance } from './scatter';

/** Height (m) the tape ties to a post (the `tape_span` asset hangs from its own origin). */
const TAPE_HEIGHT = 0.92;

/**
 * A run of spectator tape: a post at every point, a `tape_span` tied from each post to the next. A run is only as good
 * as its ends, so the caller passes the posts that actually stand (a blocked one splits the run in two) and a
 * post with no neighbour is dropped - no loose ends, no lone pole.
 */
export function tapeRun(
  posts: readonly { x: number; z: number }[],
  height: (x: number, z: number) => number,
): ScatterInstance[] {
  if (posts.length < 2) return [];
  const out: ScatterInstance[] = [];
  const ys = posts.map((p) => height(p.x, p.z));
  posts.forEach((p, i) =>
    out.push({
      asset: 'tape_post',
      variant: 0,
      x: p.x,
      y: ys[i],
      z: p.z,
      rotY: 0,
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    }),
  );
  for (let i = 0; i + 1 < posts.length; i++) {
    const dx = posts[i + 1].x - posts[i].x;
    const dz = posts[i + 1].z - posts[i].z;
    const dy = ys[i + 1] - ys[i];
    const flat = Math.hypot(dx, dz);
    out.push({
      asset: 'tape_span',
      variant: 0,
      x: posts[i].x + dx / 2,
      y: (ys[i] + ys[i + 1]) / 2 + TAPE_HEIGHT,
      z: posts[i].z + dz / 2,
      // Local +X runs along the gap (rotY turns +X to (cos, 0, -sin)), then pitches to the slope.
      rotY: Math.atan2(-dz, dx),
      scale: 1,
      tiltX: 0,
      tiltZ: Math.atan2(dy, flat),
      sx: Math.hypot(flat, dy),
    });
  }
  return out;
}

/** Cut a line of post slots into runs of posts that stand: `null` = a slot that is blocked. */
export function splitRuns<T>(slots: readonly (T | null)[]): T[][] {
  const runs: T[][] = [];
  let cur: T[] = [];
  for (const s of slots) {
    if (s) cur.push(s);
    else {
      runs.push(cur);
      cur = [];
    }
  }
  runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
