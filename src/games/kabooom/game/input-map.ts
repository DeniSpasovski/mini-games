/**
 * Input maths, DOM-free so it can be tested: keyboard keys, the floating touch stick and gamepad axes all become a
 * grid direction (`dx` right, `dy` DOWN the screen, as the sim's grid y grows towards the camera).
 */
export interface StickTuning {
  /** Drag length (px) that gives full speed. */
  maxDragPx: number;
  /** Drag length (px) ignored around the origin. */
  deadZonePx: number;
}

export const DEFAULT_STICK: StickTuning = { maxDragPx: 64, deadZonePx: 8 };

/** Keys held -> direction (arrows / WASD, opposite keys cancel), normalised so diagonals are not faster. */
export function keysToDir(keys: ReadonlySet<string>): {
  dx: number;
  dy: number;
} {
  let dx = 0;
  let dy = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
  const l = Math.hypot(dx, dy);
  return l > 1 ? { dx: dx / l, dy: dy / l } : { dx, dy };
}

/** A finger drag (px, screen space, y down) -> direction with magnitude 0..1 and a dead zone. */
export function dragToDir(
  dx: number,
  dy: number,
  t: StickTuning = DEFAULT_STICK,
): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  if (len <= t.deadZonePx) return { dx: 0, dy: 0 };
  const m = Math.min(1, (len - t.deadZonePx) / (t.maxDragPx - t.deadZonePx));
  return { dx: (dx / len) * m, dy: (dy / len) * m };
}

/** If the finger is dragged further than `maxDragPx`, the origin follows so reversing is instant. */
export function followOrigin(
  ox: number,
  oy: number,
  px: number,
  py: number,
  maxDragPx: number,
): { x: number; y: number } {
  const dx = px - ox;
  const dy = py - oy;
  const len = Math.hypot(dx, dy);
  if (len <= maxDragPx) return { x: ox, y: oy };
  const k = (len - maxDragPx) / len;
  return { x: ox + dx * k, y: oy + dy * k };
}

/** Gamepad left stick / d-pad -> direction (stick dead zone 0.3; the d-pad wins when pressed). */
export function padToDir(
  axes: readonly number[],
  dpad: { up: boolean; down: boolean; left: boolean; right: boolean },
): { dx: number; dy: number } {
  if (dpad.up || dpad.down || dpad.left || dpad.right)
    return {
      dx: (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0),
      dy: (dpad.down ? 1 : 0) - (dpad.up ? 1 : 0),
    };
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;
  const l = Math.hypot(x, y);
  if (l < 0.3) return { dx: 0, dy: 0 };
  const m = Math.min(1, (l - 0.3) / 0.6);
  return { dx: (x / l) * m, dy: (y / l) * m };
}
