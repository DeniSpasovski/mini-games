import { describe, expect, it } from '@rstest/core';
import type { RoadSample } from '../../src/games/rally/world/road';
import {
  mudAt,
  roadWear,
  type WearInput,
} from '../../src/games/rally/world/road-wear';

/** 1 m samples: a straight, a left hairpin (radius 14 m, 180 deg) from 200 m, a straight. */
function hairpinRoad(): RoadSample[] {
  const out: RoadSample[] = [];
  const arc = Math.PI * 14;
  for (let i = 0; i <= 500; i++) {
    const k = i >= 200 && i < 200 + arc ? 1 / 14 : 0;
    out.push({
      x: 0,
      y: 0,
      z: i,
      dist: i,
      tx: 0,
      tz: 1,
      halfWidth: 3,
      curvature: k,
    });
  }
  return out;
}

function input(over: Partial<WearInput> = {}): WearInput {
  const samples = hairpinRoad();
  const n = samples.length;
  return {
    samples,
    line: new Float32Array(n),
    reverse: false,
    vergeL: new Float32Array(n).fill(1),
    vergeR: new Float32Array(n).fill(1),
    mouths: [],
    seed: 7,
    ...over,
  };
}

describe('rally-worn tarmac (road-wear)', () => {
  it('drags dirt onto the inside of a tight bend, most just after the apex', () => {
    const w = roadWear(input());
    // nothing on the straight before
    expect(w.dirtL[60]).toBe(0);
    expect(w.dirtR[60]).toBe(0);
    // the inside (left) is dirty through the bend and after it, more than before it
    const apexOut = 200 + Math.round(Math.PI * 14);
    expect(w.dirtL[apexOut + 5]).toBeGreaterThan(0.3);
    expect(w.dirtL[apexOut + 5]).toBeGreaterThan(w.dirtL[190]);
    // fading along the road
    expect(w.dirtL[apexOut + 60]).toBeLessThan(w.dirtL[apexOut + 5] * 0.1);
    // the outside gets only a thin spill
    expect(w.dirtR[apexOut + 5]).toBeLessThan(w.dirtL[apexOut + 5] * 0.5);
  });

  it('follows the travel direction and the verge', () => {
    const fwd = roadWear(input());
    const rev = roadWear(input({ reverse: true }));
    expect(rev.dirtL[185]).toBeGreaterThan(fwd.dirtL[185]);
    const kerb = roadWear(input({ vergeL: new Float32Array(501) }));
    expect(Math.max(...kerb.dirtL)).toBe(0);
  });

  it('lays rubber in the braking zone before the bend', () => {
    const w = roadWear(input());
    expect(w.rub[190]).toBeGreaterThan(0.3);
    expect(w.rub[120]).toBeLessThan(0.05);
  });

  it('brings mud out of a track mouth, most on its side, fading both ways', () => {
    const w = roadWear(
      input({
        mouths: [
          { along: 100, side: -1, width: 3, vehicles: true, strength: 1 },
        ],
      }),
    );
    expect(mudAt(w, 100, -2.5, 3)).toBeGreaterThan(mudAt(w, 100, 2.5, 3));
    expect(mudAt(w, 112, -2, 3)).toBeLessThan(mudAt(w, 100, -2, 3));
    expect(mudAt(w, 88, -2, 3)).toBeGreaterThan(0);
    expect(mudAt(w, 140, -2, 3)).toBe(0);
  });

  it('is deterministic', () => {
    expect(roadWear(input()).dirtL).toEqual(roadWear(input()).dirtL);
  });
});
