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
