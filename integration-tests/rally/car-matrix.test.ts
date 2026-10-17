import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { jackieMap } from '../../src/games/rally/maps/jackie/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { stageClimate } from '../../src/games/rally/maps/shared/climate';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import { testMap } from '../../src/games/rally/maps/test/map';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import { TYRES, type TyreId } from '../../src/games/rally/physics/tyres';
import type { SetupId } from '../../src/games/rally/physics/types';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';
import { launch } from './handling-harness';

/**
 * Every car on every stage (autopilot, careful driver unless noted) with its recommended tyre + set-up, tyre + brake
 * temperatures on (the stage's climate, as in game): finishes upright, tyres and discs stay in a sane range, the home
 * tyre is warm at the finish. The worst pick (tarmac tyres on gravel, gravel tyres on tarmac) is not driven at rally
 * pace - on the wrong tyre that is a flying lesson, by physics - only over a few of the stage's steepest hills and
 * tightest hairpin climbs, flat out from a 50 km/h rolling start (traction control on, lifting off for bends): it must
 * get over every one, with at most one reset. Plus what a set-up alone is worth (Fabia, same tyre; no climate). Tyres +
 * set-ups: physics/tyres.ts, physics/car-setup.ts, src/games/rally/PHYSICS.md.
 */
const DT = 1 / PHYSICS_HZ;
const STAGES: MapDef[] = [testMap, petralicaMap, jackieMap, ajvatovciMap];
const worlds = new Map(STAGES.map((m) => [m.id, new World(m)]));

/** A hill spot: where the wrong-tyre drive starts (rolling) and the road distance it must reach. */
interface Spot {
  from: number;
  to: number;
  /** Where the hill starts and its average grade (for the message). */
  hill: number;
  grade: number;
}
/** Road before the hill (m) and the speed (km/h) the drive starts rolling at: how a driver arrives at the foot of it. */
const RUN_UP = 70;
const START_KMH = 50;
const HILL = 40;
const PAST_CREST = 10;
/** Hills per stage: the steepest, spread at least 600 m apart, at least `MIN_GRADE` (a hill, not a rise). */
const HILLS_PER_STAGE = 2;
const MIN_GRADE = 0.05;
/** The tightest hairpin climbs (a bend tighter than `HAIRPIN_RADIUS` m on a hill of at least `HAIRPIN_GRADE`) too. */
const HAIRPINS_PER_STAGE = 2;
const HAIRPIN_RADIUS = 25;
const HAIRPIN_GRADE = 0.1;

/**
 * The hills a wrong-tyre drive must get over: per stage the `HILLS_PER_STAGE` steepest windows of `HILL` m, plus its
 * `HAIRPINS_PER_STAGE` tightest hairpin climbs. Bends are part of the hill: the driver (`hillDriver`) lifts off for them.
 */
function hillSpots(world: World): Spot[] {
  const { start, finish } = world.stage;
  const road = world.stageRoad;
  const windows: { at: number; grade: number; radius: number }[] = [];
  for (let s = start + RUN_UP; s + HILL + PAST_CREST <= finish; s += 5) {
    let radius = Infinity;
    for (let d = 0; d <= HILL; d += 5)
      radius = Math.min(
        radius,
        1 / Math.max(Math.abs(road.at(s + d).curvature), 1e-6),
      );
    windows.push({
      at: s,
      grade: (road.at(s + HILL).y - road.at(s).y) / HILL,
      radius,
    });
  }
  const picked: typeof windows = [];
  const add = (w: (typeof windows)[number], apart: number) => {
    if (!picked.every((p) => Math.abs(p.at - w.at) >= apart)) return false;
    picked.push(w);
    return true;
  };
  const steep = windows
    .filter((w) => w.grade >= MIN_GRADE)
    .sort((a, b) => b.grade - a.grade);
  for (const w of steep) if (picked.length < HILLS_PER_STAGE) add(w, 600);
  // Each hairpin climb once: its tightest window (the windows of one climb follow each other).
  const hairpins = windows
    .filter((w) => w.radius <= HAIRPIN_RADIUS && w.grade >= HAIRPIN_GRADE)
    .sort((a, b) => a.radius - b.radius || b.grade - a.grade);
  let hairpinCount = 0;
  for (const w of hairpins)
    if (hairpinCount < HAIRPINS_PER_STAGE && add(w, 100)) hairpinCount++;
  return picked
    .sort((a, b) => a.at - b.at)
    .map((w) => ({
      from: w.at - RUN_UP,
      to: w.at + HILL + PAST_CREST,
      hill: w.at,
      grade: w.grade,
    }));
}

/**
 * Flat out, but not reckless - how a person drives a steep loose hill on the wrong tyre: full throttle, and for a bend
 * ahead just lift off, no braking, down to the speed it allows (`BEND_ACCEL` m/s² sideways: about 36 km/h in a 33 m
 * bend, 20 km/h in a 10 m hairpin, never lower); the brake is only for what lifting cannot shed. The autopilot only
 * steers: it brakes and lifts for the wrong tyre's low grip and stalls on a steep loose hill.
 */
const BEND_ACCEL = 3;
const BEND_MIN_SPEED = 20 / 3.6;
/** How far ahead the bends are looked at (m), and the slowing the lift-off alone is planned to give (m/s²). */
const BEND_LOOK = 200;
const BEND_COASTING = 1.5;
/** Speed (m/s) over the bend's that lifting is left to shed before the brake comes in. */
const BEND_BRAKE_OVER = 3;
function hillDriver(world: World, v: Vehicle, along: number): void {
  let target = Infinity;
  for (let d = 0; d <= BEND_LOOK; d += 4) {
    const k = Math.max(Math.abs(world.stageRoad.at(along + d).curvature), 1e-4);
    const bend = Math.max(BEND_MIN_SPEED, Math.sqrt(BEND_ACCEL / k));
    target = Math.min(target, Math.sqrt(bend * bend + 2 * BEND_COASTING * d));
  }
  const over = v.speed - target;
  v.controls.throttle = over > 0 ? 0 : 1;
  v.controls.brake =
    over > BEND_BRAKE_OVER
      ? Math.min(1, (over - BEND_BRAKE_OVER) * 0.3 + 0.2)
      : 0;
}

/** One drive of a stage, or of a hill `spot` of it (`hillDriver`, already rolling). */
function drive(
  carId: string,
  mapId: string,
  tyre: TyreId,
  setup: SetupId,
  extraGrip = false,
  climate = false,
  spot?: Spot,
) {
  const world = worlds.get(mapId)!;
  const def = ALL_CARS.find((c) => c.id === carId)!.physics;
  const v = new Vehicle(applySetup(def, setup), world);
  v.setTyre(tyre);
  if (climate) v.setClimate(stageClimate(world.map.environment));
  const from = spot?.from ?? world.stage.start - 9;
  const to = spot?.to ?? world.stage.finish;
  const spawn = world.roadSpawn(from);
  v.reset(spawn.position, spawn.heading);
  const ap = new Autopilot(world.stageRoad);
  ap.useExtraGrip = extraGrip;
  if (spot) launch(v, START_KMH);
  ap.reset(from);
  // A spot is a few hundred m: even a crawl of 7 km/h gets through it.
  const limit = spot
    ? 60 + (to - from) / 2
    : Math.max(240, (world.stage.finish - world.stage.start) / 4);
  let t = 0;
  let minUp = 1;
  let stuck = 0;
  let resets = 0;
  let hottest = 0;
  let hottestDisc = 0;
  while (t < limit && ap.along < to) {
    ap.drive(v, v.controls);
    if (spot) hillDriver(world, v, ap.along);
    v.step(DT);
    t += DT;
    minUp = Math.min(minUp, v.up.y);
    for (const w of v.wheels) {
      hottest = Math.max(hottest, w.temp);
      hottestDisc = Math.max(hottestDisc, w.brakeTemp);
    }
    stuck = Math.abs(v.speed) < 0.5 ? stuck + DT : 0;
    if (stuck > 5) {
      // A player presses R (reset to the road) when stuck; the wrong tyre on a steep loose climb may need it once.
      if (resets++ > 3) break;
      const s = world.roadSpawn(ap.along);
      v.reset(s.position, s.heading);
      stuck = 0;
    }
  }
  const finish = v.wheels.reduce((s, w) => s + w.temp / 4, 0);
  return {
    t,
    finished: ap.along >= to,
    minUp,
    resets,
    hottest,
    hottestDisc,
    finish,
  };
}

/** Recommended-pick stage time per `car/map`, filled by the matrix below (tests in a file run in order). */
const best = new Map<string, number>();

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  test.each(STAGES.map((m) => m.id))(
    '%s: finishes upright on the recommended pick',
    (mapId) => {
      const rec = STAGES.find((m) => m.id === mapId)!.stages[0].tyre;
      const a = drive(carId, mapId, rec, SETUP_FOR_TYRE[rec], false, true);
      best.set(`${carId}/${mapId}`, a.t);
      console.info(
        `[${carId} / ${mapId}] ${rec}+${SETUP_FOR_TYRE[rec]} ${a.t.toFixed(1)}s (up ${a.minUp.toFixed(2)}, finish ${a.finish.toFixed(0)}°C, max ${a.hottest.toFixed(0)}°C, discs ${a.hottestDisc.toFixed(0)}°C)`,
      );
      expect(a.finished).toBe(true);
      expect(a.minUp).toBeGreaterThan(0.5);
      expect(a.hottest).toBeLessThan(150);
      // Brakes (physics/brakes.ts): hot, but not cooked - the autopilot plans with the brakes it has.
      expect(a.hottestDisc).toBeLessThan(1300);
      // A stuck car gets a reset, as a player would; the careful run on the right tyre needs at most one and ends warm
      // (at most 10 °C under the window).
      expect(a.resets).toBeLessThanOrEqual(1);
      expect(a.finish).toBeGreaterThan(TYRES[rec].temp.lo - 10);
    },
    600000,
  );

  // The worst pick, with its matching set-up: tarmac tyres on a gravel stage, gravel tyres on a tarmac or dusty-tarmac
  // (mixed) stage. At rally pace it flies off by physics; flat out (lifting off for bends) it must go over every hill with
  // at most one reset (a player presses R after a stall, as on the recommended pick; the Porsche 911 needs one in the 10 m
  // hairpin at 8045 m on Petralica, where a wheel spins).
  test.each(STAGES.map((m) => m.id))(
    '%s: the worst pick gets over the steepest hills',
    (mapId) => {
      const rec = STAGES.find((m) => m.id === mapId)!.stages[0].tyre;
      const worst: TyreId = rec === 'gravel' ? 'tarmac' : 'gravel';
      for (const spot of hillSpots(worlds.get(mapId)!)) {
        const r = drive(
          carId,
          mapId,
          worst,
          SETUP_FOR_TYRE[worst],
          false,
          true,
          spot,
        );
        const at = `${worst} on the ${(spot.grade * 100).toFixed(0)} % hill at ${Math.round(spot.hill)} m`;
        expect(r.finished, `${at}: gets over the hill`).toBe(true);
        expect(r.resets, `${at}: needs at most one reset`).toBeLessThanOrEqual(
          1,
        );
        expect(r.minUp, `${at}: stays upright`).toBeGreaterThan(0.5);
      }
    },
    120000,
  );
});

// No "Fabia wins the gravel test map" check: the AWD car should feel better on gravel, but a car with more power may be
// quicker over the stage (by design, src/games/rally/PHYSICS.md "Stage times").
test('cars rank by character: Bimmer wins on tarmac, Zastava is slowest', () => {
  const t = (car: string, map: string) => best.get(`${car}/${map}`)!;
  const [fabia, bimmer, zastava] = ['skoda_rally', 'bimmer_m3', 'zastava_101'];
  expect(t(bimmer, 'jackie')).toBeLessThan(t(fabia, 'jackie'));
  for (const map of ['test', 'petralica', 'jackie']) {
    expect(t(zastava, map)).toBeGreaterThan(t(fabia, map));
    expect(t(zastava, map)).toBeGreaterThan(t(bimmer, map));
  }
});

test('fabia, same tyre: the right set-up alone is faster (limit driver) - soft on gravel, stiff on tarmac', () => {
  const car = 'skoda_rally';
  const gravel = {
    soft: drive(car, 'test', 'mixed', 'soft', true).t,
    stiff: drive(car, 'test', 'mixed', 'stiff', true).t,
  };
  const tarmac = {
    soft: drive(car, 'jackie', 'mixed', 'soft', true).t,
    stiff: drive(car, 'jackie', 'mixed', 'stiff', true).t,
  };
  console.info(
    `fabia mixed tyres: test soft ${gravel.soft.toFixed(1)} / stiff ${gravel.stiff.toFixed(1)}   jackie soft ${tarmac.soft.toFixed(1)} / stiff ${tarmac.stiff.toFixed(1)}`,
  );
  expect(gravel.soft).toBeLessThan(gravel.stiff);
  expect(tarmac.stiff).toBeLessThan(tarmac.soft);
}, 600000);
