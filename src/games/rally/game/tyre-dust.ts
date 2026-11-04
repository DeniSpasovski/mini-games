import { Color } from 'three';
import type { SurfaceId } from '../physics/surfaces';
import type { Vehicle } from '../physics/vehicle';

/**
 * Dust building up on the tyres over a run: not per impact, a few steps worked out from how far the car has driven on
 * loose ground (gravel, more off the road: grass, dirt, mud, snow; more while sliding). A long stretch of tarmac wipes
 * some of it off again. The colour is the mix of the surfaces' dust colours, weighted by how much each one added.
 * `CarModel.setTyreDust` shows the step (only when it changes: no per-frame work on the GPU side).
 */

/** Dust shown at each step (0 = clean). */
export const TYRE_DUST_LEVELS = [0, 0.4, 0.65, 0.9];
/** Loose-ground metres (averaged over the wheels) to reach each step. */
const STEP_AT = [0, 250, 1500, 4000];
/** Off the road: dust counts this many times over. */
const OFF_ROAD: Partial<Record<SurfaceId, number>> = {
  grass: 3,
  dirt: 3,
  mud: 4,
  snow: 2,
};
/** Tarmac wipes dust off at this share of the distance. */
const WIPE = 0.08;

export class TyreDust {
  /** Loose-ground metres so far (wiped down on tarmac). */
  amount = 0;
  step = 0;
  /** Linear colour of the dust on the tyres. */
  readonly color = new Color(0xb7a58a);
  private weight = 0;
  private readonly c = new Color();

  reset(): void {
    this.amount = 0;
    this.weight = 0;
    this.step = 0;
    this.color.setHex(0xb7a58a);
  }

  /** Once per simulation frame; true when the step changed. */
  update(dt: number, v: Vehicle): boolean {
    const n = v.wheels.length;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const d = (Math.abs(v.speed) * dt) / n;
      if (d <= 0) continue;
      const s = w.surface;
      const slide = Math.min(1, Math.max(0, (w.slideSpeed - 1) / 6));
      const gain = d * s.loose * (OFF_ROAD[s.id] ?? 1) * (1 + slide);
      if (gain > 0) {
        this.amount += gain;
        // Colour: running mix, recent ground counting as much as the old (the newest dust sits on top).
        this.weight = Math.min(this.weight + gain, 400);
        this.color.lerp(this.c.setHex(s.dustColor), gain / this.weight);
      } else this.amount = Math.max(0, this.amount - d * WIPE);
    }
    let step = 0;
    for (let i = 0; i < STEP_AT.length; i++)
      if (this.amount >= STEP_AT[i]) step = i;
    if (step === this.step) return false;
    this.step = step;
    return true;
  }

  get level(): number {
    return TYRE_DUST_LEVELS[this.step];
  }
}
