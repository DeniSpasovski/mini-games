import { describe, expect, it } from '@rstest/core';
import * as B from '../../src/games/rally/cars/skoda-rally/blueprint';

describe('skoda rally blueprint', () => {
  it('matches the road car spec sheet (ref-01)', () => {
    // length 4108, wheelbase 2564, overhangs 809 / 735, height 1459, width 1780 (mm)
    expect(B.BUMPER_F_ROAD - B.BUMPER_R_ROAD).toBeCloseTo(4.108, 3);
    expect(B.AXLE_F - B.AXLE_R).toBeCloseTo(2.564, 3);
    expect(B.BUMPER_F_ROAD - B.AXLE_F).toBeCloseTo(0.809, 3);
    expect(B.AXLE_R - B.BUMPER_R_ROAD).toBeCloseTo(0.735, 3);
    // roof peak = road height moved to the game tyre and the base stance
    expect(B.ROOF_Y).toBeCloseTo(1.459 - 0.326 + 0.321 - 0.04, 3);
    let peak = 0;
    for (let z = -2.2; z <= 2; z += 0.01) peak = Math.max(peak, B.centre(z));
    expect(peak).toBeCloseTo(B.ROOF_Y, 2);
    // widest body line 1.78 m (plus the rally flares to 1.82)
    let hw = 0;
    for (let z = -2.2; z <= 1.98; z += 0.01) hw = Math.max(hw, B.halfWidth(z));
    expect(hw * 2).toBeGreaterThan(1.76);
    expect(hw * 2).toBeLessThan(1.79);
    expect(B.OVERALL_HW * 2).toBeCloseTo(1.82, 3);
  });

  it('rally extremes bracket the road body', () => {
    expect(B.Z_TIP).toBeGreaterThan(B.BUMPER_F_ROAD);
    expect(B.SPLITTER_Z).toBeGreaterThan(B.Z_TIP);
    expect(B.Z_TAIL).toBeLessThan(B.BUMPER_R_ROAD);
    expect(B.WING.z[1]).toBeLessThan(B.Z_TAIL);
    // wheels fit inside the flares: 235 mm tarmac tyre on the 1.56 m track
    expect(0.78 + 0.235 / 2).toBeLessThan(B.OVERALL_HW);
  });

  it('silhouette and edges are continuous and ordered', () => {
    let prev = B.centre(-2.2);
    for (let z = -2.19; z <= 1.98; z += 0.01) {
      const c = B.centre(z);
      expect(Number.isFinite(c)).toBe(true);
      expect(Math.abs(c - prev)).toBeLessThan(0.06);
      prev = c;
      const s = B.shoulder(z);
      const lo = B.lowerEdge(z);
      // the side's top edge stays under the centreline, except round the set-back tail panel
      if (z > -1.95) expect(s).toBeLessThanOrEqual(c + 1e-9);
      else expect(s).toBeLessThanOrEqual(1.01);
      expect(lo).toBeLessThan(s);
      expect(B.sideX(z, lo)).toBeLessThanOrEqual(B.halfWidth(z) + 1e-9);
      expect(B.sideX(z, s)).toBeLessThanOrEqual(B.halfWidth(z) + 1e-9);
    }
    // windows sit between the belt and the rail
    for (const w of [B.WINDOW_F, B.WINDOW_R, B.WINDOW_Q])
      for (const [z, y] of w) {
        expect(y).toBeGreaterThanOrEqual(B.belt(z) - 0.01);
        expect(y).toBeLessThanOrEqual(B.rail(z) + 0.01);
      }
  });

  it('arch openings clear the tyre and the flares reach the overall width', () => {
    for (const a of [B.ARCH_F, B.ARCH_R]) {
      // the opening peaks above the tyre with room for travel
      let top = 0;
      for (const [, y] of a.opening) top = Math.max(top, y);
      expect(top - B.WHEEL_R).toBeGreaterThan(0.38);
      expect(top - B.WHEEL_R).toBeLessThan(0.46);
      // flare: full offset at the opening edge, nothing a lip width away
      expect(B.archLip(a.z, B.archTop(a, a.z) + 0.005)).toBeCloseTo(
        B.FLARE_OUT,
        3,
      );
      expect(B.archLip(a.z, B.archTop(a, a.z) + a.lipW + 0.01)).toBe(0);
    }
    expect(B.halfWidth(B.AXLE_F) + B.FLARE_OUT).toBeCloseTo(B.OVERALL_HW, 2);
  });
});
