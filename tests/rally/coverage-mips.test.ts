import { expect, test } from '@rstest/core';
import {
  coverageChains,
  coverageMips,
} from '../../src/games/rally/trees/materials';

/** Coverage-preserving mip chains (trees/materials.ts): the impostor atlas builds its main chain once for both companions. */
const rnd = (n: number, seed: number) => {
  const a = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    a[i] = s >>> 24;
  }
  return a;
};

test('several companions in one pass match one pass each', () => {
  const [w, h] = [48, 40];
  const d = rnd(w * h * 4, 1);
  const c1 = rnd(w * h * 4, 2);
  const c2 = rnd(w * h * 4, 3);
  const both = coverageChains(d, w, h, true, [c1, c2]);
  for (const [i, c] of [c1, c2].entries()) {
    const one = coverageMips(d, w, h, true, c);
    expect(both.main.map((l) => Array.from(l.data))).toEqual(
      one.main.map((l) => Array.from(l.data)),
    );
    expect(both.companions[i].map((l) => Array.from(l.data))).toEqual(
      one.companion.map((l) => Array.from(l.data)),
    );
  }
});

test('the chain runs down to 1 x 1 and keeps the share of texels that pass the alpha test', () => {
  const d = rnd(64 * 64 * 4, 5);
  const { main } = coverageMips(d, 64, 64, false);
  expect(main.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
  const share = (l: { data: Uint8Array }) => {
    let n = 0;
    for (let i = 3; i < l.data.length; i += 4) if (l.data[i] >= 128) n++;
    return n / (l.data.length / 4);
  };
  expect(Math.abs(share(main[2]) - share(main[0]))).toBeLessThan(0.1);
});
