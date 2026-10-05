import { expect, test } from '@rstest/core';
import { Mesher, roundDetail } from '../../src/games/hole/items/kit';
import { findBuried, findZFights } from '../../src/games/hole/debug/clip-check';

// The round primitive (`Mesher.ball`): sizes, triangle counts, eggs / domes, determinism, clip checker coverage.
Mesher.trace = true;

const tris = (build: (m: Mesher) => void) => {
  const m = new Mesher();
  build(m);
  return m.build();
};
const count = (g: ReturnType<Mesher['build']>) =>
  g.getAttribute('position').count / 3;

test('a ball has the radii it was given and 2 x seg x (rings - 1) triangles', () => {
  const g = tris((m) =>
    m.ball(1, 2, -3, 0.5, 1, 0.75, 0x00ff00, { seg: 8, rings: 5 }),
  );
  expect(count(g)).toBe(2 * 8 * 4);
  const b = g.boundingBox!;
  expect(b.max.y).toBeCloseTo(3, 5);
  expect(b.min.y).toBeCloseTo(1, 5);
  expect(b.max.x).toBeLessThanOrEqual(1.5 + 1e-6);
  expect(b.max.x).toBeGreaterThan(1.4);
  expect(b.max.z).toBeCloseTo(-3 + 0.75, 1);
});

test('a dome sits on its base and has no triangles below it', () => {
  const g = tris((m) =>
    m.ball(0, 0, 0, 2, 1, 2, 0x00ff00, { half: true, seg: 10, rings: 6 }),
  );
  expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
  expect(g.boundingBox!.max.y).toBeCloseTo(1, 6);
  expect(count(g)).toBeLessThan(2 * 10 * 5);
});

test('an egg (taper) is narrower at the top than at the bottom', () => {
  const widthAt = (taper: number, up: boolean) => {
    const g = tris((m) =>
      m.ball(0, 0, 0, 1, 1, 1, 0xffffff, { seg: 12, rings: 8, taper }),
    );
    const p = g.getAttribute('position');
    let w = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (up ? y > 0.2 && y < 0.8 : y < -0.2 && y > -0.8)
        w = Math.max(w, Math.abs(p.getX(i)));
    }
    return w;
  };
  expect(widthAt(0.4, true)).toBeLessThan(widthAt(0.4, false));
  expect(widthAt(0, true)).toBeCloseTo(widthAt(0, false), 1);
});

test('jitter is deterministic per seed and different between seeds', () => {
  const make = (seed: number) =>
    Array.from(
      tris((m) =>
        m.ball(0, 0, 0, 1, 1, 1, 0x888888, { jitter: 0.2, seed }),
      ).getAttribute('position').array,
    );
  expect(make(1)).toEqual(make(1));
  expect(make(1)).not.toEqual(make(2));
});

test('detail grows with the radius and stays cheap for small parts', () => {
  expect(roundDetail(0.05).seg * roundDetail(0.05).rings).toBeLessThan(
    roundDetail(10).seg * roundDetail(10).rings,
  );
  const g = tris((m) => m.ball(0, 0.05, 0, 0.05, 0.05, 0.05, 0xff0000));
  expect(count(g)).toBeLessThanOrEqual(24);
});

test('faces point outwards, and the clip checker sees balls', () => {
  const g = tris((m) =>
    m.ball(0, 1, 0, 1, 1, 1, 0xffffff, { seg: 8, rings: 5, jitter: 0.1 }),
  );
  const p = g.getAttribute('position');
  for (let t = 0; t < p.count / 3; t++) {
    const a = [p.getX(t * 3), p.getY(t * 3) - 1, p.getZ(t * 3)];
    const b = [p.getX(t * 3 + 1), p.getY(t * 3 + 1) - 1, p.getZ(t * 3 + 1)];
    const c = [p.getX(t * 3 + 2), p.getY(t * 3 + 2) - 1, p.getZ(t * 3 + 2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const mid = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ];
    expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);
  }
  // a ball hidden inside a bigger box is reported as buried; a lone ball is not
  expect(findBuried(g)).toEqual([]);
  const hidden = tris((m) => {
    m.box(0, 0, 0, 4, 4, 4, 0x808080);
    m.ball(0, 2, 0, 0.5, 0.5, 0.5, 0x00ff00);
  });
  expect(findBuried(hidden).length).toBe(1);
  expect(findZFights(g)).toEqual([]);
});
