import { describe, expect, test } from '@rstest/core';
import {
  CUT_GRACE,
  CUT_WARN,
  type StageEvent,
  StageTimer,
} from '../../src/games/rally/game/stage';
import { testMap } from '../../src/games/rally/maps/test/map';
import { World } from '../../src/games/rally/world/world';

/**
 * Stage cut detection: corner cuts within CUT_WARN are fine; past it the car
 * must be heading back, or after CUT_GRACE s it's put back where it left the road.
 */
const world = new World(testMap);
const DT = 1 / 240;

function running(): { timer: StageTimer; events: StageEvent[] } {
  const timer = new StageTimer(world, 'test.cut');
  const events: StageEvent[] = [];
  timer.on((e) => events.push(e));
  timer.countdown = 0;
  timer.update(DT, 0, 0, 0, 1, 0); // countdown -> running
  return { timer, events };
}

/** Feed the timer a car `off` metres beyond the left road edge at `along`, moving along the road. */
function at(timer: StageTimer, along: number, off: number, seconds: number) {
  const s = world.road.at(along);
  const hw = world.road.samples[Math.round(along)].halfWidth;
  const lat = off > 0 ? hw + off : 0;
  for (let t = 0; t < seconds; t += DT)
    timer.update(DT, s.x + s.tz * lat, s.z - s.tx * lat, s.tx, s.tz, 15);
}

/** Drive along the road from `from` to `to` at `speed` m/s, `off(along)` metres beyond the edge. */
function drive(
  timer: StageTimer,
  from: number,
  to: number,
  off: (a: number) => number,
  speed = 20,
) {
  for (let a = from; a < to; a += speed * DT) at(timer, a, off(a), DT);
}

const start = world.stage.start;

describe('stage cut detection', () => {
  test('a wide corner cut inside CUT_WARN is allowed', () => {
    const { timer, events } = running();
    drive(timer, start - 9, start + 100, () => 0);
    // 15 m off the edge for 150 m, easing in and out.
    drive(
      timer,
      start + 100,
      start + 250,
      (a) => Math.sin(((a - start - 100) / 150) * Math.PI) * 15,
    );
    expect(events.some((e) => e.type === 'cut')).toBe(false);
    expect(timer.progress).toBeGreaterThan(start + 240);
  });

  test('parked past CUT_WARN: reset to the exit point after the grace time', () => {
    const { timer, events } = running();
    drive(timer, start - 9, start + 100, () => 0);
    // Straight out sideways at 10 m/s, then stop 5 m past the warning line.
    let t = 0;
    for (let off = 0; off < CUT_WARN + 5; off += 10 * DT, t += DT)
      at(timer, start + 100, off, DT);
    expect(timer.cutWarning).toBe(true);
    let cut: StageEvent | undefined;
    for (let i = 0; i < 240 * 5 && !cut; i++, t += DT) {
      at(timer, start + 100, CUT_WARN + 5, DT);
      cut = events.find((e) => e.type === 'cut');
    }
    expect(cut).toBeDefined();
    // Warning from 20 m (at 2 s) + 3 s grace.
    expect(t).toBeGreaterThan(2 + CUT_GRACE - 0.2);
    expect(t).toBeLessThan(2 + CUT_GRACE + 0.3);
    expect(Math.abs(cut!.along! - (start + 100))).toBeLessThan(1);
    expect(timer.cutWarning).toBe(false);
    expect(timer.progress).toBeLessThanOrEqual(cut!.along!);
  });

  test('heading back pauses the grace timer', () => {
    const { timer, events } = running();
    drive(timer, start - 9, start + 100, () => 0);
    for (let off = 0; off < CUT_WARN + 8; off += 10 * DT)
      at(timer, start + 100, off, DT);
    // Slowly back (2 m/s) - takes 6 s from 28 m to 16 m, longer than the grace.
    for (let off = CUT_WARN + 8; off > 16; off -= 2 * DT)
      at(timer, start + 100, off, DT);
    expect(events.some((e) => e.type === 'cut')).toBe(false);
    expect(timer.cutWarning).toBe(false);
  });

  test('far off the road resets at once', () => {
    const { timer, events } = running();
    drive(timer, start - 9, start + 100, () => 0);
    for (
      let off = 0;
      off < 60 && !events.some((e) => e.type === 'cut');
      off += 40 * DT
    )
      at(timer, start + 100, off, DT);
    expect(events.some((e) => e.type === 'cut')).toBe(true);
  });
});
