import type { Vector3 } from 'three';

/** Largest camera offset (metres) at full trauma. */
const MAX_OFFSET = 0.2;
/** Trauma lost per second. */
const DECAY = 1.4;

const wobble = (x: number): number =>
  Math.sin(x) * 0.6 + Math.sin(x * 2.17 + 1.3) * 0.4;

/**
 * Camera shake as one capped accumulator ("trauma", 0..1): every blast adds a little, the offset grows with trauma squared
 * and trauma drains over time, so forty blasts in a row shake the screen about as hard as five - never a pile of
 * independent shakes.
 */
export class Shake {
  trauma = 0;

  /** Add `amount`, but never push the total above `cap`. */
  add(amount: number, cap = 0.6): void {
    this.trauma = Math.max(this.trauma, Math.min(cap, this.trauma + amount));
  }

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
  }

  /** Camera offset at clock time `t`, written into `out` (zero when calm). */
  offset(out: Vector3, t: number): Vector3 {
    const a = this.trauma * this.trauma * MAX_OFFSET;
    return out.set(
      wobble(t * 37) * a,
      wobble(t * 41 + 5) * a * 0.6,
      wobble(t * 29 + 9) * a,
    );
  }
}
