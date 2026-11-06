import {
  afterEach,
  beforeEach,
  describe,
  expect,
  rs,
  test,
} from '@rstest/core';
import { BufferAttribute, Vector3 } from 'three';
import { TyreMarks } from '../../src/games/rally/game/tyre-marks';
import { skodaRally } from '../../src/games/rally/cars/skoda-rally/skoda-rally';
import type { Vehicle } from '../../src/games/rally/physics/vehicle';

/** A wheel rolling along +x at 20 m/s, 1 m per step, on asphalt. */
function fake(wheels: number) {
  const ws = Array.from({ length: wheels }, () => ({
    isFront: false,
    radius: 0.32,
    contact: true,
    slideSpeed: 0,
    slipAngle: 0.4,
    load: 3000,
    nominalLoad: 3000,
    surface: { loose: 0, dustColor: 0x808080 },
    contactPoint: new Vector3(),
    contactNormal: new Vector3(0, 1, 0),
  }));
  const vehicle = {
    wheels: ws,
    speed: 20,
    tyre: null,
    def: skodaRally.physics,
  } as unknown as Vehicle;
  return { ws, vehicle };
}

/** End alpha of every quad written so far on wheel 0, in order (unwritten quads are all zero). */
function alphas(m: TyreMarks, steps: number): number[] {
  const g = m.mesh.geometry;
  const pos = (g.getAttribute('position') as BufferAttribute)
    .array as Float32Array;
  const col = (g.getAttribute('color') as BufferAttribute)
    .array as Float32Array;
  const out: number[] = [];
  for (let q = 0; q < steps; q++)
    if (pos[q * 12 + 6] !== 0) out.push(col[q * 16 + 11]);
  return out;
}

describe('tyre marks', () => {
  beforeEach(() => {
    const ctx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => {},
    };
    rs.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as never,
    );
  });
  afterEach(() => rs.restoreAllMocks());

  function run(slide: (step: number) => number, load = 3000, steps = 40) {
    const { ws, vehicle } = fake(1);
    const marks = new TyreMarks(vehicle);
    for (let s = 0; s < steps; s++) {
      ws[0].contactPoint.set(s, 0, 0);
      ws[0].slideSpeed = slide(s);
      ws[0].load = load;
      marks.update();
    }
    return alphas(marks, steps);
  }

  test('a slide starts faint, darkens along its first metres and fades out at the end', () => {
    const a = run((s) => (s >= 2 && s < 24 ? 12 : 0));
    const peak = Math.max(...a);
    expect(peak).toBeGreaterThan(0.2);
    expect(a[0]).toBeLessThan(peak * 0.5);
    expect(a[a.length - 1]).toBeLessThan(peak * 0.5);
  });

  test('a harder slide leaves a darker mark than a gentle one', () => {
    const hard = Math.max(...run(() => 12));
    const gentle = Math.max(...run(() => 3));
    expect(hard).toBeGreaterThan(gentle * 1.5);
  });

  test('the tyre carrying more load leaves a darker mark', () => {
    const loaded = Math.max(...run(() => 12, 6000));
    const light = Math.max(...run(() => 12, 800));
    expect(loaded).toBeGreaterThan(light * 1.3);
  });

  test('the mark varies along its length', () => {
    const a = run(() => 12).slice(10);
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.03);
  });
});
