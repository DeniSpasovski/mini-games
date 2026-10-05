import { describe, expect, it } from '@rstest/core';
import * as B from '../../src/games/rally/cars/skoda-rally/blueprint';
import { buildSkodaRallyBody } from '../../src/games/rally/cars/skoda-rally/body';
import { skodaRally } from '../../src/games/rally/cars/skoda-rally/skoda-rally';

describe('skoda rally body', () => {
  it('front axle and wheel radius sit on the blueprint (the fallback body is the RS Rally2 shape; physics is the R5 wheelbase)', () => {
    expect(skodaRally.physics.front.z).toBe(B.AXLE_F);
    expect(skodaRally.physics.wheelRadius).toBe(B.WHEEL_R);
  });

  it('builds a shell that fills the blueprint box', () => {
    const { paint, parts } = buildSkodaRallyBody();
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
    // Roof peak, nose (bumper face) and tail (rear bumper) from the blueprint.
    expect(maxY).toBeCloseTo(B.ROOF_Y, 2);
    expect(maxZ).toBeCloseTo(B.Z_TIP, 2);
    expect(minZ).toBeCloseTo(B.Z_TAIL, 2);
    expect(minY).toBeGreaterThan(0.12);
    // Overall width over the flares: 1.82 m.
    expect(maxX * 2).toBeGreaterThan(1.79);
    expect(maxX * 2).toBeLessThan(1.84);
    let tris = pos.count / 3;
    for (const g of Object.values(parts))
      if (g) tris += g.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(40000);
    // Wing trailing edge and splitter lip are the car's extremes.
    const carbon = parts.carbon.getAttribute('position');
    let cz0 = Infinity;
    let cz1 = -Infinity;
    for (let i = 0; i < carbon.count; i++) {
      cz0 = Math.min(cz0, carbon.getZ(i));
      cz1 = Math.max(cz1, carbon.getZ(i));
    }
    expect(cz0).toBeCloseTo(B.WING.z[1], 1);
    expect(cz1).toBeCloseTo(B.SPLITTER_Z, 2);
  });
});
