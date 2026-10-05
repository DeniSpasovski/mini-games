import { describe, expect, it } from '@rstest/core';
import { buildZastavaBody } from '../../src/games/rally/cars/zastava-101/body';
import * as B from '../../src/games/rally/cars/zastava-101/blueprint';
import { zastava101 } from '../../src/games/rally/cars/zastava-101/zastava-101';

describe('zastava 101 body', () => {
  it('matches the blueprint dimensions', () => {
    // ref-08: length 3836, wheelbase 2448, overhangs 611 / 776, height 1392 (mm).
    expect(B.BUMPER_F - B.BUMPER_R).toBeCloseTo(3.836, 2);
    expect(B.AXLE_F - B.AXLE_R).toBeCloseTo(2.448, 2);
    expect(B.BUMPER_F - B.AXLE_F).toBeCloseTo(0.611, 2);
    expect(B.AXLE_R - B.BUMPER_R).toBeCloseTo(0.776, 2);
    expect(zastava101.physics.front.z).toBe(B.AXLE_F);
    expect(zastava101.physics.rear.z).toBe(B.AXLE_R);
  });

  it('builds a shell that fills the blueprint box', () => {
    const { paint, parts } = buildZastavaBody();
    const pos = paint.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxX = 0;
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(
        true,
      );
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
      maxX = Math.max(maxX, Math.abs(pos.getX(i)));
    }
    expect(maxY).toBeGreaterThan(1.37);
    expect(maxY).toBeLessThan(1.4);
    expect(maxZ).toBeCloseTo(B.Z_TIP, 3);
    expect(minZ).toBeGreaterThan(B.BUMPER_R);
    expect(minZ).toBeLessThan(B.Z_TAIL + 0.001);
    expect(minY).toBeGreaterThan(0.2);
    // Overall width 1590 mm (arch lips).
    expect(maxX * 2).toBeGreaterThan(1.54);
    expect(maxX * 2).toBeLessThan(1.6);
    let tris = pos.count / 3;
    for (const g of Object.values(parts))
      tris += g.getAttribute('position').count / 3;
    // Body + cabin; the wheels add ~3.6k x 4.
    expect(tris).toBeLessThan(29000);
  });
});
