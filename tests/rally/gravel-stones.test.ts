import { describe, expect, test } from '@rstest/core';
import { Color, Matrix4, Vector3 } from 'three';
import { GravelStones } from '../../src/games/rally/game/gravel-stones';

/** Gravel spray: thrown stones land on the ground, lie there, shrink away and free their slot. */
describe('gravel stones', () => {
  // A gentle slope: the ground the stones bounce on.
  const ground = (x: number, z: number) => 0.05 * x + 0.02 * z;
  const grey = new Color(0.5, 0.48, 0.45);
  const at = (s: GravelStones, i: number) => {
    const m = new Matrix4();
    s.points.getMatrixAt(i, m);
    return new Vector3().setFromMatrixPosition(m);
  };
  const scaleOf = (s: GravelStones, i: number) => {
    const m = new Matrix4();
    s.points.getMatrixAt(i, m);
    return m.getMaxScaleOnAxis();
  };
  const run = (s: GravelStones, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) s.update(1 / 60);
  };

  test('a thrown stone lands, comes to rest on the ground and stays out of it', () => {
    const s = new GravelStones(4, ground);
    s.emit(new Vector3(0, 0.2, 0), 3, 4, 1, 0.1, 0, 1, grey);
    expect(s.aliveCount).toBe(0);
    run(s, 0.3);
    expect(s.aliveCount).toBe(1);
    expect(at(s, 0).y).toBeGreaterThan(ground(at(s, 0).x, at(s, 0).z) + 0.3);
    run(s, 1.4);
    const p = at(s, 0);
    // Resting just above the ground (a fraction of its size), not in or under it.
    const gap = p.y - ground(p.x, p.z);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.05);
    // Flew forward, then the bounces stopped it.
    expect(p.x).toBeGreaterThan(0.5);
    const before = p.clone();
    run(s, 0.2);
    expect(at(s, 0).distanceTo(before)).toBeLessThan(0.02);
  });

  test('a stone shrinks away at the end of its life and frees its slot', () => {
    const s = new GravelStones(4, ground);
    s.emit(new Vector3(0, 0.1, 0), 0, 0, 0, 0.1, 0, 0.4, grey);
    run(s, 0.2);
    expect(scaleOf(s, 0)).toBeCloseTo(0.05, 3);
    // Life is 2.5 x the sprite's: gone after 1 s.
    run(s, 0.85);
    expect(scaleOf(s, 0)).toBeLessThan(0.05);
    run(s, 0.1);
    expect(s.aliveCount).toBe(0);
    expect(scaleOf(s, 0)).toBe(0);
  });

  test('the pool recycles the oldest stone when it is full', () => {
    const s = new GravelStones(3, ground);
    for (let i = 0; i < 5; i++)
      s.emit(new Vector3(i, 1, 0), 0, 0, 0, 0.1, 0, 10, grey);
    s.update(1 / 60);
    expect(s.aliveCount).toBe(3);
    // Slots 0 and 1 hold the 4th and 5th stones (x = 3, 4), slot 2 the 3rd.
    expect(at(s, 0).x).toBeCloseTo(3, 3);
    expect(at(s, 1).x).toBeCloseTo(4, 3);
    expect(at(s, 2).x).toBeCloseTo(2, 3);
  });
});
