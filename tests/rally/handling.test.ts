import { writeFileSync } from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  applySetup,
  compliance,
  SETUP_FOR_TYRE,
  SETUP_IDS,
} from '../../src/games/rally/physics/car-setup';
import { TYRE_IDS } from '../../src/games/rally/physics/tyres';
import {
  type Cfg,
  carDef,
  cornerEvent,
  drop,
  flat,
  handbrakeTurn,
  holdG,
  jumpLanding,
  keyboardLock,
  rampSteer,
  rough,
  roughRide,
  slalom,
  stepSteer,
  straight,
  SURF,
} from './handling-harness';

/**
 * Handling overview: standard vehicle-dynamics manoeuvres on flat (and rough) ground for every car x tyre x set-up x
 * surface, so car balance can be judged now that tyres + suspension are variables (results + analysis:
 * src/games/rally/HANDLING-REVIEW.md; manoeuvres in handling-harness.ts).
 *
 *  - ramp steer at constant speed (60 / 100 km/h): max lateral g, understeer gradient, grip used per axle at the limit
 *  - step steer (80 km/h): yaw-rate response time + overshoot
 *  - from a steady corner (60 / 85 % of the limit): lift-off, full throttle (TC on / off), full / half brake ->
 *    sideslip growth
 *  - handbrake turn (50 km/h), slalom (90 km/h), keyboard full lock (60 / 100 / 140 km/h, the in-game steer limit)
 *  - straight line: 0-100, 100-0 (full and 60 % brake), which axle locks first, heading drift under braking
 *  - ride: 0.5 / 1 m drop (bump stop, settle time), 1 m jump landing at 80 km/h (body scrapes, speed kept), rough
 *    road (wheel load variation, contact loss, grip kept)
 *
 * Default run = every car on each tyre with its matching set-up (the menu defaults). `HANDLING_FULL=1` runs every
 * tyre x set-up combination; `HANDLING_OUT=<file.json>` writes all numbers for analysis.
 * Sign convention: `bo` = sideslip towards oversteer (+ = the tail is out of the turn), degrees.
 *
 * Assertions are only the guards every combination passes today (nothing rolls, TC catches power-on, lift-off and
 * straight braking stay calm, slalom settles); the numbers are for judging balance. Known issue NOT asserted: full
 * brake mid-corner spins the Zastava (rear brakes lock first) - see the review.
 */
const FULL = !!process.env.HANDLING_FULL;

// --- the matrix -------------------------------------------------------------------

const CARS = ALL_CARS.map((c) => c.id);
const configs: Cfg[] = [];
for (const car of CARS)
  for (const tyre of TYRE_IDS)
    for (const setup of FULL ? SETUP_IDS : [SETUP_FOR_TYRE[tyre]])
      configs.push({ car, tyre, setup });

const key = (c: Cfg) => `${c.car}|${c.tyre}|${c.setup}`;
const results: Record<string, unknown> = {};
const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '  - ');

describe('handling matrix (flat ground)', () => {
  for (const cfg of configs) {
    test(`${key(cfg)}`, () => {
      const per: Record<string, unknown> = {};
      const lines: string[] = [];
      for (const s of SURF) {
        const r60 = rampSteer(cfg, s, 60);
        const r100 = rampSteer(cfg, s, 100);
        const step = stepSteer(cfg, s);
        const ev = {
          lift: cornerEvent(cfg, s, r60.maxG, 'lift'),
          power: cornerEvent(cfg, s, r60.maxG, 'power'),
          powerNoTc: cornerEvent(cfg, s, r60.maxG, 'powerNoTc'),
          brake: cornerEvent(cfg, s, r60.maxG, 'brake'),
          lift85: cornerEvent(cfg, s, r60.maxG, 'lift', 0.85),
          brake85: cornerEvent(cfg, s, r60.maxG, 'brake', 0.85),
          brakeHalf: cornerEvent(cfg, s, r60.maxG, 'brakeHalf'),
        };
        const hb = handbrakeTurn(cfg, s);
        const sl = slalom(cfg, s);
        const kb = [60, 100, 140].map((k) => keyboardLock(cfg, s, k));
        const st = straight(cfg, s);
        per[s] = { r60, r100, step, ev, hb, sl, kb, st };
        lines.push(
          `${s.padEnd(13)} g60 ${f(r60.maxG)} g100 ${f(r100.maxG)} US ${f(r60.usGrad, 1)} grip used F/R ${f(r60.utilFront)}/${f(r60.utilRear)} | t90 ${f(step.t90)} os ${f(step.overshoot, 0)}% | lift ${f(ev.lift.dBeta, 1)} pow ${f(ev.power.dBeta, 1)} powNoTC ${f(ev.powerNoTc.dBeta, 1)} brk ${f(ev.brake.dBeta, 1)} | hb ${f(hb.rotateDeg, 0)} | slalom b ${f(sl.maxBeta, 1)} | kb g ${kb.map((k) => f(k.g)).join('/')} bo ${kb.map((k) => f(k.maxBetaOut, 0)).join('/')} | 0-100 ${f(st.t100, 1)} 100-0 ${f(st.full.dist, 0)}m ${st.full.firstLock} soft ${f(st.soft.dist, 0)}m ${st.soft.firstLock}`,
        );
        // Nothing may roll over in any of these.
        for (const e of Object.values(ev)) expect(e.minUp).toBeGreaterThan(0.5);
        for (const k of kb) expect(k.minUp).toBeGreaterThan(0.5);
        // TC on: flooring it mid-corner gives a drift, never a spin (worst today: Bimmer on loose gravel, ~19 deg).
        expect(ev.power.dBeta).toBeLessThan(30);
        // Lifting mid-corner never snaps the tail (today < 1 deg everywhere).
        expect(ev.lift85.dBeta).toBeLessThan(10);
        // Straight-line full braking stays straight; a slalom settles; steering responds.
        expect(st.full.headingDrift).toBeLessThan(5);
        expect(sl.spun).toBe(false);
        expect(sl.residualYaw).toBeLessThan(3);
        expect(step.t90).toBeLessThan(0.6);
      }
      results[key(cfg)] = per;
      console.info(`[${key(cfg)}]\n  ${lines.join('\n  ')}`);
    }, 600000);
  }
});

describe('ride (drop + rough road)', () => {
  for (const car of CARS)
    for (const setup of SETUP_IDS) {
      const cfg: Cfg = { car, tyre: 'mixed', setup };
      test(`${car}|${setup}`, () => {
        const d05 = drop(cfg, 0.5);
        const d10 = drop(cfg, 1.0);
        const land = jumpLanding(cfg, 'gravel', 80, 1.0);
        const ride = roughRide(cfg, 'gravel');
        const lim = rampSteer(cfg, 'gravel', 60);
        const flatG = holdG(cfg, flat('gravel'), lim.steerAtLimit);
        const roughG = holdG(cfg, rough('gravel'), lim.steerAtLimit);
        results[`ride|${car}|${setup}`] = {
          d05,
          d10,
          land,
          ride,
          flatG,
          roughG,
          compliance: compliance(applySetup(carDef(car), setup)),
        };
        console.info(
          `[ride ${car} ${setup}] c ${f(compliance(applySetup(carDef(car), setup)))} drop0.5 stop ${f(d05.bumpStopCm, 1)}cm settle ${f(d05.settle)}s | drop1 stop ${f(d10.bumpStopCm, 1)}cm settle ${f(d10.settle)}s | rough: loadCV ${f(ride.loadCv)} air ${f(ride.airPct, 1)}% stop ${f(ride.bumpStopPct, 1)}% az ${f(ride.azRms)}g | gravel g flat ${f(flatG)} rough ${f(roughG)} (${f((roughG / flatG - 1) * 100, 1)}%)`,
        );
        expect(d10.minUp).toBeGreaterThan(0.9);
        // 1 m landing at 80 km/h: a low body may scrape (hull fitted to it), but it never stops the car or tips it.
        console.info(
          `[landing ${car} ${setup}] speed kept ${f(land.speedKept * 100, 0)}% body contact ${land.bodyHits} steps, max impact ${f(land.maxImpact, 0)}, bump stop ${f(land.bumpStopCm, 1)} cm`,
        );
        expect(land.speedKept).toBeGreaterThan(0.85);
        expect(land.minUp).toBeGreaterThan(0.9);
        expect(ride.airPct).toBeLessThan(25);
      }, 600000);
    }
});

test('write report', () => {
  const out = process.env.HANDLING_OUT;
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
  expect(Object.keys(results).length).toBeGreaterThan(0);
});
