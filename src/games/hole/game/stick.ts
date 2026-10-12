/**
 * Joystick maths, DOM-free so it can be tested. The floating joystick turns a
 * drag (px, screen space, y down) into a stick vector (x right, y up, magnitude 0..1).
 */
export interface StickTuning {
  /** Drag length (px) that gives full speed. */
  maxDragPx: number;
  /** Drag length (px) ignored around the origin. */
  deadZonePx: number;
}

export const DEFAULT_STICK: StickTuning = { maxDragPx: 70, deadZonePx: 6 };

export function dragToStick(
  dx: number,
  dy: number,
  t: StickTuning = DEFAULT_STICK,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= t.deadZonePx) return { x: 0, y: 0 };
  const m = Math.min(1, (len - t.deadZonePx) / (t.maxDragPx - t.deadZonePx));
  return { x: (dx / len) * m, y: (-dy / len) * m };
}

/** Screen-space stick to a world-space direction (camera yaw in radians; 0 = looking north, -Z). */
export function stickToWorld(
  sx: number,
  sy: number,
  yaw = 0,
): { x: number; z: number } {
  // screen up = forward = -Z at yaw 0
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: sx * c + sy * s, z: -sy * c + sx * s };
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

/** Gamepad left-stick radius ignored around the centre (worn sticks rest a little off it). */
export const PAD_DEAD_ZONE = 0.18;

/**
 * Gamepad -> stick vector (x right, y up, magnitude 0..1). The d-pad steers at full speed and wins over the stick;
 * the stick is radial with a dead zone, rescaled so speed starts at 0 just past it.
 */
export function padToStick(
  axes: readonly number[],
  dpad: { up: boolean; down: boolean; left: boolean; right: boolean },
): { x: number; y: number } {
  const dx = (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  const dy = (dpad.up ? 1 : 0) - (dpad.down ? 1 : 0);
  if (dx || dy) {
    const l = Math.hypot(dx, dy);
    return { x: dx / l, y: dy / l };
  }
  const ax = axes[0] ?? 0;
  const ay = axes[1] ?? 0;
  const len = Math.hypot(ax, ay);
  if (len <= PAD_DEAD_ZONE) return { x: 0, y: 0 };
  const m = Math.min(1, (len - PAD_DEAD_ZONE) / (1 - PAD_DEAD_ZONE));
  return { x: (ax / len) * m, y: (-ay / len) * m };
}
