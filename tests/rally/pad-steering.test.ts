import { describe, expect, test } from '@rstest/core';
import { keyboardSteerLimit } from '../../src/games/rally/game/input';
import {
  PadSteering,
  stickCurve,
  type PadDriveState,
} from '../../src/games/rally/game/pad-steering';
import { sanitizeSettings } from '../../src/games/rally/game/settings';

const DT = 1 / 60;
const at = (kmh: number, slipAngle = 0): PadDriveState => ({
  speed: kmh / 3.6,
  slipAngle,
  maxSteer: 0.6,
  frontTravel: 0,
  frontPeakAngle: (8 * Math.PI) / 180,
  speedLock: keyboardSteerLimit(kmh / 3.6),
});

/** Hold the stick at `x` for `s` seconds, starting from `steer`. */
function hold(
  p: PadSteering,
  x: number,
  s: number,
  st: PadDriveState,
  steer = 0,
) {
  for (let t = 0; t < s; t += DT) steer = p.update(DT, x, steer, st);
  return steer;
}

describe('pad steering', () => {
  test('direct is the old curve, no rack, no limit', () => {
    const p = new PadSteering();
    p.set('direct');
    expect(p.update(DT, 1, 0, at(120))).toBe(1);
    expect(p.update(DT, 0.05, 0, at(120))).toBe(0);
    expect(stickCurve(-1)).toBe(-1);
  });

  test('smooth winds on over turnIn to the speed lock, and returns faster', () => {
    const p = new PadSteering();
    p.set('smooth');
    const st = at(100);
    const lock = keyboardSteerLimit(100 / 3.6);
    expect(hold(p, 1, 0.1, st)).toBeLessThan(lock);
    const full = hold(p, 1, 0.5, st);
    expect(full).toBeCloseTo(lock, 5);
    // Released: back to centre sooner than it took to wind on.
    expect(hold(p, 0, 0.13, st, full)).toBe(0);
  });

  test('build-up starts below the keyboard lock and winds more on while held', () => {
    const p = new PadSteering();
    p.set('buildup');
    const st = at(100);
    const lock = keyboardSteerLimit(100 / 3.6);
    const early = hold(p, 1, 0.35, st);
    expect(early).toBeLessThan(lock);
    const late = hold(p, 1, 1.5, st, early);
    expect(late).toBeGreaterThan(lock);
    // Letting go resets the build: the next push starts low again.
    const back = hold(p, 0, 0.5, st, late);
    expect(hold(p, 1, 0.35, st, back)).toBeCloseTo(early, 2);
  });

  test('counter-steer may pass the speed lock', () => {
    const p = new PadSteering();
    p.set('smooth');
    const lock = keyboardSteerLimit(100 / 3.6);
    // Sliding left (slip > 0) -> steering left (stick < 0) is a counter-steer.
    expect(-hold(p, -1, 0.5, at(100, 0.3))).toBeGreaterThan(lock * 1.5);
  });

  test('assist aims the fronts along their travel plus the peak slip', () => {
    const p = new PadSteering();
    p.set('assist');
    const st = { ...at(100), frontTravel: -0.05 }; // front axle heading right of the nose
    const steer = hold(p, 1, 1, st);
    expect(steer).toBeCloseTo((0.05 + st.frontPeakAngle) / st.maxSteer, 2);
    // Stick centred: the wheels follow part of the travel (caster), a counter-steer in a slide.
    expect(hold(p, 0, 1, { ...at(100), frontTravel: 0.1 }, steer)).toBeLessThan(
      -0.05,
    );
  });

  test('setting defaults to build-up and rejects unknown modes', () => {
    expect(sanitizeSettings({}).padSteering).toBe('buildup');
    expect(sanitizeSettings({ padSteering: 'assist' }).padSteering).toBe(
      'assist',
    );
    expect(sanitizeSettings({ padSteering: 'x' }).padSteering).toBe('buildup');
  });
});
