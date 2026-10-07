import { describe, expect, test } from '@rstest/core';
import { Vector3 } from 'three';
import { ALL_CARS } from '../../src/games/rally/cars';
import { tyreColor } from '../../src/games/rally/game/tyre-gauge';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { stageClimate } from '../../src/games/rally/maps/shared/climate';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import {
  SURFACES,
  type SurfaceId,
} from '../../src/games/rally/physics/surfaces';
import {
  tempGrip,
  tempLevel,
  trackTemp,
} from '../../src/games/rally/physics/tyre-temp';
import {
  TYRE_IDS,
  TYRES,
  type TyreId,
} from '../../src/games/rally/physics/tyres';
import type {
  GroundProvider,
  GroundSample,
} from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';

/** Tyre temperature (physics/tyre-temp.ts, src/games/rally/PHYSICS.md "Tyre temperature"). */
const DT = 1 / PHYSICS_HZ;
const CLIMATE = { air: 20, sun: 10 };

const flat = (surface: SurfaceId): GroundProvider => ({
  sampleGround(_x: number, _z: number, out: GroundSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.surface = SURFACES[surface];
    return out;
  },
});

function car(tyre: TyreId, surface: SurfaceId): Vehicle {
  const def = ALL_CARS.find((c) => c.id === 'skoda_rally')!.physics;
  const v = new Vehicle(applySetup(def, SETUP_FOR_TYRE[tyre]), flat(surface));
  v.setTyre(tyre);
  v.setClimate(CLIMATE);
  v.reset(new Vector3(), 0);
  run(v, 2);
  return v;
}

function run(v: Vehicle, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
    each?.();
    v.step(DT);
  }
}

const maxTemp = (v: Vehicle) => Math.max(...v.wheels.map((w) => w.temp));
const minTemp = (v: Vehicle) => Math.min(...v.wheels.map((w) => w.temp));

/** Full throttle, full lock, no traction control: a donut. */
const donut = (v: Vehicle) => () => {
  v.tractionControl = false;
  v.controls.throttle = 1;
  v.controls.steer = 1;
};

/** Steady 60 km/h circle (gentle cornering). */
const circle = (v: Vehicle) => () => {
  v.controls.steer = 0.25;
  v.controls.throttle = v.speed < 16.7 ? 0.8 : 0.2;
};

describe('grip curves', () => {
  test.each(TYRE_IDS)(
    '%s: full grip inside the window, less cold and hot, loose ground halves the loss',
    (id) => {
      const w = TYRES[id].temp;
      expect(tempGrip((w.lo + w.hi) / 2, w, 0)).toBe(1);
      expect(tempGrip(w.lo - 100, w, 0)).toBeCloseTo(w.cold, 5);
      expect(tempGrip(w.hi + 100, w, 0)).toBeCloseTo(w.hot, 5);
      expect(tempGrip(w.lo - 100, w, 1)).toBeCloseTo(1 - (1 - w.cold) / 2, 5);
      // Monotonic up to the window, then down.
      let prev = 0;
      for (let t = w.lo - 60; t <= w.hi; t += 5) {
        const g = tempGrip(t, w, 0);
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
      for (let t = w.hi; t <= w.hi + 60; t += 5) {
        const g = tempGrip(t, w, 0);
        expect(g).toBeLessThanOrEqual(prev);
        prev = g;
      }
    },
  );

  test('tarmac rubber suffers most cold, gravel rubber works cold', () => {
    expect(TYRES.tarmac.temp.cold).toBeLessThan(TYRES.mixed.temp.cold);
    expect(TYRES.mixed.temp.cold).toBeLessThan(TYRES.gravel.temp.cold);
    expect(TYRES.gravel.temp.lo).toBeLessThan(TYRES.tarmac.temp.lo);
  });

  test('HUD colours: white cold, green in the window, yellow, then red', () => {
    const w = TYRES.tarmac.temp;
    const rgb = (t: number) => tyreColor(tempLevel(t, w));
    const [r0, g0, b0] = rgb(w.lo - 60);
    expect(Math.min(r0, g0, b0)).toBeGreaterThan(220); // white
    const [r1, g1, b1] = rgb((w.lo + w.hi) / 2);
    expect(g1).toBeGreaterThan(r1 + 100); // green
    expect(g1).toBeGreaterThan(b1 + 80);
    const [r2, g2, b2] = rgb(w.hi + 15);
    expect(r2).toBeGreaterThan(240); // yellow
    expect(g2).toBeGreaterThan(190);
    expect(b2).toBeLessThan(100);
    const [r3, g3] = rgb(w.hi + 60);
    expect(r3).toBeGreaterThan(240); // red
    expect(g3).toBeLessThan(80);
  });
});

describe('climate', () => {
  test('a dark road in the sun is hotter than the air, gravel and grass less so', () => {
    const c = stageClimate(petralicaMap.environment);
    const t = (s: SurfaceId) => trackTemp(c, SURFACES[s]);
    expect(t('tarmac')).toBeGreaterThan(c.air + 3);
    expect(t('tarmac')).toBeGreaterThan(t('gravel'));
    expect(t('gravel')).toBeGreaterThan(t('grass'));
  });

  test('a summer afternoon is hotter than a spring morning', () => {
    const hot = stageClimate(petralicaMap.environment);
    const cool = stageClimate(ajvatovciMap.environment);
    expect(trackTemp(hot, SURFACES.tarmac)).toBeGreaterThan(
      trackTemp(cool, SURFACES.tarmac) + 10,
    );
  });
});

describe('vehicle', () => {
  test('no climate = full grip, no temperature change (tool pages, reference tests)', () => {
    const def = ALL_CARS.find((c) => c.id === 'skoda_rally')!.physics;
    const v = new Vehicle(def, flat('tarmac'));
    v.setTyre('tarmac');
    v.reset(new Vector3(), 0);
    const before = v.wheels.map((w) => w.temp);
    run(v, 4, donut(v));
    expect(v.wheels.map((w) => w.temp)).toEqual(before);
    expect(v.wheels.every((w) => w.tempGrip === 1)).toBe(true);
  });

  test('cold tarmac tyres corner with less grip than warm ones', () => {
    const lateral = (temp: number) => {
      const v = car('tarmac', 'tarmac');
      run(v, 6, () => {
        v.controls.throttle = v.speed < 16.7 ? 1 : 0.3;
      });
      let g = 0;
      run(v, 3, () => {
        for (const w of v.wheels) w.temp = temp; // hold the temperature
        v.controls.steer = 1;
        v.controls.throttle = 0.4;
        g = Math.max(g, Math.abs(v.angularVelocity.y * v.speed) / 9.81);
      });
      return g;
    };
    const cold = lateral(20);
    const warm = lateral(85);
    console.info(
      `tarmac tyre lateral g: cold ${cold.toFixed(2)}  warm ${warm.toFixed(2)}`,
    );
    expect(cold).toBeLessThan(warm * 0.92);
  });

  test('gentle cornering warms the tarmac tyre into its window', () => {
    const v = car('tarmac', 'tarmac');
    const lo = TYRES.tarmac.temp.lo;
    let t = 0;
    while (maxTemp(v) < lo && t < 60) {
      run(v, 1, circle(v));
      t++;
    }
    console.info(
      `tarmac tyre reaches ${lo}°C after ${t} s of a 60 km/h circle`,
    );
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(40);
  });

  test('a donut overheats the tyres, clean driving cools them again', () => {
    const v = car('tarmac', 'tarmac');
    const hi = TYRES.tarmac.temp.hi;
    let t = 0;
    while (maxTemp(v) < hi && t < 30) {
      run(v, 0.5, donut(v));
      t += 0.5;
    }
    console.info(`tarmac tyre over ${hi}°C after ${t} s of a donut`);
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(15);
    const overheated = v.wheels.find((w) => w.temp >= hi)!;
    expect(overheated.tempGrip).toBeLessThan(1);
    // Two more seconds of abuse, then straight at ~60 km/h.
    run(v, 2, donut(v));
    v.reset(new Vector3(), 0);
    v.tractionControl = true;
    let cool = 0;
    while (maxTemp(v) >= hi && cool < 60) {
      run(v, 1, () => {
        v.controls.steer = 0;
        v.controls.throttle = v.speed < 16.7 ? 0.6 : 0;
      });
      cool++;
    }
    console.info(`back under ${hi}°C after ${cool} s at 60 km/h`);
    expect(cool).toBeLessThan(30);
  });

  test('the same slide heats tyres much less on gravel than on tarmac', () => {
    const tarmac = car('mixed', 'tarmac');
    const gravel = car('mixed', 'gravel');
    run(tarmac, 8, donut(tarmac));
    run(gravel, 8, donut(gravel));
    expect(maxTemp(gravel) - CLIMATE.air).toBeLessThan(
      (maxTemp(tarmac) - CLIMATE.air) * 0.75,
    );
  });

  test('reset to road keeps the temperatures, a stage restart cools them', () => {
    const v = car('tarmac', 'tarmac');
    run(v, 5, donut(v));
    const hot = minTemp(v);
    v.reset(new Vector3(), 0);
    expect(minTemp(v)).toBe(hot);
    v.resetTyreTemps();
    expect(maxTemp(v)).toBeLessThan(hot);
  });
});
