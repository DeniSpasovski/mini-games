import { describe, expect, test } from '@rstest/core';
import { treeUniforms } from '../../src/games/rally/trees/materials';
import { TreePool } from '../../src/games/rally/trees/multi-draw';

/** A batch's instance arrays with tree `i` = (mat i*100+k, inst / fade / lod i*10+k). */
function source(capacity: number) {
  const s = {
    mat: new Float32Array(capacity * 16),
    inst: new Float32Array(capacity * 4),
    fade: new Float32Array(capacity * 4),
    lod: new Float32Array(capacity * 4),
    capacity,
    base: -1,
  };
  for (let i = 0; i < capacity; i++) {
    for (let k = 0; k < 16; k++) s.mat[i * 16 + k] = i * 100 + k;
    for (let k = 0; k < 4; k++) {
      s.inst[i * 4 + k] = i * 10 + k;
      s.fade[i * 4 + k] = -(i * 10 + k);
      s.lod[i * 4 + k] = i * 10 + k + 0.5;
    }
  }
  return s;
}

describe('tree multi-draw pool', () => {
  test('regions never straddle a texture row unless they fill whole rows', () => {
    const pool = new TreePool();
    const a = pool.alloc(64);
    const b = pool.alloc(256);
    const c = pool.alloc(1024);
    expect(a).toBe(0);
    expect(b % 256).toBe(0);
    expect(c % 256).toBe(0);
    expect(b).toBeGreaterThanOrEqual(64);
    expect(c).toBeGreaterThanOrEqual(b + 256);
    // A freed region is handed out again for the same size.
    pool.release(b, 256);
    expect(pool.alloc(256)).toBe(b);
  });

  test('a marked range lands interleaved at the batch base: matrix, inst, fade, lod (8 texels a tree)', () => {
    const pool = new TreePool();
    pool.alloc(64);
    const s = source(64);
    s.base = pool.alloc(64);
    pool.mark(s, 3, 5);
    pool.flush(null);
    const data = treeUniforms.tmData.value!.image.data as Float32Array;
    for (const i of [3, 4]) {
      const o = (s.base + i) * 32;
      expect(Array.from(data.subarray(o, o + 16))).toEqual(
        Array.from(s.mat.subarray(i * 16, i * 16 + 16)),
      );
      expect(Array.from(data.subarray(o + 16, o + 20))).toEqual(
        Array.from(s.inst.subarray(i * 4, i * 4 + 4)),
      );
      expect(Array.from(data.subarray(o + 20, o + 24))).toEqual(
        Array.from(s.fade.subarray(i * 4, i * 4 + 4)),
      );
      expect(Array.from(data.subarray(o + 24, o + 28))).toEqual(
        Array.from(s.lod.subarray(i * 4, i * 4 + 4)),
      );
    }
    // Unmarked trees are not copied.
    expect(data[(s.base + 2) * 32]).toBe(0);
  });

  test('growing the texture keeps what was there', () => {
    const pool = new TreePool();
    const s = source(64);
    s.base = pool.alloc(64);
    pool.mark(s, 0, 64);
    pool.flush(null);
    // Past the first 64 rows (64 x 256 trees).
    pool.alloc(64 * 256);
    const data = treeUniforms.tmData.value!.image.data as Float32Array;
    expect(data.length).toBeGreaterThan(64 * 256 * 32);
    expect(data[(s.base + 63) * 32 + 16]).toBe(630);
  });
});
